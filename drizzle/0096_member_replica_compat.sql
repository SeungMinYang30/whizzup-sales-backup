ALTER TABLE `members` ADD COLUMN `sync_id` text;
ALTER TABLE `members` ADD COLUMN `auth_user_id` text;
ALTER TABLE `members` ADD COLUMN `username` text;

CREATE UNIQUE INDEX IF NOT EXISTS `members_sync_id_unique`
	ON `members` (`sync_id`)
	WHERE `sync_id` IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `members_auth_user_id_unique`
	ON `members` (`auth_user_id`)
	WHERE `auth_user_id` IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `members_username_unique`
	ON `members` (`username`)
	WHERE `username` IS NOT NULL;
