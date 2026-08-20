CREATE TABLE `inventory_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`specification` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT '대' NOT NULL,
	`current_stock` integer DEFAULT 0 NOT NULL,
	`low_stock_threshold` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_by_name` text DEFAULT '' NOT NULL,
	`updated_by` integer,
	`updated_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_products_name_idx` ON `inventory_products` (`name`);
--> statement-breakpoint
CREATE TABLE `inventory_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`transaction_type` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	`resulting_stock` integer NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`transaction_date` text NOT NULL,
	`created_by` integer,
	`created_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inventory_transactions_product_date_idx` ON `inventory_transactions` (`product_id`,`transaction_date`,`id`);
--> statement-breakpoint
CREATE INDEX `inventory_transactions_date_idx` ON `inventory_transactions` (`transaction_date`,`id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `inventory_products`
  (`name`, `specification`, `unit`, `low_stock_threshold`)
VALUES
  ('3D모션', '3D 모션 스포츠 장비', '대', 1),
  ('터치테이블', '터치형 테이블 장비', '대', 1);
--> statement-breakpoint
PRAGMA optimize;
