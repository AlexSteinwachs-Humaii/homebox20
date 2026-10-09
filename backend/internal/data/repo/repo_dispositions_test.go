package repo

import (
	"context"
	"database/sql"
	"io/fs"
	"os"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/disposition"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/dispositionattachment"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/usergroup"
	"github.com/sysadminsmedia/homebox/backend/internal/data/migrations"
	pgmigrations "github.com/sysadminsmedia/homebox/backend/internal/data/migrations/postgres"
	sqlitemigrations "github.com/sysadminsmedia/homebox/backend/internal/data/migrations/sqlite3"
)

func TestDispositionRepository(t *testing.T) {
	testDispositionSnapshots(t, tClient)
}

// Runs the actual complete Goose upgrade path, not just Ent Schema.Create.
// The PostgreSQL DSN must point to a disposable empty test database.
func TestDispositionMigrations(t *testing.T) {
	for _, driver := range []string{"sqlite3", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			ctx := context.Background()
			dsn, sqlDriver, entDialect := "file:"+uuid.NewString()+"?mode=memory&cache=shared&_fk=1&_time_format=sqlite", "sqlite3", dialect.SQLite
			if driver == "postgres" {
				dsn = os.Getenv("HBOX_TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("set HBOX_TEST_POSTGRES_DSN to exercise PostgreSQL migrations")
				}
				sqlDriver, entDialect = "pgx", dialect.Postgres
			}
			db, err := sql.Open(sqlDriver, dsn)
			require.NoError(t, err)
			// Goose reserves a connection; legacy RunDB migrations need another.
			db.SetMaxOpenConns(2)
			client := ent.NewClient(ent.Driver(entsql.OpenDB(entDialect, db)))
			defer client.Close()
			embedded, err := migrations.Migrations(driver)
			require.NoError(t, err)
			migrationFS, err := fs.Sub(embedded, driver)
			require.NoError(t, err)
			// Provider otherwise adds both dialects' global registrations.
			goMigrations := []*goose.Migration{
				goose.NewGoMigration(20241226183416, &goose.GoFunc{RunTx: sqlitemigrations.Up20241226183416}, &goose.GoFunc{RunTx: sqlitemigrations.Down20241226183416}),
				goose.NewGoMigration(20260416120001, &goose.GoFunc{RunDB: sqlitemigrations.Up20260402120001}, &goose.GoFunc{RunDB: sqlitemigrations.Down20260402120001}),
			}
			if driver == "postgres" {
				goMigrations = []*goose.Migration{
					goose.NewGoMigration(20250112202302, &goose.GoFunc{RunTx: pgmigrations.Up20250112202302}, &goose.GoFunc{RunTx: pgmigrations.Down20250112202302}),
					goose.NewGoMigration(20260416120000, &goose.GoFunc{RunTx: pgmigrations.Up20260402120000}, &goose.GoFunc{RunTx: pgmigrations.Down20260402120000}),
				}
			}
			provider, err := goose.NewProvider(goose.Dialect(driver), db, migrationFS,
				goose.WithDisableGlobalRegistry(true), goose.WithGoMigrations(goMigrations...))
			require.NoError(t, err)
			_, err = provider.UpTo(ctx, 20260512130001)
			require.NoError(t, err)

			g, err := client.Group.Create().SetName("legacy collection").Save(ctx)
			require.NoError(t, err)
			et, err := client.EntityType.Create().SetGroupID(g.ID).SetName("legacy thing").Save(ctx)
			require.NoError(t, err)
			soldDate := time.Date(2025, 3, 10, 0, 0, 0, 0, time.UTC)
			legacy, err := client.Entity.Create().SetGroupID(g.ID).SetEntityTypeID(et.ID).
				SetName("Legacy sold item").SetQuantity(2.75).SetAssetID(12345).
				SetSoldTo("Buyer").SetSoldPrice(0).SetSoldDate(soldDate).SetSoldNotes("Historical sale notes").Save(ctx)
			require.NoError(t, err)
			unsold, err := client.Entity.Create().SetGroupID(g.ID).SetEntityTypeID(et.ID).SetName("Active item").Save(ctx)
			require.NoError(t, err)
			_, err = provider.Up(ctx)
			require.NoError(t, err)
			after, err := client.Entity.Get(ctx, legacy.ID)
			require.NoError(t, err)
			require.Equal(t, legacy.Name, after.Name)
			require.Equal(t, legacy.AssetID, after.AssetID)
			require.Equal(t, legacy.Quantity, after.Quantity)
			require.Equal(t, "Buyer", after.SoldTo)
			require.Equal(t, float64(0), after.SoldPrice)
			require.True(t, soldDate.Equal(after.SoldDate))
			require.Equal(t, "Historical sale notes", after.SoldNotes)
			require.False(t, after.Archived)
			_, err = client.Entity.Get(ctx, unsold.ID)
			require.NoError(t, err)
			count, err := client.Disposition.Query().Count(ctx)
			require.NoError(t, err)
			require.Zero(t, count, "upgrade must not offboard legacy sold inventory")

			testDispositionSnapshots(t, client)
			// Downgrade only this migration: existing inventory is still intact.
			_, err = provider.Down(ctx)
			require.NoError(t, err)
			_, err = client.Entity.Get(ctx, legacy.ID)
			require.NoError(t, err)
			require.NoError(t, client.Entity.DeleteOneID(legacy.ID).Exec(ctx))
			require.NoError(t, client.Entity.DeleteOneID(unsold.ID).Exec(ctx))
			require.NoError(t, client.EntityType.DeleteOneID(et.ID).Exec(ctx))
			require.NoError(t, client.Group.DeleteOneID(g.ID).Exec(ctx))
		})
	}
}

func testDispositionSnapshots(t *testing.T, client *ent.Client) {
	t.Helper()
	ctx := context.Background()
	r := &DispositionRepository{db: client}
	g, err := client.Group.Create().SetName("history collection").Save(ctx)
	require.NoError(t, err)
	other, err := client.Group.Create().SetName("other collection").Save(ctx)
	require.NoError(t, err)
	defer func() { _ = client.Group.DeleteOneID(g.ID).Exec(ctx); _ = client.Group.DeleteOneID(other.ID).Exec(ctx) }()
	recorder, err := client.User.Create().SetName("Recorder").SetEmail(uuid.NewString() + "@example.test").Save(ctx)
	require.NoError(t, err)
	require.NoError(t, client.UserGroup.Create().SetUserID(recorder.ID).SetGroupID(g.ID).Exec(ctx))
	et, err := client.EntityType.Create().SetGroupID(g.ID).SetName("source type").SetIsLocation(true).Save(ctx)
	require.NoError(t, err)
	source, err := client.Entity.Create().SetGroupID(g.ID).SetEntityTypeID(et.ID).SetName("source entity").Save(ctx)
	require.NoError(t, err)
	activeFile, err := client.Attachment.Create().SetEntityID(source.ID).SetType("receipt").SetPath("active-receipt").Save(ctx)
	require.NoError(t, err)
	purchaseDate := time.Date(2020, 2, 29, 0, 0, 0, 0, time.UTC)
	date := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	zero := float64(0)
	s := DispositionSnapshot{
		Name: "Workroom", AssetID: 987654321, SerialNumber: "SN-123", Manufacturer: "Maker", ModelNumber: "Model",
		Quantity: 2.75, PurchasePrice: 123.45, PurchaseDate: &purchaseDate, PurchaseFrom: "Shop",
		Insured: true, IsLocation: true, ParentName: "House", Disposition: disposition.DispositionDonated,
		DispositionDate: date, RecorderID: recorder.ID, RecorderName: recorder.Email,
		Recipient: "Charity", Value: &zero, Notes: "Original sold notes / historical details",
	}
	files := []RetainedDispositionFile{
		{Type: dispositionattachment.TypePhoto, Title: "Primary photo", Path: g.ID.String() + "/dispositions/" + uuid.NewString() + ".jpg", MimeType: "image/jpeg"},
		{Type: dispositionattachment.TypeReceipt, Title: "Receipt one", Path: g.ID.String() + "/dispositions/" + uuid.NewString() + ".pdf", MimeType: "application/pdf"},
		{Type: dispositionattachment.TypeReceipt, Title: "Receipt two", Path: g.ID.String() + "/dispositions/" + uuid.NewString() + ".txt", MimeType: "text/plain"},
	}
	// pgx can return UTC-midnight dates in the server's local timezone.
	// Snapshotting that value must not permanently move the calendar day.
	localPurchase := purchaseDate.In(time.FixedZone("west", -6*60*60))
	s.PurchaseDate = &localPurchase
	row, err := r.Create(ctx, g.ID, s, files)
	require.NoError(t, err)
	// Recorder membership, recorder, source files/entity, and type can all go.
	_, err = client.UserGroup.Delete().Where(usergroup.UserID(recorder.ID), usergroup.GroupID(g.ID)).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, client.User.DeleteOneID(recorder.ID).Exec(ctx))
	require.NoError(t, client.Entity.DeleteOneID(source.ID).Exec(ctx))
	require.NoError(t, client.EntityType.DeleteOneID(et.ID).Exec(ctx))
	_, err = client.Attachment.Get(ctx, activeFile.ID)
	require.True(t, ent.IsNotFound(err))
	got, err := r.Get(ctx, g.ID, row.ID)
	require.NoError(t, err)
	require.Equal(t, s.Name, got.Name)
	require.Equal(t, s.AssetID, got.AssetID)
	require.Equal(t, s.SerialNumber, got.SerialNumber)
	require.Equal(t, s.Manufacturer, got.Manufacturer)
	require.Equal(t, s.ModelNumber, got.ModelNumber)
	require.Equal(t, s.Quantity, got.Quantity)
	require.Equal(t, s.PurchasePrice, got.PurchasePrice)
	require.NotNil(t, got.PurchaseDate)
	require.True(t, purchaseDate.Equal(*got.PurchaseDate))
	require.Equal(t, s.PurchaseFrom, got.PurchaseFrom)
	require.Equal(t, s.Insured, got.Insured)
	require.Equal(t, s.IsLocation, got.IsLocation)
	require.Equal(t, s.ParentName, got.ParentName)
	require.Equal(t, s.Disposition, got.Disposition)
	require.True(t, date.Equal(got.DispositionDate))
	require.Equal(t, recorder.ID, got.RecorderID)
	require.Equal(t, recorder.Email, got.RecorderName)
	require.Equal(t, s.Recipient, got.Recipient)
	require.NotNil(t, got.Value)
	require.Zero(t, *got.Value)
	require.Equal(t, s.Notes, got.Notes)
	require.Len(t, got.Edges.Attachments, 3)
	for _, expected := range files {
		found := false
		for _, f := range got.Edges.Attachments {
			if f.Path != expected.Path {
				continue
			}
			found = true
			require.Equal(t, expected.Type, f.Type)
			require.Equal(t, expected.Title, f.Title)
			require.Equal(t, expected.MimeType, f.MimeType)
			require.Equal(t, got.ID, f.DispositionID)
			_, err = r.GetAttachment(ctx, g.ID, got.ID, f.ID)
			require.NoError(t, err)
			_, err = r.GetAttachment(ctx, other.ID, got.ID, f.ID)
			require.True(t, ent.IsNotFound(err))
			_, err = r.GetAttachment(ctx, g.ID, uuid.New(), f.ID)
			require.True(t, ent.IsNotFound(err))
		}
		require.True(t, found)
	}
	_, err = r.Get(ctx, other.ID, row.ID)
	require.True(t, ent.IsNotFound(err))
	rows, err := r.ListByGroup(ctx, other.ID)
	require.NoError(t, err)
	require.Empty(t, rows)

	for _, outcome := range []disposition.Disposition{disposition.DispositionSold, disposition.DispositionDestroyed, disposition.DispositionGivenAway, disposition.DispositionDonated, disposition.DispositionLostOrStolen} {
		s.Disposition, s.Value, s.PurchaseDate, s.IsLocation = outcome, nil, nil, false
		created, err := r.Create(ctx, g.ID, s, nil)
		require.NoError(t, err)
		require.Nil(t, created.Value)
		require.Nil(t, created.PurchaseDate)
		require.False(t, created.IsLocation)
	}
	rows, err = r.ListByGroup(ctx, g.ID)
	require.NoError(t, err)
	require.Len(t, rows, 6)
	// A bad file or disposition rolls back the complete aggregate.
	s.Disposition = "archived"
	_, err = r.Create(ctx, g.ID, s, nil)
	require.Error(t, err)
	s.Disposition = disposition.DispositionSold
	invalid := append([]RetainedDispositionFile(nil), files...)
	for i := range invalid {
		invalid[i].Path = g.ID.String() + "/dispositions/" + uuid.NewString()
	}
	invalid[2].Type = "manual"
	_, err = r.Create(ctx, g.ID, s, invalid)
	require.Error(t, err)
	invalid = []RetainedDispositionFile{{Type: dispositionattachment.TypeReceipt, Path: other.ID.String() + "/dispositions/file"}}
	_, err = r.Create(ctx, g.ID, s, invalid)
	require.Error(t, err)
	invalid[0].Path = g.ID.String() + "/dispositions/../active/file"
	_, err = r.Create(ctx, g.ID, s, invalid)
	require.Error(t, err)
	_, err = r.Create(ctx, g.ID, s, []RetainedDispositionFile{files[0], files[0]})
	require.Error(t, err)
	rows, err = r.ListByGroup(ctx, g.ID)
	require.NoError(t, err)
	require.Len(t, rows, 6)
	// Caller-owned transactions can roll back a whole tree.
	tx, err := client.Tx(ctx)
	require.NoError(t, err)
	_, err = r.CreateInTx(ctx, tx, g.ID, s, nil)
	require.NoError(t, err)
	require.NoError(t, tx.Rollback())
	rows, err = r.ListByGroup(ctx, g.ID)
	require.NoError(t, err)
	require.Len(t, rows, 6)
	otherFile := RetainedDispositionFile{Type: dispositionattachment.TypeReceipt, Path: other.ID.String() + "/dispositions/" + uuid.NewString()}
	otherRecord, err := r.Create(ctx, other.ID, s, []RetainedDispositionFile{otherFile})
	require.NoError(t, err)
	require.NoError(t, client.Group.DeleteOneID(g.ID).Exec(ctx))
	rows, err = r.ListByGroup(ctx, g.ID)
	require.NoError(t, err)
	require.Empty(t, rows)
	survivor, err := r.Get(ctx, other.ID, otherRecord.ID)
	require.NoError(t, err)
	require.Len(t, survivor.Edges.Attachments, 1)
	require.Equal(t, otherFile.Path, survivor.Edges.Attachments[0].Path)
	for _, f := range got.Edges.Attachments {
		_, err = client.DispositionAttachment.Get(ctx, f.ID)
		require.True(t, ent.IsNotFound(err), "collection delete must cascade to retained metadata")
	}
}
