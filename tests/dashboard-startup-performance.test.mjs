import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectUrl = new URL("../", import.meta.url);

test("D1 startup skips repeated compatibility work after the runtime marker", async () => {
  const recordsStore = await readFile(
    new URL("lib/records-store.ts", projectUrl),
    "utf8",
  );
  const budgetNames = await readFile(
    new URL("lib/budget-names.ts", projectUrl),
    "utf8",
  );
  const migration = await readFile(
    new URL("drizzle/0075_dashboard_startup_performance.sql", projectUrl),
    "utf8",
  );

  assert.match(recordsStore, /if \(await isRecordsRuntimeReady\(d1\)\) return d1/);
  assert.match(recordsStore, /await markRecordsRuntimeReady\(d1\)/);
  assert.match(budgetNames, /if \(await isBudgetNamesRuntimeReady\(d1\)\) return d1/);
  assert.match(budgetNames, /await markBudgetNamesRuntimeReady\(d1\)/);
  assert.match(migration, /activities_progress_schedule_idx/);
  assert.match(migration, /PRAGMA optimize/);
  assert.doesNotMatch(
    migration,
    /runtime_ready_v75/,
    "fresh or restored databases must complete compatibility initialization once",
  );
});

test("calendar reconciliation no longer waits several seconds", async () => {
  const calendar = await readFile(
    new URL("app/home-calendar.tsx", projectUrl),
    "utf8",
  );
  const delay = calendar.match(/window\.setTimeout\(resolve, ([\d_]+)\)/);

  assert.ok(delay, "calendar reconciliation delay should remain explicit");
  assert.ok(Number(delay[1].replaceAll("_", "")) <= 1_000);
  assert.doesNotMatch(calendar, /3_500/);
});
