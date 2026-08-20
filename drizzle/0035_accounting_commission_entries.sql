CREATE TABLE IF NOT EXISTS `accounting_commission_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `activity_id` integer NOT NULL,
  `manufacturer_key` text NOT NULL,
  `manufacturer_name` text NOT NULL,
  `commission_sales_amount` integer,
  `revenue_recognition_date` text,
  `invoice_status` text DEFAULT '미발행' NOT NULL,
  `invoice_date` text,
  `commission_collected_amount` integer DEFAULT 0 NOT NULL,
  `collection_date` text,
  `direct_cost` integer DEFAULT 0 NOT NULL,
  `consortium_settlement_confirmed` integer,
  `consortium_paid_amount` integer DEFAULT 0 NOT NULL,
  `consortium_paid_date` text,
  `receivable_balance` integer DEFAULT 0 NOT NULL,
  `consortium_payable` integer DEFAULT 0 NOT NULL,
  `contribution_margin` integer,
  `accounting_status` text DEFAULT '확인 필요' NOT NULL,
  `voucher_note` text DEFAULT '' NOT NULL,
  `confirmed` integer DEFAULT 0 NOT NULL,
  `legacy_source_settlement_id` integer,
  `updated_by` integer DEFAULT 0 NOT NULL,
  `updated_by_name` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `accounting_commission_entries_activity_manufacturer_unique`
ON `accounting_commission_entries` (`activity_id`, `manufacturer_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `accounting_commission_entries_legacy_unique`
ON `accounting_commission_entries` (`legacy_source_settlement_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `accounting_commission_entries_activity_idx`
ON `accounting_commission_entries` (`activity_id`, `manufacturer_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `accounting_commission_entries_period_idx`
ON `accounting_commission_entries` (`revenue_recognition_date`, `accounting_status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `accounting_commission_entry_history` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `entry_id` integer NOT NULL,
  `activity_id` integer NOT NULL,
  `snapshot_json` text NOT NULL,
  `changed_fields_json` text DEFAULT '[]' NOT NULL,
  `changed_by` integer NOT NULL,
  `changed_by_name` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `accounting_commission_history_entry_idx`
ON `accounting_commission_entry_history` (`entry_id`, `created_at`);
