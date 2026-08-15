import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const syncRoute = await readFile(
  new URL("../app/api/standby-sync/route.ts", import.meta.url),
  "utf8",
);
const backupStore = await readFile(
  new URL("../lib/backup-store.ts", import.meta.url),
  "utf8",
);
const migration = await readFile(
  new URL(
    "../supabase/migrations/202607200002_standby_replication.sql",
    import.meta.url,
  ),
  "utf8",
);
const scheduler = await readFile(
  new URL("../lib/replication-scheduler.ts", import.meta.url),
  "utf8",
);
const credentials = await readFile(
  new URL("../lib/standby-credentials.ts", import.meta.url),
  "utf8",
);
const vercelSchema = await readFile(
  new URL("../db/vercel-schema.ts", import.meta.url),
  "utf8",
);
const cutoverRoute = await readFile(
  new URL("../app/api/standby-cutover/route.ts", import.meta.url),
  "utf8",
);
const replicationStore = await readFile(
  new URL("../lib/replication-store.ts", import.meta.url),
  "utf8",
);
const scheduleRoute = await readFile(
  new URL("../app/api/standby-schedule/route.ts", import.meta.url),
  "utf8",
);
const exportRoute = await readFile(
  new URL("../app/api/standby-export/route.ts", import.meta.url),
  "utf8",
);
const failbackRoute = await readFile(
  new URL("../app/api/standby-failback/route.ts", import.meta.url),
  "utf8",
);
const continuityBackup = await readFile(
  new URL("../lib/continuity-backup.ts", import.meta.url),
  "utf8",
);

test("standby sync is one-way, authenticated, bounded, and uncached", () => {
  assert.match(syncRoute, /STANDBY_SYNC_SECRET/);
  assert.match(syncRoute, /PRIMARY_EXPORT_SECRET/);
  assert.match(syncRoute, /https:\/\/whizzup\.kr/);
  assert.match(syncRoute, /\/api\/standby-export/);
  assert.match(syncRoute, /secureEqual/);
  assert.match(syncRoute, /MAX_BACKUP_BYTES/);
  assert.match(syncRoute, /AbortSignal\.timeout/);
  assert.match(syncRoute, /cache:\s*"no-store"/);
  assert.match(syncRoute, /restoreReplicaBackup/);
  assert.match(syncRoute, /replicaContentChecksum/);
  assert.match(syncRoute, /createFullBackup/);
  assert.match(syncRoute, /forceRequested/);
  assert.match(syncRoute, /localChecksum !== current\.source_checksum/);
  assert.match(syncRoute, /automatic overwrite was blocked/);
  assert.match(syncRoute, /validateFullBackup/);
  assert.match(syncRoute, /validateStandbyCredentialSnapshot/);
  assert.match(syncRoute, /backup\.memberCredentials === undefined/);
  assert.match(syncRoute, /restoreStandbyCredentials/);
  assert.doesNotMatch(syncRoute, /fetch\([^)]*supabase/i);
  assert.match(syncRoute, /AUTOMATIC_STANDBY_SYNC_ENABLED/);
  assert.match(syncRoute, /Automatic full-database synchronization is disabled/);
});

test("Sites password credentials are checksum-validated and restored separately", () => {
  assert.match(credentials, /whizzup-member-credentials/);
  assert.match(credentials, /Standby credential checksum mismatch/);
  assert.match(credentials, /does not match the replicated member/);
  assert.match(credentials, /INSERT INTO member_credentials/);
  assert.match(credentials, /password_hash = excluded\.password_hash/);
  assert.match(credentials, /member_credentials\.failed_attempts/);
  assert.match(vercelSchema, /CREATE TABLE IF NOT EXISTS public\.member_credentials/);
  assert.match(vercelSchema, /REVOKE ALL ON public\.member_credentials FROM anon, authenticated/);
});

test("replica restore validates the signed backup before replacement", () => {
  assert.match(
    backupStore,
    /export async function restoreReplicaBackup\(input: unknown\)/,
  );
  assert.match(
    backupStore,
    /const \{ backup, inspection \} = await validateFullBackup\([\s\S]{0,80}input/,
  );
  assert.match(backupStore, /await replaceDatabaseFromBackup\(backup\)/);
  assert.doesNotMatch(
    backupStore,
    /requiredText\(\s*row\.name,\s*"equipment_projects\.name"/,
  );
  assert.match(backupStore, /column === "permissions"/);
  assert.match(backupStore, /name: "members"[\s\S]*?"job_title"/);
  assert.match(backupStore, /last_seen_at: _lastSeenAt/);
  assert.match(backupStore, /current_view: _currentView/);
  assert.match(backupStore, /permissions = JSON\.parse\(permissions\)/);
  assert.match(backupStore, /data: replicaChecksumData\(backup\.data\)/);
  assert.match(backupStore, /jsonb_build_array/);
  assert.match(backupStore, /memberPermissions/);
  assert.match(backupStore, /RESTORE_INSERT_CHUNK_SIZE = 100/);
  assert.match(backupStore, /insertStatements/);
});

test("replication state is private from browser database roles", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.replication_sync_state/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /REVOKE ALL ON public\.replication_sync_state FROM anon, authenticated/,
  );
});

test("Supabase sync can only be scheduled after an explicit server-side opt in", () => {
  assert.match(syncRoute, /export async function PUT/);
  assert.match(syncRoute, /if \(!automaticSyncEnabled\(\)\)/);
  assert.match(syncRoute, /configureStandbySchedule/);
  assert.match(scheduler, /CREATE EXTENSION IF NOT EXISTS pg_cron/);
  assert.match(scheduler, /CREATE EXTENSION IF NOT EXISTS pg_net/);
  assert.match(scheduler, /vault\.create_secret/);
  assert.match(scheduler, /vault\.update_secret/);
  assert.match(scheduler, /cron\.schedule/);
  assert.match(scheduler, /\*\/10 \* \* \* \*/);
  assert.match(scheduler, /Authorization/);
  assert.match(syncRoute, /export async function DELETE/);
  assert.match(scheduler, /removeStandbySchedule/);
  assert.match(scheduler, /cron\.unschedule/);
});

test("primary owner can schedule the current Sites standby every ten minutes", () => {
  assert.match(scheduleRoute, /requirePrimaryOwner/);
  assert.match(scheduleRoute, /STANDBY_SITE_ORIGIN/);
  assert.match(scheduleRoute, /whizzup-sales-hub\.jackallan\.chatgpt\.site/);
  assert.match(scheduleRoute, /configureStandbySchedule/);
  assert.match(scheduleRoute, /STANDBY_EXPORT_SECRET/);
  assert.match(scheduleRoute, /fetch\(`\$\{origin\}\/api\/standby-sync`/);
  assert.match(scheduleRoute, /AbortSignal\.timeout\(90_000\)/);
  assert.match(scheduleRoute, /getStoredStandbySyncSecret/);
  assert.match(scheduleRoute, /syncSecret\?: unknown/);
  assert.match(scheduleRoute, /force\?: unknown/);
  assert.match(scheduleRoute, /JSON\.stringify\(\{ force \}\)/);
  assert.match(exportRoute, /getStoredStandbySyncSecret/);
  assert.match(syncRoute, /STANDBY_SYNC_SECRET[\s\S]*STANDBY_EXPORT_SECRET/);
  assert.match(syncRoute, /PRIMARY_EXPORT_SECRET[\s\S]*STANDBY_EXPORT_SECRET/);
});

test("Vercel delegates owner-confirmed cutover control to the Sites gateway", () => {
  assert.match(cutoverRoute, /requirePrimaryOwner/);
  assert.match(cutoverRoute, /CUTOVER_API_SECRET/);
  assert.match(cutoverRoute, /STANDBY_SYNC_SECRET/);
  assert.match(cutoverRoute, /STANDBY_SITE_ORIGIN/);
  assert.match(cutoverRoute, /\/api\/standby-cutover/);
  assert.match(cutoverRoute, /AbortSignal\.timeout/);
});

test("Vercel failback creates a Drive safety copy and verifies reverse restore", () => {
  assert.match(failbackRoute, /CUTOVER_API_SECRET/);
  assert.match(failbackRoute, /MAX_REQUEST_BYTES/);
  assert.match(failbackRoute, /archivePreFailbackBackup/);
  assert.match(failbackRoute, /restoreReplicaBackup/);
  assert.match(failbackRoute, /restoreStandbyCredentials/);
  assert.match(failbackRoute, /checksum !== sourceChecksum/);
  assert.match(continuityBackup, /WHIZZUP_pre_failback_/);
  assert.match(continuityBackup, /전환 안전본/);
  assert.match(continuityBackup, /uploadDriveFile/);
  assert.match(syncRoute, /isVercelPrimaryMode/);
  assert.match(syncRoute, /replica overwrite is blocked/);
  assert.match(replicationStore, /operating_mode = 'primary'/);
  assert.match(replicationStore, /operating_mode = 'replica'/);
  assert.match(vercelSchema, /VERCEL_CUTOVER_SCHEMA_SQL/);
  assert.match(vercelSchema, /ADD COLUMN IF NOT EXISTS operating_mode/);
});
