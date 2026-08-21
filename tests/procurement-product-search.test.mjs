import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const librarySource = await readFile(new URL("../lib/procurement-products.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/procurement-products/route.ts", import.meta.url), "utf8");
const catalogRouteSource = await readFile(new URL("../app/api/product-catalog/route.ts", import.meta.url), "utf8");
const backupSource = await readFile(new URL("../lib/backup-store.ts", import.meta.url), "utf8");
const quotationSource = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");
const globalCssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

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
    dtilPrdctClsfcNoNm: "멀티미디어학습장치",
    cntrctCorpNm: "(주)에어패스",
    prdctMakrNm: "에어패스",
    cntrctEndDate: "20991231",
  }, { contractMethod: "다수공급자계약", sourceLabel: "다수공급자계약" });
  assert.equal(item.supplierName, "(주)에어패스");
  assert.equal(item.classificationNumber, "12345678");
  assert.equal(item.detailClassificationNumber, "1234567890");
  assert.equal(item.detailClassificationName, "멀티미디어학습장치");
  assert.equal(item.contractMethod, "다수공급자계약");
  assert.equal(item.saleStatus, "계약 유효");
  assert.equal(item.sourceUrl, "https://goods.g2b.go.kr/search/productSearchView.do?goodsClsfcNo=12345678&goodsIdntfcNo=24563902");
});

test("contract results use their detailed specification as the visible product name", () => {
  const item = procurement.mapProcurementSearchItem({
    prdctIdntNo: "24563902",
    prdctSpecNm: "멀티미디어학습장치, 에어패스, AP-EDUVR-01, 가상체육시스템",
    dtilPrdctClsfcNoNm: "멀티미디어학습장치",
    prdctClsfcNoNm: "영상·음향장비",
    cntrctCorpNm: "(주)에어패스",
  }, { contractMethod: "다수공급자계약", sourceLabel: "다수공급자계약" });
  assert.equal(item.name, "멀티미디어학습장치, 에어패스, AP-EDUVR-01, 가상체육시스템");
  assert.equal(item.specification, "멀티미디어학습장치 · 영상·음향장비");
  assert.equal(item.marketplace, "shopping");
  assert.equal(item.marketplaceLabel, "종합쇼핑몰");
  assert.equal(item.procurementChannel, "G2B");
});

test("educational software is separated into the digital service marketplace", () => {
  const item = procurement.mapProcurementSearchItem({
    prdctIdntNo: "23674379",
    prdctIdntNoNm: "교육용소프트웨어, 에어패스, AP-EDU-CNTS5, 체육",
    dtilPrdctClsfcNoNm: "교육용소프트웨어",
    cntrctCorpNm: "(주)에어패스",
  });
  assert.equal(item.marketplace, "digital-service");
  assert.equal(item.marketplaceLabel, "디지털서비스몰");
  assert.equal(item.procurementChannel, "디지털서비스몰");
  assert.equal(procurement.procurementSearchItemToCatalogProduct(item).procurementChannel, "디지털서비스몰");
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
  assert.match(routeSource, /prdctClsfcNoNm: query/);
  assert.match(routeSource, /dtilPrdctClsfcNoNm: query/);
  assert.match(routeSource, /prdctIdntNoNm: query/);
  assert.match(routeSource, /PROCUREMENT_SEARCH_WINDOW_COUNT = 3/);
  assert.match(routeSource, /PROCUREMENT_SPEC_SEARCH_WINDOW_COUNT = 15/);
  assert.match(routeSource, /procurementSearchDateWindows/);
  assert.match(routeSource, /cntrctCorpNm: query/);
  assert.doesNotMatch(routeSource, /companyNameCandidates/);
  assert.match(routeSource, /PROCUREMENT_SEARCH_WINDOW_DAYS = 364/);
  assert.match(routeSource, /rgstDtBgnDt: `\$\{startDate\}0000`/);
  assert.match(routeSource, /rgstDtEndDt: `\$\{endDate\}2359`/);
  assert.match(routeSource, /inqryBgnDate: startDate/);
  assert.match(routeSource, /body\["nkoneps\.com\.response\.ResponseError"\]/);
  assert.match(routeSource, /serviceKey: key/);
  assert.match(routeSource, /CACHE_VERSION = "v15-shopping-contract-identity"/);
  assert.match(routeSource, /GENERAL_CACHE_TTL_MS = 6 \* 60 \* 60/);
  assert.match(routeSource, /IDENTIFIER_CACHE_TTL_MS = 24 \* 60 \* 60/);
  assert.match(routeSource, /CACHE_RETENTION_MS = 30 \* 24 \* 60 \* 60/);
  assert.match(routeSource, /return normalizedIdentifierQuery\(query\) \? IDENTIFIER_CACHE_TTL_MS : GENERAL_CACHE_TTL_MS/);
  assert.match(routeSource, /CREATE TABLE IF NOT EXISTS procurement_search_cache/);
  assert.match(routeSource, /DELETE FROM procurement_search_cache WHERE expires_at < \?/);
  assert.match(backupSource, /"procurement_search_cache"/);
  assert.match(routeSource, /readSharedCache\(cacheKey, ttlMs\)/);
  assert.match(routeSource, /url\.searchParams\.get\("refresh"\) === "1"/);
  assert.match(routeSource, /sharedCached\?\.stale/);
  assert.match(routeSource, /after\(async \(\) =>/);
  assert.match(routeSource, /PROCUREMENT_MAX_PAGE_SIZE = 300/);
  assert.match(routeSource, /collectAllUseful/);
  assert.match(routeSource, /Promise\.allSettled\(requests\)/);
  assert.doesNotMatch(routeSource, /collectFirstUseful/);
  assert.doesNotMatch(routeSource, /Promise\.any/);
  assert.doesNotMatch(routeSource, /PROCUREMENT_SEARCH_GRACE_MS/);
  assert.match(routeSource, /controller\.abort\(\)/);
  assert.match(routeSource, /scope === "all" \|\| scope === "company"/);
  assert.match(routeSource, /CONTRACT_SOURCES\.flatMap/);
  assert.match(routeSource, /item\.contractNumber \|\| item\.registrationDate/);
  assert.match(routeSource, /`\$\{item\.identity\}:contract:\$\{contractRecord\}`/);
  assert.match(routeSource, /shoppingIdentities\.has\(item\.identity\)/);
  assert.match(routeSource, /scope === "all" \|\| scope === "detail"/);
  assert.match(routeSource, /scope === "all" \|\| scope === "specification"/);
  assert.match(routeSource, /scope === "identifier"/);
  assert.match(routeSource, /`\$\{CACHE_VERSION\}:\$\{scope\}:/);
  assert.match(routeSource, /detailClassifications/);
  assert.match(routeSource, /suppliers: namedFacets\(suppliers\)/);
  assert.match(routeSource, /marketplaces: namedFacets\(marketplaces\)/);
  assert.match(routeSource, /sort === "priceAsc"/);
  assert.doesNotMatch(routeSource, /20000101/);
  assert.doesNotMatch(quotationSource, /NEXT_PUBLIC_PROCUREMENT_DATA_SERVICE_KEY/);
});

test("quotation picker supports quote-only and owner-only catalog registration in append insert and replace flows", () => {
  assert.match(quotationSource, />나라장터 검색</);
  assert.match(quotationSource, /"견적에만 넣기"/);
  assert.match(quotationSource, /제품 DB에 등록 후 견적에 넣기/);
  assert.match(quotationSource, /제품 DB에만 등록/);
  assert.match(quotationSource, /productPickerTarget\.kind === "replace"/);
  assert.match(quotationSource, /kind: "insert", index/);
  assert.match(quotationSource, /나라장터 상품 상세/);
  assert.match(quotationSource, /업체명·제품명·식별번호 검색/);
  assert.match(quotationSource, /나라장터 종합쇼핑몰 검색/);
  assert.match(quotationSource, /세부품명/);
  assert.match(quotationSource, /현재 결과 전체 선택/);
  assert.match(quotationSource, /제품 DB 등록 검토/);
  assert.match(quotationSource, /function changeProcurementQuery\(value: string\)/);
  assert.match(quotationSource, /procurementSearchAbortRef\.current\?\.abort\(\)/);
  assert.match(quotationSource, /requestId !== procurementSearchRequestRef\.current/);
  assert.match(quotationSource, /window\.setTimeout\(\(\) => \{/);
  assert.match(quotationSource, /\}, 350\)/);
  assert.match(quotationSource, /setProcurementResults\(\[\]\)/);
  assert.match(quotationSource, /procurementContractFilters\.includes\(facet\.name\)/);
  assert.match(quotationSource, /setProcurementContractFilters\(\[\]\)/);
  assert.match(quotationSource, /setProcurementSupplierFilters\(\[\]\)/);
  assert.match(quotationSource, /procurementSupplierFilters\.includes\(facet\.name\)/);
  assert.match(quotationSource, /setProcurementMarketplace\("digital-service"\)/);
  assert.match(quotationSource, /type ProcurementSearchScope = "all" \| "detail" \| "specification" \| "company" \| "identifier"/);
  assert.match(quotationSource, /나라장터 검색 범위/);
  assert.match(quotationSource, /value: "detail", label: "세부품명"/);
  assert.match(quotationSource, /value: "specification", label: "규격"/);
  assert.match(quotationSource, /value: "company", label: "업체명"/);
  assert.match(quotationSource, /value: "identifier", label: "물품식별번호"/);
  assert.match(quotationSource, /changeProcurementSearchScope/);
  assert.match(quotationSource, /scope=\$\{encodeURIComponent\(requestedScope\)\}/);
  assert.match(quotationSource, /pageSize=300/);
  assert.match(quotationSource, /filteredResults\.slice\(0, procurementVisibleCount\)/);
  assert.match(quotationSource, /setProcurementVisibleCount\(\(current\) => current \+ 30\)/);
  assert.match(quotationSource, /최신 정보 새로고침/);
  assert.match(quotationSource, /공유 캐시 사용/);
  assert.match(quotationSource, /refresh=1/);
  assert.match(quotationSource, /setProcurementRefreshing\(true\)/);
  assert.match(quotationSource, /제품 DB 등록됨/);
  assert.match(quotationSource, /JSON\.stringify\(\{ product, autoRegisterSupplier: true \}\)/);
  assert.match(quotationSource, /onChange=\{\(event\) => changeProcurementQuery\(event\.target\.value\)\}/);
  assert.match(quotationSource, /<a href=\{procurementDetail\.sourceUrl\} target="_blank" rel="noopener noreferrer">나라장터 원문 열기<\/a>/);
  assert.match(globalCssSource, /\.quotation-procurement-market-dialog \{[^}]*width: min\(95vw, 1800px\);[^}]*height: min\(95dvh, 1040px\)/);
  assert.match(globalCssSource, /\.quotation-procurement-result-info h4 \{[^}]*font-size: 17px/);
  assert.match(globalCssSource, /\.quotation-procurement-market-search-area form button \{[^}]*font-size: 16px/);
  assert.match(globalCssSource, /\.quotation-procurement-cache-status \{/);
  assert.doesNotMatch(globalCssSource, /quotation-procurement-market-filters section:nth-of-type\(2\) \{ display: none/);
  assert.match(catalogRouteSource, /requirePrimaryOwner\(\)/);
  assert.match(catalogRouteSource, /normalizedProcurementIdentifier/);
  assert.match(catalogRouteSource, /ensureProcurementSupplierVendor/);
  assert.match(catalogRouteSource, /setProductVendorLinks\(\[product\.id\], vendorId, memberId\)/);
  assert.match(catalogRouteSource, /나라장터 제품 등록에서 자동 생성/);
  assert.doesNotMatch(catalogRouteSource, /requested\.commissionRate = null/);
});
