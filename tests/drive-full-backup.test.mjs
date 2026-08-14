import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/backup/route.ts", import.meta.url),
  "utf8",
);
const page = await readFile(
  new URL("../app/data-backup-page.tsx", import.meta.url),
  "utf8",
);

test("full backup button archives one restorable JSON file to dated Google Drive folders", () => {
  assert.match(route, /action === "archive-full-backup"/);
  assert.match(route, /folderSegments: \["WHIZZUP DB 백업", timestamp\.year, timestamp\.month\]/);
  assert.match(route, /WHIZZUP_full_backup_\$\{timestamp\.fileStamp\}\.json/);
  assert.match(route, /contextId: backup\.checksum/);
  assert.match(page, /Google Drive에 전체 DB 백업/);
  assert.match(page, /body: JSON\.stringify\(\{ action: "archive-full-backup" \}\)/);
});

test("full backup action does not download a second copy to the PC", () => {
  const fullBranch = page.slice(
    page.indexOf('if (kind === "full")'),
    page.indexOf('const response = await fetch(`/api/backup?kind=${kind}`'),
  );
  assert.doesNotMatch(fullBranch, /saveBlob/);
  assert.match(fullBranch, /return;/);
});
