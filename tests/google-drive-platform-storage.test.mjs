import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Sites keeps Drive status separate from its D1/R2 storage path", async () => {
  const [source, route, page] = await Promise.all([
    read("lib/google-drive-storage.ts"),
    read("app/api/google-drive-settings/route.ts"),
    read("app/crm-app.tsx"),
  ]);
  assert.match(source, /platform: "sites"/);
  assert.match(source, /Google Drive 대신 D1\/R2 독립 저장소/);
  assert.match(route, /requireMemberPermission\("integration:manage"\)/);
  assert.match(page, /googleDriveSettings\?\.platform === "vercel"/);
  assert.match(page, /X-WHIZZUP-Request-Mode/);
});

test("Sites resource downloads preserve storage errors without changing R2 behavior", async () => {
  const [source, resourceRoute] = await Promise.all([
    read("lib/google-drive-storage.ts"),
    read("app/api/resources/route.ts"),
  ]);
  assert.match(source, /postgres-object:/);
  assert.match(resourceRoute, /googleDriveStorageErrorResponse\(error\)/);
  assert.match(resourceRoute, /downloadDriveFile\(row\.drive_file_id\)/);
});
