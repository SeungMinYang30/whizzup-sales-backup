CREATE TABLE IF NOT EXISTS holdem_weekly_scores (
  member_id INTEGER NOT NULL,
  week_start TEXT NOT NULL,
  best_chips INTEGER NOT NULL DEFAULT 1000,
  games_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (member_id, week_start)
);
