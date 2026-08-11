import assert from "node:assert/strict";
import test from "node:test";

import { strFromU8, unzipSync } from "fflate";
import { buildComplexProjectWorkbook } from "../app/complex-project-xlsx.ts";

const sampleProject = {
  id: 1,
  organization: "함양군청",
  business_round: 2,
  name: "함양군청 공간재구조화 사업",
  status: "준비",
  total_budget: 200_000_000,
  manager_name: "양승민 이사",
  notes: "",
  budgets: [{
    equipment_project_id: 10,
    name: "자체예산",
    budget_amount: 200_000_000,
    construction_amount: 20_000_000,
    actual_construction_cost: 20_000_000,
    status: "설치 중",
  }],
  zones: [],
  items: [{
    id: 1,
    project_id: 10,
    budget_name: "자체예산",
    item_category: "기자재",
    product_name: "스마트미러",
    specification: "올댓비젼 ATV-EDU-SPORTS_001",
    settlement_quantity: 2,
    unit: "대",
    effective_unit_price: 9_900_000,
    quotation_amount: 19_906_920,
    item_amount: 19_906_920,
    protection_state: "신청 완료",
    schedule_state: "일정 미정",
    deliveries: [],
  }],
};

test("complex project workbook follows Excel OOXML order and uses valid styles", () => {
  const files = unzipSync(buildComplexProjectWorkbook(sampleProject));
  const styles = strFromU8(files["xl/styles.xml"]);
  const styleCount = Number(styles.match(/<cellXfs count="(\d+)">/)?.[1] ?? 0);

  assert.equal(styleCount, 21);
  assert.match(styles, /formatCode="#,##0&quot;원&quot;/);

  for (let index = 1; index <= 7; index += 1) {
    const sheet = strFromU8(files[`xl/worksheets/sheet${index}.xml`]);
    assert.match(sheet, /showGridLines="0"/);
    assert.match(sheet, /<mergeCells count="2">/);
    const mergeIndex = sheet.indexOf("<mergeCells");
    const filterIndex = sheet.indexOf("<autoFilter");
    if (index === 1) {
      assert.equal(filterIndex, -1, "총괄 시트에는 의미 없는 자동 필터를 만들지 않는다");
    } else {
      assert.ok(filterIndex >= 0, `sheet${index}에 자동 필터가 있어야 한다`);
      assert.ok(filterIndex < mergeIndex, "Excel 규격상 자동 필터가 병합 셀보다 먼저 와야 한다");
    }
    const styleIndexes = [...sheet.matchAll(/\ss="(\d+)"/g)].map((match) => Number(match[1]));
    assert.ok(styleIndexes.every((styleIndex) => styleIndex >= 0 && styleIndex < styleCount));
  }
});
