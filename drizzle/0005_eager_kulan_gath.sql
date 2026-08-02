ALTER TABLE `activities` ADD `execution_type` text DEFAULT '미정' NOT NULL;--> statement-breakpoint
ALTER TABLE `activities` ADD `consortium_company` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `activities` ADD `award_stage` text DEFAULT '미정' NOT NULL;