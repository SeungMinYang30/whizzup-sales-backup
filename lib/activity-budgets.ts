export type ActivityBudgetAllocation = {
  budgetType: string;
  budgetAmount: string;
  budgetOriginalName: string;
  budgetGroupId: number | null;
  budgetMatchStatus: string;
  budgetMatchMethod: string;
  budgetRequestId: string | null;
  budgetKind: string;
  budgetAmountMode: string;
  budgetInstitutionAmount: string;
  budgetQuoteAmount: number | null;
  budgetAmountOverride: string;
  budgetAmountSource: string;
};

export function emptyActivityBudget(): ActivityBudgetAllocation {
  return {
    budgetType: "",
    budgetAmount: "",
    budgetOriginalName: "",
    budgetGroupId: null,
    budgetMatchStatus: "unclassified",
    budgetMatchMethod: "blank",
    budgetRequestId: null,
    budgetKind: "",
    budgetAmountMode: "",
    budgetInstitutionAmount: "",
    budgetQuoteAmount: null,
    budgetAmountOverride: "",
    budgetAmountSource: "missing",
  };
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nullableAmount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeActivityBudget(
  input: Record<string, unknown>,
): ActivityBudgetAllocation {
  const value = (camel: string, snake: string) =>
    input[camel] ?? input[snake];
  const budgetType = text(value("budgetType", "budget_type"));
  const budgetAmount = text(value("budgetAmount", "budget_amount"));
  return {
    budgetType,
    budgetAmount,
    budgetOriginalName:
      text(value("budgetOriginalName", "budget_original_name")) ||
      budgetType,
    budgetGroupId: positiveInteger(
      value("budgetGroupId", "budget_group_id"),
    ),
    budgetMatchStatus:
      text(value("budgetMatchStatus", "budget_match_status")) ||
      "unclassified",
    budgetMatchMethod:
      text(value("budgetMatchMethod", "budget_match_method")) || "legacy",
    budgetRequestId:
      text(value("budgetRequestId", "budget_request_id")) || null,
    budgetKind: text(value("budgetKind", "budget_kind")),
    budgetAmountMode: text(value("budgetAmountMode", "budget_amount_mode")),
    budgetInstitutionAmount:
      text(value("budgetInstitutionAmount", "budget_institution_amount")) ||
      budgetAmount,
    budgetQuoteAmount: nullableAmount(
      value("budgetQuoteAmount", "budget_quote_amount"),
    ),
    budgetAmountOverride: text(
      value("budgetAmountOverride", "budget_amount_override"),
    ),
    budgetAmountSource:
      text(value("budgetAmountSource", "budget_amount_source")) ||
      (budgetAmount ? "manual" : "missing"),
  };
}

function parsedBudgetArray(value: unknown): Record<string, unknown>[] {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      source = [];
    }
  }
  return Array.isArray(source)
    ? source.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry && typeof entry === "object"),
      )
    : [];
}

function budgetIdentity(value: ActivityBudgetAllocation) {
  return value.budgetGroupId
    ? `group:${value.budgetGroupId}`
    : `name:${(value.budgetOriginalName || value.budgetType)
        .normalize("NFKC")
        .toLocaleLowerCase("ko-KR")
        .replace(/\s+/g, "")}`;
}

export function activityBudgetsFromRecord(
  record: Record<string, unknown>,
): ActivityBudgetAllocation[] {
  const stored = parsedBudgetArray(
    record.budgets ?? record.budgetsJson ?? record.budgets_json,
  ).map(normalizeActivityBudget);
  const primary = normalizeActivityBudget(record);
  const primaryHasValue = Boolean(
    primary.budgetType ||
      primary.budgetOriginalName ||
      primary.budgetAmount ||
      primary.budgetGroupId,
  );
  const merged = primaryHasValue ? [primary, ...stored] : stored;
  const seen = new Set<string>();
  return merged.filter((budget) => {
    const hasValue = Boolean(
      budget.budgetType ||
        budget.budgetOriginalName ||
        budget.budgetAmount ||
        budget.budgetGroupId,
    );
    if (!hasValue) return false;
    const key = budgetIdentity(budget);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function serializeActivityBudgets(
  budgets: ActivityBudgetAllocation[],
) {
  return JSON.stringify(budgets.slice(0, 10));
}

/**
 * 같은 기관·사업 차수의 기록은 하나의 예산 묶음을 공유합니다.
 *
 * 행은 최신순으로 전달합니다. 과거에 사용자가 복수 예산을 확정한 뒤
 * AI가 단일 예산만 제안한 기록이 추가되어도 그 확정값을 잃지 않도록,
 * 복수 예산 스냅샷이 있으면 가장 최신 스냅샷을 우선합니다. 복수 예산이
 * 없을 때만 가장 최신의 유효한 단일 예산을 사용합니다.
 */
export function canonicalBusinessRoundBudgets(
  newestFirstRecords: Record<string, unknown>[],
) {
  const candidates = newestFirstRecords
    .map((record) => activityBudgetsFromRecord(record))
    .filter((budgets) => budgets.length > 0);
  return (
    candidates.find((budgets) => budgets.length > 1) ??
    candidates[0] ??
    []
  ).map((budget) => ({ ...budget }));
}

export function sameActivityBudgets(
  left: ActivityBudgetAllocation[],
  right: ActivityBudgetAllocation[],
) {
  return serializeActivityBudgets(left) === serializeActivityBudgets(right);
}

export function primaryBudgetFields(
  budgets: ActivityBudgetAllocation[],
) {
  return budgets[0] ?? emptyActivityBudget();
}

export function parseBudgetMoney(value: unknown) {
  const normalized = String(value ?? "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");
  const unitAmount = (unit: string, multiplier: number) => {
    const match = normalized.match(new RegExp(`([\\d.]+)${unit}`));
    const amount = Number.parseFloat(match?.[1] ?? "");
    return Number.isFinite(amount) && amount > 0
      ? amount * multiplier
      : 0;
  };
  const combined =
    unitAmount("억", 100_000_000) +
    unitAmount("만", 10_000) +
    unitAmount("천", 1_000);
  if (combined > 0) return Math.round(combined);
  const number = Number.parseFloat(normalized.replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

export function summarizeActivityBudgets(
  budgets: ActivityBudgetAllocation[],
) {
  const names = budgets
    .map((budget) => text(budget.budgetType || budget.budgetOriginalName))
    .filter((name, index, values) => Boolean(name) && values.indexOf(name) === index);
  let totalAmount = 0;
  let enteredAmountCount = 0;

  for (const budget of budgets) {
    const amount = parseBudgetMoney(
      budget.budgetAmountOverride ||
        budget.budgetInstitutionAmount ||
        budget.budgetAmount,
    );
    if (amount > 0) {
      totalAmount += amount;
      enteredAmountCount += 1;
    }
  }

  return {
    names,
    totalAmount,
    enteredAmountCount,
    missingAmountCount: Math.max(0, budgets.length - enteredAmountCount),
  };
}
