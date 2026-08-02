ALTER TABLE `joint_project_members` ADD `institution_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `joint_project_members_institution_idx` ON `joint_project_members` (`institution_key`,`business_round`,`project_id`);
