ALTER TABLE authored_quotations ADD COLUMN source_file_id TEXT NOT NULL DEFAULT '';
ALTER TABLE authored_quotations ADD COLUMN source_file_name TEXT NOT NULL DEFAULT '';
ALTER TABLE authored_quotations ADD COLUMN source_file_type TEXT NOT NULL DEFAULT '';
