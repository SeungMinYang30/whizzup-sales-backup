import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("quotation items can be inserted before, between and after normal rows while construction remains last", () => {
  assert.match(page, /function insertRegularItemAt/);
  assert.match(page, /nextItems\.splice\(Math\.max\(0, Math\.min\(index, nextItems\.length\)\), 0, item\)/);
  assert.match(page, /items: \[\.\.\.nextItems, \.\.\.\(construction \? \[construction\] : \[\]\)\]/);
  assert.match(page, /quotation-item-insert-control-last/);
  assert.match(page, /openProductPicker\(\{ kind: "insert", index \}\)/);
  assert.match(page, /addBlankItem\(index\)/);
});

test("catalog replacement preserves row identity quantity and note but refreshes product-owned fields", () => {
  assert.match(page, /id: current\?\.id \?\? crypto\.randomUUID\(\)/);
  assert.match(page, /const quantity = current\?\.quantity \?\? 1/);
  assert.match(page, /note: current\?\.note \?\? ""/);
  assert.match(page, /supplierVendorId: product\.supplierVendorId \?\? null/);
  assert.match(page, /procurementNumber,/);
  assert.match(page, /const duplicate = draft\.items\.find/);
  assert.match(page, /이미 견적에 있는/);
});

test("manual transition clears stale catalog supplier and procurement linkage while manual text inputs stay editable", () => {
  assert.match(page, /function switchItemToManual/);
  assert.match(page, /productId: ""/);
  assert.match(page, /supplierVendorId: null/);
  assert.match(page, /procurementChannel: ""/);
  assert.match(page, /value=\{item\.name\} onChange=\{\(event\) => updateItem/);
  assert.match(page, /value=\{item\.specification\} onChange=\{\(event\) => updateItem/);
});

test("mobile insertion and product picker panels are full-width touch targets", () => {
  assert.match(styles, /\.quotation-item-insert-control>div\{position:fixed/);
  assert.match(styles, /\.quotation-item-search-results \{ position: fixed/);
});
