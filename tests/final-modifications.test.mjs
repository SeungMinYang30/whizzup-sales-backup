import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("resource library separates documents and videos and removes bulk product import", async () => {
  const [page, uploadRoute, backup] = await Promise.all([
    read("../app/resource-library-page.tsx"),
    read("../app/api/resources/upload-session/route.ts"),
    read("../lib/backup-store.ts"),
  ]);

  assert.match(page, /function isVideoAttachment/);
  assert.match(page, /"documents" \| "videos"/);
  assert.match(page, />문서 자료</);
  assert.match(page, />영상 자료</);
  assert.match(page, /파일 형식에 따라 자동으로 나뉩니다/);
  assert.doesNotMatch(page, /제품자료 가져오기|PC의 제품 폴더를 한 번에 등록|webkitdirectory/);
  assert.doesNotMatch(uploadRoute, /productImport|sourceFingerprint/);
  assert.match(backup, /"source_fingerprint"/);
  assert.match(backup, /"product_comparison_documents"/);
  await assert.rejects(access(new URL("../app/api/resources/import-products/route.ts", import.meta.url)));
  await assert.rejects(access(new URL("../app/api/resources/organize-product/route.ts", import.meta.url)));
  await assert.rejects(access(new URL("../app/api/resources/import-drive/route.ts", import.meta.url)));
});

test("member labels include job titles while representative and operator wording stay consistent", async () => {
  const [collaboration, crm, styles, membersRoute] = await Promise.all([
    read("../lib/collaboration.ts"),
    read("../app/crm-app.tsx"),
    read("../app/globals.css"),
    read("../app/api/members/route.ts"),
  ]);

  assert.match(collaboration, /title === "대표" \? "대표님" : title/);
  assert.match(collaboration, /return `\$\{name\} \$\{title === "대표"/);
  assert.doesNotMatch(crm, /대표관리자/);
  assert.match(crm, /"운영자"/);
  assert.match(styles, /\.member-job-title-editor input[\s\S]*?height: 38px/);
  assert.match(styles, /\.member-actions[\s\S]*?flex-wrap: nowrap/);
  assert.doesNotMatch(membersRoute, /대표관리자/);
  assert.match(membersRoute, /INSERT INTO member_rejections/);
  assert.match(membersRoute, /DELETE FROM member_rejections WHERE lower\(email\) = \?/);
});

test("rejected member identities stay deleted instead of being recreated", async () => {
  const [collaboration, signup, migration] = await Promise.all([
    read("../lib/collaboration.ts"),
    read("../app/api/local-auth/signup/route.ts"),
    read("../drizzle/0081_member_rejections_and_comparison_compat.sql"),
  ]);

  assert.match(collaboration, /SELECT email FROM member_rejections/);
  assert.match(collaboration, /거절되어 삭제된 가입 요청/);
  assert.match(signup, /SELECT email FROM member_rejections/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `member_rejections`/);
  assert.match(migration, /freeyang3@nate\.com/);
});
