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
  assert.match(route, /"WHIZZUP DB 백업",\s*"안전본",\s*timestamp\.year,\s*timestamp\.month/);
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

test("restore selects, inspects, and restores the backup directly from Google Drive", () => {
  assert.match(route, /action === "list-drive-backups"/);
  assert.match(route, /action === "inspect-drive-backup"/);
  assert.match(route, /action === "restore-drive-backup"/);
  assert.match(route, /loadFullBackupFromDrive/);
  assert.match(route, /WHIZZUP DB 백업 폴더에서 선택한 파일/);
  assert.match(page, /aria-label="Google Drive 백업 선택"/);
  assert.match(page, /action: "inspect-drive-backup"/);
  assert.match(page, /action: "restore-drive-backup"/);
  assert.doesNotMatch(page, /type="file"/);
});
