import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [crm, vendorRoute, styles] = await Promise.all([
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/award-vendors/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("관리자 영업 점검은 최신 상태가 영업 종료인 기관을 건수와 목록에서 제외한다", () => {
  assert.match(
    crm,
    /const managerEligibleOrganizations = organizations\.filter\([\s\S]*?displaySalesStatus\(organization\.latest\) !== "영업 종료"/,
  );
  assert.match(crm, /activeManagerOrganizations = managerEligibleOrganizations\.filter/);
  assert.match(crm, /processedManagerOrganizations = managerEligibleOrganizations\.filter/);
});

test("협력사명 변경은 제품 연결과 저장된 견적 품목의 공급처명을 함께 갱신한다", () => {
  assert.match(vendorRoute, /UPDATE product_vendor_links[\s\S]*?vendor_name_snapshot = \?/);
  assert.match(vendorRoute, /UPDATE equipment_items[\s\S]*?supplier_vendor_name = \?/);
  assert.match(vendorRoute, /supplier_vendor_id = \?[\s\S]*?supplier_vendor_id IS NULL/);
  assert.match(vendorRoute, /await d1\.batch\(statements\)/);
});

test("일정 수정창 하단의 체크 문구와 버튼은 본문보다 작고 균일하게 표시한다", () => {
  assert.match(styles, /\.home-schedule-editor \.schedule-completed \{ font-size: 13px; line-height: 1\.35; \}/);
  assert.match(styles, /\.home-schedule-editor footer button \{ min-width: 82px; min-height: 40px; font-size: 13px; \}/);
});
