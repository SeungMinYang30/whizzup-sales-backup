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
        AND REPLACE(
          REPLACE(
            REPLACE(
              LOWER(CASE
                WHEN INSTR(TRIM(keeper.label), ']') BETWEEN 1 AND 12
                  THEN SUBSTR(TRIM(keeper.label), INSTR(TRIM(keeper.label), ']') + 1)
                ELSE TRIM(keeper.label)
              END),
              ' ',
              ''
            ),
            REPLACE(LOWER(TRIM(keeper.organization)), ' ', ''),
            ''
          ),
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            REPLACE(LOWER(TRIM(keeper.organization)), ' ', ''),
            '특별자치도', ''), '특별자치시', ''), '광역시', ''), '특별시', ''),
            '도', ''), '시', ''), '군', ''), '구', ''),
          ''
        ) = REPLACE(
          REPLACE(
            REPLACE(
              LOWER(CASE
                WHEN INSTR(TRIM(duplicate.label), ']') BETWEEN 1 AND 12
                  THEN SUBSTR(TRIM(duplicate.label), INSTR(TRIM(duplicate.label), ']') + 1)
                ELSE TRIM(duplicate.label)
              END),
              ' ',
              ''
            ),
            REPLACE(LOWER(TRIM(duplicate.organization)), ' ', ''),
            ''
          ),
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            REPLACE(LOWER(TRIM(duplicate.organization)), ' ', ''),
            '특별자치도', ''), '특별자치시', ''), '광역시', ''), '특별시', ''),
            '도', ''), '시', ''), '군', ''), '구', ''),
          ''
        )
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

CREATE UNIQUE INDEX IF NOT EXISTS organization_schedules_active_local_semantic_identity_idx
ON organization_schedules (
  LOWER(TRIM(organization)),
  business_round,
  REPLACE(
    REPLACE(
      REPLACE(
        LOWER(CASE
          WHEN INSTR(TRIM(label), ']') BETWEEN 1 AND 12
            THEN SUBSTR(TRIM(label), INSTR(TRIM(label), ']') + 1)
          ELSE TRIM(label)
        END),
        ' ',
        ''
      ),
      REPLACE(LOWER(TRIM(organization)), ' ', ''),
      ''
    ),
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      REPLACE(LOWER(TRIM(organization)), ' ', ''),
      '특별자치도', ''), '특별자치시', ''), '광역시', ''), '특별시', ''),
      '도', ''), '시', ''), '군', ''), '구', ''),
    ''
  ),
  scheduled_date,
  LOWER(TRIM(COALESCE(category, 'general')))
)
WHERE COALESCE(category, 'general') <> 'construction'
  AND TRIM(COALESCE(deleted_at, '')) = ''
  AND TRIM(COALESCE(google_event_id, '')) = '';

PRAGMA optimize;
