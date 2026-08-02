CREATE INDEX IF NOT EXISTS `activities_organization_activity_idx`
  ON `activities` (`organization`, `activity_date`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activities_manager_activity_idx`
  ON `activities` (`progress_manager`, `activity_date`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activities_award_organization_activity_idx`
  ON `activities` (`award_status`, `organization`, `activity_date`, `id`);
--> statement-breakpoint
UPDATE `activities`
SET
  `progress_manager` = '해당 없음',
  `updated_at` = CURRENT_TIMESTAMP
WHERE `award_status` IN ('협력사 수주', '타업체 수주')
  AND `progress_manager` <> '해당 없음';
