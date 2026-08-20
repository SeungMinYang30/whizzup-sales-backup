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
const migrationSource = await readFile(
  new URL("../drizzle/0062_joint_project_budget_period.sql", import.meta.url),
  "utf8",
);
const identityMigrationSource = await readFile(
  new URL("../drizzle/0063_joint_project_institution_key.sql", import.meta.url),
  "utf8",
);

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY,
      organization TEXT NOT NULL,
      business_round INTEGER NOT NULL,
      activity_date TEXT NOT NULL,
      budget_group_id INTEGER,
      budget_type TEXT NOT NULL
    );
    CREATE TABLE sales_campaigns (
      id INTEGER PRIMARY KEY,
      budget_group_id INTEGER,
      budget_type TEXT NOT NULL,
      selection_date TEXT NOT NULL
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
      budget_group_id INTEGER,
      budget_type TEXT NOT NULL,
      project_year INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE joint_project_members (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL,
      organization TEXT NOT NULL,
      institution_key TEXT NOT NULL DEFAULT '',
      business_round INTEGER NOT NULL,
      role TEXT NOT NULL,
      activity_id INTEGER,
      campaign_target_id INTEGER,
      updated_at TEXT NOT NULL
    );
    INSERT INTO activities VALUES
      (1, '괴산군청', 1, '2026-07-30', 10, '가상현실스포츠실'),
      (2, '괴산군청', 1, '2026-07-29', 10, '가상현실스포츠실'),
      (3, '괴산군청', 1, '2026-07-28', 20, '자체예산');
    INSERT INTO sales_campaigns VALUES
      (1, 10, '가상현실스포츠실', '2026-07-23'),
      (2, 20, '자체예산', '2026-07-23');
    INSERT INTO sales_campaign_targets VALUES
      (10, 1, '괴산군청', 1),
      (11, 1, '괴산군노인복지관', 1),
      (12, 2, '괴산군청', 1);
    INSERT INTO joint_projects VALUES
      (100, '괴산군 공동사업', 10, '가상현실스포츠실', 2026, 'active');
    INSERT INTO joint_project_members VALUES
      (1000, 100, '괴산군청', '괴산군청', 1, 'sponsor', 1, 10, '2026-07-30'),
      (1001, 100, '괴산군노인복지관', '괴산군노인복지관', 1, 'site', NULL, NULL, '2026-07-30');
  `);
  return db;
}

test("공동사업 연도·차수 마이그레이션은 기존 연결을 보존한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE joint_projects (
      id INTEGER PRIMARY KEY,
      budget_group_id INTEGER,
      status TEXT NOT NULL
    );
    INSERT INTO joint_projects VALUES (7, 10, 'active');
  `);
  db.exec(migrationSource);
  const row = db
    .prepare("SELECT id, project_year, joint_round FROM joint_projects WHERE id = 7")
    .get();
  assert.deepEqual({ ...row }, { id: 7, project_year: 0, joint_round: 1 });
  const indexes = db.prepare("PRAGMA index_list(joint_projects)").all();
  assert.ok(indexes.some((index) => index.name === "joint_projects_budget_period_idx"));
  db.close();
});

test("기관 식별키 마이그레이션은 기존 참여기관을 보존한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE joint_project_members (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL,
      organization TEXT NOT NULL,
      business_round INTEGER NOT NULL
    );
    INSERT INTO joint_project_members VALUES (5, 7, '수동면 생기발랄복지센터', 1);
  `);
  db.exec(identityMigrationSource);
  const row = db
    .prepare("SELECT id, organization, institution_key FROM joint_project_members WHERE id = 5")
    .get();
  assert.deepEqual(
    { ...row },
    { id: 5, organization: "수동면 생기발랄복지센터", institution_key: "" },
  );
  const indexes = db.prepare("PRAGMA index_list(joint_project_members)").all();
  assert.ok(indexes.some((index) => index.name === "joint_project_members_institution_idx"));
  db.close();
});

test("활동 공동사업 조회는 명시적으로 저장된 활동 ID만 사용한다", () => {
  assert.match(recordsSource, /linked\.activity_id\s*=\s*source_activity\.id/);
  assert.doesNotMatch(recordsSource, /linked\.organization\s*=\s*source_activity\.organization/);
  const db = database();
  const rows = db.prepare(`
    WITH joint_member_candidates AS (
      SELECT source_activity.id AS activity_id, linked.id AS member_id,
             ROW_NUMBER() OVER (PARTITION BY source_activity.id ORDER BY linked.id DESC) AS row_number
      FROM activities source_activity
      JOIN joint_project_members linked
        ON linked.activity_id = source_activity.id
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
    { id: 2, member_id: null },
    { id: 3, member_id: null },
  ]);
});

test("예산 명단 공동사업 조회는 명시적으로 저장된 선정명단 ID만 사용한다", () => {
  assert.match(campaignsSource, /linked\.campaign_target_id\s*=\s*source_target\.id/);
  assert.doesNotMatch(campaignsSource, /linked\.organization\s*=\s*source_target\.organization/);
  const db = database();
  const rows = db.prepare(`
    WITH joint_target_candidates AS (
      SELECT source_target.id AS target_id, linked.id AS member_id,
             ROW_NUMBER() OVER (PARTITION BY source_target.id ORDER BY linked.id DESC) AS row_number
      FROM sales_campaign_targets source_target
      JOIN joint_project_members linked
        ON linked.campaign_target_id = source_target.id
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
    { id: 11, member_id: null },
    { id: 12, member_id: null },
  ]);
});
