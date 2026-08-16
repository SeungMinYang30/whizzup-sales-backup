ALTER TABLE equipment_projects ADD COLUMN budget_amount TEXT;
--> statement-breakpoint
ALTER TABLE equipment_projects ADD COLUMN budget_amount_source TEXT NOT NULL DEFAULT 'missing';
