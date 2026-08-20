import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("analytics management actions stay scoped and create durable assignee tasks", async () => {
  const [analytics, crm, correctionRoute, catalog, catalogRoute] =
    await Promise.all([
      readFile(new URL("../app/analytics-page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../app/api/correction-requests/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/product-catalog-page.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/product-catalog/route.ts", import.meta.url),
        "utf8",
      ),
    ]);

  assert.match(analytics, /groupAnalyticsProductsByBusiness/);
  assert.match(analytics, /supplierVendorName: group\.label/);
  assert.match(analytics, /drilldown\?\.scope\?\.supplierVendorName/);
  assert.match(analytics, /missingPriceInstitutionCount/);
  assert.match(analytics, /담당자 확인 업무로 보내기/);
  assert.doesNotMatch(analytics, /navigator\.clipboard\.writeText/);

  assert.match(correctionRoute, /requireMemberPermission\("records:manage"\)/);
  assert.match(correctionRoute, /equipment_correction_request_v1:/);
  assert.match(correctionRoute, /assigneeName === member\.displayName/);
  assert.match(crm, /\/api\/correction-requests/);
  assert.match(crm, /기관에서 품목 수정/);
  assert.match(crm, /isPostAwardProgressScheduleItem/);
  assert.match(crm, /\["위즈업 수주", "협력사 수주"\]\.includes/);

  assert.match(catalog, /선택 제품 일괄 적용/);
  assert.match(catalog, /productIds: selectedProductIds/);
  assert.match(catalogRoute, /setProductVendorLinks\(productIds/);
});
