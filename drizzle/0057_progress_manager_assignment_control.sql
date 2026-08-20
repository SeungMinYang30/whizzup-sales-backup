ALTER TABLE activities
ADD COLUMN progress_manager_locked INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS activities_progress_manager_lock_idx
ON activities (organization, business_round, progress_manager_locked, updated_at, id);
