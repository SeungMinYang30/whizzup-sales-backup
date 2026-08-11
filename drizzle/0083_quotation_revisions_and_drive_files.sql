ALTER TABLE `authored_quotations` ADD `revision_root_id` integer DEFAULT 0 NOT NULL;
ALTER TABLE `authored_quotations` ADD `revision_parent_id` integer DEFAULT 0 NOT NULL;
ALTER TABLE `authored_quotations` ADD `revision_number` integer DEFAULT 0 NOT NULL;
ALTER TABLE `authored_quotations` ADD `drive_pdf_file_id` text DEFAULT '' NOT NULL;
ALTER TABLE `authored_quotations` ADD `drive_pdf_name` text DEFAULT '' NOT NULL;
ALTER TABLE `authored_quotations` ADD `drive_xlsx_file_id` text DEFAULT '' NOT NULL;
ALTER TABLE `authored_quotations` ADD `drive_xlsx_name` text DEFAULT '' NOT NULL;
ALTER TABLE `authored_quotations` ADD `drive_sync_status` text DEFAULT 'none' NOT NULL;
ALTER TABLE `authored_quotations` ADD `drive_sync_error` text DEFAULT '' NOT NULL;
UPDATE `authored_quotations` SET `revision_root_id` = `id` WHERE `revision_root_id` = 0;
CREATE INDEX IF NOT EXISTS `authored_quotations_revision_idx`
  ON `authored_quotations` (`revision_root_id`, `revision_number`, `id`);
