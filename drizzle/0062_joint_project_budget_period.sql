ALTER TABLE `joint_projects` ADD `project_year` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `joint_projects` ADD `joint_round` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE INDEX `joint_projects_budget_period_idx` ON `joint_projects` (`budget_group_id`,`project_year`,`joint_round`,`status`);
