import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const backup = await readFile(
  new URL("../lib/backup-store.ts", import.meta.url),
  "utf8",
);
const activityCsv = await readFile(
  new URL("../lib/activity-csv.ts", import.meta.url),
  "utf8",
);

test("full backup includes every durable business table added after the original backup screen", () => {
  for (const table of [
    "quotation_documents",
    "authored_quotations",
    "award_vendor_documents",
    "organization_school_links",
    "deletion_batches",
    "holdem_weekly_scores",
    "member_rejections",
    "member_account_archives",
  ]) {
    assert.match(backup, new RegExp(`name: "${table}"`));
    assert.match(backup, new RegExp(`DELETE FROM ${table}`));
  }
  assert.match(backup, /"holdem_weekly_scores",\s*\n\s*\];/);
});

test("full backup explicitly classifies security, cache, file, and repair tables", () => {
  assert.match(backup, /EXCLUDED_DATABASE_TABLES/);
  for (const table of [
    "member_credentials",
    "member_sessions",
    "oauth_tokens",
    "object_storage_files",
    "official_school_cache",
    "youtube_channel_videos",
    "business_round_rollover_repair_backups",
  ]) {
    assert.match(backup, new RegExp(`"${table}"`));
  }
});

test("older backups preserve current post-July business data instead of clearing it", () => {
  assert.match(backup, /COMPLETE_BUSINESS_BACKUP_TABLES/);
  assert.match(
    backup,
    /schemaVersion !== BACKUP_SCHEMA_VERSION[\s\S]*COMPLETE_BUSINESS_BACKUP_TABLES\.has/,
  );
  assert.match(backup, /LEGACY_COMPLETE_BUSINESS_NOTICE/);
  assert.match(backup, /restoresQuotationDocuments/);
  assert.match(backup, /restoresAuthoredQuotations/);
  assert.match(backup, /restoresAwardVendorDocuments/);
  assert.match(backup, /restoresOrganizationSchoolLinks/);
  assert.match(backup, /restoresDeletionBatches/);
  assert.match(backup, /restoresHoldemScores/);
});

test("backup validates document, trash, school-link, and holdem ownership references", () => {
  assert.match(backup, /award_vendor_documents\.vendor_id/);
  assert.match(backup, /quotation_documents\.created_by/);
  assert.match(backup, /authored_quotations\.created_by/);
  assert.match(backup, /authored_quotations\.updated_by/);
  assert.match(backup, /deletion_batches\.deleted_by_member_id/);
  assert.match(backup, /holdem_weekly_scores\.member_id/);
});

test("backup clearly distinguishes document metadata from stored file originals", () => {
  assert.match(
    backup,
    /견적서·자료실·협력사 증빙 첨부파일 원본\(R2 또는 Google Drive 연결정보만 포함\)/,
  );
});

test("full backup preserves accounting history whose source activity is already in trash", () => {
  assert.match(backup, /preservedOrphanAccountingRows/);
  assert.match(backup, /현재 DB 상태 그대로 보존합니다/);
  assert.doesNotMatch(
    backup,
    /금액 또는 수금 이력이 있어 자동 복원할 수 없습니다/,
  );
});

test("Vercel identity and sync columns are preserved for every migrated core table", () => {
  assert.match(
    backup,
    /"sync_id",\s*\n\s*"auth_user_id",\s*\n\s*"username",\s*\n\s*"email"/,
  );
  for (const table of [
    "activities",
    "organization_locations",
    "sales_campaigns",
    "sales_campaign_targets",
    "equipment_projects",
    "equipment_items",
  ]) {
    const tableStart = backup.indexOf(`name: "${table}"`);
    assert.notEqual(tableStart, -1);
    assert.match(backup.slice(tableStart, tableStart + 240), /"sync_id"/);
  }
});

test("backup selects only approved columns and excludes local password material", () => {
  assert.match(backup, /SELECT \$\{table\.columns\.join\(", "\)\} FROM/);
  const memberTable = backup.slice(
    backup.indexOf('name: "members"'),
    backup.indexOf('name: "activities"'),
  );
  assert.doesNotMatch(memberTable, /"password_hash"|"password_salt"/);
});

test("member permissions accept native JSON arrays and restore without string coercion", () => {
  assert.match(
    backup,
    /table\.name === "members"[\s\S]*column === "permissions"[\s\S]*Array\.isArray\(value\)[\s\S]*value\.every/,
  );
  assert.match(
    backup,
    /const parsed = Array\.isArray\(row\.permissions\)[\s\S]*\? row\.permissions[\s\S]*JSON\.parse/,
  );
});

test("activity CSV preserves and re-resolves every budget allocation", () => {
  assert.match(activityCsv, /"예산 목록 JSON"/);
  assert.match(activityCsv, /row\.budgets_json/);
  assert.match(activityCsv, /activityBudgetsFromRecord/);
  assert.match(activityCsv, /resolvedBudgetMetadata/);
  assert.match(activityCsv, /serializeActivityBudgets\(resolvedBudgets\)/);
});
