import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperPath = new URL("../lib/legacy-source-merge.ts", import.meta.url);
const routePath = new URL("../app/api/admin/legacy-source-merge/route.ts", import.meta.url);
const memberRoutePath = new URL("../app/api/members/route.ts", import.meta.url);

test("legacy merge is owner-only, backs up target data, and uses source export", async () => {
  const [helper, route] = await Promise.all([
    readFile(helperPath, "utf8"),
    readFile(routePath, "utf8"),
  ]);
  assert.match(route, /requirePrimaryOwner\(\)/);
  assert.match(helper, /legacy_source_merge_backups/);
  assert.match(helper, /saveSnapshot\(/);
  assert.match(helper, /auditLatestLegacyMerge/);
  assert.match(route, /searchParams\.get\("audit"\) === "latest"/);
  assert.match(helper, /\/api\/standby-export/);
  assert.doesNotMatch(helper, /DELETE\s+FROM\s+members/i);
  assert.doesNotMatch(helper, /DELETE\s+FROM\s+activities/i);
});

test("member restore matches email, preserves locked or assigned work, and repoints duplicate ids", async () => {
  const helper = await readFile(helperPath, "utf8");
  assert.match(helper, /text\(sourceMember\.email\)\.toLowerCase\(\)/);
  assert.match(helper, /progress_manager_locked/);
  assert.match(helper, /conflictsPreserved/);
  assert.match(helper, /changedWhileLocked/);
  assert.match(helper, /overwrittenAssigned/);
  assert.match(helper, /duplicateAccountsRepointed/);
  assert.match(helper, /UPDATE organization_schedules SET assignee_member_id/);
  assert.match(helper, /UPDATE sales_campaign_targets SET assigned_member_id/);
  assert.match(helper, /UPDATE complex_projects SET manager_member_id/);
});

test("assignment comparison counts unique workload items instead of relationship edges", async () => {
  const helper = await readFile(helperPath, "utf8");
  assert.match(helper, /seenByEmail/);
  assert.match(helper, /`activity:\$\{integer\(author\.activity_id\)\}`/);
  assert.match(helper, /`activity:\$\{integer\(history\.activity_id\)\}`/);
});

test("comparison uses the same unclassified budget filters as the management screen", async () => {
  const helper = await readFile(helperPath, "utf8");
  assert.match(helper, /excludedAwards/);
  assert.match(helper, /allowedStatuses/);
  assert.match(helper, /budget_match_status/);
  assert.match(helper, /activity_id/);
});

test("admin can change own sales flag while persisted value is verified", async () => {
  const route = await readFile(memberRoutePath, "utf8");
  const salesBranch = route.slice(route.indexOf('if (typeof payload.isSales === "boolean")'), route.indexOf("const displayName", route.indexOf('if (typeof payload.isSales === "boolean")')));
  assert.doesNotMatch(salesBranch, /id\s*===\s*actor\.id/);
  assert.match(salesBranch, /SELECT is_sales FROM members WHERE id = \?/);
  assert.match(salesBranch, /영업 담당자 설정이 저장되지 않았습니다/);
});
