import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("keeps Google Drive credentials in runtime environment variables", async () => {
  const source = await read("lib/google-drive-storage.ts");
  assert.match(source, /GOOGLE_DRIVE_CLIENT_ID/);
  assert.match(source, /GOOGLE_DRIVE_CLIENT_SECRET/);
  assert.match(source, /GOOGLE_DRIVE_REFRESH_TOKEN/);
  assert.doesNotMatch(source, /4\/0A[A-Za-z0-9_-]{20,}/);
});

test("Vercel stores new resource uploads only in Google Drive", async () => {
  const [driveStorage, uploadRoute, resourceRoute] = await Promise.all([
    read("lib/google-drive-storage.ts"),
    read("app/api/resources/upload-session/route.ts"),
    read("app/api/resources/route.ts"),
  ]);
  assert.match(driveStorage, /export function isResourceStorageConfigured/);
  assert.match(driveStorage, /return isGoogleDriveConfigured\(\)/);
  assert.doesNotMatch(driveStorage, /postgres-object:\/\/upload/);
  assert.doesNotMatch(driveStorage, /uploadLocalResumableChunk/);
  // 과거 PostgreSQL 객체 파일의 열람·보관 호환은 유지합니다.
  assert.match(driveStorage, /getPostgresObjectStorage\(\)/);
  assert.match(driveStorage, /resource-archive\//);
  assert.match(uploadRoute, /isResourceStorageConfigured\(\)/);
  assert.match(resourceRoute, /isResourceStorageConfigured\(\)/);
});

test("stores the common library in the dedicated Drive folder", async () => {
  const [source, page, styles] = await Promise.all([
    read("app/api/resources/route.ts"),
    read("app/resource-library-page.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(source, /03_자료실게시판/);
  assert.match(source, /requireApprovedMember/);
  assert.match(source, /requireAdminMember/);
  assert.match(page, /setUploadPercent/);
  assert.match(page, /resource-upload-progress/);
  assert.doesNotMatch(page, /post\.created_by_name/);
  assert.match(styles, /\.resource-post-card/);
});

test("preserves XLSX quotations while keeping PDF previews", async () => {
  const client = await read("app/quotation-documents.tsx");
  const route = await read("app/api/quotation-documents/route.ts");
  assert.match(client, /formData\.set\("sourceFile", pdfFile\)/);
  assert.match(route, /sourceFile instanceof File \? sourceFile : pdf/);
  assert.match(route, /quotationInstitutionFolderSegments/);
  assert.match(route, /institution-quotation-preview/);
  assert.match(route, /pageKeys\.push\(driveObjectKey\(preview\.fileId\)\)/);
  assert.doesNotMatch(route, /bucket\.put\(pageKeys/);
});

test("stores new award vendor documents in Drive while preserving legacy reads", async () => {
  const route = await read("app/api/award-vendors/documents/route.ts");
  assert.match(route, /contextType: "award-vendor-document"/);
  assert.match(route, /const objectKey = driveObjectKey\(uploaded\.fileId\)/);
  assert.match(route, /driveFileIdFromKey\(row\.object_key\)/);
  assert.match(route, /getAwardVendorBucket\(\)\.get\(row\.object_key\)/);
  assert.doesNotMatch(route, /getAwardVendorBucket\(\)\.put/);
});

test("automatically lists unmanaged Drive videos and never cleans up referenced files", async () => {
  const [session, reconcile, page, route] = await Promise.all([
    read("app/api/resources/upload-session/route.ts"),
    read("app/api/resources/reconcile/route.ts"),
    read("app/resource-library-page.tsx"),
    read("app/api/resources/route.ts"),
  ]);
  assert.match(session, /SELECT id FROM resource_attachments WHERE drive_file_id/);
  assert.match(reconcile, /const productVideoCategory = "제품 소개·시연"/);
  assert.match(reconcile, /fileName\.replace\(\/\\\.\[\^\.\]\+\$\/u, ""\)/);
  assert.doesNotMatch(reconcile, /file\.appProperties\?\.whizzup !== "1"/);
  assert.match(reconcile, /Google Drive 제품 소개·시연 폴더에서 자동 등록된 영상입니다/);
  assert.match(reconcile, /INSERT OR IGNORE INTO resource_attachments/);
  assert.doesNotMatch(page, /누락 영상 복구/);
  assert.match(page, /void reconcileVideos\(true\)/);
  assert.match(route, /removeUnreferencedResourceFiles/);
  assert.match(route, /이미 등록된 파일과 새 파일이 섞여 있습니다/);
});
