import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("site layout API is shared, authenticated, and version guarded", async () => {
  const [route, store] = await Promise.all([
    read("app/api/site-layouts/route.ts"),
    read("lib/site-layout-drafts.ts"),
  ]);

  assert.match(route, /export async function GET[\s\S]*requireApprovedMember\(\)/);
  assert.match(route, /export async function POST[\s\S]*requireApprovedMember\(\)/);
  assert.match(route, /listSiteLayouts/);
  assert.match(route, /getSiteLayout/);
  assert.match(store, /payload\.draft/);
  assert.match(store, /draft\.schemaVersion \?\? requested \?\? SITE_LAYOUT_SCHEMA_VERSION/);
  assert.match(store, /WHERE id=\? AND deleted_at='' AND edit_version=\?/);
  assert.match(store, /class SiteLayoutConflictError[\s\S]*409[\s\S]*EDIT_CONFLICT/);
});

test("site layout list returns metadata without loading large draft JSON", async () => {
  const store = await read("lib/site-layout-drafts.ts");
  const listSource = store.match(
    /export async function listSiteLayouts[\s\S]*?\n}\n\nexport async function listSiteLayoutRevisions/,
  )?.[0] ?? "";
  const summaryColumns = store.match(
    /const SITE_LAYOUT_SUMMARY_COLUMNS = \[[\s\S]*?\]\.join\(", "\);/,
  )?.[0] ?? "";

  assert.ok(listSource);
  assert.ok(summaryColumns);
  assert.doesNotMatch(listSource, /SELECT \*/);
  assert.doesNotMatch(summaryColumns, /draft_json/);
  assert.doesNotMatch(summaryColumns, /drive_sync_token/);
  assert.match(listSource, /SELECT \$\{SITE_LAYOUT_SUMMARY_COLUMNS\}/);
  assert.match(listSource, /map\(siteLayoutSummaryFromRow\)/);
});

test("site layout saves immutable revisions and stale Drive uploads cannot become current", async () => {
  const [store, route] = await Promise.all([
    read("lib/site-layout-drafts.ts"),
    read("app/api/site-layouts/route.ts"),
  ]);

  assert.match(store, /INSERT INTO site_layout_revisions/);
  assert.match(store, /current_revision_id=\? WHERE id=\? AND drive_sync_token=\?/);
  assert.match(store, /drive_sync_token=\?/);
  assert.match(store, /WHERE id=\? AND drive_sync_token=\?/);
  assert.match(store, /WHERE id=\? AND current_revision_id=\? AND drive_sync_token=\?/);
  assert.match(store, /drive_sync_status='uploading' AND deleted_at=''/);
  assert.match(store, /Number\(revisionResult\.meta\.changes\) !== 1/);
  assert.match(store, /throw new SiteLayoutFinalizeConflictError\(\)/);
  assert.match(store, /if \(latest\) throw new SiteLayoutConflictError\(latest\)/);
  assert.doesNotMatch(store, /const layout = await getSiteLayout\(id\);\s*if \(!layout\)[\s\S]*return layout;/);
  assert.match(store, /site-layout:\$\{id\}:revision:\$\{revisionId\}/);
  assert.match(store, /contextType: "site-layout-json"/);
  assert.match(store, /contextType: "site-layout-pdf"/);
  assert.match(store, /SET drive_sync_status='error', drive_sync_error=\?/);
  assert.match(route, /error instanceof SiteLayoutConflictError[\s\S]*throw error/);
  assert.match(route, /latest\.driveSyncToken !== saved\.syncToken[\s\S]*SiteLayoutConflictError/);
});

test("site layout Drive path and retryable file endpoints are present", async () => {
  const [store, filesRoute] = await Promise.all([
    read("lib/site-layout-drafts.ts"),
    read("app/api/site-layouts/files/route.ts"),
  ]);

  assert.match(store, /SITE_LAYOUT_DRIVE_ROOT = "기초도면 전체"/);
  assert.match(store, /`\$\{title\} \(\$\{id\}\)`/);
  assert.match(store, /\[SITE_LAYOUT_DRIVE_ROOT, organizationFolder, businessRoundFolder, uniqueTitleFolder\]/);
  assert.match(store, /organization_name/);
  assert.match(store, /business_round/);
  assert.match(store, /room_name/);
  assert.match(store, /ALTER TABLE site_layouts ADD COLUMN organization_name/);
  assert.match(store, /R\$\{String\(revisionNumber\)\.padStart\(4, "0"\)\}/);
  assert.match(filesRoute, /retrySiteLayoutDriveSync/);
  assert.match(filesRoute, /siteLayoutDriveFile/);
  assert.match(filesRoute, /SiteLayoutConflictError/);
  assert.match(filesRoute, /Content-Disposition/);
});

test("site layout schema exists for SQLite migration and Vercel Postgres", async () => {
  const [drizzleSchema, migration, vercelSchema] = await Promise.all([
    read("db/schema.ts"),
    read("drizzle/0098_site_layout_shared_storage.sql"),
    read("db/vercel-schema.ts"),
  ]);

  for (const source of [drizzleSchema, migration, vercelSchema]) {
    assert.match(source, /site_layouts/);
    assert.match(source, /site_layout_revisions/);
    assert.match(source, /edit_version/);
    assert.match(source, /drive_sync_token/);
  }
  assert.match(vercelSchema, /202608220001_site_layout_shared_storage/);
  assert.match(vercelSchema, /SITE_LAYOUT_SHARED_STORAGE_SCHEMA_SQL/);
  assert.match(vercelSchema, /ENABLE ROW LEVEL SECURITY/);
});

test("full backup includes layouts and revisions without deleting them for old backups", async () => {
  const backup = await read("lib/backup-store.ts");

  assert.match(backup, /BACKUP_SCHEMA_VERSION = "2026-08-22-site-layout-shared-storage"/);
  assert.match(backup, /"2026-08-14-safe-drive-backup"/);
  assert.match(backup, /SITE_LAYOUT_BACKUP_TABLES = new Set\(\[[\s\S]*"site_layouts"[\s\S]*"site_layout_revisions"/);
  assert.match(backup, /legacyBackupMayOmitTable[\s\S]*SITE_LAYOUT_BACKUP_TABLES\.has/);
  assert.match(backup, /restoresSiteLayouts[\s\S]*DELETE FROM site_layout_revisions[\s\S]*DELETE FROM site_layouts/);
  assert.match(backup, /"site_layouts",[\s\S]*"site_layout_revisions"/);
  assert.match(backup, /ensureSiteLayoutsReady\(\)/);
});
