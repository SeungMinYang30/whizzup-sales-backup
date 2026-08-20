import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperPath = new URL("../lib/legacy-source-merge.ts", import.meta.url);
const routePath = new URL("../app/api/admin/legacy-source-merge/route.ts", import.meta.url);
const memberRoutePath = new URL("../app/api/members/route.ts", import.meta.url);
const managerPath = new URL("../app/budget-name-manager.tsx", import.meta.url);
const collaborationPath = new URL("../lib/collaboration.ts", import.meta.url);

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
  assert.match(helper, /differentEmployeeOverwrite/);
  assert.match(helper, /duplicateAccountsRepointed/);
  assert.match(helper, /UPDATE organization_schedules SET assignee_member_id/);
  assert.match(helper, /UPDATE sales_campaign_targets SET assigned_member_id/);
  assert.match(helper, /UPDATE complex_projects SET manager_member_id/);
});

test("assignment comparison counts unique workload items instead of relationship edges", async () => {
  const helper = await readFile(helperPath, "utf8");
  assert.match(helper, /seenByEmail/);
  assert.match(helper, /activityWorkloadKey\(author\.activity_id\)/);
  assert.match(helper, /activityWorkloadKey\(history\.activity_id\)/);
  assert.match(helper, /scheduleStableKey\(schedule\)/);
  assert.match(helper, /campaignTargetStableKey\(target, campaignsById\)/);
  assert.match(helper, /complexProjectStableKey\(project\)/);
});

test("budget manager exposes the latest safe merge audit", async () => {
  const manager = await readFile(managerPath, "utf8");
  assert.match(manager, /최근 복구 검증/);
  assert.match(manager, /changedWhileLocked/);
  assert.match(manager, /differentEmployeeOverwrite/);
});

test("safe merge uses an accessible in-page confirmation instead of a blocking browser dialog", async () => {
  const manager = await readFile(managerPath, "utf8");
  assert.match(manager, /legacyMergeConfirmOpen/);
  assert.match(manager, /aria-labelledby="legacy-merge-confirm-title"/);
  assert.match(manager, /백업 후 안전 병합/);
  assert.doesNotMatch(manager.slice(manager.indexOf("async function mergeLegacyData"), manager.indexOf("async function auditLegacyData")), /window\.confirm/);
});

test("primary owner refresh preserves the persisted sales flag", async () => {
  const collaboration = await readFile(collaborationPath, "utf8");
  const ownerRefresh = collaboration.slice(
    collaboration.indexOf("STANDBY_PREAPPROVED_PRIMARY_OWNER_EMAILS.has(email)"),
    collaboration.indexOf("if (!row) throw", collaboration.indexOf("STANDBY_PREAPPROVED_PRIMARY_OWNER_EMAILS.has(email)")),
  );
  assert.doesNotMatch(ownerRefresh, /is_sales\s*=\s*0/);
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
