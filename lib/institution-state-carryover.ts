export type InstitutionStateSnapshot = {
  category?: unknown;
  region?: unknown;
  budgetType?: unknown;
  budgetAmount?: unknown;
  status?: unknown;
  temperature?: unknown;
  awardStatus?: unknown;
  awardCompany?: unknown;
  executionType?: unknown;
  consortiumCompany?: unknown;
  awardStage?: unknown;
  progressManager?: unknown;
  followUpRequired?: unknown;
  followUpDate?: unknown;
  nextAction?: unknown;
  progressSchedule?: unknown;
  contactRole?: unknown;
  contactName?: unknown;
  contactPhone?: unknown;
  contactEmail?: unknown;
};

const inheritedTextFields = [
  "category",
  "region",
  "budgetType",
  "budgetAmount",
  "status",
  "temperature",
  "awardStatus",
  "awardCompany",
  "executionType",
  "consortiumCompany",
  "awardStage",
  "progressManager",
  "followUpDate",
  "nextAction",
  "progressSchedule",
  "contactRole",
  "contactName",
  "contactPhone",
  "contactEmail",
] as const satisfies readonly (keyof InstitutionStateSnapshot)[];

const newRecordDefaults: Partial<Record<keyof InstitutionStateSnapshot, unknown>> = {
  category: "학교",
  status: "진행 중",
  temperature: "중간",
  awardStatus: "미정",
  executionType: "직영",
  awardStage: "미정",
  followUpRequired: true,
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hasMeaningfulSnapshotValue(
  key: keyof InstitutionStateSnapshot,
  value: unknown,
) {
  if (key === "followUpRequired") {
    return typeof value === "boolean" || value === 0 || value === 1;
  }
  const normalized = text(value);
  if (!normalized) return false;
  if ((key === "awardStatus" || key === "awardStage") && normalized === "미정") {
    return false;
  }
  return true;
}

/**
 * 최신 기록부터 전달된 행을 합쳐 기관의 마지막 유효 정보를 만듭니다.
 * 최신 행의 빈칸은 더 오래된 기록의 실제 값으로 보완합니다.
 */
export function mergeInstitutionStateSnapshots(
  snapshots: InstitutionStateSnapshot[],
): InstitutionStateSnapshot | null {
  if (!snapshots.length) return null;
  const merged: InstitutionStateSnapshot = {};

  for (const snapshot of snapshots) {
    for (const key of [...inheritedTextFields, "followUpRequired"] as const) {
      if (merged[key] !== undefined) continue;
      const value = snapshot[key];
      if (hasMeaningfulSnapshotValue(key, value)) {
        (merged as Record<string, unknown>)[key] =
          key === "followUpRequired" && typeof value === "number"
            ? value === 1
            : value;
      }
    }
  }

  return Object.keys(merged).length ? merged : null;
}

type InheritanceOptions = {
  /** 새 기록 입력 화면의 초기 선택값도 미입력으로 보고 이전 값으로 바꿉니다. */
  inheritFormDefaults?: boolean;
};

/**
 * 기관 단위로 이어져야 하는 값만 승계합니다.
 * 활동일자, 활동유형, 컨택유형, 주제, 요약, 메모와 기록 출처는 건드리지 않습니다.
 */
export function inheritInstitutionState<T extends object>(
  payload: T,
  snapshot: InstitutionStateSnapshot | null,
  options: InheritanceOptions = {},
) {
  if (!snapshot) return payload;

  const source = payload as Record<string, unknown>;
  const result: Record<string, unknown> = { ...source };

  for (const key of inheritedTextFields) {
    const requested = text(source[key]);
    const defaultValue = newRecordDefaults[key];
    const isFormDefault =
      options.inheritFormDefaults &&
      typeof defaultValue === "string" &&
      requested === defaultValue;
    const isUnspecifiedAwardValue =
      (key === "awardStatus" || key === "awardStage") && requested === "미정";

    if (!requested || isFormDefault || isUnspecifiedAwardValue) {
      const inherited = text(snapshot[key]);
      if (inherited) result[key] = inherited;
    }
  }

  const requestedFollowUp = source.followUpRequired;
  const formFollowUpDefault =
    options.inheritFormDefaults && requestedFollowUp === true;
  if (
    (requestedFollowUp === undefined ||
      requestedFollowUp === null ||
      formFollowUpDefault) &&
    typeof snapshot.followUpRequired === "boolean"
  ) {
    result.followUpRequired = snapshot.followUpRequired;
  }

  const awardStatus = text(result.awardStatus) || "미정";
  result.awardStatus = awardStatus;
  if (awardStatus === "위즈업 수주") {
    result.awardCompany = "위즈업";
  } else if (awardStatus === "미정") {
    result.awardCompany = "";
  }

  const executionType = text(result.executionType) || "직영";
  result.executionType = executionType;
  if (executionType !== "컨소") result.consortiumCompany = "";

  result.awardStage = text(result.awardStage) || "미정";
  return result as T;
}
