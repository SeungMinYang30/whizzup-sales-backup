import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateEquipmentFinance,
  equipmentSettlementQuantity,
} from "../lib/equipment-finance.ts";

test("직영은 제품 수수료율만큼 위즈업 수수료와 마진으로 계산한다", () => {
  assert.deepEqual(
    calculateEquipmentFinance({
      unitPrice: 27_000_000,
      quantity: 1,
      executionType: "직영",
      commissionRate: 0.25,
    }),
    {
      quantity: 1,
      totalAmount: 27_000_000,
      wizupCommission: 6_750_000,
      consortiumPayment: 0,
      marginAmount: 6_750_000,
      marginRate: 0.25,
    },
  );
});

test("위즈업 25%, 컨소 20%면 실제 마진은 5%다", () => {
  assert.deepEqual(
    calculateEquipmentFinance({
      unitPrice: 27_000_000,
      quantity: 1,
      executionType: "컨소",
      commissionInputType: "rate",
      commissionRate: 0.25,
      consortiumCommissionRate: 0.2,
    }),
    {
      quantity: 1,
      totalAmount: 27_000_000,
      wizupCommission: 6_750_000,
      consortiumPayment: 5_400_000,
      marginAmount: 1_350_000,
      marginRate: 0.05,
    },
  );
});

test("컨소 지급 금액을 직접 입력할 수 있다", () => {
  assert.deepEqual(
    calculateEquipmentFinance({
      unitPrice: 27_000_000,
      quantity: 1,
      executionType: "컨소",
      commissionInputType: "amount",
      commissionRate: 0.25,
      consortiumPaymentAmount: 5_000_000,
    }),
    {
      quantity: 1,
      totalAmount: 27_000_000,
      wizupCommission: 6_750_000,
      consortiumPayment: 5_000_000,
      marginAmount: 1_750_000,
      marginRate: 1_750_000 / 27_000_000,
    },
  );
});

test("정산 수량은 통합 수량, 기존 수주·설치, 기본 1개 순서로 사용한다", () => {
  assert.equal(equipmentSettlementQuantity({ proposedQty: 3, awardedQty: 2 }), 3);
  assert.equal(equipmentSettlementQuantity({ proposedQty: 3, awardedQty: 0 }), 3);
  assert.equal(
    equipmentSettlementQuantity({ proposedQty: 0, awardedQty: 0, installedQty: 4 }),
    4,
  );
  assert.equal(equipmentSettlementQuantity({ proposedQty: 0, awardedQty: 0 }), 1);
});

test("컨소 지급은 위즈업 수수료를 넘지 않는다", () => {
  const result = calculateEquipmentFinance({
    unitPrice: 1_000_000,
    quantity: 2,
    executionType: "컨소",
    commissionInputType: "amount",
    commissionRate: 0.25,
    consortiumPaymentAmount: 3_000_000,
  });
  assert.equal(result.wizupCommission, 500_000);
  assert.equal(result.consortiumPayment, 500_000);
  assert.equal(result.marginAmount, 0);
  assert.equal(result.marginRate, 0);
});
