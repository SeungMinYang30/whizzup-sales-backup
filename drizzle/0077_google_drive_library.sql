CREATE TABLE IF NOT EXISTS `resource_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text DEFAULT '기타' NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_by` integer NOT NULL,
	`created_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text,
	`archived_by` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `resource_posts_active_idx` ON `resource_posts` (`archived_at`,`created_at`,`id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `resource_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`original_name` text NOT NULL,
	`drive_file_id` text NOT NULL,
	`drive_folder_id` text DEFAULT '' NOT NULL,
	`mime_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`created_by` integer NOT NULL,
	`created_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `resource_posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `resource_attachments_drive_file_id_unique` ON `resource_attachments` (`drive_file_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `resource_attachments_post_idx` ON `resource_attachments` (`post_id`,`created_at`,`id`);
