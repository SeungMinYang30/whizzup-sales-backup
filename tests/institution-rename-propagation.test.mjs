import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const mergeSource = await readFile(
  new URL("lib/institution-merge.ts", root),
  "utf8",
);
const recordsRoute = await readFile(
  new URL("app/api/records/route.ts", root),
  "utf8",
);
const crmSource = await readFile(
  new URL("app/crm-app.tsx", root),
  "utf8",
);
const recordsStore = await readFile(
  new URL("lib/records-store.ts", root),
  "utf8",
);

test("기관명 변경은 전체 연결 범위를 안내하고 명시적 확인을 전송한다", () => {
  const message =
    "기관명을 변경하면 이 기관의 모든 과거 기록과 지도·사업 정보가 함께 변경됩니다. 계속하시겠습니까?";
  assert.match(crmSource, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(crmSource, /confirmInstitutionRename: true/);
  assert.match(recordsRoute, /payload\.confirmInstitutionRename !== true/);
  assert.match(recordsRoute, /needsInstitutionRenameConfirmation: true/);
});

test("단일 기록 수정도 공통 기관 병합을 먼저 실행한다", () => {
  const putRoute = recordsRoute.slice(
    recordsRoute.indexOf("export async function PUT"),
    recordsRoute.indexOf("export async function PATCH"),
  );
  const mergeIndex = putRoute.indexOf("await mergeInstitutionRecords(");
  const updateIndex = putRoute.indexOf("UPDATE activities SET");
  assert.ok(mergeIndex >= 0);
  assert.ok(updateIndex > mergeIndex);
  assert.doesNotMatch(putRoute, /oldOrganizationStillExists/);
});

test("공통 병합은 기관명을 연결키로 쓰는 전체 활성 데이터와 복원자료를 포함한다", () => {
  [
    "activities",
    "activity_assignment_history",
    "activity_review_acknowledgements",
    "manager_alert_acknowledgements",
    "ai_recommendations",
    "sales_campaign_targets",
    "equipment_projects",
    "equipment_items",
    "quotation_documents",
    "organization_locations",
    "organization_school_links",
    "institution_name_decisions",
    "deletion_batches",
    "accounting_settlements",
    "accounting_commission_entries",
    "accounting_collection_receipts",
  ].forEach((table) => assert.match(mergeSource, new RegExp(table)));
});

test("기관 병합의 실제 데이터 변경은 하나의 D1 batch로 원자 처리한다", () => {
  assert.equal((mergeSource.match(/await d1\.batch\(/g) || []).length, 1);
  assert.match(mergeSource, /어느 한 문장이라도 실패하면[\s\S]*전체가 롤백/);
});

test("주소 충돌을 선택하고 나머지 중복 연결을 안전하게 정리한다", () => {
  assert.match(
    mergeSource,
    /field: "location"[\s\S]*recommendedValue/,
  );
  assert.match(
    mergeSource,
    /selectedLocation[\s\S]*UPDATE organization_locations SET[\s\S]*latitude = \?/,
  );
  assert.match(
    mergeSource,
    /DELETE FROM organization_locations WHERE organization = \?/,
  );
  assert.match(
    mergeSource,
    /preferredAddress[\s\S]*UPDATE sales_campaign_targets[\s\S]*address = CASE/,
  );
  assert.match(
    mergeSource,
    /DELETE FROM organization_school_links[\s\S]*EXISTS/,
  );
});

test("사업 차수와 변경 후 사업명을 함께 비교해 사업·품목 충돌을 안전하게 합친다", () => {
  assert.match(mergeSource, /business_round/);
  assert.match(mergeSource, /replaceOrganizationReferences/);
  assert.match(mergeSource, /projectTargetByKey/);
  assert.match(
    mergeSource,
    /UPDATE equipment_items SET project_id = \? WHERE project_id = \?/,
  );
  assert.match(mergeSource, /DELETE FROM equipment_projects WHERE id = \?/);
});

test("합친 이전 이름은 별칭으로 기억되어 새 기록에서 다시 분리되지 않는다", () => {
  assert.match(mergeSource, /updateInstitutionAliasSetting/);
  assert.match(recordsStore, /rememberedInstitutionAlias/);
  assert.match(recordsStore, /resolveInstitutionName/);
});
