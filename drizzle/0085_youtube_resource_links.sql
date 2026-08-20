CREATE TABLE IF NOT EXISTS `youtube_resource_links` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `video_id` text NOT NULL,
  `youtube_url` text NOT NULL,
  `title` text DEFAULT '' NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `thumbnail_url` text DEFAULT '' NOT NULL,
  `kind` text DEFAULT 'video' NOT NULL,
  `published_at` text DEFAULT '' NOT NULL,
  `created_by` integer NOT NULL,
  `created_by_name` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `youtube_resource_links_video_idx`
  ON `youtube_resource_links` (`video_id`);
CREATE INDEX IF NOT EXISTS `youtube_resource_links_created_idx`
  ON `youtube_resource_links` (`created_at`, `id`);
PRAGMA optimize;
