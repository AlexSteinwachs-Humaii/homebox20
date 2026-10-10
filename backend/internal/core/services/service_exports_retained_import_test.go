package services

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gocloud.dev/blob"

	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/disposition"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/dispositionattachment"
	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
)

func importDispositionZIP(t *testing.T, gid uuid.UUID, files map[string][]byte, corrupt string) error {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range files {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		require.NoError(t, err)
		_, err = w.Write(data)
		require.NoError(t, err)
	}
	require.NoError(t, zw.Close())
	data := buf.Bytes()
	if corrupt != "" {
		pos := bytes.Index(data, files[corrupt])
		require.GreaterOrEqual(t, pos, 0)
		data[pos] ^= 0xff // readable entry with a CRC failure during required-byte copying
	}
	ctx := context.Background()
	bucket, err := blob.OpenBucket(ctx, tRepos.Attachments.GetConnString())
	require.NoError(t, err)
	defer bucket.Close()
	key := gid.String() + "/imports/" + uuid.NewString() + ".zip"
	require.NoError(t, bucket.WriteAll(ctx, tRepos.Attachments.GetFullPath(key), data, nil))
	job, err := tRepos.Exports.CreateImport(ctx, gid, key, int64(len(data)))
	require.NoError(t, err)
	return tSvc.Exports.runImport(ctx, gid, tUser.ID, job.ID, key)
}

func TestRetainedImportFailureIsRetryableAndLegacyCompatible(t *testing.T) {
	ctx := context.Background()
	src, err := tRepos.Groups.GroupCreate(ctx, "failure-src-"+fk.Str(6), uuid.Nil)
	require.NoError(t, err)
	key := src.ID.String() + "/dispositions/" + uuid.NewString()
	bucket, err := blob.OpenBucket(ctx, tRepos.Attachments.GetConnString())
	require.NoError(t, err)
	defer bucket.Close()
	require.NoError(t, bucket.WriteAll(ctx, tRepos.Attachments.GetFullPath(key), []byte("unique retained restore payload"), nil))
	_, err = tRepos.Dispositions.Create(ctx, src.ID, repo.DispositionSnapshot{Name: "History", Quantity: 1.25, Disposition: disposition.DispositionDestroyed, DispositionDate: time.Now(), RecorderID: uuid.New(), RecorderName: "Deleted recorder"}, []repo.RetainedDispositionFile{{Type: dispositionattachment.TypeReceipt, Title: "Receipt", Path: key, MimeType: "text/plain"}})
	require.NoError(t, err)
	files := dispositionExportZIP(t, src.ID)
	var rows []map[string]any
	require.NoError(t, json.Unmarshal(files["disposition_attachments.json"], &rows))
	evidence := retainedEvidenceDir + rows[0]["id"].(string)
	dst, err := tRepos.Groups.GroupCreate(ctx, "failure-dst-"+fk.Str(6), uuid.Nil)
	require.NoError(t, err)
	require.ErrorContains(t, importDispositionZIP(t, dst.ID, files, evidence), "checksum error")
	ready, err := tSvc.Exports.IsGroupReadyForImport(ctx, dst.ID)
	require.NoError(t, err)
	require.True(t, ready)
	records, err := tRepos.Dispositions.ListByGroup(ctx, dst.ID)
	require.NoError(t, err)
	require.Empty(t, records)
	// Staging failures must clean up even files whose writer already closed.
	it := bucket.List(&blob.ListOptions{Prefix: tRepos.Attachments.GetFullPath(dst.ID.String() + "/dispositions/")})
	obj, err := it.Next(ctx)
	require.Nil(t, obj)
	require.Error(t, err)
	require.NoError(t, importDispositionZIP(t, dst.ID, files, ""))

	legacy, err := tRepos.Groups.GroupCreate(ctx, "legacy-"+fk.Str(6), uuid.Nil)
	require.NoError(t, err)
	et, err := tRepos.EntityTypes.GetDefault(ctx, legacy.ID, false)
	require.NoError(t, err)
	_, err = tRepos.Entities.Create(ctx, legacy.ID, repo.EntityCreate{Name: "Legacy inventory", EntityTypeID: et.ID})
	require.NoError(t, err)
	old := dispositionExportZIP(t, legacy.ID)
	delete(old, "dispositions.json")
	delete(old, "disposition_attachments.json")
	var mf Manifest
	require.NoError(t, json.Unmarshal(old[manifestFile], &mf))
	delete(mf.Counts, "dispositions")
	delete(mf.Counts, "disposition_attachments")
	delete(mf.Counts, "retained_evidence_files")
	old[manifestFile], err = json.Marshal(mf)
	require.NoError(t, err)
	legacyDst, err := tRepos.Groups.GroupCreate(ctx, "legacy-dst-"+fk.Str(6), uuid.Nil)
	require.NoError(t, err)
	require.NoError(t, importDispositionZIP(t, legacyDst.ID, old, ""))
	legacyExport := dispositionExportZIP(t, legacyDst.ID)
	var legacyItems []map[string]any
	require.NoError(t, json.Unmarshal(legacyExport["entities.json"], &legacyItems))
	require.Len(t, legacyItems, 1)
	require.Equal(t, "Legacy inventory", legacyItems[0]["name"])
}

func TestRetainedImportRejectsUntrustedMetadata(t *testing.T) {
	ctx := context.Background()
	src, err := tRepos.Groups.GroupCreate(ctx, "attack-src-"+fk.Str(6), uuid.Nil)
	require.NoError(t, err)
	_, err = tRepos.Dispositions.Create(ctx, src.ID, repo.DispositionSnapshot{Name: "History", Disposition: disposition.DispositionDestroyed, DispositionDate: time.Now(), RecorderID: uuid.New(), RecorderName: "Former member"}, nil)
	require.NoError(t, err)
	original := dispositionExportZIP(t, src.ID)
	var records []map[string]any
	require.NoError(t, json.Unmarshal(original["dispositions.json"], &records))
	for _, attack := range []string{"missing", "orphan", "traversal", "cross-group", "backslash", "duplicate", "archive-traversal", "foreign-record"} {
		t.Run(attack, func(t *testing.T) {
			files := map[string][]byte{}
			for name, data := range original {
				files[name] = data
			}
			id := uuid.NewString()
			row := map[string]any{"id": id, "disposition_id": records[0]["id"], "path": src.ID.String() + "/dispositions/evidence", "type": "receipt", "title": "file", "mime_type": "text/plain"}
			switch attack {
			case "orphan":
				row["disposition_id"] = uuid.NewString()
			case "traversal":
				row["path"] = src.ID.String() + "/dispositions/a/../evidence"
			case "cross-group":
				row["path"] = uuid.NewString() + "/dispositions/evidence"
			case "backslash":
				row["path"] = src.ID.String() + "/dispositions/a\\b"
			case "archive-traversal":
				files["disposition_attachments/../evil"] = []byte("bad")
			case "foreign-record":
				copied := map[string]any{}
				for k, v := range records[0] {
					copied[k] = v
				}
				copied["group_id"] = uuid.NewString()
				files["dispositions.json"], err = json.Marshal([]map[string]any{copied})
				require.NoError(t, err)
			}
			metadata := []map[string]any{row}
			if attack == "duplicate" {
				metadata = append(metadata, row)
			}
			files["disposition_attachments.json"], err = json.Marshal(metadata)
			require.NoError(t, err)
			if attack != "missing" {
				files[retainedEvidenceDir+id] = []byte("evidence")
			}
			// Keep manifest counts honest so each test reaches the relevant validation.
			var mf Manifest
			require.NoError(t, json.Unmarshal(files[manifestFile], &mf))
			mf.Counts["disposition_attachments"] = len(metadata)
			mf.Counts["retained_evidence_files"] = len(metadata)
			files[manifestFile], err = json.Marshal(mf)
			require.NoError(t, err)
			dst, err := tRepos.Groups.GroupCreate(ctx, "attack-dst-"+fk.Str(6), uuid.Nil)
			require.NoError(t, err)
			require.Error(t, importDispositionZIP(t, dst.ID, files, ""))
			ready, err := tSvc.Exports.IsGroupReadyForImport(ctx, dst.ID)
			require.NoError(t, err)
			require.True(t, ready)
		})
	}
}
