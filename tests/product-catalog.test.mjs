import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { strFromU8, unzipSync, zipSync } from "fflate";

import {
  createProductCatalogWorkbook,
  parseProductCatalogWorkbook,
} from "../lib/product-catalog-xlsx.ts";
import { PRODUCT_CATALOG } from "../lib/product-catalog.ts";

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

test("제품 기준 정보는 98개를 유지한다", () => {
  assert.equal(PRODUCT_CATALOG.length, 98);
});

test("엑셀 양식은 공급 구분과 수수료율·마진율을 포함한다", () => {
  const workbook = createProductCatalogWorkbook(PRODUCT_CATALOG.slice(0, 1));
  const files = unzipSync(workbook);
  const sheetXml = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const headers = [...sheetXml.matchAll(/<c r="[A-G]1"[^>]*>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => match[1]);

  assert.deepEqual(headers, [
    "품명",
    "규격",
    "단가",
    "비고",
    "공급 구분",
    "수수료율 / 마진율",
    "참고사항",
  ]);
});

test("엑셀 다운로드와 다시 가져오기가 제품 정보를 보존한다", () => {
  const sample = {
    ...PRODUCT_CATALOG[0],
    reference: "교체 옵션은 현장 확인 후 확정",
  };
  const workbook = createProductCatalogWorkbook([sample]);
  const [parsed] = parseProductCatalogWorkbook(toArrayBuffer(workbook));

  assert.equal(parsed.name, sample.name);
  assert.equal(parsed.specification, sample.specification);
  assert.equal(parsed.unitPrice, sample.unitPrice);
  assert.equal(parsed.note, sample.note);
  assert.equal(parsed.supplyType, sample.supplyType);
  assert.equal(parsed.commissionRate, sample.commissionRate);
  assert.equal(parsed.marginRate, sample.marginRate);
  assert.equal(parsed.reference, sample.reference);
  assert.deepEqual(parsed.errors, []);
});

test("위즈업 직접 공급 제품은 마진율로 엑셀 왕복한다", () => {
  const sample = PRODUCT_CATALOG.find((product) => product.id === "quote-62");
  assert.ok(sample);
  assert.equal(sample.supplyType, "direct");
  assert.equal(sample.commissionRate, null);
  assert.equal(sample.marginRate, 0.5545454545454546);

  const workbook = createProductCatalogWorkbook([sample]);
  const [parsed] = parseProductCatalogWorkbook(toArrayBuffer(workbook));
  assert.equal(parsed.supplyType, "direct");
  assert.equal(parsed.commissionRate, null);
  assert.equal(parsed.marginRate, sample.marginRate);
});

test("기존 수수료율 엑셀은 협력사 공급 형식으로 계속 읽는다", () => {
  const sample = {
    ...PRODUCT_CATALOG[0],
    supplyType: "partner",
    marginRate: null,
  };
  const workbook = createProductCatalogWorkbook([sample]);
  const files = unzipSync(workbook);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"])
    .replace(/<c r="E1"[\s\S]*?<\/c>/, "")
    .replace("수수료율 / 마진율", "수수료율");
  files["xl/worksheets/sheet1.xml"] = new TextEncoder().encode(sheet);
  const [parsed] = parseProductCatalogWorkbook(
    toArrayBuffer(zipSync(files)),
  );
  assert.equal(parsed.supplyType, null);
  assert.equal(parsed.commissionRate, sample.commissionRate);
});

test("quotation product picker does not limit results to eight items", () => {
  const source = readFileSync(
    new URL("../app/product-catalog-page.tsx", import.meta.url),
    "utf8",
  );
  const quotationBlock = source.match(
    /const \{ quotationProducts, quotationProductMatchCount \} = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[deferredQuotationSearch, groupedProducts, quotationOpen\]\);/,
  );

  assert.ok(quotationBlock, "quotation product calculation must exist");
  assert.doesNotMatch(quotationBlock[1], /slice\(0,\s*8\)/);
  assert.match(
    quotationBlock[1],
    /quotationProducts: matches\.slice\(0, QUOTATION_PRODUCT_RESULT_LIMIT\)/,
  );
});

test("the workbook template download uses the shared secondary button style", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const source = readFileSync(
    new URL("../app/product-catalog-page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(css, /\.ghost-button, \.secondary-button, \.primary-button, \.cancel-button/);
  assert.match(css, /\.ghost-button, \.secondary-button \{ border: 1px solid #dce1ea;/);
  assert.match(
    source,
    /className="secondary-button"[\s\S]*?엑셀 양식 내려받기[\s\S]*?className="secondary-button"[\s\S]*?엑셀 불러오기/,
  );
});

test("product order and favorites are saved per approved member", () => {
  const route = readFileSync(
    new URL("../app/api/product-catalog/route.ts", import.meta.url),
    "utf8",
  );
  const source = readFileSync(
    new URL("../app/product-catalog-page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(route, /product_catalog_order_v1:/);
  assert.match(route, /product_catalog_favorites_v1:/);
  assert.match(route, /orderSettingKey\(member\.id\)/);
  assert.match(route, /favoritesSettingKey\(member\.id\)/);
  assert.match(route, /favoriteProductIds/);
  assert.match(route, /export async function PATCH/);
  assert.match(source, /draggable=\{canReorder && catalogView === "all" && !normalizedSearch && !saving\}/);
  assert.match(source, /기본 순서로/);
  assert.match(source, /moveProduct\(product\.id, -1\)/);
  assert.match(source, /moveProduct\(product\.id, 1\)/);
  assert.match(source, /toggleFavoriteProduct/);
  assert.match(source, /★ 즐겨찾기/);
  assert.match(source, /PC에서 저장한 내 순서대로 표시됩니다/);
});

test("product comparison documents are attached once and reused by complex projects", () => {
  const route = readFileSync(
    new URL("../app/api/product-comparison-documents/route.ts", import.meta.url),
    "utf8",
  );
  const catalog = readFileSync(
    new URL("../app/product-catalog-page.tsx", import.meta.url),
    "utf8",
  );
  const complex = readFileSync(
    new URL("../lib/complex-projects.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /product_id, original_name, object_key/);
  assert.match(route, /PDF, Excel 또는 Word 비교표/);
  assert.match(catalog, /물품 비교표/);
  assert.match(catalog, /product-comparison-documents\?id=/);
  assert.match(complex, /comparison\.product_id = item\.catalog_item_id/);
});
