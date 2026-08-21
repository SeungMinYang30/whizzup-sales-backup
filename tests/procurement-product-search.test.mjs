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

test("procurement result mapping exposes the fields used by the detailed product view", () => {
  const item = procurement.mapProcurementSearchItem({
    prdctIdntNo: "24563902",
    prdctIdntNoNm: "가상스포츠시스템",
    prdctClsfcNo: "12345678",
    prdctClsfcNoNm: "교육용장비",
    dtilPrdctClsfcNo: "1234567890",
    cntrctCorpNm: "(주)에어패스",
    prdctMakrNm: "에어패스",
    cntrctEndDate: "20991231",
  }, { contractMethod: "다수공급자계약", sourceLabel: "다수공급자계약" });
  assert.equal(item.supplierName, "(주)에어패스");
  assert.equal(item.classificationNumber, "12345678");
  assert.equal(item.detailClassificationNumber, "1234567890");
  assert.equal(item.contractMethod, "다수공급자계약");
  assert.equal(item.saleStatus, "계약 유효");
});

test("procurement catalog identity is stable by channel and identifier", () => {
  assert.equal(procurement.procurementProductIdentity("G2B", "2456-3902"), "G2B:24563902");
  assert.equal(procurement.procurementCatalogId("G2B", "24563902"), "procurement-g2b-24563902");
});

test("official procurement search stays server-only and requires an approved member", () => {
  assert.match(routeSource, /requireApprovedMember\(\)/);
  assert.match(routeSource, /process\.env\.PROCUREMENT_DATA_SERVICE_KEY/);
  assert.match(routeSource, /getMASCntrctPrdctInfoList/);
  assert.match(routeSource, /getUcntrctPrdctInfoList/);
  assert.match(routeSource, /getThptyUcntrctPrdctInfoList/);
  assert.match(routeSource, /cntrctCorpNm/);
  assert.match(routeSource, /params: \{ \.\.\.common, prdctClsfcNoNm: query \}/);
  assert.match(routeSource, /\["prdctClsfcNoNm", "dtilPrdctClsfcNoNm", "prdctIdntNoNm"\]/);
  assert.match(routeSource, /companyNameCandidates\(query\)/);
  assert.match(routeSource, /`\(주\)\$\{compact\}`/);
  assert.match(routeSource, /CACHE_TTL_MS = 10 \* 60/);
  assert.doesNotMatch(routeSource, /setUTCFullYear/);
  assert.doesNotMatch(quotationSource, /NEXT_PUBLIC_PROCUREMENT_DATA_SERVICE_KEY/);
});

test("quotation picker supports quote-only and owner-only catalog registration in append insert and replace flows", () => {
  assert.match(quotationSource, />나라장터 검색</);
  assert.match(quotationSource, /"견적에만 넣기"/);
  assert.match(quotationSource, /"제품 DB에 등록 후 견적에 넣기"/);
  assert.match(quotationSource, /productPickerTarget\.kind === "replace"/);
  assert.match(quotationSource, /kind: "insert", index/);
  assert.match(quotationSource, /나라장터 상품 상세/);
  assert.match(quotationSource, /업체명·제품명·식별번호 검색/);
  assert.match(catalogRouteSource, /requirePrimaryOwner\(\)/);
  assert.match(catalogRouteSource, /procurementProductIdentity/);
});
