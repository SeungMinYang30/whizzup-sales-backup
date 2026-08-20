import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const directorySource = readFileSync(
  new URL("../lib/school-directory.ts", import.meta.url),
  "utf8",
);
const lookupRoute = readFileSync(
  new URL("../app/api/school-directory/lookup/route.ts", import.meta.url),
  "utf8",
);
const syncRoute = readFileSync(
  new URL("../app/api/school-directory/sync/route.ts", import.meta.url),
  "utf8",
);
const salesMap = readFileSync(
  new URL("../app/sales-map.tsx", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../db/schema.ts", import.meta.url),
  "utf8",
);

test("official school data and organization links are persisted in D1", () => {
  assert.match(schema, /officialSchoolDirectory/);
  assert.match(schema, /organizationSchoolLinks/);
  assert.match(directorySource, /official_school_directory/);
  assert.match(directorySource, /organization_school_links/);
});

test("empty misses are bypassed and existing organizations can be backfilled", () => {
  assert.match(directorySource, /cacheKey = `v2\|/);
  assert.match(directorySource, /if \(rows\.length\) return rows/);
  assert.match(directorySource, /backfillOrganizationSchoolLinks/);
  assert.match(syncRoute, /requireMemberPermission\("integration:manage"\)/);
});

test("same-name schools are only linked with a unique location score", () => {
  assert.match(directorySource, /best\.score >= 3/);
  assert.match(
    directorySource,
    /best\.score - \(runnerUp\?\.score \?\? 0\) >= 2/,
  );
  assert.match(directorySource, /acceptedNameKeys\.has/);
});

test("map lookup sends region and address separately", () => {
  assert.match(salesMap, /focusedSchoolLookupRegion/);
  assert.match(salesMap, /focusedSchoolLookupAddress/);
  assert.match(lookupRoute, /url\.searchParams\.get\("region"\)/);
  assert.match(lookupRoute, /url\.searchParams\.get\("address"\)/);
});
