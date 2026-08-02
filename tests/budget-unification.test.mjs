import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses one budget and one budget amount across UI and file exchange", async () => {
  const [
    crm,
    styles,
    xlsx,
    csv,
    recordsRoute,
    budgetNames,
    accountingRoute,
    analyticsPage,
    budgetSelector,
    budgetManager,
  ] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/activity-xlsx.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/activity-csv.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/budget-names.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/accounting/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/analytics-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/budget-name-selector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/budget-name-manager.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(crm, /<th>원문 예산<\/th>/);
  assert.match(crm, /<th>표준 예산<\/th>/);
  assert.match(crm, /<th>예산금액<\/th>/);
  assert.match(crm, /<span>예산명<\/span>/);
  assert.match(crm, /<span>예산금액<\/span>/);
  assert.match(crm, /<BudgetNameSelector/);
  assert.match(crm, /품목 합계로 다시 계산/);
  assert.match(crm, /budgetAmountDisplayForRecord/);
  assert.match(budgetSelector, /\+ 새 예산명 신청/);
  assert.match(budgetSelector, /confirmNoExistingMatch/);
  assert.match(budgetManager, /표준 예산명 사전등록/);
  assert.match(budgetManager, /신청 대기/);
  assert.match(crm, /<h3>품목 관리<\/h3>/);
  assert.doesNotMatch(crm, /<h3>사업·품목 관리<\/h3>/);
  assert.doesNotMatch(crm, /equipment-project-amount/);

  assert.match(xlsx, /\["budgetType", "예산"/);
  assert.match(xlsx, /\["budgetAmount", "예산금액"/);
  assert.match(xlsx, /findIndex\("예산", "예산명", "예산 종류", "budget_type"\)/);
  assert.match(xlsx, /findIndex\("예산금액", "예산 금액", "budget_amount"\)/);
  assert.match(csv, /"예산",\s*"예산금액"/);
  assert.match(csv, /get\(cells, "예산", "예산명", "예산 종류", "budget_type"\)/);
  assert.match(csv, /resolveBudgetRecordMetadata\(d1,/);
  assert.match(csv, /resolvedBudget\.storedName/);

  assert.match(crm, /toggleInstitutionBulkEditor/);
  assert.match(crm, /onlyEmpty: false/);
  assert.doesNotMatch(crm, /institutionBudgetOnlyEmpty/);
  assert.doesNotMatch(crm, /미등록 항목에만 입력/);
  assert.match(crm, /수정 대상/);
  assert.match(crm, /selectedInstitutionNames/);
  assert.match(crm, /data-list-workspace/);
  assert.match(crm, /table-header-dock/);
  assert.match(styles, /\.table-header-dock\.visible \{ display: block/);
  assert.match(styles, /\.data-list-workspace \{ min-height: 0; max-height: none; overflow: visible/);
  assert.doesNotMatch(styles, /\.data-list-table \{ max-height: min\(/);
  assert.match(recordsRoute, /NOT IN \('', '미정', '예산'\)/);
  assert.match(recordsRoute, /NOT IN \('', '미정'\)/);

  assert.match(budgetNames, /system-normalize-virtual-sports-budget-v1/);
  assert.match(budgetNames, /const virtualSportsAliasNames = \[virtualSportsCanonicalName, "문체부"\]/);
  assert.match(budgetNames, /WITH activity_counts AS/);
  assert.match(budgetNames, /all_budget_names AS/);
  assert.match(
    budgetNames,
    /COALESCE\(award_status, '미정'\)[\s\S]{0,80}NOT IN \('협력사 수주', '타업체 수주'\)/,
  );

  assert.match(accountingRoute, /normalizeBudgetNameKey/);
  assert.match(accountingRoute, /canonicalBudgetName\(row\.budget_type\)/);
  assert.match(
    accountingRoute,
    /completedWhizzupAwardRows/,
  );
  assert.match(analyticsPage, /showRegionDrilldown/);
  assert.match(analyticsPage, /showBudgetDrilldown/);
  assert.match(analyticsPage, /showProductDrilldown/);
  assert.match(analyticsPage, /showVendorDrilldown/);
  assert.match(analyticsPage, /analytics-drilldown-backdrop/);
  assert.match(styles, /\.analytics-drilldown-backdrop/);
});
