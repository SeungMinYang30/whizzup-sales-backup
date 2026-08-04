ALTER TABLE organization_schedules ADD COLUMN google_origin INTEGER NOT NULL DEFAULT 0;

-- 기존 공유 업무 일정은 새 제목(분류·기관명·내용)과 색상으로 Google에 다시 반영한다.
UPDATE organization_schedules
SET sync_status = 'pending', sync_operation = 'upsert', sync_error = ''
WHERE TRIM(COALESCE(deleted_at, '')) = ''
  AND TRIM(COALESCE(google_event_id, '')) <> ''
  AND (
    category IN ('meeting', 'construction', 'showroom', 'other')
    OR (
      category = 'general'
      AND (
        label LIKE '영업 · %'
        OR label LIKE '영업 • %'
        OR label LIKE '영업 - %'
      )
    )
  );

-- 개인/기존 비공유 일정은 사이트에 보존하고 Google 원본만 제거한다.
UPDATE organization_schedules
SET sync_status = CASE
      WHEN TRIM(COALESCE(google_event_id, '')) <> '' THEN 'pending'
      ELSE 'local_only'
    END,
    sync_operation = CASE
      WHEN TRIM(COALESCE(google_event_id, '')) <> '' THEN 'unlink'
      ELSE 'upsert'
    END,
    sync_error = ''
WHERE TRIM(COALESCE(deleted_at, '')) = ''
  AND (
    category = 'personal'
    OR (
      category = 'general'
      AND label NOT LIKE '영업 · %'
      AND label NOT LIKE '영업 • %'
      AND label NOT LIKE '영업 - %'
    )
  );

PRAGMA optimize;
