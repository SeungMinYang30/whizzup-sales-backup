import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const client = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8");
const store = await readFile(new URL("../lib/records-store.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const repair = await readFile(new URL("../lib/business-round-rollover-repair.ts", import.meta.url), "utf8");
const repairRoute = await readFile(
  new URL("../app/api/data-control/business-round-rollover/route.ts", import.meta.url),
  "utf8",
);

test("a new record after a completed business reuses one active next round or creates exactly one", () => {
  assert.match(client, /latestCompletedRound[\s\S]*reusableActiveRound[\s\S]*latestCompletedRound \+ 1/);
  assert.match(store, /latestCompletedRound[\s\S]*reusableActiveRound[\s\S]*latestCompletedRound \+ 1/);
  assert.match(store, /advancedFromCompletedBusiness[\s\S]*awardStatus: "[^"]+"[\s\S]*awardStage: "[^"]+"/);
});

test("activity history deletion removes optional children before the parent and reports the server error", () => {
  const child = route.search(/"organization_schedules",\s*"id"/);
  const parent = route.indexOf('"activities", "id", selectedActivityIds');
  assert.ok(child >= 0 && parent > child);
  assert.match(client, /payload\.error \|\| "[^"]+"/);
});

test("mobile Google link dialog keeps its body scrollable and footer visible", () => {
  assert.match(styles, /\.schedule-readonly-dialog \{[\s\S]*display: flex[\s\S]*overflow: hidden/);
  assert.match(styles, /\.schedule-readonly-dialog > dl \{[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.schedule-readonly-dialog > footer \{[\s\S]*grid-template-columns: repeat\(2/);
});

test("retroactive business-round correction is owner-only, backed up, and transactional", () => {
  assert.match(repairRoute, /requirePrimaryOwner\(\)/);
  assert.match(repairRoute, /APPLY_BUSINESS_ROUND_ROLLOVER/);
  assert.match(repair, /business_round_rollover_repair_backups/);
  assert.match(repair, /transaction\(async \(transaction\)/);
  assert.match(repair, /WHERE id = \? AND business_round = \?/);
  assert.match(repair, /award_status = '미정'/);
  assert.match(repair, /status = '상담 진행'/);
});
