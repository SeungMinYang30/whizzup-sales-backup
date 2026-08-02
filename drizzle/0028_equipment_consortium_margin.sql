ALTER TABLE `equipment_items` ADD `execution_type` text DEFAULT '직영' NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `commission_input_type` text DEFAULT 'rate' NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `commission_rate` real;
--> statement-breakpoint
ALTER TABLE `equipment_items` ADD `consortium_payment_amount` integer;
