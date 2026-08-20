CREATE TABLE `activity_change_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text DEFAULT 'awards' NOT NULL,
	`operation_label` text DEFAULT '' NOT NULL,
	`operation_total` integer DEFAULT 0 NOT NULL,
	`requested_fields_json` text DEFAULT '[]' NOT NULL,
	`actor_member_id` integer NOT NULL,
	`actor_name` text DEFAULT '' NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`undone_at` text,
	`undone_by_member_id` integer,
	`undone_by_name` text DEFAULT '' NOT NULL,
	`undo_result_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_change_batches_scope_created_idx` ON `activity_change_batches` (`scope`,`created_at`);--> statement-breakpoint
CREATE TABLE `activity_change_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text NOT NULL,
	`activity_id` integer NOT NULL,
	`organization` text DEFAULT '' NOT NULL,
	`requested_fields_json` text DEFAULT '[]' NOT NULL,
	`changed_fields_json` text DEFAULT '[]' NOT NULL,
	`before_json` text DEFAULT '{}' NOT NULL,
	`after_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`undone_at` text,
	`undone_by_member_id` integer,
	`undone_by_name` text DEFAULT '' NOT NULL,
	`undo_status` text DEFAULT 'pending' NOT NULL,
	`undo_result_json` text DEFAULT '{}' NOT NULL,
	CONSTRAINT `activity_change_items_batch_activity_unique` UNIQUE(`batch_id`,`activity_id`)
);
--> statement-breakpoint
CREATE INDEX `activity_change_items_batch_idx` ON `activity_change_items` (`batch_id`,`id`);
