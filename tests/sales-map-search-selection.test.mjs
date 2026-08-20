import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../app/sales-map.tsx", import.meta.url),
  "utf8",
);

test("검색 중 현재 목록 선택은 지도 이동을 기다리지 않고 위치 등록 검색 결과 전체를 사용한다", () => {
  assert.match(source, /const baseFilteredOrganizations = useMemo/);
  assert.match(source, /const draftFilteredOrganizations = useMemo/);
  assert.match(
    source,
    /hasDraftSearch\s*\?\s*mapListOrganizations\.filter\(\(item\) => item\.location\)\s*:\s*mapListOrganizations/,
  );
  assert.match(
    source,
    /if \(searchDraft !== search\) \{\s*onSearchChangeRef\.current\(searchDraft\);/,
  );
  assert.match(
    source,
    /const selectionScopeLabel = hasDraftSearch \? "검색 결과" : "현재 목록"/,
  );
  assert.match(
    source,
    /\$\{selectionScopeLabel\} \$\{selectionCandidates\.length/,
  );
});

test("검색 중 목록은 전체 등록 기록을 쓰고 검색을 지우면 현재 지도 범위로 돌아간다", () => {
  assert.match(source, /const viewportOrganizations = useMemo/);
  assert.match(
    source,
    /const mapListOrganizations = hasDraftSearch\s*\?\s*draftFilteredOrganizations\s*:\s*viewportOrganizations/,
  );
  assert.match(
    source,
    /hasDraftSearch\s*\?\s*"검색 결과"[\s\S]*:\s*"현재 지도 범위"/,
  );
  assert.match(source, /위치 등록 \$\{mapListMappedCount/);
  assert.match(source, /미등록 \$\{mapListUnmappedCount/);
  assert.match(source, /disabled=\{hasDraftSearch && !item\.location\}/);
});

test("검색 결과 대량 선택과 위치 미등록 기관을 안전하게 안내한다", () => {
  assert.match(source, /selectionCandidates\.length > 200/);
  assert.match(source, /window\.confirm/);
  assert.match(
    source,
    /draftFilteredOrganizations\.length - selectionCandidates\.length/,
  );
  assert.match(source, /위치 미등록 \$\{excludedLocationCount/);
});
