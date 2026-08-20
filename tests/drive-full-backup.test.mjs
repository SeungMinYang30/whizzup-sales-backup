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
const recoveryPackages = await readFile(
  new URL("../lib/recovery-packages.ts", import.meta.url),
  "utf8",
);
const recoveryGenerator = await readFile(
  new URL("../scripts/generate-recovery-source.mjs", import.meta.url),
  "utf8",
);
const driveStorage = await readFile(
  new URL("../lib/google-drive-storage.ts", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("full backup button archives one restorable JSON file to dated Google Drive folders", () => {
  assert.match(route, /action === "archive-full-backup"/);
  assert.match(route, /"WHIZZUP DB 백업",\s*"안전본",\s*timestamp\.year,\s*timestamp\.month/);
  assert.match(route, /WHIZZUP_full_backup_\$\{timestamp\.fileStamp\}\.json/);
  assert.match(route, /contextId: backup\.checksum/);
  assert.match(page, /Google Drive에 전체 DB 백업/);
  assert.match(page, /body: JSON\.stringify\(\{ action: "archive-full-backup" \}\)/);
});

test("full backup falls back to a browser download only when Drive archiving fails", () => {
  const fullBranch = page.slice(
    page.indexOf('if (kind === "full")'),
    page.indexOf('const response = await fetch(`/api/backup?kind=${kind}`'),
  );
  assert.match(fullBranch, /downloadFullBackupToComputer/);
  assert.match(page, /Google Drive 저장은 실패했지만 현재 전체 DB 안전 백업을 PC에 다운로드했습니다/);
  assert.match(page, /X-WHIZZUP-Request-Mode/);
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

test("emergency recovery is rebuilt for each deployment and archived to Drive", () => {
  assert.equal(
    packageJson.scripts.prebuild,
    "node scripts/generate-recovery-source.mjs",
  );
  assert.match(recoveryGenerator, /"WHIZZUP_source\.zip"/);
  assert.match(recoveryGenerator, /await writeFile\(sourceAssetPath, zipped\)/);
  assert.match(recoveryGenerator, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(route, /action === "archive-emergency-recovery"/);
  assert.match(
    route,
    /"WHIZZUP 비상복구",\s*"안전본",\s*timestamp\.year,\s*timestamp\.month/,
  );
  assert.match(route, /createDriveResumableUpload/);
  assert.match(route, /downloadDriveFile\(uploaded\.file\.id\)/);
  assert.match(route, /storedSha256 !== packageSha256/);
  assert.match(page, /Google Drive에 비상복구 저장/);
  assert.match(page, /action: "archive-emergency-recovery"/);
});

test("emergency package verifies its source, release, database, and required files", () => {
  assert.match(recoveryPackages, /verifyEmergencyRecoveryPackage/);
  assert.match(recoveryPackages, /files\["WHIZZUP_source\.zip"\]/);
  assert.match(recoveryPackages, /files\["MANIFEST\.json"\]/);
  assert.match(recoveryPackages, /files\["READ_THIS_FIRST\.txt"\]/);
  assert.match(recoveryPackages, /manifest\.sourceRelease !== RECOVERY_SOURCE_RELEASE/);
  assert.match(recoveryPackages, /embeddedBackup\.checksum !== expectedBackup\.checksum/);
});

test("offline standalone is archived to dated Drive folders and never downloaded by the page", () => {
  assert.match(route, /action === "archive-offline-standalone"/);
  assert.match(
    route,
    /"WHIZZUP 비상복구",\s*"오프라인 독립판",\s*timestamp\.year,\s*timestamp\.month/,
  );
  assert.match(route, /contextType: "offline-standalone"/);
  assert.match(route, /verifyOfflineStandalonePackage\(storedBytes, backup\)/);
  assert.match(page, /Google Drive에 오프라인 독립판 저장/);
  assert.match(page, /action: "archive-offline-standalone"/);
  assert.doesNotMatch(page, /saveBlob/);
  assert.doesNotMatch(page, /WHIZZUP_offline_edition\.zip/);
});

test("offline package verifies its HTML, manifest, database, and local-only execution", () => {
  assert.match(recoveryPackages, /verifyOfflineStandalonePackage/);
  assert.match(recoveryPackages, /files\["WHIZZUP_offline\.html"\]/);
  assert.match(recoveryPackages, /files\["MANIFEST\.json"\]/);
  assert.match(recoveryPackages, /files\["오프라인_사용안내\.txt"\]/);
  assert.match(recoveryPackages, /manifest\.offlineHtmlSha256 !== offlineHtmlSha256/);
  assert.match(recoveryPackages, /embeddedBackup\.checksum !== expectedBackup\.checksum/);
  assert.match(recoveryPackages, /<script\\s\+src=/i);
});

test("Drive folder creation is serialized and existing duplicates resolve consistently", () => {
  assert.match(driveStorage, /getD1\(\)\.transaction/);
  assert.match(driveStorage, /pg_advisory_xact_lock/);
  assert.match(driveStorage, /hashtextextended\(\?::text, 0\)/);
  assert.match(driveStorage, /orderBy", "createdTime"/);
  assert.match(driveStorage, /left\.id\.localeCompare\(right\.id\)/);
});

test("Drive read failures expose safe categories without leaking provider errors", () => {
  assert.match(driveStorage, /DRIVE_NOT_CONFIGURED/);
  assert.match(driveStorage, /DRIVE_FILE_NOT_FOUND/);
  assert.match(driveStorage, /googleDriveStorageErrorResponse/);
  assert.match(driveStorage, /관리자 센터에서 Drive 연결을 확인해 주세요/);
});
