import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("bootstrap admin promotion requires the configured email and no other approved admin", async () => {
  const collaboration = await readFile(
    new URL("lib/collaboration.ts", root),
    "utf8",
  );

  assert.match(collaboration, /bootstrapAdminEmail === email/);
  assert.match(collaboration, /lower\(candidate\.email\) = lower\(\?\)/);
  assert.match(collaboration, /NOT EXISTS\s*\(/);
  assert.match(
    collaboration,
    /approved_admin\.role = 'admin'[\s\S]*approved_admin\.status = 'approved'/,
  );
});

test("unapproved sessions return neutral fields before shared settings are read", async () => {
  const sessionRoute = await readFile(
    new URL("app/api/session/route.ts", root),
    "utf8",
  );

  const approvalGuard = sessionRoute.indexOf(
    'if (member.status !== "approved")',
  );
  const settingsRead = sessionRoute.indexOf(
    "SELECT value FROM app_settings",
  );
  assert.ok(approvalGuard >= 0);
  assert.ok(settingsRead > approvalGuard);
  assert.match(
    sessionRoute.slice(approvalGuard, settingsRead),
    /pendingCount:\s*0[\s\S]*approvedCount:\s*0[\s\S]*sharedGptUrl:\s*""[\s\S]*aiModel:\s*""/,
  );
});

test("unexpected server failures use a generic client response", async () => {
  const collaboration = await readFile(
    new URL("lib/collaboration.ts", root),
    "utf8",
  );

  const handler = collaboration.slice(
    collaboration.indexOf("export function accessErrorResponse"),
    collaboration.indexOf("export function randomToken"),
  );
  assert.match(handler, /error\.status >= 400[\s\S]*error\.status < 500/);
  assert.doesNotMatch(handler, /error instanceof Error \? error\.message/);
  assert.match(handler, /잠시 후 다시 시도해 주세요/);
});
