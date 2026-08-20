import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [routeSource, componentSource, recordsRouteSource, crmSource] = await Promise.all([
  readFile(new URL("../app/api/institutions/search/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/global-institution-search.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
]);

test("상단 검색은 기관 마스터를 기준으로 최신 히스토리를 선택적으로 합친다", () => {
  assert.match(routeSource, /FROM institution_registry registry/);
  assert.match(routeSource, /LEFT JOIN ranked a/);
  assert.match(routeSource, /COALESCE\(a\.business_round, 1\) AS business_round/);
  assert.match(routeSource, /registry\.organization LIKE \?/);
  assert.match(routeSource, /backfillInstitutionRegistryFromRecordTrash\(d1\)/);
});

test("마지막 히스토리를 지우기 전에 기관 마스터를 보존한다", () => {
  assert.match(recordsRouteSource, /if \(ids\.length && activityRows\.length\)/);
  assert.match(recordsRouteSource, /INSERT INTO institution_registry/);
  assert.match(recordsRouteSource, /ON CONFLICT\(organization\) DO NOTHING/);
  assert.match(
    recordsRouteSource,
    /const cleanupOrganizations = organizations/,
  );
});

test("빈 검색 결과는 고정 캐시하지 않고 기존 결과도 짧게만 재사용한다", () => {
  assert.match(componentSource, /SEARCH_CACHE_TTL_MS = 30_000/);
  assert.match(componentSource, /Date\.now\(\) - cached\.cachedAt < SEARCH_CACHE_TTL_MS/);
  assert.match(componentSource, /if \(nextItems\.length\)/);
  assert.match(componentSource, /cacheRef\.current\.delete\(normalizedQuery\)/);
});

test("히스토리 없는 검색 결과는 목록을 위조하지 않고 상세보기 전용 fallback으로 즉시 연다", () => {
  assert.match(componentSource, /onOpen\(item\)/);
  assert.match(
    crmSource,
    /<GlobalInstitutionSearch onOpen=\{\(institution\) => \{[\s\S]*setDetailInstitutionFallback\(\{/,
  );
  const handler = crmSource.match(
    /<GlobalInstitutionSearch onOpen=\{\(institution\) => \{([\s\S]*?)setDetailOrganization\(institution\.organization\);/,
  );
  assert.ok(handler);
  assert.doesNotMatch(handler[1], /setInstitutionRegistry/);
  assert.match(crmSource, /setDetailOrganization\(institution\.organization\)/);
  assert.match(
    crmSource,
    /detailInstitutionFallback[\s\S]*institutionMasterActivity\(detailInstitutionFallback, 0\)/,
  );
});

test("새로고침과 수주 전 화면 진입은 전체 기록과 기관 마스터를 함께 다시 읽는다", () => {
  assert.match(
    crmSource,
    /view === "dashboard"[\s\S]*void Promise\.all\(\[requestRecords\("full"\), requestInstitutionRegistry\(\)\]\)[\s\S]*setInstitutionRegistry\(nextInstitutions\)/,
  );
});

test("히스토리 삭제 후 기관 마스터를 서버에서 다시 확인한다", () => {
  assert.match(
    crmSource,
    /async function removeRecord\(record: Activity\)[\s\S]*void requestInstitutionRegistry\(\)[\s\S]*\.then\(setInstitutionRegistry\)/,
  );
});

test("수주 전 검색은 활동 색인이 없는 기관 마스터도 기관명과 지역으로 찾는다", () => {
  assert.match(
    crmSource,
    /recordSearchIndex\.get\(record\.id\)\?\.includes\(keyword\) \?\?[\s\S]*record\.organization[\s\S]*record\.region[\s\S]*\.includes\(keyword\)/,
  );
});
