CREATE TABLE `equipment_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`product_name` text NOT NULL,
	`specification` text DEFAULT '' NOT NULL,
	`proposed_qty` integer DEFAULT 0 NOT NULL,
	`awarded_qty` integer DEFAULT 0 NOT NULL,
	`installed_qty` integer DEFAULT 0 NOT NULL,
	`unit` text DEFAULT '대' NOT NULL,
	`status` text DEFAULT '제안' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `equipment_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT '제안' NOT NULL,
	`budget_type` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_projects_org_name_idx` ON `equipment_projects` (`organization`,`name`);