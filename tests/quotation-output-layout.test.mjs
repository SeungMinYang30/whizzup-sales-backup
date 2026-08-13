import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

register(new URL("./typescript-resolver.mjs", import.meta.url));

const { formatQuotationItemNameForOutput } = await import("../lib/quotation-output-text.ts");
const { createQuotationWorkbook } = await import("../lib/quotation-xlsx.ts");
const { createConsortiumSettlementWorkbook } = await import("../lib/consortium-settlement-xlsx.ts");

test("long descriptive product suffixes wrap consistently in quotation output", () => {
  const name = "가상스포츠시스템 (터치스크린)";
  assert.equal(formatQuotationItemNameForOutput(name), "가상스포츠시스템\n(터치스크린)");
  assert.equal(formatQuotationItemNameForOutput("제품 (A1)"), "제품 (A1)");

  const workbook = createQuotationWorkbook({
    customerName: "테스트 기관",
    quoteDate: "2026-08-13",
    projectTitle: "출력 줄바꿈 확인",
    lines: [{ name, specification: "AP-EDUVR-01", quantity: 1, unit: "대", unitPrice: 1_000_000, note: "" }],
  });
  const sheet = strFromU8(unzipSync(workbook)["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /가상스포츠시스템\n\(터치스크린\)/);
  assert.match(sheet, /<row r="18" ht="43"/);
});

test("settlement workbook uses a clean merged signature block", () => {
  const workbook = createConsortiumSettlementWorkbook({
    organization: "테스트 기관",
    businessRound: 1,
    projectTitle: "정산서",
    quoteDate: "2026-08-13",
    quoteNumber: "WZ-TEST",
    consortiumCompany: "협력사",
    includeStamp: false,
    items: [{ name: "가상스포츠시스템 (터치스크린)", contractLabel: "조달 계약", lineAmount: 1_000_000, consortiumRate: 0.2, grossPayment: 200_000 }],
    costs: [],
    adjustments: [],
  });
  const files = unzipSync(workbook);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const styles = strFromU8(files["xl/styles.xml"]);
  assert.match(sheet, /가상스포츠시스템\n\(터치스크린\)/);
  assert.match(sheet, /<mergeCell ref="D\d+:G\d+"\/>/);
  assert.doesNotMatch(sheet, /<mergeCell ref="G\d+:G\d+"\/>/);
  assert.match(styles, /fontId="6" fillId="0" borderId="0"/);
});

test("catalog sticky controls and settlement sidebar match the shared layouts", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");
  assert.match(styles, /\.product-workspace-tabs\s*\{[\s\S]*?position:\s*relative/);
  assert.match(styles, /\.product-catalog-sticky-controls\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*74px/);
  assert.match(styles, /\.quotation-settlement-adjustments article\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(styles, /\.quotation-output-spacing\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.match(page, /quotation-output-menu-settlement/);
  assert.match(styles, /quotation-output-menu-settlement \.quotation-output-menu-panel>button\{[^}]*white-space:normal;[^}]*word-break:keep-all/);
  assert.match(page, /정산서 출력·다운로드[\s\S]*?정산서 PDF 보기·인쇄[\s\S]*?정산서 PDF 다운로드[\s\S]*?정산서 Excel 다운로드/);
  assert.match(page, /printPortalReady && !internalReportOpen/);
  assert.match(styles, /body\.internal-profit-printing>\.quotation-print-portal\{display:none!important/);
});
