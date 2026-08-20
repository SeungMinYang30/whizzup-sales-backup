-- 신뢰 가능한 사이트·시공 일정 원본으로 Google 설명을 정형화해 다시 기록한다.
UPDATE organization_schedules
SET sync_status = 'pending', sync_operation = 'upsert', sync_error = ''
WHERE TRIM(COALESCE(deleted_at, '')) = ''
  AND TRIM(COALESCE(google_event_id, '')) <> ''
  AND (
    category IN ('meeting', 'construction', 'showroom', 'other')
    OR (category = 'general' AND label LIKE '영업%')
  );

PRAGMA optimize;
