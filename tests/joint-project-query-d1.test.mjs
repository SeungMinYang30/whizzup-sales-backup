import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const recordsSource = await readFile(
  new URL("../app/api/records/route.ts", import.meta.url),
  "utf8",
);
const campaignsSource = await readFile(
  new URL("../app/api/map/campaigns/route.ts", import.meta.url),
  "utf8",
);

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY,
      organization TEXT NOT NULL,
      business_round INTEGER NOT NULL,
      activity_date TEXT NOT NULL
    );
    CREATE TABLE sales_campaign_targets (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER NOT NULL,
      organization TEXT NOT NULL,
      business_round INTEGER NOT NULL
    );
    CREATE TABLE joint_projects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE joint_project_members (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL,
      organization TEXT NOT NULL,
      business_round INTEGER NOT NULL,
      role TEXT NOT NULL,
      activity_id INTEGER,
      campaign_target_id INTEGER,
      updated_at TEXT NOT NULL
    );
    INSERT INTO activities VALUES
      (1, '괴산군청', 1, '2026-07-30'),
      (2, '괴산군청', 1, '2026-07-29');
    INSERT INTO sales_campaign_targets VALUES
      (10, 1, '괴산군청', 1),
      (11, 1, '괴산군노인복지관', 1);
    INSERT INTO joint_projects VALUES (100, '괴산군 공동사업', 'active');
    INSERT INTO joint_project_members VALUES
      (1000, 100, '괴산군청', 1, 'sponsor', 1, 10, '2026-07-30'),
      (1001, 100, '괴산군노인복지관', 1, 'site', NULL, NULL, '2026-07-30');
  `);
  return db;
}

test("활동 공동사업 조회는 외부 별칭을 상관 서브쿼리에서 참조하지 않는다", () => {
  assert.doesNotMatch(recordsSource, /linked\.activity_id\s*=\s*a\.id/);
  const db = database();
  const rows = db.prepare(`
    WITH joint_member_candidates AS (
      SELECT source_activity.id AS activity_id, linked.id AS member_id,
             ROW_NUMBER() OVER (
               PARTITION BY source_activity.id
               ORDER BY CASE WHEN linked.activity_id = source_activity.id THEN 0 ELSE 1 END,
                        linked.updated_at DESC, linked.id DESC
             ) AS row_number
      FROM activities source_activity
      JOIN joint_project_members linked
        ON linked.activity_id = source_activity.id
        OR (linked.organization = source_activity.organization
            AND linked.business_round = source_activity.business_round)
      JOIN joint_projects linked_project
        ON linked_project.id = linked.project_id AND linked_project.status = 'active'
    )
    SELECT a.id, jpm.id AS member_id
    FROM activities a
    LEFT JOIN joint_member_candidates candidate
      ON candidate.activity_id = a.id AND candidate.row_number = 1
    LEFT JOIN joint_project_members jpm ON jpm.id = candidate.member_id
    ORDER BY a.id
  `).all();
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { id: 1, member_id: 1000 },
    { id: 2, member_id: 1000 },
  ]);
});

test("예산 명단 공동사업 조회는 대상별 후보를 먼저 계산한다", () => {
  assert.match(campaignsSource, /WITH joint_target_candidates AS/);
  assert.doesNotMatch(campaignsSource, /linked\.campaign_target_id\s*=\s*t\.id/);
  const db = database();
  const rows = db.prepare(`
    WITH joint_target_candidates AS (
      SELECT source_target.id AS target_id, linked.id AS member_id,
             ROW_NUMBER() OVER (
               PARTITION BY source_target.id
               ORDER BY CASE WHEN linked.campaign_target_id = source_target.id THEN 0 ELSE 1 END,
                        linked.updated_at DESC, linked.id DESC
             ) AS row_number
      FROM sales_campaign_targets source_target
      JOIN joint_project_members linked
        ON linked.campaign_target_id = source_target.id
        OR (linked.organization = source_target.organization
            AND linked.business_round = source_target.business_round)
      JOIN joint_projects linked_project
        ON linked_project.id = linked.project_id AND linked_project.status = 'active'
    )
    SELECT target.id, member.id AS member_id
    FROM sales_campaign_targets target
    LEFT JOIN joint_target_candidates candidate
      ON candidate.target_id = target.id AND candidate.row_number = 1
    LEFT JOIN joint_project_members member ON member.id = candidate.member_id
    ORDER BY target.id
  `).all();
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { id: 10, member_id: 1000 },
    { id: 11, member_id: 1001 },
  ]);
});
