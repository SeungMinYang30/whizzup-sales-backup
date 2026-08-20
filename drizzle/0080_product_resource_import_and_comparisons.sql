CREATE TABLE IF NOT EXISTS `product_comparison_documents` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `equipment_item_id` integer DEFAULT 0 NOT NULL,
  `catalog_product_id` text DEFAULT '' NOT NULL,
  `product_name` text DEFAULT '' NOT NULL,
  `original_name` text NOT NULL,
  `drive_file_id` text NOT NULL UNIQUE,
  `drive_folder_id` text DEFAULT '' NOT NULL,
  `mime_type` text DEFAULT '' NOT NULL,
  `size_bytes` integer DEFAULT 0 NOT NULL,
  `created_by` integer,
  `created_by_name` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `archived_at` text
);
