CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seed_key` text,
	`activity_date` text,
	`date_confidence` text DEFAULT '확정' NOT NULL,
	`activity_type` text NOT NULL,
	`category` text DEFAULT '외부' NOT NULL,
	`organization` text NOT NULL,
	`topic` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT '진행 중' NOT NULL,
	`temperature` text DEFAULT '중간' NOT NULL,
	`follow_up_required` integer DEFAULT true NOT NULL,
	`follow_up_date` text,
	`next_action` text DEFAULT '' NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`contact_phone` text DEFAULT '' NOT NULL,
	`contact_email` text DEFAULT '' NOT NULL,
	`source_chat` text DEFAULT 'ChatGPT 전체 내보내기' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activities_seed_key_unique` ON `activities` (`seed_key`);