CREATE TABLE `sales_campaign_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer NOT NULL,
	`organization` text NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`assigned_member_id` integer,
	`activity_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_campaign_targets_campaign_org_idx` ON `sales_campaign_targets` (`campaign_id`,`organization`);--> statement-breakpoint
CREATE TABLE `sales_campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_campaigns_name_idx` ON `sales_campaigns` (`name`);