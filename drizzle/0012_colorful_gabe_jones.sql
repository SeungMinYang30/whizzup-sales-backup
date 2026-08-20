CREATE TABLE `manager_alert_acknowledgements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`organization` text NOT NULL,
	`issue_signature` text NOT NULL,
	`snoozed_until` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manager_alert_ack_member_org_idx` ON `manager_alert_acknowledgements` (`member_id`,`organization`);
