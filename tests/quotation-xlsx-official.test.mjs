import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

register(new URL("./typescript-resolver.mjs", import.meta.url));
const { createQuotationWorkbook } = await import("../lib/quotation-xlsx.ts");

test("관공서 견적서는 VAT 포함 금액, 조달 수수료, 세로 한 페이지 열 맞춤을 사용한다", async () => {
  const logoData = new Uint8Array(await readFile(new URL("../public/whizzup-logo.png", import.meta.url)));
  const sealData = new Uint8Array(await readFile(new URL("../public/whizzup-seal.png", import.meta.url)));
  const workbook = createQuotationWorkbook({
    customerName: "함양군청",
    quoteDate: "2026-08-10",
    projectTitle: "가상현실 스포츠실 구축",
    quoteNumber: "WHZ-2026-0810-001",
    includeStamp: true,
    logoData,
    sealData,
    lines: [
      { name: "가상스포츠시스템", specification: "AP-EDUVR-01", quantity: 2, unit: "대", unitPrice: 27_000_000, note: "", procurement: true, procurementChannel: "G2B", procurementNumber: "26172954", procurementFeeRate: 0.0054 },
      { name: "학교장터 센서", specification: "S2B 등록 제품", quantity: 1, unit: "대", unitPrice: 5_500_000, note: "S2B 2025071433792973", procurement: true, procurementChannel: "S2B", procurementNumber: "2025071433792973", procurementFeeRate: 0 },
      { name: "스마트미러", specification: "ATV-EDU-SPORTS_001", quantity: 1, unit: "대", unitPrice: 14_900_000, note: "" },
    ],
  });
  const files = unzipSync(workbook);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const book = strFromU8(files["xl/workbook.xml"]);
  assert.match(sheet, /orientation="portrait" fitToWidth="1" fitToHeight="0"/);
  assert.match(sheet, /조달\s*수수료/);
  assert.match(sheet, /G2B · 26172954/);
  assert.match(sheet, /S2B · 2025071433792973/);
  assert.match(sheet, /학교장터/);
  assert.match(sheet, /수의계약/);
  assert.match(sheet, /식별번호/);
  assert.match(sheet, /<c r="K19" s="0"><v>0<\/v><\/c>/);
  assert.doesNotMatch(sheet, /0\.54%/);
  assert.match(sheet, /부가가치세/);
  assert.match(book, /_xlnm\.Print_Area/);
  assert.ok(files["xl/media/logo.png"]);
  assert.ok(files["xl/media/seal.png"]);
  assert.doesNotMatch(sheet, /<row r="21"/);
});

test("출력 빈 행은 요청한 수만큼만 Excel 품목표에 추가한다", () => {
  const workbook = createQuotationWorkbook({
    customerName: "테스트 기관",
    quoteDate: "2026-08-10",
    projectTitle: "출력 빈 행 확인",
    extraBlankRows: 2,
    lines: [
      { name: "테스트 제품", specification: "규격", quantity: 1, unit: "대", unitPrice: 1_000_000, note: "" },
    ],
  });
  const files = unzipSync(workbook);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /<row r="18"/);
  assert.match(sheet, /<row r="19" ht="34"/);
  assert.match(sheet, /<row r="20" ht="34"/);
  assert.doesNotMatch(sheet, /<row r="21" ht="34"/);
});
