import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("공통 검색과 초기 조회의 반복 작업을 줄이는 장치가 유지된다", async () => {
  const [
    recordsRoute,
    crm,
    products,
    migration,
    assignmentHistory,
    managerNormalization,
  ] =
    await Promise.all([
      readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../app/product-catalog-page.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../drizzle/0041_activity_performance_and_partner_manager.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../lib/activity-assignment-history.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../lib/sales-manager-normalization.ts", import.meta.url),
        "utf8",
      ),
    ]);

  assert.doesNotMatch(
    recordsRoute,
    /await normalizeHistoricalProgressManagers/,
  );
  assert.match(recordsRoute, /MAX_DASHBOARD_RECORD_PAGE_SIZE = 2_500/);
  assert.match(crm, /useDeferredValue\(search\)/);
  assert.match(crm, /recordSearchIndex/);
  assert.match(crm, /recordsByInstitutionKey/);
  assert.match(crm, /function BufferedInput/);
  assert.match(crm, /function BufferedTextarea/);
  assert.match(crm, /const preAwardInstitutionRows = useMemo/);
  assert.match(
    crm,
    /className="award-progress-content"[\s\S]*?\{record\.summary \|\| "진행 내용 미입력"\}/,
  );
  assert.match(products, /useDeferredValue\(quotation\?\.search \?\? ""\)/);
  assert.match(products, /QUOTATION_PRODUCT_RESULT_LIMIT = 80/);
  assert.match(
    products,
    /\.slice\(0, QUOTATION_PRODUCT_RESULT_LIMIT\)/,
  );
  assert.match(migration, /activities_organization_activity_idx/);
  assert.match(migration, /activities_manager_activity_idx/);
  assert.match(
    migration,
    /`award_status` IN \('협력사 수주', '타업체 수주'\)/,
  );
  assert.match(
    assignmentHistory,
    /협력사 수주의 진행 담당자는 해당 없음으로 고정됩니다/,
  );
  assert.match(managerNormalization, /status === "협력사 수주"/);
  assert.doesNotMatch(
    managerNormalization,
    /status === "협력사 수주" \|\| status === "타업체 수주"/,
  );
  assert.match(managerNormalization, /return "해당 없음"/);
});
