import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("workspace exposes one institution-budget center in the final menu order", async () => {
  const crm = await source("../app/crm-app.tsx");
  const order = [
    'label: "대시보드"',
    'label: "기관·예산 관리"',
    'label: "공간재구조화 사업 관리"',
    'label: "견적·제품·협력사 관리"',
    'label: "자료실"',
    'label: "영업·수주 지도"',
  ].map((needle) => crm.indexOf(needle));
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(crm, /institution-budget-center-tabs/);
  assert.match(crm, /기관 중심/);
  assert.match(crm, /예산 중심/);
});

test("admin center keeps the four existing permission keys and legacy views", async () => {
  const crm = await source("../app/crm-app.tsx");
  for (const [key, label] of [
    ["members:manage", "구성원·권한 관리"],
    ["integration:manage", "API·연동 관리"],
    ["trash:manage", "변경 복구 관리"],
    ["backup:manage", "DB 백업 관리"],
  ]) {
    assert.match(crm, new RegExp(`${key}[\\s\\S]{0,100}${label}`));
  }
  assert.match(crm, /const isAdminCenterView/);
  assert.match(crm, /renderAdminCenterTabs/);
});

test("standard budget creation uses returned ids and repairs partial saves idempotently", async () => {
  const budgets = await source("../lib/budget-names.ts");
  assert.match(budgets, /RETURNING id/);
  assert.match(budgets, /result\.results\?\.\[0\]/);
  assert.match(budgets, /result\.meta\.last_row_id/);
  assert.match(budgets, /ensureStandardBudgetCompanions/);
  assert.match(budgets, /repairExistingStandardBudgetCompanions/);
  assert.match(budgets, /WHERE NOT EXISTS \([\s\S]*action = 'create-standard'/);
  assert.match(budgets, /defaultAmountValue[\s\S]{0,160}: null/);
});

test("budget manager initializes the latest D1 schema and uses PostgreSQL-safe detail ordering", async () => {
  const budgets = await source("../lib/budget-names.ts");
  assert.match(budgets, /budget_names_runtime_ready_v76/);
  assert.match(
    budgets,
    /ORDER BY COALESCE\(a\.activity_date, p\.updated_at, p\.created_at\) DESC/,
  );
  assert.doesNotMatch(budgets, /ORDER BY recordDate DESC/);
});

test("standard budget history is shown only in admin recovery with safe undo checks", async () => {
  const budgets = await source("../lib/budget-names.ts");
  const route = await source("../app/api/budget-names/route.ts");
  const manager = await source("../app/budget-name-manager.tsx");
  const recovery = await source("../app/budget-history-panel.tsx");
  const backupPage = await source("../app/data-backup-page.tsx");
  assert.doesNotMatch(manager, /tab === "history"/);
  assert.match(manager, /변경 이력 보기/);
  assert.match(route, /view === "history"/);
  assert.match(route, /requireMemberPermission\("trash:manage"\)/);
  assert.match(budgets, /listBudgetNameHistory/);
  assert.match(budgets, /budget_name_deleted_audit/);
  assert.match(budgets, /id > \?/);
  assert.match(budgets, /restoreStatus: "복원 불가"/);
  assert.match(recovery, /변경 전·후 및 영향 상세보기/);
  assert.match(backupPage, /표준 예산명/);
});

test("budget audit and review exclusion tables exist in both deployment schemas", async () => {
  const sqliteSchema = await source("../db/schema.ts");
  const vercelSchema = await source("../db/vercel-schema.ts");
  const backup = await source("../lib/backup-store.ts");
  for (const table of ["budget_name_deleted_audit", "budget_name_review_exclusions"]) {
    assert.match(sqliteSchema, new RegExp(table));
    assert.match(vercelSchema, new RegExp(table));
    assert.match(backup, new RegExp(table));
  }
  assert.match(backup, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(backup, /ON CONFLICT \(entity_type, entity_id\) DO UPDATE/);
  assert.doesNotMatch(backup, /DELETE FROM budget_name_(?:deleted_audit|review_exclusions)/);
});

test("permanent delete rechecks references, snapshots audit, and requires exact confirmation", async () => {
  const budgets = await source("../lib/budget-names.ts");
  const route = await source("../app/api/budget-names/route.ts");
  const manager = await source("../app/budget-name-manager.tsx");
  assert.match(budgets, /previewPermanentStandardBudgetDelete/);
  assert.match(budgets, /const rechecked = await previewPermanentStandardBudgetDelete/);
  assert.match(budgets, /budget_name_deleted_audit/);
  assert.match(budgets, /confirmationName/);
  assert.match(route, /preview-permanent-delete/);
  assert.match(route, /permanent-delete/);
  assert.match(manager, /복구 불가 확인 후 영구 삭제/);
});

test("unclassified review exclusions are entity-scoped and never rewrite originals", async () => {
  const budgets = await source("../lib/budget-names.ts");
  const manager = await source("../app/budget-name-manager.tsx");
  assert.match(budgets, /budget_name_review_exclusions/);
  assert.match(budgets, /entity_type[\s\S]{0,80}entity_id/);
  assert.match(budgets, /exclude-review/);
  assert.match(budgets, /restore-review/);
  assert.match(budgets, /reviewDetailsAvailable/);
  assert.match(manager, /원본 연결 상세를 불러오지 못해 제외·복원할 수 없습니다/);
  assert.doesNotMatch(manager, /if \(!details\.length\) return/);
});

test("construction candidates are progressive and owner-only hide restore is server checked", async () => {
  const page = await source("../app/construction-schedule-page.tsx");
  const route = await source("../app/api/schedules/route.ts");
  const store = await source("../lib/organization-schedules.ts");
  assert.match(page, /addVisibleCount/);
  assert.match(page, /setAddVisibleCount\(\(current\) => current \+ 30\)/);
  assert.match(page, /숨긴 기관 관리/);
  assert.match(route, /isPrimaryOwner/);
  assert.match(store, /candidate-hidden/);
  assert.match(store, /setConstructionScheduleCandidateHidden/);
});

test("legacy merge recovery API remains but its daily budget manager UI is removed", async () => {
  const manager = await source("../app/budget-name-manager.tsx");
  const route = await source("../app/api/admin/legacy-source-merge/route.ts");
  assert.doesNotMatch(manager, /원본 데이터 안전 비교·병합/);
  assert.doesNotMatch(manager, /백업 후 누락 병합/);
  assert.match(route, /legacy/i);
});
