import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateAwardSettlementProjection,
  calculateConstructionFinance,
} from "../lib/construction-finance.ts";

test("공사 마진은 견적 공사비에서 실공사비를 빼고 음수도 보존한다", () => {
  assert.deepEqual(
    calculateConstructionFinance({
      constructionAmount: 2_273_580,
      actualConstructionCost: 7_900_000,
    }),
    {
      constructionAmount: 2_273_580,
      actualConstructionCost: 7_900_000,
      constructionMargin: -5_626_420,
    },
  );
});

test("실공사비가 없으면 견적 공사비를 기본값으로 사용해 마진을 0원으로 둔다", () => {
  for (const actualConstructionCost of [null, undefined]) {
    assert.deepEqual(
      calculateConstructionFinance({
        constructionAmount: 2_273_580,
        actualConstructionCost,
      }),
      {
        constructionAmount: 2_273_580,
        actualConstructionCost: 2_273_580,
        constructionMargin: 0,
      },
    );
  }
});

test("명시적으로 입력한 실공사비 0원과 음수 공사 금액을 그대로 계산한다", () => {
  assert.deepEqual(
    calculateConstructionFinance({
      constructionAmount: -500_000.4,
      actualConstructionCost: 0,
    }),
    {
      constructionAmount: -500_000,
      actualConstructionCost: 0,
      constructionMargin: -500_000,
    },
  );
});

test("공사 손실은 협력사 정산 입금 예정액과 예상수익에서 소급 차감한다", () => {
  assert.deepEqual(
    calculateAwardSettlementProjection({
      expectedPartnerCommission: 11_010_550,
      expectedDirectSalesCollection: 0,
      expectedDirectMargin: 0,
      expectedConstructionMargin: -5_626_420,
      expectedConsortiumSettlement: 0,
    }),
    {
      rawExpectedCollectionTotal: 5_384_130,
      expectedCollectionTotal: 5_384_130,
      expectedSettlementDeficit: 0,
      expectedProfit: 5_384_130,
    },
  );
});

test("순정산액이 음수면 입금 예정액은 0원이고 정산 부족액으로 분리한다", () => {
  assert.deepEqual(
    calculateAwardSettlementProjection({
      expectedPartnerCommission: 1_000_000.4,
      expectedDirectSalesCollection: 0,
      expectedDirectMargin: 200_000.4,
      expectedConstructionMargin: -2_500_000.4,
      expectedConsortiumSettlement: 100_000.4,
    }),
    {
      rawExpectedCollectionTotal: -1_500_000,
      expectedCollectionTotal: 0,
      expectedSettlementDeficit: 1_500_000,
      expectedProfit: -1_400_000,
    },
  );
});
