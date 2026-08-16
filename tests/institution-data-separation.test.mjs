import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [recordsStore, recordsRoute, institutionsRoute, trashStore, crm, vendorStore, vendorRoute] =
  await Promise.all([
    readFile(new URL("../lib/records-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/institutions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/trash-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/award-vendors.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/award-vendors/route.ts", import.meta.url), "utf8"),
  ]);

test("일반 기관 저장에서는 기억된 별칭이 모호할 때만 확인을 요청한다", () => {
  assert.match(recordsStore, /resolveOfficialSchoolName/);
  assert.match(recordsStore, /rememberedInstitutionAliasCandidates/);
  assert.match(
    recordsStore,
    /if \(rememberedCandidates\.length\)[\s\S]*throw new InstitutionConfirmationRequiredError/,
  );
  assert.doesNotMatch(recordsStore, /const similarCandidates/);
});

test("한 기록의 기관명 수정은 기관 공용 견적서를 함께 옮기지 않는다", () => {
  assert.doesNotMatch(
    recordsRoute,
    /UPDATE quotation_documents SET organization = \? WHERE organization = \?/,
  );
});

test("기관 전체 삭제에만 견적서를 휴지통 스냅샷과 삭제 대상에 포함한다", () => {
  assert.match(
    recordsRoute,
    /cleanupBusinessPairs[\s\S]*loadBusinessRows\("quotation_documents"\)/,
  );
  assert.match(
    recordsRoute,
    /deleteRowsByIds\(\s*"quotation_documents",\s*"id",\s*rowIds\("quotation_documents"\)/,
  );
});

test("상세 기록 삭제는 기관 마스터를 남기고 명시적 기관 삭제만 함께 복구 대상으로 보낸다", () => {
  assert.match(recordsRoute, /const cleanupOrganizations = organizations/);
  assert.match(
    recordsRoute,
    /loadRows\(\s*"institution_registry",\s*"organization",\s*cleanupOrganizations/,
  );
  assert.match(
    recordsRoute,
    /DELETE FROM institution_registry[\s\S]*organization IN/,
  );
  assert.match(recordsStore, /backfillInstitutionRegistryFromActivities/);
  assert.match(
    recordsStore,
    /if \(isPostgresDatabase\(\)\)[\s\S]*backfillInstitutionRegistryFromActivities\(d1\)/,
  );
  assert.match(institutionsRoute, /backfillInstitutionRegistryFromRecordTrash\(d1\)/);
  assert.match(
    trashStore,
    /entity_type = 'record'[\s\S]*tables\.activities[\s\S]*ON CONFLICT\(organization\) DO NOTHING/,
  );
});

test("협력사 등록은 영업 활동이 아니라 전용 업체 자료에 저장한다", () => {
  assert.match(crm, /fetch\("\/api\/award-vendors"/);
  assert.doesNotMatch(crm, /activityType: "협력사 등록"/);
  assert.match(vendorRoute, /export async function DELETE/);
});

test("기존 협력사 시스템 기록은 전용 업체 자료로 소급 이관한다", () => {
  assert.match(vendorStore, /migrateLegacyPartnerActivities/);
  assert.match(
    vendorStore,
    /activity_type IN \('협력사 등록', '협력사 등록 해제'\)/,
  );
  assert.match(
    vendorStore,
    /DELETE FROM activities[\s\S]*source_chat = '수주업체 관리'/,
  );
});

test("수주 대량등록 시스템 기록은 수주 전 기관·팀 활동 목록에서 제외한다", () => {
  assert.match(crm, /isAwardManagementSystemRecord/);
  assert.match(
    crm,
    /isPartnerRegistrationSystemRecord\(record\) \|\|[\s\S]*isAwardManagementSystemRecord\(record\)/,
  );
  assert.match(crm, /!isPartnerRegistrationSystemRecord\(record\)/);
});
