import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const librarySource = await readFile(new URL("../lib/procurement-products.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/procurement-products/route.ts", import.meta.url), "utf8");
const catalogRouteSource = await readFile(new URL("../app/api/product-catalog/route.ts", import.meta.url), "utf8");
const quotationSource = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");

const transpiled = ts.transpileModule(librarySource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const procurement = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

test("procurement result mapping preserves an actual zero price separately from a missing price", () => {
  const base = { prdctIdntNo: "24563902", prdctIdntNoNm: "가상스포츠시스템" };
  assert.equal(procurement.mapProcurementSearchItem(base).unitPrice, null);
  assert.equal(procurement.mapProcurementSearchItem({ ...base, cntrctPrceAmt: 0 }).unitPrice, 0);
});

test("procurement catalog identity is stable by channel and identifier", () => {
  assert.equal(procurement.procurementProductIdentity("G2B", "2456-3902"), "G2B:24563902");
  assert.equal(procurement.procurementCatalogId("G2B", "24563902"), "procurement-g2b-24563902");
});

test("official procurement search stays server-only and requires an approved member", () => {
  assert.match(routeSource, /requireApprovedMember\(\)/);
  assert.match(routeSource, /process\.env\.PROCUREMENT_DATA_SERVICE_KEY/);
  assert.match(routeSource, /prdctIdntNoNm: query/);
  assert.match(routeSource, /CACHE_TTL_MS = 10 \* 60/);
  assert.doesNotMatch(quotationSource, /NEXT_PUBLIC_PROCUREMENT_DATA_SERVICE_KEY/);
});

test("quotation picker supports quote-only and owner-only catalog registration in append insert and replace flows", () => {
  assert.match(quotationSource, />나라장터 검색</);
  assert.match(quotationSource, /"견적에만 넣기"/);
  assert.match(quotationSource, /"제품 DB에 등록 후 견적에 넣기"/);
  assert.match(quotationSource, /productPickerTarget\.kind === "replace"/);
  assert.match(quotationSource, /kind: "insert", index/);
  assert.match(catalogRouteSource, /requirePrimaryOwner\(\)/);
  assert.match(catalogRouteSource, /procurementProductIdentity/);
});
