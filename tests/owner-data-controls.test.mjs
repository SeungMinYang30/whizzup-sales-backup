import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataControlRoute = await readFile(
  new URL("../app/api/data-control/route.ts", import.meta.url),
  "utf8",
);
const dataControlPanel = await readFile(
  new URL("../app/data-control-panel.tsx", import.meta.url),
  "utf8",
);
const recordsRoute = await readFile(
  new URL("../app/api/records/route.ts", import.meta.url),
  "utf8",
);
const trashStore = await readFile(
  new URL("../lib/trash-store.ts", import.meta.url),
  "utf8",
);
const trashRoute = await readFile(
  new URL("../app/api/trash/route.ts", import.meta.url),
  "utf8",
);
const backupStore = await readFile(
  new URL("../lib/backup-store.ts", import.meta.url),
  "utf8",
);
const backupPage = await readFile(
  new URL("../app/data-backup-page.tsx", import.meta.url),
  "utf8",
);
const crm = await readFile(
  new URL("../app/crm-app.tsx", import.meta.url),
  "utf8",
);

test("the institution cleanup inventory is primary-owner only", () => {
  assert.match(dataControlRoute, /await requirePrimaryOwner\(\)/);
  assert.match(
    recordsRoute,
    /payload\.dataControl[\s\S]*await requirePrimaryOwner\(\)/,
  );
  assert.match(trashRoute, /const member = await requirePrimaryOwner\(\)/);
  assert.match(dataControlPanel, /대표관리자 본인 전용/);
});

test("pre-award and every award source can be filtered independently", () => {
  assert.match(dataControlPanel, /\["pre", "수주 전"\]/);
  assert.match(dataControlPanel, /\["whizzup", "위즈업 수주"\]/);
  assert.match(dataControlPanel, /\["partner", "협력사 수주"\]/);
  assert.match(dataControlPanel, /\["other", "타업체 수주"\]/);
  assert.match(dataControlPanel, /\["test", "테스트 추정"\]/);
});

test("cleanup requires a downloaded safety backup and explicit confirmation", () => {
  assert.match(dataControlPanel, /if \(!safetyBackupDownloaded\)/);
  assert.match(dataControlPanel, /선택 보관/);
  assert.match(dataControlPanel, /영구 삭제/);
});

test("business-round cleanup preserves shared institution data", () => {
  assert.match(
    recordsRoute,
    /activities\.organization = organization_locations\.organization/,
  );
  assert.match(
    recordsRoute,
    /loadBusinessRows\("equipment_projects"\)/,
  );
  assert.match(
    recordsRoute,
    /loadBusinessRows\("quotation_documents"\)/,
  );
  assert.match(recordsRoute, /deleteRowsByIds\("equipment_projects", "id"/);
  assert.match(recordsRoute, /deleteRowsByIds\([\s\S]*"quotation_documents"/);
});

test("selection archive uses captured child ids and rolls back failed batches", () => {
  assert.match(
    recordsRoute,
    /"accounting_collection_receipts",\s*"entry_id",\s*commissionIds/,
  );
  assert.match(
    recordsRoute,
    /"accounting_settlement_history",\s*"settlement_id",\s*settlementIds/,
  );
  assert.doesNotMatch(recordsRoute, /WHERE activity_id IN \(SELECT id FROM activities WHERE \$\{whereClause\}\)/);
  assert.match(recordsRoute, /await d1\.batch\(deleteStatements\)/);
  assert.match(
    recordsRoute,
    /DELETE FROM deletion_batches WHERE id = \?/,
  );
  assert.match(dataControlPanel, /createdArchiveIds/);
  assert.match(dataControlPanel, /앞서 이동된 항목은 자동으로 원상 복구했습니다/);
});

test("accounting and linked business data are restorable from the archive", () => {
  for (const table of [
    "manager_alert_acknowledgements",
    "accounting_settlements",
    "accounting_settlement_history",
    "accounting_commission_entries",
    "accounting_commission_entry_history",
    "accounting_collection_receipts",
  ]) {
    assert.match(recordsRoute, new RegExp(table));
    assert.match(trashStore, new RegExp(table));
  }
});

test("data-control history is included in full backup and restore", () => {
  assert.match(backupStore, /name: "data_control_events"/);
  assert.match(backupStore, /ensureDataControlReady\(\)/);
  assert.match(backupStore, /"2026-07-30-owner-data-controls"/);
});

test("full backup restore accepts every current persisted business column", () => {
  for (const column of [
    "contacts_json",
    "updated_by_member_id",
    "updated_by_name",
    "default_amount",
    "import_status",
    "expected_target_count",
  ]) {
    assert.match(backupStore, new RegExp(`"${column}"`));
  }
  assert.match(backupStore, /"contacts_json" in row \? row\.contacts_json : "\[\]"/);
  assert.match(backupStore, /"default_amount" in row \? row\.default_amount : null/);
  assert.match(backupStore, /"import_status" in row \? row\.import_status : "complete"/);
  assert.match(
    backupStore,
    /"expected_target_count" in row[\s\S]*row\.expected_target_count[\s\S]*: 0/,
  );
});

test("full backup restore repairs blank equipment project names without changing links", () => {
  assert.match(
    backupStore,
    /function normalizeEquipmentProjectRows\([\s\S]*fallbackCreatedBy: number \| null/,
  );
  assert.match(
    backupStore,
    /originalName \|\|[\s\S]*row\.budget_type[\s\S]*row\.budget_original_name[\s\S]*"미분류 사업"/,
  );
  assert.match(
    backupStore,
    /name = `\$\{inferredName\} \(복원 \$\{rowLabel\}\)`/,
  );
  assert.match(
    backupStore,
    /table\.name === "equipment_projects"[\s\S]*normalizeEquipmentProjectRows\([\s\S]*fallbackEquipmentProjectCreatedBy/,
  );
  assert.match(
    backupStore,
    /Number\(row\.created_by\) === 0 && fallbackCreatedBy[\s\S]*fallbackCreatedBy[\s\S]*row\.created_by/,
  );
});

test("full backup restore repairs stale optional links and rejects valuable orphan accounting rows", () => {
  assert.match(
    backupStore,
    /function repairBrokenActivityReferences\([\s\S]*data: Record<BackupTableName, BackupRow\[\]>/,
  );
  assert.match(
    backupStore,
    /String\(activity\.award_status \?\? ""\)\.trim\(\) === "위즈업 수주"/,
  );
  assert.match(
    backupStore,
    /return \{ \.\.\.project, activity_id: candidates\[0\]\.id \}/,
  );
  assert.match(
    backupStore,
    /accountingEntryHasBusinessValue\(entry\)[\s\S]*historyEntryIds\.has\(entryId\)[\s\S]*receiptEntryIds\.has\(entryId\)/,
  );
  assert.match(
    backupStore,
    /삭제된 활동과 연결된 회계 전표 \$\{entryId\}에 금액 또는 수금 이력이 있어 자동 복원할 수 없습니다/,
  );
  assert.match(
    backupStore,
    /빈 회계 전표 \$\{discardedAccountingEntries\.length\}건은 금액·수금·변경 이력이 없어 제외했습니다/,
  );
});

test("pre-standard-budget backups remain inspectable without erasing the current catalog", () => {
  assert.match(
    backupStore,
    /PRE_BUDGET_NAME_SCHEMA_VERSIONS[\s\S]*"2026-07-26-product-vendor-links"/,
  );
  assert.match(
    backupStore,
    /legacyBackupMayOmitTable\(schemaVersion, table\.name\)/,
  );
  assert.match(
    backupStore,
    /restoresBudgetNameCatalog[\s\S]*DELETE FROM budget_name_aliases[\s\S]*DELETE FROM budget_name_groups/,
  );
  assert.match(
    backupStore,
    /tableName === "budget_name_groups"[\s\S]*!restoresBudgetNameCatalog[\s\S]*return/,
  );
  assert.match(backupStore, /LEGACY_BUDGET_NAME_NOTICE/);
  assert.match(backupPage, /backupInspection\.compatibilityNotices/);
  assert.match(backupPage, /이전 백업 호환 안내/);
});

test("휴지통은 별도 메뉴 대신 데이터 백업·복구 화면 안에서 제공한다", () => {
  const managementMenu = crm.slice(
    crm.indexOf("const managementNavItems"),
    crm.indexOf("const visibleManagementNavItems"),
  );
  assert.doesNotMatch(managementMenu, /id: "trash"/);
  assert.match(crm, /requestedView === "trash" \? "backup"/);
  assert.match(backupPage, /import TrashPage/);
  assert.match(backupPage, /<TrashPage/);
  assert.match(backupPage, /휴지통 복구/);
  assert.doesNotMatch(backupPage, /import DataControlPanel/);
  assert.doesNotMatch(backupPage, /<DataControlPanel/);
  assert.match(trashRoute, /export async function POST/);
  assert.match(trashRoute, /export async function DELETE/);
});

test("full database backup and restore are presented in one recovery card", () => {
  const recoveryCard = backupPage.slice(
    backupPage.indexOf('<article className="panel backup-restore-card">'),
    backupPage.indexOf("</article>", backupPage.indexOf('<article className="panel backup-restore-card">')) + 10,
  );
  assert.match(recoveryCard, /전체 DB 백업·복원/);
  assert.match(recoveryCard, /전체 DB 백업 받기/);
  assert.match(recoveryCard, /전체 백업 파일 선택/);
});
