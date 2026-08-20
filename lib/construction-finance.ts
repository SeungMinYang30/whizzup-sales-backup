export type ConstructionFinanceInput = {
  constructionAmount?: number | null;
  actualConstructionCost?: number | null;
};

export type AwardSettlementProjectionInput = {
  expectedPartnerCommission: number;
  expectedDirectSalesCollection: number;
  expectedDirectMargin: number;
  expectedConstructionMargin: number;
  expectedConsortiumSettlement: number;
};

function signedInteger(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export function calculateConstructionFinance({
  constructionAmount: rawConstructionAmount,
  actualConstructionCost: rawActualConstructionCost,
}: ConstructionFinanceInput) {
  const constructionAmount = signedInteger(rawConstructionAmount);
  const actualConstructionCost =
    rawActualConstructionCost === null ||
    rawActualConstructionCost === undefined
      ? constructionAmount
      : signedInteger(rawActualConstructionCost);

  return {
    constructionAmount,
    actualConstructionCost,
    constructionMargin: constructionAmount - actualConstructionCost,
  };
}

export function calculateAwardSettlementProjection({
  expectedPartnerCommission: rawExpectedPartnerCommission,
  expectedDirectSalesCollection: rawExpectedDirectSalesCollection,
  expectedDirectMargin: rawExpectedDirectMargin,
  expectedConstructionMargin: rawExpectedConstructionMargin,
  expectedConsortiumSettlement: rawExpectedConsortiumSettlement,
}: AwardSettlementProjectionInput) {
  const expectedPartnerCommission = signedInteger(
    rawExpectedPartnerCommission,
  );
  const expectedDirectSalesCollection = signedInteger(
    rawExpectedDirectSalesCollection,
  );
  const expectedDirectMargin = signedInteger(rawExpectedDirectMargin);
  const expectedConstructionMargin = signedInteger(
    rawExpectedConstructionMargin,
  );
  const expectedConsortiumSettlement = signedInteger(
    rawExpectedConsortiumSettlement,
  );
  const rawExpectedCollectionTotal =
    expectedPartnerCommission +
    expectedDirectSalesCollection;

  return {
    rawExpectedCollectionTotal,
    expectedCollectionTotal: Math.max(0, rawExpectedCollectionTotal),
    expectedSettlementDeficit: Math.max(0, -rawExpectedCollectionTotal),
    expectedProfit:
      expectedPartnerCommission +
      expectedDirectMargin +
      expectedConstructionMargin -
      expectedConsortiumSettlement,
  };
}
