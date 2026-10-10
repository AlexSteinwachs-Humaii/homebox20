package repo

import (
	"context"
	"database/sql"
	"io/fs"
	"os"
	"testing"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent"
	"github.com/sysadminsmedia/homebox/backend/internal/data/migrations"
	pgmigrations "github.com/sysadminsmedia/homebox/backend/internal/data/migrations/postgres"
	sqlitemigrations "github.com/sysadminsmedia/homebox/backend/internal/data/migrations/sqlite3"
)

// Exercise the real embedded upgrade path and Goose history on both dialects.
// PostgreSQL uses a disposable database because legacy migrations explicitly
// reference public tables. HBOX_TEST_POSTGRES_DSN needs CREATEDB privileges.
func TestUserThemeRollout(t *testing.T) {
	for _, driver := range []string{"sqlite3", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			ctx := context.Background()
			var db *sql.DB
			entDialect := dialect.SQLite
			if driver == "postgres" {
				dsn := os.Getenv("HBOX_TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("set HBOX_TEST_POSTGRES_DSN to exercise PostgreSQL migrations")
				}
				cfg, err := pgx.ParseConfig(dsn)
				require.NoError(t, err)
				admin := stdlib.OpenDB(*cfg)
				defer admin.Close()
				database := "theme_test_" + uuid.New().String()[:8]
				_, err = admin.ExecContext(ctx, "CREATE DATABASE "+database)
				require.NoError(t, err)
				defer func() { _, err := admin.ExecContext(ctx, "DROP DATABASE "+database); require.NoError(t, err) }()
				cfg.Database = database
				db = stdlib.OpenDB(*cfg)
				entDialect = dialect.Postgres
			} else {
				var err error
				db, err = sql.Open("sqlite3", "file:"+uuid.NewString()+"?mode=memory&cache=shared&_fk=1&_time_format=sqlite")
				require.NoError(t, err)
			}
			db.SetMaxOpenConns(2) // legacy RunDB migrations require a second connection
			client := ent.NewClient(ent.Driver(entsql.OpenDB(entDialect, db)))
			defer client.Close()
			embedded, err := migrations.Migrations(driver)
			require.NoError(t, err)
			migrationFS, err := fs.Sub(embedded, driver)
			require.NoError(t, err)
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
			newProvider := func() *goose.Provider {
				p, err := goose.NewProvider(goose.Dialect(driver), db, migrationFS, goose.WithDisableGlobalRegistry(true), goose.WithGoMigrations(goMigrations...))
				require.NoError(t, err)
				return p
			}
			provider := newProvider()
			_, err = provider.UpTo(ctx, 20260513120000)
			require.NoError(t, err)

			group, err := client.Group.Create().SetName("theme accounts").Save(ctx)
			require.NoError(t, err)
			settingsCases := []map[string]interface{}{
				nil, nil, {}, {"theme": ""}, {"theme": nil}, {"theme": "homebox"},
				{"theme": "dark", "language": "de", "itemsPerTablePage": float64(48), "nested": map[string]interface{}{"enabled": false, "values": []interface{}{"one", float64(2), nil}}},
			}
			ids := make([]uuid.UUID, len(settingsCases))
			for i, settings := range settingsCases {
				u, err := client.User.Create().SetName("legacy").SetEmail(uuid.NewString() + "@example.test").SetDefaultGroupID(group.ID).SetSettings(settings).Save(ctx)
				require.NoError(t, err)
				ids[i] = u.ID
			}
			// Ent serializes a nil map as JSON null; also cover a SQL NULL.
			// The literal below is a generated UUID, not user input.
			_, err = db.ExecContext(ctx, "UPDATE users SET settings = NULL WHERE id = '"+ids[0].String()+"'")
			require.NoError(t, err)
			_, err = provider.Up(ctx)
			require.NoError(t, err)
			for i, id := range ids {
				u, err := client.User.Get(ctx, id)
				require.NoError(t, err)
				expected := map[string]interface{}{"theme": "claude"}
				for key, value := range settingsCases[i] {
					if key != "theme" {
						expected[key] = value
					}
				}
				require.Equal(t, expected, u.Settings)
				require.Equal(t, "legacy", u.Name)
				require.NotNil(t, u.DefaultGroupID)
				require.Equal(t, group.ID, *u.DefaultGroupID)
			}

			r := &UserRepository{db: client}
			later := map[string]interface{}{"theme": "dracula", "language": "fr", "nested": map[string]interface{}{"keep": true}}
			require.NoError(t, r.SetSettings(ctx, ids[0], later))
			// A fresh provider represents a restarted/redeployed application.
			provider = newProvider()
			applied, err := provider.Up(ctx)
			require.NoError(t, err)
			require.Empty(t, applied)
			got, err := r.GetSettings(ctx, ids[0])
			require.NoError(t, err)
			require.Equal(t, later, got)
			_, err = provider.Down(ctx)
			require.NoError(t, err)
			got, err = r.GetSettings(ctx, ids[0])
			require.NoError(t, err)
			require.Equal(t, later, got, "rollback must not erase subsequent choices")

			// Local registration and invitations share Create; OIDC shares its
			// transactional createUserWithMembership implementation.
			for _, path := range []string{"registration", "invitation", "oidc"} {
				t.Run(path, func(t *testing.T) {
					input := UserCreate{Name: path, Email: uuid.NewString() + "@example.test", DefaultGroupID: group.ID, IsOwner: path != "invitation"}
					var u UserOut
					var err error
					if path == "oidc" {
						u, err = r.CreateWithOIDC(ctx, input, "https://issuer.example.test", uuid.NewString())
					} else {
						input.Password = new("password")
						u, err = r.Create(ctx, input)
					}
					require.NoError(t, err)
					saved, err := client.User.Get(ctx, u.ID)
					require.NoError(t, err)
					require.Equal(t, map[string]interface{}{"theme": "claude"}, saved.Settings)
					require.NoError(t, r.SetSettings(ctx, u.ID, later))
					got, err := r.GetSettings(ctx, u.ID)
					require.NoError(t, err)
					require.Equal(t, later, got)
				})
			}
		})
	}
}
