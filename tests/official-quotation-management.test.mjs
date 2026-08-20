import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../app/quotation-management-page.tsx", import.meta.url),
  "utf8",
);
const api = await readFile(
  new URL("../app/api/quotations/route.ts", import.meta.url),
  "utf8",
);
const schedule = await readFile(
  new URL("../app/construction-schedule-page.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const settlementPdf = await readFile(
  new URL("../app/consortium-settlement-pdf.ts", import.meta.url),
  "utf8",
);
const authoredPdf = await readFile(
  new URL("../app/authored-quotation-pdf.ts", import.meta.url),
  "utf8",
);
const authoredDownloads = await readFile(
  new URL("../app/authored-quotation-downloads.ts", import.meta.url),
  "utf8",
);
const workbook = await readFile(
  new URL("../lib/quotation-xlsx.ts", import.meta.url),
  "utf8",
);
const crm = await readFile(
  new URL("../app/crm-app.tsx", import.meta.url),
  "utf8",
);
const institutionQuotationHistory = await readFile(
  new URL("../app/organization-quotation-history.tsx", import.meta.url),
  "utf8",
);
const productWorkspace = await readFile(
  new URL("../app/product-catalog-page.tsx", import.meta.url),
  "utf8",
);

test("approved members can save formal quotations without mutating award records", () => {
  assert.match(api, /requireApprovedMember/);
  assert.doesNotMatch(api, /award_status|awardStatus|activities/);
  assert.match(page, /\/api\/quotations/);
});

test("formal quotation supports catalog items, direct-consortium margin, seal and customer print", () => {
  assert.match(page, /\/api\/product-catalog/);
  assert.match(page, /executionType/);
  assert.match(page, /consortiumRate/);
  assert.match(page, /whizzup-seal\.png/);
  assert.match(page, /reservePdfTab/);
  assert.match(page, /openPdfBlobInReservedTab/);
  assert.match(styles, /@media print/);
  assert.match(styles, /quotation-profit-panel/);
});

test("제품·견적 화면은 견적서·제품·협력사를 탭으로 나누고 견적 목록을 페이지 처리한다", () => {
  assert.match(crm, /견적·제품·협력사 관리/);
  assert.match(productWorkspace, /견적·제품·협력사 관리 화면/);
  assert.match(productWorkspace, /견적서 관리/);
  assert.match(productWorkspace, /제품 기준정보/);
  assert.match(productWorkspace, /협력사 관리/);
  assert.match(productWorkspace, /productTab/);
  assert.match(page, /const QUOTATION_PAGE_SIZE = 25/);
  assert.match(page, /pagedQuotes\.map/);
});

test("내부 수익 보고는 복사·Excel·PDF를 제공하고 고객 출력과 분리된다", () => {
  assert.match(page, /수익 보고 복사/);
  assert.match(page, /내부 비용 상세:/);
  assert.match(page, /내부 원가 합계:/);
  assert.match(page, /마진%:/);
  assert.match(page, /costDetailLines = internalCostDetails\.map/);
  assert.match(page, /numbers\.consortium === 0[\s\S]*?"0원"/);
  assert.match(page, /내부 수익표 보기/);
  assert.match(page, /downloadInternalProfitExcel/);
  assert.match(page, /openInternalProfitPdf/);
  assert.match(page, /className="quote-internal-report-shell no-print"/);
  assert.match(styles, /quote-internal-report-dialog/);
});

test("저장된 PDF와 Excel은 저장소 파일을 받아 안전한 이름으로 열거나 내려받는다", () => {
  assert.match(page, /await storedQuotationFile\(quote\.pdfUrl/);
  assert.match(page, /openPdfBlobInReservedTab\(file, tab\)/);
  assert.match(page, /await storedQuotationFile\(quote\.excelUrl/);
  assert.match(authoredDownloads, /if \(response\.ok\) return response\.blob\(\)/);
  assert.match(page, /quote\.driveXlsxName \|\| quotationDownloadName/);
});

test("final quotation consortium and item details flow into institution history", () => {
  assert.match(api, /executionType: primaryQuote\?\.executionType/);
  assert.match(api, /consortiumCompany:/);
  assert.match(api, /constructionAmount: constructionItems\.reduce/);
  assert.match(api, /items: regularItems\.map/);
  assert.match(crm, /type EquipmentQuoteItemSummary/);
  assert.match(crm, /detailInheritsQuotationConsortium/);
  assert.match(crm, /detailBaseRecord\.awardStatus === "미정"/);
  assert.match(crm, /detailBaseRecord\.executionType === "컨소"/);
  assert.match(crm, /onLoaded=\{\(\) => void loadEquipmentQuoteSummaries\(\)\}/);
  assert.match(institutionQuotationHistory, /견적 품목·공사비/);
  assert.match(institutionQuotationHistory, /현재 최종 견적서에 실제 저장된 품목과 공사비입니다/);
  assert.doesNotMatch(crm, /PREVIOUS EQUIPMENT DATA/);
});

test("institution history uses the exact organization round query and exposes load failures", () => {
  assert.match(institutionQuotationHistory, /\/api\/quotations\?organization=\$\{encodeURIComponent\(organization\)\}&businessRound=\$\{businessRound\}/);
  assert.doesNotMatch(institutionQuotationHistory, /\/api\/quotations\?q=/);
  assert.match(institutionQuotationHistory, /if \(!response\.ok\) throw new Error/);
  assert.match(institutionQuotationHistory, /role="alert"/);
  assert.match(institutionQuotationHistory, />다시 불러오기<\/button>/);
});

test("teaching aids imports match by normalized item text and output supplier plus contract labels", () => {
  assert.match(page, /function normalizedEquipmentKitName/);
  assert.match(page, /normalizedEquipmentKitName\(line\.name\) === normalizedEquipmentKitName\(imported\.name\)/);
  const teachingAidsImport = page.slice(
    page.indexOf('if (result.mode === "teaching-aids"'),
    page.indexOf("const nextItems =", page.indexOf('if (result.mode === "teaching-aids"')),
  );
  assert.match(teachingAidsImport, /quantity: 0/);
  assert.match(teachingAidsImport, /quantity: imported\.quantity/);
  assert.doesNotMatch(teachingAidsImport, /quantity \+ imported\.quantity/);
  assert.match(page, /\? \(isS2BChannel\(item\.procurementChannel\) \? "학교장터" : "조달 계약"\)/);
  assert.match(page, /: "수의계약"/);
  assert.match(page, /formatQuotationRemark\(/);
  assert.match(workbook, /formatQuotationRemark\(/);
  assert.match(page, /supplierVendorName: item\.supplierVendorName/);
  assert.match(authoredDownloads, /supplierVendorName: item\.supplierVendorName/);
});

test("quotation editor uses responsive item cards without exposing internal settlement in print", () => {
  assert.match(page, /quotation-item-card-section/);
  assert.match(page, /quotation-item-card-controls/);
  assert.match(page, /당사 수수료율/);
  assert.match(page, /컨소 지급률/);
  assert.match(page, /function EditableRateInput/);
  assert.match(page, /if \(normalized === "" && !commitEmpty\) return/);
  assert.match(page, /inputMode="decimal"/);
  assert.match(page, /\^\\d\{0,3\}/);
  assert.match(page, /event\.currentTarget\.select\(\)/);
  assert.match(page, /quotation-print-stack quotation-print-portal print-only/);
  assert.match(page, /function FormattedMoneyInput/);
  assert.match(page, /inputMode="numeric"/);
  assert.match(styles, /\.quotation-item-card-summary/);
  assert.match(page, /className="quote-tax-reference-label">공급가액<small>세액 참고 · 품목금액 기준<\/small>/);
  assert.match(page, /className="quote-tax-reference-value">\{won\.format\(numbers\.supply\)\}원/);
  assert.match(styles, /\.quote-bottom-row \.quote-tax-reference-value \{ white-space: nowrap; \}/);
  assert.match(styles, /\.print-only\{display:none!important\}/);
});

test("government Excel export uses ten visible columns, portrait fit and bottom signature seal", () => {
  assert.match(workbook, /orientation=\"portrait\"/);
  assert.match(workbook, /fitToWidth=\"1\"/);
  assert.match(workbook, /\$A\$1:\$J\$/);
  assert.match(workbook, /inline\("D17", "규격", 6\)/);
  assert.match(workbook, /inline\("E17", "식별번호", 6\)/);
  assert.doesNotMatch(workbook, /"D17:E17"/);
  assert.match(workbook, /주식회사 위즈업\\n대표이사/);
  assert.match(workbook, /signatureStartRow - 1/);
  assert.match(workbook, /"A14:C14", "D14:G14", "H14:J14"/);
  assert.match(workbook, /styledBlanks\(14, \["B", "C"\], 10\)/);
  assert.match(workbook, /styledBlanks\(bottomHeaderRow, \["B", "C", "D", "E", "F"\], 13\)/);
  assert.doesNotMatch(workbook, /"A14:C15"/);
  assert.doesNotMatch(workbook, /조달 수수료율/);
});

test("PDF output uses the same generator and opens the completed file in a new tab", () => {
  assert.match(page, /quotation-print-stack quotation-print-portal print-only/);
  assert.match(page, /<th>식별번호<\/th>/);
  assert.match(page, /견적 조건 및 특이사항/);
  assert.match(page, /금액 요약/);
  assert.match(styles, /\.quotation-print-sheet/);
  assert.match(styles, /size:A4 portrait/);
  assert.match(styles, /body\.quotation-printing>\*:not\(\.quotation-print-portal\)\{display:none!important\}/);
  assert.match(styles, /body\.quotation-printing \*::\-webkit-scrollbar\{display:none!important;width:0!important;height:0!important\}/);
  assert.match(styles, /\.quotation-print-stack\{[^}]*overflow:visible!important/);
  assert.doesNotMatch(styles, /@media print\{body \*\{visibility:hidden!important\}/);
  assert.match(page, /createAuthoredQuotationPdf\(/);
  assert.match(page, /function printQuotation\(\)/);
  assert.match(page.slice(page.indexOf("function printQuotation"), page.indexOf("function startQuotation")), /openPdfBlobInReservedTab/);
  assert.match(page, /새 탭의 PDF 도구에서 인쇄하거나 저장하세요/);
  assert.match(page, /onClick=\{printQuotation\}/);
  assert.match(page, /reservePdfTab/);
  assert.match(page, /openPdfBlobInReservedTab/);
  assert.doesNotMatch(page, /onClick=\{\(\) => window\.print\(\)\}/);
  assert.match(crm, /whizzup\.openQuotationComposer/);
  assert.match(crm, /quotation-quick-button/);
});

test("교구 PDF는 수정 화면과 목록 모두 에어패스 공급자 정보를 사용한다", () => {
  assert.match(page, /AIRPASS_COMPANY\.businessNumber/);
  assert.match(page, /airpass-print-brand/);
  assert.match(page, /airpass-seal\.png/);
  assert.match(page, /createAuthoredQuotationPdf\(/);
  assert.match(authoredPdf, /교 구 세 부 견 적 서/);
  assert.match(workbook, /교  구  세  부  견  적  서/);
});

test("정산서 PDF는 조정 내역·최종 지급액·직인을 포함한다", () => {
  assert.match(settlementPdf, /정산 조정 내역/);
  assert.match(settlementPdf, /추가 지급/);
  assert.match(settlementPdf, /정산 차감/);
  assert.match(settlementPdf, /최종 지급 예정액 \(VAT 포함\)/);
  assert.match(settlementPdf, /whizzup-seal\.png/);
  assert.match(page, /정산서 PDF/);
  assert.match(page, /완성된 정산서 PDF를 새 탭에서 열었습니다/);
  assert.match(page.slice(page.indexOf("async function exportConsortiumSettlementPdf"), page.indexOf("const regularDraftItems")), /openPdfBlobInReservedTab/);
  assert.match(page, /settlement-print-portal/);
  assert.match(styles, /body\.settlement-printing/);
  assert.match(page, /Excel 다운로드/);
  assert.match(page, /정산서 Excel 다운로드/);
  assert.doesNotMatch(page, /교구 PDF·Excel 소급 갱신/);
});

test("직접 바꾼 견적명은 기관·차수 갱신 뒤에도 보존하고 목록에 예산과 구분해 표시한다", () => {
  assert.match(page, /projectTitleTouched: true/);
  assert.match(page, /projectTitleTouched \? draft\.projectTitle/);
  assert.match(page, /<span>견적명<\/span>/);
  assert.match(page, /<span>연결 예산<\/span>/);
  assert.match(page, /<span>예산별 배분 금액<\/span>/);
});

test("quotation purchase types separate G2B, S2B and direct contracts", () => {
  assert.match(page, /수의계약<\/button>/);
  assert.match(page, /조달 계약<\/button>/);
  assert.match(page, /학교장터<\/button>/);
  assert.match(page, /isS2BChannel/);
  assert.match(page, /disabled=\{!appliesProcurementFee\(item\)\}/);
  assert.match(workbook, /return isS2B\(line\) \? "학교장터" : "조달 계약"/);
});

test("quotation output removes default empty rows and supports shared manual spacing", () => {
  assert.doesNotMatch(page, /Math\.max\(7, draft\.items\.length\)/);
  assert.match(page, /printItemPages/);
  assert.match(page, /Array\.from\(\{ length: outputBlankRows \}/);
  assert.match(page, /Excel·PDF 공통/);
  assert.match(page, /quotation-print-closing/);
  assert.match(page, /견적서 품목 계속/);
  assert.match(styles, /break-after:page/);
  assert.match(styles, /table-header-group/);
  assert.match(styles, /page-break-inside:avoid/);
  assert.match(workbook, /extraBlankRows/);
  assert.doesNotMatch(workbook, /Math\.max\(7, input\.lines\.length\)/);
});

test("quotation composer can filter product search to personal favorites", () => {
  assert.match(page, /favoriteProductIds/);
  assert.match(page, /favoriteProductsOnly/);
  assert.match(page, /★ 즐겨찾기/);
  assert.match(page, /전체 제품/);
  assert.match(page, /productListMode/);
  assert.match(page, /toggleProductList\("all"\)/);
  assert.match(page, /toggleProductList\("favorites"\)/);
  assert.match(page, /onClick=\{\(\) => selectProductForTarget\(product\)\}/);
  assert.match(page, /productPickerTarget\.kind === "append"[\s\S]*?addProduct\(product\)/);
  assert.doesNotMatch(page, /addProduct\(product\); setProductQuery\(""\)/);
});

test("construction board uses the shared construction schedule endpoint", () => {
  assert.match(schedule, /\/api\/schedules\?scope=construction-board/);
  assert.match(schedule, /customStage/);
  assert.match(schedule, /addCustomStage/);
  assert.doesNotMatch(schedule, /isConstructionStage\(item\.stage \|\| item\.label\)/);
});
