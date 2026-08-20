CREATE TABLE IF NOT EXISTS data_control_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0,
  archive_ids_json TEXT NOT NULL DEFAULT '[]',
  actor_member_id INTEGER NOT NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS data_control_events_created_idx
ON data_control_events (created_at DESC, id DESC);
