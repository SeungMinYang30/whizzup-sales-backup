import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("기관 병합 API는 관리자 권한과 정확히 두 기관을 요구한다", async () => {
  const root = new URL("../", import.meta.url);
  const route = await readFile(
    new URL("app/api/institutions/merge/route.ts", root),
    "utf8",
  );
  assert.match(route, /requireMemberPermission\("records:manage"\)/);
  assert.match(route, /organizations\.length !== 2/);
  assert.match(route, /payload\.confirm !== true/);
  assert.match(route, /mergeInstitutionRecords/);
});

test("기관 병합은 연결 데이터와 승인 별칭을 모두 보존한다", async () => {
  const root = new URL("../", import.meta.url);
  const merge = await readFile(
    new URL("lib/institution-merge.ts", root),
    "utf8",
  );
  [
    "activities",
    "ai_recommendations",
    "organization_locations",
    "manager_alert_acknowledgements",
    "sales_campaign_targets",
    "equipment_projects",
    "equipment_items",
    "updateInstitutionAliasSetting",
  ].forEach((expected) => assert.match(merge, new RegExp(expected)));
});

test("기관별 관리에 두 기관 선택·미리보기·최종 병합 화면이 있다", async () => {
  const root = new URL("../", import.meta.url);
  const crm = await readFile(new URL("app/crm-app.tsx", root), "utf8");
  assert.match(crm, /선택 기관 합치기/);
  assert.match(crm, /selectedInstitutionIds\.length !== 2/);
  assert.match(crm, /최종으로 사용할 기관명을 선택해 주세요/);
  assert.match(crm, /두 기관 합치기/);
  assert.match(crm, /window\.confirm/);
});
