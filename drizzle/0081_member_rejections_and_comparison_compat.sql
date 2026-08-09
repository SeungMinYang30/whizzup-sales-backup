CREATE TABLE IF NOT EXISTS `member_rejections` (
  `email` text PRIMARY KEY NOT NULL,
  `rejected_by` integer,
  `rejected_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT OR IGNORE INTO `member_rejections` (`email`, `rejected_at`)
SELECT lower(email), CURRENT_TIMESTAMP
FROM `members`
WHERE lower(email) = 'freeyang3@nate.com'
  AND status = 'pending'
  AND role = 'member';

DELETE FROM `member_sessions`
WHERE member_id IN (
  SELECT id FROM `members`
  WHERE lower(email) = 'freeyang3@nate.com' AND status = 'pending' AND role = 'member'
);

DELETE FROM `member_credentials`
WHERE member_id IN (
  SELECT id FROM `members`
  WHERE lower(email) = 'freeyang3@nate.com' AND status = 'pending' AND role = 'member'
);

DELETE FROM `member_password_reset_requests`
WHERE member_id IN (
  SELECT id FROM `members`
  WHERE lower(email) = 'freeyang3@nate.com' AND status = 'pending' AND role = 'member'
);

DELETE FROM `members`
WHERE lower(email) = 'freeyang3@nate.com'
  AND status = 'pending'
  AND role = 'member';
