export type EquipmentExecutionType = "직영" | "컨소";
export type CommissionInputType = "rate" | "amount";
export type EquipmentSupplyType = "partner" | "direct";

export type EquipmentFinanceInput = {
  unitPrice: number | null;
  quantity?: number;
  executionType?: string;
  commissionInputType?: string;
  commissionRate?: number | null;
  supplyType?: string;
  marginRate?: number | null;
  procurementFeeRate?: number | null;
  consortiumCommissionRate?: number | null;
  consortiumPaymentAmount?: number | null;
};

export type EquipmentFinanceResult = {
  quantity: number;
  totalAmount: number;
  procurementFee: number;
  quotationAmount: number;
  expectedPartnerCommission: number;
  expectedDirectMargin: number;
  expectedEarning: number;
  wizupCommission: number;
  consortiumPayment: number;
  marginAmount: number;
  marginRate: number;
};

function finiteAmount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function finiteSignedAmount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truncateToTenWon(value: number) {
  return Math.floor(Math.max(0, value) / 10) * 10;
}

export function resolveEquipmentSnapshotRate(input: {
  requestedProvided: boolean;
  requestedRate: number | null;
  catalogRate?: number | null;
  existingRate?: number | null;
}) {
  if (input.requestedProvided) return input.requestedRate;
  return input.catalogRate ?? input.existingRate ?? null;
}

export function equipmentSettlementQuantity(input: {
  proposedQty?: number;
  awardedQty?: number;
  installedQty?: number;
}) {
  const proposed = Math.max(0, Math.round(finiteAmount(input.proposedQty)));
  if (proposed > 0) return proposed;
  const awarded = Math.max(0, Math.round(finiteAmount(input.awardedQty)));
  if (awarded > 0) return awarded;
  const installed = Math.max(0, Math.round(finiteAmount(input.installedQty)));
  return installed > 0 ? installed : 1;
}

export function calculateEquipmentFinance(
  input: EquipmentFinanceInput,
): EquipmentFinanceResult {
  const unitPrice = Math.round(finiteSignedAmount(input.unitPrice));
  const quantity = Math.max(1, Math.round(finiteAmount(input.quantity) || 1));
  const totalAmount = unitPrice * quantity;
  const procurementFee = truncateToTenWon(
    Math.max(0, totalAmount) *
      Math.min(1, Math.max(0, finiteAmount(input.procurementFeeRate))),
  );
  const quotationAmount = totalAmount + procurementFee;
  const supplyType: EquipmentSupplyType =
    input.supplyType === "direct" ? "direct" : "partner";
  const expectedPartnerCommission =
    supplyType === "partner"
      ? Math.min(
          Math.max(0, totalAmount),
          truncateToTenWon(
            Math.max(0, totalAmount) *
              Math.min(1, Math.max(0, finiteAmount(input.commissionRate))),
          ),
        )
      : 0;
  const expectedDirectMargin =
    supplyType === "direct"
      ? Math.min(
          Math.max(0, totalAmount),
          truncateToTenWon(
            Math.max(0, totalAmount) *
              Math.min(1, Math.max(0, finiteAmount(input.marginRate))),
          ),
        )
      : 0;
  const expectedEarning =
    expectedPartnerCommission + expectedDirectMargin;
  const wizupCommission = expectedPartnerCommission;
  if (input.executionType !== "컨소" || totalAmount <= 0) {
    return {
      quantity,
      totalAmount,
      procurementFee,
      quotationAmount,
      expectedPartnerCommission,
      expectedDirectMargin,
      expectedEarning,
      wizupCommission,
      consortiumPayment: 0,
      marginAmount: expectedEarning,
      marginRate: totalAmount > 0 ? expectedEarning / totalAmount : 0,
    };
  }

  const consortiumPayment =
    input.commissionInputType === "amount"
      ? Math.min(
          expectedEarning,
          truncateToTenWon(finiteAmount(input.consortiumPaymentAmount)),
        )
      : Math.min(
          expectedEarning,
          truncateToTenWon(
            totalAmount *
              Math.min(
                1,
                Math.max(0, finiteAmount(input.consortiumCommissionRate)),
              ),
          ),
        );
  const marginAmount = expectedEarning - consortiumPayment;
  return {
    quantity,
    totalAmount,
    procurementFee,
    quotationAmount,
    expectedPartnerCommission,
    expectedDirectMargin,
    expectedEarning,
    wizupCommission,
    consortiumPayment,
    marginAmount,
    marginRate: totalAmount > 0 ? marginAmount / totalAmount : 0,
  };
}
