UPDATE `activities`
SET
  `organization` = '보령 실버복지관',
  `topic` = REPLACE(REPLACE(REPLACE(REPLACE(`topic`, '보령시 실버 복지관', '보령 실버복지관'), '보령시 실버복지관', '보령 실버복지관'), '보령시실버복지관', '보령 실버복지관'), '보령실버복지관', '보령 실버복지관'),
  `summary` = REPLACE(REPLACE(REPLACE(REPLACE(`summary`, '보령시 실버 복지관', '보령 실버복지관'), '보령시 실버복지관', '보령 실버복지관'), '보령시실버복지관', '보령 실버복지관'), '보령실버복지관', '보령 실버복지관'),
  `next_action` = REPLACE(REPLACE(REPLACE(REPLACE(`next_action`, '보령시 실버 복지관', '보령 실버복지관'), '보령시 실버복지관', '보령 실버복지관'), '보령시실버복지관', '보령 실버복지관'), '보령실버복지관', '보령 실버복지관'),
  `progress_schedule` = REPLACE(REPLACE(REPLACE(REPLACE(`progress_schedule`, '보령시 실버 복지관', '보령 실버복지관'), '보령시 실버복지관', '보령 실버복지관'), '보령시실버복지관', '보령 실버복지관'), '보령실버복지관', '보령 실버복지관'),
  `notes` = REPLACE(REPLACE(REPLACE(REPLACE(`notes`, '보령시 실버 복지관', '보령 실버복지관'), '보령시 실버복지관', '보령 실버복지관'), '보령시실버복지관', '보령 실버복지관'), '보령실버복지관', '보령 실버복지관'),
  `updated_at` = CURRENT_TIMESTAMP
WHERE REPLACE(`region`, ' ', '') LIKE '%보령%'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령실버복지관';
--> statement-breakpoint
UPDATE `ai_recommendations`
SET
  `organization` = '보령 실버복지관',
  `meeting_summary` = REPLACE(REPLACE(REPLACE(REPLACE(`meeting_summary`, '보령시 실버 복지관', '보령 실버복지관'), '보령시 실버복지관', '보령 실버복지관'), '보령시실버복지관', '보령 실버복지관'), '보령실버복지관', '보령 실버복지관'),
  `updated_at` = CURRENT_TIMESTAMP
WHERE `activity_id` IN (
  SELECT `id`
  FROM `activities`
  WHERE REPLACE(`region`, ' ', '') LIKE '%보령%'
    AND `organization` = '보령 실버복지관'
);
--> statement-breakpoint
DELETE FROM `organization_locations`
WHERE `organization` <> '보령 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령실버복지관'
  AND EXISTS (
    SELECT 1 FROM `organization_locations`
    WHERE `organization` = '보령 실버복지관'
  );
--> statement-breakpoint
UPDATE `organization_locations`
SET `organization` = '보령 실버복지관', `updated_at` = CURRENT_TIMESTAMP
WHERE `organization` <> '보령 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령실버복지관';
--> statement-breakpoint
DELETE FROM `manager_alert_acknowledgements`
WHERE `organization` <> '보령 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령실버복지관'
  AND EXISTS (
    SELECT 1
    FROM `manager_alert_acknowledgements` target
    WHERE target.`member_id` = `manager_alert_acknowledgements`.`member_id`
      AND target.`organization` = '보령 실버복지관'
  );
--> statement-breakpoint
UPDATE `manager_alert_acknowledgements`
SET `organization` = '보령 실버복지관', `updated_at` = CURRENT_TIMESTAMP
WHERE `organization` <> '보령 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령실버복지관';
--> statement-breakpoint
DELETE FROM `sales_campaign_targets`
WHERE `organization` <> '보령 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령실버복지관'
  AND EXISTS (
    SELECT 1
    FROM `sales_campaign_targets` target
    WHERE target.`campaign_id` = `sales_campaign_targets`.`campaign_id`
      AND target.`organization` = '보령 실버복지관'
  );
--> statement-breakpoint
UPDATE `sales_campaign_targets`
SET `organization` = '보령 실버복지관', `updated_at` = CURRENT_TIMESTAMP
WHERE `organization` <> '보령 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령실버복지관';
--> statement-breakpoint
UPDATE `equipment_items`
SET `project_id` = (
  SELECT target.`id`
  FROM `equipment_projects` source
  JOIN `equipment_projects` target
    ON target.`organization` = '보령 실버복지관'
   AND target.`name` = source.`name`
  WHERE source.`id` = `equipment_items`.`project_id`
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM `equipment_projects` source
  JOIN `equipment_projects` target
    ON target.`organization` = '보령 실버복지관'
   AND target.`name` = source.`name`
  WHERE source.`id` = `equipment_items`.`project_id`
    AND source.`organization` <> '보령 실버복지관'
    AND REPLACE(REPLACE(source.`organization`, ' ', ''), '보령시', '보령') = '보령실버복지관'
);
--> statement-breakpoint
DELETE FROM `equipment_projects`
WHERE `organization` <> '보령 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령실버복지관'
  AND EXISTS (
    SELECT 1
    FROM `equipment_projects` target
    WHERE target.`organization` = '보령 실버복지관'
      AND target.`name` = `equipment_projects`.`name`
  );
--> statement-breakpoint
UPDATE `equipment_projects`
SET `organization` = '보령 실버복지관', `updated_at` = CURRENT_TIMESTAMP
WHERE `organization` <> '보령 실버복지관'
  AND REPLACE(REPLACE(`organization`, ' ', ''), '보령시', '보령') = '보령실버복지관';
