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
