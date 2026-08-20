import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./typescript-resolver.mjs", import.meta.url));

const {
  calculateRegisteredQuote,
  isRegisteredQuoteItemAmount,
} = await import(
  "../lib/registered-quote.ts"
);

test("명천유치원 계약금액은 등록 품목 견적과 견적 공사비 합계 4,500만원이다", () => {
  const quote = calculateRegisteredQuote({
    items: [
      {
        quotationAmount: 42_726_420,
        amountRegistered: true,
      },
    ],
    constructions: [
      {
        quotationAmount: 2_273_580,
        amountRegistered: true,
      },
    ],
  });

  assert.deepEqual(quote, {
    contractAmount: 45_000_000,
    quoteStatus: "complete",
    quoteItemCount: 1,
    quoteMissingAmountItemCount: 0,
    quoteConstructionCount: 1,
  });
});

test("품목과 견적 공사비가 없으면 예산과 무관하게 견적 미등록이다", () => {
  assert.deepEqual(calculateRegisteredQuote({}), {
    contractAmount: 0,
    quoteStatus: "missing",
    quoteItemCount: 0,
    quoteMissingAmountItemCount: 0,
    quoteConstructionCount: 0,
  });
});

test("금액이 없는 품목이 섞이면 등록 금액만 합산하고 부분 등록으로 구분한다", () => {
  const quote = calculateRegisteredQuote({
    items: [
      { quotationAmount: 10_000_000, amountRegistered: true },
      { quotationAmount: 0, amountRegistered: false },
    ],
  });

  assert.equal(quote.contractAmount, 10_000_000);
  assert.equal(quote.quoteStatus, "partial");
  assert.equal(quote.quoteMissingAmountItemCount, 1);
});

test("무상 제공처럼 금액 상태를 명시한 0원 품목은 미등록으로 보지 않는다", () => {
  const quote = calculateRegisteredQuote({
    items: [{ quotationAmount: 0, amountRegistered: true }],
  });

  assert.equal(quote.contractAmount, 0);
  assert.equal(quote.quoteStatus, "complete");
});

test("수량이 모두 0이면 단가가 있어도 계약금액에 넣지 않는다", () => {
  assert.equal(
    isRegisteredQuoteItemAmount({
      priceStatus: "입력 완료",
      unitPrice: 10_000_000,
      proposedQty: 0,
      awardedQty: 0,
      installedQty: 0,
    }),
    false,
  );
});

test("입력 완료 상태라도 단가가 비어 있으면 부분 등록이다", () => {
  const amountRegistered = isRegisteredQuoteItemAmount({
    priceStatus: "입력 완료",
    unitPrice: null,
    proposedQty: 1,
  });
  const quote = calculateRegisteredQuote({
    items: [{ quotationAmount: 0, amountRegistered }],
  });

  assert.equal(quote.contractAmount, 0);
  assert.equal(quote.quoteStatus, "partial");
});

test("무상·계약금액 포함·서비스 품목은 단가와 수량 없이도 정상 등록이다", () => {
  for (const priceStatus of [
    "무상 제공",
    "계약금액에 포함",
    "서비스 품목",
  ]) {
    assert.equal(
      isRegisteredQuoteItemAmount({
        priceStatus,
        unitPrice: null,
        proposedQty: 0,
      }),
      true,
    );
  }
});

test("명시적으로 등록한 공사비만 있어도 완성된 견적이다", () => {
  const quote = calculateRegisteredQuote({
    constructions: [{ quotationAmount: 0, amountRegistered: true }],
  });

  assert.equal(quote.contractAmount, 0);
  assert.equal(quote.quoteStatus, "complete");
  assert.equal(quote.quoteConstructionCount, 1);
});

test("수량이 있는 음수 단가는 유효한 계약금액 조정으로 인정한다", () => {
  const amountRegistered = isRegisteredQuoteItemAmount({
    priceStatus: "입력 완료",
    unitPrice: -500_000,
    proposedQty: 1,
  });
  const quote = calculateRegisteredQuote({
    items: [{ quotationAmount: -500_000, amountRegistered }],
  });

  assert.equal(amountRegistered, true);
  assert.equal(quote.contractAmount, -500_000);
  assert.equal(quote.quoteStatus, "complete");
});
