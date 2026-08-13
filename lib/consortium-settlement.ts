import {
  contentSubstitutionBaseEarningRate,
  contentSubstitutionMargin,
  quotationInternalCostDefaults,
  quotationInternalCostKind,
} from "./quotation-internal-costs";

export type InternalCostBearer = "consortium" | "whizzup";

export type ConsortiumSettlementItemInput = {
  name: string;
  specification?: string;
  quantity: number;
  unitPrice: number;
  earningRate: number;
  internalCostBaseEarningRate?: number;
  consortiumRate: number;
  internalCostEnabled?: boolean;
  internalCostAmount?: number;
  internalCostBearer?: InternalCostBearer;
  internalCostQuantity?: number;
  internalCostUnitAmount?: number;
};

export type SettlementAdjustmentType = "addition" | "deduction";

export type ConsortiumSettlementAdjustmentInput = {
  id?: string;
  type: SettlementAdjustmentType;
  label: string;
  amount: number;
  note?: string;
};

export type ConsortiumSettlementAdjustment = ConsortiumSettlementAdjustmentInput & {
  id: string;
  amount: number;
};

export type ConsortiumSettlementItem = {
  name: string;
  lineAmount: number;
  consortiumRate: number;
  grossPayment: number;
};

export type ConsortiumSettlementCost = {
  label: string;
  amount: number;
  bearer: InternalCostBearer;
  consortiumDeduction: number;
  quantity: number;
  unitAmount: number;
};

function safeAmount(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;
}

function resolvedAmount(value: number | undefined, fallback: number) {
  return value === undefined || value === null || !Number.isFinite(Number(value))
    ? safeAmount(fallback)
    : safeAmount(value);
}

function safeRate(value: number | undefined) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value ?? 0)) : 0;
}

export function calculateConsortiumSettlement(
  items: ConsortiumSettlementItemInput[],
  executionType: "직영" | "컨소" = "컨소",
  adjustmentInputs: ConsortiumSettlementAdjustmentInput[] = [],
) {
  const settlementItems: ConsortiumSettlementItem[] = items.map((item) => {
    const lineAmount = Math.round(Math.max(0, item.quantity) * Math.max(0, item.unitPrice));
    const kind = quotationInternalCostKind(item.name, item.specification ?? "");
    const defaults = quotationInternalCostDefaults(item.name, item.specification ?? "", item.quantity);
    const internalCostEnabled = typeof item.internalCostEnabled === "boolean" ? item.internalCostEnabled : defaults.enabled;
    const internalCostAmount = item.internalCostAmount === undefined ? defaults.amount : safeAmount(item.internalCostAmount);
    const earning = kind === "content-substitution" && internalCostEnabled
      ? contentSubstitutionMargin(
          lineAmount,
          internalCostAmount,
          contentSubstitutionBaseEarningRate(item),
        )
      : Math.floor(lineAmount * safeRate(item.earningRate) / 10) * 10;
    const consortiumRate = safeRate(item.consortiumRate);
    const grossPayment = executionType === "컨소" && kind !== "content-substitution"
      ? Math.min(earning, Math.floor(lineAmount * consortiumRate / 10) * 10)
      : 0;
    return { name: item.name, lineAmount, consortiumRate, grossPayment };
  });

  const costs: ConsortiumSettlementCost[] = items.flatMap((item) => {
    const defaults = quotationInternalCostDefaults(item.name, item.specification ?? "", item.quantity);
    const enabled = typeof item.internalCostEnabled === "boolean"
      ? item.internalCostEnabled
      : defaults.enabled;
    if (!enabled) return [];
    const amount = item.internalCostAmount === undefined
      ? defaults.amount
      : safeAmount(item.internalCostAmount);
    if (!amount) return [];
    const bearer = item.internalCostBearer === "consortium" ? "consortium" : "whizzup";
    const kind = quotationInternalCostKind(item.name, item.specification ?? "");
    // 콘텐츠 대체비용은 위즈업 내부 바이패스 계산 기준이며 별도 비용으로 다시 차감하지 않습니다.
    if (kind === "content-substitution") return [];
    const unitAmount = resolvedAmount(item.internalCostUnitAmount, defaults.unitAmount || amount);
    const quantity = kind === "aifit-yoga-mat"
      ? Math.max(1, Math.round(Number(item.internalCostQuantity) || Math.max(1, Math.round(amount / Math.max(1, unitAmount)))))
      : 1;
    return [{
      label: defaults.label || `${item.name} 관련 비용`,
      amount,
      bearer,
      consortiumDeduction: executionType === "컨소" && bearer === "consortium" ? amount : 0,
      quantity,
      unitAmount,
    }];
  });

  const adjustments: ConsortiumSettlementAdjustment[] = adjustmentInputs.slice(0, 50).flatMap((entry, index) => {
    const label = String(entry?.label ?? "").trim().slice(0, 200);
    const amount = safeAmount(entry?.amount);
    if (!label || !amount) return [];
    return [{
      id: String(entry.id ?? "").trim().slice(0, 120) || `adjustment-${index + 1}`,
      type: entry.type === "addition" ? "addition" : "deduction",
      label,
      amount,
      note: String(entry.note ?? "").trim().slice(0, 500),
    }];
  });

  const grossPayment = settlementItems.reduce((sum, item) => sum + item.grossPayment, 0);
  const consortiumCost = costs.reduce((sum, cost) => sum + cost.consortiumDeduction, 0);
  const whizzupCost = costs.reduce(
    (sum, cost) => sum + (executionType !== "컨소" || cost.bearer === "whizzup" ? cost.amount : 0),
    0,
  );
  const adjustmentAdditions = adjustments.reduce((sum, item) => sum + (item.type === "addition" ? item.amount : 0), 0);
  const adjustmentDeductions = adjustments.reduce((sum, item) => sum + (item.type === "deduction" ? item.amount : 0), 0);
  // 대체 공사·교체 비용이 기본 정산액보다 큰 경우에는 다음 정산에서
  // 상계할 금액을 음수로 그대로 보여줘야 하므로 0으로 제한하지 않는다.
  const finalPayment = grossPayment - consortiumCost - adjustmentDeductions + adjustmentAdditions;
  return {
    items: settlementItems,
    costs,
    adjustments,
    grossPayment,
    consortiumCost,
    whizzupCost,
    adjustmentAdditions,
    adjustmentDeductions,
    finalPayment,
  };
}
