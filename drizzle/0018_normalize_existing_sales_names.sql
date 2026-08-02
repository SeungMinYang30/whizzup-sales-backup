UPDATE `activities`
SET `progress_manager` = '고수민 대리'
WHERE TRIM(`progress_manager`) = '고수민'
  AND 1 = (
    SELECT COUNT(*)
    FROM `members`
    WHERE `status` = 'approved'
      AND `is_sales` = 1
      AND TRIM(`display_name`) = '고수민 대리'
  );
--> statement-breakpoint
UPDATE `activities`
SET `progress_manager` = '김동훈 과장'
WHERE TRIM(`progress_manager`) = '김동훈'
  AND 1 = (
    SELECT COUNT(*)
    FROM `members`
    WHERE `status` = 'approved'
      AND `is_sales` = 1
      AND TRIM(`display_name`) = '김동훈 과장'
  );
--> statement-breakpoint
UPDATE `activities`
SET `progress_manager` = '안재용 사원'
WHERE TRIM(`progress_manager`) = '안재용'
  AND 1 = (
    SELECT COUNT(*)
    FROM `members`
    WHERE `status` = 'approved'
      AND `is_sales` = 1
      AND TRIM(`display_name`) = '안재용 사원'
  );
--> statement-breakpoint
UPDATE `activities`
SET `progress_manager` = '양승민 이사'
WHERE TRIM(`progress_manager`) = '양승민'
  AND 1 = (
    SELECT COUNT(*)
    FROM `members`
    WHERE `status` = 'approved'
      AND `is_sales` = 1
      AND TRIM(`display_name`) = '양승민 이사'
  );
--> statement-breakpoint
UPDATE `activities`
SET `progress_manager` = '이준상 본부장'
WHERE TRIM(`progress_manager`) = '이준상'
  AND 1 = (
    SELECT COUNT(*)
    FROM `members`
    WHERE `status` = 'approved'
      AND `is_sales` = 1
      AND TRIM(`display_name`) = '이준상 본부장'
  );
