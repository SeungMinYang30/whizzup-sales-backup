import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("기관 병합 API는 승인된 모든 직원과 정확히 두 기관을 허용한다", async () => {
  const root = new URL("../", import.meta.url);
  const route = await readFile(
    new URL("app/api/institutions/merge/route.ts", root),
    "utf8",
  );
  assert.match(route, /requireApprovedMember\(\)/);
  assert.doesNotMatch(route, /requireMemberPermission\("records:manage"\)/);
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
  assert.match(
    merge,
    /sales_campaign_targets target[\s\S]*target\.assigned_member_id/,
  );
  assert.match(merge, /합친 뒤 사용할 정보 확인|progressManager/);
});

test("기관별 관리에 두 기관 선택·미리보기·최종 병합 화면이 있다", async () => {
  const root = new URL("../", import.meta.url);
  const crm = await readFile(new URL("app/crm-app.tsx", root), "utf8");
  assert.match(crm, /선택 기관 합치기/);
  assert.match(crm, /selectedManagementIds\.length !== 2/);
  assert.match(crm, /최종으로 사용할 기관명을 선택해 주세요/);
  assert.match(crm, /두 기관 합치기/);
  assert.match(crm, /합친 뒤 사용할 정보 확인/);
  assert.match(crm, /institutionMergeResolutions/);
  assert.match(crm, /resolutions: institutionMergeResolutions/);
  assert.match(crm, /window\.confirm/);
});

test("기관별 관리에서 선택한 기관을 확인 후 한 번에 삭제할 수 있다", async () => {
  const root = new URL("../", import.meta.url);
  const crm = await readFile(new URL("app/crm-app.tsx", root), "utf8");
  const styles = await readFile(new URL("app/globals.css", root), "utf8");
  assert.match(crm, /function removeSelectedInstitutions/);
  assert.match(crm, /선택 기관 삭제/);
  assert.match(crm, /body: JSON\.stringify\(\{ organizations \}\)/);
  assert.match(crm, /관리자가 30일 안에 복원/);
  assert.match(crm, /setSelectedInstitutionIds\(\[\]\)/);
  assert.match(styles, /\.institution-bulk-delete-button/);
});
