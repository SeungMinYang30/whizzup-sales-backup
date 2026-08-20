import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateEquipmentFinance,
  equipmentSettlementQuantity,
  resolveEquipmentSnapshotRate,
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
      procurementFee: 0,
      quotationAmount: 27_000_000,
      expectedPartnerCommission: 6_750_000,
      expectedDirectMargin: 0,
      expectedEarning: 6_750_000,
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
      procurementFee: 0,
      quotationAmount: 27_000_000,
      expectedPartnerCommission: 6_750_000,
      expectedDirectMargin: 0,
      expectedEarning: 6_750_000,
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
      procurementFee: 0,
      quotationAmount: 27_000_000,
      expectedPartnerCommission: 6_750_000,
      expectedDirectMargin: 0,
      expectedEarning: 6_750_000,
      wizupCommission: 6_750_000,
      consortiumPayment: 5_000_000,
      marginAmount: 1_750_000,
      marginRate: 1_750_000 / 27_000_000,
    },
  );
});

test("위즈업 직접 공급은 협력사 수수료와 분리해 예상 마진을 계산한다", () => {
  const result = calculateEquipmentFinance({
    unitPrice: 5_500_000,
    quantity: 1,
    executionType: "직영",
    supplyType: "direct",
    commissionRate: 0.25,
    marginRate: 0.5545454545454546,
  });
  assert.equal(result.expectedPartnerCommission, 0);
  assert.equal(result.wizupCommission, 0);
  assert.equal(result.expectedDirectMargin, 3_050_000);
  assert.equal(result.expectedEarning, 3_050_000);
  assert.equal(result.marginAmount, 3_050_000);
});

test("직접 공급 컨소 지급액은 예상 마진을 넘지 않는다", () => {
  const result = calculateEquipmentFinance({
    unitPrice: 5_500_000,
    quantity: 1,
    executionType: "컨소",
    commissionInputType: "amount",
    supplyType: "direct",
    marginRate: 0.5,
    consortiumPaymentAmount: 9_000_000,
  });
  assert.equal(result.expectedPartnerCommission, 0);
  assert.equal(result.expectedDirectMargin, 2_750_000);
  assert.equal(result.consortiumPayment, 2_750_000);
  assert.equal(result.marginAmount, 0);
});

test("명시한 직접 공급 마진율은 카탈로그 기본값보다 우선하며 0%도 보존한다", () => {
  assert.equal(
    resolveEquipmentSnapshotRate({
      requestedProvided: true,
      requestedRate: 0.42,
      catalogRate: 0.55,
      existingRate: 0.5,
    }),
    0.42,
  );
  assert.equal(
    resolveEquipmentSnapshotRate({
      requestedProvided: true,
      requestedRate: 0,
      catalogRate: 0.55,
      existingRate: 0.5,
    }),
    0,
  );
});

test("비율을 보내지 않은 경우에만 카탈로그와 기존 스냅샷을 사용한다", () => {
  assert.equal(
    resolveEquipmentSnapshotRate({
      requestedProvided: false,
      requestedRate: null,
      catalogRate: 0.55,
      existingRate: 0.5,
    }),
    0.55,
  );
  assert.equal(
    resolveEquipmentSnapshotRate({
      requestedProvided: false,
      requestedRate: null,
      existingRate: 0.25,
    }),
    0.25,
  );
});

test("조달 제품은 조달 수수료를 견적 합계에 더한다", () => {
  const result = calculateEquipmentFinance({
    unitPrice: 50_000_000,
    quantity: 1,
    executionType: "직영",
    commissionRate: 0.25,
    procurementFeeRate: 0.0054,
  });
  assert.equal(result.totalAmount, 50_000_000);
  assert.equal(result.procurementFee, 270_000);
  assert.equal(result.quotationAmount, 50_270_000);
  assert.equal(result.marginAmount, 12_500_000);
});

test("수수료와 정산 금액은 10원 미만을 절사한다", () => {
  const result = calculateEquipmentFinance({
    unitPrice: 2_310_000,
    quantity: 1,
    executionType: "컨소",
    commissionInputType: "rate",
    commissionRate: 0.333,
    procurementFeeRate: 0.0054,
    consortiumCommissionRate: 0.111,
  });
  assert.equal(result.procurementFee, 12_470);
  assert.equal(result.wizupCommission, 769_230);
  assert.equal(result.consortiumPayment, 256_410);
  assert.equal(result.marginAmount, 512_820);
  assert.equal(result.quotationAmount, 2_322_470);
});

test("음수 품목은 견적 합계에서 차감하고 수수료는 만들지 않는다", () => {
  const result = calculateEquipmentFinance({
    unitPrice: -1_000_000,
    quantity: 1,
    executionType: "직영",
    commissionRate: 0.15,
  });
  assert.equal(result.totalAmount, -1_000_000);
  assert.equal(result.quotationAmount, -1_000_000);
  assert.equal(result.wizupCommission, 0);
  assert.equal(result.marginAmount, 0);
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
