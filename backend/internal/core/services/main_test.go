package services

import (
	"context"
	"database/sql"
	"log"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	_ "github.com/jackc/pgx/v5/stdlib"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/sysadminsmedia/homebox/backend/internal/sys/config"

	"github.com/sysadminsmedia/homebox/backend/internal/core/currencies"
	"github.com/sysadminsmedia/homebox/backend/internal/core/services/reporting/eventbus"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent"
	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
	_ "github.com/sysadminsmedia/homebox/backend/pkgs/cgofreesqlite"
	"github.com/sysadminsmedia/homebox/backend/pkgs/faker"
	"github.com/sysadminsmedia/homebox/backend/pkgs/hasher"
)

var (
	fk   = faker.NewFaker()
	tbus = eventbus.New()

	tCtx    = Context{}
	tClient *ent.Client
	tRepos  *repo.AllRepos
	tUser   repo.UserOut
	tGroup  repo.Group
	tSvc    *AllServices
)

func bootstrap() {
	var (
		err error
		ctx = context.Background()
	)

	tGroup, err = tRepos.Groups.GroupCreate(ctx, "test-group", uuid.Nil)
	if err != nil {
		log.Fatal(err)
	}

	tUser, err = tRepos.Users.Create(ctx, repo.UserCreate{
		Name:           fk.Str(10),
		Email:          fk.Email(),
		Password:       new(fk.Str(10)),
		IsSuperuser:    fk.Bool(),
		DefaultGroupID: tGroup.ID,
	})
	if err != nil {
		log.Fatal(err)
	}
}

func MainNoExit(m *testing.M) int {
	// API key hashing is peppered and panics if the pepper was never configured
	// (see hasher.HashAPIKey); the app sets it at startup, so tests must too.
	hasher.SetAPIKeyPepper([]byte("test-api-key-pepper"))

	driver := "sqlite3"
	client, err := ent.Open(driver, "file:ent?mode=memory&cache=shared&_fk=1&_time_format=sqlite")
	// Opt-in, disposable database for cross-dialect ZIP restore tests.
	if dsn := os.Getenv("HBOX_TEST_SERVICES_POSTGRES_DSN"); dsn != "" {
		if client != nil {
			_ = client.Close()
		}
		driver = "postgres"
		var db *sql.DB
		db, err = sql.Open("pgx", dsn)
		if err == nil {
			client = ent.NewClient(ent.Driver(entsql.OpenDB(dialect.Postgres, db)))
		}
	}
	if err != nil {
		log.Fatalf("failed opening connection to sqlite: %v", err)
	}

	go func() {
		_ = tbus.Run(context.Background())
	}()

	err = client.Schema.Create(context.Background())
	if err != nil {
		log.Fatalf("failed creating schema resources: %v", err)
	}

	tClient = client
	tRepos = repo.New(tClient, tbus, config.Storage{
		PrefixPath: "/",
		ConnString: "file://" + os.TempDir(),
	}, "mem://{{ .Topic }}", config.Thumbnail{
		Enabled: false,
		Width:   0,
		Height:  0,
	})

	err = os.MkdirAll(os.TempDir()+"/homebox", 0o755)
	if err != nil {
		return 0
	}

	defaults, _ := currencies.CollectionCurrencies(
		currencies.CollectDefaults(),
	)

	tSvc = New(tRepos,
		WithCurrencies(defaults),
		WithExportPlumbing(tbus, tClient, config.Storage{
			PrefixPath: "/",
			ConnString: "file://" + os.TempDir(),
		}, "mem://{{ .Topic }}", driver),
	)
	defer func() { _ = client.Close() }()

	bootstrap()
	tCtx = Context{
		Context: context.Background(),
		GID:     tGroup.ID,
		UID:     tUser.ID,
	}

	return m.Run()
}

func TestMain(m *testing.M) {
	os.Exit(MainNoExit(m))
}
