import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/credential-migration/route.ts", import.meta.url),
  "utf8",
);
const credentials = await readFile(
  new URL("../lib/standby-credentials.ts", import.meta.url),
  "utf8",
);

test("credential migration is owner-only and reads the legacy export", () => {
  assert.match(route, /requirePrimaryOwner/);
  assert.match(route, /PRIMARY_EXPORT_SECRET/);
  assert.match(route, /whizzup-sales-hub\.jackallan\.chatgpt\.site/);
  assert.match(route, /validateStandbyCredentialSnapshot/);
});

test("credential migration only fills missing target credentials", () => {
  assert.match(credentials, /mergeMissingStandbyCredentials/);
  assert.match(credentials, /targetMemberByEmail\.get\(credential\.email\)/);
  assert.match(credentials, /existingMemberIds\.has/);
  assert.match(credentials, /ON CONFLICT\(member_id\) DO NOTHING/);
});

test("credential migration records a pre-import credential snapshot", () => {
  assert.match(route, /createStandbyCredentialSnapshot/);
  assert.match(route, /backup:/);
  assert.match(route, /checksum: localSnapshot\.checksum/);
});
