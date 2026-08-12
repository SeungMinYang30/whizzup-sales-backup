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
    costs: [{ label: "빔프로젝터 설치비", amount: 220_000, bearer: "consortium", consortiumDeduction: 220_000 }],
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
  assert.match(sheet, /MAX\(0,/);
  assert.match(sheet, /정산 대상/);
  assert.match(sheet, /금액 요약/);
  assert.doesNotMatch(sheet, /마진|위즈업 수익|예상 수익/);
  assert.ok(files["xl/media/logo.png"]);
  assert.ok(files["xl/media/seal.png"]);
});
