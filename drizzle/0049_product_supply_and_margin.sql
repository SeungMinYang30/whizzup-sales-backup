CREATE TABLE `product_supply_settings` (
	`product_id` text PRIMARY KEY NOT NULL,
	`supply_type` text DEFAULT 'partner' NOT NULL,
	`margin_rate` real,
	`updated_by` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `product_supply_settings_type_idx` ON `product_supply_settings` (`supply_type`,`product_id`);--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `supply_type` text DEFAULT 'partner' NOT NULL;--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `margin_rate` real;--> statement-breakpoint
INSERT OR IGNORE INTO `product_supply_settings` (
	`product_id`, `supply_type`, `margin_rate`, `updated_by`
) VALUES ('quote-62', 'direct', 0.5545454545454546, 0);--> statement-breakpoint
DELETE FROM `product_vendor_links` WHERE `product_id` = 'quote-62';--> statement-breakpoint
UPDATE `equipment_items`
SET `supply_type` = 'direct',
	`margin_rate` = 0.5545454545454546,
	`commission_rate` = NULL,
	`supplier_vendor_id` = NULL,
	`supplier_vendor_name` = '',
	`updated_at` = CURRENT_TIMESTAMP
WHERE `catalog_item_id` = 'quote-62'
	AND `status` IN ('제안 예정', '제안', '견적');
