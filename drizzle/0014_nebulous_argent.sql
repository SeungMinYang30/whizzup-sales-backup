CREATE TABLE `activity_assignment_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`activity_id` integer NOT NULL,
	`from_manager` text DEFAULT '' NOT NULL,
	`to_member_id` integer NOT NULL,
	`to_manager` text NOT NULL,
	`changed_by_member_id` integer NOT NULL,
	`changed_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_assignment_history_activity_idx` ON `activity_assignment_history` (`activity_id`,`created_at`);