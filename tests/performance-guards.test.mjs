import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const crmSource = await readFile(
  new URL("../app/crm-app.tsx", import.meta.url),
  "utf8",
);
const mapSource = await readFile(
  new URL("../app/sales-map.tsx", import.meta.url),
  "utf8",
);
const productSource = await readFile(
  new URL("../app/product-catalog-page.tsx", import.meta.url),
  "utf8",
);
const quotationSource = await readFile(
  new URL("../app/quotation-management-page.tsx", import.meta.url),
  "utf8",
);
const campaignApiSource = await readFile(
  new URL("../app/api/map/campaigns/route.ts", import.meta.url),
  "utf8",
);
const productApiSource = await readFile(
  new URL("../app/api/product-catalog/route.ts", import.meta.url),
  "utf8",
);
const productRelationsSource = await readFile(
  new URL("../lib/product-vendor-links.ts", import.meta.url),
  "utf8",
);
const vercelSchemaSource = await readFile(
  new URL("../db/vercel-schema.ts", import.meta.url),
  "utf8",
);
const databaseSource = await readFile(
  new URL("../db/index.ts", import.meta.url),
  "utf8",
);
const globalSearchSource = await readFile(
  new URL("../app/global-institution-search.tsx", import.meta.url),
  "utf8",
);

test("관리자 초기 로딩은 대시보드와 전체 기록을 중복 조회하지 않는다", () => {
  assert.doesNotMatch(
    crmSource,
    /const recordsPromise = requestRecords\("dashboard"\)/,
  );
  assert.match(
    crmSource,
    /const dashboardRecordsRequest = requestRecords\("dashboard"\)/,
  );
});

test("전용 화면은 필요할 때만 내려받고 지도는 다른 메뉴에서 유지하지 않는다", () => {
  assert.match(
    crmSource,
    /const SalesMapPage = lazy\(\(\) => import\("\.\/sales-map"\)\)/,
  );
  assert.match(
    crmSource,
    /\{\(view === "map" \|\| view === "budget-institutions"\) && \(/,
  );
  assert.doesNotMatch(crmSource, /mapVisited|setMapVisited/);
});

test("대량 목록 검색은 입력 중 전체 화면 상태를 즉시 갱신하지 않는다", () => {
  assert.doesNotMatch(
    crmSource,
    /onChange=\{\(event\) => setSearch\(event\.target\.value\)\}/,
  );
  assert.doesNotMatch(
    crmSource,
    /onChange=\{\(event\) => setManagerSearch\(event\.target\.value\)\}/,
  );
  assert.match(productSource, /const \[searchDraft, setSearchDraft\]/);
  assert.match(productSource, /useDeferredValue\(searchDraft\)/);
  assert.match(mapSource, /const \[searchDraft, setSearchDraft\]/);
  assert.match(mapSource, /useDeferredValue\(searchDraft\)/);
});

test("예산별 기관 화면은 지도 전용 설정과 위치를 요청하지 않는다", () => {
  assert.match(mapSource, /if \(displayMode !== "map" \|\| mapResourcesRequestedRef\.current\) return/);
  assert.match(mapSource, /requestCampaignList\(\)/);
});

test("견적과 제품 화면은 제품 목록을 한 번만 요청한다", () => {
  assert.doesNotMatch(quotationSource, /fetch\("\/api\/product-catalog"/);
  assert.match(productSource, /products=\{products\}/);
});

test("Postgres 읽기 경로는 완료된 보정 작업을 반복하지 않는다", () => {
  assert.match(campaignApiSource, /if \(!isPostgresDatabase\(\)\) \{\s*await ensureCampaignBasicsBackfilled\(d1\)/);
  assert.match(campaignApiSource, /let campaignBasicsBackfillPromise: Promise<void> \| null = null/);
  assert.match(productRelationsSource, /if \(isPostgresDatabase\(\)\) return d1/);
});

test("제품 기준정보와 연결정보는 묶음 조회하고 조회 인덱스를 준비한다", () => {
  assert.match(productApiSource, /WHERE key IN \(\?, \?, \?\)/);
  assert.match(productApiSource, /readProductCatalogRelations\(\)/);
  assert.match(productRelationsSource, /'vendor' AS row_kind[\s\S]*UNION ALL[\s\S]*'link' AS row_kind[\s\S]*UNION ALL[\s\S]*'supply' AS row_kind/);
  assert.match(vercelSchemaSource, /activities_organization_round_date_idx/);
  assert.match(vercelSchemaSource, /sales_campaign_targets_org_round_campaign_idx/);
});

test("운영 DB는 전체 스키마 대신 기준 버전 이후의 증분 스키마만 적용한다", () => {
  assert.match(vercelSchemaSource, /VERCEL_BASE_SCHEMA_VERSION = "202608060007_full_backup_columns"/);
  assert.match(vercelSchemaSource, /export const VERCEL_INCREMENTAL_SCHEMA_SQL/);
  assert.match(databaseSource, /baseSchemaIsReady[\s\S]*VERCEL_INCREMENTAL_SCHEMA_SQL[\s\S]*VERCEL_SCHEMA_SQL/);
});

test("복합사업 출처 인덱스는 기존 테이블에 컬럼을 추가한 뒤 생성한다", () => {
  const fullStart = vercelSchemaSource.indexOf("export const VERCEL_SCHEMA_SQL");
  const incrementalStart = vercelSchemaSource.indexOf("export const VERCEL_INCREMENTAL_SCHEMA_SQL");
  const blocks = [
    vercelSchemaSource.slice(fullStart, incrementalStart),
    vercelSchemaSource.slice(incrementalStart),
  ];
  for (const block of blocks) {
    const addColumn = block.indexOf("ADD COLUMN IF NOT EXISTS source_type");
    const createIndex = block.indexOf("CREATE INDEX IF NOT EXISTS complex_projects_source_idx");
    assert.ok(addColumn >= 0, "source_type migration must exist");
    assert.ok(createIndex > addColumn, "source index must be created after the column migration");
  }
});

test("전체 기관 검색은 입력을 막지 않고 짧게 지연한 결과를 재사용한다", () => {
  assert.match(globalSearchSource, /cacheRef\.current\.get\(normalizedQuery\)/);
  assert.match(globalSearchSource, /setTimeout\(\(\) => \{[\s\S]*\}, 120\)/);
  assert.match(globalSearchSource, /기관을 검색하는 중입니다/);
});

test("removed budget destination workflow leaves no dangling state setter", () => {
  assert.doesNotMatch(mapSource, /setBudgetDestinationCampaignId/);
});
