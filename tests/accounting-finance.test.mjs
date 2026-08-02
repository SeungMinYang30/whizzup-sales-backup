import assert from "node:assert/strict";
import test from "node:test";

import { calculateAccountingFlow } from "../lib/accounting-finance.ts";

test("직영은 제조사 수수료에서 기타 비용만 차감한다", () => {
  assert.deepEqual(
    calculateAccountingFlow({
      executionType: "직영",
      manufacturerCommissionExpected: 10_000_000,
      manufacturerCommissionReceived: 7_000_000,
      consortiumPaymentExpected: 8_000_000,
      consortiumPaymentPaid: 5_000_000,
      otherCost: 500_000,
    }),
    {
      manufacturerCommissionExpected: 10_000_000,
      manufacturerCommissionReceived: 7_000_000,
      commissionReceivable: 3_000_000,
      consortiumPaymentExpected: 0,
      consortiumPaymentPaid: 0,
      consortiumPayable: 0,
      otherCost: 500_000,
      netRevenue: 9_500_000,
    },
  );
});

test("컨소는 제조사 수수료에서 협력업체 지급과 기타 비용을 차감한다", () => {
  assert.deepEqual(
    calculateAccountingFlow({
      executionType: "컨소",
      manufacturerCommissionExpected: 10_000_000,
      manufacturerCommissionReceived: 10_000_000,
      consortiumPaymentExpected: 6_000_000,
      consortiumPaymentPaid: 4_000_000,
      otherCost: 500_000,
    }),
    {
      manufacturerCommissionExpected: 10_000_000,
      manufacturerCommissionReceived: 10_000_000,
      commissionReceivable: 0,
      consortiumPaymentExpected: 6_000_000,
      consortiumPaymentPaid: 4_000_000,
      consortiumPayable: 2_000_000,
      otherCost: 500_000,
      netRevenue: 3_500_000,
    },
  );
});
