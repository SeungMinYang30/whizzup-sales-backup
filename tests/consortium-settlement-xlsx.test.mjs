import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

register(new URL("./typescript-resolver.mjs", import.meta.url));
const { calculateConsortiumSettlement } = await import("../lib/consortium-settlement.ts");
const { createConsortiumSettlementWorkbook } = await import("../lib/consortium-settlement-xlsx.ts");
const { createInternalProfitReportWorkbook } = await import("../lib/internal-profit-report-xlsx.ts");

test("정산서 반영 비용과 위즈업 별도 처리 비용을 구분한다", () => {
  const result = calculateConsortiumSettlement([
    { name: "빔프로젝터", quantity: 1, unitPrice: 10_000_000, earningRate: 0.3, consortiumRate: 0.2, internalCostEnabled: true, internalCostAmount: 220_000, internalCostBearer: "consortium" },
    { name: "AI FIT", quantity: 1, unitPrice: 5_000_000, earningRate: 0.4, consortiumRate: 0.25, internalCostEnabled: true, internalCostAmount: 300_000, internalCostBearer: "whizzup" },
  ], "컨소");
  assert.equal(result.grossPayment, 3_250_000);
  assert.equal(result.consortiumCost, 220_000);
  assert.equal(result.whizzupCost, 300_000);
  assert.equal(result.finalPayment, 3_030_000);
});

test("정산 조정은 추가 지급과 차감을 최종 지급액에 반영한다", () => {
  const result = calculateConsortiumSettlement([
    { name: "아이핏 전자칠판형", quantity: 2, unitPrice: 10_000_000, earningRate: 0.3, consortiumRate: 0.2, internalCostEnabled: true, internalCostAmount: 600_000, internalCostQuantity: 2, internalCostUnitAmount: 300_000, internalCostBearer: "consortium" },
  ], "컨소", [
    { type: "addition", label: "출장 지원", amount: 100_000 },
    { type: "deduction", label: "추가 부자재", amount: 50_000 },
  ]);
  assert.equal(result.grossPayment, 4_000_000);
  assert.equal(result.consortiumCost, 600_000);
  assert.equal(result.adjustmentAdditions, 100_000);
  assert.equal(result.adjustmentDeductions, 50_000);
  assert.equal(result.finalPayment, 3_450_000);
  assert.equal(result.costs[0].quantity, 2);
  assert.equal(result.costs[0].unitAmount, 300_000);
});

test("콘텐츠 대체비용은 컨소 지급이 아니라 내부 바이패스 마진에서만 계산한다", () => {
  const result = calculateConsortiumSettlement([
    {
      name: "콘텐츠",
      quantity: 1,
      unitPrice: 2_700_000,
      earningRate: 0.5,
      consortiumRate: 0.5,
      internalCostEnabled: true,
      internalCostAmount: 1_600_000,
      internalCostBearer: "consortium",
    },
  ], "컨소");
  assert.equal(result.grossPayment, 0);
  assert.equal(result.consortiumCost, 0);
  assert.equal(result.finalPayment, 0);
});

test("일반 콘텐츠 품목은 기존 견적에도 입력된 컨소 지급률을 소급 적용한다", () => {
  const result = calculateConsortiumSettlement([
    { name: "콘텐츠", quantity: 1, unitPrice: 15_000_000, earningRate: 0.3, consortiumRate: 0.3, internalCostEnabled: false },
    { name: "아이핏 PAPS 콘텐츠", quantity: 1, unitPrice: 8_500_000, earningRate: 0.3, consortiumRate: 0.3, internalCostEnabled: false },
    { name: "에어패스 가상사격시스템", specification: "카메라센서, 총, 콘텐츠 포함", quantity: 1, unitPrice: 7_000_000, earningRate: 0.2, consortiumRate: 0.2, internalCostEnabled: false },
  ], "컨소");
  assert.deepEqual(result.items.map((item) => item.grossPayment), [4_500_000, 2_550_000, 1_400_000]);
  assert.equal(result.grossPayment, 8_450_000);
});

test("무상 제공 품목은 컨소 지급 계산에서 제외하고 별도 내부 비용은 유지한다", () => {
  const result = calculateConsortiumSettlement([
    { name: "무상 교구", quantity: 1, unitPrice: 1_500_000, complimentary: true, earningRate: 0.3, consortiumRate: 0.2, internalCostEnabled: true, internalCostAmount: 100_000, internalCostBearer: "whizzup" },
  ], "컨소");
  assert.equal(result.items[0].lineAmount, 0);
  assert.equal(result.grossPayment, 0);
  assert.equal(result.finalPayment, 0);
  assert.equal(result.whizzupCost, 100_000);
});

test("컨소 정산서 Excel은 내부 마진 없이 품목·비용 처리 방식·최종 지급액을 표시한다", () => {
  const workbook = createConsortiumSettlementWorkbook({
    organization: "테스트초등학교",
    businessRound: 1,
    projectTitle: "가상현실 스포츠실",
    quoteDate: "2026-08-13",
    quoteNumber: "WHZ-TEST-001",
    consortiumCompany: "무한정보통신",
    includeStamp: true,
    logoData: new Uint8Array([1, 2, 3]),
    sealData: new Uint8Array([4, 5, 6]),
    items: [{ name: "빔프로젝터", contractLabel: "조달 계약", lineAmount: 10_000_000, consortiumRate: 0.2, grossPayment: 2_000_000 }],
    costs: [{ label: "빔프로젝터 설치비", quantity: 1, unitAmount: 220_000, amount: 220_000, bearer: "consortium", consortiumDeduction: 220_000 }],
    adjustments: [
      { type: "addition", typeLabel: "추가 지급", label: "현장 지원", note: "협의 반영", amount: 100_000 },
      { type: "deduction", typeLabel: "정산 차감", label: "추가 자재", note: "실비", amount: 50_000 },
    ],
  });
  const files = unzipSync(workbook);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /정  산  서/);
  assert.doesNotMatch(sheet, /컨 소  정 산 서/);
  assert.match(sheet, /무한정보통신/);
  assert.match(sheet, /정산서 반영/);
  assert.match(sheet, /비용 처리 방식/);
  assert.match(sheet, /최종 지급 예정액/);
  assert.match(sheet, /FLOOR\(D15\*E15,10\)/);
  assert.doesNotMatch(sheet, /MAX\(0,/);
  assert.match(sheet, /정산 대상/);
  assert.match(sheet, /금액 요약/);
  assert.match(sheet, /정산 조정 내역/);
  assert.match(sheet, /추가 지급/);
  assert.match(sheet, /정산 차감/);
  assert.match(sheet, /SUMIF\(B\d+:B\d+,&quot;정산 차감&quot;,G\d+:G\d+\)/);
  assert.doesNotMatch(sheet, /마진|위즈업 수익|예상 수익/);
  assert.ok(files["xl/media/logo.png"]);
  assert.ok(files["xl/media/seal.png"]);
});

test("내부 수익표 Excel은 PDF형 요약과 품목별 수식을 포함하는 실제 xlsx다", () => {
  const workbook = createInternalProfitReportWorkbook({
    logoData: new Uint8Array([1, 2, 3]),
    organization: "덕벌초등학교",
    projectTitle: "가상현실 스포츠실",
    quoteNumber: "WZ-TEST-002",
    quoteDate: "2026-08-13",
    executionType: "컨소",
    consortiumCompany: "무한정보통신",
    total: 15_000_000,
    earning: 4_500_000,
    consortium: 4_500_000,
    internalCost: 0,
    margin: 0,
    marginRate: 0,
    rows: [{ number: 1, name: "콘텐츠", specification: "교육용 콘텐츠", quantity: 1, unit: "식", unitPrice: 15_000_000, complimentary: false, amount: 15_000_000, baseRate: 0.3, baseEarning: 4_500_000, earning: 4_500_000, consortiumRate: 0.3, consortium: 4_500_000, internalCost: 0, internalCostDisplay: 0, netProfit: 0, status: "일반" }],
  });
  const files = unzipSync(workbook);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const styles = strFromU8(files["xl/styles.xml"]);
  const workbookXml = strFromU8(files["xl/workbook.xml"]);
  assert.match(workbookXml, /내부 수익표/);
  assert.match(sheet, /내 부  수 익 표/);
  assert.match(sheet, /품목별 수익 내역/);
  assert.match(sheet, /M13\*N13/);
  assert.match(sheet, /FLOOR\(G13\*O13,10\)/);
  assert.match(sheet, /I13-Q13-R13/);
  assert.match(sheet, /orientation="portrait"/);
  assert.match(sheet, /fitToHeight="1"/);
  assert.doesNotMatch(sheet, /<autoFilter/);
  assert.match(sheet, /<mergeCell ref="A12:L12"/);
  assert.match(sheet, /<mergeCell ref="B13:F13"/);
  assert.match(sheet, /view="pageLayout"/);
  assert.match(sheet, /showRowColHeaders="0"/);
  assert.match(sheet, /zoomScale="95"/);
  assert.match(sheet, /<col min="13" max="16384" width="2" hidden="1"/);
  assert.match(workbookXml, /\$A\$1:\$L\$/);
  assert.ok(files["xl/media/logo.png"]);
  assert.match(styles, /#,##0&quot;원&quot;/);
  assert.match(styles, /shrinkToFit="1"/);
  assert.match(styles, /<fonts count="7"/);
  assert.match(styles, /<sz val="11"\/\><name val="맑은 고딕"/);
  assert.match(sheet, /<mergeCell ref="I15:L15"/);
  assert.match(sheet, /r="I15"[^>]*s="19"/);
  assert.doesNotMatch(styles, /<xf[^>]*borderId="2"/);
  assert.match(styles, /<name val="맑은 고딕"/);
  assert.match(sheet, /r="B5"[^>]*s="3"/);
  assert.match(sheet, /r="F5"[^>]*s="4"/);
  assert.match(sheet, /r="F13"[^>]*s="9"/);
});

test("모바일 내부 수익표 Excel도 PDF형 단일 보고서 레이아웃을 유지한다", () => {
  const workbook = createInternalProfitReportWorkbook({
    compactView: true, organization: "모바일 기관", projectTitle: "가상현실 스포츠실", quoteNumber: "WZ-MOBILE", quoteDate: "2026-08-13", executionType: "직영", consortiumCompany: "", total: 50_000_000, earning: 15_000_000, consortium: 0, internalCost: 300_000, margin: 14_700_000, marginRate: 0.294,
    rows: [{ number: 1, name: "아이핏 슬림형", specification: "멀티미디어학습장치", quantity: 1, unit: "대", unitPrice: 19_500_000, complimentary: false, amount: 19_500_000, baseRate: 0.3, baseEarning: 5_850_000, earning: 5_850_000, consortiumRate: 0, consortium: 0, internalCost: 300_000, internalCostDisplay: 300_000, netProfit: 5_550_000, status: "내부 비용 반영" }],
  });
  const files = unzipSync(workbook);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const workbookXml = strFromU8(files["xl/workbook.xml"]);
  assert.match(sheet, /dimension ref="A1:R/);
  assert.match(sheet, /품목별 수익 내역/);
  assert.match(sheet, /컨소·내부 비용을 반영한 최종 예상 수익/);
  assert.match(workbookXml, /\$A\$1:\$L\$/);
});
