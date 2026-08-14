import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./typescript-resolver.mjs", import.meta.url));
register(new URL("./joint-project-store-test-resolver.mjs", import.meta.url));

class JointProjectStatement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new JointProjectStatement(this.database, this.sql, bindings);
  }

  async all() {
    this.database.executed.push(this);
    if (/^\s*SELECT 1/.test(this.sql)) return { results: [] };
    if (/FROM sales_campaign_targets t/.test(this.sql)) {
      this.database.campaignLookupStatements.push(this);
      return { results: [] };
    }
    throw new Error(`Unexpected all query: ${this.sql}`);
  }

  async first() {
    this.database.executed.push(this);
    if (/FROM budget_name_groups/.test(this.sql)) {
      return {
        id: 15,
        canonical_name: "가상현실스포츠실",
        budget_kind: "purpose",
        amount_mode: "fixed",
        default_amount: null,
      };
    }
    if (/FROM app_settings/.test(this.sql)) return null;
    if (/FROM activities/.test(this.sql) && /WHERE id = \?/.test(this.sql)) {
      const id = Number(this.bindings[0]);
      const organization = id === 101 ? "부산 강서구청" : "설치기관 A";
      return {
        id,
        organization,
        business_round: 1,
        activity_date: "2026-08-14",
        budget_group_id: 15,
        budget_type: "가상현실스포츠실",
        budget_amount: "0",
        budgets_json: "[]",
        award_status: "위즈업 수주",
      };
    }
    if (/FROM joint_project_members jpm/.test(this.sql)) return null;
    throw new Error(`Unexpected first query: ${this.sql}`);
  }

  async run() {
    this.database.executed.push(this);
    if (/INSERT INTO joint_projects/.test(this.sql)) {
      this.database.projectInsert = this;
      return { results: [{ id: 77 }], meta: { changes: 1 } };
    }
    if (/INSERT INTO joint_project_members/.test(this.sql)) {
      this.database.memberInserts.push(this);
      return { results: [], meta: { changes: 1 } };
    }
    if (/INSERT INTO joint_project_events/.test(this.sql)) {
      this.database.eventInsert = this;
      return { results: [], meta: { changes: 1 } };
    }
    throw new Error(`Unexpected run query: ${this.sql}`);
  }
}

class JointProjectDatabase {
  constructor() {
    this.executed = [];
    this.campaignLookupStatements = [];
    this.projectInsert = null;
    this.memberInserts = [];
    this.eventInsert = null;
  }

  prepare(sql) {
    return new JointProjectStatement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

const database = new JointProjectDatabase();
globalThis.__jointProjectTestDb = database;
const { createJointProject } = await import("../lib/joint-projects.ts");

test("공동사업 PostgreSQL 저장은 예산 ID 타입을 확정하고 빈 메모까지 보존한다", async () => {
  const projectId = await createJointProject(
    {
      budgetGroupId: 15,
      projectYear: 2026,
      jointRound: 1,
      sponsorOrganization: "부산 강서구청",
      notes: "",
      members: [
        {
          organization: "부산 강서구청",
          businessRound: 1,
          activityId: 101,
        },
        {
          organization: "설치기관 A",
          businessRound: 1,
          activityId: 102,
          budgetAmount: 120_000_000,
        },
      ],
    },
    { id: 9, displayName: "테스트 관리자" },
  );

  assert.equal(projectId, 77);
  assert.equal(database.campaignLookupStatements.length, 2);
  for (const statement of database.campaignLookupStatements) {
    assert.match(statement.sql, /\?::bigint IS NOT NULL/);
    assert.match(statement.sql, /c\.budget_group_id = \?::bigint/);
    assert.match(statement.sql, /\?::bigint IS NULL/);
    assert.match(statement.sql, /c\.budget_type = \?::text/);
    assert.deepEqual(statement.bindings, [1, 15, 15, 15, "가상현실스포츠실"]);
  }

  assert.match(database.projectInsert.sql, /RETURNING id/);
  assert.deepEqual(database.projectInsert.bindings, [
    "부산 강서구청 · 가상현실스포츠실 · 2026년 1차",
    "부산 강서구청",
    null,
    15,
    "가상현실스포츠실",
    2026,
    1,
    "",
    9,
  ]);
  assert.deepEqual(
    database.memberInserts.map((statement) => statement.bindings),
    [
      [77, "부산 강서구청", "부산 강서구청", 1, "sponsor", 101, null, null],
      [77, "설치기관 A", "설치기관 A", 1, "site", 102, null, 120_000_000],
    ],
  );
  const event = JSON.parse(database.eventInsert.bindings[1]);
  assert.equal(event.sponsorOrganization, "부산 강서구청");
  assert.equal(event.budgetGroupId, 15);
  assert.equal(event.budgetType, "가상현실스포츠실");
  assert.equal(event.projectYear, 2026);
  assert.equal(event.jointRound, 1);
  assert.deepEqual(event.members.map((member) => member.organization), [
    "부산 강서구청",
    "설치기관 A",
  ]);
  assert.equal(
    database.executed.some((statement) => /(?:UPDATE|DELETE)\s+activities/i.test(statement.sql)),
    false,
  );
});
