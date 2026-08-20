ALTER TABLE `authored_quotations` ADD `deleted_at` text DEFAULT '' NOT NULL;
ALTER TABLE `authored_quotations` ADD `deleted_by` integer DEFAULT 0 NOT NULL;
ALTER TABLE `authored_quotations` ADD `deleted_by_name` text DEFAULT '' NOT NULL;
CREATE INDEX IF NOT EXISTS `authored_quotations_deleted_idx`
  ON `authored_quotations` (`deleted_at`, `quote_date`, `id`);
PRAGMA optimize;
