CREATE TABLE IF NOT EXISTS `accounting_collection_receipts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `entry_id` integer NOT NULL,
  `activity_id` integer NOT NULL,
  `amount` integer NOT NULL,
  `collection_date` text NOT NULL,
  `note` text DEFAULT '' NOT NULL,
  `legacy_source_entry_id` integer,
  `created_by` integer DEFAULT 0 NOT NULL,
  `created_by_name` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `accounting_collection_receipts_legacy_unique`
ON `accounting_collection_receipts` (`legacy_source_entry_id`);

CREATE INDEX IF NOT EXISTS `accounting_collection_receipts_entry_idx`
ON `accounting_collection_receipts` (`entry_id`, `collection_date`, `id`);

CREATE INDEX IF NOT EXISTS `accounting_collection_receipts_activity_idx`
ON `accounting_collection_receipts` (`activity_id`, `collection_date`);
