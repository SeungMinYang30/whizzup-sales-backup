CREATE TABLE IF NOT EXISTS `quotation_documents` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `organization` text NOT NULL,
  `company_name` text DEFAULT '' NOT NULL,
  `quote_amount` text DEFAULT '' NOT NULL,
  `quote_date` text DEFAULT '' NOT NULL,
  `original_name` text NOT NULL,
  `original_key` text NOT NULL,
  `original_size` integer DEFAULT 0 NOT NULL,
  `page_keys_json` text DEFAULT '[]' NOT NULL,
  `page_sizes_json` text DEFAULT '[]' NOT NULL,
  `page_count` integer DEFAULT 0 NOT NULL,
  `total_size` integer DEFAULT 0 NOT NULL,
  `created_by` integer NOT NULL,
  `created_by_name` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `quotation_documents_original_key_unique`
  ON `quotation_documents` (`original_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `quotation_documents_organization_idx`
  ON `quotation_documents` (`organization`, `created_at`);
