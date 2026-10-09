package services

import (
	"archive/zip"
	"context"
	"database/sql"
	"fmt"
	"io"
	"path"
	"strings"

	"github.com/google/uuid"
	"gocloud.dev/blob"
)

// Version 1 originally had no history tables. Missing BOTH tables is supported;
// once present, metadata and bytes must form a complete collection-owned set.
func validateRetainedImport(zr *zip.Reader, mf Manifest) error {
	entries := map[string]*zip.File{}
	for _, f := range zr.File {
		if path.Clean(f.Name) != f.Name || strings.HasPrefix(f.Name, "/") || strings.ContainsAny(f.Name, "\\\x00") {
			return fmt.Errorf("invalid archive path %q", f.Name)
		}
		if _, exists := entries[f.Name]; exists {
			return fmt.Errorf("duplicate archive entry %q", f.Name)
		}
		entries[f.Name] = f
	}
	_, recordsPresent := entries["dispositions.json"]
	_, filesPresent := entries["disposition_attachments.json"]
	if recordsPresent != filesPresent {
		return fmt.Errorf("incomplete disposition tables")
	}
	records, err := readTableJSON(zr, "dispositions.json")
	if err != nil {
		return err
	}
	files, err := readTableJSON(zr, "disposition_attachments.json")
	if err != nil {
		return err
	}
	for name, count := range map[string]int{"dispositions": len(records), "disposition_attachments": len(files), "retained_evidence_files": len(files)} {
		if expected, ok := mf.Counts[name]; ok && expected != count {
			return fmt.Errorf("manifest count mismatch for %s", name)
		}
	}
	ids := map[string]bool{}
	for _, row := range records {
		id, ok := row["id"].(string)
		if !ok || !canonicalUUID(id) || ids[id] {
			return fmt.Errorf("invalid or duplicate disposition ID")
		}
		if row["group_id"] != mf.GroupID.String() {
			return fmt.Errorf("disposition belongs to another collection")
		}
		ids[id] = true
	}
	fileIDs := map[string]bool{}
	photos := map[string]bool{}
	for _, row := range files {
		id, ok := row["id"].(string)
		record, recordOK := row["disposition_id"].(string)
		if !ok || !canonicalUUID(id) || fileIDs[id] || !recordOK || !ids[record] {
			return fmt.Errorf("invalid retained file ID or disposition reference")
		}
		if row["type"] != "photo" && row["type"] != "receipt" {
			return fmt.Errorf("invalid retained file type")
		}
		if row["type"] == "photo" {
			if photos[record] {
				return fmt.Errorf("duplicate retained primary photo")
			}
			photos[record] = true
		}
		// Validate source ownership before generating any destination key.
		if err := validateRetainedPath(row, mf.GroupID); err != nil {
			return err
		}
		if entries[retainedEvidenceDir+id] == nil {
			return fmt.Errorf("missing required retained evidence %s", id)
		}
		fileIDs[id] = true
	}
	for name, f := range entries {
		if strings.HasPrefix(name, retainedEvidenceDir) && (f.FileInfo().IsDir() || !fileIDs[strings.TrimPrefix(name, retainedEvidenceDir)]) {
			return fmt.Errorf("unmatched retained evidence %q", name)
		}
	}
	return nil
}

func canonicalUUID(s string) bool {
	id, err := uuid.Parse(s)
	return err == nil && id != uuid.Nil && id.String() == s
}

func validateRetainedPath(row map[string]any, src uuid.UUID) error {
	key, ok := row["path"].(string)
	prefix := src.String() + "/dispositions/"
	if !ok || !strings.HasPrefix(key, prefix) || key == prefix || path.Clean(key) != key || strings.ContainsAny(key, "\\\x00") {
		return fmt.Errorf("invalid collection-owned retained evidence path %q", key)
	}
	return nil
}

func rewriteRetainedPath(row map[string]any, src, dst uuid.UUID) error {
	if err := validateRetainedPath(row, src); err != nil {
		return err
	}
	// Never reuse source keys on a same-server import. Record/file IDs are also
	// regenerated, but this key is deliberately independent of either ID.
	row["path"] = dst.String() + "/dispositions/" + uuid.NewString()
	return nil
}

// Query through the open transaction, not Ent's separate connection. Metadata
// remains invisible until every required byte has been successfully written.
func (s *ExportService) stageRetainedImport(ctx context.Context, tx *sql.Tx, zr *zip.Reader, ids map[string]string) ([]string, error) {
	bucket, err := blob.OpenBucket(ctx, s.repos.Attachments.GetConnString())
	if err != nil {
		return nil, err
	}
	defer bucket.Close()
	var staged []string
	for _, f := range zr.File {
		if !strings.HasPrefix(f.Name, retainedEvidenceDir) {
			continue
		}
		id, ok := ids[strings.TrimPrefix(f.Name, retainedEvidenceDir)]
		if !ok {
			return staged, fmt.Errorf("unmatched retained evidence %s", f.Name)
		}
		var key, mime string
		q := "SELECT path, mime_type FROM disposition_attachments WHERE id = " + placeholder(s.dialect, 1)
		if err := tx.QueryRowContext(ctx, q, id).Scan(&key, &mime); err != nil {
			return staged, err
		}
		staged = append(staged, key) // also clean a writer which fails during Close
		r, err := f.Open()
		if err != nil {
			return staged, err
		}
		w, err := bucket.NewWriter(ctx, s.repos.Attachments.GetFullPath(key), &blob.WriterOptions{ContentType: mime})
		if err != nil {
			_ = r.Close()
			return staged, err
		}
		_, copyErr := io.Copy(w, r)
		closeErr := w.Close()
		readCloseErr := r.Close()
		if copyErr != nil {
			return staged, copyErr
		}
		if closeErr != nil {
			return staged, closeErr
		}
		if readCloseErr != nil {
			return staged, readCloseErr
		}
	}
	return staged, nil
}

// Keep post-commit compensation atomic, including independent history rows.
func (s *ExportService) rollbackImportedRows(ctx context.Context, gid uuid.UUID) error {
	tx, err := s.db.Sql().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := wipeGroup(ctx, tx, s.dialect, gid); err != nil {
		return err
	}
	return tx.Commit()
}
