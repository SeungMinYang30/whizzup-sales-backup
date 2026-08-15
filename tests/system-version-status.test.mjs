import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, component, backupPage, styles] = await Promise.all([
  readFile(new URL("../app/api/system-version/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/version-status-card.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/data-backup-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("system version endpoint exposes only release and replication health metadata", () => {
  assert.match(route, /upstreamVercelCommit/);
  assert.match(route, /lastSuccessAt/);
  assert.match(route, /Access-Control-Allow-Origin/);
  assert.doesNotMatch(route, /syncSecret|password|token/i);
});

test("backup page renders a compact release status before backup actions", () => {
  assert.match(backupPage, /<VersionStatusCard\s*\/>[\s\S]*backup-restore-card/);
  assert.match(component, /비상 전환 준비 완료/);
  assert.match(component, /vercel\.upstreamVercelCommit === sites\.upstreamVercelCommit/);
  assert.match(component, /replicationAgeMinutes <= 30/);
});

test("version status layout folds without horizontal overflow", () => {
  assert.match(styles, /\.version-status-grid\s*\{[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*\.version-status-grid[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.version-status-grid\s*\{\s*grid-template-columns: 1fr/);
});
