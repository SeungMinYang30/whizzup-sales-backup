ALTER TABLE members ADD COLUMN job_title TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS member_credentials (
  member_id INTEGER PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  password_set_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_sessions (
  token_hash TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  remember_me INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS member_sessions_member_idx
  ON member_sessions (member_id, expires_at);

CREATE TABLE IF NOT EXISTS member_password_reset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by INTEGER
);

CREATE INDEX IF NOT EXISTS member_password_reset_status_idx
  ON member_password_reset_requests (status, requested_at);
