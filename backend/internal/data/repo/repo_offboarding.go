package repo

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/attachment"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/dispositionattachment"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/entity"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/entitytemplate"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/group"
	"gocloud.dev/blob"
)

// Avoid two local SQLite read-to-write upgrades starving each other. Database
// serializable isolation remains the authority across processes and other writers.
var offboardingCommitMu sync.Mutex

var ErrOffboardingConfirmationChanged = errors.New("inventory changed; refresh offboarding confirmation")

type OffboardingPreview struct {
	RootID          uuid.UUID `json:"rootId"`
	DescendantCount int       `json:"descendantCount"`
	Confirmation    string    `json:"confirmation"`
}

// Read the complete collection predicate in the transaction. Serializable isolation
// protects against phantom children/reparenting as well as overlapping submissions.
func offboardingTree(ctx context.Context, db *ent.Client, gid, root uuid.UUID) ([]*ent.Entity, string, error) {
	all, err := db.Entity.Query().Where(entity.HasGroupWith(group.ID(gid))).WithParent().WithEntityType().WithAttachments(func(q *ent.AttachmentQuery) { q.WithThumbnail().Order(ent.Asc("id")) }).Order(ent.Asc(entity.FieldID)).All(ctx)
	if err != nil {
		return nil, "", err
	}
	children := map[uuid.UUID][]*ent.Entity{}
	var start *ent.Entity
	for _, e := range all {
		if e.ID == root {
			start = e
		}
		if e.Edges.Parent != nil {
			children[e.Edges.Parent.ID] = append(children[e.Edges.Parent.ID], e)
		}
	}
	if start == nil {
		return nil, "", &ent.NotFoundError{}
	}
	seen := map[uuid.UUID]bool{}
	tree := []*ent.Entity{}
	var visit func(*ent.Entity) error
	visit = func(e *ent.Entity) error {
		if seen[e.ID] {
			return fmt.Errorf("invalid inventory cycle")
		}
		seen[e.ID] = true
		tree = append(tree, e)
		for _, c := range children[e.ID] {
			if err := visit(c); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit(start); err != nil {
		return nil, "", err
	}
	raw, err := json.Marshal(tree)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(raw)
	return tree, hex.EncodeToString(sum[:]), nil
}

func (r *EntityRepository) PreviewOffboarding(ctx context.Context, gid, root uuid.UUID) (OffboardingPreview, error) {
	tree, version, err := offboardingTree(ctx, r.db, gid, root)
	if err != nil {
		return OffboardingPreview{}, err
	}
	return OffboardingPreview{root, len(tree) - 1, version}, nil
}

// Offboard stages independent evidence copies before deleting any source row.
// A failed copy or transaction leaves original bytes untouched. Cleanup failures
// after commit are logged, never presented as a failed/partial inventory result.
func (r *EntityRepository) Offboard(ctx context.Context, gid, root uuid.UUID, confirmation string, details DispositionSnapshot) ([]uuid.UUID, error) {
	offboardingCommitMu.Lock()
	defer offboardingCommitMu.Unlock()
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	tree, version, err := offboardingTree(ctx, tx.Client(), gid, root)
	if err != nil {
		return nil, err
	}
	if confirmation == "" || version != confirmation {
		return nil, ErrOffboardingConfirmationChanged
	}
	bucket, err := blob.OpenBucket(ctx, r.attachments.GetConnString())
	if err != nil {
		return nil, err
	}
	defer bucket.Close()
	staged := []string{}
	originals := []string{}
	committed := false
	defer func() {
		if !committed {
			for _, p := range staged {
				exists, e := bucket.Exists(context.WithoutCancel(ctx), r.attachments.fullPath(p))
				if e == nil && !exists {
					continue
				}
				if e := bucket.Delete(context.WithoutCancel(ctx), r.attachments.fullPath(p)); e != nil {
					log.Err(e).Msg("failed to clean staged offboarding evidence")
				}
			}
		}
	}()
	ids := []uuid.UUID{}
	entityIDs := []uuid.UUID{}
	history := &DispositionRepository{db: r.db}
	for _, e := range tree {
		files := []RetainedDispositionFile{}
		for _, a := range e.Edges.Attachments {
			if !isExternalLink(a.MimeType) {
				originals = append(originals, a.Path)
			}
			if a.Edges.Thumbnail != nil {
				originals = append(originals, a.Edges.Thumbnail.Path)
			}
			if a.Type != "receipt" && !(a.Type == "photo" && a.Primary) {
				continue
			}
			if isExternalLink(a.MimeType) {
				return nil, fmt.Errorf("cannot retain external-link evidence %s", a.Title)
			}
			p := gid.String() + "/dispositions/" + uuid.NewString()
			staged = append(staged, p)
			reader, err := bucket.NewReader(ctx, r.attachments.fullPath(a.Path), nil)
			if err != nil {
				return nil, err
			}
			writer, err := bucket.NewWriter(ctx, r.attachments.fullPath(p), &blob.WriterOptions{ContentType: a.MimeType})
			if err != nil {
				reader.Close()
				return nil, err
			}
			_, copyErr := io.Copy(writer, reader)
			readErr := reader.Close()
			writeErr := writer.Close()
			if err := errors.Join(copyErr, readErr, writeErr); err != nil {
				return nil, err
			}
			files = append(files, RetainedDispositionFile{Type: dispositionattachment.Type(a.Type.String()), Title: a.Title, Path: p, MimeType: a.MimeType})
		}
		s := details
		s.Name = e.Name
		s.AssetID = e.AssetID
		s.SerialNumber = e.SerialNumber
		s.Manufacturer = e.Manufacturer
		s.ModelNumber = e.ModelNumber
		s.Quantity = e.Quantity
		s.PurchasePrice = e.PurchasePrice
		s.PurchaseFrom = e.PurchaseFrom
		s.Insured = e.Insured
		s.IsLocation = e.Edges.EntityType.IsLocation
		s.ParentName = ""
		s.PurchaseDate = nil
		if e.Edges.Parent != nil {
			s.ParentName = e.Edges.Parent.Name
		}
		if !e.PurchaseDate.IsZero() {
			date := e.PurchaseDate
			s.PurchaseDate = &date
		}
		row, err := history.CreateInTx(ctx, tx, gid, s, files)
		if err != nil {
			return nil, err
		}
		ids = append(ids, row.ID)
		entityIDs = append(entityIDs, e.ID)
	}
	// Templates are active configuration, not evidence; clear obsolete locations.
	if err := tx.EntityTemplate.Update().Where(entitytemplate.HasLocationWith(entity.IDIn(entityIDs...))).ClearLocation().Exec(ctx); err != nil {
		return nil, err
	}
	for i := len(tree) - 1; i >= 0; i-- {
		for _, a := range tree[i].Edges.Attachments {
			if a.Edges.Thumbnail != nil {
				if err := tx.Attachment.UpdateOneID(a.ID).ClearThumbnail().Exec(ctx); err != nil {
					return nil, err
				}
				// A thumbnail can be shared; only remove an unreferenced thumbnail row.
				used, err := tx.Attachment.Query().Where(attachment.HasThumbnailWith(attachment.ID(a.Edges.Thumbnail.ID))).Exist(ctx)
				if err != nil {
					return nil, err
				}
				if !used {
					if err := tx.Attachment.DeleteOneID(a.Edges.Thumbnail.ID).Exec(ctx); err != nil {
						return nil, err
					}
				}
			}
		}
		if err := tx.Entity.DeleteOneID(tree[i].ID).Exec(ctx); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true
	for _, p := range originals {
		if err := r.attachments.DeleteUnreferencedBlob(context.WithoutCancel(ctx), p); err != nil {
			log.Err(err).Str("path", p).Msg("offboarding committed; source blob cleanup failed")
		}
	}
	r.publishMutationEvent(gid)
	return ids, nil
}
