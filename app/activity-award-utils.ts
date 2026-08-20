import { canonicalInstitutionName } from "../lib/institution-names";
import { COMPLETED_AWARD_STAGE } from "../lib/sales-taxonomy";

export type ActivityImportValues = {
  activityDate: string;
  dateConfidence: string;
  activityType: string;
  category: string;
  contactMethod: string;
  region: string;
  organization: string;
  businessRound: number;
  budgetType: string;
  budgetAmount: string;
  topic: string;
  summary: string;
  status: string;
  temperature: string;
  awardStatus: string;
  awardCompany: string;
  executionType: string;
  consortiumCompany: string;
  awardStage: string;
  awardCompletedDate: string;
  progressManager: string;
  followUpRequired: boolean;
  followUpDate: string;
  nextAction: string;
  progressSchedule: string;
  contactRole: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  sourceChat: string;
  notes: string;
  address: string;
  installedProducts: string;
};

export type ActivityImportRow = {
  rowNumber: number;
  values: ActivityImportValues;
  errors: string[];
  warnings: string[];
};

export type AwardCompanyRelation = "ours" | "partner" | "other" | "unknown";

export function awardCompanyKey(value: string) {
  return canonicalInstitutionName(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/주식회사|유한회사|합자회사|합명회사|\(주\)|㈜/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

export function classifyAwardCompany(
  company: string,
  registeredPartners: string[],
): AwardCompanyRelation {
  const key = awardCompanyKey(company);
  if (!key) return "unknown";
  if (key === "위즈업" || key === "whizzup" || key === "wizup") return "ours";
  const partnerKeys = new Set(
    registeredPartners.map(awardCompanyKey).filter(Boolean),
  );
  return partnerKeys.has(key) ? "partner" : "other";
}

function mergeTextList(left: string, right: string) {
  const values = `${left}\n${right}`
    .split(/[\n,;|]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)].join(", ");
}

export function applyAwardCompanyToSelectedRows<
  T extends ActivityImportRow & { selected?: boolean; duplicate?: boolean },
>(
  rows: T[],
  company: string,
  mode: "empty" | "overwrite",
) {
  const nextCompany = company.trim();
  let changedCount = 0;
  let overwrittenCount = 0;
  const nextRows = rows.map((row) => {
    if (!row.selected || row.duplicate) return row;
    const currentCompany = row.values.awardCompany.trim();
    if (mode === "empty" && currentCompany) return row;
    if (currentCompany === nextCompany) return row;
    changedCount += 1;
    if (currentCompany) overwrittenCount += 1;
    return {
      ...row,
      values: { ...row.values, awardCompany: nextCompany },
      warnings: row.warnings.filter(
        (warning) => warning !== "수주업체가 없어 수주 구분을 미정으로 저장합니다.",
      ),
    };
  });
  return { rows: nextRows, changedCount, overwrittenCount };
}

export function mergeAwardImportRows<T extends ActivityImportRow>(rows: T[]) {
  const merged = new Map<string, T>();
  let mergedCount = 0;
  for (const sourceRow of rows) {
    const row = {
      ...sourceRow,
      values: { ...sourceRow.values },
      errors: [...sourceRow.errors],
      warnings: [...sourceRow.warnings],
    } as T;
    const key = [
      row.values.activityDate.slice(0, 7),
      awardCompanyKey(row.values.organization),
      Math.max(1, Number(row.values.businessRound) || 1),
      awardCompanyKey(row.values.awardCompany),
    ].join("|");
    const safeKey = row.values.organization.trim() ? key : `row:${row.rowNumber}`;
    const current = merged.get(safeKey);
    if (!current) {
      merged.set(safeKey, row);
      continue;
    }
    mergedCount += 1;
    const installedProducts = mergeTextList(
      current.values.installedProducts,
      row.values.installedProducts,
    );
    const conflictingAmounts =
      Boolean(current.values.budgetAmount) &&
      Boolean(row.values.budgetAmount) &&
      current.values.budgetAmount !== row.values.budgetAmount;
    current.values = {
      ...current.values,
      ...Object.fromEntries(
        Object.entries(row.values).filter(
          ([field, value]) =>
            !String(current.values[field as keyof ActivityImportValues] ?? "").trim() &&
            String(value ?? "").trim(),
        ),
      ),
      installedProducts,
      summary: installedProducts
        ? `${installedProducts} 수주 등록`
        : current.values.summary || row.values.summary,
      notes: mergeTextList(current.values.notes, row.values.notes),
    } as ActivityImportValues;
    current.errors = [...new Set([...current.errors, ...row.errors])];
    current.warnings = [
      ...new Set([
        ...current.warnings,
        ...row.warnings,
        `${row.rowNumber}행의 같은 수주 건을 이 행에 합쳤습니다.`,
        ...(conflictingAmounts
          ? ["같은 수주 건의 금액이 달라 먼저 입력된 금액을 유지했습니다."]
          : []),
      ]),
    ];
    if ("selected" in current || "selected" in row) {
      (current as T & { selected?: boolean }).selected = Boolean(
        (current as T & { selected?: boolean }).selected ||
          (row as T & { selected?: boolean }).selected,
      );
    }
  }
  return { rows: [...merged.values()], mergedCount };
}

export function prepareAwardImportValues(
  values: ActivityImportValues,
  options: { today: string; registeredPartners: string[] },
): ActivityImportValues {
  const relation = classifyAwardCompany(
    values.awardCompany,
    options.registeredPartners,
  );
  const products = values.installedProducts.trim();
  const companyNote =
    relation === "partner"
      ? `수주업체: ${values.awardCompany.trim()} (등록 협력사)`
      : relation === "other"
        ? `수주업체: ${values.awardCompany.trim()}`
        : "";
  return {
    ...values,
    activityDate: values.activityDate || options.today,
    dateConfidence: values.activityDate
      ? values.dateConfidence || "연월 확인"
      : "등록일 기준",
    activityType: "수주",
    contactMethod: "기타",
    topic: products || values.budgetType.trim() || "수주",
    summary:
      values.summary.trim() ||
      (products
        ? `${products} 수주 등록`
        : `${values.organization.trim()} 수주현황 등록`),
    awardStatus:
      relation === "ours"
        ? "위즈업 수주"
        : relation === "partner"
          ? "협력사 수주"
          : relation === "other"
            ? "타업체 수주"
            : "미정",
    awardCompany:
      relation === "ours"
        ? "위즈업"
        : relation === "partner" || relation === "other"
          ? values.awardCompany.trim()
          : "",
    executionType: relation === "other" ? "해당 없음" : "직영",
    consortiumCompany: "",
    awardStage: COMPLETED_AWARD_STAGE,
    awardCompletedDate:
      values.awardCompletedDate || values.activityDate || options.today,
    progressManager: values.progressManager.trim() || "해당 없음",
    sourceChat: "수주 관리 엑셀 등록",
    notes: mergeTextList(values.notes, companyNote),
  };
}
