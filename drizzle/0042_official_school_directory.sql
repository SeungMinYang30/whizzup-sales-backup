CREATE TABLE IF NOT EXISTS `official_school_directory` (
  `school_code` text PRIMARY KEY NOT NULL,
  `office_code` text DEFAULT '' NOT NULL,
  `name` text NOT NULL,
  `name_key` text NOT NULL,
  `kind` text DEFAULT '' NOT NULL,
  `region` text DEFAULT '' NOT NULL,
  `region_key` text DEFAULT '' NOT NULL,
  `address` text DEFAULT '' NOT NULL,
  `address_key` text DEFAULT '' NOT NULL,
  `phone` text DEFAULT '' NOT NULL,
  `coeducation` text DEFAULT '' NOT NULL,
  `fetched_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `official_school_directory_name_idx`
  ON `official_school_directory` (`name_key`, `region_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `official_school_directory_region_idx`
  ON `official_school_directory` (`region_key`, `name_key`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_school_links` (
  `link_key` text PRIMARY KEY NOT NULL,
  `organization` text NOT NULL,
  `organization_key` text NOT NULL,
  `context_key` text DEFAULT '' NOT NULL,
  `school_code` text NOT NULL,
  `match_source` text DEFAULT 'official-directory' NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organization_school_links_org_idx`
  ON `organization_school_links` (`organization_key`, `context_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organization_school_links_school_idx`
  ON `organization_school_links` (`school_code`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `official_school_sync_state` (
  `id` integer PRIMARY KEY NOT NULL,
  `total_count` integer DEFAULT 0 NOT NULL,
  `last_page` integer DEFAULT 0 NOT NULL,
  `last_synced_at` text DEFAULT '' NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
DELETE FROM `official_school_cache`
WHERE `results_json` = '[]' OR `cache_key` NOT LIKE 'v2|%';
