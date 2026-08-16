import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

register(new URL("./typescript-resolver.mjs", import.meta.url));
const { createQuotationWorkbook } = await import("../lib/quotation-xlsx.ts");
const { createAirpassEquipmentKit } = await import("../lib/airpass-equipment-kit.ts");

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
  assert.match(sheet, />품목금액</);
  assert.match(sheet, />VAT 포함</);
  assert.match(sheet, />조달수수료</);
  assert.match(sheet, />별도</);
  assert.match(sheet, /G2B · 26172954/);
  assert.match(sheet, /S2B · 2025071433792973/);
  assert.match(sheet, /학교장터/);
  assert.match(sheet, /수의계약/);
  assert.match(sheet, /식별번호/);
  assert.match(sheet, /<c r="K19" s="0"><v>0<\/v><\/c>/);
  assert.doesNotMatch(sheet, /0\.54%/);
  assert.match(sheet, />공급가액</);
  assert.match(sheet, />부가가치세</);
  assert.match(sheet, />품목금액 기준</);
  assert.ok(sheet.indexOf("최종 합계") < sheet.indexOf("공급가액"));
  assert.doesNotMatch(sheet, />할인</);
  assert.doesNotMatch(sheet, />추가비용</);
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

test("할인과 추가비용은 금액이 입력된 견적에만 표시한다", () => {
  const workbook = createQuotationWorkbook({
    customerName: "테스트 기관",
    quoteDate: "2026-08-16",
    projectTitle: "조건부 금액 요약",
    discountAmount: 100_000,
    extraAmount: 50_000,
    lines: [{ name: "테스트 제품", specification: "규격", quantity: 1, unit: "대", unitPrice: 1_000_000, note: "" }],
  });
  const sheet = strFromU8(unzipSync(workbook)["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, />할인</);
  assert.match(sheet, />추가비용</);
  assert.match(sheet, />VAT 포함</);
  assert.match(sheet, />품목금액 기준</);
  assert.doesNotMatch(sheet, /<mergeCell ref="G\d+:H\d+"\/>/);
});

test("교구 견적은 에어패스 공급자 정보와 직인을 사용하고 금액 다음에 비고가 바로 온다", async () => {
  const airpassSealData = new Uint8Array(await readFile(new URL("../public/airpass-seal.png", import.meta.url)));
  const equipmentKit = createAirpassEquipmentKit("one");
  const workbook = createQuotationWorkbook({
    customerName: "북대초등학교 병설유치원",
    quoteDate: "2026-08-12",
    projectTitle: "자체예산",
    quoteNumber: "WZ-20260812064512-D320",
    equipmentKit,
    airpassSealData,
    lines: [
      { name: "교구 세트", specification: "별첨 교구 세부견적", quantity: 1, unit: "SET", unitPrice: 1_500_000, note: "", equipmentKit: true },
    ],
  });
  const files = unzipSync(workbook);
  const mainSheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const detailSheet = strFromU8(files["xl/worksheets/sheet2.xml"]);
  assert.match(mainSheet, /수의계약\n\(주\)에어패스/);
  assert.match(detailSheet, /220-86-23479/);
  assert.match(detailSheet, /임종호/);
  assert.match(detailSheet, /하남테크노밸리 U1 CENTER/);
  assert.doesNotMatch(detailSheet, /표준 [12]세트 기준안/);
  assert.doesNotMatch(detailSheet, /수량 0 품목 제외/);
  assert.doesNotMatch(detailSheet, /자체예산 교구 세부견적/);
  assert.match(detailSheet, /<c r="B6"[^>]*>/);
  assert.match(detailSheet, /<c r="D6"[^>]*>/);
  assert.match(detailSheet, /<c r="H6"[^>]*>/);
  assert.match(detailSheet, /<c r="I6"[^>]*>/);
  assert.match(detailSheet, /<c r="G16"[^>]*>.*금액/s);
  assert.match(detailSheet, /<c r="I16"[^>]*>.*비고/s);
  assert.doesNotMatch(detailSheet, /<c r="J16"/);
  assert.ok(files["xl/media/airpass-seal.png"]);
  assert.ok(files["xl/drawings/drawing2.xml"]);
});

test("무상 제공 품목은 기준 단가를 보존하고 견적 합계와 교구 별첨 금액에서는 제외한다", () => {
  const equipmentKit = createAirpassEquipmentKit("one");
  const workbook = createQuotationWorkbook({
    customerName: "테스트 학교",
    quoteDate: "2026-08-13",
    projectTitle: "무상 교구 제공",
    equipmentKit,
    equipmentKitComplimentary: true,
    lines: [
      { name: "유상 제품", specification: "본품", quantity: 1, unit: "대", unitPrice: 10_000_000, note: "" },
      { name: "교구 세트", specification: "별첨", quantity: 1, unit: "SET", unitPrice: 1_500_000, note: "", equipmentKit: true, complimentary: true },
    ],
  });
  const files = unzipSync(workbook);
  const mainSheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const detailSheet = strFromU8(files["xl/worksheets/sheet2.xml"]);
  assert.match(mainSheet, /무상 제공/);
  assert.match(mainSheet, /무상/);
  assert.match(detailSheet, /제공 조건/);
  assert.match(detailSheet, /무상 제공/);
  assert.doesNotMatch(mainSheet, />11500000</);
});
