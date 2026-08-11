import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");
const history = await readFile(new URL("../app/organization-quotation-history.tsx", import.meta.url), "utf8");
const crm = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/quotations/route.ts", import.meta.url), "utf8");
const store = await readFile(new URL("../lib/authored-quotations.ts", import.meta.url), "utf8");
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../drizzle/0090_authored_quotation_budgets.sql", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("quotation budgets are durable, searchable and summarized without construction double counting", () => {
  assert.match(store, /budgets_json TEXT NOT NULL DEFAULT '\[\]'/);
  assert.match(store, /JSON\.stringify\(data\.budgets\)/);
  assert.match(store, /budgets_json LIKE \?/);
  assert.match(schema, /budgetsJson/);
  assert.match(migration, /ALTER TABLE authored_quotations ADD COLUMN budgets_json/);
  assert.match(route, /regularItems/);
  assert.match(route, /constructionItems/);
  assert.match(route, /budgetMap/);
  assert.match(route, /quoteStatus: finalQuotes\.length \? "complete" : "draft"/);
});

test("one budget auto-links while multiple budgets support explicit allocation", () => {
  assert.match(page, /availableBudgets\.length !== 1/);
  assert.match(page, /current\.budgets\.length === 0/);
  assert.match(page, /연결 예산/);
  assert.match(page, /예산 배분 합계/);
  assert.match(page, /displayedBudgetsForQuote/);
  assert.match(history, /availableBudgets/);
  assert.match(history, /예산 연결 필요/);
  assert.match(crm, /품목·견적 등록 완료/);
  assert.match(crm, /견적 작성 중/);
});

test("mobile product picker remains open after selection until the user finishes", () => {
  assert.match(page, /setProductResultsOpen\(true\);[\s\S]{0,180}const existing/);
  assert.match(page, /물품을 연속으로 선택할 수 있습니다/);
  assert.match(page, />선택 완료<\/button>/);
  assert.match(page, /matchMedia\("\(max-width: 720px\)"\)\.matches\) return/);
  assert.match(styles, /\.quotation-item-search-results \{ position: fixed; inset: auto 8px 8px;/);
  assert.match(styles, /\.quotation-item-search-results > header \{ position: sticky;/);
});

test("institution detail renders current final quotation items and construction from the same query as history", () => {
  assert.match(history, /QUOTATION ITEMS/);
  assert.match(history, /현재 최종 견적서에 실제 저장된 품목과 공사비입니다/);
  assert.match(history, /item\.productId !== "__construction_cost__"/);
  assert.match(history, /item\.productId === "__construction_cost__"/);
  assert.match(history, /equipment-readonly-construction/);
  assert.match(history, /linkedBudgetNames/);
  assert.match(crm, /onLoaded=\{\(\) => void loadEquipmentQuoteSummaries\(\)\}/);
  assert.doesNotMatch(crm, /<OrganizationEquipmentManager[\s\S]{0,300}readOnly/);
  assert.match(styles, /\.equipment-readonly-totals,[\s\S]*\.equipment-readonly-projects \{ padding-inline: 24px;/);
});

test("quotation changes refresh budget amount status instead of leaving a stale missing warning", () => {
  assert.match(crm, /whizzup:quotation-files-updated/);
  assert.match(crm, /label: "견적 확인 중"/);
  assert.match(crm, /최종 견적 금액을 불러오고 있습니다/);
});
