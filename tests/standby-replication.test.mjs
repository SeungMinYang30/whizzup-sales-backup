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
const worker = await readFile(
  new URL("../worker/index.ts", import.meta.url),
  "utf8",
);
const memberArchiveMigration = await readFile(
  new URL("../drizzle/0095_member_account_archives.sql", import.meta.url),
  "utf8",
);
const memberReplicaCompatMigration = await readFile(
  new URL("../drizzle/0096_member_replica_compat.sql", import.meta.url),
  "utf8",
);
const coreReplicaSyncMigration = await readFile(
  new URL("../drizzle/0097_core_replica_sync_ids.sql", import.meta.url),
  "utf8",
);
const productComparisonDocuments = await readFile(
  new URL("../lib/product-comparison-documents.ts", import.meta.url),
  "utf8",
);

test("standby sync is one-way, authenticated, bounded, and uncached", () => {
  assert.match(syncRoute, /STANDBY_SYNC_SECRET/);
  assert.match(syncRoute, /PRIMARY_EXPORT_SECRET/);
  assert.match(syncRoute, /VERCEL_PRIMARY_ORIGIN/);
  assert.match(
    syncRoute,
    /VERCEL_PRIMARY_ORIGIN[\s\S]*PRIMARY_SITE_ORIGIN[\s\S]*DEFAULT_PRIMARY_ORIGIN/,
  );
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

test("Sites D1 contains the durable member archive required by full restore", () => {
  assert.match(
    memberArchiveMigration,
    /CREATE TABLE IF NOT EXISTS `member_account_archives`/,
  );
  assert.match(memberArchiveMigration, /`original_member_id` integer NOT NULL/);
  assert.match(memberArchiveMigration, /`member_json` text NOT NULL/);
});

test("Sites D1 preserves the Vercel member identity columns used by full restore", () => {
  for (const column of ["sync_id", "auth_user_id", "username"]) {
    assert.match(
      memberReplicaCompatMigration,
      new RegExp("ADD COLUMN `" + column + "` text"),
    );
  }
});

test("Sites D1 preserves sync ids for every shared core table", () => {
  for (const table of [
    "activities",
    "organization_locations",
    "sales_campaigns",
    "sales_campaign_targets",
    "equipment_projects",
    "equipment_items",
  ]) {
    assert.match(
      coreReplicaSyncMigration,
      new RegExp("ALTER TABLE `" + table + "` ADD COLUMN `sync_id` text"),
    );
  }
});

test("Sites D1 removes legacy required comparison columns before full restore", () => {
  assert.match(
    productComparisonDocuments,
    /!isPostgresDatabase\(\).*columnNames\.has\("product_id"\)/,
  );
  assert.match(
    productComparisonDocuments,
    /DROP TABLE product_comparison_documents/,
  );
  const replacementDefinition = productComparisonDocuments.slice(
    productComparisonDocuments.indexOf("CREATE TABLE product_comparison_documents_replica"),
    productComparisonDocuments.indexOf(")`,", productComparisonDocuments.indexOf("CREATE TABLE product_comparison_documents_replica")),
  );
  assert.doesNotMatch(replacementDefinition, /`product_id`|`object_key`/);
});

test("replica restore serializes member permissions without PostgreSQL casts on D1", () => {
  assert.match(
    backupStore,
    /if \(!isPostgresDatabase\(\)\)[\s\S]*JSON\.stringify\(memberPermissions\)/,
  );
});

test("replica restore keeps D1 batches below the SQLite variable limit", () => {
  assert.match(
    backupStore,
    /Math\.max\(1, Math\.floor\(90 \/ table\.columns\.length\)\)/,
  );
  assert.match(backupStore, /offset \+= chunkSize/);
  assert.match(
    backupStore,
    /if \(isPostgresDatabase\(\)\) \{[\s\S]*pg_get_serial_sequence/,
  );
});

test("replica restore inserts each joint-project table exactly once", () => {
  const insertOrder = backupStore.slice(
    backupStore.indexOf("const insertOrder: BackupTableName[] = ["),
    backupStore.indexOf("insertOrder.forEach"),
  );
  for (const table of [
    "joint_projects",
    "joint_project_members",
    "joint_project_events",
  ]) {
    assert.equal(insertOrder.split(`\"${table}\"`).length - 1, 1);
  }
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

test("Sites cutover performs verified forward and reverse synchronization", () => {
  assert.match(cutoverRoute, /requirePrimaryOwner/);
  assert.match(cutoverRoute, /authorizedByServerSecret/);
  assert.match(cutoverRoute, /CUTOVER_API_SECRET/);
  assert.match(cutoverRoute, /STANDBY_EXPORT_SECRET/);
  assert.match(cutoverRoute, /missingMembers/);
  assert.doesNotMatch(cutoverRoute, /if \(!credentials\.ready\)/);
  assert.match(cutoverRoute, /screenshot service/);
  assert.match(cutoverRoute, /STANDBY_SYNC_SECRET/);
  assert.match(cutoverRoute, /SITES 비상 전환/);
  assert.match(cutoverRoute, /VERCEL 정상 복귀/);
  assert.match(cutoverRoute, /gatewayStatus/);
  assert.match(cutoverRoute, /SITES_GATEWAY_IPV4_TARGETS/);
  assert.match(cutoverRoute, /cloudflare-dns\.com\/dns-query/);
  assert.match(cutoverRoute, /expectedAddresses\.every/);
  assert.match(cutoverRoute, /removeStandbySchedule/);
  assert.match(cutoverRoute, /force:\s*true/);
  assert.match(cutoverRoute, /localChecksum !== state\.source_checksum/);
  assert.match(cutoverRoute, /\/api\/standby-failback/);
  assert.match(cutoverRoute, /markStandbyPrimaryMode/);
  assert.match(cutoverRoute, /markStandbyReplicaMode/);
  assert.match(cutoverRoute, /configureStandbySchedule/);
  assert.match(syncRoute, /isVercelPrimaryMode/);
  assert.match(syncRoute, /replica overwrite is blocked/);
  assert.match(replicationStore, /operating_mode = 'primary'/);
  assert.match(replicationStore, /operating_mode = 'replica'/);
  assert.match(vercelSchema, /VERCEL_CUTOVER_SCHEMA_SQL/);
  assert.match(vercelSchema, /ADD COLUMN IF NOT EXISTS operating_mode/);
});

test("Sites edge gateway proxies Vercel and locks standby writes", () => {
  assert.match(worker, /PUBLIC_HOSTS/);
  assert.match(worker, /proxyToVercel/);
  assert.match(worker, /whizzup-sales-hub\.vercel\.app/);
  assert.match(worker, /continuity-gateway/);
  assert.match(worker, /state\.transition && unsafeMethod/);
  assert.match(worker, /DIRECT_WRITE_ALLOWLIST/);
  assert.match(worker, /대기판은 현재 읽기 전용/);
});
