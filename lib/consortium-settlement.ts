import { quotationInternalCostDefaults } from "./quotation-internal-costs";

export type InternalCostBearer = "consortium" | "whizzup";

export type ConsortiumSettlementItemInput = {
  name: string;
  specification?: string;
  quantity: number;
  unitPrice: number;
  earningRate: number;
  consortiumRate: number;
  internalCostEnabled?: boolean;
  internalCostAmount?: number;
  internalCostBearer?: InternalCostBearer;
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
};

function safeAmount(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value ?? 0)) : 0;
}

function safeRate(value: number | undefined) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value ?? 0)) : 0;
}

export function calculateConsortiumSettlement(
  items: ConsortiumSettlementItemInput[],
  executionType: "직영" | "컨소" = "컨소",
) {
  const settlementItems: ConsortiumSettlementItem[] = items.map((item) => {
    const lineAmount = Math.round(Math.max(0, item.quantity) * Math.max(0, item.unitPrice));
    const earning = Math.floor(lineAmount * safeRate(item.earningRate) / 10) * 10;
    const consortiumRate = safeRate(item.consortiumRate);
    const grossPayment = executionType === "컨소"
      ? Math.min(earning, Math.floor(lineAmount * consortiumRate / 10) * 10)
      : 0;
    return { name: item.name, lineAmount, consortiumRate, grossPayment };
  });

  const costs: ConsortiumSettlementCost[] = items.flatMap((item) => {
    const defaults = quotationInternalCostDefaults(item.name, item.specification ?? "");
    const enabled = typeof item.internalCostEnabled === "boolean"
      ? item.internalCostEnabled
      : defaults.enabled;
    if (!enabled) return [];
    const amount = item.internalCostAmount === undefined
      ? defaults.amount
      : safeAmount(item.internalCostAmount);
    if (!amount) return [];
    const bearer = item.internalCostBearer === "consortium" ? "consortium" : "whizzup";
    return [{
      label: defaults.label || `${item.name} 관련 비용`,
      amount,
      bearer,
      consortiumDeduction: executionType === "컨소" && bearer === "consortium" ? amount : 0,
    }];
  });

  const grossPayment = settlementItems.reduce((sum, item) => sum + item.grossPayment, 0);
  const consortiumCost = costs.reduce((sum, cost) => sum + cost.consortiumDeduction, 0);
  const whizzupCost = costs.reduce(
    (sum, cost) => sum + (executionType !== "컨소" || cost.bearer === "whizzup" ? cost.amount : 0),
    0,
  );
  const finalPayment = Math.max(0, grossPayment - consortiumCost);
  return { items: settlementItems, costs, grossPayment, consortiumCost, whizzupCost, finalPayment };
}
