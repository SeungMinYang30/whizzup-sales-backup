import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the original Ilsan selection workbook is preserved and populated from selected products", async () => {
  const [creator, page, template] = await Promise.all([
    read("../lib/selection-committee-xlsx.ts"),
    read("../app/product-catalog-page.tsx"),
    stat(new URL("../public/templates/일산초_물품선정위원회_원본양식.xlsx", import.meta.url)),
  ]);

  assert.ok(template.size > 10_000_000, "the original styled workbook asset must be bundled");
  assert.match(creator, /fillSelectionSheet/);
  assert.match(creator, /fillCountSheet/);
  assert.match(creator, /fillAggregateSheet/);
  assert.match(creator, /fillComparisonSheet/);
  assert.match(creator, /20_000_000/);
  assert.match(creator, /sameName/);
  assert.match(page, /물품선정 자료 만들기/);
  assert.match(page, /수량×단가 기준/);
  assert.match(page, /원본 빈 양식/);
});
