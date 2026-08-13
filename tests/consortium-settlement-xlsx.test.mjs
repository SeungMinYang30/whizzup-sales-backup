import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

register(new URL("./typescript-resolver.mjs", import.meta.url));
const { calculateConsortiumSettlement } = await import("../lib/consortium-settlement.ts");
const { createConsortiumSettlementWorkbook } = await import("../lib/consortium-settlement-xlsx.ts");

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

test("콘텐츠 대체 비용이 기본 정산액보다 크면 다음 정산 상계를 위해 음수를 유지한다", () => {
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
  assert.equal(result.grossPayment, 1_350_000);
  assert.equal(result.consortiumCost, 1_600_000);
  assert.equal(result.finalPayment, -250_000);
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
