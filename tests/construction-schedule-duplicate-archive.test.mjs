import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [schedules, schema] = await Promise.all([
  readFile(new URL("../lib/organization-schedules.ts", import.meta.url), "utf8"),
  readFile(new URL("../db/vercel-schema.ts", import.meta.url), "utf8"),
]);

test("AI-origin sales duplicates are archived after construction conversion", () => {
  assert.match(schedules, /archiveConstructionDuplicateSalesSchedules/);
  assert.match(schedules, /construction\.source_activity_id = sales\.source_activity_id/);
  assert.match(schedules, /construction_duplicate_archived/);
  assert.match(schedules, /deleted_at = CURRENT_TIMESTAMP/);
  assert.match(schedules, /await archiveConstructionDuplicateSalesSchedules\(d1, \{[\s\S]*?memberId: input\.memberId/);
});

test("unlinked legacy duplicates are archived only when they contain no separate work", () => {
  assert.match(schedules, /sales\.source_activity_id IS NULL/);
  assert.match(schedules, /TRIM\(COALESCE\(sales\.start_time, ''\)\) = ''/);
  assert.match(schedules, /TRIM\(COALESCE\(sales\.content, ''\)\) = ''/);
  assert.match(schedules, /TRIM\(COALESCE\(sales\.details, ''\)\) = ''/);
  assert.match(schedules, /TRIM\(COALESCE\(sales\.google_event_id, ''\)\) = ''/);
});

test("Vercel migration applies the same recoverable archive retroactively", () => {
  assert.match(schema, /202608170001_construction_schedule_duplicate_archive/);
  assert.match(schema, /CONSTRUCTION_SCHEDULE_DUPLICATE_ARCHIVE_SQL/);
  assert.match(schema, /sales\.source_activity_id IS NOT NULL/);
  assert.match(schema, /construction\.source_activity_id = sales\.source_activity_id/);
  assert.match(schema, /updated_by_name = '시공 중복 일정 소급 보관'/);
  assert.doesNotMatch(schema, /DELETE FROM public\.organization_schedules AS sales/);
});
