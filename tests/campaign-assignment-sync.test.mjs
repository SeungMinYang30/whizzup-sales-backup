import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildCampaignAssignmentBackfillStatements } from "../lib/campaign-institution-basics.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("예산별 기관과 기관별 관리 담당자를 같은 사업 차수 안에서 소급 동기화한다", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE members (
      id INTEGER PRIMARY KEY,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      is_sales INTEGER NOT NULL
    );
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY,
      activity_date TEXT NOT NULL,
      organization TEXT NOT NULL,
      business_round INTEGER NOT NULL,
      progress_manager TEXT NOT NULL DEFAULT '',
      progress_manager_locked INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sales_campaign_targets (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER NOT NULL,
      organization TEXT NOT NULL,
      business_round INTEGER NOT NULL,
      assigned_member_id INTEGER,
      activity_id INTEGER,
      updated_at TEXT NOT NULL
    );

    INSERT INTO members (id, display_name, status, is_sales) VALUES
      (1, '김동훈 과장', 'approved', 1),
      (2, '양승민 이사', 'approved', 1);

    INSERT INTO activities (
      id, activity_date, organization, business_round,
      progress_manager, progress_manager_locked, updated_at
    ) VALUES
      (1, '2026-07-20', '예산우선기관', 1, '', 0, '2026-07-20 00:00:00'),
      (2, '2026-07-30', '예산우선기관', 1, '', 0, '2026-07-30 00:00:00'),
      (3, '2026-07-30', '기관관리우선기관', 1, '양승민 이사', 1, '2026-07-31 12:00:00'),
      (4, '2026-07-30', '기관관리우선기관', 2, '김동훈 과장', 1, '2026-07-31 12:00:00');

    INSERT INTO sales_campaign_targets (
      id, campaign_id, organization, business_round,
      assigned_member_id, activity_id, updated_at
    ) VALUES
      (11, 1, '예산우선기관', 1, 1, 1, '2026-07-31 10:00:00'),
      (12, 1, '기관관리우선기관', 1, 1, 3, '2026-07-30 10:00:00'),
      (13, 1, '기관관리우선기관', 2, NULL, 4, '2026-07-30 10:00:00');
  `);

  for (const statement of buildCampaignAssignmentBackfillStatements()) {
    database.exec(statement);
  }

  const budgetWins = database
    .prepare(
      `SELECT progress_manager, progress_manager_locked
       FROM activities WHERE id = 2`,
    )
    .get();
  assert.deepEqual({ ...budgetWins }, {
    progress_manager: "김동훈 과장",
    progress_manager_locked: 0,
  });

  const institutionWins = database
    .prepare(
      `SELECT assigned_member_id
       FROM sales_campaign_targets WHERE id = 12`,
    )
    .get();
  assert.equal(institutionWins.assigned_member_id, 2);

  const otherRound = database
    .prepare(
      `SELECT assigned_member_id
       FROM sales_campaign_targets WHERE id = 13`,
    )
    .get();
  assert.equal(otherRound.assigned_member_id, 1);

  const olderLinkedActivity = database
    .prepare(
      `SELECT progress_manager
       FROM activities WHERE id = 1`,
    )
    .get();
  assert.equal(olderLinkedActivity.progress_manager, "");
});

test("담당자 단건 변경도 두 화면의 데이터를 함께 새로고침한다", async () => {
  const map = await source("../app/sales-map.tsx");
  assert.match(
    map,
    /await Promise\.all\(\[loadCampaigns\(\), onRecordsChanged\(\)\]\)/,
  );
});

test("기관별 관리 담당자 변경은 예산별 기관 연결에도 반영한다", async () => {
  const [assignment, recordsRoute] = await Promise.all([
    source("../lib/activity-assignment-history.ts"),
    source("../app/api/records/route.ts"),
  ]);
  assert.match(assignment, /syncCampaignTargetsFromActivity\(d1, activityId\)/);
  assert.match(
    recordsRoute,
    /progressManagerChanged[\s\S]*syncCampaignTargetsFromActivity/,
  );
});
