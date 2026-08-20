ALTER TABLE activities ADD COLUMN updated_by_member_id INTEGER;
ALTER TABLE activities ADD COLUMN updated_by_name TEXT NOT NULL DEFAULT '';
