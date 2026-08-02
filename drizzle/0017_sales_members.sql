ALTER TABLE `members` ADD `is_sales` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `members_sales_idx`
ON `members` (`status`, `is_sales`, `display_name`);
