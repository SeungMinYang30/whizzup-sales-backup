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
  assert.match(styles, /\.quotation-product-picker-dialog \{ width: 100%; max-height: none; height: 100dvh/);
});

test("contextual insert and replacement use a visible searchable dialog instead of the editor top list", () => {
  assert.match(page, /productResultsOpen && productPickerTarget\.kind === "append"/);
  assert.match(page, /productResultsOpen && productPickerTarget\.kind !== "append"/);
  assert.match(page, /className="quotation-product-picker-dialog" role="dialog" aria-modal="true"/);
  assert.match(page, /ref=\{contextualProductSearchInputRef\}/);
  assert.match(page, /placeholder=\{`제품명·규격 검색 \(\$\{products\.length\}개\)`\}/);
  assert.match(page, /document\.body\.style\.overflow = "hidden"/);
  assert.match(page, /event\.target === event\.currentTarget\) closeProductPicker\(\)/);
  assert.match(styles, /\.quotation-product-picker-modal \{ position: fixed; inset: 0; z-index: 220/);
});
