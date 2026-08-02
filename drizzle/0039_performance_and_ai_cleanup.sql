CREATE INDEX IF NOT EXISTS `equipment_items_protection_project_idx`
  ON `equipment_items` (`protection_status`, `project_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `equipment_projects_creator_updated_idx`
  ON `equipment_projects` (`created_by`, `updated_at`);
--> statement-breakpoint
UPDATE `activities`
SET `next_action` = '담당 선생님께 공간 재구성 시기를 유선으로 확인합니다.'
WHERE `organization` = '성남초등학교 병설유치원'
  AND (
    `next_action` LIKE '%병설유치원 병설유치원%'
    OR length(`next_action`) > 300
  );
