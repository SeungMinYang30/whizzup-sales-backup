-- Repair production environments where the direct-auth SQL files were
-- packaged but omitted from Drizzle's migration journal.
CREATE TABLE IF NOT EXISTS `member_credentials` (
  `member_id` integer PRIMARY KEY NOT NULL,
  `password_hash` text NOT NULL,
  `password_salt` text NOT NULL,
  `password_iterations` integer DEFAULT 100000 NOT NULL,
  `password_set_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `failed_attempts` integer DEFAULT 0 NOT NULL,
  `locked_until` text,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `member_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `member_id` integer NOT NULL,
  `expires_at` text NOT NULL,
  `remember_me` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `member_sessions_member_idx`
  ON `member_sessions` (`member_id`, `expires_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `member_password_reset_requests` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `member_id` integer,
  `email` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `resolved_at` text,
  `resolved_by` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `member_password_reset_status_idx`
  ON `member_password_reset_requests` (`status`, `requested_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `member_rejections` (
  `email` text PRIMARY KEY NOT NULL,
  `rejected_by` integer,
  `rejected_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
