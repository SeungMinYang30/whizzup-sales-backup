ALTER TABLE `equipment_projects` ADD `activity_id` integer;
--> statement-breakpoint
CREATE INDEX `equipment_projects_activity_idx` ON `equipment_projects` (`activity_id`,`updated_at`);
--> statement-breakpoint
ALTER TABLE `accounting_settlements` ADD `manufacturer_commission_expected` integer;
--> statement-breakpoint
ALTER TABLE `accounting_settlements` ADD `manufacturer_commission_received` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `accounting_settlements` ADD `manufacturer_commission_received_date` text;
--> statement-breakpoint
ALTER TABLE `accounting_settlements` ADD `consortium_payment_expected` integer;
--> statement-breakpoint
ALTER TABLE `accounting_settlements` ADD `consortium_payment_paid` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `accounting_settlements` ADD `consortium_payment_date` text;
--> statement-breakpoint
ALTER TABLE `accounting_settlements` ADD `other_cost` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `accounting_settlements` ADD `commission_receivable` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `accounting_settlements` ADD `consortium_payable` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `accounting_settlements` ADD `net_revenue` integer;
--> statement-breakpoint
UPDATE `equipment_projects` AS ep
SET `activity_id` = (
  SELECT a.id
  FROM `activities` a
  WHERE a.organization = ep.organization
    AND a.award_status = '위즈업 수주'
    AND trim(ep.budget_type) <> ''
    AND a.budget_type = ep.budget_type
  ORDER BY a.activity_date DESC, a.id DESC
  LIMIT 1
)
WHERE ep.activity_id IS NULL
  AND trim(ep.budget_type) <> ''
  AND 1 = (
    SELECT COUNT(*)
    FROM `activities` a
    WHERE a.organization = ep.organization
      AND a.award_status = '위즈업 수주'
      AND a.budget_type = ep.budget_type
  );
--> statement-breakpoint
UPDATE `equipment_projects` AS ep
SET `activity_id` = (
  SELECT a.id
  FROM `activities` a
  WHERE a.organization = ep.organization
    AND a.award_status = '위즈업 수주'
  ORDER BY a.activity_date DESC, a.id DESC
  LIMIT 1
)
WHERE ep.activity_id IS NULL
  AND 1 = (
    SELECT COUNT(*)
    FROM `activities` a
    WHERE a.organization = ep.organization
      AND a.award_status = '위즈업 수주'
  );
