UPDATE `ai_recommendations`
SET
  `organization` = '명천 실버복지관',
  `meeting_summary` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    `meeting_summary`,
    '보령시 명천 실버복지관', '명천 실버복지관'),
    '보령시 명천실버복지관', '명천 실버복지관'),
    '보령 명천 실버복지관', '명천 실버복지관'),
    '보령 명천실버복지관', '명천 실버복지관'),
    '보령명천실버복지관', '명천 실버복지관'),
  `updated_at` = CURRENT_TIMESTAMP
WHERE REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령명천실버복지관'
   OR `activity_id` IN (
     SELECT `id`
     FROM `activities`
     WHERE REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령명천실버복지관'
   );
--> statement-breakpoint
UPDATE `activities`
SET
  `organization` = '명천 실버복지관',
  `topic` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    `topic`,
    '보령시 명천 실버복지관', '명천 실버복지관'),
    '보령시 명천실버복지관', '명천 실버복지관'),
    '보령 명천 실버복지관', '명천 실버복지관'),
    '보령 명천실버복지관', '명천 실버복지관'),
    '보령명천실버복지관', '명천 실버복지관'),
  `summary` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    `summary`,
    '보령시 명천 실버복지관', '명천 실버복지관'),
    '보령시 명천실버복지관', '명천 실버복지관'),
    '보령 명천 실버복지관', '명천 실버복지관'),
    '보령 명천실버복지관', '명천 실버복지관'),
    '보령명천실버복지관', '명천 실버복지관'),
  `next_action` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    `next_action`,
    '보령시 명천 실버복지관', '명천 실버복지관'),
    '보령시 명천실버복지관', '명천 실버복지관'),
    '보령 명천 실버복지관', '명천 실버복지관'),
    '보령 명천실버복지관', '명천 실버복지관'),
    '보령명천실버복지관', '명천 실버복지관'),
  `progress_schedule` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    `progress_schedule`,
    '보령시 명천 실버복지관', '명천 실버복지관'),
    '보령시 명천실버복지관', '명천 실버복지관'),
    '보령 명천 실버복지관', '명천 실버복지관'),
    '보령 명천실버복지관', '명천 실버복지관'),
    '보령명천실버복지관', '명천 실버복지관'),
  `notes` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    `notes`,
    '보령시 명천 실버복지관', '명천 실버복지관'),
    '보령시 명천실버복지관', '명천 실버복지관'),
    '보령 명천 실버복지관', '명천 실버복지관'),
    '보령 명천실버복지관', '명천 실버복지관'),
    '보령명천실버복지관', '명천 실버복지관'),
  `updated_at` = CURRENT_TIMESTAMP
WHERE REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령명천실버복지관';
--> statement-breakpoint
DELETE FROM `organization_locations`
WHERE `organization` <> '명천 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령명천실버복지관'
  AND EXISTS (
    SELECT 1 FROM `organization_locations`
    WHERE `organization` = '명천 실버복지관'
  );
--> statement-breakpoint
UPDATE `organization_locations`
SET `organization` = '명천 실버복지관', `updated_at` = CURRENT_TIMESTAMP
WHERE `organization` <> '명천 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령명천실버복지관';
--> statement-breakpoint
DELETE FROM `manager_alert_acknowledgements`
WHERE `organization` <> '명천 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령명천실버복지관'
  AND EXISTS (
    SELECT 1
    FROM `manager_alert_acknowledgements` target
    WHERE target.`member_id` = `manager_alert_acknowledgements`.`member_id`
      AND target.`organization` = '명천 실버복지관'
  );
--> statement-breakpoint
UPDATE `manager_alert_acknowledgements`
SET `organization` = '명천 실버복지관', `updated_at` = CURRENT_TIMESTAMP
WHERE `organization` <> '명천 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령명천실버복지관';
--> statement-breakpoint
DELETE FROM `sales_campaign_targets`
WHERE `organization` <> '명천 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령명천실버복지관'
  AND EXISTS (
    SELECT 1
    FROM `sales_campaign_targets` target
    WHERE target.`campaign_id` = `sales_campaign_targets`.`campaign_id`
      AND target.`organization` = '명천 실버복지관'
  );
--> statement-breakpoint
UPDATE `sales_campaign_targets`
SET `organization` = '명천 실버복지관', `updated_at` = CURRENT_TIMESTAMP
WHERE `organization` <> '명천 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령명천실버복지관';
--> statement-breakpoint
UPDATE `equipment_items`
SET `project_id` = (
  SELECT target.`id`
  FROM `equipment_projects` source
  JOIN `equipment_projects` target
    ON target.`organization` = '명천 실버복지관'
   AND target.`name` = source.`name`
  WHERE source.`id` = `equipment_items`.`project_id`
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM `equipment_projects` source
  JOIN `equipment_projects` target
    ON target.`organization` = '명천 실버복지관'
   AND target.`name` = source.`name`
  WHERE source.`id` = `equipment_items`.`project_id`
    AND source.`organization` <> '명천 실버복지관'
    AND REPLACE(REPLACE(source.`organization`, ' ', ''), '보령시', '보령') = '보령명천실버복지관'
);
--> statement-breakpoint
DELETE FROM `equipment_projects`
WHERE `organization` <> '명천 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령명천실버복지관'
  AND EXISTS (
    SELECT 1
    FROM `equipment_projects` target
    WHERE target.`organization` = '명천 실버복지관'
      AND target.`name` = `equipment_projects`.`name`
  );
--> statement-breakpoint
UPDATE `equipment_projects`
SET `organization` = '명천 실버복지관', `updated_at` = CURRENT_TIMESTAMP
WHERE `organization` <> '명천 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령명천실버복지관';
--> statement-breakpoint
INSERT INTO `app_settings` (`key`, `value`, `updated_by`, `updated_at`)
VALUES (
  'institution_aliases',
  '{"보령명천실버복지관":"명천 실버복지관","보령시명천실버복지관":"명천 실버복지관"}',
  NULL,
  CURRENT_TIMESTAMP
)
ON CONFLICT(`key`) DO UPDATE SET
  `value` = json_set(
    CASE
      WHEN json_valid(`app_settings`.`value`) THEN `app_settings`.`value`
      ELSE '{}'
    END,
    '$."보령명천실버복지관"', '명천 실버복지관',
    '$."보령시명천실버복지관"', '명천 실버복지관'
  ),
  `updated_at` = CURRENT_TIMESTAMP;
