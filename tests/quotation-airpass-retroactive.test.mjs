import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");
const filesRoute = await readFile(new URL("../app/api/quotations/files/route.ts", import.meta.url), "utf8");
const pdf = await readFile(new URL("../app/authored-quotation-pdf.ts", import.meta.url), "utf8");

test("교구 파일 교체용 서버 기능은 유지하되 수동 소급 갱신 버튼은 노출하지 않는다", () => {
  assert.doesNotMatch(page, /교구 PDF·Excel 소급 갱신/);
  assert.match(page, /formData\.set\("replaceExisting", "true"\)/);
  assert.match(filesRoute, /if \(replaceExisting\) await requireAdminMember\(\)/);
  assert.match(filesRoute, /!replaceExisting && row\.status === "final"/);
  assert.match(filesRoute, /updated_at < \?\)`\)\s*\.bind\(id, staleUploadBefore\)/);
  assert.doesNotMatch(filesRoute, /datetime\('now', '-10 minutes'\)/);
  assert.match(filesRoute, /removeDriveFile\(oldId\)/);
});

test("저장 PDF의 교구 별첨은 에어패스 공급자와 직인을 사용한다", () => {
  assert.match(pdf, /AIRPASS_COMPANY\.businessNumber/);
  assert.match(pdf, /AIRPASS_COMPANY\.address/);
  assert.match(pdf, /loadImage\("\/airpass-seal\.png"\)/);
  assert.match(pdf, /context\.drawImage\(airpassSeal/);
  assert.doesNotMatch(pdf, /\$\{quote\.projectTitle \|\| "제품 공급"\} 교구 세부견적/);
  assert.doesNotMatch(page, /equipment-kit-print-band">에어패스 교구 세부내역 · 수량 0 품목 제외/);
});
