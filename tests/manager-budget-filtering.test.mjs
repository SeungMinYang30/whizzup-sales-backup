import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [crm, managerAlertRoute] = await Promise.all([
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../app/api/manager-alerts/route.ts", import.meta.url),
    "utf8",
  ),
]);

test("관리자 영업 점검은 권한이 있는 승인 사용자의 화면을 선택해 정리한다", () => {
  assert.match(crm, /aria-label="관리자 영업 점검 사용자"/);
  assert.match(crm, /managerAlertMembers\.map/);
  assert.match(crm, /memberId: managerAlertMemberId/);
  assert.match(managerAlertRoute, /WHERE status = 'approved'/);
  assert.match(
    managerAlertRoute,
    /normalizeMemberPermissions\(row\.permissions\)\.includes\("records:manage"\)/,
  );
  assert.match(managerAlertRoute, /selectedMemberId/);
  assert.doesNotMatch(crm, /대신 처리한|대리 처리자|처리자 공개/);
  assert.doesNotMatch(managerAlertRoute, /handledBy|actingMemberId/);
});

test("수주 전후 기관 목록은 활성 표준 예산명과 별칭으로 필터링한다", () => {
  assert.match(crm, /function matchesStandardBudgetFilter/);
  assert.match(crm, /\[option\.canonicalName, \.\.\.option\.aliases\]/);
  assert.match(crm, /recordGroupIds\.has\(option\.id\)/);
  assert.match(crm, /recordBudgets/);
  assert.match(crm, /aria-label="표준 예산명 필터"/);
  assert.match(crm, /전체 표준 예산/);
  assert.match(crm, /미분류 예산/);
  assert.match(
    crm,
    /view === "awards"[\s\S]*matchesStandardBudgetFilter\([\s\S]*budgetGroupFilter/,
  );
  assert.match(
    crm,
    /preAwardInstitutionRows[\s\S]*matchesStandardBudgetFilter\([\s\S]*budgetGroupFilter/,
  );
});
