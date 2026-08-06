import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const projectUrl = new URL("../", import.meta.url);

async function applyMigrations(database) {
  const migrationUrl = new URL("../drizzle/", import.meta.url);
  const migrationFiles = (await readdir(migrationUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const migrationFile of migrationFiles) {
    const sql = await readFile(new URL(migrationFile, migrationUrl), "utf8");
    database.exec(sql);
  }
}

const dashboardQuery = `
  WITH
  ranked_organizations AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY organization
        ORDER BY activity_date DESC, id DESC
      ) AS row_number
    FROM activities
    WHERE TRIM(COALESCE(organization, '')) <> ''
      AND source_chat <> '영업지도 PDF 가져오기'
      AND source_chat <> '수주 관리 엑셀 등록'
      AND source_chat <> '수주 관리 직접 등록'
      AND source_chat NOT LIKE '구글 시트 연동|%'
      AND NOT (
        source_chat = '수주업체 관리'
        AND activity_type IN ('협력사 등록', '협력사 등록 해제')
      )
  ),
  ranked_awards AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY organization
        ORDER BY activity_date DESC, id DESC
      ) AS row_number
    FROM activities
    WHERE TRIM(COALESCE(organization, '')) <> ''
      AND COALESCE(award_status, '미정') <> '미정'
  ),
  ranked_schedules AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY organization
        ORDER BY activity_date DESC, id DESC
      ) AS row_number
    FROM activities
    WHERE TRIM(COALESCE(progress_schedule, '')) <> ''
  ),
  recent_activities AS (
    SELECT id
    FROM activities
    ORDER BY activity_date DESC, id DESC
    LIMIT 20
  ),
  my_recent_activities AS (
    SELECT id
    FROM activities
    WHERE progress_manager = ?
    ORDER BY activity_date DESC, id DESC
    LIMIT 20
  ),
  dashboard_ids AS (
    SELECT id FROM ranked_organizations WHERE row_number = 1
    UNION
    SELECT id FROM ranked_awards WHERE row_number = 1
    UNION
    SELECT id FROM ranked_schedules WHERE row_number <= 3
    UNION
    SELECT id FROM recent_activities
    UNION
    SELECT id FROM my_recent_activities
  )
  SELECT a.id, a.organization, a.activity_date
  FROM activities a
  WHERE a.id IN (SELECT id FROM dashboard_ids)
     OR (
       a.category <> '내부'
       AND a.progress_manager = ?
       AND DATE(SUBSTR(COALESCE(NULLIF(a.created_at, ''), a.activity_date), 1, 10))
           >= DATE('now', '-7 day')
     )
  ORDER BY a.activity_date DESC, a.id DESC
`;

test("dashboard scope remains bounded after records exceed 500", async () => {
  const database = new DatabaseSync(":memory:");
  await applyMigrations(database);

  const insert = database.prepare(`
    INSERT INTO activities (
      activity_date,
      activity_type,
      organization,
      award_status,
      progress_schedule,
      progress_manager
    ) VALUES (?, 'TM·통화', ?, ?, ?, ?)
  `);
  database.exec("BEGIN");
  try {
    for (let index = 0; index < 620; index += 1) {
      const organization = `성능 점검 기관 ${String(index % 80).padStart(2, "0")}`;
      const day = String((index % 28) + 1).padStart(2, "0");
      insert.run(
        `2026-07-${day}`,
        organization,
        index % 7 === 0 ? "위즈업 수주" : "미정",
        index % 11 === 0
          ? JSON.stringify([{ label: "설치", date: "2026-08-01" }])
          : "",
        index % 5 === 0 ? "대표" : "영업팀",
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  database.prepare(`
    INSERT INTO activities (
      activity_date, activity_type, organization, source_chat,
      award_status, progress_manager
    ) VALUES (?, ?, '시스템 기록 점검 기관', ?, '미정', '대표')
  `).run('2020-01-01', '방문', '직접 입력');
  const realInstitutionId = Number(database
    .prepare("SELECT id FROM activities WHERE organization = '시스템 기록 점검 기관' ORDER BY id DESC LIMIT 1")
    .get().id);
  database.prepare(`
    INSERT INTO activities (
      activity_date, activity_type, organization, source_chat,
      award_status, progress_manager
    ) VALUES (?, ?, '시스템 기록 점검 기관', ?, '미정', '대표')
  `).run('2020-02-01', 'TM·통화', '영업지도 PDF 가져오기');

  const fullCount = database
    .prepare("SELECT COUNT(*) AS count FROM activities")
    .get().count;
  const dashboardRows = database.prepare(dashboardQuery).all("대표", "대표");
  const organizationCount = database
    .prepare("SELECT COUNT(DISTINCT organization) AS count FROM activities")
    .get().count;
  const latestOrganizationIds = database
    .prepare(`
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY organization
            ORDER BY activity_date DESC, id DESC
          ) AS row_number
        FROM activities
        WHERE source_chat <> '영업지도 PDF 가져오기'
          AND source_chat <> '수주 관리 엑셀 등록'
          AND source_chat <> '수주 관리 직접 등록'
          AND source_chat NOT LIKE '구글 시트 연동|%'
          AND NOT (
            source_chat = '수주업체 관리'
            AND activity_type IN ('협력사 등록', '협력사 등록 해제')
          )
      )
      WHERE row_number = 1
    `)
    .all()
    .map((row) => row.id);
  const dashboardIds = new Set(dashboardRows.map((row) => row.id));
  const myRecentIds = database
    .prepare(`
      SELECT id
      FROM activities
      WHERE progress_manager = ?
      ORDER BY activity_date DESC, id DESC
      LIMIT 20
    `)
    .all("대표")
    .map((row) => row.id);

  assert.equal(fullCount, 622);
  assert.equal(organizationCount, 81);
  assert.ok(dashboardRows.length < fullCount);
  assert.ok(latestOrganizationIds.every((id) => dashboardIds.has(id)));
  assert.ok(dashboardIds.has(realInstitutionId));
  assert.ok(myRecentIds.every((id) => dashboardIds.has(id)));

  const indexes = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => row.name),
  );
  assert.ok(indexes.has("activities_organization_date_idx"));
  assert.ok(indexes.has("activities_date_idx"));
  assert.ok(indexes.has("activities_manager_created_idx"));

  const route = await readFile(
    new URL("app/api/records/route.ts", projectUrl),
    "utf8",
  );
  assert.match(route, /ranked_organizations/);
  assert.match(route, /recent_activities/);
  assert.match(route, /my_recent_activities/);
  assert.match(route, /canonicalProgressManagerName/);
  assert.match(route, /source_chat <> '영업지도 PDF 가져오기'/);
});
