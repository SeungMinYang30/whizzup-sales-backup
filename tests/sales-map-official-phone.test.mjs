import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mapSource = await readFile(
  new URL("../app/sales-map.tsx", import.meta.url),
  "utf8",
);
const lookupRoute = await readFile(
  new URL("../app/api/school-directory/lookup/route.ts", import.meta.url),
  "utf8",
);

test("지도는 직접 입력 번호를 우선하고 교육청 대표전화를 안전한 대체값으로 사용한다", () => {
  assert.match(mapSource, /focusedDirectPhone/);
  assert.match(mapSource, /focusedOfficialSchool\?\.phone/);
  assert.match(mapSource, /학교 대표전화/);
  assert.match(mapSource, /href=\{`tel:\$\{focusedDialPhone\}`\}/);
});

test("교육청 대표전화 조회는 승인된 구성원과 확정 가능한 학교에만 제공한다", () => {
  assert.match(lookupRoute, /requireApprovedMember/);
  assert.match(lookupRoute, /resolveOfficialSchoolName/);
  assert.match(lookupRoute, /school: null/);
  assert.match(lookupRoute, /source: "교육청 학교기본정보"/);
});
