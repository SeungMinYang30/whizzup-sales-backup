UPDATE `activities`
SET `progress_manager` = '해당 없음'
WHERE TRIM(COALESCE(`progress_manager`, '')) = ''
  AND `source_chat` = '수주 관리 직접 등록';
--> statement-breakpoint
UPDATE `activities`
SET
  `execution_type` = CASE
    WHEN `award_status` = '타업체 수주' THEN '해당 없음'
    WHEN TRIM(COALESCE(`consortium_company`, '')) <> '' THEN '컨소'
    ELSE '직영'
  END,
  `consortium_company` = CASE
    WHEN `award_status` = '타업체 수주' THEN ''
    ELSE TRIM(COALESCE(`consortium_company`, ''))
  END,
  `award_stage` = CASE
    WHEN `award_status` = '타업체 수주' THEN '타업체 수주 종료'
    ELSE `award_stage`
  END
WHERE `source_chat` = '수주 관리 직접 등록'
   OR `activity_type` = '수주';
--> statement-breakpoint
UPDATE `activities`
SET `topic` = CASE
  WHEN `activity_type` = '수주'
    OR `award_status` IN ('위즈업 수주', '타업체 수주') THEN '수주'
  WHEN TRIM(COALESCE(`topic`, '')) = '' THEN '분류 확인 필요'
  WHEN (`topic` || ' ' || `summary`) LIKE '%예산%' THEN '예산 확인'
  WHEN (`topic` || ' ' || `summary`) LIKE '%견적%' THEN '견적'
  WHEN (`topic` || ' ' || `summary`) LIKE '%수주%'
    OR (`topic` || ' ' || `summary`) LIKE '%계약%' THEN '수주'
  WHEN (`topic` || ' ' || `summary`) LIKE '%구매%'
    OR (`topic` || ' ' || `summary`) LIKE '%발주%'
    OR (`topic` || ' ' || `summary`) LIKE '%품의%'
    OR (`topic` || ' ' || `summary`) LIKE '%물품선정%' THEN '구매 진행'
  WHEN (`topic` || ' ' || `summary`) LIKE '%설치%'
    OR (`topic` || ' ' || `summary`) LIKE '%시공%'
    OR (`topic` || ' ' || `summary`) LIKE '%공사%' THEN '설치'
  WHEN (`topic` || ' ' || `summary`) LIKE '%일정%'
    OR (`topic` || ' ' || `summary`) LIKE '%재연락%' THEN '일정 확인'
  WHEN (`topic` || ' ' || `summary`) LIKE '%A/S%'
    OR (`topic` || ' ' || `summary`) LIKE '%AS%'
    OR (`topic` || ' ' || `summary`) LIKE '%유지보수%'
    OR (`topic` || ' ' || `summary`) LIKE '%하자%' THEN '사후관리'
  WHEN (`topic` || ' ' || `summary`) LIKE '%담당자%'
    OR (`topic` || ' ' || `summary`) LIKE '%연락처%' THEN '담당자 확인'
  WHEN (`topic` || ' ' || `summary`) LIKE '%제안%'
    OR (`topic` || ' ' || `summary`) LIKE '%제품%'
    OR (`topic` || ' ' || `summary`) LIKE '%체험%'
    OR (`topic` || ' ' || `summary`) LIKE '%VR%' THEN '제품 제안'
  ELSE '기타'
END
WHERE `source_chat` <> '영업지도 PDF 가져오기'
  AND TRIM(COALESCE(`topic`, '')) NOT IN (
    '예산 확인', '제품 제안', '견적', '구매 진행', '수주', '일정 확인',
    '설치', '사후관리', '담당자 확인', '기타', '복합 상담', '분류 확인 필요'
  );
