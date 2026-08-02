import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("기관별 관리는 표기 차이를 기관 공통키로 묶는다", () => {
  const crm = source("../app/crm-app.tsx");
  assert.match(crm, /const institutionKey = institutionAliasKey\(record\.organization\)/);
  assert.match(crm, /map\.set\(institutionKey, current\)/);
  assert.match(
    crm,
    /institutionAliasKey\(acknowledgement\.organization\)/,
  );
});

test("지도는 기관 공통키로 한 곳만 표시하고 최신 사업 차수의 상태를 사용한다", () => {
  const map = source("../app/sales-map.tsx");
  assert.match(map, /grouped\.set\(institutionKey, current\)/);
  assert.match(map, /const currentBusinessHistory = history\.filter/);
  assert.match(map, /record\.businessRound/);
  assert.match(
    map,
    /locationByOrganization\.get\(\s*institutionAliasKey\(organization\)/,
  );
});

test("수주 목록과 회계 상태는 활동 번호가 아니라 기관과 사업 차수로 연결한다", () => {
  const crm = source("../app/crm-app.tsx");
  const entries = source("../app/api/accounting/entries/route.ts");
  assert.match(crm, /accountingStatusByBusinessKey/);
  assert.match(
    crm,
    /analyticsBusinessRoundKey\(record\.organization, record\.businessRound\)/,
  );
  assert.match(entries, /consolidateEntriesByBusinessRound/);
  assert.match(entries, /source\.groupedActivityIds/);
});
