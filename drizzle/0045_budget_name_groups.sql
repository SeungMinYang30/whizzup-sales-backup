CREATE TABLE `budget_name_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`alias_name` text NOT NULL,
	`alias_key` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `budget_name_aliases_group_idx` ON `budget_name_aliases` (`group_id`,`active`);--> statement-breakpoint
CREATE INDEX `budget_name_aliases_active_key_idx` ON `budget_name_aliases` (`alias_key`,`active`);--> statement-breakpoint
CREATE TABLE `budget_name_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer,
	`action` text NOT NULL,
	`snapshot_json` text DEFAULT '{}' NOT NULL,
	`changed_by` integer NOT NULL,
	`changed_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `budget_name_events_group_idx` ON `budget_name_events` (`group_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `budget_name_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonical_name` text NOT NULL,
	`canonical_key` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` integer NOT NULL,
	`created_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `budget_name_groups_active_key_idx` ON `budget_name_groups` (`canonical_key`,`active`);--> statement-breakpoint
CREATE TABLE `budget_name_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`original_name` text DEFAULT '' NOT NULL,
	`alias_key` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`linked_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`unlinked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_name_members_entity_idx` ON `budget_name_members` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `budget_name_members_group_idx` ON `budget_name_members` (`group_id`,`active`);
