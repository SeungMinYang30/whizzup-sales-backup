UPDATE `ai_recommendations`
SET
  `organization` = '보령 명천초등학교 병설유치원',
  `meeting_summary` = REPLACE(
    `meeting_summary`,
    '보령 실버복지관',
    '보령 명천초등학교 병설유치원'
  ),
  `updated_at` = CURRENT_TIMESTAMP
WHERE `activity_id` IN (
  SELECT `id`
  FROM `activities`
  WHERE `organization` = '보령 실버복지관'
    AND `activity_date` = '2026-07-20'
    AND REPLACE(`region`, ' ', '') LIKE '%보령%'
    AND (
      REPLACE(`summary`, ' ', '') LIKE '%명천초등학교병설유치원%'
      OR REPLACE(`topic`, ' ', '') LIKE '%명천초등학교병설유치원%'
      OR REPLACE(`notes`, ' ', '') LIKE '%명천초등학교병설유치원%'
    )
);
--> statement-breakpoint
UPDATE `activities`
SET
  `organization` = '보령 명천초등학교 병설유치원',
  `topic` = REPLACE(
    `topic`,
    '보령 실버복지관',
    '보령 명천초등학교 병설유치원'
  ),
  `summary` = REPLACE(
    `summary`,
    '보령 실버복지관',
    '보령 명천초등학교 병설유치원'
  ),
  `next_action` = REPLACE(
    `next_action`,
    '보령 실버복지관',
    '보령 명천초등학교 병설유치원'
  ),
  `progress_schedule` = REPLACE(
    `progress_schedule`,
    '보령 실버복지관',
    '보령 명천초등학교 병설유치원'
  ),
  `notes` = REPLACE(
    `notes`,
    '보령 실버복지관',
    '보령 명천초등학교 병설유치원'
  ),
  `updated_at` = CURRENT_TIMESTAMP
WHERE `organization` = '보령 실버복지관'
  AND `activity_date` = '2026-07-20'
  AND REPLACE(`region`, ' ', '') LIKE '%보령%'
  AND (
    REPLACE(`summary`, ' ', '') LIKE '%명천초등학교병설유치원%'
    OR REPLACE(`topic`, ' ', '') LIKE '%명천초등학교병설유치원%'
    OR REPLACE(`notes`, ' ', '') LIKE '%명천초등학교병설유치원%'
  );
