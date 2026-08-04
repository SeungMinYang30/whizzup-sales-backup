ALTER TABLE organization_schedules ADD COLUMN google_event_id TEXT NOT NULL DEFAULT '';
ALTER TABLE organization_schedules ADD COLUMN google_event_etag TEXT NOT NULL DEFAULT '';
ALTER TABLE organization_schedules ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE organization_schedules ADD COLUMN sync_operation TEXT NOT NULL DEFAULT 'upsert';
ALTER TABLE organization_schedules ADD COLUMN sync_error TEXT NOT NULL DEFAULT '';
ALTER TABLE organization_schedules ADD COLUMN sync_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organization_schedules ADD COLUMN last_synced_at TEXT NOT NULL DEFAULT '';
ALTER TABLE organization_schedules ADD COLUMN google_updated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE organization_schedules ADD COLUMN deleted_at TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS organization_schedules_sync_idx
ON organization_schedules (sync_status, sync_operation, updated_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS organization_schedules_google_event_idx
ON organization_schedules (google_event_id)
WHERE google_event_id <> '';

PRAGMA optimize;
