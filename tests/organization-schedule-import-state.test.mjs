import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../lib/organization-schedules.ts", import.meta.url);

test("deleting the final schedule does not re-import legacy progress_schedule", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /CREATE TABLE IF NOT EXISTS organization_schedule_import_state/);
  assert.match(
    source,
    /SELECT 1 AS imported[\s\S]*FROM organization_schedule_import_state[\s\S]*if \(imported\) return;/,
  );
  assert.match(
    source,
    /INSERT OR IGNORE INTO organization_schedule_import_state[\s\S]*entries\.map/,
  );
});
