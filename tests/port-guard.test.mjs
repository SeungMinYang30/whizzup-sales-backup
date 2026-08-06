import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Vercel build scripts use native Next.js", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(pkg.scripts.build, "next build");
  assert.equal(pkg.scripts.dev, "next dev");
  assert.equal(pkg.dependencies.vinext, undefined);
  assert.equal(pkg.devDependencies?.wrangler, undefined);
});

test("runtime code no longer imports Cloudflare workers", async () => {
  const database = await readFile(new URL("db/index.ts", root), "utf8");
  const openai = await readFile(new URL("lib/openai-config.ts", root), "utf8");
  assert.doesNotMatch(database, /cloudflare:workers/);
  assert.doesNotMatch(openai, /cloudflare:workers/);
});

test("baseline migration denies browser table access", async () => {
  const migration = await readFile(
    new URL(
      "supabase/migrations/202607180001_initial_schema.sql",
      root,
    ),
    "utf8",
  );
  assert.match(migration, /enable row level security/i);
  assert.match(
    migration,
    /revoke all on all tables in schema public from anon, authenticated/i,
  );
});

test("Supabase auth refresh responses are private and verified", async () => {
  const proxy = await readFile(new URL("proxy.ts", root), "utf8");
  assert.match(proxy, /setAll\(cookiesToSet,\s*headersToSet\)/);
  assert.match(proxy, /response\.headers\.set\(key,\s*value\)/);
  assert.match(proxy, /supabase\.auth\.getClaims\(\)/);
  assert.match(proxy, /\(\?!api\|/);
});

test("serverless database access has bounded concurrent connections and query deadlines", async () => {
  const database = await readFile(new URL("db/index.ts", root), "utf8");
  assert.match(database, /prepare:\s*false/);
  assert.match(database, /max:\s*3/);
  assert.match(database, /idle_timeout:\s*5/);
  assert.match(database, /DATABASE_QUERY_TIMEOUT_MS\s*=\s*15_000/);
  assert.match(database, /recycleSqlClient/);
  assert.doesNotMatch(database, /client\.end\(\{\s*timeout:\s*0\s*\}\)/);
  assert.match(database, /statement_timeout:\s*12000/);
  assert.match(database, /lock_timeout:\s*5000/);
});

test("activity and author writes share one transaction", async () => {
  const recordsStore = await readFile(
    new URL("lib/records-store.ts", root),
    "utf8",
  );
  assert.match(recordsStore, /await d1\.transaction\(async \(transaction\)/);
  assert.match(recordsStore, /transaction[\s\S]*INSERT INTO activities/);
  assert.match(recordsStore, /transaction[\s\S]*INSERT INTO activity_authors/);
});

test("records, campaign, and map location GET handlers are read-only", async () => {
  const recordsRoute = await readFile(
    new URL("app/api/records/route.ts", root),
    "utf8",
  );
  const campaignsRoute = await readFile(
    new URL("app/api/map/campaigns/route.ts", root),
    "utf8",
  );
  const locationsRoute = await readFile(
    new URL("app/api/map/locations/route.ts", root),
    "utf8",
  );
  const recordsGet = recordsRoute.match(
    /export async function GET\([^)]*\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nexport async function POST/,
  )?.[1];
  const campaignsGet = campaignsRoute.match(
    /export async function GET\(\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nexport async function POST/,
  )?.[1];
  const locationsGet = locationsRoute.match(
    /export async function GET\(\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nexport async function PUT/,
  )?.[1];

  assert.ok(recordsGet, "records GET handler should be present");
  assert.ok(campaignsGet, "campaigns GET handler should be present");
  assert.ok(locationsGet, "map locations GET handler should be present");
  assert.doesNotMatch(recordsGet, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(campaignsGet, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(locationsGet, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(recordsGet, /syncRegionsFromMappedLocations/);
  assert.doesNotMatch(recordsGet, /mergeExistingInstitutionAliases/);
  assert.doesNotMatch(locationsGet, /syncRegionsFromMappedLocations/);
});

test("map locations stay limited to active institutions while refresh state is honest", async () => {
  const locationsRoute = await readFile(
    new URL("app/api/map/locations/route.ts", root),
    "utf8",
  );
  const salesMap = await readFile(
    new URL("app/sales-map.tsx", root),
    "utf8",
  );

  assert.match(
    locationsRoute,
    /SELECT organization_locations\.\*\s+FROM organization_locations\s+WHERE EXISTS\s*\(\s*SELECT 1 FROM activities/,
  );
  assert.match(salesMap, /const \[locationsLoading,\s*setLocationsLoading\]/);
  assert.match(salesMap, /setLocationsLoading\(false\)/);
  assert.match(salesMap, /const mappedCount = eligibleOrganizations/);
  assert.match(salesMap, /기관 위치를 불러오지 못했습니다/);
});
