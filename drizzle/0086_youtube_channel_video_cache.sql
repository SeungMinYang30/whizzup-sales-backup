CREATE TABLE IF NOT EXISTS `youtube_channel_videos` (
  `video_id` text PRIMARY KEY NOT NULL,
  `title` text DEFAULT '' NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `thumbnail_url` text DEFAULT '' NOT NULL,
  `youtube_url` text NOT NULL,
  `kind` text DEFAULT 'video' NOT NULL,
  `published_at` text DEFAULT '' NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `sync_source` text DEFAULT '' NOT NULL,
  `last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS `youtube_channel_videos_active_idx`
  ON `youtube_channel_videos` (`active`, `published_at`, `video_id`);
PRAGMA optimize;
