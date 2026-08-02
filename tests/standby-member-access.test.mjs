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

test("명시적으로 승인한 백업 기본 계정은 별도 관리자 권한 없이 입장한다", () => {
  const collaboration = source("../lib/collaboration.ts");

  assert.match(collaboration, /STANDBY_PREAPPROVED_BASIC_EMAILS/);
  assert.match(collaboration, /"freeyang30@gmail\.com"/);
  assert.match(collaboration, /role = 'member'/);
  assert.match(collaboration, /permissions = '\[\]'/);
  assert.match(collaboration, /is_sales = 0/);
  assert.match(collaboration, /WHERE id = \? AND status = 'pending'/);
});
