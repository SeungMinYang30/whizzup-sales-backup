ALTER TABLE `sales_campaigns` ADD `budget_type` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `sales_campaigns` ADD `budget_group_id` integer;
--> statement-breakpoint
ALTER TABLE `sales_campaigns` ADD `budget_match_status` text DEFAULT 'unclassified' NOT NULL;
--> statement-breakpoint
ALTER TABLE `sales_campaigns` ADD `budget_match_method` text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE `sales_campaigns` ADD `budget_request_id` text;
--> statement-breakpoint
ALTER TABLE `sales_campaigns` ADD `budget_kind` text DEFAULT 'unclassified' NOT NULL;
--> statement-breakpoint
ALTER TABLE `sales_campaigns` ADD `budget_amount_mode` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `sales_campaigns` ADD `selection_date` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `sales_campaigns` ADD `default_budget_amount` integer;
--> statement-breakpoint
ALTER TABLE `sales_campaigns` ADD `source_file_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `sales_campaigns` ADD `import_source` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `sales_campaign_targets` ADD `budget_amount` integer;
--> statement-breakpoint
ALTER TABLE `sales_campaign_targets` ADD `school_level` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `sales_campaign_targets` ADD `supply_items` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `sales_campaign_targets` ADD `review_note` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `sales_campaign_targets` ADD `business_round` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `sales_campaign_targets` ADD `created_activity` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE INDEX `sales_campaign_targets_org_round_campaign_idx`
  ON `sales_campaign_targets` (`organization`,`business_round`,`campaign_id`);
--> statement-breakpoint
UPDATE `sales_campaign_targets`
SET `business_round` = COALESCE(
  (
    SELECT `business_round`
    FROM `activities`
    WHERE `activities`.`id` = `sales_campaign_targets`.`activity_id`
  ),
  1
);
--> statement-breakpoint
UPDATE `sales_campaigns`
SET
  `budget_type` = COALESCE(
    (
      SELECT `a`.`budget_type`
      FROM `sales_campaign_targets` `t`
      JOIN `activities` `a` ON `a`.`id` = `t`.`activity_id`
      WHERE `t`.`campaign_id` = `sales_campaigns`.`id`
        AND TRIM(COALESCE(`a`.`budget_type`, '')) <> ''
      ORDER BY `a`.`activity_date` DESC, `a`.`id` DESC
      LIMIT 1
    ),
    ''
  ),
  `selection_date` = COALESCE(
    (
      SELECT `a`.`activity_date`
      FROM `sales_campaign_targets` `t`
      JOIN `activities` `a` ON `a`.`id` = `t`.`activity_id`
      WHERE `t`.`campaign_id` = `sales_campaigns`.`id`
      ORDER BY `a`.`activity_date` DESC, `a`.`id` DESC
      LIMIT 1
    ),
    ''
  );
