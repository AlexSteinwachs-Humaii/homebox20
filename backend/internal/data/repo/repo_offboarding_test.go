package repo

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"fmt"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/attachment"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/disposition"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/entity"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/group"
	"github.com/sysadminsmedia/homebox/backend/internal/sys/config"
	"gocloud.dev/blob"
)

func testOffboardingTree(t *testing.T, db *ent.Client) {
	ctx := context.Background()
	repos := New(db, nil, config.Storage{ConnString: "file://" + t.TempDir()}, "", config.Thumbnail{})
	g, err := db.Group.Create().SetName("offboard").Save(ctx)
	require.NoError(t, err)
	other, err := db.Group.Create().SetName("surviving").Save(ctx)
	require.NoError(t, err)
	typ, err := db.EntityType.Create().SetGroupID(g.ID).SetName("thing").Save(ctx)
	require.NoError(t, err)
	place, err := db.EntityType.Create().SetGroupID(g.ID).SetName("place").SetIsLocation(true).Save(ctx)
	require.NoError(t, err)
	root, err := db.Entity.Create().SetGroupID(g.ID).SetEntityTypeID(place.ID).SetName("root").Save(ctx)
	require.NoError(t, err)
	nested, err := db.Entity.Create().SetGroupID(g.ID).SetEntityTypeID(place.ID).SetName("nested").SetParent(root).Save(ctx)
	require.NoError(t, err)
	child, err := db.Entity.Create().SetGroupID(g.ID).SetEntityTypeID(typ.ID).SetName("decimal archived child").SetQuantity(2.75).SetPurchasePrice(42).SetArchived(true).SetParent(nested).Save(ctx)
	require.NoError(t, err)
	otherType, err := db.EntityType.Create().SetGroupID(other.ID).SetName("other thing").Save(ctx)
	require.NoError(t, err)
	survivor, err := db.Entity.Create().SetGroupID(other.ID).SetEntityTypeID(otherType.ID).SetName("survivor").Save(ctx)
	require.NoError(t, err)
	bucket, err := blob.OpenBucket(ctx, repos.Attachments.GetConnString())
	require.NoError(t, err)
	defer bucket.Close()
	shared := g.ID.String() + "/documents/shared"
	require.NoError(t, bucket.WriteAll(ctx, shared, []byte("evidence"), nil))
	for _, spec := range []struct {
		typ     attachment.Type
		primary bool
	}{{attachment.TypePhoto, true}, {attachment.TypePhoto, false}, {attachment.TypeReceipt, false}, {attachment.TypeReceipt, false}, {attachment.TypeManual, false}, {attachment.TypeWarranty, false}} {
		_, err := db.Attachment.Create().SetEntity(child).SetType(spec.typ).SetPrimary(spec.primary).SetPath(shared).SetTitle(spec.typ.String()).Save(ctx)
		require.NoError(t, err)
	}
	_, err = db.Attachment.Create().SetEntity(survivor).SetPath(shared).Save(ctx)
	require.NoError(t, err)
	_, err = db.MaintenanceEntry.Create().SetEntityID(child.ID).SetName("maintenance").Save(ctx)
	require.NoError(t, err)
	template, err := db.EntityTemplate.Create().SetGroupID(g.ID).SetName("template").SetLocation(nested).Save(ctx)
	require.NoError(t, err)
	preview, err := repos.Entities.PreviewOffboarding(ctx, g.ID, root.ID)
	require.NoError(t, err)
	require.Equal(t, 2, preview.DescendantCount)
	_, err = repos.Entities.PreviewOffboarding(ctx, other.ID, root.ID)
	require.Error(t, err)
	_, err = db.Entity.UpdateOneID(child.ID).SetName("changed").Save(ctx)
	require.NoError(t, err)
	zero := float64(0)
	details := DispositionSnapshot{Disposition: disposition.DispositionDonated, DispositionDate: time.Now(), RecorderID: uuid.New(), RecorderName: "member", Recipient: "charity", Notes: "whole tree", Value: &zero}
	_, err = repos.Entities.Offboard(ctx, g.ID, root.ID, preview.Confirmation, details)
	require.ErrorIs(t, err, ErrOffboardingConfirmationChanged)
	preview, err = repos.Entities.PreviewOffboarding(ctx, g.ID, root.ID)
	require.NoError(t, err)
	ids, err := repos.Entities.Offboard(ctx, g.ID, root.ID, preview.Confirmation, details)
	require.NoError(t, err)
	require.Len(t, ids, 3)
	count, err := db.Entity.Query().Where(entity.HasGroupWith(group.ID(g.ID))).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
	records, err := repos.Dispositions.ListByGroup(ctx, g.ID)
	require.NoError(t, err)
	require.Len(t, records, 3)
	for _, r := range records {
		require.Equal(t, details.Disposition, r.Disposition)
		require.Equal(t, details.Recipient, r.Recipient)
		require.Equal(t, details.Notes, r.Notes)
		require.NotNil(t, r.Value)
		require.Zero(t, *r.Value)
		if r.Name == "changed" {
			require.Equal(t, 2.75, r.Quantity)
			require.Equal(t, "nested", r.ParentName)
			require.False(t, r.IsLocation)
			require.Len(t, r.Edges.Attachments, 3)
			for _, a := range r.Edges.Attachments {
				require.NotEqual(t, shared, a.Path)
				bytes, err := bucket.ReadAll(ctx, a.Path)
				require.NoError(t, err)
				require.Equal(t, []byte("evidence"), bytes)
			}
		} else {
			require.True(t, r.IsLocation)
		}
	}
	_, err = repos.Entities.Offboard(ctx, g.ID, root.ID, preview.Confirmation, details)
	require.Error(t, err)
	require.False(t, db.EntityTemplate.GetX(ctx, template.ID).QueryLocation().ExistX(ctx))
	require.NoError(t, repos.Groups.GroupDelete(ctx, g.ID))
	for _, r := range records {
		for _, a := range r.Edges.Attachments {
			exists, err := bucket.Exists(ctx, a.Path)
			require.NoError(t, err)
			require.False(t, exists)
		}
	}
	bytes, err := bucket.ReadAll(ctx, shared)
	require.NoError(t, err)
	require.Equal(t, []byte("evidence"), bytes)
	require.True(t, db.Entity.Query().Where(entity.ID(survivor.ID)).ExistX(ctx))
}

func TestOffboardingTree(t *testing.T) { testOffboardingTree(t, tClient) }

func TestOffboardingFailuresAndConcurrentSubmit(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	repos := New(tClient, nil, config.Storage{ConnString: "file://" + dir}, "", config.Thumbnail{})
	g, err := tClient.Group.Create().SetName("failure").Save(ctx)
	require.NoError(t, err)
	typ, err := tClient.EntityType.Create().SetGroupID(g.ID).SetName("thing").Save(ctx)
	require.NoError(t, err)
	root, err := tClient.Entity.Create().SetGroupID(g.ID).SetEntityTypeID(typ.ID).SetName("root").Save(ctx)
	require.NoError(t, err)
	p := g.ID.String() + "/documents/photo"
	_, err = tClient.Attachment.Create().SetEntity(root).SetType(attachment.TypePhoto).SetPrimary(true).SetPath(p).Save(ctx)
	require.NoError(t, err)
	preview, err := repos.Entities.PreviewOffboarding(ctx, g.ID, root.ID)
	require.NoError(t, err)
	details := DispositionSnapshot{Disposition: disposition.DispositionDestroyed, DispositionDate: time.Now(), RecorderID: uuid.New(), RecorderName: "member"}
	_, err = repos.Entities.Offboard(ctx, g.ID, root.ID, preview.Confirmation, details)
	require.Error(t, err)
	require.True(t, tClient.Entity.Query().Where(entity.ID(root.ID)).ExistX(ctx))
	require.Empty(t, tClient.Disposition.Query().Where(disposition.GroupID(g.ID)).AllX(ctx))
	require.NoError(t, os.MkdirAll(filepath.Dir(filepath.Join(dir, p)), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, p), []byte("photo"), 0600))
	// Invalid recorder causes DB snapshot failure after copying. Original survives.
	details.RecorderID = uuid.Nil
	_, err = repos.Entities.Offboard(ctx, g.ID, root.ID, preview.Confirmation, details)
	require.Error(t, err)
	bytes, err := os.ReadFile(filepath.Join(dir, p))
	require.NoError(t, err)
	require.Equal(t, []byte("photo"), bytes)
	staged, err := filepath.Glob(filepath.Join(dir, g.ID.String(), "dispositions", "*"))
	require.NoError(t, err)
	require.Empty(t, staged)
	details.RecorderID = uuid.New()
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := repos.Entities.Offboard(ctx, g.ID, root.ID, preview.Confirmation, details)
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	successes := 0
	for err := range results {
		t.Logf("submission: %v", err)
		if err == nil {
			successes++
		}
	}
	require.Equal(t, 1, successes)
	require.Len(t, tClient.Disposition.Query().Where(disposition.GroupID(g.ID)).AllX(ctx), 1)
}

func TestOffboardingRollbackAfterDeletion(t *testing.T) {
	ctx := context.Background()
	db, err := ent.Open("sqlite3", "file:"+uuid.NewString()+"?mode=memory&cache=shared&_fk=1&_time_format=sqlite")
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, db.Schema.Create(ctx))
	repos := New(db, nil, config.Storage{ConnString: "file://" + t.TempDir()}, "", config.Thumbnail{})
	g := db.Group.Create().SetName("rollback").SaveX(ctx)
	typ := db.EntityType.Create().SetGroupID(g.ID).SetName("thing").SaveX(ctx)
	root := db.Entity.Create().SetGroupID(g.ID).SetEntityTypeID(typ.ID).SetName("root").SaveX(ctx)
	child := db.Entity.Create().SetGroupID(g.ID).SetEntityTypeID(typ.ID).SetParent(root).SetName("child").SaveX(ctx)
	bucket, err := blob.OpenBucket(ctx, repos.Attachments.GetConnString())
	require.NoError(t, err)
	defer bucket.Close()
	p := g.ID.String() + "/documents/receipt"
	require.NoError(t, bucket.WriteAll(ctx, p, []byte("receipt"), nil))
	db.Attachment.Create().SetEntity(child).SetType(attachment.TypeReceipt).SetPath(p).SaveX(ctx)
	preview, err := repos.Entities.PreviewOffboarding(ctx, g.ID, root.ID)
	require.NoError(t, err)
	details := DispositionSnapshot{Disposition: disposition.DispositionDestroyed, DispositionDate: time.Now(), RecorderID: uuid.New(), RecorderName: "member"}
	// Inject a persistence error on the root, after the child has been deleted.
	db.Entity.Use(func(next ent.Mutator) ent.Mutator {
		return ent.MutateFunc(func(ctx context.Context, m ent.Mutation) (ent.Value, error) {
			if m.Op().Is(ent.OpDeleteOne) {
				em := m.(*ent.EntityMutation)
				id, _ := em.ID()
				if id == root.ID {
					return nil, fmt.Errorf("injected database failure")
				}
			}
			return next.Mutate(ctx, m)
		})
	})
	_, err = repos.Entities.Offboard(ctx, g.ID, root.ID, preview.Confirmation, details)
	require.ErrorContains(t, err, "injected database failure")
	require.True(t, db.Entity.Query().Where(entity.IDIn(root.ID, child.ID)).CountX(ctx) == 2)
	require.Zero(t, db.Disposition.Query().CountX(ctx))
	bytes, err := bucket.ReadAll(ctx, p)
	require.NoError(t, err)
	require.Equal(t, []byte("receipt"), bytes)
	staged, err := filepath.Glob(filepath.Join(strings.TrimPrefix(repos.Attachments.GetConnString(), "file://"), g.ID.String(), "dispositions", "*"))
	require.NoError(t, err)
	require.Empty(t, staged)

	// Creating a descendant invalidates the original confirmation.
	db.Entity.Create().SetGroupID(g.ID).SetEntityTypeID(typ.ID).SetParent(root).SetName("new child").SaveX(ctx)
	_, err = repos.Entities.Offboard(ctx, g.ID, root.ID, preview.Confirmation, details)
	require.ErrorIs(t, err, ErrOffboardingConfirmationChanged)
}

func TestOffboardingRejectsExternalEvidence(t *testing.T) {
	ctx := context.Background()
	g := tClient.Group.Create().SetName("external evidence").SaveX(ctx)
	typ := tClient.EntityType.Create().SetGroupID(g.ID).SetName("thing").SaveX(ctx)
	root := tClient.Entity.Create().SetGroupID(g.ID).SetEntityTypeID(typ.ID).SetName("root").SaveX(ctx)
	tClient.Attachment.Create().SetEntity(root).SetType(attachment.TypeReceipt).SetMimeType(MimeTypeLinkURL).SetPath("http://127.0.0.1/private").SaveX(ctx)
	repos := New(tClient, nil, config.Storage{ConnString: "file://" + t.TempDir()}, "", config.Thumbnail{})
	preview, err := repos.Entities.PreviewOffboarding(ctx, g.ID, root.ID)
	require.NoError(t, err)
	_, err = repos.Entities.Offboard(ctx, g.ID, root.ID, preview.Confirmation, DispositionSnapshot{})
	require.ErrorContains(t, err, "cannot retain external-link evidence")
	require.True(t, tClient.Entity.Query().Where(entity.ID(root.ID)).ExistX(ctx))
	require.Zero(t, tClient.Disposition.Query().Where(disposition.GroupID(g.ID)).CountX(ctx))
}
