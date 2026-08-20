import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Drive authentication retries temporary failures and classifies permanent failures", async () => {
  const source = await read("lib/google-drive-storage.ts");
  assert.match(source, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(source, /invalid_grant/);
  assert.match(source, /invalid_client/);
  assert.match(source, /deleted_client/);
  assert.match(source, /oauthAccessToken\(true\)/);
  assert.doesNotMatch(source, /error_description[^\n]*console\./);
});

test("Drive prefers durable OAuth for writes and keeps the server account as a fallback", async () => {
  const source = await read("lib/google-drive-storage.ts");
  assert.match(source, /GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON/);
  assert.match(source, /WHIZZUP_GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON/);
  assert.match(source, /GOOGLE_DRIVE_IMPERSONATED_USER/);
  assert.match(source, /serviceAccountCanUseRoot/);
  assert.match(source, /capabilities\(canAddChildren\)/);
  assert.match(source, /return await oauthAccessToken\(force\)/);
  assert.match(source, /OAuth is unavailable; trying the server account/);
  assert.match(source, /auth\.mode === "service-account" && oauthConfigured\(\)/);
  assert.match(source, /isPostgresDatabase\(\) \? \("vercel" as const\) : \("sites" as const\)/);
  assert.match(source, /Sites 대기판은 Google Drive 대신 D1\/R2 독립 저장소/);
});

test("administrator can verify Drive without exposing credentials or triggering save UI", async () => {
  const [route, page] = await Promise.all([
    read("app/api/google-drive-settings/route.ts"),
    read("app/crm-app.tsx"),
  ]);
  assert.match(route, /requireMemberPermission\("integration:manage"\)/);
  assert.match(route, /getGoogleDriveConnectionStatus\(true\)/);
  assert.doesNotMatch(route, /clientSecret|privateKey|refreshToken/);
  assert.match(page, /\/api\/google-drive-settings\?verify=1/);
  assert.match(page, /X-WHIZZUP-Request-Mode/);
  assert.match(page, /서버 계정 자동 연결/);
  assert.match(page, /googleDriveSettings\?\.platform === "vercel"/);
});

test("quotation and resource downloads preserve actionable Drive errors", async () => {
  const [quotationRoute, resourceRoute] = await Promise.all([
    read("app/api/quotations/files/route.ts"),
    read("app/api/resources/route.ts"),
  ]);
  assert.match(quotationRoute, /googleDriveStorageErrorResponse\(error\)/);
  assert.match(resourceRoute, /googleDriveStorageErrorResponse\(error\)/);
  assert.match(resourceRoute, /downloadDriveFile\(row\.drive_file_id\)/);
});

test("new resource uploads fail closed when Drive is unavailable", async () => {
  const source = await read("lib/google-drive-storage.ts");
  assert.match(source, /return isGoogleDriveConfigured\(\)/);
  assert.match(source, /Google Drive 연결 정보가 없어 파일을 저장하지 않았습니다/);
  assert.match(source, /이전 업로드 세션은 더 이상 사용할 수 없습니다/);
  assert.doesNotMatch(source, /return localUploadSession\(input\)/);
  assert.doesNotMatch(source, /Google Drive upload fell back to independent storage/);
});
