export type RegisteredQuoteStatus = "complete" | "partial" | "missing";

export type RegisteredQuoteComponent = {
  quotationAmount?: number | null;
  amountRegistered: boolean;
};

export type RegisteredQuoteInput = {
  items?: RegisteredQuoteComponent[];
  constructions?: RegisteredQuoteComponent[];
};

export type RegisteredQuoteTotalsInput = {
  registeredItemAmount: number;
  itemCount: number;
  missingAmountItemCount: number;
  registeredConstructionAmount: number;
  registeredConstructionCount: number;
};

const zeroAmountQuoteStatuses = new Set([
  "무상 제공",
  "계약금액에 포함",
  "서비스 품목",
]);

function signedInteger(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export function isRegisteredQuoteItemAmount(input: {
  priceStatus?: string | null;
  unitPrice?: number | null;
  proposedQty?: number | null;
  awardedQty?: number | null;
  installedQty?: number | null;
}) {
  const priceStatus = String(input.priceStatus ?? "").trim();
  if (zeroAmountQuoteStatuses.has(priceStatus)) return true;
  if (priceStatus === "금액 미입력") return false;
  const unitPrice = Number(input.unitPrice);
  const hasUnitPrice =
    input.unitPrice !== null &&
    input.unitPrice !== undefined &&
    Number.isFinite(unitPrice) &&
    unitPrice !== 0;
  const hasQuantity = [
    input.proposedQty,
    input.awardedQty,
    input.installedQty,
  ].some((value) => {
    const quantity = Number(value);
    return Number.isFinite(quantity) && quantity > 0;
  });
  return hasUnitPrice && hasQuantity;
}

export function calculateRegisteredQuote({
  items = [],
  constructions = [],
}: RegisteredQuoteInput) {
  const itemCount = items.length;
  const missingAmountItemCount = items.filter(
    (item) => !item.amountRegistered,
  ).length;
  const registeredItemAmount = items.reduce(
    (total, item) =>
      total +
      (item.amountRegistered ? signedInteger(item.quotationAmount) : 0),
    0,
  );
  const registeredConstructionCount = constructions.filter(
    (construction) => construction.amountRegistered,
  ).length;
  const registeredConstructionAmount = constructions.reduce(
    (total, construction) =>
      total +
      (construction.amountRegistered
        ? signedInteger(construction.quotationAmount)
        : 0),
    0,
  );
  return calculateRegisteredQuoteFromTotals({
    registeredItemAmount,
    itemCount,
    missingAmountItemCount,
    registeredConstructionAmount,
    registeredConstructionCount,
  });
}

export function calculateRegisteredQuoteFromTotals({
  registeredItemAmount: rawRegisteredItemAmount,
  itemCount: rawItemCount,
  missingAmountItemCount: rawMissingAmountItemCount,
  registeredConstructionAmount: rawRegisteredConstructionAmount,
  registeredConstructionCount: rawRegisteredConstructionCount,
}: RegisteredQuoteTotalsInput) {
  const registeredItemAmount = signedInteger(rawRegisteredItemAmount);
  const itemCount = Math.max(0, signedInteger(rawItemCount));
  const missingAmountItemCount = Math.min(
    itemCount,
    Math.max(0, signedInteger(rawMissingAmountItemCount)),
  );
  const registeredConstructionAmount = signedInteger(
    rawRegisteredConstructionAmount,
  );
  const registeredConstructionCount = Math.max(
    0,
    signedInteger(rawRegisteredConstructionCount),
  );
  const hasRegisteredQuote =
    itemCount > 0 || registeredConstructionCount > 0;
  const quoteStatus: RegisteredQuoteStatus = !hasRegisteredQuote
    ? "missing"
    : missingAmountItemCount > 0
      ? "partial"
      : "complete";

  return {
    contractAmount:
      registeredItemAmount + registeredConstructionAmount,
    quoteStatus,
    quoteItemCount: itemCount,
    quoteMissingAmountItemCount: missingAmountItemCount,
    quoteConstructionCount: registeredConstructionCount,
  };
}
