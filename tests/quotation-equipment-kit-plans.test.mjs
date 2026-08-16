import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { register } from "node:module";

register(new URL("./typescript-resolver.mjs", import.meta.url));

const {
  createAirpassEquipmentKitFromPlan,
  defaultAirpassEquipmentKitPlans,
  normalizeAirpassEquipmentKitPlans,
} = await import("../lib/airpass-equipment-kit.ts");

const page = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");
const store = await readFile(new URL("../lib/authored-quotations.ts", import.meta.url), "utf8");
const api = await readFile(new URL("../app/api/equipment-kit-plans/route.ts", import.meta.url), "utf8");
const pdf = await readFile(new URL("../app/authored-quotation-pdf.ts", import.meta.url), "utf8");
const workbook = await readFile(new URL("../lib/quotation-xlsx.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("teaching-aid support is stored as an internal margin deduction only", () => {
  assert.match(store, /teachingAidSupportAmount/);
  assert.match(store, /marginAmount[\s\S]*- teachingAidSupportCost/);
  assert.match(page, /교구 할인·지원 차감/);
  assert.match(page, /teachingAidSupportLabel \|\| "교구 할인 차감"/);
  assert.match(page, /고객 견적금액과 PDF·Excel에는 반영하지 않고 내부 마진에서만 차감합니다/);
  assert.match(page, /quotation-teaching-aid-support[\s\S]*?item\.equipmentKit \? <label className=\{\`quotation-complimentary-toggle/);
  assert.equal(page.match(/quotation-complimentary-toggle/g)?.length, 1);
  assert.match(page, /교구 세트 무상 제공/);
  assert.match(page, /const complimentaryAmount = Math\.max\(0, item\.quantity\) \* Math\.max\(0, item\.unitPrice\)/);
  assert.match(page, /currentSupportAmount > 0 \? currentSupportAmount : complimentaryAmount/);
  assert.match(page, /currentSupportAmount === complimentaryAmount \? 0 : currentSupportAmount/);
  assert.match(page, /수량 × 단가는 내부 차감 금액에 자동 반영합니다/);
  assert.doesNotMatch(pdf, /teachingAidSupport/);
  assert.doesNotMatch(workbook, /teachingAidSupport/);
});

test("construction item values use the same readable type scale as quote items", () => {
  assert.match(styles, /quotation-construction-cost-fields>label:not\(\.quotation-additional-internal-cost\)>input\{font-size:14px;font-weight:700\}/);
});

test("equipment-kit plans normalize safely and create detached quote snapshots", () => {
  const defaults = defaultAirpassEquipmentKitPlans();
  assert.equal(defaults.length, 2);
  assert.equal(defaults[0].name, "표준 1세트");

  const plans = normalizeAirpassEquipmentKitPlans([{
    id: "custom-one",
    name: "우리 회사 기본안",
    active: true,
    sortOrder: 3,
    lines: [{ id: "line-1", name: "축구공", quantity: 2, unit: "EA", unitPrice: 12000 }],
  }]);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].lines[0].quantity, 2);

  const kit = createAirpassEquipmentKitFromPlan(plans[0]);
  kit.lines[0].quantity = 9;
  assert.equal(plans[0].lines[0].quantity, 2);
  assert.equal(kit.templateId, "custom-one");
  assert.equal(kit.templateName, "우리 회사 기본안");
});

test("equipment-kit plan persistence is admin-managed and stored in app settings", () => {
  assert.match(api, /requireApprovedMember/);
  assert.match(api, /requireAdminMember/);
  assert.match(api, /airpass_equipment_kit_plans_v1/);
  assert.match(api, /INSERT INTO app_settings/);
  assert.match(page, /현재 구성 새 기본안 저장/);
  assert.match(page, /기존 견적은 바뀌지 않습니다/);
});
