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
  assert.match(syncRoute, /validateFullBackup/);
  assert.doesNotMatch(syncRoute, /fetch\([^)]*supabase/i);
  assert.match(syncRoute, /AUTOMATIC_STANDBY_SYNC_ENABLED/);
  assert.match(syncRoute, /Automatic full-database synchronization is disabled/);
});

test("replica restore validates the signed backup before replacement", () => {
  assert.match(
    backupStore,
    /export async function restoreReplicaBackup\(input: unknown\)/,
  );
  assert.match(
    backupStore,
    /const \{ backup, inspection \} = await validateFullBackup\(input\)/,
  );
  assert.match(backupStore, /await replaceDatabaseFromBackup\(backup\)/);
  assert.doesNotMatch(
    backupStore,
    /requiredText\(\s*row\.name,\s*"equipment_projects\.name"/,
  );
  assert.match(backupStore, /column === "permissions"/);
  assert.match(backupStore, /name: "members"[\s\S]*?"job_title"/);
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
