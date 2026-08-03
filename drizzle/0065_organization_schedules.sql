CREATE TABLE IF NOT EXISTS `organization_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization` text NOT NULL,
	`business_round` integer DEFAULT 1 NOT NULL,
	`label` text NOT NULL,
	`scheduled_date` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`source_activity_id` integer,
	`created_by` integer,
	`created_by_name` text DEFAULT '' NOT NULL,
	`updated_by` integer,
	`updated_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organization_schedules_scope_date_idx`
	ON `organization_schedules` (`organization`, `business_round`, `completed`, `scheduled_date`, `id`);
