import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function sources() {
  const names = [
    "budgetNames",
    "budgetPolicy",
    "migration",
    "recordsStore",
    "recordsRoute",
    "equipmentRoute",
    "equipmentStore",
    "activityCsv",
    "catalogRoute",
    "adminRoute",
    "activityChanges",
  ];
  const paths = [
    "../lib/budget-names.ts",
    "../lib/budget-policy.ts",
    "../drizzle/0051_standard_budget_catalog.sql",
    "../lib/records-store.ts",
    "../app/api/records/route.ts",
    "../app/api/equipment/route.ts",
    "../lib/equipment-store.ts",
    "../lib/activity-csv.ts",
    "../app/api/budget-catalog/route.ts",
    "../app/api/budget-names/route.ts",
    "../app/api/activity-changes/route.ts",
  ];
  const values = await Promise.all(
    paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}

test("standard budget schema is additive and preserves financial ledgers", async () => {
  const { migration } = await sources();
  for (const column of [
    "budget_original_name",
    "budget_group_id",
    "budget_match_status",
    "budget_match_method",
    "budget_request_id",
    "budget_kind",
    "budget_amount_mode",
    "budget_amount_override",
  ]) {
    assert.match(migration, new RegExp(`ADD \\\`${column}\\\``));
  }
  assert.match(migration, /CREATE TABLE `budget_name_requests`/);
  assert.match(migration, /CREATE TABLE `budget_name_request_records`/);
  assert.match(
    migration,
    /'지능형과학실', '공간재구조화', '가상현실스포츠실'/,
  );
  assert.match(migration, /'자체예산'.*'self'.*'quote_auto'/s);
  assert.doesNotMatch(
    migration,
    /UPDATE\s+(commission_collections|equipment_items|collection_entries)/i,
  );
});

test("retrofit is exact, audited, idempotent, and excludes outside awards", async () => {
  const { budgetNames } = await sources();
  assert.match(budgetNames, /let budgetNamesReadyPromise:/);
  assert.match(
    budgetNames,
    /budgetNamesReadyPromise = initializeBudgetNames\(\)\.catch/,
  );
  assert.match(budgetNames, /duplicate column/);
  assert.match(budgetNames, /system-standard-budget-retrofit-v1/);
  assert.match(
    budgetNames,
    /COALESCE\(award_status, '미정'\)[\s\S]{0,100}NOT IN \('협력사 수주', '타업체 수주'\)/,
  );
  assert.match(
    budgetNames,
    /p\.activity_id IS NULL[\s\S]{0,180}NOT IN \('협력사 수주', '타업체 수주'\)/,
  );
  assert.match(budgetNames, /matchMethod: unique\.size > 1 \? "ambiguous"/);
  assert.match(budgetNames, /matchStatus: unique\.size > 1 \? "review"/);
  assert.match(budgetNames, /preservedFinancialFields/);
  assert.match(budgetNames, /기존 예산명 자동 연결: 영업/);
});

test("self-budget placeholder amounts are missing, while numeric values stay manual", async () => {
  const { budgetPolicy, budgetNames, activityCsv } = await sources();
  assert.match(budgetPolicy, /const missingBudgetAmountKeys = new Set/);
  for (const placeholder of [
    "미정",
    "미등록",
    "확인필요",
    "예산미정",
    "금액미정",
  ]) {
    assert.match(budgetPolicy, new RegExp(`"${placeholder}"`));
  }
  assert.match(budgetPolicy, /return \/\\d\/\.test\(text\)/);
  assert.match(
    budgetNames,
    /meaningfulBudgetAmount\(row\.budgetAmountOverride\)/,
  );
  assert.match(
    budgetNames,
    /resolution\.budgetKind === "self" && !manualValue/,
  );
  assert.match(activityCsv, /meaningfulBudgetAmount\(row\.budgetAmount\)/);
  assert.match(activityCsv, /\? "manual"\s*: "missing"/);
});

test("all activity, equipment, AI, CSV and undo writes use common metadata", async () => {
  const source = await sources();
  assert.match(source.recordsStore, /resolveBudgetRecordMetadata\(d1,/);
  assert.match(source.recordsStore, /budget_original_name, budget_group_id/);
  assert.match(source.recordsRoute, /resolveBudgetRecordMetadata\(d1,/);
  assert.match(source.recordsRoute, /budget_amount_override = \?/);
  assert.match(
    source.recordsRoute,
    /award_status IN \('협력사 수주', '타업체 수주'\) THEN budget_type/,
  );
  assert.match(source.equipmentRoute, /resolveBudgetRecordMetadata\(d1,/);
  assert.match(source.equipmentRoute, /budget_original_name, budget_group_id/);
  assert.match(source.equipmentStore, /resolveBudgetRecordMetadata\(d1,/);
  assert.match(source.activityCsv, /budget_match_status, budget_match_method/);
  assert.match(source.activityChanges, /resolveBudgetRecordMetadata\(d1,/);
  assert.match(source.activityChanges, /budget_amount_override = \?/);
});

test("manual record and bulk edits reject unregistered budget names", async () => {
  const { recordsRoute } = await sources();
  assert.match(recordsRoute, /payload\.standardBudgetOnly === true/);
  assert.match(
    recordsRoute,
    /관리자가 등록한 활성 표준 예산명을 선택해 주세요/,
  );
  assert.match(
    recordsRoute,
    /resolveCanonicalBudgetName\([\s\S]*!resolvedBudget\.groupId/,
  );
});

test("standard default budget fills only institution records without a manual amount", async () => {
  const { budgetNames } = await sources();
  assert.match(
    budgetNames,
    /default_amount AS defaultAmount[\s\S]*standardDefaultBudgetAmount/,
  );
  assert.match(
    budgetNames,
    /institutionAmount \|\|[\s\S]{0,100}standardDefaultBudgetAmount/,
  );
  assert.match(
    budgetNames,
    /COALESCE\(budget_amount, ''\) NOT GLOB '\*\[0-9\]\*'[\s\S]{0,180}COALESCE\(budget_amount_override, ''\) NOT GLOB '\*\[0-9\]\*'/,
  );
  assert.match(
    budgetNames,
    /g\.amount_mode = 'manual'[\s\S]{0,100}g\.default_amount > 0/,
  );
});

test("employee requests and manager decisions retain history and group duplicates", async () => {
  const { budgetNames, catalogRoute, adminRoute } = await sources();
  assert.match(catalogRoute, /submitBudgetNameRequest/);
  assert.match(catalogRoute, /BudgetRequestSuggestionError/);
  assert.match(catalogRoute, /status: 409/);
  assert.match(budgetNames, /confirmNoExistingMatch/);
  assert.match(
    budgetNames,
    /협력사 수주와 타업체 수주는 표준 예산명 신청 대상이 아닙니다/,
  );
  assert.match(budgetNames, /\? `open:\$\{String\(row\.requestedKey/);
  assert.match(budgetNames, /retrofitExisting: false/);
  assert.match(budgetNames, /directlyLinkedRecords/);
  assert.match(budgetNames, /if \(!storedRecords\.length\)/);
  assert.match(budgetNames, /organization: String\(row\.organization/);
  assert.match(budgetNames, /previewBudgetRetrofit/);
  assert.match(budgetNames, /resolvedGroupId/);
  for (const action of [
    "create-standard",
    "add-alias",
    "set-active",
    "connect-existing",
    "process-request",
    "preview-retrofit",
    "apply-retrofit",
  ]) {
    assert.match(adminRoute, new RegExp(`"${action}"`));
  }
});

test("unclassified list is driven by actual unresolved metadata", async () => {
  const { budgetNames } = await sources();
  assert.match(
    budgetNames,
    /budget_group_id IS NULL[\s\S]{0,100}IN \('review', 'unclassified', 'legacy'\)/,
  );
  assert.match(
    budgetNames,
    /p\.budget_group_id IS NULL[\s\S]{0,110}IN \('review', 'unclassified', 'legacy'\)/,
  );
  assert.doesNotMatch(
    budgetNames,
    /budget_group_id IS NULL\s+OR budget_match_status <> 'auto'/,
  );
});
