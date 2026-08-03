ALTER TABLE organization_schedules ADD COLUMN assignee_member_id INTEGER;
ALTER TABLE organization_schedules ADD COLUMN assignee_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS organization_schedules_assignee_idx
ON organization_schedules (assignee_member_id, completed, scheduled_date);
