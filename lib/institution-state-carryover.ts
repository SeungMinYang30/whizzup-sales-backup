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
  awardCompletedDate?: unknown;
  progressManager?: unknown;
  progressManagerLocked?: unknown;
  followUpRequired?: unknown;
  followUpDate?: unknown;
  nextAction?: unknown;
  progressSchedule?: unknown;
  contactRole?: unknown;
  contactName?: unknown;
  contactPhone?: unknown;
  contactEmail?: unknown;
};

export const institutionContactFields = [
  "contactRole",
  "contactName",
  "contactPhone",
  "contactEmail",
] as const satisfies readonly (keyof InstitutionStateSnapshot)[];

export type InstitutionContactField = (typeof institutionContactFields)[number];

export type InstitutionContactSource = InstitutionStateSnapshot & {
  id?: unknown;
  activityDate?: unknown;
  businessRound?: unknown;
};

export type InstitutionContactResolution<TSource extends InstitutionContactSource> = {
  contactRole: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  source: TSource | null;
  inheritedFields: InstitutionContactField[];
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
  "awardCompletedDate",
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
  category: "",
  status: "진행 중",
  temperature: "중간",
  awardStatus: "미정",
  executionType: "직영",
  awardStage: "미정",
  followUpRequired: false,
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedBusinessRound(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function sourceId(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function compareContactSourcesNewest(
  left: InstitutionContactSource,
  right: InstitutionContactSource,
) {
  return (
    String(right.activityDate ?? "").localeCompare(
      String(left.activityDate ?? ""),
    ) || sourceId(right.id) - sourceId(left.id)
  );
}

function hasContactValue(snapshot: InstitutionStateSnapshot) {
  return institutionContactFields.some((field) => text(snapshot[field]));
}

/**
 * 한 기록의 연락처 네 필드를 하나의 세트로 취급합니다.
 *
 * 현재 기록의 값은 그대로 두고, 비어 있는 필드만 같은 사업 차수의 가장
 * 가까운 이전 연락처 기록 한 건에서 가져옵니다. 여러 과거 기록의 이름,
 * 전화번호, 이메일을 필드별로 섞지 않습니다.
 */
export function resolveInstitutionContactSet<
  TSource extends InstitutionContactSource,
>(
  current: TSource,
  institutionHistory: TSource[],
): InstitutionContactResolution<TSource> {
  const currentRound = normalizedBusinessRound(current.businessRound);
  const currentId = sourceId(current.id);
  const sameRoundNewestFirst = institutionHistory
    .filter(
      (snapshot) =>
        normalizedBusinessRound(snapshot.businessRound) === currentRound,
    )
    .sort(compareContactSourcesNewest);
  const currentIndex = sameRoundNewestFirst.findIndex(
    (snapshot) =>
      snapshot === current ||
      (currentId > 0 && sourceId(snapshot.id) === currentId),
  );
  const previousRows =
    currentIndex >= 0
      ? sameRoundNewestFirst.slice(currentIndex + 1)
      : sameRoundNewestFirst.filter(
          (snapshot) => compareContactSourcesNewest(current, snapshot) < 0,
        );
  const source = previousRows.find(hasContactValue) ?? null;
  const inheritedFields: InstitutionContactField[] = [];
  const values = Object.fromEntries(
    institutionContactFields.map((field) => {
      const currentValue = text(current[field]);
      const inheritedValue = source ? text(source[field]) : "";
      if (!currentValue && inheritedValue) inheritedFields.push(field);
      return [field, currentValue || inheritedValue];
    }),
  ) as Record<InstitutionContactField, string>;

  return {
    contactRole: values.contactRole,
    contactName: values.contactName,
    contactPhone: values.contactPhone,
    contactEmail: values.contactEmail,
    source: inheritedFields.length ? source : null,
    inheritedFields,
  };
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
  const contactSource = snapshots.find(hasContactValue);

  if (contactSource) {
    for (const key of institutionContactFields) {
      const value = text(contactSource[key]);
      if (value) (merged as Record<string, unknown>)[key] = value;
    }
  }

  for (const snapshot of snapshots) {
    for (const key of [...inheritedTextFields, "followUpRequired"] as const) {
      if ((institutionContactFields as readonly string[]).includes(key)) {
        continue;
      }
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

  // 재연락 여부와 예정일은 기관의 고정 정보가 아니라 기록별 선택값이다.
  // 새 기록에는 이전 기록의 재연락 상태를 승계하지 않는다.
  result.followUpRequired = source.followUpRequired === true;
  if (!result.followUpRequired) result.followUpDate = "";

  const awardStatus = text(result.awardStatus) || "미정";
  result.awardStatus = awardStatus;
  if (awardStatus === "위즈업 수주") {
    result.awardCompany = "위즈업";
  } else if (awardStatus === "타업체 수주") {
    result.executionType = "해당 없음";
    result.consortiumCompany = "";
    result.awardStage = "해당 없음";
  } else if (awardStatus === "미정") {
    result.awardCompany = "";
  }

  const executionType =
    awardStatus === "타업체 수주"
      ? "해당 없음"
      : text(result.executionType) || "직영";
  result.executionType = executionType;
  if (executionType !== "컨소") result.consortiumCompany = "";

  result.awardStage =
    awardStatus === "타업체 수주"
      ? "해당 없음"
      : text(result.awardStage) || "미정";
  return result as T;
}
