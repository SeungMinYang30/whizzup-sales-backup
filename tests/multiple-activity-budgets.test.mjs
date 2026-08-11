import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  activityBudgetsFromRecord,
  canonicalBusinessRoundBudgets,
  parseBudgetMoney,
  parseStoredActivityBudgetMoney,
  serializeActivityBudgets,
  summarizeActivityBudgets,
} from "../lib/activity-budgets.ts";
import { resolveUniqueExistingInstitutionName } from "../lib/institution-names.ts";

const crmSource = await readFile(
  new URL("../app/crm-app.tsx", import.meta.url),
  "utf8",
);

test("keeps multiple budgets in one activity while retaining the legacy primary budget", () => {
  const budgets = activityBudgetsFromRecord({
    budget_type: "지능형 과학실",
    budget_amount: "1억 5,800만원",
    budget_group_id: 3,
    budgets_json: JSON.stringify([
      {
        budgetType: "지능형 과학실",
        budgetAmount: "1억 5,800만원",
        budgetGroupId: 3,
      },
      {
        budgetType: "스마트 체험교실",
        budgetAmount: "4,200만원",
        budgetGroupId: 6,
      },
    ]),
  });

  assert.deepEqual(
    budgets.map((budget) => budget.budgetType),
    ["지능형 과학실", "스마트 체험교실"],
  );
  assert.equal(parseBudgetMoney(budgets[0].budgetAmount), 158_000_000);
  assert.equal(parseBudgetMoney(budgets[1].budgetAmount), 42_000_000);
  assert.equal(JSON.parse(serializeActivityBudgets(budgets)).length, 2);
  assert.deepEqual(summarizeActivityBudgets(budgets), {
    names: ["지능형 과학실", "스마트 체험교실"],
    totalAmount: 200_000_000,
    enteredAmountCount: 2,
    missingAmountCount: 0,
  });
});

test("stored activity budgets preserve the legacy man-won convention only when the unit is omitted", () => {
  assert.equal(parseStoredActivityBudgetMoney("5000"), 50_000_000);
  assert.equal(parseStoredActivityBudgetMoney("5,000만원"), 50_000_000);
  assert.equal(parseStoredActivityBudgetMoney("5천만원"), 50_000_000);
  assert.equal(parseStoredActivityBudgetMoney("50,000,000"), 50_000_000);
  assert.equal(parseStoredActivityBudgetMoney("5,000원"), 5_000);
});

test("multiple budget summary reports only actionable missing amounts", () => {
  const budgets = activityBudgetsFromRecord({
    budgets_json: JSON.stringify([
      { budgetType: "지능형 과학실", budgetAmount: "1억" },
      { budgetType: "스마트 체험교실", budgetAmount: "" },
    ]),
  });
  assert.deepEqual(summarizeActivityBudgets(budgets), {
    names: ["지능형 과학실", "스마트 체험교실"],
    totalAmount: 100_000_000,
    enteredAmountCount: 1,
    missingAmountCount: 1,
  });
});

test("a later AI single-budget record cannot hide an earlier confirmed multi-budget round", () => {
  const canonical = canonicalBusinessRoundBudgets([
    {
      source_chat: "사이트 AI 입력",
      budget_type: "지능형 과학실",
      budget_amount: "1억",
      budgets_json: JSON.stringify([
        { budgetType: "지능형 과학실", budgetAmount: "1억" },
      ]),
    },
    {
      source_chat: "직접 입력",
      budget_type: "지능형 과학실",
      budget_amount: "1억",
      budgets_json: JSON.stringify([
        { budgetType: "지능형 과학실", budgetAmount: "1억" },
        { budgetType: "스마트 체험교실", budgetAmount: "5,800만원" },
      ]),
    },
  ]);

  assert.deepEqual(
    canonical.map((budget) => budget.budgetType),
    ["지능형 과학실", "스마트 체험교실"],
  );
  assert.equal(summarizeActivityBudgets(canonical).totalAmount, 158_000_000);
});

test("when a round has only single budgets the newest valid value becomes canonical", () => {
  const canonical = canonicalBusinessRoundBudgets([
    { budget_type: "스마트 체험교실", budget_amount: "5,800만원" },
    { budget_type: "지능형 과학실", budget_amount: "1억" },
  ]);
  assert.deepEqual(
    canonical.map((budget) => budget.budgetType),
    ["스마트 체험교실"],
  );
});

test("a unique same-region abbreviated institution can preview the existing round budgets", () => {
  const resolved = resolveUniqueExistingInstitutionName(
    { organization: "모담초중학교", region: "김포" },
    [
      { organization: "김포 모담초중학교", region: "경기 김포" },
      { organization: "성남초등학교 병설유치원", region: "부산 동" },
    ],
  );
  assert.equal(resolved, "김포 모담초중학교");
});

test("a unique school suffix without a region reuses the full existing institution", () => {
  const resolved = resolveUniqueExistingInstitutionName(
    { organization: "도수초등학교", region: "" },
    [
      { organization: "경기도 광주 도수초등학교", region: "경기 광주" },
      { organization: "하남초등학교", region: "경기 하남" },
    ],
  );
  assert.equal(resolved, "경기도 광주 도수초등학교");
});

test("an ambiguous abbreviated institution never inherits another institution's budgets", () => {
  const resolved = resolveUniqueExistingInstitutionName(
    { organization: "중앙초등학교", region: "" },
    [
      { organization: "서울 중앙초등학교", region: "서울 종로" },
      { organization: "부산 중앙초등학교", region: "부산 중" },
    ],
  );
  assert.equal(resolved, "");
});

test("pre- and post-award lists show compact budget names and amounts without replacing contract amounts", () => {
  assert.match(crmSource, /예산 · 금액/);
  assert.match(crmSource, /names\.length > 1[\s\S]*외 \$\{names\.length - 1\}개/);
  assert.match(crmSource, /className="budget-amount"/);
  assert.match(crmSource, />계약금액</);
  assert.match(crmSource, /title=\{compactBudgetDisplayForRecord\(record\)\.title\}/);
});

test("the one-time SQL retrofit preserves the confirmed multi-budget round atomically", async () => {
  const recordsStore = await readFile(
    new URL("../lib/records-store.ts", import.meta.url),
    "utf8",
  );
  const retrofitStart = recordsStore.indexOf("const canonicalRounds = `");
  const retrofitEnd = recordsStore.indexOf(
    "async function enrichInstitutionMatchCandidates",
    retrofitStart,
  );
  assert.ok(retrofitStart >= 0 && retrofitEnd > retrofitStart);
  const retrofitSource = recordsStore.slice(retrofitStart, retrofitEnd);
  const cte = retrofitSource.match(/const canonicalRounds = `([\s\S]*?)`;/)?.[1];
  const update = retrofitSource.match(
    /d1\.prepare\(\s*`\$\{canonicalRounds\}([\s\S]*?)`,\s*\),/,
  )?.[1];
  const deactivate = retrofitSource.match(
    /d1\.prepare\(\s*`(UPDATE budget_name_members[\s\S]*?)`,\s*\),/,
  )?.[1];
  const relink = retrofitSource.match(
    /d1\.prepare\(\s*`(INSERT INTO budget_name_members[\s\S]*?)`,\s*\),/,
  )?.[1];
  assert.ok(cte && update && deactivate && relink);

  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization TEXT,
      business_round INTEGER,
      activity_date TEXT,
      budget_type TEXT,
      budget_amount TEXT,
      budget_original_name TEXT,
      budget_group_id INTEGER,
      budget_match_status TEXT,
      budget_match_method TEXT,
      budget_request_id INTEGER,
      budget_kind TEXT,
      budget_amount_mode TEXT,
      budget_amount_override TEXT,
      budgets_json TEXT,
      award_status TEXT
    );
    CREATE TABLE budget_name_members (
      group_id INTEGER,
      entity_type TEXT,
      entity_id INTEGER,
      original_name TEXT,
      alias_key TEXT,
      active INTEGER,
      linked_at TEXT,
      unlinked_at TEXT,
      UNIQUE(entity_type, entity_id)
    );
  `);
  const insertActivity = db.prepare(`
    INSERT INTO activities (
      organization, business_round, activity_date, budget_type, budget_amount,
      budget_original_name, budget_group_id, budget_match_status,
      budget_match_method, budget_kind, budget_amount_mode,
      budget_amount_override, budgets_json, award_status
    ) VALUES (?, 1, ?, ?, ?, ?, ?, 'matched', 'manual', '목적예산',
              'direct', '', ?, '위즈업 수주')
  `);
  const multi = JSON.stringify([
    { budgetType: "지능형 과학실", budgetAmount: "1억", budgetGroupId: 3 },
    {
      budgetType: "스마트 체험교실",
      budgetAmount: "5,800만원",
      budgetGroupId: 6,
    },
  ]);
  const single = JSON.stringify([
    { budgetType: "지능형 과학실", budgetAmount: "1억", budgetGroupId: 3 },
  ]);
  insertActivity.run(
    "김포 모담초중학교",
    "2026-07-30",
    "지능형 과학실",
    "1억",
    "지능형 과학실",
    3,
    multi,
  );
  insertActivity.run(
    "김포 모담초중학교",
    "2026-07-31",
    "지능형 과학실",
    "1억",
    "지능형 과학실",
    3,
    single,
  );
  db.exec(`${cte}${update}`);
  db.exec(deactivate);
  db.exec(relink);

  const rows = db
    .prepare("SELECT budgets_json FROM activities ORDER BY id")
    .all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => JSON.parse(row.budgets_json).length === 2));
  const links = db
    .prepare(
      "SELECT group_id, active FROM budget_name_members ORDER BY entity_id",
    )
    .all()
    .map((row) => ({ group_id: row.group_id, active: row.active }));
  assert.deepEqual(links, [
    { group_id: 3, active: 1 },
    { group_id: 3, active: 1 },
  ]);
  db.close();
});

test("record editor, persistence, filters, analytics and detail return share multi-budget support", async () => {
  const [crm, styles, recordsStore, recordsRoute, accounting, analytics, schema, backup] =
    await Promise.all([
      readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
      readFile(new URL("../lib/records-store.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/accounting/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/analytics-page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/backup-store.ts", import.meta.url), "utf8"),
    ]);

  assert.match(crm, /\+ 예산 추가/);
  assert.match(crm, /form\.budgets\.map/);
  assert.match(crm, /detailInlineDraft\.budgets\.map/);
  assert.match(crm, /budgetNamesForRecord\(record\)/);
  assert.match(crm, /canonicalBudgetsForBusinessRound/);
  assert.match(crm, /resolveUniqueExistingInstitutionName/);
  assert.match(crm, /editingId \|\| hasActivityDetailDraft\(form\)/);
  assert.match(crm, /isDerivedBudgetDetailFact/);
  assert.match(crm, /기존 예산과/);
  assert.match(crm, /syncBusinessRoundBudgets: field === "budget"/);
  assert.match(crm, /activityDetailFactsForRecord/);
  assert.match(crm, /activityDetailSectionsForRecord/);
  assert.match(crm, /금액 미입력/);
  assert.doesNotMatch(crm, /기관 확인 직접 입력값/);
  assert.doesNotMatch(crm, /자체예산 직접 입력값/);
  assert.match(crm, /상세 기록 보기/);
  assert.match(crm, /history-primary-action/);
  assert.match(styles, /activity-budget-editor/);
  assert.match(styles, /record-detail-return-button/);
  assert.match(recordsStore, /budgets_json TEXT NOT NULL DEFAULT '\[\]'/);
  assert.match(recordsStore, /resolveActivityBudgetAllocations/);
  assert.match(recordsStore, /budgets_json AS budgetsJson/);
  assert.match(recordsStore, /budgetsJson: previousBudgetsJson/);
  assert.match(recordsStore, /retrofit:business_round_budget_consistency:v1/);
  assert.match(recordsStore, /single-d1-batch/);
  assert.match(recordsStore, /synchronizeBusinessRoundBudgets/);
  assert.match(recordsStore, /sourceChat === "사이트 AI 입력"/);
  assert.match(recordsRoute, /budgets_json = \?/);
  assert.match(recordsRoute, /payload\.syncBusinessRoundBudgets === true/);
  assert.match(accounting, /a\.budgets_json/);
  assert.match(analytics, /aggregateAwardsByBudget/);
  assert.match(analytics, /복수 예산 사업은 입력한 예산금액 비율/);
  assert.match(schema, /budgetsJson: text\("budgets_json"\)/);
  assert.match(backup, /"budgets_json"/);
});
