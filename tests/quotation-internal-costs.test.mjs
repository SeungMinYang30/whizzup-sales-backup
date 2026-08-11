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

test("internal deductions persist and reduce only saved gross profit", () => {
  assert.match(store, /internalCostEnabled/);
  assert.match(store, /internalCostAmount/);
  assert.match(store, /additional_internal_construction_cost/);
  assert.match(store, /expectedEarning - consortiumPayment - itemInternalCost - additionalInternalConstructionCost/);
  assert.match(schema, /additionalInternalConstructionCost/);
  assert.match(migration, /additional_internal_construction_cost/);
  assert.match(page, /내부 총이익에서만 차감되며 고객 견적·PDF·Excel 금액에는 반영되지 않습니다/);
});

test("customer PDF and Excel remain free of internal cost fields", () => {
  assert.doesNotMatch(pdf, /internalCost|additionalInternalConstructionCost/);
  assert.doesNotMatch(workbook, /internalCost|additionalInternalConstructionCost/);
});
