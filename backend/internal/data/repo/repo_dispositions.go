package repo

import (
	"context"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/disposition"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/dispositionattachment"
	"github.com/sysadminsmedia/homebox/backend/internal/data/types"
)

// DispositionRepository stores collection history, not active inventory. There
// is deliberately no public history API. Reads are for collection backup and
// retained evidence, and always bind both record and collection identity.
type DispositionRepository struct{ db *ent.Client }

// DispositionSnapshot has no live entity/type/user dependencies. RecorderName
// may be the recorder's display name or email at the time of offboarding.
// PurchaseDate is read from the source's persisted date-only column;
// DispositionDate is the submitted calendar date. Nil Value means no value
// was recorded; &0 is a recorded zero.
type DispositionSnapshot struct {
	Name            string
	AssetID         int64
	SerialNumber    string
	Manufacturer    string
	ModelNumber     string
	Quantity        float64
	PurchasePrice   float64
	PurchaseDate    *time.Time
	PurchaseFrom    string
	Insured         bool
	IsLocation      bool
	ParentName      string
	Disposition     disposition.Disposition
	DispositionDate time.Time
	RecorderID      uuid.UUID
	RecorderName    string
	Recipient       string
	Value           *float64
	Notes           string
}

// RetainedDispositionFile points to copied bytes under the collection's
// independent disposition namespace, never to an active attachment's path.
// Type photo represents the primary photo. All receipt rows may be retained.
type RetainedDispositionFile struct {
	Type     dispositionattachment.Type
	Title    string
	Path     string
	MimeType string
}

// Create atomically persists a snapshot and its retained-file metadata. Blob
// copying/removal is the caller's responsibility and is not done by this repo.
func (r *DispositionRepository) Create(ctx context.Context, gid uuid.UUID, snapshot DispositionSnapshot, files []RetainedDispositionFile) (*ent.Disposition, error) {
	tx, err := r.db.Tx(ctx)
	if err != nil {
		return nil, err
	}
	row, err := r.CreateInTx(ctx, tx, gid, snapshot, files)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return row.Unwrap(), nil
}

// CreateInTx lets tree offboarding persist every snapshot and remove inventory
// in one caller-owned transaction. It never commits or rolls back that tx.
func (r *DispositionRepository) CreateInTx(ctx context.Context, tx *ent.Tx, gid uuid.UUID, s DispositionSnapshot, files []RetainedDispositionFile) (*ent.Disposition, error) {
	if s.DispositionDate.IsZero() || s.RecorderID == uuid.Nil {
		return nil, fmt.Errorf("disposition date and recorder id are required")
	}
	// Calendar dates use midnight UTC, just like inventory writes. Empty legacy
	// purchase dates are absent, not the year-one sentinel.
	s.DispositionDate = types.DateFromTime(s.DispositionDate).Time()
	if s.PurchaseDate != nil {
		if s.PurchaseDate.IsZero() {
			s.PurchaseDate = nil
		} else {
			date := types.DateFromDBTime(*s.PurchaseDate).Time()
			s.PurchaseDate = &date
		}
	}
	photos := 0
	for _, f := range files {
		if f.Type == dispositionattachment.TypePhoto {
			photos++
		}
		prefix := gid.String() + "/dispositions/"
		if !strings.HasPrefix(f.Path, prefix) || f.Path == prefix || path.Clean(f.Path) != f.Path || strings.ContainsAny(f.Path, "\\\x00") {
			return nil, fmt.Errorf("retained file must have an independent collection-owned disposition path")
		}
	}
	if photos > 1 {
		return nil, fmt.Errorf("only the primary photo may be retained")
	}
	row, err := tx.Disposition.Create().
		SetGroupID(gid).SetName(s.Name).SetAssetID(s.AssetID).
		SetSerialNumber(s.SerialNumber).SetManufacturer(s.Manufacturer).SetModelNumber(s.ModelNumber).
		SetQuantity(s.Quantity).SetPurchasePrice(s.PurchasePrice).SetNillablePurchaseDate(s.PurchaseDate).
		SetPurchaseFrom(s.PurchaseFrom).SetInsured(s.Insured).SetIsLocation(s.IsLocation).
		SetParentName(s.ParentName).SetDisposition(s.Disposition).SetDispositionDate(s.DispositionDate).
		SetRecorderID(s.RecorderID).SetRecorderName(s.RecorderName).SetRecipient(s.Recipient).
		SetNillableValue(s.Value).SetNotes(s.Notes).Save(ctx)
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		err := tx.DispositionAttachment.Create().SetDispositionID(row.ID).
			SetType(f.Type).SetTitle(f.Title).SetPath(f.Path).SetMimeType(f.MimeType).Exec(ctx)
		if err != nil {
			return nil, err
		}
	}
	return row, nil
}

func (r *DispositionRepository) Get(ctx context.Context, gid, id uuid.UUID) (*ent.Disposition, error) {
	return r.db.Disposition.Query().Where(disposition.GroupID(gid), disposition.ID(id)).WithAttachments().Only(ctx)
}

func (r *DispositionRepository) ListByGroup(ctx context.Context, gid uuid.UUID) ([]*ent.Disposition, error) {
	return r.db.Disposition.Query().Where(disposition.GroupID(gid)).WithAttachments().Order(ent.Asc(disposition.FieldID)).All(ctx)
}

func (r *DispositionRepository) GetAttachment(ctx context.Context, gid, recordID, fileID uuid.UUID) (*ent.DispositionAttachment, error) {
	return r.db.DispositionAttachment.Query().Where(
		dispositionattachment.ID(fileID), dispositionattachment.DispositionID(recordID),
		dispositionattachment.HasDispositionWith(disposition.GroupID(gid)),
	).Only(ctx)
}
