-- 기존 사이트 연결 일정의 비어 있는 Google 설명을 담당자·일정 내용으로 다시 채운다.
UPDATE organization_schedules
SET sync_status = 'pending', sync_operation = 'upsert', sync_error = ''
WHERE TRIM(COALESCE(deleted_at, '')) = ''
  AND TRIM(COALESCE(google_event_id, '')) <> ''
  AND (
    category IN ('meeting', 'construction', 'showroom', 'other')
    OR (category = 'general' AND label LIKE '영업%')
  );

PRAGMA optimize;
