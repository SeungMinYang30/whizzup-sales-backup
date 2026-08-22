CREATE TABLE IF NOT EXISTS site_layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_uuid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 3,
  draft_json TEXT NOT NULL DEFAULT '{}',
  edit_version INTEGER NOT NULL DEFAULT 1,
  current_revision_id INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  drive_folder_id TEXT NOT NULL DEFAULT '',
  drive_json_file_id TEXT NOT NULL DEFAULT '',
  drive_json_name TEXT NOT NULL DEFAULT '',
  drive_pdf_file_id TEXT NOT NULL DEFAULT '',
  drive_pdf_name TEXT NOT NULL DEFAULT '',
  drive_sync_status TEXT NOT NULL DEFAULT 'queued',
  drive_sync_error TEXT NOT NULL DEFAULT '',
  drive_sync_token TEXT NOT NULL DEFAULT '',
  deleted_at TEXT NOT NULL DEFAULT '',
  deleted_by INTEGER NOT NULL DEFAULT 0,
  deleted_by_name TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  updated_by INTEGER NOT NULL,
  updated_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS site_layouts_updated_idx
  ON site_layouts (deleted_at, updated_at, id);

CREATE TABLE IF NOT EXISTS site_layout_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_layout_id INTEGER NOT NULL,
  revision_number INTEGER NOT NULL,
  parent_revision_id INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 3,
  draft_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL DEFAULT '',
  change_summary TEXT NOT NULL DEFAULT '',
  drive_folder_id TEXT NOT NULL DEFAULT '',
  drive_json_file_id TEXT NOT NULL DEFAULT '',
  drive_json_name TEXT NOT NULL DEFAULT '',
  drive_pdf_file_id TEXT NOT NULL DEFAULT '',
  drive_pdf_name TEXT NOT NULL DEFAULT '',
  drive_sync_status TEXT NOT NULL DEFAULT 'queued',
  drive_sync_error TEXT NOT NULL DEFAULT '',
  drive_sync_token TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS site_layout_revisions_number_idx
  ON site_layout_revisions (site_layout_id, revision_number);
CREATE INDEX IF NOT EXISTS site_layout_revisions_created_idx
  ON site_layout_revisions (site_layout_id, created_at, id);
