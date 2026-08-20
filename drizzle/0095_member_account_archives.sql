CREATE TABLE IF NOT EXISTS `member_account_archives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_member_id` integer NOT NULL,
	`member_json` text NOT NULL,
	`archived_by` integer NOT NULL,
	`archived_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS `member_account_archives_original_member_idx`
	ON `member_account_archives` (`original_member_id`, `archived_at`);
