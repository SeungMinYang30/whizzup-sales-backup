CREATE TABLE IF NOT EXISTS `deletion_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`snapshot_json` text NOT NULL,
	`stored_bytes` integer DEFAULT 0 NOT NULL,
	`deleted_by_member_id` integer NOT NULL,
	`deleted_by_name` text DEFAULT '' NOT NULL,
	`deleted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`restored_at` text,
	`restored_by_member_id` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `deletion_batches_active_idx` ON `deletion_batches` (`restored_at`,`expires_at`,`deleted_at`);
