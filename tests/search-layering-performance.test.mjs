import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps global institution results above sticky page controls", async () => {
  const styles = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(styles, /\.topbar\s*\{[^}]*z-index:\s*20/);
  assert.match(
    styles,
    /\.global-institution-results\s*\{[^}]*z-index:\s*90/,
  );
  assert.match(styles, /\.manager-priority-header\s*\{[\s\S]*?z-index:\s*18/);
  assert.match(styles, /\.manager-priority-panel\s*>\s*\.manager-toolbar\s*\{[\s\S]*?z-index:\s*17/);
});

test("loads a compact dashboard first and pauses presence traffic while hidden", async () => {
  const crm = await readFile(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(crm, /const nextRecords = await requestRecords\("dashboard"\)/);
  assert.doesNotMatch(crm, /preloadManagerRecords/);
  assert.match(crm, /requestRecords\("full"\)/);
  assert.match(crm, /document\.visibilityState !== "visible"/);
  assert.match(crm, /loadManagerAlerts\(\),\s*loadEquipmentQuoteSummaries\(\)/);
});
