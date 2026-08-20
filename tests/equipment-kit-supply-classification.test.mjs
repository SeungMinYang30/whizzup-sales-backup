import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Airpass teaching-aid kits are never classified as direct supply", async () => {
  const helper = await source("../lib/product-supply-classification.ts");

  assert.match(helper, /new Set\(\["quote-23"\]\)/);
  assert.match(helper, /includes\("교구세트"\)/);
  assert.match(
    helper,
    /if \(isPartnerOnlyProduct\(input\)\) return "partner"/,
  );
});

test("catalog, equipment, and accounting routes share the correction", async () => {
  const [catalog, equipment, accounting, accountingEntries] = await Promise.all([
    source("../app/api/product-catalog/route.ts"),
    source("../app/api/equipment/route.ts"),
    source("../app/api/accounting/route.ts"),
    source("../app/api/accounting/entries/route.ts"),
  ]);

  assert.match(catalog, /normalizeProductSupplyType/);
  assert.match(equipment, /isPartnerOnlyProduct/);
  assert.match(equipment, /normalizeProductSupplyType/);
  assert.match(accounting, /isPartnerOnlyProduct/);
  assert.match(accounting, /normalizeProductSupplyType/);
  assert.match(accountingEntries, /ei\.catalog_item_id/);
  assert.match(accountingEntries, /normalizeProductSupplyType/);
});
