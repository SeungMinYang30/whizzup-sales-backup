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
  ]) {
    assert.match(backup, new RegExp(`name: "${table}"`));
    assert.match(backup, new RegExp(`DELETE FROM ${table}`));
  }
  assert.match(backup, /"holdem_weekly_scores",\s*\n\s*\];/);
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

test("activity CSV preserves and re-resolves every budget allocation", () => {
  assert.match(activityCsv, /"예산 목록 JSON"/);
  assert.match(activityCsv, /row\.budgets_json/);
  assert.match(activityCsv, /activityBudgetsFromRecord/);
  assert.match(activityCsv, /resolvedBudgetMetadata/);
  assert.match(activityCsv, /serializeActivityBudgets\(resolvedBudgets\)/);
});
