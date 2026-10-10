package v1

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/hay-kot/httpkit/errchain"
	"github.com/stretchr/testify/require"
	"github.com/sysadminsmedia/homebox/backend/internal/core/services"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent"
	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
	"github.com/sysadminsmedia/homebox/backend/internal/sys/config"
	"github.com/sysadminsmedia/homebox/backend/internal/sys/validate"
	_ "github.com/sysadminsmedia/homebox/backend/pkgs/cgofreesqlite"
	"gocloud.dev/blob"
)

func TestOffboardingMemberAPI(t *testing.T) {
	ctx := context.Background()
	db, err := ent.Open("sqlite3", "file:"+uuid.NewString()+"?mode=memory&cache=shared&_fk=1&_time_format=sqlite")
	require.NoError(t, err)
	defer db.Close()
	require.NoError(t, db.Schema.Create(ctx))
	repos := repo.New(db, nil, config.Storage{ConnString: "file://" + t.TempDir()}, "", config.Thumbnail{})
	ctrl := &V1Controller{repo: repos, svc: services.New(repos)}
	bucket, err := blob.OpenBucket(ctx, repos.Attachments.GetConnString())
	require.NoError(t, err)
	defer bucket.Close()
	group, err := db.Group.Create().SetName("member collection").Save(ctx)
	require.NoError(t, err)
	other, err := db.Group.Create().SetName("other collection").Save(ctx)
	require.NoError(t, err)
	// No owner or ownership record exists for this ordinary member.
	member := &repo.UserOut{ID: uuid.New(), Name: "ordinary member", DefaultGroupID: group.ID}
	call := func(handler errchain.HandlerFunc, method string, id uuid.UUID, body string, gid uuid.UUID) (*httptest.ResponseRecorder, error) {
		r := httptest.NewRequest(method, "/", strings.NewReader(body))
		route := chi.NewRouteContext()
		route.URLParams.Add("id", id.String())
		c := context.WithValue(ctx, chi.RouteCtxKey, route)
		c = services.SetTenantCtx(services.SetUserCtx(c, member, ""), gid)
		r = r.WithContext(c)
		w := httptest.NewRecorder()
		return w, handler(w, r)
	}
	status := func(err error, code int) {
		t.Helper()
		var request *validate.RequestError
		require.True(t, errors.As(err, &request), "%v", err)
		require.Equal(t, code, request.Status)
	}
	for _, place := range []bool{false, true} {
		typ, err := db.EntityType.Create().SetGroupID(group.ID).SetName(uuid.NewString()).SetIsLocation(place).Save(ctx)
		require.NoError(t, err)
		root, err := db.Entity.Create().SetGroupID(group.ID).SetEntityTypeID(typ.ID).SetName("root").Save(ctx)
		require.NoError(t, err)
		child, err := db.Entity.Create().SetGroupID(group.ID).SetEntityTypeID(typ.ID).SetParent(root).SetName("child").Save(ctx)
		require.NoError(t, err)
		originalPath := group.ID.String() + "/" + uuid.NewString()
		require.NoError(t, bucket.WriteAll(ctx, originalPath, []byte("retained evidence"), nil))
		_, err = db.Attachment.Create().SetEntity(root).SetType("photo").SetPrimary(true).SetPath(originalPath).Save(ctx)
		require.NoError(t, err)
		_, err = call(ctrl.HandleOffboardingPreview(), "GET", root.ID, "", other.ID)
		status(err, http.StatusNotFound)
		w, err := call(ctrl.HandleOffboardingPreview(), "GET", root.ID, "", group.ID)
		require.NoError(t, err)
		var preview repo.OffboardingPreview
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &preview))
		require.Equal(t, 1, preview.DescendantCount)
		// Exercise both the reproduced failure and the supported upper boundary
		// through the handler, transaction, and persisted descendant snapshots.
		notes := strings.Repeat("N", 1001)
		if place {
			// API validation counts characters, not UTF-8 bytes.
			notes = strings.Repeat("界", 10000)
		}
		body := `{"confirmation":"` + preview.Confirmation + `","disposition":"destroyed","date":"2026-10-09","notes":"` + notes + `","value":0,"groupId":"` + other.ID.String() + `","recorderId":"` + uuid.NewString() + `","descendantCount":0}`
		_, err = call(ctrl.HandleOffboardingComplete(), "POST", root.ID, body, other.ID)
		status(err, http.StatusNotFound)
		for _, invalidBody := range []string{
			strings.Replace(body, `"destroyed"`, `"gift"`, 1),
			strings.Replace(body, `"destroyed"`, `"sold"`, 1),
			strings.Replace(body, `"2026-10-09"`, `"2025-02-29"`, 1),
			strings.Replace(body, `"value":0`, `"value":-1`, 1),
			strings.Replace(body, `"notes":"`+notes+`"`, `"notes":"`+strings.Repeat("N", 10001)+`"`, 1),
		} {
			_, err = call(ctrl.HandleOffboardingComplete(), "POST", root.ID, invalidBody, group.ID)
			status(err, http.StatusBadRequest)
		}
		_, err = call(ctrl.HandleEntityDelete(), "DELETE", root.ID, "", group.ID)
		status(err, http.StatusConflict)
		_, err = call(ctrl.HandleWipeInventory(), "POST", root.ID, "", group.ID)
		status(err, http.StatusConflict)
		require.NoError(t, db.Entity.UpdateOne(child).SetName("changed").Exec(ctx))
		_, err = call(ctrl.HandleOffboardingComplete(), "POST", root.ID, body, group.ID)
		status(err, http.StatusConflict)
		records, err := repos.Dispositions.ListByGroup(ctx, group.ID)
		require.NoError(t, err)
		if place {
			require.Len(t, records, 2)
		} else {
			require.Empty(t, records)
		}
		_, err = db.Entity.Get(ctx, root.ID)
		require.NoError(t, err)
		w, err = call(ctrl.HandleOffboardingPreview(), "GET", root.ID, "", group.ID)
		require.NoError(t, err)
		var refreshed repo.OffboardingPreview
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &refreshed))
		body = strings.ReplaceAll(body, preview.Confirmation, refreshed.Confirmation)
		w, err = call(ctrl.HandleOffboardingComplete(), "POST", root.ID, body, group.ID)
		require.NoError(t, err)
		var result services.OffboardingResult
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Equal(t, 2, result.Completed)
		for _, id := range result.RecordIDs {
			record, err := repos.Dispositions.Get(ctx, group.ID, id)
			require.NoError(t, err)
			require.Equal(t, member.ID, record.RecorderID)
			require.Equal(t, member.Name, record.RecorderName)
			require.Equal(t, notes, record.Notes)
			require.NotNil(t, record.Value)
			require.Zero(t, *record.Value)
			for _, file := range record.Edges.Attachments {
				_, err = repos.Dispositions.GetAttachment(ctx, other.ID, id, file.ID)
				require.True(t, ent.IsNotFound(err))
				content, err := bucket.ReadAll(ctx, file.Path)
				require.NoError(t, err)
				require.Equal(t, "retained evidence", string(content))
			}
			_, err = repos.Dispositions.Get(ctx, other.ID, id)
			require.True(t, ent.IsNotFound(err))
		}
		_, err = call(ctrl.HandleOffboardingComplete(), "POST", root.ID, body, group.ID)
		status(err, http.StatusNotFound)
	}
}
