import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("복제된 승인 구성원은 Sites 실시간 조회 없이 로컬 이메일로 연결한다", () => {
  const collaboration = source("../lib/collaboration.ts");

  assert.match(collaboration, /lower\(email\) = lower\(\?\)/);
  assert.match(collaboration, /SET auth_user_id = \?/);
  assert.match(collaboration, /WHERE lower\(email\) = lower\(\?\)/);
  assert.doesNotMatch(collaboration, /fetchApprovedPrimaryMember/);
  assert.doesNotMatch(collaboration, /primary-member-access/);
  assert.doesNotMatch(collaboration, /\/api\/standby-export/);
});

test("명시적으로 승인한 백업 운영 계정은 기존 승인 상태와 관계없이 전체 권한으로 맞춘다", () => {
  const collaboration = source("../lib/collaboration.ts");

  assert.match(collaboration, /STANDBY_PREAPPROVED_PRIMARY_OWNER_EMAILS/);
  assert.match(collaboration, /"freeyang30@gmail\.com"/);
  assert.match(collaboration, /role = 'admin'/);
  assert.match(
    collaboration,
    /permissions = \$\{memberPermissionsJsonExpression\(standbyPermissions\)\}/,
  );
  assert.match(collaboration, /\.bind\(\.\.\.standbyPermissions, Number\(row\.id\)\)/);
  assert.match(collaboration, /is_sales = 0/);
  assert.match(collaboration, /WHERE id = \?/);
  assert.doesNotMatch(
    collaboration,
    /STANDBY_PREAPPROVED_PRIMARY_OWNER_EMAILS\.has\(email\)[\s\S]{0,80}status\) === "pending"/,
  );
});

test("백업 지정 계정은 기존 대표관리자를 유지하면서 대표 전용 기능도 사용한다", () => {
  const collaboration = source("../lib/collaboration.ts");

  assert.match(
    collaboration,
    /STANDBY_PREAPPROVED_PRIMARY_OWNER_EMAILS\.has\([\s\S]{0,120}standbyOwner\.email/,
  );
  assert.match(
    collaboration,
    /export async function isPrimaryOwner[\s\S]*STANDBY_PREAPPROVED_PRIMARY_OWNER_EMAILS\.has[\s\S]*return true;[\s\S]*ORDER BY CASE WHEN lower\(email\) = \? THEN 0 ELSE 1 END, id ASC/,
  );
});

test("백업 구성원 권한은 PostgreSQL JSON 배열로 저장한다", () => {
  const collaboration = source("../lib/collaboration.ts");
  const membersRoute = source("../app/api/members/route.ts");

  assert.match(collaboration, /function memberPermissionsJsonExpression/);
  assert.match(collaboration, /jsonb_build_array/);
  assert.match(collaboration, /"'\[\]'::jsonb"/);
  assert.match(
    collaboration,
    /memberPermissionsJsonExpression\(standbyPermissions\)/,
  );
  assert.match(membersRoute, /memberPermissionsJsonExpression\(permissions\)/);
  assert.match(membersRoute, /\.\.\.permissions/);
  assert.doesNotMatch(collaboration, /JSON\.stringify\(MEMBER_PERMISSIONS\)/);
  assert.doesNotMatch(membersRoute, /JSON\.stringify\(permissions\)/);
});

test("백업 PostgreSQL은 최신 예산 소급 처리의 숫자 GLOB 조건을 정규식으로 변환한다", () => {
  const database = source("../db/index.ts");

  assert.match(database, /NOT\\s\+GLOB[\s\S]{0,80}!~ '\[0-9\]'/);
  assert.match(database, /GLOB[\s\S]{0,80}~ '\[0-9\]'/);
});

test("백업 PostgreSQL은 복제된 운영 데이터에 D1 전용 소급 작업을 다시 실행하지 않는다", () => {
  const database = source("../db/index.ts");
  const budgetNames = source("../lib/budget-names.ts");
  const recordsStore = source("../lib/records-store.ts");
  const initializeAt = budgetNames.indexOf("async function initializeBudgetNames()");
  const postgresGuardAt = budgetNames.indexOf(
    "if (isPostgresDatabase())",
    initializeAt,
  );
  const postgresReturnAt = budgetNames.indexOf("return d1;", postgresGuardAt);
  const additiveSchemaAt = budgetNames.indexOf(
    "ensureAdditiveBudgetSchema(d1)",
    initializeAt,
  );
  const backfillAt = budgetNames.indexOf(
    "backfillBudgetOriginalNames(d1)",
    initializeAt,
  );

  assert.match(database, /export function isPostgresDatabase\(\)/);
  assert.ok(initializeAt >= 0);
  assert.ok(postgresGuardAt > initializeAt);
  assert.ok(postgresReturnAt > postgresGuardAt);
  assert.ok(additiveSchemaAt > postgresReturnAt);
  assert.ok(backfillAt > additiveSchemaAt);
  assert.match(budgetNames, /backfillBudgetOriginalNames\(d1\);[\s\S]{0,80}ensureSelfBudgetGroup\(d1\)/);
  assert.match(
    recordsStore,
    /ensureBudgetNamesReady\(\);[\s\S]{0,100}if \(!isPostgresDatabase\(\)\) \{[\s\S]{0,220}retrofitBusinessRoundBudgets\(d1\)/,
  );
});
