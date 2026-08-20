ALTER TABLE `budget_name_groups` ADD `budget_kind` text DEFAULT 'unclassified' NOT NULL;
--> statement-breakpoint
ALTER TABLE `budget_name_groups` ADD `amount_mode` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `budget_name_groups` ADD `sort_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `budget_name_groups` ADD `updated_by` integer;
--> statement-breakpoint
ALTER TABLE `budget_name_groups` ADD `updated_by_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `budget_name_groups` ADD `disabled_at` text;
--> statement-breakpoint
ALTER TABLE `budget_name_aliases` ADD `created_by` integer;
--> statement-breakpoint
ALTER TABLE `budget_name_aliases` ADD `created_by_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `budget_name_aliases` ADD `disabled_at` text;
--> statement-breakpoint
ALTER TABLE `budget_name_events` ADD `request_id` text;
--> statement-breakpoint
ALTER TABLE `budget_name_events` ADD `batch_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `budget_name_events_request_idx`
  ON `budget_name_events` (`request_id`,`created_at`);
--> statement-breakpoint

ALTER TABLE `activities` ADD `budget_original_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activities` ADD `budget_group_id` integer;
--> statement-breakpoint
ALTER TABLE `activities` ADD `budget_match_status` text DEFAULT 'unclassified' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activities` ADD `budget_match_method` text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activities` ADD `budget_request_id` text;
--> statement-breakpoint
ALTER TABLE `activities` ADD `budget_kind` text DEFAULT 'unclassified' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activities` ADD `budget_amount_mode` text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activities` ADD `budget_amount_override` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE INDEX `activities_budget_group_idx`
  ON `activities` (`budget_group_id`,`award_status`,`activity_date`,`id`);
--> statement-breakpoint
CREATE INDEX `activities_budget_request_idx`
  ON `activities` (`budget_request_id`,`id`);
--> statement-breakpoint

ALTER TABLE `equipment_projects` ADD `budget_original_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment_projects` ADD `budget_group_id` integer;
--> statement-breakpoint
ALTER TABLE `equipment_projects` ADD `budget_match_status` text DEFAULT 'unclassified' NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment_projects` ADD `budget_match_method` text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment_projects` ADD `budget_request_id` text;
--> statement-breakpoint
ALTER TABLE `equipment_projects` ADD `budget_kind` text DEFAULT 'unclassified' NOT NULL;
--> statement-breakpoint
CREATE INDEX `equipment_projects_budget_group_idx`
  ON `equipment_projects` (`budget_group_id`,`activity_id`,`id`);
--> statement-breakpoint

CREATE TABLE `budget_name_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `requested_name` text NOT NULL,
  `requested_key` text NOT NULL,
  `expected_budget_kind` text DEFAULT 'unclassified' NOT NULL,
  `reason` text DEFAULT '' NOT NULL,
  `organization` text DEFAULT '' NOT NULL,
  `requester_member_id` integer NOT NULL,
  `requester_name` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `resolved_group_id` integer,
  `resolution_type` text DEFAULT '' NOT NULL,
  `decision_reason` text DEFAULT '' NOT NULL,
  `decided_by` integer,
  `decided_by_name` text DEFAULT '' NOT NULL,
  `decided_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `budget_name_requests_status_key_idx`
  ON `budget_name_requests` (`status`,`requested_key`,`created_at`);
--> statement-breakpoint
CREATE INDEX `budget_name_requests_requester_idx`
  ON `budget_name_requests` (`requester_member_id`,`created_at`);
--> statement-breakpoint

CREATE TABLE `budget_name_request_records` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `request_id` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` integer NOT NULL,
  `original_name` text DEFAULT '' NOT NULL,
  `organization` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT `budget_name_request_records_entity_unique`
    UNIQUE(`request_id`,`entity_type`,`entity_id`)
);
--> statement-breakpoint
CREATE INDEX `budget_name_request_records_request_idx`
  ON `budget_name_request_records` (`request_id`,`id`);
--> statement-breakpoint
CREATE INDEX `budget_name_request_records_entity_idx`
  ON `budget_name_request_records` (`entity_type`,`entity_id`);
--> statement-breakpoint

UPDATE `activities`
SET `budget_original_name` = `budget_type`
WHERE trim(`budget_original_name`) = '' AND trim(`budget_type`) <> '';
--> statement-breakpoint
UPDATE `equipment_projects`
SET `budget_original_name` = `budget_type`
WHERE trim(`budget_original_name`) = '' AND trim(`budget_type`) <> '';
--> statement-breakpoint

UPDATE `budget_name_groups`
SET `budget_kind` = 'self',
    `amount_mode` = 'quote_auto',
    `updated_by_name` = CASE
      WHEN trim(`updated_by_name`) = '' THEN '시스템'
      ELSE `updated_by_name`
    END
WHERE `active` = 1
  AND (
    `canonical_key` = '자체예산'
    OR `id` IN (
      SELECT `group_id`
      FROM `budget_name_aliases`
      WHERE `active` = 1 AND `alias_key` = '자체예산'
    )
  );
--> statement-breakpoint
INSERT INTO `budget_name_groups` (
  `canonical_name`, `canonical_key`, `active`, `budget_kind`, `amount_mode`,
  `sort_order`, `created_by`, `created_by_name`, `updated_by_name`
)
SELECT '자체예산', '자체예산', 1, 'self', 'quote_auto', -100, 0, '시스템', '시스템'
WHERE NOT EXISTS (
  SELECT 1
  FROM `budget_name_groups`
  WHERE `active` = 1 AND `canonical_key` = '자체예산'
)
AND NOT EXISTS (
  SELECT 1
  FROM `budget_name_aliases`
  WHERE `active` = 1 AND `alias_key` = '자체예산'
);
--> statement-breakpoint
INSERT INTO `budget_name_aliases` (
  `group_id`, `alias_name`, `alias_key`, `active`, `created_by`, `created_by_name`
)
SELECT `id`, '자체예산', '자체예산', 1, 0, '시스템'
FROM `budget_name_groups` g
WHERE g.`active` = 1
  AND g.`canonical_key` = '자체예산'
  AND NOT EXISTS (
    SELECT 1
    FROM `budget_name_aliases` a
    WHERE a.`active` = 1 AND a.`alias_key` = '자체예산'
  )
ORDER BY g.`id`
LIMIT 1;
--> statement-breakpoint
UPDATE `budget_name_groups`
SET `budget_kind` = 'purpose',
    `amount_mode` = 'manual',
    `updated_by_name` = CASE
      WHEN trim(`updated_by_name`) = '' THEN '시스템'
      ELSE `updated_by_name`
    END
WHERE `active` = 1
  AND (
    `canonical_key` IN ('지능형과학실', '공간재구조화', '가상현실스포츠실')
    OR `id` IN (
      SELECT `group_id`
      FROM `budget_name_aliases`
      WHERE `active` = 1
        AND `alias_key` IN (
          '지능형과학실',
          '공간재구조화',
          '가상현실스포츠실',
          '문체부'
        )
    )
  );
