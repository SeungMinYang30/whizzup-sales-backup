import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [salesMap, locationRoute, locationXlsx, styles] = await Promise.all([
  readFile(new URL("../app/sales-map.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/map/locations/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/location-xlsx.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("offers bulk map location editing and Excel round trips", () => {
  assert.match(salesMap, /위치 일괄 편집/);
  assert.match(salesMap, /미매칭 엑셀 다운로드/);
  assert.match(salesMap, /엑셀 수정본 가져오기/);
  assert.match(salesMap, /검색 명칭 · 여러 개는 \/ 로 구분/);
  assert.match(salesMap, /명칭 검색/);
  assert.match(salesMap, /주소 검색/);
  assert.match(salesMap, /선택 .*곳 일괄 저장/);
  assert.match(salesMap, /searchKakaoPlaces\(row\.address\)/);
});

test("bulk location API validates, reads, writes, and verifies in 50-place chunks", () => {
  assert.match(locationRoute, /Array\.isArray\(payload\.locations\)/);
  assert.match(locationRoute, /LOCATION_BATCH_LIMIT = 300/);
  assert.match(locationRoute, /LOCATION_QUERY_CHUNK_SIZE = 50/);
  assert.match(locationRoute, /LOCATION_WRITE_CHUNK_SIZE = 50/);
  assert.match(locationRoute, /WHERE organization IN/);
  assert.match(locationRoute, /chunk\.flatMap\(statementsFor\)/);
  assert.match(locationRoute, /for \(const row of chunk\)/);
  assert.match(locationRoute, /savedCount/);
  assert.match(locationRoute, /failedCount/);
  assert.match(locationRoute, /failures/);
  assert.match(salesMap, /failedByOrganization/);
  assert.match(salesMap, /곳 저장, \$\{failures\.length\}곳 실패/);
});

test("location workbook keeps the user-facing template focused on names and addresses", () => {
  for (const header of ["기관명", "검색 명칭", "주소", "비고"]) {
    assert.match(locationXlsx, new RegExp(header));
  }
  assert.doesNotMatch(locationXlsx, /const headers = \[[^\]]*"위도"/);
  assert.match(locationXlsx, /downloadLocationWorkbook/);
  assert.match(locationXlsx, /parseLocationFile/);
  assert.match(styles, /\.map-location-batch-dialog/);
});
