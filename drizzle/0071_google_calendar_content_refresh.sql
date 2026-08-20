-- 기존 사이트 연결 일정을 새 제목·담당자·내용·분류 색상으로 다시 저장한다.
UPDATE organization_schedules
SET sync_status = 'pending', sync_operation = 'upsert', sync_error = ''
WHERE TRIM(COALESCE(deleted_at, '')) = ''
  AND TRIM(COALESCE(google_event_id, '')) <> ''
  AND (
    category IN ('meeting', 'construction', 'showroom', 'other')
    OR (category = 'general' AND label LIKE '영업%')
  );

PRAGMA optimize;
