import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("product management removes selection-workbook UI and manages one comparison file per product", async () => {
  const [page, route, migration, comparisonStore] = await Promise.all([
    read("../app/product-catalog-page.tsx"),
    read("../app/api/product-comparison-documents/route.ts"),
    read("../drizzle/0080_product_resource_import_and_comparisons.sql"),
    read("../lib/product-comparison-documents.ts"),
  ]);

  assert.doesNotMatch(page, /물품선정 자료 만들기/);
  assert.doesNotMatch(page, /일산초 원본/);
  assert.match(page, /openProductComparison/);
  assert.match(page, /비교표 교체/);
  assert.match(page, /product-comparison-body/);
  assert.match(page, /product-comparison-empty/);
  assert.match(page, /download=1/);
  assert.match(page, /deleteProductComparison/);
  assert.match(route, /catalog_product_id/);
  assert.match(route, /previous\.results/);
  assert.match(route, /rollbackDriveMoves\(archivedMoves\)/);
  assert.match(migration, /`catalog_product_id` text DEFAULT '' NOT NULL/);
  assert.match(comparisonStore, /\["equipment_item_id", "INTEGER NOT NULL DEFAULT 0"\]/);
  assert.match(comparisonStore, /ALTER TABLE product_comparison_documents ADD COLUMN/);
  assert.match(comparisonStore, /CREATE UNIQUE INDEX IF NOT EXISTS idx_product_comparison_documents_catalog_active/);
});
