import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");
const store = await readFile(new URL("../lib/authored-quotations.ts", import.meta.url), "utf8");
const defaults = await readFile(new URL("../lib/quotation-internal-costs.ts", import.meta.url), "utf8");
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../drizzle/0091_quotation_internal_costs.sql", import.meta.url), "utf8");
const pdf = await readFile(new URL("../app/authored-quotation-pdf.ts", import.meta.url), "utf8");
const workbook = await readFile(new URL("../lib/quotation-xlsx.ts", import.meta.url), "utf8");

test("projector and AiFit internal deductions use editable defaults", () => {
  assert.match(defaults, /PROJECTOR_INSTALLATION_COST = 220_000/);
  assert.match(defaults, /AIFIT_YOGA_MAT_COST = 300_000/);
  assert.match(defaults, /kind === "projector-installation"[\s\S]*enabled: true/);
  assert.match(defaults, /kind === "aifit-yoga-mat"[\s\S]*enabled: false/);
  assert.match(defaults, /빔프로젝터 설치비/);
  assert.match(defaults, /요가매트 서비스 제공/);
  assert.match(page, /FormattedMoneyInput value=\{item\.internalCostAmount\}/);
});

test("internal deductions persist with a bearer and preserve legacy quotes as Whizzup cost", () => {
  assert.match(store, /internalCostEnabled/);
  assert.match(store, /internalCostAmount/);
  assert.match(store, /internalCostBearer/);
  assert.match(store, /기존 계산을 보존하기 위해 위즈업 부담/);
  assert.match(store, /additional_internal_construction_cost/);
  assert.match(store, /calculateConsortiumSettlement/);
  assert.match(store, /expectedEarning - consortiumPayment - settlement\.whizzupCost - additionalInternalConstructionCost/);
  assert.match(schema, /additionalInternalConstructionCost/);
  assert.match(migration, /additional_internal_construction_cost/);
  assert.match(page, /비용 처리 방식/);
  assert.match(page, /컨소 정산서의 비용 내역과 최종 지급 예정액에 반영됩니다/);
});

test("customer PDF and Excel remain free of internal cost fields", () => {
  assert.doesNotMatch(pdf, /internalCost|additionalInternalConstructionCost/);
  assert.doesNotMatch(workbook, /internalCost|additionalInternalConstructionCost/);
});
