import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/standby-export/route.ts", import.meta.url),
  "utf8",
);
const credentialExport = await readFile(
  new URL("../lib/standby-credentials.ts", import.meta.url),
  "utf8",
);

test("standby export requires a server-side bearer secret", () => {
  assert.match(route, /STANDBY_EXPORT_SECRET/);
  assert.match(route, /authorization/);
  assert.match(route, /secureEqual/);
  assert.match(route, /status:\s*401/);
  assert.doesNotMatch(route, /requireApprovedMember|requireAdminMember/);
});

test("standby export is read-only and never cached", () => {
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(route, /createFullBackup/);
  assert.match(route, /private, no-store/);
  assert.match(route, /X-WHIZZUP-Backup-Checksum/);
  assert.match(route, /createStandbyCredentialSnapshot/);
  assert.match(route, /memberCredentials/);
  assert.match(credentialExport, /FROM member_credentials c/);
  assert.match(credentialExport, /sha256/);
});
