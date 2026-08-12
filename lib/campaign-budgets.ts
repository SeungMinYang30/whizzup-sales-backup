import {
  parseBudgetMoney,
  type ActivityBudgetAllocation,
} from "./activity-budgets.ts";

export type CampaignBudgetCard = {
  id: number;
  budgetType: string;
  budgetGroupId: number | null;
  budgetMatchStatus: string;
  budgetMatchMethod: string;
  budgetRequestId: string | null;
  budgetKind: string;
  budgetAmountMode: string;
  defaultBudgetAmount: number | null;
};

function amountText(value: number | null | undefined) {
  return Number.isFinite(value) && Number(value) > 0
    ? String(Math.round(Number(value)))
    : "";
}

function campaignAmountSource(campaignId: number) {
  return `campaign:${campaignId}`;
}

function sameBudget(
  budget: ActivityBudgetAllocation,
  campaign: CampaignBudgetCard,
) {
  if (campaign.budgetGroupId && budget.budgetGroupId) {
    return campaign.budgetGroupId === budget.budgetGroupId;
  }
  return (
    budget.budgetType.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR") ===
    campaign.budgetType.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ko-KR")
  );
}

export function campaignBudgetAllocation(
  campaign: CampaignBudgetCard,
  institutionAmount: number | null = null,
): ActivityBudgetAllocation {
  const explicitAmount = amountText(institutionAmount);
  const fallbackAmount = amountText(campaign.defaultBudgetAmount);
  const budgetAmount = explicitAmount || fallbackAmount;
  return {
    budgetType: campaign.budgetType,
    budgetAmount,
    budgetOriginalName: campaign.budgetType,
    budgetGroupId: campaign.budgetGroupId,
    budgetMatchStatus: campaign.budgetMatchStatus || "auto",
    budgetMatchMethod: campaign.budgetMatchMethod || "campaign",
    budgetRequestId: campaign.budgetRequestId,
    budgetKind: campaign.budgetKind,
    budgetAmountMode: campaign.budgetAmountMode,
    budgetInstitutionAmount: budgetAmount,
    budgetQuoteAmount: null,
    budgetAmountOverride: explicitAmount,
    budgetAmountSource: explicitAmount
      ? "manual"
      : campaignAmountSource(campaign.id),
  };
}

export function upsertCampaignBudget(
  budgets: ActivityBudgetAllocation[],
  campaign: CampaignBudgetCard,
  institutionAmount: number | null = null,
  options: {
    previousDefaultBudgetAmount?: number | null;
    assumePreviousDefault?: boolean;
  } = {},
) {
  const incoming = campaignBudgetAllocation(campaign, institutionAmount);
  const existingIndex = budgets.findIndex((budget) => sameBudget(budget, campaign));
  if (existingIndex < 0) return [...budgets, incoming];

  const existing = budgets[existingIndex];
  const previousDefault = Number(options.previousDefaultBudgetAmount);
  const existingAmount = parseBudgetMoney(
    existing.budgetAmountOverride ||
      existing.budgetInstitutionAmount ||
      existing.budgetAmount,
  );
  const isCampaignDefault =
    existing.budgetAmountSource === campaignAmountSource(campaign.id) ||
    !existingAmount ||
    (options.assumePreviousDefault === true &&
      Number.isFinite(previousDefault) &&
      previousDefault > 0 &&
      existingAmount === previousDefault);
  const replaceAmount = institutionAmount !== null || isCampaignDefault;
  const updated: ActivityBudgetAllocation = {
    ...existing,
    budgetType: campaign.budgetType,
    budgetOriginalName: existing.budgetOriginalName || campaign.budgetType,
    budgetGroupId: campaign.budgetGroupId,
    budgetMatchStatus: campaign.budgetMatchStatus || existing.budgetMatchStatus,
    budgetMatchMethod: campaign.budgetMatchMethod || existing.budgetMatchMethod,
    budgetRequestId: campaign.budgetRequestId,
    budgetKind: campaign.budgetKind || existing.budgetKind,
    budgetAmountMode: campaign.budgetAmountMode || existing.budgetAmountMode,
    ...(replaceAmount
      ? {
          budgetAmount: incoming.budgetAmount,
          budgetInstitutionAmount: incoming.budgetInstitutionAmount,
          budgetAmountOverride: incoming.budgetAmountOverride,
          budgetAmountSource: incoming.budgetAmountSource,
        }
      : {}),
  };
  return budgets.map((budget, index) => (index === existingIndex ? updated : budget));
}

export function campaignBudgetDisplayAmount(
  budget: ActivityBudgetAllocation | undefined,
  campaign: CampaignBudgetCard,
  storedTargetAmount: number | null,
) {
  const source = budget?.budgetAmountSource || "";
  const activityAmount = parseBudgetMoney(
    budget?.budgetAmountOverride ||
      budget?.budgetInstitutionAmount ||
      budget?.budgetAmount ||
      "",
  );
  const looksLikeLegacyCardDefault =
    campaign.defaultBudgetAmount !== null &&
    campaign.defaultBudgetAmount > 0 &&
    activityAmount === campaign.defaultBudgetAmount &&
    storedTargetAmount === campaign.defaultBudgetAmount;
  if (
    source &&
    source !== campaignAmountSource(campaign.id) &&
    activityAmount > 0 &&
    !looksLikeLegacyCardDefault
  ) {
    return { amount: activityAmount, source: "institution" as const };
  }
  if (
    storedTargetAmount !== null &&
    Number.isFinite(storedTargetAmount) &&
    !looksLikeLegacyCardDefault
  ) {
    return { amount: storedTargetAmount, source: "institution" as const };
  }
  if (campaign.defaultBudgetAmount !== null && campaign.defaultBudgetAmount > 0) {
    return { amount: campaign.defaultBudgetAmount, source: "card-default" as const };
  }
  return { amount: null, source: "missing" as const };
}
