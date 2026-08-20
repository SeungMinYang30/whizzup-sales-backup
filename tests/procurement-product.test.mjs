import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROCUREMENT_FEE_RATE,
  hasProcurementSignal,
  procurementNumbersFromText,
  resolveProcurementFeeRate,
} from "../lib/procurement-product.ts";

test("G2B evidence is detected regardless of the imported field", () => {
  assert.equal(
    hasProcurementSignal(
      "비디오프로젝터, Epson (PH)EB-L260F, 4600ANSI lm G2B",
      "",
      "",
    ),
    true,
  );
  assert.equal(hasProcurementSignal("", "G2B : 25011241", ""), true);
  assert.equal(hasProcurementSignal("", "", "나라장터 조달제품"), true);
});

test("procurement numbers are extracted only when procurement context exists", () => {
  assert.deepEqual(procurementNumbersFromText("G2B : 25011241"), ["25011241"]);
  assert.deepEqual(procurementNumbersFromText("S2B 번호 2025-112-411"), [
    "2025112411",
  ]);
  assert.deepEqual(
    procurementNumbersFromText("EB-L260F 4600ANSI, 판매가 2,200,000원"),
    [],
  );
});

test("missing procurement rates are inferred while explicit zero is preserved", () => {
  assert.equal(
    resolveProcurementFeeRate(null, "G2B 25011241"),
    DEFAULT_PROCUREMENT_FEE_RATE,
  );
  assert.equal(resolveProcurementFeeRate(0, "G2B 25011241"), 0);
  assert.equal(resolveProcurementFeeRate(null, "일반 제품"), null);
});
