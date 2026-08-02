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

test("관리자 초기 로딩은 대시보드와 전체 기록을 중복 조회하지 않는다", () => {
  assert.doesNotMatch(
    crmSource,
    /const recordsPromise = requestRecords\("dashboard"\)/,
  );
  assert.match(
    crmSource,
    /requestRecords\(\s*preloadManagerRecords \? "full" : "dashboard",?\s*\)/,
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
  assert.match(mapSource, /const \[searchDraft, setSearchDraft\]/);
});

test("removed budget destination workflow leaves no dangling state setter", () => {
  assert.doesNotMatch(mapSource, /setBudgetDestinationCampaignId/);
});
