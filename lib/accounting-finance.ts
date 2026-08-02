export type AccountingFlowInput = {
  executionType: string;
  manufacturerCommissionExpected: number;
  manufacturerCommissionReceived: number;
  consortiumPaymentExpected: number;
  consortiumPaymentPaid: number;
  otherCost: number;
};

export function calculateAccountingFlow(input: AccountingFlowInput) {
  const amount = (value: number) =>
    Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const manufacturerCommissionExpected = amount(
    input.manufacturerCommissionExpected,
  );
  const manufacturerCommissionReceived = amount(
    input.manufacturerCommissionReceived,
  );
  const consortium = input.executionType === "컨소";
  const consortiumPaymentExpected = consortium
    ? amount(input.consortiumPaymentExpected)
    : 0;
  const consortiumPaymentPaid = consortium
    ? amount(input.consortiumPaymentPaid)
    : 0;
  const otherCost = amount(input.otherCost);

  return {
    manufacturerCommissionExpected,
    manufacturerCommissionReceived,
    commissionReceivable: Math.max(
      0,
      manufacturerCommissionExpected - manufacturerCommissionReceived,
    ),
    consortiumPaymentExpected,
    consortiumPaymentPaid,
    consortiumPayable: Math.max(
      0,
      consortiumPaymentExpected - consortiumPaymentPaid,
    ),
    otherCost,
    netRevenue:
      manufacturerCommissionExpected - consortiumPaymentExpected - otherCost,
  };
}
