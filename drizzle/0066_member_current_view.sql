ALTER TABLE `members` ADD `current_view` text DEFAULT '' NOT NULL;
--> statement-breakpoint
PRAGMA optimize;
