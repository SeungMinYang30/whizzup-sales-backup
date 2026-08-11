-- 동일 상담에서 기존 일정과 새 활동 파생 일정이 동시에 저장된 경우,
-- Google에 이미 연결된 행 또는 먼저 생성된 원본 행 하나만 보존한다.
DELETE FROM organization_schedules
WHERE id IN (
  SELECT duplicate.id
  FROM organization_schedules duplicate
  WHERE COALESCE(duplicate.category, 'general') <> 'construction'
    AND TRIM(COALESCE(duplicate.deleted_at, '')) = ''
    AND TRIM(COALESCE(duplicate.google_event_id, '')) = ''
    AND EXISTS (
      SELECT 1
      FROM organization_schedules keeper
      WHERE LOWER(TRIM(keeper.organization)) = LOWER(TRIM(duplicate.organization))
        AND keeper.business_round = duplicate.business_round
        AND LOWER(TRIM(keeper.label)) = LOWER(TRIM(duplicate.label))
        AND keeper.scheduled_date = duplicate.scheduled_date
        AND LOWER(TRIM(COALESCE(keeper.category, 'general'))) = LOWER(TRIM(COALESCE(duplicate.category, 'general')))
        AND COALESCE(keeper.category, 'general') <> 'construction'
        AND TRIM(COALESCE(keeper.deleted_at, '')) = ''
        AND (
          TRIM(COALESCE(keeper.google_event_id, '')) <> ''
          OR (
            TRIM(COALESCE(keeper.google_event_id, '')) = ''
            AND keeper.id < duplicate.id
          )
        )
    )
);

-- 새 일정 저장은 시간 입력 방식과 무관하게 기관·차수·날짜·제목·구분이
-- 같으면 한 건만 허용한다. Google 연결 행은 기존 Google 고유 인덱스로 보호한다.
CREATE UNIQUE INDEX IF NOT EXISTS organization_schedules_active_local_identity_idx
ON organization_schedules (
  LOWER(TRIM(organization)),
  business_round,
  LOWER(TRIM(label)),
  scheduled_date,
  LOWER(TRIM(COALESCE(category, 'general')))
)
WHERE COALESCE(category, 'general') <> 'construction'
  AND TRIM(COALESCE(deleted_at, '')) = ''
  AND TRIM(COALESCE(google_event_id, '')) = '';

PRAGMA optimize;
