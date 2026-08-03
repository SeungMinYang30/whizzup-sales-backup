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

/**
 * 과거 영업 기록의 금액 입력은 단위 없는 1,000,000 미만 숫자를
 * `만원` 단위로 저장했습니다. 이 규칙은 일반 금액 입력에는 적용하지 않고,
 * 이미 저장된 활동 기록을 원 단위 데이터로 옮길 때만 사용합니다.
 */
export function parseStoredActivityBudgetMoney(value: unknown) {
  const source = String(value ?? "").trim();
  if (!source || source === "미정") return 0;
  const normalized = source.replace(/,/g, "").replace(/\s+/g, "");
  const parseKoreanPart = (part: string) => {
    const direct = Number(part);
    if (Number.isFinite(direct)) return direct;
    let total = 0;
    let remainder = part;
    (["천", "백", "십"] as const).forEach((unit) => {
      const multiplier = unit === "천" ? 1_000 : unit === "백" ? 100 : 10;
      const matched = remainder.match(
        new RegExp(`(\\d+(?:\\.\\d+)?)${unit}`),
      );
      if (!matched) return;
      total += Number(matched[1]) * multiplier;
      remainder = remainder.replace(matched[0], "");
    });
    const plain = Number(remainder);
    return total + (Number.isFinite(plain) ? plain : 0);
  };
  let remainder = normalized.replace(/원/g, "");
  let total = 0;
  let hasLargeUnit = false;
  const eok = remainder.match(/^(.+?)억/);
  if (eok) {
    total += parseKoreanPart(eok[1]) * 100_000_000;
    remainder = remainder.slice(eok[0].length);
    hasLargeUnit = true;
  }
  const man = remainder.match(/^(.+?)만/);
  if (man) {
    total += parseKoreanPart(man[1]) * 10_000;
    remainder = remainder.slice(man[0].length);
    hasLargeUnit = true;
  }
  if (hasLargeUnit) return Math.round(total);
  const parsed = Number(remainder.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  if (/원/.test(normalized)) return Math.round(parsed);
  return parsed < 1_000_000 ? Math.round(parsed * 10_000) : Math.round(parsed);
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
