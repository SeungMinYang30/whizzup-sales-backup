CREATE TABLE `product_vendor_links` (
	`product_id` text PRIMARY KEY NOT NULL,
	`vendor_id` integer NOT NULL,
	`vendor_name_snapshot` text DEFAULT '' NOT NULL,
	`updated_by` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `product_vendor_links_vendor_idx` ON `product_vendor_links` (`vendor_id`,`product_id`);
--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `supplier_vendor_id` integer;
--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `supplier_vendor_name` text DEFAULT '' NOT NULL;
