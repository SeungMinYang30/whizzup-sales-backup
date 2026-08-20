ALTER TABLE award_vendors
ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS award_vendor_migrations (
  migration_key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO award_vendors (
  company_name,
  phone,
  email,
  contact_name,
  contact_phone,
  contact_email,
  notes,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  current.organization,
  current.contact_phone,
  current.contact_email,
  current.contact_name,
  current.contact_phone,
  current.contact_email,
  current.notes,
  1,
  1,
  current.created_at,
  current.updated_at
FROM activities AS current
INNER JOIN (
  SELECT organization, MAX(id) AS latest_id
  FROM activities
  WHERE source_chat = '수주업체 관리'
    AND activity_type IN ('협력사 등록', '협력사 등록 해제')
  GROUP BY organization
) AS latest ON latest.latest_id = current.id
WHERE current.activity_type = '협력사 등록'
  AND current.organization <> '';

DELETE FROM activities
WHERE source_chat = '수주업체 관리'
  AND activity_type IN ('협력사 등록', '협력사 등록 해제');

INSERT OR IGNORE INTO award_vendor_migrations (migration_key)
VALUES ('2026-07-23-partner-activities-to-award-vendors');
