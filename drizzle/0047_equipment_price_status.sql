ALTER TABLE `equipment_items` ADD `price_status` text DEFAULT '금액 미입력' NOT NULL;--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `created_by` integer;--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `updated_by` integer;--> statement-breakpoint
UPDATE `equipment_items`
SET `price_status` = '입력 완료'
WHERE COALESCE(`catalog_unit_price`, 0) > 0;
