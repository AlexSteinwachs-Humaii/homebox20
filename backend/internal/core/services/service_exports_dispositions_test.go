package services

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gocloud.dev/blob"

	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/attachment"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/disposition"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/dispositionattachment"
	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
)

func dispositionExportZIP(t *testing.T, gid uuid.UUID) map[string][]byte {
	t.Helper()
	ctx := context.Background()
	exp, err := tRepos.Exports.Create(ctx, gid)
	require.NoError(t, err)
	key, _, err := tSvc.Exports.buildArtifact(ctx, exp.ID, gid)
	require.NoError(t, err)
	bucket, err := blob.OpenBucket(ctx, tRepos.Attachments.GetConnString())
	require.NoError(t, err)
	defer bucket.Close()
	data, err := bucket.ReadAll(ctx, tRepos.Attachments.GetFullPath(key))
	require.NoError(t, err)
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	require.NoError(t, err)
	files := map[string][]byte{}
	for _, f := range zr.File {
		r, err := f.Open()
		require.NoError(t, err)
		files[f.Name], err = io.ReadAll(r)
		require.NoError(t, err)
		require.NoError(t, r.Close())
	}
	return files
}

func TestExportDispositionSnapshotsAndEvidence(t *testing.T) {
	ctx := context.Background()
	src, err := tRepos.Groups.GroupCreate(ctx, "history-"+fk.Str(6), uuid.Nil)
	require.NoError(t, err)
	other, err := tRepos.Groups.GroupCreate(ctx, "private-"+fk.Str(6), uuid.Nil)
	require.NoError(t, err)
	bucket, err := blob.OpenBucket(ctx, tRepos.Attachments.GetConnString())
	require.NoError(t, err)
	defer bucket.Close()
	date := time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC)
	zero := 0.0
	actor := uuid.New()
	kinds := []disposition.Disposition{disposition.DispositionSold, disposition.DispositionDestroyed, disposition.DispositionGivenAway, disposition.DispositionDonated, disposition.DispositionLostOrStolen}
	for i, kind := range kinds {
		snapshot := repo.DispositionSnapshot{Name: "Snapshot", AssetID: 456, SerialNumber: "serial", Manufacturer: "maker", ModelNumber: "model", Quantity: 2.5, PurchasePrice: 42.75, PurchaseDate: &date, PurchaseFrom: "shop", Insured: true, IsLocation: i == 1, ParentName: "Old parent", Disposition: kind, DispositionDate: date, RecorderID: actor, RecorderName: "Former member", Recipient: "recipient", Notes: "carried-over sold notes"}
		if i == 0 {
			snapshot.Value = &zero
		}
		var retained []repo.RetainedDispositionFile
		if i == 0 {
			for n, typ := range []dispositionattachment.Type{dispositionattachment.TypePhoto, dispositionattachment.TypeReceipt, dispositionattachment.TypeReceipt} {
				key := src.ID.String() + "/dispositions/" + uuid.NewString()
				data := []byte{byte(n), 1, 2, 255}
				require.NoError(t, bucket.WriteAll(ctx, tRepos.Attachments.GetFullPath(key), data, nil))
				retained = append(retained, repo.RetainedDispositionFile{Type: typ, Title: "evidence", Path: key, MimeType: "application/octet-stream"})
			}
		}
		_, err = tRepos.Dispositions.Create(ctx, src.ID, snapshot, retained)
		require.NoError(t, err)
		// Other collection metadata AND unreadable evidence must not affect export.
		_, err = tRepos.Dispositions.Create(ctx, other.ID, snapshot, []repo.RetainedDispositionFile{{Type: dispositionattachment.TypeReceipt, Title: "private", Path: other.ID.String() + "/dispositions/missing-" + uuid.NewString(), MimeType: "text/plain"}})
		require.NoError(t, err)
	}
	files := dispositionExportZIP(t, src.ID)
	var rows []map[string]any
	require.NoError(t, json.Unmarshal(files["dispositions.json"], &rows))
	require.Len(t, rows, 5)
	seen := map[string]bool{}
	for _, row := range rows {
		seen[row["disposition"].(string)] = true
		require.Equal(t, src.ID.String(), row["group_id"])
		require.Equal(t, "Snapshot", row["name"])
		require.Equal(t, float64(456), row["asset_id"])
		require.Equal(t, "serial", row["serial_number"])
		require.Equal(t, "maker", row["manufacturer"])
		require.Equal(t, "model", row["model_number"])
		require.Equal(t, 2.5, row["quantity"])
		require.Equal(t, 42.75, row["purchase_price"])
		require.Equal(t, "shop", row["purchase_from"])
		require.Contains(t, []any{true, float64(1)}, row["insured"])
		if row["disposition"] == "destroyed" {
			require.Contains(t, []any{true, float64(1)}, row["is_location"])
		} else {
			require.Contains(t, []any{false, float64(0)}, row["is_location"])
		}
		require.NotEmpty(t, row["purchase_date"])
		require.NotEmpty(t, row["disposition_date"])
		require.Equal(t, "Old parent", row["parent_name"])
		require.Equal(t, actor.String(), row["recorder_id"])
		require.Equal(t, "Former member", row["recorder_name"])
		require.Equal(t, "recipient", row["recipient"])
		require.Equal(t, "carried-over sold notes", row["notes"])
		if row["disposition"] == "sold" {
			require.Equal(t, float64(0), row["value"])
		} else {
			require.Nil(t, row["value"])
		}
	}
	for _, kind := range kinds {
		require.True(t, seen[string(kind)])
	}
	var metadata []map[string]any
	require.NoError(t, json.Unmarshal(files["disposition_attachments.json"], &metadata))
	require.Len(t, metadata, 3)
	for _, row := range metadata {
		data, err := bucket.ReadAll(ctx, tRepos.Attachments.GetFullPath(row["path"].(string)))
		require.NoError(t, err)
		require.Equal(t, data, files[retainedEvidenceDir+row["id"].(string)])
		require.Equal(t, "evidence", row["title"])
		require.Equal(t, "application/octet-stream", row["mime_type"])
	}
	var mf Manifest
	require.NoError(t, json.Unmarshal(files[manifestFile], &mf))
	require.Equal(t, 1, mf.SchemaVersion)
	require.Equal(t, 5, mf.Counts["dispositions"])
	require.Equal(t, 3, mf.Counts["disposition_attachments"])
	require.Equal(t, 3, mf.Counts["retained_evidence_files"])
	require.Zero(t, mf.Counts["entities"])
	require.Zero(t, mf.Counts["attachments"])
	// A history-only import must not create active inventory, nor substitute
	// the importer for the (deliberately nonexistent) historical recorder.
	dst, err := tRepos.Groups.GroupCreate(ctx, "restored-"+fk.Str(6), uuid.Nil)
	require.NoError(t, err)
	require.NoError(t, importDispositionZIP(t, dst.ID, files, ""))
	restored, err := tRepos.Dispositions.ListByGroup(ctx, dst.ID)
	require.NoError(t, err)
	require.Len(t, restored, len(rows))
	ready, err := tSvc.Exports.IsGroupReadyForImport(ctx, dst.ID)
	require.NoError(t, err)
	require.False(t, ready, "history-only collections must not be wiped by restore")
	second := dispositionExportZIP(t, dst.ID)
	var secondRows []map[string]any
	require.NoError(t, json.Unmarshal(second["dispositions.json"], &secondRows))
	byKind := map[string]map[string]any{}
	for _, row := range secondRows {
		byKind[row["disposition"].(string)] = row
	}
	for _, original := range rows {
		got := byKind[original["disposition"].(string)]
		require.NotEqual(t, original["id"], got["id"])
		require.Equal(t, dst.ID.String(), got["group_id"])
		for key, val := range original {
			if key != "id" && key != "group_id" {
				require.Equal(t, val, got[key], key)
			}
		}
	}
	var secondFiles []map[string]any
	require.NoError(t, json.Unmarshal(second["disposition_attachments.json"], &secondFiles))
	require.Len(t, secondFiles, len(metadata))
	var paths []string
	for _, row := range secondFiles {
		key := row["path"].(string)
		require.Contains(t, key, dst.ID.String()+"/dispositions/")
		paths = append(paths, key)
		data, err := bucket.ReadAll(ctx, tRepos.Attachments.GetFullPath(key))
		require.NoError(t, err)
		require.Equal(t, data, second[retainedEvidenceDir+row["id"].(string)])
		matched := false
		for _, old := range metadata {
			require.NotEqual(t, old["id"], row["id"])
			require.NotEqual(t, old["path"], key)
			if bytes.Equal(data, files[retainedEvidenceDir+old["id"].(string)]) {
				matched = true
			}
		}
		require.True(t, matched)
	}
	var active []map[string]any
	require.NoError(t, json.Unmarshal(second["entities.json"], &active))
	require.Empty(t, active)
	_, err = tRepos.Dispositions.Get(ctx, other.ID, restored[0].ID)
	require.Error(t, err)
	require.ErrorContains(t, importDispositionZIP(t, dst.ID, files, ""), "import requires")
	require.NoError(t, tRepos.Groups.GroupDelete(ctx, dst.ID))
	for _, key := range paths {
		exists, err := bucket.Exists(ctx, tRepos.Attachments.GetFullPath(key))
		require.NoError(t, err)
		require.False(t, exists)
	}
	for _, row := range metadata {
		exists, err := bucket.Exists(ctx, tRepos.Attachments.GetFullPath(row["path"].(string)))
		require.NoError(t, err)
		require.True(t, exists, "destination deletion must preserve source evidence")
	}
}

func TestExportOffboardedEvidenceAndActiveInventory(t *testing.T) {
	ctx := context.Background()
	src, err := tRepos.Groups.GroupCreate(ctx, "mixed-"+fk.Str(6), uuid.Nil)
	require.NoError(t, err)
	et, err := tRepos.EntityTypes.GetDefault(ctx, src.ID, false)
	require.NoError(t, err)
	removed, err := tRepos.Entities.Create(ctx, src.ID, repo.EntityCreate{Name: "leaving", EntityTypeID: et.ID})
	require.NoError(t, err)
	active, err := tRepos.Entities.Create(ctx, src.ID, repo.EntityCreate{Name: "staying", EntityTypeID: et.ID})
	require.NoError(t, err)
	for _, typ := range []attachment.Type{attachment.TypePhoto, attachment.TypeReceipt, attachment.TypeManual, attachment.TypeWarranty} {
		_, err := tRepos.Attachments.Create(ctx, removed.ID, repo.ItemCreateAttachment{Title: string(typ), Content: bytes.NewReader([]byte("bytes-" + string(typ)))}, typ, typ == attachment.TypePhoto)
		require.NoError(t, err)
	}
	activeAtt, err := tRepos.Attachments.Create(ctx, active.ID, repo.ItemCreateAttachment{Title: "active", Content: bytes.NewReader([]byte("active bytes"))}, attachment.TypeManual, false)
	require.NoError(t, err)
	preview, err := tRepos.Entities.PreviewOffboarding(ctx, src.ID, removed.ID)
	require.NoError(t, err)
	_, err = tRepos.Entities.Offboard(ctx, src.ID, removed.ID, preview.Confirmation, repo.DispositionSnapshot{Disposition: disposition.DispositionSold, DispositionDate: time.Now(), RecorderID: uuid.New(), RecorderName: "Member", Notes: "sold notes", Recipient: "Buyer"})
	require.NoError(t, err)
	files := dispositionExportZIP(t, src.ID)
	var entities []map[string]any
	require.NoError(t, json.Unmarshal(files["entities.json"], &entities))
	require.Len(t, entities, 1)
	require.Equal(t, active.ID.String(), entities[0]["id"])
	require.Equal(t, []byte("active bytes"), files[attachmentsDir+activeAtt.ID.String()])
	var metadata []map[string]any
	require.NoError(t, json.Unmarshal(files["disposition_attachments.json"], &metadata))
	require.Len(t, metadata, 2)
	for _, row := range metadata {
		require.Contains(t, []string{"photo", "receipt"}, row["type"])
		require.Equal(t, []byte("bytes-"+row["type"].(string)), files[retainedEvidenceDir+row["id"].(string)])
	}
	// A mixed import stages retained bytes first. If restoring a later active
	// attachment fails, compensate both kinds of rows and all staged evidence.
	dst, err := tRepos.Groups.GroupCreate(ctx, "mixed-dst-"+fk.Str(6), uuid.Nil)
	require.NoError(t, err)
	require.ErrorContains(t, importDispositionZIP(t, dst.ID, files, attachmentsDir+activeAtt.ID.String()), "checksum error")
	ready, err := tSvc.Exports.IsGroupReadyForImport(ctx, dst.ID)
	require.NoError(t, err)
	require.True(t, ready)
	restored, err := tRepos.Dispositions.ListByGroup(ctx, dst.ID)
	require.NoError(t, err)
	require.Empty(t, restored)
	require.NoError(t, importDispositionZIP(t, dst.ID, files, ""))
	mixed := dispositionExportZIP(t, dst.ID)
	var restoredActive []map[string]any
	require.NoError(t, json.Unmarshal(mixed["entities.json"], &restoredActive))
	require.Len(t, restoredActive, 1)
	require.Equal(t, "staying", restoredActive[0]["name"])
	var restoredMetadata []map[string]any
	require.NoError(t, json.Unmarshal(mixed["disposition_attachments.json"], &restoredMetadata))
	require.Len(t, restoredMetadata, 2)

	// Losing required bytes must fail both artifact creation and the tracked job.
	bucket, err := blob.OpenBucket(ctx, tRepos.Attachments.GetConnString())
	require.NoError(t, err)
	defer bucket.Close()
	it := bucket.List(&blob.ListOptions{Prefix: tRepos.Attachments.GetFullPath(dst.ID.String() + "/dispositions/")})
	stagedCount := 0
	for {
		_, err := it.Next(ctx)
		if err == io.EOF {
			break
		}
		require.NoError(t, err)
		stagedCount++
	}
	require.Equal(t, 2, stagedCount, "failed mixed restore must not leave retained-byte orphans")
	require.NoError(t, bucket.Delete(ctx, tRepos.Attachments.GetFullPath(metadata[0]["path"].(string))))
	exp, err := tRepos.Exports.Create(ctx, src.ID)
	require.NoError(t, err)
	key, size, err := tSvc.Exports.buildArtifact(ctx, exp.ID, src.ID)
	require.ErrorContains(t, err, "required retained evidence")
	require.Empty(t, key)
	require.Zero(t, size)
	tSvc.Exports.RunExport(ctx, exp.ID, src.ID)
	row, err := tRepos.Exports.Get(ctx, src.ID, exp.ID)
	require.NoError(t, err)
	require.EqualValues(t, "failed", row.Status)
	require.Contains(t, row.Error, "required retained evidence")
	require.Empty(t, row.ArtifactPath)
}

func TestExportRetainedEvidenceRejectsInvalidOwnershipPaths(t *testing.T) {
	gid := uuid.New()
	for _, key := range []string{
		uuid.NewString() + "/dispositions/private",
		gid.String() + "/dispositions/../documents/file",
		gid.String() + "/dispositions/",
		gid.String() + "/dispositions/file\\name",
	} {
		t.Run(key, func(t *testing.T) {
			var buf bytes.Buffer
			zw := zip.NewWriter(&buf)
			err := tSvc.Exports.copyRetainedEvidence(context.Background(), zw, gid, []map[string]any{{"id": uuid.NewString(), "path": key}})
			require.ErrorContains(t, err, "invalid collection-owned path")
			require.NoError(t, zw.Close())
		})
	}
}
