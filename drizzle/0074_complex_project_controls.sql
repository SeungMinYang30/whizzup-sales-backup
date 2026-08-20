CREATE TABLE IF NOT EXISTS `complex_projects` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization` text NOT NULL,
  `business_round` integer DEFAULT 1 NOT NULL,
  `name` text NOT NULL,
  `status` text DEFAULT '준비' NOT NULL,
  `total_budget` integer,
  `manager_name` text DEFAULT '' NOT NULL,
  `notes` text DEFAULT '' NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `created_by` integer NOT NULL,
  `created_by_name` text DEFAULT '' NOT NULL,
  `updated_by` integer,
  `updated_by_name` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `complex_project_item_details` (
  `equipment_item_id` integer PRIMARY KEY NOT NULL,
  `complex_project_id` integer NOT NULL,
  `zone_id` integer,
  `item_category` text DEFAULT '기자재' NOT NULL,
  `procurement_method` text DEFAULT '' NOT NULL,
  `procurement_identifier` text DEFAULT '' NOT NULL,
  `delivery_location` text DEFAULT '' NOT NULL,
  `updated_by` integer,
  `updated_by_name` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `complex_projects` ADD `manager_member_id` integer;
--> statement-breakpoint
ALTER TABLE `complex_project_item_details` ADD `selection_round` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `complex_project_item_details` ADD `selection_status` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `complex_project_item_details` ADD `change_reason` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `complex_project_item_details` ADD `electrical_requirements` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `complex_project_item_details` ADD `network_requirements` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `complex_project_item_details` ADD `protection_vendor_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `complex_project_item_details` ADD `protection_state` text DEFAULT '신청 필요' NOT NULL;
--> statement-breakpoint
ALTER TABLE `complex_project_item_details` ADD `protection_expires_at` text DEFAULT '' NOT NULL;
