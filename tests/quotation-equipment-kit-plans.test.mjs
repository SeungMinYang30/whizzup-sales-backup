import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { register } from "node:module";

register(new URL("./typescript-resolver.mjs", import.meta.url));

const {
  AIRPASS_EQUIPMENT_GUIDE_PANEL_DEFINITIONS,
  airpassEquipmentGuidePanelOutputLines,
  airpassEquipmentGuidePanels,
  createAirpassEquipmentKitFromPlan,
  defaultAirpassEquipmentKitPlans,
  normalizeAirpassEquipmentKitPlans,
  normalizeAirpassEquipmentKit,
} = await import("../lib/airpass-equipment-kit.ts");

const page = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");
const store = await readFile(new URL("../lib/authored-quotations.ts", import.meta.url), "utf8");
const api = await readFile(new URL("../app/api/equipment-kit-plans/route.ts", import.meta.url), "utf8");
const pdf = await readFile(new URL("../app/authored-quotation-pdf.ts", import.meta.url), "utf8");
const workbook = await readFile(new URL("../lib/quotation-xlsx.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("teaching-aid support stores an explicit bearer and keeps it out of customer documents", () => {
  assert.match(store, /teachingAidSupportAmount/);
  assert.match(store, /teachingAidSupportBearer/);
  assert.match(store, /settlement\.consortiumSupportCost/);
  assert.match(page, /교구 할인·지원 차감/);
  assert.match(page, /teachingAidSupportLabel \|\| "교구 할인 차감"/);
  assert.match(page, /고객 견적금액과 PDF·Excel에는 표시되지 않습니다/);
  assert.match(page, /quotation-teaching-aid-support[\s\S]*?item\.equipmentKit \? <label className=\{\`quotation-complimentary-toggle/);
  assert.equal(page.match(/quotation-complimentary-toggle/g)?.length, 1);
  assert.match(page, /교구 세트 무상 제공/);
  assert.match(page, /컨소 정산에서 차감/);
  assert.match(page, /위즈업 내부비용/);
  assert.match(page, /실제 부담액/);
  assert.match(page, /<dt>교구 제공<\/dt>/);
  assert.match(page, /numbers\.teachingAidSupportCost/);
  assert.match(page, /<dt>기타 내부 원가<\/dt>/);
  assert.match(page, /<dt>내부 원가 합계<\/dt>/);
  assert.match(page, /item\.equipmentKit \? "교구 제공 비용"/);
  assert.match(page, /const complimentaryAmount = Math\.max\(0, item\.quantity\) \* Math\.max\(0, item\.unitPrice\)/);
  assert.match(page, /currentSupportAmount > 0 \? currentSupportAmount : complimentaryAmount/);
  assert.match(page, /currentSupportAmount === complimentaryAmount \? 0 : currentSupportAmount/);
  assert.match(page, /고객 견적은 0원, 컨소 지급률은 0%로 적용하며 해제하면 기존 지급률을 복원합니다/);
  assert.doesNotMatch(pdf, /teachingAidSupport/);
  assert.doesNotMatch(workbook, /teachingAidSupport/);
});

test("교구 세부 PDF는 긴 주소를 넓은 행에 두고 업태와 종목을 분리한다", () => {
  assert.match(pdf, /drawCell\(context, "주소", 72, addressY, 102, 48/);
  assert.match(pdf, /AIRPASS_COMPANY\.address, 174, addressY, 994, 48/);
  assert.match(pdf, /drawCell\(context, "업태", 72, businessY/);
  assert.match(pdf, /drawCell\(context, "종목", 520, businessY/);
  assert.doesNotMatch(pdf, /"업태·종목", `\$\{AIRPASS_COMPANY\.businessType\}/);
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

test("안내판넬은 고정 4종만 저장하고 수량이 있는 항목만 출력한다", () => {
  assert.deepEqual(
    AIRPASS_EQUIPMENT_GUIDE_PANEL_DEFINITIONS.map(({ label }) => label),
    ["키오스크 사용안내", "이용주의사항", "키넥트 사용안내", "스포츠실 사용안내"],
  );
  const kit = normalizeAirpassEquipmentKit({
    kind: "airpass-equipment",
    plan: "one",
    lines: [],
    guidePanels: [
      { id: "kiosk", quantity: 2 },
      { id: "precautions", quantity: 0 },
      { id: "kinect", quantity: -4 },
      { id: "sports-room", quantity: 3 },
      { id: "custom-panel", quantity: 99 },
    ],
  });
  assert.ok(kit);
  assert.deepEqual(airpassEquipmentGuidePanels(kit).map(({ quantity }) => quantity), [2, 0, 0, 3]);
  assert.deepEqual(
    airpassEquipmentGuidePanelOutputLines(kit).map(({ label, quantity }) => [label, quantity]),
    [["키오스크 사용안내", 2], ["스포츠실 사용안내", 3]],
  );
  assert.match(page, /고정 4종 · 수량 0은 PDF·Excel 별첨에서 제외/);
  assert.match(pdf, /안내판넬 체크/);
  assert.match(styles, /equipment-kit-print-guide-panels[\s\S]*?break-inside:avoid/);
});
