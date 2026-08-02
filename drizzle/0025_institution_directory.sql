CREATE TABLE IF NOT EXISTS school_directory_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_last4 TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS official_school_cache (
  cache_key TEXT PRIMARY KEY,
  query_name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  results_json TEXT NOT NULL DEFAULT '[]',
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS official_school_cache_fetched_idx
  ON official_school_cache (fetched_at);

CREATE TABLE IF NOT EXISTS institution_name_decisions (
  pair_key TEXT PRIMARY KEY,
  left_key TEXT NOT NULL,
  right_key TEXT NOT NULL,
  left_organization TEXT NOT NULL,
  right_organization TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('related', 'different')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS institution_name_decisions_left_idx
  ON institution_name_decisions (left_key);

CREATE INDEX IF NOT EXISTS institution_name_decisions_right_idx
  ON institution_name_decisions (right_key);
