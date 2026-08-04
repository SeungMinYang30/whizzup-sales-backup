import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recordsStore = await readFile(
  new URL("../lib/records-store.ts", import.meta.url),
  "utf8",
);
const recordsApi = await readFile(
  new URL("../app/api/records/route.ts", import.meta.url),
  "utf8",
);
const schedules = await readFile(
  new URL("../lib/organization-schedules.ts", import.meta.url),
  "utf8",
);
const crmApp = await readFile(
  new URL("../app/crm-app.tsx", import.meta.url),
  "utf8",
);

test("manual award stage is persisted separately from automatic schedule stages", () => {
  assert.match(
    recordsStore,
    /award_stage_manual INTEGER NOT NULL DEFAULT 0/,
  );
  assert.match(
    recordsApi,
    /award_stage_manual = \?/,
  );
  assert.match(
    crmApp,
    /awardStageManual: field === "awardStage" \? true : undefined/,
  );
});

test("construction schedule automation never overwrites a manual award stage", () => {
  const guards = schedules.match(
    /COALESCE\(award_stage_manual, 0\) = 0/g,
  ) ?? [];
  assert.equal(guards.length, 3);
  assert.match(
    recordsStore,
    /record\.award_stage_manual === 1\s+\? record\.award_stage\s+: managed\.awardStage/,
  );
});
