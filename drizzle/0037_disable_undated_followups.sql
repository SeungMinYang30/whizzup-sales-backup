UPDATE `activities`
SET
  `follow_up_required` = 0,
  `follow_up_date` = NULL,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `follow_up_required` = 1
  AND TRIM(COALESCE(`follow_up_date`, '')) = '';
