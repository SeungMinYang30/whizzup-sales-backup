import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register(new URL("./typescript-resolver.mjs", import.meta.url));

const { latestAwardRecords, latestAwardStateRecords } = await import(
  "../lib/award-state.ts"
);

const previousAward = {
  id: 1,
  organization: "웨스포어린이집",
  business_round: 1,
  activity_date: "2026-08-13",
  award_status: "타업체 수주",
};

test("ordinary pending activity does not erase a previous award", () => {
  const rows = [
    previousAward,
    {
      id: 2,
      organization: "웨스포어린이집",
      business_round: 1,
      activity_date: "2026-08-20",
      award_status: "미정",
      award_status_explicit: 0,
    },
  ];
  assert.equal(latestAwardRecords(rows)[0]?.id, 1);
});

test("explicit pending state clears the previous award", () => {
  const rows = [
    previousAward,
    {
      id: 2,
      organization: "웨스포어린이집",
      business_round: 1,
      activity_date: "2026-08-20",
      award_status: "미정",
      award_status_explicit: 1,
    },
  ];
  assert.equal(latestAwardStateRecords(rows)[0]?.id, 2);
  assert.deepEqual(latestAwardRecords(rows), []);
});

test("a newer explicit award replaces the previous award", () => {
  const rows = [
    previousAward,
    {
      id: 3,
      organization: "웨스포어린이집",
      business_round: 1,
      activity_date: "2026-08-21",
      award_status: "위즈업 수주",
      award_status_explicit: 1,
    },
  ];
  assert.equal(latestAwardRecords(rows)[0]?.id, 3);
});

test("explicit award state is persisted by D1 schema, updates, backups, and migration", async () => {
  const [route, ledger, backup, schema, migration] = await Promise.all([
    readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/activity-change-ledger.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/backup-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0099_explicit_award_status.sql", import.meta.url), "utf8"),
  ]);

  assert.match(route, /award_status = \?, award_status_explicit = \?/);
  assert.match(route, /award_status_explicit = CASE[\s\S]*WHEN \? = 1 THEN 1/);
  assert.match(ledger, /"award_status_explicit"/);
  assert.match(backup, /"award_status",\s*"award_status_explicit",\s*"award_company"/);
  assert.match(schema, /awardStatusExplicit: integer\("award_status_explicit"/);
  assert.match(migration, /ADD COLUMN award_status_explicit INTEGER NOT NULL DEFAULT 0/);
});

test("reviewed AI forms record a pending choice even when pending was already selected", async () => {
  const crm = await readFile(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    crm,
    /value=\{form\.awardStatus\}[\s\S]*onPointerDown=\{\(\) => \{[\s\S]*awardStatusExplicit: true/,
  );
  assert.match(
    crm,
    /\["ArrowDown", "ArrowUp", "Enter", " "\]\.includes[\s\S]*awardStatusExplicit: true/,
  );
  assert.match(crm, /이 사업은 수주 전 상태로 명시 저장됩니다\./);
});
