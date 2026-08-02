import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("백업사이트 대기 계정은 본사이트의 승인 상태를 즉시 확인한다", () => {
  const collaboration = source("../lib/collaboration.ts");
  const primaryAccess = source("../lib/primary-member-access.ts");

  assert.match(collaboration, /String\(row\.status\) === "pending"/);
  assert.match(collaboration, /fetchApprovedPrimaryMember\(email\)/);
  assert.match(collaboration, /status = 'approved'/);
  assert.match(collaboration, /WHERE id = \? AND status = 'pending'/);
  assert.match(primaryAccess, /PRIMARY_EXPORT_SECRET/);
  assert.match(primaryAccess, /\/api\/standby-export/);
  assert.match(primaryAccess, /String\(member\.status \?\? ""\) === "approved"/);
  assert.match(primaryAccess, /cache: "no-store"/);
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
    /STANDBY_PREAPPROVED_PRIMARY_OWNER_EMAILS[\s\S]{0,260}return true;[\s\S]{0,260}ORDER BY id ASC/,
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
    /memberPermissionsJsonExpression\(primaryPermissions\)/,
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

  assert.match(database, /export function isPostgresDatabase\(\)/);
  assert.match(
    budgetNames,
    /ensureAdditiveBudgetSchema\(d1\);[\s\S]{0,520}if \(isPostgresDatabase\(\)\) return d1;[\s\S]{0,160}backfillBudgetOriginalNames\(d1\);[\s\S]{0,80}ensureSelfBudgetGroup\(d1\)/,
  );
  assert.match(
    recordsStore,
    /ensureBudgetNamesReady\(\);[\s\S]{0,100}if \(!isPostgresDatabase\(\)\) \{[\s\S]{0,220}retrofitBusinessRoundBudgets\(d1\)/,
  );
});
