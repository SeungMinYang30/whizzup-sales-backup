ALTER TABLE `activities` ADD `business_round` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `equipment_projects` ADD `business_round` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `quotation_documents` ADD `business_round` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS `equipment_projects_org_name_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `equipment_projects_org_round_name_idx`
  ON `equipment_projects` (`organization`, `business_round`, `name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activities_organization_business_round_idx`
  ON `activities` (`organization`, `business_round`, `activity_date`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `quotation_documents_organization_round_idx`
  ON `quotation_documents` (`organization`, `business_round`, `created_at`);
--> statement-breakpoint
UPDATE `activities` AS current
SET
  `business_round` = 2,
  `award_status` = '미정',
  `award_company` = '',
  `award_stage` = '미정',
  `progress_schedule` = ''
WHERE current.`status` = '재영업 상담'
  AND EXISTS (
    SELECT 1
    FROM `activities` AS previous
    WHERE previous.`organization` = current.`organization`
      AND previous.`id` <> current.`id`
      AND previous.`award_status` IN ('위즈업 수주', '협력사 수주')
      AND previous.`award_stage` IN ('완공', '검수', '교육')
      AND (
        COALESCE(previous.`activity_date`, '') < COALESCE(current.`activity_date`, '')
        OR (
          COALESCE(previous.`activity_date`, '') = COALESCE(current.`activity_date`, '')
          AND previous.`id` < current.`id`
        )
      )
  );
