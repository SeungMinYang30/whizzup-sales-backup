export type EquipmentExecutionType = "직영" | "컨소";
export type CommissionInputType = "rate" | "amount";

export type EquipmentFinanceInput = {
  unitPrice: number | null;
  quantity?: number;
  executionType?: string;
  commissionInputType?: string;
  commissionRate?: number | null;
  consortiumCommissionRate?: number | null;
  consortiumPaymentAmount?: number | null;
};

export type EquipmentFinanceResult = {
  quantity: number;
  totalAmount: number;
  wizupCommission: number;
  consortiumPayment: number;
  marginAmount: number;
  marginRate: number;
};

function finiteAmount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
  const unitPrice = Math.max(0, Math.round(finiteAmount(input.unitPrice)));
  const quantity = Math.max(1, Math.round(finiteAmount(input.quantity) || 1));
  const totalAmount = unitPrice * quantity;
  const wizupCommission = Math.min(
    totalAmount,
    Math.round(
      totalAmount * Math.min(1, Math.max(0, finiteAmount(input.commissionRate))),
    ),
  );
  if (input.executionType !== "컨소" || totalAmount === 0) {
    return {
      quantity,
      totalAmount,
      wizupCommission,
      consortiumPayment: 0,
      marginAmount: wizupCommission,
      marginRate: totalAmount > 0 ? wizupCommission / totalAmount : 0,
    };
  }

  const consortiumPayment =
    input.commissionInputType === "amount"
      ? Math.min(
          wizupCommission,
          Math.max(0, Math.round(finiteAmount(input.consortiumPaymentAmount))),
        )
      : Math.min(
          wizupCommission,
          Math.round(
            totalAmount *
              Math.min(
                1,
                Math.max(0, finiteAmount(input.consortiumCommissionRate)),
              ),
          ),
        );
  const marginAmount = wizupCommission - consortiumPayment;
  return {
    quantity,
    totalAmount,
    wizupCommission,
    consortiumPayment,
    marginAmount,
    marginRate: totalAmount > 0 ? marginAmount / totalAmount : 0,
  };
}
