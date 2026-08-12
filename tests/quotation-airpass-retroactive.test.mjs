import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");
const filesRoute = await readFile(new URL("../app/api/quotations/files/route.ts", import.meta.url), "utf8");
const pdf = await readFile(new URL("../app/authored-quotation-pdf.ts", import.meta.url), "utf8");

test("관리자는 기존 교구 PDF와 Excel을 같은 견적 데이터로 소급 교체한다", () => {
  assert.match(page, /교구 PDF·Excel 소급 갱신/);
  assert.match(page, /storeQuotationFiles\(quote, \{ replaceExisting: true \}\)/);
  assert.match(page, /formData\.set\("replaceExisting", "true"\)/);
  assert.match(filesRoute, /if \(replaceExisting\) await requireAdminMember\(\)/);
  assert.match(filesRoute, /!replaceExisting && row\.status === "final"/);
  assert.match(filesRoute, /removeDriveFile\(oldId\)/);
});

test("저장 PDF의 교구 별첨은 에어패스 공급자와 직인을 사용한다", () => {
  assert.match(pdf, /AIRPASS_COMPANY\.businessNumber/);
  assert.match(pdf, /AIRPASS_COMPANY\.address/);
  assert.match(pdf, /loadImage\("\/airpass-seal\.png"\)/);
  assert.match(pdf, /context\.drawImage\(airpassSeal/);
});
