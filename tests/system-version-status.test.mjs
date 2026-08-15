import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, component, control, backupPage, styles] = await Promise.all([
  readFile(new URL("../app/api/system-version/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/version-status-card.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/continuity-control-card.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/data-backup-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("system version endpoint exposes only release and replication health metadata", () => {
  assert.match(route, /upstreamVercelCommit/);
  assert.match(route, /lastSuccessAt/);
  assert.match(route, /Access-Control-Allow-Origin/);
  assert.doesNotMatch(route, /syncSecret|password|token/i);
});

test("system version endpoint marks zone-less D1 timestamps as UTC", () => {
  assert.match(route, /function normalizeUtcTimestamp/);
  assert.match(route, /normalized\.replace\(" ", "T"\)/);
  assert.match(
    route,
    /lastSuccessAt: normalizeUtcTimestamp\(state\.last_success_at\)/,
  );
});

test("backup page renders a compact release status before backup actions", () => {
  assert.match(backupPage, /<VersionStatusCard\s*\/>[\s\S]*<ContinuityControlCard[\s\S]*backup-restore-card/);
  assert.match(component, /비상 전환 준비 완료/);
  assert.match(control, /비상 운영 전환/);
  assert.match(control, /운영자 본인 전용/);
  assert.match(control, /confirmation\.trim\(\) !== expected/);
  assert.match(component, /vercel\.upstreamVercelCommit === sites\.upstreamVercelCommit/);
  assert.match(component, /replicationAgeMinutes <= 30/);
  assert.match(component, /whizzup:version-status-refresh/);
  assert.match(control, /activationBlockers/);
  assert.match(control, /최종 동기화 후 Sites 전환/);
});

test("continuity controls fold into full-width mobile actions", () => {
  assert.match(styles, /\.continuity-control-summary\s*\{[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.continuity-control-summary \{ grid-template-columns: 1fr/);
});

test("version status layout folds without horizontal overflow", () => {
  assert.match(styles, /\.version-status-grid\s*\{[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*\.version-status-grid[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.version-status-grid\s*\{\s*grid-template-columns: 1fr/);
});

test("standby conflicts expose an owner-confirmed mobile-safe reset action", () => {
  assert.match(backupPage, /운영 DB로 다시 맞추기/);
  assert.match(backupPage, /configureStandbyReplication\(true\)/);
  assert.match(backupPage, /configureStandbyReplication\(standbySchedule\.configured\)/);
  assert.match(backupPage, /운영 DB로 지금 맞추기/);
  assert.match(styles, /\.standby-replication-control\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(220px, 300px\)/);
  assert.match(styles, /\.backup-error-action\s*\{[\s\S]*display: flex/);
  assert.match(
    styles,
    /@media \(max-width: 720px\)[\s\S]*\.backup-error-action\s*\{[\s\S]*flex-direction: column/,
  );
});
