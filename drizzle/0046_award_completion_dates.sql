ALTER TABLE `activities`
ADD `award_completed_date` text DEFAULT '' NOT NULL;

UPDATE `activities` AS current
SET `award_completed_date` = COALESCE((
  SELECT MAX(COALESCE(NULLIF(completed.`activity_date`, ''), ''))
  FROM `activities` AS completed
  WHERE completed.`organization` = current.`organization`
    AND completed.`business_round` = current.`business_round`
    AND completed.`award_status` = '위즈업 수주'
    AND completed.`award_stage` = '납품 완료'
), '')
WHERE current.`award_status` = '위즈업 수주'
  AND current.`award_stage` = '납품 완료';

CREATE INDEX IF NOT EXISTS `activities_award_business_round_idx`
ON `activities` (
  `award_status`,
  `organization`,
  `business_round`,
  `activity_date`,
  `id`
);
