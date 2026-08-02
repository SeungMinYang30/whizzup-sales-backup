import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("activity change ledger migration keeps one immutable snapshot per operation and record", async () => {
  const db = new DatabaseSync(":memory:");
  const migration = await source("../drizzle/0050_activity_change_ledger.sql");
  migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .forEach((statement) => db.exec(statement));

  db.prepare(
    `INSERT INTO activity_change_batches (
       id, operation_total, actor_member_id, actor_name
     ) VALUES (?, ?, ?, ?)`,
  ).run("operation-1", 2, 7, "관리자");
  const insertItem = db.prepare(
    `INSERT OR IGNORE INTO activity_change_items (
       batch_id, activity_id, organization, requested_fields_json,
       changed_fields_json, before_json, after_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertItem.run(
    "operation-1",
    11,
    "원본 기관",
    '["awardStatus"]',
    '["award_status"]',
    '{"award_status":"위즈업 수주"}',
    '{"award_status":"협력사 수주"}',
  );
  insertItem.run(
    "operation-1",
    11,
    "재시도 기관",
    '["awardStatus"]',
    '["award_status"]',
    '{"award_status":"다른 값"}',
    '{"award_status":"또 다른 값"}',
  );

  const item = db
    .prepare(
      `SELECT organization, before_json, after_json
       FROM activity_change_items
       WHERE batch_id = ? AND activity_id = ?`,
    )
    .get("operation-1", 11);
  assert.equal(item.organization, "원본 기관");
  assert.equal(item.before_json, '{"award_status":"위즈업 수주"}');
  assert.equal(item.after_json, '{"award_status":"협력사 수주"}');
});

test("records PATCH snapshots each record in the same bounded D1 batch before updating it", async () => {
  const route = await source("../app/api/records/route.ts");
  const ledger = await source("../lib/activity-change-ledger.ts");

  assert.match(route, /operationId/);
  assert.match(route, /operationLabel/);
  assert.match(route, /operationTotal/);
  assert.match(route, /operationScope/);
  assert.match(route, /isActivityChangeScope\(requestedOperationScope\)/);
  assert.match(route, /const member = await requireApprovedMember\(\)/);
  assert.match(
    route,
    /prepareActivityChangeSnapshot[\s\S]*statements\.push\(prepareBulkUpdate\(chunk\)\)[\s\S]*prepareActivityChangeFinalization/,
  );
  assert.match(route, /WHERE id IN \(\$\{placeholders\}\)/);
  assert.match(route, /ACTIVITY_CHANGE_WRITE_CHUNK_SIZE/);
  assert.match(route, /existingActivityChangeItemIds/);
  assert.match(route, /retrySkipped/);
  assert.match(ledger, /INSERT OR IGNORE INTO activity_change_items/);
  assert.match(ledger, /UNIQUE \(batch_id, activity_id\)/);
  assert.match(ledger, /changed_fields_json/);
  assert.match(ledger, /before_json/);
  assert.match(ledger, /after_json/);
  assert.match(ledger, /json_remove\(/);
  assert.doesNotMatch(
    ledger,
    /UNION ALL/,
    "변경 전·후 스냅샷은 D1 compound SELECT 한도에 의존하지 않아야 한다",
  );
  assert.match(route, /chunkValues\(\s*pendingIds/);
  assert.match(ledger, /ACTIVITY_CHANGE_SCOPE_PRE_AWARDS = "pre_awards"/);
  assert.match(
    ledger,
    /input\.scope \?\? ACTIVITY_CHANGE_SCOPE_AWARDS/,
    "범위를 생략한 기존 수주 후 요청은 awards로 계속 기록되어야 한다",
  );
  assert.match(
    ledger,
    /ACTIVITY_CHANGE_ID_QUERY_CHUNK_SIZE = 99/,
    "operationId 1개와 ID 99개를 합쳐도 D1의 쿼리당 bind 100개를 넘지 않아야 한다",
  );
});

test("history is owner or explicitly authorized only, covers both scopes, and safely undoes every actor's batch", async () => {
  const route = await source("../app/api/activity-changes/route.ts");
  const collaboration = await source("../lib/collaboration.ts");
  const session = await source("../app/api/session/route.ts");

  assert.match(
    collaboration,
    /"activity-history:manage"/,
  );
  assert.match(
    collaboration,
    /member\.permissions\.includes\("activity-history:manage"\)/,
  );
  assert.match(collaboration, /return isPrimaryOwner\(member\)/);
  assert.match(collaboration, /requireActivityHistoryManager/);
  assert.match(session, /canManageActivityHistory/);
  assert.match(route, /requireActivityHistoryManager\(\)/);
  assert.doesNotMatch(route, /actor_member_id = \?/);
  assert.doesNotMatch(route, /본인이 실행한 일괄 변경만/);
  assert.match(route, /LIMIT \? OFFSET \?/);
  assert.match(route, /hasMore/);
  assert.match(route, /scope === "all"/);
  assert.match(route, /ACTIVITY_CHANGE_SCOPES/);
  assert.match(route, /isActivityChangeScope\(scope\)/);
  assert.match(route, /isActivityChangeScope\(batch\.scope\)/);
  assert.match(route, /bulk_pre_award_update/);
  assert.match(route, /scope: batch\.scope/);
  assert.match(route, /scopeLabel:/);
  assert.match(route, /label: batch\.operation_label/);
  assert.match(route, /itemCount/);
  assert.match(route, /appliedCount/);
  assert.match(route, /changedByName: batch\.actor_name/);
  assert.match(route, /parseChangedFields\(item\.changed_fields_json\)/);
  assert.match(route, /valuesEqual\(current\[field\], after\[field\]\)/);
  assert.match(
    route,
    /\$\{field\} = CASE WHEN \$\{field\} IS \? THEN \? ELSE \$\{field\} END/,
  );
  assert.match(route, /conflictFields/);
  assert.match(route, /undoStatus = "no_change"/);
  assert.match(route, /partialRestoredCount/);
  assert.match(route, /missingCount/);
  assert.match(route, /if \(batch\.undone_at\)/);
  assert.match(route, /alreadyUndone: true/);
  assert.match(route, /undone_by_member_id/);
  assert.match(route, /resolveBudgetRecordMetadata/);
  assert.match(route, /linkBudgetNameEntity/);
  assert.match(route, /for \(const item of restoredBudgetItems\)/);
});

test("full backup preserves and restores the durable change ledger", async () => {
  const backup = await source("../lib/backup-store.ts");

  assert.match(backup, /name: "activity_change_batches"/);
  assert.match(backup, /name: "activity_change_items"/);
  assert.match(backup, /ensureActivityChangeLedgerReady/);
  assert.match(backup, /DELETE FROM activity_change_items/);
  assert.match(backup, /DELETE FROM activity_change_batches/);
  assert.match(
    backup,
    /"activities",\s*"activity_change_batches",\s*"activity_change_items"/,
  );
  assert.doesNotMatch(
    backup,
    /assertReference\(\s*row\.activity_id,\s*activityIds,\s*"activity_change_items\.activity_id"/,
    "삭제된 활동도 누락 충돌 이력으로 보존할 수 있어야 한다",
  );
});

test("member deletion reconnects durable ledger actor references before deleting the account", async () => {
  const members = await source("../app/api/members/route.ts");

  assert.match(members, /ensureActivityChangeLedgerReady/);
  assert.match(
    members,
    /UPDATE activity_change_batches SET actor_member_id = \? WHERE actor_member_id = \?/,
  );
  assert.match(
    members,
    /UPDATE activity_change_batches SET undone_by_member_id = \? WHERE undone_by_member_id = \?/,
  );
  assert.match(
    members,
    /UPDATE activity_change_items SET undone_by_member_id = \? WHERE undone_by_member_id = \?/,
  );
});
