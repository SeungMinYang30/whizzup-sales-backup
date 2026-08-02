ALTER TABLE `activities` ADD `status_manual` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `activities` SET `status_manual` = 1;
