-- 기존 상담·일정·담당자 이력은 그대로 두고 수주 진행 단계 값만 새 체계로 정리한다.
UPDATE `activities`
SET `award_stage` = '납품 완료'
WHERE `award_stage` = '완공';
--> statement-breakpoint
UPDATE `activities`
SET `award_stage` = '검수·교육 진행'
WHERE `award_stage` IN ('검수', '교육');
--> statement-breakpoint
UPDATE `activities`
SET `award_stage` = '협상'
WHERE `award_stage` = '품의';
--> statement-breakpoint
UPDATE `activities`
SET `award_stage` = '해당 없음'
WHERE `award_status` = '타업체 수주'
   OR `award_stage` = '타업체 수주 종료';
