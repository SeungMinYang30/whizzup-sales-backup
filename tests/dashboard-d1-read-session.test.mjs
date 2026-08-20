import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const db = fs.readFileSync(new URL("../db/index.ts", import.meta.url), "utf8");
const records = fs.readFileSync(
  new URL("../app/api/records/route.ts", import.meta.url),
  "utf8",
);

test("dashboard reads use an unconstrained D1 session", () => {
  assert.match(db, /withSession\("first-unconstrained"\)/);
  assert.match(records, /dashboardScope \? getReadD1\(\) : primaryD1/);
  assert.match(records, /WITH limited_activities AS/);
  assert.match(records, /FROM limited_activities source_activity/);
});
