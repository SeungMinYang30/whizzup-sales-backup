ALTER TABLE `equipment_items` ADD `catalog_item_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `catalog_unit_price` integer;
--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `catalog_note` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `protection_status` text DEFAULT '신청 필요' NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `protection_completed_at` text;
