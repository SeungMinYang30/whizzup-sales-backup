CREATE TABLE `joint_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sponsor_organization` text NOT NULL,
	`campaign_id` integer,
	`budget_group_id` integer,
	`budget_type` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `joint_projects_campaign_idx` ON `joint_projects` (`campaign_id`,`status`);
--> statement-breakpoint
CREATE INDEX `joint_projects_sponsor_idx` ON `joint_projects` (`sponsor_organization`,`status`);
--> statement-breakpoint
CREATE TABLE `joint_project_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`organization` text NOT NULL,
	`business_round` integer DEFAULT 1 NOT NULL,
	`role` text DEFAULT 'site' NOT NULL,
	`activity_id` integer,
	`campaign_target_id` integer,
	`budget_amount` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `joint_project_members_project_business_idx` ON `joint_project_members` (`project_id`,`organization`,`business_round`);
--> statement-breakpoint
CREATE INDEX `joint_project_members_business_idx` ON `joint_project_members` (`organization`,`business_round`,`project_id`);
--> statement-breakpoint
CREATE INDEX `joint_project_members_campaign_target_idx` ON `joint_project_members` (`campaign_target_id`);
--> statement-breakpoint
CREATE TABLE `joint_project_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`action` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`changed_by` integer NOT NULL,
	`changed_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `joint_project_events_project_idx` ON `joint_project_events` (`project_id`);
