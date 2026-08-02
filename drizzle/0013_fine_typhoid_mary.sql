CREATE TABLE `activity_review_acknowledgements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`activity_id` integer NOT NULL,
	`issue_signature` text NOT NULL,
	`snoozed_until` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_review_ack_member_activity_idx` ON `activity_review_acknowledgements` (`member_id`,`activity_id`);