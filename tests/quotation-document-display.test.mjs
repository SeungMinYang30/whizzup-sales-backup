import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../app/quotation-documents.tsx", import.meta.url),
  "utf8",
);

test("견적서 카드와 미리보기에는 금액을 표시하지 않는다", () => {
  assert.doesNotMatch(source, /displayQuoteAmount/);
  assert.doesNotMatch(source, /<b>\{document\.quoteAmount/);
  assert.doesNotMatch(source, /<small>\{preview\.quoteAmount/);
});

test("시스템 견적 원본을 카드에 연결하고 비어 있는 외부 자료 영역은 숨긴다", () => {
  assert.match(source, /quotation\.sourceOriginalUrl/);
  assert.match(source, /불러온 원본 보기/);
  assert.match(source, /!loading && documents\.length > 0/);
  assert.match(source, /기타 외부 견적 자료/);
  assert.doesNotMatch(source, /첨부된 외부 견적서가 없습니다/);
});
