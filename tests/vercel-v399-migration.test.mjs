import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Vercel v399 schema contains every newly introduced operational area", async () => {
  const schema = await read("db/vercel-schema.ts");
  for (const table of [
    "joint_projects",
    "joint_project_members",
    "inventory_products",
    "inventory_transactions",
    "organization_schedules",
    "construction_schedule_projects",
    "authored_quotations",
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  assert.match(schema, /ADD COLUMN IF NOT EXISTS budgets_json/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS auth_user_id uuid/);
  assert.match(schema, /hidden_at text NOT NULL DEFAULT ''/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS hidden_at/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS selection_date/);
  assert.match(
    schema,
    /authored_quotations[\s\S]*?ADD COLUMN IF NOT EXISTS business_round/,
  );
  assert.match(
    schema,
    /organization_schedules[\s\S]*?ADD COLUMN IF NOT EXISTS business_round/,
  );
  assert.match(
    schema,
    /construction_schedule_projects[\s\S]*?ADD COLUMN IF NOT EXISTS business_round/,
  );
  assert.match(
    schema,
    /manager_alert_acknowledgements[\s\S]*?ADD COLUMN IF NOT EXISTS hidden_at text/,
  );
});

test("Postgres compatibility serializes and de-duplicates runtime migrations", async () => {
  const adapter = await read("db/index.ts");
  assert.match(adapter, /pg_advisory_xact_lock/);
  assert.match(adapter, /ADD COLUMN IF NOT EXISTS/);
  assert.match(adapter, /ADD\\s\+COLUMN/);
  assert.match(adapter, /a\.created_at::text/);
});

test("large full backups use gzip across the Vercel request boundary", async () => {
  const route = await read("app/api/backup/route.ts");
  const page = await read("app/data-backup-page.tsx");

  assert.match(route, /gzipSync/);
  assert.match(route, /gunzipSync/);
  assert.match(route, /Content-Encoding": "gzip"/);
  assert.match(page, /CompressionStream\("gzip"\)/);
  assert.match(page, /application\/gzip/);
});

test("restored approved members reuse the same Google email without reapproval", async () => {
  const collaboration = await read("lib/collaboration.ts");
  const backupStore = await read("lib/backup-store.ts");

  assert.match(collaboration, /lower\(email\) = lower\(\?\)/);
  assert.match(collaboration, /SET auth_user_id = \?/);
  assert.match(collaboration, /fetchApprovedPrimaryMember\(email\)/);
  assert.match(collaboration, /primaryMember\.permissions/);
  assert.match(backupStore, /name: "members"/);
  assert.match(backupStore, /"permissions"/);
  assert.match(backupStore, /parseMemberPermissions/);
});

test("the clean Vercel origin replaces the retired backup alias", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const envExample = await read(".env.example");
  const syncRoute = await read("app/api/standby-sync/route.ts");

  assert.equal(packageJson.name, "whizzup-sales-hub");
  assert.match(envExample, /APP_ORIGIN=https:\/\/whizzup-sales-hub\.vercel\.app/);
  assert.match(syncRoute, /https:\/\/whizzup-sales-hub\.vercel\.app/);
  assert.doesNotMatch(syncRoute, /whizzup-sales-backup\.vercel\.app/);
});

test("preview Google login returns to the preview deployment", async () => {
  const startRoute = await read("app/auth/google/route.ts");
  const callbackRoute = await read("app/auth/callback/route.ts");

  for (const route of [startRoute, callbackRoute]) {
    assert.match(route, /process\.env\.VERCEL_ENV === "preview"/);
    assert.match(route, /return requestUrl\.origin/);
    assert.match(route, /process\.env\.APP_ORIGIN/);
  }
});
