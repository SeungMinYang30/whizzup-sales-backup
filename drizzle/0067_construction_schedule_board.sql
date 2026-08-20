ALTER TABLE `organization_schedules` ADD `category` text DEFAULT 'general' NOT NULL;
--> statement-breakpoint
ALTER TABLE `organization_schedules` ADD `stage` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `organization_schedules` ADD `end_date` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `organization_schedules` ADD `vendor_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `organization_schedules` ADD `details` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `construction_schedule_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization` text NOT NULL,
	`business_round` integer DEFAULT 1 NOT NULL,
	`work_summary` text DEFAULT '' NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`created_by` integer,
	`created_by_name` text DEFAULT '' NOT NULL,
	`updated_by` integer,
	`updated_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `construction_schedule_projects_scope_idx`
	ON `construction_schedule_projects` (`organization`, `business_round`);
--> statement-breakpoint
PRAGMA optimize;
