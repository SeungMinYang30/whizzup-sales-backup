CREATE TABLE IF NOT EXISTS `accounting_settlement_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`settlement_id` integer NOT NULL,
	`activity_id` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`changed_fields_json` text DEFAULT '[]' NOT NULL,
	`changed_by` integer NOT NULL,
	`changed_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `accounting_history_activity_idx` ON `accounting_settlement_history` (`activity_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `accounting_settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`activity_id` integer NOT NULL,
	`confirmed_contract_amount` integer,
	`deposit_amount` integer DEFAULT 0 NOT NULL,
	`interim_amount` integer DEFAULT 0 NOT NULL,
	`balance_amount` integer DEFAULT 0 NOT NULL,
	`paid_amount` integer DEFAULT 0 NOT NULL,
	`actual_cost` integer,
	`confirmed_commission` integer,
	`confirmed_margin` integer,
	`recognized_date` text,
	`invoice_status` text DEFAULT '미발행' NOT NULL,
	`invoice_date` text,
	`settlement_status` text DEFAULT '확인 필요' NOT NULL,
	`accounting_note` text DEFAULT '' NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`updated_by` integer NOT NULL,
	`updated_by_name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `accounting_settlements_activity_id_unique` ON `accounting_settlements` (`activity_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `accounting_settlements_recognized_idx` ON `accounting_settlements` (`recognized_date`,`settlement_status`);
