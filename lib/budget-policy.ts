import { getD1 } from "../db";
import {
  calculateEquipmentFinance,
  equipmentSettlementQuantity,
} from "./equipment-finance";
import {
  calculateRegisteredQuote,
  isRegisteredQuoteItemAmount,
} from "./registered-quote";

export type BudgetKind = "purpose" | "self" | "unclassified";
export type BudgetAmountMode = "manual" | "quote_auto";
export type BudgetMatchStatus =
  | "auto"
  | "review"
  | "unclassified"
  | "pending";
export type BudgetMatchMethod =
  | "canonical_exact"
  | "alias_exact"
  | "normalized"
  | "ambiguous"
  | "none"
  | "unknown"
  | "pending"
  | "legacy"
  | "selected"
  | "employee_request"
  | "admin";

export const BUDGET_KIND_VALUES = new Set<BudgetKind>([
  "purpose",
  "self",
  "unclassified",
]);
export const BUDGET_AMOUNT_MODE_VALUES = new Set<BudgetAmountMode>([
  "manual",
  "quote_auto",
]);
export const BUDGET_REQUEST_STATUSES = new Set([
  "pending",
  "hold",
  "rejected",
  "approved",
]);

const excludedAwardStatuses = new Set(["협력사 수주", "타업체 수주"]);
const missingBudgetAmountKeys = new Set([
  "",
  "-",
  "미정",
  "미등록",
  "확인필요",
  "예산미정",
  "금액미정",
  "품목견적미등록",
  "견적미등록",
]);

export function cleanBudgetText(value: unknown, maxLength = 120) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizeBudgetSearchKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s._·/\\()[\]{}'"`~!@#$%^&*+=:;?,<>|-]+/g, "");
}

export function isMeaningfulBudgetAmount(value: unknown) {
  const text = cleanBudgetText(value);
  const key = normalizeBudgetSearchKey(text);
  if (!text || missingBudgetAmountKeys.has(key)) return false;
  return /\d/.test(text);
}

export function meaningfulBudgetAmount(value: unknown) {
  return isMeaningfulBudgetAmount(value) ? cleanBudgetText(value) : "";
}

export function normalizeBudgetKind(
  value: unknown,
  fallback: BudgetKind = "unclassified",
): BudgetKind {
  const requested = cleanBudgetText(value, 40) as BudgetKind;
  return BUDGET_KIND_VALUES.has(requested) ? requested : fallback;
}

export function normalizeBudgetAmountMode(
  value: unknown,
  fallback: BudgetAmountMode = "manual",
): BudgetAmountMode {
  const requested = cleanBudgetText(value, 40) as BudgetAmountMode;
  return BUDGET_AMOUNT_MODE_VALUES.has(requested) ? requested : fallback;
}

export function isBudgetEligibleAwardStatus(value: unknown) {
  return !excludedAwardStatuses.has(cleanBudgetText(value, 40));
}

export function isExcludedBudgetAwardStatus(value: unknown) {
  return excludedAwardStatuses.has(cleanBudgetText(value, 40));
}

function compactCharacterBigrams(value: string) {
  const key = normalizeBudgetSearchKey(value);
  if (key.length < 2) return key ? new Set([key]) : new Set<string>();
  return new Set(
    Array.from({ length: key.length - 1 }, (_, index) =>
      key.slice(index, index + 2),
    ),
  );
}

function similarityScore(leftValue: string, rightValue: string) {
  const left = normalizeBudgetSearchKey(leftValue);
  const right = normalizeBudgetSearchKey(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.includes(right) || right.includes(left)) {
    return 75 + Math.round((Math.min(left.length, right.length) / Math.max(left.length, right.length)) * 15);
  }
  const leftBigrams = compactCharacterBigrams(left);
  const rightBigrams = compactCharacterBigrams(right);
  let intersection = 0;
  leftBigrams.forEach((value) => {
    if (rightBigrams.has(value)) intersection += 1;
  });
  const union = new Set([...leftBigrams, ...rightBigrams]).size;
  return union ? Math.round((intersection / union) * 70) : 0;
}

export function rankBudgetCatalogCandidates(
  query: unknown,
  groups: Array<{
    id: number;
    canonicalName: string;
    budgetKind: BudgetKind;
    amountMode: BudgetAmountMode;
    aliases: Array<{ aliasName: string }>;
  }>,
  limit = 5,
) {
  const requested = cleanBudgetText(query);
  if (!requested) return [];
  return groups
    .map((group) => {
      const compared = [
        { name: group.canonicalName, source: "canonical" },
        ...group.aliases.map((alias) => ({
          name: alias.aliasName,
          source: "alias",
        })),
      ]
        .map((candidate) => ({
          ...candidate,
          score: similarityScore(requested, candidate.name),
        }))
        .sort((left, right) => right.score - left.score)[0];
      return {
        groupId: group.id,
        canonicalName: group.canonicalName,
        budgetKind: group.budgetKind,
        amountMode: group.amountMode,
        matchedName: compared?.name ?? group.canonicalName,
        matchedSource: compared?.source ?? "canonical",
        score: compared?.score ?? 0,
      };
    })
    .filter((candidate) => candidate.score >= 35)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.canonicalName.localeCompare(right.canonicalName, "ko-KR"),
    )
    .slice(0, Math.max(1, Math.min(20, limit)));
}

type D1Database = ReturnType<typeof getD1>;

export async function readRegisteredQuoteForBudget(
  d1: D1Database,
  input: {
    organization: unknown;
    businessRound?: unknown;
    awardStatus?: unknown;
  },
) {
  const organization = cleanBudgetText(input.organization);
  const businessRound = Math.max(
    1,
    Math.min(99, Number(input.businessRound) || 1),
  );
  if (!organization || isExcludedBudgetAwardStatus(input.awardStatus)) {
    return {
      contractAmount: 0,
      quoteStatus: "missing" as const,
      quoteItemCount: 0,
      quoteMissingAmountItemCount: 0,
      quoteConstructionCount: 0,
      excluded: isExcludedBudgetAwardStatus(input.awardStatus),
    };
  }
  const [projects, items] = await Promise.all([
    d1
      .prepare(
        `SELECT p.id, p.construction_amount,
                COALESCE(a.award_status, '미정') AS linked_award_status
         FROM equipment_projects p
         LEFT JOIN activities a ON a.id = p.activity_id
         WHERE p.organization = ? AND p.business_round = ?
         ORDER BY p.id`,
      )
      .bind(organization, businessRound)
      .all<Record<string, unknown>>(),
    d1
      .prepare(
        `SELECT i.*
         FROM equipment_items i
         JOIN equipment_projects p ON p.id = i.project_id
         WHERE p.organization = ? AND p.business_round = ?
         ORDER BY p.id, i.sort_order, i.id`,
      )
      .bind(organization, businessRound)
      .all<Record<string, unknown>>(),
  ]);
  const eligibleProjectIds = new Set(
    projects.results
      .filter((project) =>
        isBudgetEligibleAwardStatus(project.linked_award_status),
      )
      .map((project) => Number(project.id)),
  );
  const quoteItems = items.results
    .filter((item) => eligibleProjectIds.has(Number(item.project_id)))
    .map((item) => {
      const unitPrice =
        item.catalog_unit_price === null ||
        item.catalog_unit_price === undefined ||
        item.catalog_unit_price === ""
          ? null
          : Number(item.catalog_unit_price);
      const finance = calculateEquipmentFinance({
        unitPrice,
        quantity: equipmentSettlementQuantity({
          proposedQty: Number(item.proposed_qty),
          awardedQty: Number(item.awarded_qty),
          installedQty: Number(item.installed_qty),
        }),
        procurementFeeRate:
          item.procurement_fee_rate === null ||
          item.procurement_fee_rate === undefined
            ? null
            : Number(item.procurement_fee_rate),
      });
      return {
        quotationAmount: finance.quotationAmount,
        amountRegistered: isRegisteredQuoteItemAmount({
          priceStatus: cleanBudgetText(item.price_status, 40),
          unitPrice,
          proposedQty: Number(item.proposed_qty),
          awardedQty: Number(item.awarded_qty),
          installedQty: Number(item.installed_qty),
        }),
      };
    });
  const quoteConstructions = projects.results
    .filter((project) => eligibleProjectIds.has(Number(project.id)))
    .map((project) => ({
      quotationAmount: Number(project.construction_amount ?? 0),
      amountRegistered:
        project.construction_amount !== null &&
        project.construction_amount !== undefined &&
        project.construction_amount !== "",
    }));
  return {
    ...calculateRegisteredQuote({
      items: quoteItems,
      constructions: quoteConstructions,
    }),
    excluded: false,
  };
}

export function resolveBudgetAmountPresentation(input: {
  budgetKind: BudgetKind;
  budgetAmountMode: BudgetAmountMode;
  budgetAmount: unknown;
  budgetAmountOverride?: unknown;
  quote: Awaited<ReturnType<typeof readRegisteredQuoteForBudget>>;
}) {
  const budgetAmount = cleanBudgetText(input.budgetAmount);
  const budgetAmountOverride = cleanBudgetText(input.budgetAmountOverride);
  if (
    input.budgetKind === "self" &&
    input.budgetAmountMode === "quote_auto"
  ) {
    return {
      amountSource:
        input.quote.quoteStatus === "missing" ? "missing" : ("auto" as const),
      displayAmount:
        input.quote.quoteStatus === "missing"
          ? ""
          : String(input.quote.contractAmount),
      manualAmount: budgetAmountOverride || budgetAmount,
      ...input.quote,
    };
  }
  return {
    amountSource: "manual" as const,
    displayAmount: budgetAmountOverride || budgetAmount,
    manualAmount: budgetAmountOverride || budgetAmount,
    ...input.quote,
  };
}
