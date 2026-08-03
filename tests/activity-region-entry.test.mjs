import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const crmAppSource = readFileSync(
  new URL("../app/crm-app.tsx", import.meta.url),
  "utf8",
);

test("새 영업 기록의 지역은 자동 확인을 기본으로 하고 직접 입력은 보조 기능으로 둔다", () => {
  assert.match(crmAppSource, /className="activity-region-summary"/);
  assert.match(crmAppSource, /저장할 때 기존 기관·지도 주소에서 자동으로 확인합니다\./);
  assert.match(crmAppSource, /<summary>\{form\.region\.trim\(\) \? "지역 수정" : "직접 입력"\}<\/summary>/);
  assert.match(crmAppSource, /aria-label="지역 직접 입력"/);
  assert.match(crmAppSource, /const latestInstitutionRegion =/);
  assert.match(crmAppSource, /region: latest\.region\.trim\(\) \|\| latestInstitutionRegion/);
});
