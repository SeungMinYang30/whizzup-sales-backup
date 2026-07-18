"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import SalesMapPage from "./sales-map";

type Activity = {
  id: number;
  activityDate: string;
  dateConfidence: string;
  activityType: string;
  category: string;
  contactMethod: string;
  region: string;
  organization: string;
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
  progressManager: string;
  followUpRequired: boolean;
  followUpDate: string;
  nextAction: string;
  progressSchedule: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  sourceChat: string;
  notes: string;
  createdByName: string;
};

type FormState = Omit<Activity, "id" | "createdByName">;
type EquipmentItemDraft = {
  productName: string;
  specification: string;
  proposedQty: number;
  awardedQty: number;
  installedQty: number;
  unit: string;
  status: string;
  notes: string;
};
type AiPreview = FormState & {
  equipmentProjectName: string;
  equipmentProjectStatus: string;
  equipmentItems: EquipmentItemDraft[];
};
type EquipmentItem = EquipmentItemDraft & {
  id: number;
  projectId: number;
};
type EquipmentProject = {
  id: number;
  organization: string;
  name: string;
  status: string;
  budgetType: string;
  notes: string;
  createdByName: string;
  items: EquipmentItem[];
};
type View =
  | "dashboard"
  | "records"
  | "followup"
  | "schedules"
  | "organizations"
  | "awards"
  | "map"
  | "team"
  | "integration";

type ViewHistoryState = {
  whizzupView?: View;
  whizzupRecordDateScope?: "all" | "recent";
  whizzupActiveAwardsOnly?: boolean;
  whizzupFollowupDueSoonOnly?: boolean;
};

type SessionMember = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "assistant" | "member";
  permissions: MemberPermission[];
  status: "pending" | "approved" | "suspended";
};

type SessionPayload = {
  member: SessionMember;
  pendingCount: number;
  approvedCount: number;
  sharedGptUrl: string;
  aiConfigured: boolean;
  aiModel: string;
};

type AiChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type AiOrganizePayload = {
  needsClarification?: boolean;
  assistantMessage?: string;
  draft?: Partial<AiPreview>;
  drafts?: Partial<AiPreview>[];
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  error?: string;
  code?: string;
};

type TeamMember = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "assistant" | "member";
  permissions: MemberPermission[];
  status: "pending" | "approved" | "suspended";
  createdAt: string;
  lastSeenAt: string;
};

type MemberPermission =
  | "members:manage"
  | "records:manage"
  | "map:manage"
  | "data:export";

const memberPermissionOptions: {
  id: MemberPermission;
  label: string;
  description: string;
}[] = [
  {
    id: "members:manage",
    label: "구성원 승인",
    description: "일반 구성원 승인·중지·이름 변경",
  },
  {
    id: "records:manage",
    label: "팀 기록 관리",
    description: "전체 이력·기관 보기·기록 삭제",
  },
  {
    id: "map:manage",
    label: "지도 관리",
    description: "영업 카테고리·기관 위치 관리",
  },
  {
    id: "data:export",
    label: "자료 내보내기",
    description: "전체 영업 자료 CSV 저장",
  },
];

function normalizeMemberPermissions(value: unknown): MemberPermission[] {
  let source: unknown = value;
  if (typeof value === "string") {
    try {
      source = JSON.parse(value);
    } catch {
      source = [];
    }
  }
  if (!Array.isArray(source)) return [];
  return memberPermissionOptions
    .map((option) => option.id)
    .filter((permission) => source.includes(permission));
}

function memberCan(
  member: Pick<SessionMember, "role" | "permissions">,
  permission: MemberPermission,
) {
  return (
    member.role === "admin" ||
    (member.role === "assistant" && member.permissions.includes(permission))
  );
}

const emptyForm: FormState = {
  activityDate: new Date().toISOString().slice(0, 10),
  dateConfidence: "확정",
  activityType: "TM·통화",
  category: "학교",
  contactMethod: "유선",
  region: "",
  organization: "",
  budgetType: "",
  budgetAmount: "",
  topic: "",
  summary: "",
  status: "진행 중",
  temperature: "중간",
  awardStatus: "미정",
  awardCompany: "",
  executionType: "미정",
  consortiumCompany: "",
  awardStage: "미정",
  progressManager: "",
  followUpRequired: true,
  followUpDate: "",
  nextAction: "",
  progressSchedule: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  sourceChat: "직접 입력",
  notes: "",
};

const navItems: { id: View; label: string; mark: string }[] = [
  { id: "dashboard", label: "대시보드", mark: "D" },
  { id: "followup", label: "기관별 관리", mark: "F" },
  { id: "awards", label: "수주 관리", mark: "W" },
  { id: "map", label: "영업·수주 지도", mark: "M" },
];

const statusOptions = [
  "재접촉 필요",
  "진행 중",
  "결과 확인",
  "후속 완료",
  "장기 추적",
  "대기",
  "완료",
];

const awardStageOptions = [
  "미정",
  "품의",
  "협상",
  "계약",
  "일정 조율",
  "완공",
  "검수",
  "교육",
];

const completedAwardStages = new Set(["완공"]);
const equipmentProjectStatuses = [
  "제안",
  "견적",
  "수주",
  "발주",
  "설치 중",
  "설치 완료",
  "보류",
  "취소",
];
const equipmentItemStatuses = [
  "제안",
  "견적",
  "수주",
  "발주",
  "설치 중",
  "설치 완료",
  "미수주",
  "취소",
];
const availableViews = new Set<View>([
  "dashboard",
  "records",
  "followup",
  "schedules",
  "organizations",
  "awards",
  "map",
  "team",
  "integration",
]);

const typeOptions = [
  "TM",
  "TM·통화",
  "영업 대상",
  "학교 미팅",
  "학교 진행 중",
  "기관 미팅",
  "협력사 미팅",
  "방문 미팅",
  "업무 통화",
  "제품 통화",
  "계약 통화",
  "수주",
  "AS 통화",
  "기타",
];

const gptInstructions = `당신은 위즈업의 TM·미팅 기록 정리 도우미입니다.
사용자가 입력한 내용을 기관명, 날짜, 컨택 유형, 지역, 예산종류, 예산금액, 활동유형, 주제, 핵심요약, 관심도, 다음행동, 재연락일, 수주 결과로 구조화하세요.
컨택 유형은 전화·TM이면 “유선”, 직접 찾아가거나 대면 미팅이면 “방문”, 화상 미팅이면 “온라인”으로 정리하세요.
수주 후 공사·설치·교육 일정이나 진행 상황을 기관·학교에 전달하고 공유한 기록이면 “진행 공유”로 정리하세요.
예산의 출처나 종류는 budgetType에, 금액은 사용자가 말한 단위까지 포함해 budgetAmount에 저장하세요. 모르면 빈 값으로 두세요.
학교 관련 영업이 계속 진행 중인 기록의 활동유형은 “학교 진행 중”을 사용하세요.
수주 후 진행 중인 학교·기관에서 “목공 6/17, 시스템 6/19”처럼 여러 일정을 말하면 progressSchedule 배열에 빠짐없이 나누어 저장하세요. label은 목공·시스템처럼 짧게 쓰고 date는 현재 연도를 기준으로 YYYY-MM-DD 형식으로 정리하세요.
수주 결과는 미정, 위즈업 수주, 타업체 수주 중 하나입니다. 타업체 수주라면 실제 수주 업체명을 반드시 확인하세요.
수주 건의 사업방식은 미정, 직영, 컨소 중 하나이며 컨소라면 함께하는 업체명을 확인하세요.
수주 건의 현재 상태는 미정, 품의, 협상, 계약, 일정 조율, 완공, 검수, 교육 중 하나로 정리하세요.
기관 담당자와 기관 메일은 contactName과 contactEmail에, 수주 후 진행을 맡는 사람은 progressManager에 정리하세요.
정보가 꼭 필요한데 빠졌을 때만 짧게 한 번 질문하세요.
저장하기 전에는 반드시 정리된 내용을 사용자에게 보여주고 “이대로 저장할까요?”라고 확인하세요.
사용자가 명시적으로 승인한 경우에만 createActivityRecord 액션을 호출하세요.
추측한 정보는 확정 사실처럼 기록하지 말고 날짜나 수주 결과를 모르면 빈 값 또는 미정으로 두세요.
저장 후에는 기관명, 다음 행동, 수주 업체, 현재 상태를 짧게 다시 알려주세요.`;

function normalize(row: Record<string, unknown>): Activity {
  const value = (camel: string, snake: string) => row[camel] ?? row[snake] ?? "";
  return {
    id: Number(row.id),
    activityDate: String(value("activityDate", "activity_date")),
    dateConfidence: String(value("dateConfidence", "date_confidence")),
    activityType: String(value("activityType", "activity_type")),
    category: String(row.category ?? ""),
    contactMethod: String(value("contactMethod", "contact_method")),
    region: String(row.region ?? ""),
    organization: String(row.organization ?? ""),
    budgetType: String(value("budgetType", "budget_type")),
    budgetAmount: formatMoneyInput(
      String(value("budgetAmount", "budget_amount")),
    ),
    topic: String(row.topic ?? ""),
    summary: String(row.summary ?? ""),
    status: String(row.status ?? ""),
    temperature: String(row.temperature ?? ""),
    awardStatus: String(value("awardStatus", "award_status")) || "미정",
    awardCompany: String(value("awardCompany", "award_company")),
    executionType: String(value("executionType", "execution_type")) || "미정",
    consortiumCompany: String(
      value("consortiumCompany", "consortium_company"),
    ),
    awardStage: String(value("awardStage", "award_stage")) || "미정",
    progressManager: String(value("progressManager", "progress_manager")),
    followUpRequired: Boolean(Number(value("followUpRequired", "follow_up_required"))),
    followUpDate: String(value("followUpDate", "follow_up_date")),
    nextAction: String(value("nextAction", "next_action")),
    progressSchedule: String(value("progressSchedule", "progress_schedule")),
    contactName: String(value("contactName", "contact_name")),
    contactPhone: String(value("contactPhone", "contact_phone")),
    contactEmail: String(value("contactEmail", "contact_email")),
    sourceChat: String(value("sourceChat", "source_chat")),
    notes: String(row.notes ?? ""),
    createdByName: String(value("createdByName", "created_by_name")) || "가져온 기록",
  };
}

function normalizeEquipmentItem(
  row: Record<string, unknown>,
): EquipmentItem {
  const value = (camel: string, snake: string) => row[camel] ?? row[snake] ?? "";
  return {
    id: Number(row.id),
    projectId: Number(value("projectId", "project_id")),
    productName: String(value("productName", "product_name")),
    specification: String(row.specification ?? ""),
    proposedQty: Number(value("proposedQty", "proposed_qty")) || 0,
    awardedQty: Number(value("awardedQty", "awarded_qty")) || 0,
    installedQty: Number(value("installedQty", "installed_qty")) || 0,
    unit: String(row.unit ?? "") || "대",
    status: String(row.status ?? "") || "제안",
    notes: String(row.notes ?? ""),
  };
}

function normalizeEquipmentProject(
  row: Record<string, unknown>,
): EquipmentProject {
  const value = (camel: string, snake: string) => row[camel] ?? row[snake] ?? "";
  const organization = String(row.organization ?? "");
  const rawName = String(row.name ?? "");
  const notes = String(row.notes ?? "");
  const nameWithoutYear = rawName.replace(/^\d{4}\s+/, "");
  const generatedNames = new Set([
    `${organization} 공사·설치`,
    `${organization} 공사 설치`,
    `${organization} 제안·수주`,
  ]);
  const displayName =
    notes.includes("AI 기록에서 자동 생성") &&
    (generatedNames.has(rawName) ||
      nameWithoutYear === `${organization} 제안·수주`)
      ? ""
      : rawName;
  return {
    id: Number(row.id),
    organization,
    name: displayName,
    status: String(row.status ?? "") || "제안",
    budgetType: String(value("budgetType", "budget_type")),
    notes,
    createdByName: String(value("createdByName", "created_by_name")) || "등록자",
    items: Array.isArray(row.items)
      ? row.items.map((item) =>
          normalizeEquipmentItem(item as Record<string, unknown>),
        )
      : [],
  };
}

function cleanAiEquipmentItems(value: unknown): EquipmentItemDraft[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 100)
    .map((item) => {
      const row =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      return {
        productName: String(row.productName ?? "").trim(),
        specification: String(row.specification ?? "").trim(),
        proposedQty: Math.max(0, Number(row.proposedQty) || 0),
        awardedQty: Math.max(0, Number(row.awardedQty) || 0),
        installedQty: Math.max(0, Number(row.installedQty) || 0),
        unit: String(row.unit ?? "").trim() || "대",
        status: String(row.status ?? "").trim() || "제안",
        notes: String(row.notes ?? "").trim(),
      };
    })
    .filter((item) => item.productName);
}

function normalizeAiDraft(draft: Partial<AiPreview> | undefined): AiPreview {
  return {
    ...emptyForm,
    ...draft,
    budgetAmount: formatMoneyInput(String(draft?.budgetAmount ?? "")),
    followUpRequired:
      typeof draft?.followUpRequired === "boolean"
        ? draft.followUpRequired
        : emptyForm.followUpRequired,
    progressSchedule: String(draft?.progressSchedule ?? ""),
    equipmentProjectName: String(draft?.equipmentProjectName ?? "").trim(),
    equipmentProjectStatus:
      String(draft?.equipmentProjectStatus ?? "").trim() || "제안",
    equipmentItems: cleanAiEquipmentItems(draft?.equipmentItems),
    sourceChat: "사이트 AI 입력",
  };
}

function formatDate(value: string) {
  if (!value) return "날짜 미상";
  const parts = value.split("-");
  if (parts.length === 2) return `${parts[0]}.${parts[1]}`;
  if (parts.length === 3) return `${parts[0]}.${parts[1]}.${parts[2]}`;
  return value;
}

function formatMoneyInput(value: string) {
  return value.replace(/\d[\d,]*/g, (number) => {
    const digits = number.replaceAll(",", "");
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  });
}

function parseKoreanNumber(value: string) {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;

  let total = 0;
  let remainder = value;
  const units = [
    ["천", 1_000],
    ["백", 100],
    ["십", 10],
  ] as const;

  units.forEach(([label, multiplier]) => {
    const matched = remainder.match(new RegExp(`(\\d+(?:\\.\\d+)?)${label}`));
    if (!matched) return;
    total += Number(matched[1]) * multiplier;
    remainder = remainder.replace(matched[0], "");
  });

  const plain = Number(remainder);
  return total + (Number.isFinite(plain) ? plain : 0);
}

function parseMoneyAmount(value: string) {
  let remainder = value.replaceAll(",", "").replace(/\s+/g, "").replace(/원/g, "");
  let total = 0;
  let hasUnit = false;
  const eok = remainder.match(/^(.+?)억/);
  if (eok) {
    total += parseKoreanNumber(eok[1]) * 100_000_000;
    remainder = remainder.slice(eok[0].length);
    hasUnit = true;
  }
  const man = remainder.match(/^(.+?)만/);
  if (man) {
    total += parseKoreanNumber(man[1]) * 10_000;
    remainder = remainder.slice(man[0].length);
    hasUnit = true;
  }
  if (hasUnit) return total;

  const numeric = Number(remainder.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function toLocalDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type ProgressScheduleItem = {
  label: string;
  date: string;
};

function parseProgressSchedule(value: string): ProgressScheduleItem[] {
  const currentYear = new Date().getFullYear();
  const datePattern =
    /(?:(\d{4})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})|(\d{1,2})\s*(?:[./]|월)\s*(\d{1,2}))\s*일?/g;
  const items: ProgressScheduleItem[] = [];
  let cursor = 0;
  let matched: RegExpExecArray | null;

  while ((matched = datePattern.exec(value)) !== null) {
    const label =
      value
        .slice(cursor, matched.index)
        .replace(/^[\s,;|:/-]+|[\s,;|:/-]+$/g, "")
        .trim() || "진행";
    const year = Number(matched[1] || currentYear);
    const month = Number(matched[2] || matched[4]);
    const day = Number(matched[3] || matched[5]);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    cursor = matched.index + matched[0].length;

    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() !== month - 1 ||
      candidate.getUTCDate() !== day
    ) {
      continue;
    }

    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (
      !items.some(
        (item) => item.label === label && item.date === date,
      )
    ) {
      items.push({ label, date });
    }
  }

  return items;
}

function mergeEquipmentDrafts(
  ...groups: EquipmentItemDraft[][]
): EquipmentItemDraft[] {
  const items = new Map<string, EquipmentItemDraft>();
  groups.flat().forEach((item) => {
    const key = `${item.productName}|${item.specification}`
      .replace(/\s+/g, "")
      .toLocaleLowerCase("ko-KR");
    const existing = items.get(key);
    items.set(
      key,
      existing
        ? {
            ...existing,
            proposedQty: Math.max(existing.proposedQty, item.proposedQty),
            awardedQty: Math.max(existing.awardedQty, item.awardedQty),
            installedQty: Math.max(existing.installedQty, item.installedQty),
            status: item.status || existing.status,
            notes: [existing.notes, item.notes]
              .filter(Boolean)
              .filter((value, index, values) => values.indexOf(value) === index)
              .join(" · "),
          }
        : item,
    );
  });
  return [...items.values()];
}

function advancedEquipmentProjectStatus(...statuses: string[]) {
  const rank = new Map(
    ["제안", "견적", "수주", "발주", "설치 중", "설치 완료"].map(
      (status, index) => [status, index],
    ),
  );
  const explicitException = [...statuses]
    .reverse()
    .find((status) => status === "보류" || status === "취소");
  if (explicitException) return explicitException;
  return statuses.reduce(
    (best, status) =>
      (rank.get(status) ?? -1) > (rank.get(best) ?? -1) ? status : best,
    "제안",
  );
}

function mergeAiDrafts(drafts: AiPreview[]) {
  const grouped = new Map<string, AiPreview>();
  drafts.forEach((draft) => {
    const organization = draft.organization.trim();
    if (!organization) return;
    const key = organization.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...draft, organization });
      return;
    }

    const schedules = parseProgressSchedule(
      `${existing.progressSchedule}\n${draft.progressSchedule}`,
    );
    const summary =
      draft.summary && !existing.summary.includes(draft.summary)
        ? [existing.summary, draft.summary].filter(Boolean).join(" ")
        : existing.summary || draft.summary;
    grouped.set(key, {
      ...draft,
      ...existing,
      summary,
      progressSchedule: schedules
        .map((item) => `${item.label}\t${item.date}`)
        .join("\n"),
      equipmentProjectName:
        existing.equipmentProjectName || draft.equipmentProjectName,
      equipmentProjectStatus: advancedEquipmentProjectStatus(
        existing.equipmentProjectStatus,
        draft.equipmentProjectStatus,
      ),
      equipmentItems: mergeEquipmentDrafts(
        existing.equipmentItems,
        draft.equipmentItems,
      ),
    });
  });
  return [...grouped.values()];
}

function isBundledOrganization(value: string) {
  return /(?:외|등)\s*\d+\s*(?:건|곳)/.test(value);
}

function formatScheduleDate(value: string) {
  const parts = value.split("-");
  if (parts.length === 3) return `${Number(parts[1])}/${Number(parts[2])}`;
  return value.replaceAll("-", "/");
}

function statusClass(status: string) {
  if (status.includes("완료")) return "done";
  if (status.includes("재접촉")) return "urgent";
  if (status.includes("장기") || status.includes("대기")) return "muted";
  return "active";
}

function displayContactMethod(record: Activity) {
  if (record.contactMethod && record.contactMethod !== "기타") {
    return record.contactMethod;
  }
  if (
    record.awardStatus === "위즈업 수주" &&
    (record.progressSchedule || record.activityType.includes("진행"))
  ) {
    return "진행 공유";
  }
  if (record.contactMethod) return record.contactMethod;
  if (
    record.activityType.includes("방문") ||
    record.activityType.includes("미팅")
  ) {
    return "방문";
  }
  if (
    record.activityType.includes("통화") ||
    record.activityType === "TM"
  ) {
    return "유선";
  }
  return "기타";
}

function csvCell(value: string | number | boolean) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function requestRecords() {
  const response = await fetch("/api/records", { cache: "no-store" });
  const payload = (await response.json()) as {
    records?: Record<string, unknown>[];
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error || "기록을 불러오지 못했습니다.");
  return (payload.records ?? []).map(normalize);
}

async function requestSession(): Promise<SessionPayload> {
  const response = await fetch("/api/session", { cache: "no-store" });
  const payload = (await response.json()) as SessionPayload & { error?: string };
  if (!response.ok) throw new Error(payload.error || "사용자 정보를 확인하지 못했습니다.");
  return {
    ...payload,
    member: {
      ...payload.member,
      role:
        payload.member.role === "admin"
          ? "admin"
          : payload.member.role === "assistant"
            ? "assistant"
            : "member",
      permissions: normalizeMemberPermissions(payload.member.permissions),
    },
  };
}

const emptyEquipmentItemDraft: EquipmentItemDraft = {
  productName: "",
  specification: "",
  proposedQty: 0,
  awardedQty: 0,
  installedQty: 0,
  unit: "대",
  status: "제안",
  notes: "",
};

async function requestEquipmentProjects(organization: string) {
  const response = await fetch(
    `/api/equipment?organization=${encodeURIComponent(organization)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as {
    projects?: Record<string, unknown>[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "품목 기록을 불러오지 못했습니다.");
  }
  return (payload.projects ?? []).map(normalizeEquipmentProject);
}

async function saveAiEquipmentPreview(preview: AiPreview) {
  const response = await fetch("/api/equipment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "ai-import",
      organization: preview.organization,
      projectName: preview.equipmentProjectName,
      projectStatus: preview.equipmentProjectStatus,
      budgetType: preview.budgetType,
      budgetAmount: preview.budgetAmount,
      awardStatus: preview.awardStatus,
      awardStage: preview.awardStage,
      topic: preview.topic,
      summary: preview.summary,
      nextAction: preview.nextAction,
      progressSchedule: preview.progressSchedule,
      notes: preview.notes,
      items: preview.equipmentItems,
    }),
  });
  return response.ok;
}

function OrganizationEquipmentManager({
  organization,
  latestRecord,
  onToast,
  onOrganizationRenamed,
}: {
  organization: string;
  latestRecord: Activity;
  onToast: (message: string) => void;
  onOrganizationRenamed: (organization: string) => Promise<void>;
}) {
  const [equipmentState, setEquipmentState] = useState<{
    organization: string;
    projects: EquipmentProject[];
    error: string;
  }>({ organization: "", projects: [], error: "" });
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState({
    organization: "",
    name: "",
    status: "제안",
    budgetType: "",
    notes: "",
  });
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [itemProjectId, setItemProjectId] = useState<number | null>(null);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [itemDraft, setItemDraft] = useState<EquipmentItemDraft>({
    ...emptyEquipmentItemDraft,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void requestEquipmentProjects(organization)
      .then((projects) => {
        if (active) {
          setEquipmentState({ organization, projects, error: "" });
        }
      })
      .catch((error) => {
        if (active) {
          setEquipmentState({
            organization,
            projects: [],
            error:
              error instanceof Error
                ? error.message
                : "품목 기록을 불러오지 못했습니다.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [organization]);

  const projects =
    equipmentState.organization === organization
      ? equipmentState.projects
      : [];
  const loading = equipmentState.organization !== organization;
  const syncedBudgetType =
    latestRecord.budgetType.trim() || "예산 종류 미등록";
  const syncedBudgetAmount =
    formatMoneyInput(latestRecord.budgetAmount) || "금액 미등록";

  async function refreshEquipment() {
    const nextProjects = await requestEquipmentProjects(organization);
    setEquipmentState({ organization, projects: nextProjects, error: "" });
  }

  async function equipmentRequest(
    method: "POST" | "PUT" | "DELETE",
    body: Record<string, unknown>,
  ) {
    const response = await fetch("/api/equipment", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error || "품목 정보를 저장하지 못했습니다.");
    }
  }

  function openNewProject() {
    setEditingProjectId(null);
    setProjectDraft({
      organization,
      name:
        latestRecord.topic.trim() ||
        `${new Date().getFullYear()} ${organization} 제안·수주`,
      status: latestRecord.awardStatus === "위즈업 수주" ? "수주" : "제안",
      budgetType: latestRecord.budgetType,
      notes: "",
    });
    setProjectFormOpen(true);
  }

  function openProjectEdit(project: EquipmentProject) {
    setEditingProjectId(project.id);
    setProjectDraft({
      organization,
      name: project.name,
      status: project.status,
      budgetType: latestRecord.budgetType,
      notes: project.notes,
    });
    setProjectFormOpen(true);
  }

  async function saveProject(event: FormEvent) {
    event.preventDefault();
    if (!projectDraft.name.trim() || busy) return;
    setBusy(true);
    try {
      const nextOrganization = projectDraft.organization.trim();
      const organizationChanged =
        Boolean(editingProjectId) && nextOrganization !== organization;
      await equipmentRequest(editingProjectId ? "PUT" : "POST", {
        kind: "project",
        id: editingProjectId ?? undefined,
        ...projectDraft,
        organization: nextOrganization || organization,
        syncOrganization: organizationChanged,
        budgetType: latestRecord.budgetType,
      });
      if (organizationChanged) {
        await onOrganizationRenamed(nextOrganization);
      } else {
        await refreshEquipment();
      }
      setProjectFormOpen(false);
      setEditingProjectId(null);
      onToast(editingProjectId ? "사업 정보를 수정했습니다." : "새 사업을 추가했습니다.");
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "사업을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  function openNewItem(projectId: number) {
    setEditingItemId(null);
    setItemProjectId(projectId);
    setItemDraft({ ...emptyEquipmentItemDraft });
  }

  function openItemEdit(item: EquipmentItem) {
    setEditingItemId(item.id);
    setItemProjectId(item.projectId);
    setItemDraft({
      productName: item.productName,
      specification: item.specification,
      proposedQty: item.proposedQty,
      awardedQty: item.awardedQty,
      installedQty: item.installedQty,
      unit: item.unit,
      status: item.status,
      notes: item.notes,
    });
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    if (!itemProjectId || !itemDraft.productName.trim() || busy) return;
    setBusy(true);
    try {
      await equipmentRequest(editingItemId ? "PUT" : "POST", {
        kind: "item",
        id: editingItemId ?? undefined,
        projectId: itemProjectId,
        ...itemDraft,
      });
      await refreshEquipment();
      setItemProjectId(null);
      setEditingItemId(null);
      setItemDraft({ ...emptyEquipmentItemDraft });
      onToast(editingItemId ? "품목을 수정했습니다." : "품목을 추가했습니다.");
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "품목을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeProject(project: EquipmentProject) {
    if (
      busy ||
      !window.confirm(
        `${project.name} 사업과 안의 품목 ${project.items.length}개를 삭제할까요?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await equipmentRequest("DELETE", { kind: "project", id: project.id });
      await refreshEquipment();
      onToast("사업과 품목을 삭제했습니다.");
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "사업을 삭제하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: EquipmentItem) {
    if (busy || !window.confirm(`${item.productName} 품목을 삭제할까요?`)) {
      return;
    }
    setBusy(true);
    try {
      await equipmentRequest("DELETE", { kind: "item", id: item.id });
      await refreshEquipment();
      onToast("품목을 삭제했습니다.");
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "품목을 삭제하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="equipment-section">
      <div className="history-section-heading equipment-section-heading">
        <div>
          <span className="section-kicker">PROJECT &amp; EQUIPMENT</span>
          <h3>사업·품목 관리</h3>
          <p>제안한 품목과 실제 수주·설치 수량을 나눠 기록합니다.</p>
        </div>
        <button type="button" onClick={openNewProject}>
          ＋ 사업 추가
        </button>
      </div>

      {projectFormOpen && (
        <form className="equipment-project-form" onSubmit={saveProject}>
          <label className="equipment-wide-field">
            <span>기관명</span>
            <input
              required
              value={projectDraft.organization}
              onChange={(event) =>
                setProjectDraft({
                  ...projectDraft,
                  organization: event.target.value,
                })
              }
              placeholder="기관명을 입력하세요"
            />
            <small>수정하면 기관별 기록·일정·지도·사업에 함께 반영됩니다.</small>
          </label>
          <label className="equipment-wide-field">
            <span>사업명</span>
            <input
              required
              value={projectDraft.name}
              onChange={(event) =>
                setProjectDraft({ ...projectDraft, name: event.target.value })
              }
              placeholder="예: 2026 스마트교실 구축"
            />
          </label>
          <label>
            <span>사업 상태</span>
            <select
              value={projectDraft.status}
              onChange={(event) =>
                setProjectDraft({ ...projectDraft, status: event.target.value })
              }
            >
              {equipmentProjectStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <div className="equipment-budget-sync">
            <span>기관 등록 예산</span>
            <strong>{syncedBudgetType}</strong>
            <small>
              {syncedBudgetAmount} · 기관별 관리 최신 기록과 자동 연동
            </small>
          </div>
          <label className="equipment-wide-field">
            <span>사업 메모</span>
            <input
              value={projectDraft.notes}
              onChange={(event) =>
                setProjectDraft({ ...projectDraft, notes: event.target.value })
              }
              placeholder="필요한 설명이 있으면 입력"
            />
          </label>
          <div className="equipment-form-actions">
            <button
              type="button"
              onClick={() => {
                setProjectFormOpen(false);
                setEditingProjectId(null);
              }}
            >
              취소
            </button>
            <button type="submit" className="equipment-save" disabled={busy}>
              {busy ? "저장 중…" : editingProjectId ? "사업 수정" : "사업 만들기"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="equipment-empty">사업과 품목을 불러오고 있습니다…</div>
      ) : equipmentState.error ? (
        <div className="equipment-empty error">{equipmentState.error}</div>
      ) : projects.length === 0 ? (
        <div className="equipment-empty">
          <strong>아직 등록된 품목이 없습니다.</strong>
          <p>
            먼저 사업을 하나 만들고, 제안한 장비를 품목별로 추가해 보세요.
          </p>
          <button type="button" onClick={openNewProject}>
            첫 사업 만들기
          </button>
        </div>
      ) : (
        <div className="equipment-project-list">
          {projects.map((project) => {
            const proposedKinds = project.items.filter(
              (item) => item.proposedQty > 0,
            ).length;
            const awardedKinds = project.items.filter(
              (item) => item.awardedQty > 0,
            ).length;
            const installingKinds = project.items.filter(
              (item) =>
                item.installedQty > 0 ||
                ["발주", "설치 중", "설치 완료"].includes(item.status),
            ).length;
            return (
              <article className="equipment-project-card" key={project.id}>
                <header>
                  <div>
                    <div className="equipment-project-title">
                      <span>{project.status}</span>
                      <h4>{project.name}</h4>
                    </div>
                    <p>
                      {syncedBudgetType} · {syncedBudgetAmount} ·{" "}
                      {project.items.length}개 품목
                    </p>
                  </div>
                  <div className="equipment-project-actions">
                    <button
                      type="button"
                      onClick={() => openProjectEdit(project)}
                    >
                      사업 수정
                    </button>
                    <button
                      type="button"
                      className="delete"
                      onClick={() => void removeProject(project)}
                    >
                      삭제
                    </button>
                  </div>
                </header>
                <div className="equipment-project-summary">
                  <span>제안 <b>{proposedKinds}</b>종</span>
                  <span>수주 <b>{awardedKinds}</b>종</span>
                  <span>설치·진행 <b>{installingKinds}</b>종</span>
                </div>
                {project.notes && (
                  <p className="equipment-project-notes">{project.notes}</p>
                )}

                <div className="equipment-item-head">
                  <span>품목·규격</span>
                  <span>제안</span>
                  <span>수주</span>
                  <span>설치</span>
                  <span>상태</span>
                  <span />
                </div>
                <div className="equipment-item-list">
                  {project.items.length === 0 && (
                    <p className="equipment-no-items">
                      품목을 추가하면 제안·수주·설치 수량이 여기에 표시됩니다.
                    </p>
                  )}
                  {project.items.map((item) => (
                    <div className="equipment-item-row" key={item.id}>
                      <div className="equipment-item-name">
                        <strong>{item.productName}</strong>
                        {(item.specification || item.notes) && (
                          <small>
                            {item.specification}
                            {item.specification && item.notes ? " · " : ""}
                            {item.notes}
                          </small>
                        )}
                      </div>
                      <span>
                        {item.proposedQty > 0
                          ? `${item.proposedQty}${item.unit}`
                          : ""}
                      </span>
                      <span>
                        {item.awardedQty > 0
                          ? `${item.awardedQty}${item.unit}`
                          : ""}
                      </span>
                      <span>
                        {item.installedQty > 0
                          ? `${item.installedQty}${item.unit}`
                          : ""}
                      </span>
                      <em>{item.status}</em>
                      <div className="equipment-item-actions">
                        <button
                          type="button"
                          onClick={() => openItemEdit(item)}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className="delete"
                          onClick={() => void removeItem(item)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {itemProjectId === project.id ? (
                  <form className="equipment-item-form" onSubmit={saveItem}>
                    <label className="equipment-product-field">
                      <span>품목명 *</span>
                      <input
                        required
                        value={itemDraft.productName}
                        onChange={(event) =>
                          setItemDraft({
                            ...itemDraft,
                            productName: event.target.value,
                          })
                        }
                        placeholder="예: 전자칠판 86인치"
                      />
                    </label>
                    <label className="equipment-spec-field">
                      <span>규격·모델</span>
                      <input
                        value={itemDraft.specification}
                        onChange={(event) =>
                          setItemDraft({
                            ...itemDraft,
                            specification: event.target.value,
                          })
                        }
                        placeholder="모델명 또는 규격"
                      />
                    </label>
                    {[
                      ["제안 수량", "proposedQty"],
                      ["수주 수량", "awardedQty"],
                      ["설치 수량", "installedQty"],
                    ].map(([label, field]) => (
                      <label key={field}>
                        <span>{label}</span>
                        <input
                          type="number"
                          min="0"
                          value={itemDraft[field as keyof EquipmentItemDraft]}
                          onChange={(event) =>
                            setItemDraft({
                              ...itemDraft,
                              [field]: Math.max(0, Number(event.target.value) || 0),
                            })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      <span>단위</span>
                      <input
                        value={itemDraft.unit}
                        onChange={(event) =>
                          setItemDraft({ ...itemDraft, unit: event.target.value })
                        }
                        placeholder="대, 식, 세트"
                      />
                    </label>
                    <label>
                      <span>진행 상태</span>
                      <select
                        value={itemDraft.status}
                        onChange={(event) =>
                          setItemDraft({
                            ...itemDraft,
                            status: event.target.value,
                          })
                        }
                      >
                        {equipmentItemStatuses.map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </select>
                    </label>
                    <label className="equipment-item-notes">
                      <span>품목 메모</span>
                      <input
                        value={itemDraft.notes}
                        onChange={(event) =>
                          setItemDraft({ ...itemDraft, notes: event.target.value })
                        }
                        placeholder="색상, 설치 위치, 변경 사항 등"
                      />
                    </label>
                    <div className="equipment-form-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setItemProjectId(null);
                          setEditingItemId(null);
                        }}
                      >
                        취소
                      </button>
                      <button
                        type="submit"
                        className="equipment-save"
                        disabled={busy}
                      >
                        {busy ? "저장 중…" : editingItemId ? "품목 수정" : "품목 추가"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="equipment-add-item"
                    onClick={() => openNewItem(project.id)}
                  >
                    ＋ 이 사업에 품목 추가
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function CrmApp({
  identity,
  signOutPath,
}: {
  identity: { email: string; displayName: string };
  signOutPath: string;
}) {
  const [records, setRecords] = useState<Activity[]>([]);
  const [view, setView] = useState<View>("dashboard");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("전체 유형");
  const [statusFilter, setStatusFilter] = useState("전체 상태");
  const [awardFilter, setAwardFilter] = useState("전체 수주");
  const [awardSort, setAwardSort] = useState("date-desc");
  const [followupSort, setFollowupSort] = useState("activity-desc");
  const [recordDateScope, setRecordDateScope] = useState<"all" | "recent">(
    "all",
  );
  const [activeAwardsOnly, setActiveAwardsOnly] = useState(false);
  const [followupDueSoonOnly, setFollowupDueSoonOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creatingAward, setCreatingAward] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [oauthClient, setOauthClient] = useState<Record<string, string> | null>(
    null,
  );
  const [oauthSecret, setOauthSecret] = useState("");
  const [sharedGptUrl, setSharedGptUrl] = useState("");
  const [aiDraft, setAiDraft] = useState("");
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([]);
  const [aiPreviews, setAiPreviews] = useState<AiPreview[]>([]);
  const [aiOrganizing, setAiOrganizing] = useState(false);
  const [aiBatchSaving, setAiBatchSaving] = useState(false);
  const [aiError, setAiError] = useState("");
  const aiDraftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [detailOrganization, setDetailOrganization] = useState<string | null>(
    null,
  );
  const [selectedOrganizations, setSelectedOrganizations] = useState<string[]>(
    [],
  );
  const sessionRole = session?.member.role;
  const sessionStatus = session?.member.status;
  const isOwner = session?.member.role === "admin";
  const canManageMembers = Boolean(
    session && memberCan(session.member, "members:manage"),
  );
  const canManageRecords = Boolean(
    session && memberCan(session.member, "records:manage"),
  );
  const canManageMap = Boolean(
    session && memberCan(session.member, "map:manage"),
  );
  const canExportData = Boolean(
    session && memberCan(session.member, "data:export"),
  );
  const managementNavItems = session
    ? [
        canManageRecords && {
          id: "records" as View,
          label: "팀 활동 로그",
          mark: "L",
        },
        canManageRecords && {
          id: "organizations" as View,
          label: "기관별 보기",
          mark: "O",
        },
        canManageMembers && {
          id: "team" as View,
          label: "구성원 승인",
          mark: "T",
        },
      ].filter(
        (
          item,
        ): item is {
          id: View;
          label: string;
          mark: string;
        } => Boolean(item),
      )
    : [];

  async function loadRecords() {
    try {
      setLoading(true);
      const nextRecords = await requestRecords();
      setRecords(nextRecords);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "기록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void requestSession()
      .then(async (nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setSharedGptUrl(nextSession.sharedGptUrl);
        if (nextSession.member.status === "approved") {
          const nextRecords = await requestRecords();
          if (!active) return;
          setRecords(nextRecords);
        }
        setError("");
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "기록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setSessionLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (
      sessionLoading ||
      !sessionRole ||
      sessionStatus !== "approved"
    ) {
      return;
    }

    const restoreView = (state: ViewHistoryState | null, replace = false) => {
      const hashView = window.location.hash.slice(1) as View;
      let nextView =
        state?.whizzupView ||
        (availableViews.has(hashView) ? hashView : "dashboard");
      if (
        ((nextView === "organizations" || nextView === "records") &&
          !canManageRecords) ||
        (nextView === "team" && !canManageMembers) ||
        (nextView === "integration" && !isOwner)
      ) {
        nextView = "dashboard";
      }
      const nextRecordDateScope =
        state?.whizzupRecordDateScope === "recent" ? "recent" : "all";
      const nextActiveAwardsOnly = Boolean(
        state?.whizzupActiveAwardsOnly && nextView === "awards",
      );
      const nextFollowupDueSoonOnly = Boolean(
        state?.whizzupFollowupDueSoonOnly && nextView === "followup",
      );

      setRecordDateScope(nextRecordDateScope);
      setActiveAwardsOnly(nextActiveAwardsOnly);
      setFollowupDueSoonOnly(nextFollowupDueSoonOnly);
      setView(nextView);
      setMobileNav(false);

      if (replace) {
        const currentState =
          window.history.state &&
          typeof window.history.state === "object"
            ? window.history.state
            : {};
        const baseUrl = `${window.location.pathname}${window.location.search}`;
        window.history.replaceState(
          {
            ...currentState,
            whizzupView: nextView,
            whizzupRecordDateScope: nextRecordDateScope,
            whizzupActiveAwardsOnly: nextActiveAwardsOnly,
            whizzupFollowupDueSoonOnly: nextFollowupDueSoonOnly,
          },
          "",
          nextView === "dashboard" ? baseUrl : `${baseUrl}#${nextView}`,
        );
      }
    };

    restoreView(window.history.state as ViewHistoryState | null, true);
    const handlePopState = (event: PopStateEvent) => {
      restoreView(event.state as ViewHistoryState | null);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [
    sessionLoading,
    sessionRole,
    sessionStatus,
    canManageMembers,
    canManageRecords,
    isOwner,
  ]);

  const latestAwardRecords = useMemo(() => {
    const byOrganization = new Map<string, Activity>();
    [...records]
      .sort(
        (a, b) =>
          b.activityDate.localeCompare(a.activityDate) || b.id - a.id,
      )
      .forEach((record) => {
        const organization = record.organization.trim();
        if (
          !organization ||
          record.awardStatus === "미정" ||
          byOrganization.has(organization)
        ) {
          return;
        }
        byOrganization.set(organization, record);
      });
    return [...byOrganization.values()];
  }, [records]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const sourceRecords = view === "awards" ? latestAwardRecords : records;
    return sourceRecords.filter((record) => {
      if (view === "followup" && !record.followUpRequired) return false;
      if (view === "awards" && record.awardStatus === "미정") return false;
      if (
        view === "awards" &&
        activeAwardsOnly &&
        (
          record.awardStatus !== "위즈업 수주" ||
          completedAwardStages.has(record.awardStage)
        )
      ) {
        return false;
      }
      if (view === "records" && recordDateScope === "recent") {
        const today = new Date();
        const recentStart = new Date(today);
        recentStart.setDate(today.getDate() - 29);
        if (
          record.activityDate < toLocalDateValue(recentStart) ||
          record.activityDate > toLocalDateValue(today)
        ) {
          return false;
        }
      }
      if (
        view !== "awards" &&
        typeFilter !== "전체 유형" &&
        record.activityType !== typeFilter
      ) {
        return false;
      }
      if (
        statusFilter !== "전체 상태" &&
        (view === "awards" ? record.awardStage : record.status) !== statusFilter
      ) {
        return false;
      }
      if (awardFilter !== "전체 수주" && record.awardStatus !== awardFilter) return false;
      if (!keyword) return true;
      return [
        record.organization,
        record.region,
        record.contactMethod,
        record.budgetType,
        record.budgetAmount,
        record.topic,
        record.summary,
        record.nextAction,
        record.contactName,
        record.activityType,
        record.awardStatus,
        record.awardCompany,
        record.executionType,
        record.consortiumCompany,
        record.awardStage,
        record.progressManager,
      ].some((value) => value.toLowerCase().includes(keyword));
    });
  }, [
    records,
    latestAwardRecords,
    search,
    typeFilter,
    statusFilter,
    awardFilter,
    view,
    recordDateScope,
    activeAwardsOnly,
  ]);

  const displayedRecords = useMemo(() => {
    if (view !== "awards") return filtered;
    return [...filtered].sort((a, b) => {
      if (awardSort === "date-asc") {
        return (
          a.activityDate.localeCompare(b.activityDate) ||
          a.id - b.id
        );
      }
      if (awardSort === "amount-desc" || awardSort === "amount-asc") {
        const aAmount = parseMoneyAmount(a.budgetAmount);
        const bAmount = parseMoneyAmount(b.budgetAmount);
        if (!aAmount && bAmount) return 1;
        if (aAmount && !bAmount) return -1;
        return awardSort === "amount-desc"
          ? bAmount - aAmount
          : aAmount - bAmount;
      }
      if (awardSort === "organization") {
        return (
          a.organization.localeCompare(b.organization, "ko-KR") ||
          b.activityDate.localeCompare(a.activityDate)
        );
      }
      if (awardSort === "stage") {
        return (
          awardStageOptions.indexOf(a.awardStage) -
            awardStageOptions.indexOf(b.awardStage) ||
          b.activityDate.localeCompare(a.activityDate)
        );
      }
      return (
        b.activityDate.localeCompare(a.activityDate) ||
        b.id - a.id
      );
    });
  }, [filtered, view, awardSort]);

  const dashboardRecentRecords = useMemo(
    () =>
      [...records]
        .sort(
          (a, b) =>
            b.activityDate.localeCompare(a.activityDate) ||
            b.id - a.id,
        )
        .slice(0, 8),
    [records],
  );

  const today = new Date();
  const todayValue = toLocalDateValue(today);
  const followupAlertEnd = new Date(today);
  followupAlertEnd.setDate(today.getDate() + 2);
  const followupAlertEndValue = toLocalDateValue(followupAlertEnd);

  const followupRows = useMemo(() => {
    const latestByOrganization = new Map<string, Activity>();
    records.forEach((record) => {
      const current = latestByOrganization.get(record.organization);
      if (
        !current ||
        record.activityDate > current.activityDate ||
        (record.activityDate === current.activityDate && record.id > current.id)
      ) {
        latestByOrganization.set(record.organization, record);
      }
    });
    const keyword = search.trim().toLowerCase();
    return [...latestByOrganization.values()]
      .filter(
        (record) =>
          record.followUpRequired && !record.status.includes("완료"),
      )
      .filter(
        (record) =>
          !followupDueSoonOnly ||
          Boolean(
            record.followUpDate &&
              record.followUpDate <= followupAlertEndValue,
          ),
      )
      .filter(
        (record) =>
          typeFilter === "전체 유형" || record.activityType === typeFilter,
      )
      .filter(
        (record) =>
          statusFilter === "전체 상태" || record.status === statusFilter,
      )
      .filter(
        (record) =>
          awardFilter === "전체 수주" || record.awardStatus === awardFilter,
      )
      .filter(
        (record) =>
          !keyword ||
          [
            record.organization,
            record.region,
            displayContactMethod(record),
            record.budgetType,
            record.budgetAmount,
            record.contactName,
            record.contactPhone,
            record.contactEmail,
            record.executionType,
            record.consortiumCompany,
            record.progressManager,
            record.topic,
            record.summary,
            record.status,
            record.awardStatus,
          ].some((value) => value.toLowerCase().includes(keyword)),
      )
      .sort((a, b) => {
        if (followupSort === "activity-desc") {
          return (
            b.activityDate.localeCompare(a.activityDate) ||
            b.id - a.id
          );
        }
        if (followupSort === "activity-asc") {
          return (
            a.activityDate.localeCompare(b.activityDate) ||
            a.id - b.id
          );
        }
        if (followupSort === "organization") {
          return a.organization.localeCompare(b.organization, "ko-KR");
        }
        if (
          followupSort === "amount-desc" ||
          followupSort === "amount-asc"
        ) {
          const aAmount = parseMoneyAmount(a.budgetAmount);
          const bAmount = parseMoneyAmount(b.budgetAmount);
          if (!aAmount && bAmount) return 1;
          if (aAmount && !bAmount) return -1;
          return followupSort === "amount-desc"
            ? bAmount - aAmount
            : aAmount - bAmount;
        }
        if (a.followUpDate && b.followUpDate) {
          return (
            a.followUpDate.localeCompare(b.followUpDate) ||
            b.activityDate.localeCompare(a.activityDate)
          );
        }
        if (a.followUpDate) return -1;
        if (b.followUpDate) return 1;
        return b.activityDate.localeCompare(a.activityDate);
      });
  }, [
    records,
    search,
    typeFilter,
    statusFilter,
    awardFilter,
    followupSort,
    followupDueSoonOnly,
    followupAlertEndValue,
  ]);
  const detailHistory = useMemo(
    () =>
      detailOrganization
        ? records
            .filter((record) => record.organization === detailOrganization)
            .sort((a, b) => {
              if (a.activityDate !== b.activityDate) {
                return b.activityDate.localeCompare(a.activityDate);
              }
              return b.id - a.id;
            })
        : [],
    [records, detailOrganization],
  );
  const detailLatest = detailHistory[0] ?? null;
  const latestRecords = new Map<string, Activity>();
  records.forEach((record) => {
    const current = latestRecords.get(record.organization);
    if (
      !current ||
      record.activityDate > current.activityDate ||
      (record.activityDate === current.activityDate && record.id > current.id)
    ) {
      latestRecords.set(record.organization, record);
    }
  });
  const actionableFollowups = [...latestRecords.values()].filter(
    (record) => record.followUpRequired && !record.status.includes("완료"),
  );
  const dueSoonFollowups = actionableFollowups.filter(
    (record) =>
      record.followUpDate &&
      record.followUpDate <= followupAlertEndValue,
  );
  const activeAwardOrganizationCount = latestAwardRecords.filter(
    (record) =>
      record.awardStatus === "위즈업 수주" &&
      !completedAwardStages.has(record.awardStage),
  ).length;

  const progressSchedules = useMemo(() => {
    const scheduleMap = new Map<string, ProgressScheduleItem[]>();
    records.forEach((record) => {
      if (isBundledOrganization(record.organization)) {
        return;
      }
      const current = scheduleMap.get(record.organization) ?? [];
      parseProgressSchedule(record.progressSchedule).forEach((item) => {
        if (
          !current.some(
            (existing) =>
              existing.date === item.date && existing.label === item.label,
          )
        ) {
          current.push(item);
        }
      });
      if (current.length) {
        current.sort((a, b) => a.date.localeCompare(b.date));
        scheduleMap.set(record.organization, current);
      }
    });
    return [...scheduleMap.entries()]
      .map(([organization, items]) => ({ organization, items }))
      .sort((a, b) => a.items[0].date.localeCompare(b.items[0].date));
  }, [records]);
  const progressScheduleCount = progressSchedules.reduce(
    (total, row) => total + row.items.length,
    0,
  );
  const upcomingProgressSchedules = progressSchedules
    .map((row) => ({
      ...row,
      items: row.items.filter((item) => item.date >= todayValue),
    }))
    .filter((row) => row.items.length > 0);
  const upcomingProgressScheduleCount = upcomingProgressSchedules.reduce(
    (total, row) => total + row.items.length,
    0,
  );

  const organizations = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        count: number;
        lastDate: string;
        followups: number;
        temperature: string;
        awardResults: number;
      }
    >();
    records.forEach((record) => {
      const current = map.get(record.organization) ?? {
        name: record.organization,
        count: 0,
        lastDate: "",
        followups: 0,
        temperature: "낮음",
        awardResults: 0,
      };
      current.count += 1;
      if (record.activityDate > current.lastDate) current.lastDate = record.activityDate;
      if (record.followUpRequired) current.followups += 1;
      if (record.awardStatus !== "미정") current.awardResults += 1;
      if (record.temperature === "높음") current.temperature = "높음";
      else if (record.temperature === "중간" && current.temperature !== "높음") {
        current.temperature = "중간";
      }
      map.set(record.organization, current);
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [records]);

  function openNew() {
    setEditingId(null);
    setCreatingAward(false);
    setForm({ ...emptyForm, activityDate: new Date().toISOString().slice(0, 10) });
    setModalOpen(true);
  }

  function openNewAward() {
    setEditingId(null);
    setCreatingAward(true);
    setForm({
      ...emptyForm,
      activityDate: new Date().toISOString().slice(0, 10),
      activityType: "수주",
      contactMethod: "기타",
      awardStatus: "위즈업 수주",
      awardCompany: "위즈업",
      executionType: "직영",
      awardStage: "품의",
      followUpRequired: false,
      sourceChat: "수주 관리 직접 등록",
    });
    setModalOpen(true);
  }

  function openEdit(record: Activity) {
    setEditingId(record.id);
    setCreatingAward(false);
    setForm({
      activityDate: record.activityDate,
      dateConfidence: record.dateConfidence,
      activityType: record.activityType,
      category: record.category,
      contactMethod: record.contactMethod,
      region: record.region,
      organization: record.organization,
      budgetType: record.budgetType,
      budgetAmount: formatMoneyInput(record.budgetAmount),
      topic: record.topic,
      summary: record.summary,
      status: record.status,
      temperature: record.temperature,
      awardStatus: record.awardStatus,
      awardCompany: record.awardCompany,
      executionType: record.executionType,
      consortiumCompany: record.consortiumCompany,
      awardStage: record.awardStage,
      progressManager: record.progressManager,
      followUpRequired: record.followUpRequired,
      followUpDate: record.followUpDate,
      nextAction: record.nextAction,
      progressSchedule: record.progressSchedule,
      contactName: record.contactName,
      contactPhone: record.contactPhone,
      contactEmail: record.contactEmail,
      sourceChat: record.sourceChat,
      notes: record.notes,
    });
    setModalOpen(true);
  }

  async function loadTeam() {
    try {
      setTeamLoading(true);
      const response = await fetch("/api/members", { cache: "no-store" });
      const payload = (await response.json()) as {
        members?: Record<string, unknown>[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "구성원을 불러오지 못했습니다.");
      setTeamMembers(
        (payload.members ?? []).map((member) => ({
          id: Number(member.id),
          email: String(member.email),
          displayName: String(member.display_name),
          role:
            String(member.role) === "admin"
              ? "admin"
              : String(member.role) === "assistant"
                ? "assistant"
                : "member",
          permissions: normalizeMemberPermissions(member.permissions),
          status:
            String(member.status) === "approved"
              ? "approved"
              : String(member.status) === "suspended"
                ? "suspended"
                : "pending",
          createdAt: String(member.created_at),
          lastSeenAt: String(member.last_seen_at),
        })),
      );
    } catch (caught) {
      setToast(
        caught instanceof Error ? caught.message : "구성원을 불러오지 못했습니다.",
      );
    } finally {
      setTeamLoading(false);
    }
  }

  async function loadIntegration() {
    try {
      const response = await fetch("/api/oauth/client", { cache: "no-store" });
      const payload = (await response.json()) as {
        client?: Record<string, string> | null;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "GPT 연결 정보를 불러오지 못했습니다.");
      setOauthClient(payload.client ?? null);
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "GPT 연결 정보를 불러오지 못했습니다.",
      );
    }
  }

  function navigateTo(
    nextView: View,
    options: {
      recordDateScope?: "all" | "recent";
      activeAwardsOnly?: boolean;
      followupDueSoonOnly?: boolean;
      replace?: boolean;
    } = {},
  ) {
    const nextRecordDateScope = options.recordDateScope ?? "all";
    const nextActiveAwardsOnly = Boolean(
      options.activeAwardsOnly && nextView === "awards",
    );
    const nextFollowupDueSoonOnly = Boolean(
      options.followupDueSoonOnly && nextView === "followup",
    );
    setSearch("");
    setTypeFilter("전체 유형");
    setStatusFilter("전체 상태");
    setAwardFilter("전체 수주");
    setAwardSort("date-desc");
    setFollowupSort(
      nextFollowupDueSoonOnly ? "followup-asc" : "activity-desc",
    );
    setRecordDateScope(nextRecordDateScope);
    setActiveAwardsOnly(nextActiveAwardsOnly);
    setFollowupDueSoonOnly(nextFollowupDueSoonOnly);
    setView(nextView);

    const currentState =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
    const historyState: ViewHistoryState = {
      ...currentState,
      whizzupView: nextView,
      whizzupRecordDateScope: nextRecordDateScope,
      whizzupActiveAwardsOnly: nextActiveAwardsOnly,
      whizzupFollowupDueSoonOnly: nextFollowupDueSoonOnly,
    };
    const baseUrl = `${window.location.pathname}${window.location.search}`;
    const nextUrl =
      nextView === "dashboard" ? baseUrl : `${baseUrl}#${nextView}`;
    const sameView =
      view === nextView &&
      recordDateScope === nextRecordDateScope &&
      activeAwardsOnly === nextActiveAwardsOnly &&
      followupDueSoonOnly === nextFollowupDueSoonOnly;
    window.history[
      options.replace || sameView ? "replaceState" : "pushState"
    ](historyState, "", nextUrl);
  }

  async function selectView(nextView: View) {
    if (
      ((nextView === "organizations" || nextView === "records") &&
        !canManageRecords) ||
      (nextView === "team" && !canManageMembers) ||
      (nextView === "integration" && !isOwner)
    ) {
      navigateTo("dashboard", { replace: true });
      setMobileNav(false);
      setToast("이 메뉴를 사용할 권한이 없습니다.");
      return;
    }
    navigateTo(nextView);
    setMobileNav(false);
    if (nextView === "team" && canManageMembers) {
      await loadTeam();
    }
    if (nextView === "integration" && isOwner) {
      await loadIntegration();
    }
  }

  async function updateMember(
    member: TeamMember,
    status: TeamMember["status"],
    role = member.role,
  ) {
    try {
      const response = await fetch("/api/members", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: member.id,
          status,
          role,
          permissions: member.permissions,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "권한을 변경하지 못했습니다.");
      setToast(
        status === "approved"
          ? `${member.displayName} 님을 승인했습니다.`
          : status === "suspended"
            ? `${member.displayName} 님의 사용을 중지했습니다.`
            : "승인 대기로 변경했습니다.",
      );
      await loadTeam();
      setSession((current) =>
        current
          ? {
              ...current,
              pendingCount:
                status === "approved"
                  ? Math.max(0, current.pendingCount - 1)
                  : current.pendingCount,
            }
          : current,
      );
      return true;
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "권한을 변경하지 못했습니다.");
      return false;
    }
  }

  async function generateOAuthClient() {
    if (
      oauthClient &&
      !window.confirm(
        "연결키를 다시 발급하면 기존 GPT 연결이 모두 해제됩니다. 계속할까요?",
      )
    ) {
      return;
    }
    try {
      const response = await fetch("/api/oauth/client", { method: "POST" });
      const payload = (await response.json()) as {
        client?: Record<string, string>;
        error?: string;
      };
      if (!response.ok || !payload.client) {
        throw new Error(payload.error || "연결키를 발급하지 못했습니다.");
      }
      setOauthClient({
        client_id: payload.client.clientId,
        name: payload.client.name,
      });
      setOauthSecret(payload.client.clientSecret);
      setToast("GPT 연결키를 발급했습니다. 비밀키는 지금 한 번만 표시됩니다.");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "연결키를 발급하지 못했습니다.");
    }
  }

  async function saveSharedGptUrl() {
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharedGptUrl }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "공유 링크를 저장하지 못했습니다.");
      setSession((current) =>
        current ? { ...current, sharedGptUrl } : current,
      );
      setToast("공유 GPT 링크를 저장했습니다.");
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "공유 링크를 저장하지 못했습니다.");
    }
  }

  async function copyText(value: string, message = "복사했습니다.") {
    await navigator.clipboard.writeText(value);
    setToast(message);
  }

  function openSharedGpt() {
    const url = session?.sharedGptUrl || sharedGptUrl;
    if (!url) {
      setToast("관리자가 공유 GPT 링크를 먼저 등록해야 합니다.");
      if (isOwner) void selectView("integration");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function openAiRecorder() {
    navigateTo("dashboard");
    setMobileNav(false);
    window.setTimeout(() => {
      aiDraftInputRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      aiDraftInputRef.current?.focus();
    }, 0);
  }

  async function startAiRecord() {
    const draft = aiDraft.trim();
    if (!draft || aiOrganizing) return;
    if (session?.aiConfigured === false) {
      setAiError(
        "사이트 AI 연결 준비 중입니다. 관리자에게 API 연결 상태를 확인해 주세요.",
      );
      return;
    }

    const history = aiMessages.slice(-6);
    setAiMessages((current) => [
      ...current,
      { role: "user", text: draft },
    ]);
    setAiDraft("");
    setAiPreviews([]);
    setAiError("");
    setAiOrganizing(true);

    try {
      const response = await fetch("/api/ai/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: draft,
          history,
        }),
      });
      const payload = (await response.json()) as AiOrganizePayload;
      if (!response.ok) {
        throw new Error(payload.error || "AI가 기록을 정리하지 못했습니다.");
      }

      const assistantMessage =
        payload.assistantMessage ||
        (payload.needsClarification
          ? "기록에 필요한 정보를 조금 더 알려주세요."
          : "정리했습니다. 내용을 확인해 주세요.");
      setAiMessages((current) => [
        ...current,
        { role: "assistant", text: assistantMessage },
      ]);
      const organizedDrafts =
        payload.drafts?.length
          ? payload.drafts
          : payload.draft
            ? [payload.draft]
            : [];
      if (!payload.needsClarification && organizedDrafts.length) {
        setAiPreviews(
          mergeAiDrafts(organizedDrafts.map((item) => normalizeAiDraft(item))),
        );
      }
    } catch (caught) {
      setAiDraft(draft);
      setAiError(
        caught instanceof Error
          ? caught.message
          : "AI가 기록을 정리하지 못했습니다.",
      );
    } finally {
      setAiOrganizing(false);
    }
  }

  async function saveAiPreviewBatch() {
    if (!aiPreviews.length || aiBatchSaving) return;
    const invalidDraft = aiPreviews.find(
      (preview) =>
        !preview.organization.trim() ||
        (preview.awardStatus === "타업체 수주" &&
          !preview.awardCompany.trim()) ||
        (preview.executionType === "컨소" &&
          !preview.consortiumCompany.trim()),
    );
    if (invalidDraft) {
      setToast(
        !invalidDraft.organization
          ? "기관명이 비어 있는 항목을 확인해 주세요."
          : invalidDraft.executionType === "컨소"
            ? `${invalidDraft.organization}의 컨소 업체명을 확인해 주세요.`
            : `${invalidDraft.organization}의 타업체 수주 업체명을 확인해 주세요.`,
      );
      return;
    }

    let remaining = [...aiPreviews];
    let savedCount = 0;
    const equipmentFailedOrganizations: string[] = [];
    setAiBatchSaving(true);
    try {
      for (const preview of aiPreviews) {
        const response = await fetch("/api/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preview),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(
            payload.error || `${preview.organization} 기록을 저장하지 못했습니다.`,
          );
        }
        if (!(await saveAiEquipmentPreview(preview))) {
          equipmentFailedOrganizations.push(preview.organization);
        }
        savedCount += 1;
        remaining = remaining.filter(
          (item) => item.organization !== preview.organization,
        );
        setAiPreviews(remaining);
      }

      setAiMessages([]);
      setAiDraft("");
      setAiError("");
      setToast(
        equipmentFailedOrganizations.length
          ? `${savedCount}개 기관 기록은 저장했지만 ${equipmentFailedOrganizations.length}곳의 사업·품목은 다시 확인해 주세요.`
          : `${savedCount}개 기관 기록과 사업·품목을 한 번에 저장했습니다.`,
      );
      await loadRecords();
    } catch (caught) {
      await loadRecords();
      setToast(
        savedCount
          ? `${savedCount}개 기관은 저장했고 ${remaining.length}개 기관이 남았습니다.`
          : caught instanceof Error
            ? caught.message
            : "기관별 기록을 저장하지 못했습니다.",
      );
    } finally {
      setAiBatchSaving(false);
    }
  }

  async function saveRecord(event: FormEvent) {
    event.preventDefault();
    if (!form.organization.trim()) {
      setToast("기관명을 입력해 주세요.");
      return;
    }
    if (form.awardStatus === "타업체 수주" && !form.awardCompany.trim()) {
      setToast("타업체 수주 업체명을 입력해 주세요.");
      return;
    }
    if (form.executionType === "컨소" && !form.consortiumCompany.trim()) {
      setToast("컨소 업체명을 입력해 주세요.");
      return;
    }
    try {
      setSaving(true);
      const response = await fetch("/api/records", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...form } : form),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "저장하지 못했습니다.");
      const aiEquipmentPreview = form as AiPreview;
      const equipmentSaved =
        form.sourceChat !== "사이트 AI 입력" ||
        !Array.isArray(aiEquipmentPreview.equipmentItems) ||
        (await saveAiEquipmentPreview(aiEquipmentPreview));
      setModalOpen(false);
      setToast(
        !equipmentSaved
          ? "영업 기록은 저장했지만 사업·품목은 기관 상세에서 확인해 주세요."
          : editingId
            ? "기록을 수정했습니다."
            : aiEquipmentPreview.equipmentItems?.length
              ? "영업 기록과 제안·수주 품목을 저장했습니다."
              : form.sourceChat === "사이트 AI 입력"
                ? "영업 기록과 사업을 자동 연결했습니다."
                : "새 기록을 추가했습니다.",
      );
      if (!editingId && form.sourceChat === "사이트 AI 입력") {
        const remainingPreviews = aiPreviews.filter(
          (preview) => preview.organization !== form.organization,
        );
        setAiPreviews(remainingPreviews);
        if (!remainingPreviews.length) {
          setAiMessages([]);
          setAiDraft("");
          setAiError("");
        }
      }
      await loadRecords();
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function removeRecord(record: Activity) {
    if (!window.confirm(`${record.organization} 기록을 삭제할까요?`)) {
      return false;
    }
    try {
      const response = await fetch("/api/records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id }),
      });
      if (!response.ok) throw new Error("삭제하지 못했습니다.");
      setRecords((current) => current.filter((item) => item.id !== record.id));
      setToast("기록을 삭제했습니다.");
      return true;
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "삭제하지 못했습니다.");
      return false;
    }
  }

  async function saveMemberAccess(member: TeamMember) {
    if (await updateMember(member, member.status, member.role)) {
      setToast(
        member.role === "assistant"
          ? `${member.displayName} 님을 보조관리자로 설정했습니다.`
          : `${member.displayName} 님을 일반 구성원으로 설정했습니다.`,
      );
    }
  }

  async function updateMemberDisplayName(member: TeamMember) {
    const displayName = member.displayName.trim();
    try {
      const response = await fetch("/api/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: member.id, displayName }),
      });
      const payload = (await response.json()) as {
        member?: Record<string, unknown>;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "표시 이름을 저장하지 못했습니다.");
      }
      const savedName = String(payload.member?.display_name ?? displayName);
      setTeamMembers((current) =>
        current.map((item) =>
          item.id === member.id ? { ...item, displayName: savedName } : item,
        ),
      );
      if (member.id === session?.member.id) {
        setSession((current) =>
          current
            ? {
                ...current,
                member: { ...current.member, displayName: savedName },
              }
            : current,
        );
      }
      setToast(`${savedName} 이름으로 저장했습니다.`);
    } catch (caught) {
      setToast(
        caught instanceof Error ? caught.message : "표시 이름을 저장하지 못했습니다.",
      );
    }
  }

  function openMetricList(
    target: "followup" | "schedules" | "active-awards",
  ) {
    setSearch("");
    setTypeFilter("전체 유형");
    setStatusFilter("전체 상태");
    setAwardFilter("전체 수주");
    setAwardSort("date-desc");
    setFollowupSort("activity-desc");
    navigateTo(
      target === "followup"
          ? "followup"
          : target === "schedules"
            ? "schedules"
            : "awards",
      {
        recordDateScope: "all",
        activeAwardsOnly: target === "active-awards",
        followupDueSoonOnly: target === "followup",
      },
    );
  }

  async function removeEditingRecord() {
    const record = records.find((item) => item.id === editingId);
    if (!record) return;
    const removed = await removeRecord(record);
    if (removed) {
      setModalOpen(false);
      setEditingId(null);
    }
  }

  function toggleOrganization(name: string) {
    setSelectedOrganizations((current) =>
      current.includes(name)
        ? current.filter((organization) => organization !== name)
        : [...current, name],
    );
  }

  async function removeSelectedOrganizations() {
    if (!selectedOrganizations.length) return;
    const affectedRecords = records.filter((record) =>
      selectedOrganizations.includes(record.organization),
    ).length;
    if (
      !window.confirm(
        `선택한 ${selectedOrganizations.length}개 기관의 기록 ${affectedRecords}건을 모두 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`,
      )
    ) {
      return;
    }
    try {
      const response = await fetch("/api/records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizations: selectedOrganizations }),
      });
      const payload = (await response.json()) as {
        deletedCount?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "기관 기록을 삭제하지 못했습니다.");
      }
      setRecords((current) =>
        current.filter(
          (record) => !selectedOrganizations.includes(record.organization),
        ),
      );
      setSelectedOrganizations([]);
      setToast(`${payload.deletedCount ?? affectedRecords}건을 일괄 삭제했습니다.`);
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "기관 기록을 삭제하지 못했습니다.",
      );
    }
  }

  function exportCsv() {
    const headers = [
      "날짜",
      "날짜 신뢰도",
      "활동 유형",
      "구분",
      "컨택 방식",
      "지역",
      "기관명",
      "예산 종류",
      "예산 금액",
      "주제",
      "요약",
      "상태",
      "온도",
      "수주 결과",
      "수주 업체",
      "사업 방식",
      "컨소 업체",
      "수주 현재 상태",
      "진행 담당자",
      "재연락 필요",
      "재연락 예정일",
      "다음 행동",
      "진행 일정",
      "기관 담당자",
      "기관 전화",
      "기관 메일",
      "출처",
      "메모",
      "입력자",
    ];
    const rows = filtered.map((record) =>
      [
        record.activityDate,
        record.dateConfidence,
        record.activityType,
        record.category,
        displayContactMethod(record),
        record.region,
        record.organization,
        record.budgetType,
        formatMoneyInput(record.budgetAmount),
        record.topic,
        record.summary,
        record.status,
        record.temperature,
        record.awardStatus,
        record.awardCompany,
        record.executionType,
        record.consortiumCompany,
        record.awardStage,
        record.progressManager,
        record.followUpRequired ? "예" : "아니오",
        record.followUpDate,
        record.nextAction,
        record.progressSchedule.replaceAll("\t", " "),
        record.contactName,
        record.contactPhone,
        record.contactEmail,
        record.sourceChat,
        record.notes,
        record.createdByName,
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob(["\uFEFF", headers.map(csvCell).join(","), "\r\n", rows.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `TM_미팅_관리표_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setToast("엑셀용 CSV 파일을 만들었습니다.");
  }

  const title =
    view === "dashboard"
      ? "영업 대시보드"
        : view === "records"
        ? recordDateScope === "recent"
          ? "최근 30일 활동"
          : "팀 활동 로그"
        : view === "followup"
          ? "기관별 관리"
          : view === "schedules"
            ? "다가오는 진행 일정"
          : view === "organizations"
            ? "기관별 활동 현황"
            : view === "awards"
              ? activeAwardsOnly
                ? "진행 중 수주"
                : "수주 관리"
              : view === "map"
                ? "영업·수주 지도"
              : view === "team"
                ? "구성원 승인·권한"
                : "공유 GPT 연결";

  if (sessionLoading) {
    return (
      <main className="access-shell">
        <div className="access-card loading-access">
          <div className="access-brand-logo" role="img" aria-label="WHIZZUP" />
          <p className="section-kicker">WHIZZUP SALES HUB</p>
          <h1>사용자 권한을 확인하고 있습니다</h1>
          <span className="access-spinner" />
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="access-shell">
        <div className="access-card">
          <div className="access-brand-logo" role="img" aria-label="WHIZZUP" />
          <h1>로그인 정보를 확인하지 못했습니다</h1>
          <p>{error || "잠시 후 다시 시도해 주세요."}</p>
          <button className="primary-button" onClick={() => window.location.reload()}>
            다시 확인
          </button>
        </div>
      </main>
    );
  }

  if (session.member.status !== "approved") {
    return (
      <main className="access-shell">
        <div className="access-card pending-access">
          <div className="access-brand-logo" role="img" aria-label="WHIZZUP" />
          <p className="section-kicker">ACCESS REQUESTED</p>
          <h1>
            {session.member.status === "suspended"
              ? "사용이 중지된 계정입니다"
              : "관리자 승인을 기다리고 있습니다"}
          </h1>
          <p>
            <strong>{identity.displayName}</strong>
            <br />
            {identity.email}
          </p>
          <div className="pending-note">
            관리자가 승인하면 같은 링크로 다시 접속해 공동 관리표를 사용할 수
            있습니다.
          </div>
          <div className="access-actions">
            <button className="ghost-button" onClick={() => window.location.reload()}>
              승인 상태 확인
            </button>
            <a className="text-link" href={signOutPath}>
              다른 계정으로 로그인
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-logo" role="img" aria-label="WHIZZUP" />
          <span className="brand-product">SALES HUB</span>
        </div>

        <nav className="main-nav" aria-label="주요 메뉴">
          <p>WORKSPACE</p>
          {navItems.map((item) => (
            <button
              className={view === item.id ? "active" : ""}
              key={item.id}
              onClick={() => void selectView(item.id)}
            >
              <span className="nav-mark">{item.mark}</span>
              {item.label}
            </button>
          ))}
          {(managementNavItems.length > 0 || isOwner) && (
            <div className="admin-nav-group">
              <p>
                ADMIN
                <span>{isOwner ? "대표관리자" : "보조관리자"}</span>
              </p>
              {managementNavItems.map((item) => (
                <button
                  className={`admin-nav-item ${view === item.id ? "active" : ""}`}
                  key={item.id}
                  onClick={() => void selectView(item.id)}
                >
                  <span className="nav-mark">{item.mark}</span>
                  {item.label}
                  {item.id === "team" && session.pendingCount > 0 && (
                    <em>{session.pendingCount}</em>
                  )}
                  <small>{isOwner ? "대표" : "보조"}</small>
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="sidebar-note">
          <span className="privacy-dot" />
          <div>
            <strong>승인된 구성원 전용</strong>
            <p>Google 로그인과 관리자 승인을 모두 확인합니다.</p>
          </div>
        </div>
        <div className="profile">
          <div className="avatar">{session.member.displayName.slice(0, 1)}</div>
          <div>
            <strong>{session.member.displayName}</strong>
            <span>
              {session.member.role === "admin"
                ? "대표관리자"
                : session.member.role === "assistant"
                  ? "보조관리자"
                  : "구성원"}{" "}
              ·{" "}
              <a href={signOutPath}>로그아웃</a>
            </span>
          </div>
        </div>
      </aside>

      {mobileNav && <button className="nav-scrim" aria-label="메뉴 닫기" onClick={() => setMobileNav(false)} />}

      <section className="workspace">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="메뉴 열기">
            ☰
          </button>
          <div className="global-search">
            <span>⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="기관명, 담당자, 주제 검색"
              aria-label="통합 검색"
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="top-actions">
            {canExportData && (
              <button
                className="ghost-button admin-export"
                onClick={exportCsv}
                title="허용된 전체 데이터 내보내기"
              >
                CSV 내보내기
              </button>
            )}
            <button className="ai-button" onClick={openAiRecorder}>
              <span>●</span> AI로 기록
            </button>
            <button className="primary-button" onClick={openNew}><span>＋</span> 새 기록</button>
          </div>
        </header>

        <div className={`content ${view === "followup" || view === "map" ? "content-wide" : ""}`}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">TM · MEETING MANAGEMENT</p>
              <h1>{title}</h1>
              <p>
                {view === "team"
                  ? "처음 로그인한 동료를 확인하고 공동 관리표 사용을 승인합니다."
                  : view === "integration"
                    ? "공유 GPT와 공동 관리표를 안전하게 연결합니다."
                    : view === "awards"
                      ? activeAwardsOnly
                        ? "완공되지 않은 수주 건만 모아 확인합니다."
                        : "위즈업 수주와 타업체 수주 결과를 함께 관리합니다."
                      : view === "map"
                        ? "기관 위치와 진행 상태를 확인하고, 방문할 학교를 선택해 영업 동선을 계획합니다."
                      : view === "schedules"
                        ? "오늘 이후 예정된 기관별 진행 일정을 모아 확인합니다."
                      : view === "records" && recordDateScope === "recent"
                          ? "최근 30일 동안 등록된 통화·미팅 기록만 확인합니다."
                        : view === "records"
                          ? "오늘 누가 어느 기관에 전화·방문·미팅했는지 시간순으로 확인합니다."
                    : "승인된 구성원이 통화·미팅 이력을 한곳에서 함께 관리합니다."}
              </p>
            </div>
            <div className="heading-meta">
              <span className="live-dot" />
              데이터 연결됨
            </div>
          </div>

          {error && (
            <div className="error-banner">
              <div><strong>데이터를 불러오지 못했습니다.</strong><span>{error}</span></div>
              <button onClick={() => void loadRecords()}>다시 시도</button>
            </div>
          )}

          {view === "dashboard" && (
            <>
              <section className="ai-record-panel" aria-labelledby="ai-record-title">
                <div className="ai-record-copy">
                  <span className="ai-orb" aria-hidden="true">●</span>
                  <div>
                    <span className="section-kicker">AI QUICK RECORD</span>
                    <h2 id="ai-record-title">미팅·통화 내용을 편하게 남겨보세요</h2>
                    <p>내용을 편하게 적으면 AI가 기관별 기록·일정·제안 품목을 정리합니다.</p>
                  </div>
                </div>
                <div className="ai-record-entry">
                  <textarea
                    ref={aiDraftInputRef}
                    rows={2}
                    value={aiDraft}
                    onChange={(event) => setAiDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.nativeEvent.isComposing) {
                        return;
                      }
                      if (event.ctrlKey) {
                        event.preventDefault();
                        const textarea = event.currentTarget;
                        const lineBreakPosition = textarea.selectionStart + 1;
                        setAiDraft(
                          `${aiDraft.slice(0, textarea.selectionStart)}\n${aiDraft.slice(textarea.selectionEnd)}`,
                        );
                        requestAnimationFrame(() =>
                          textarea.setSelectionRange(
                            lineBreakPosition,
                            lineBreakPosition,
                          ),
                        );
                        return;
                      }
                      event.preventDefault();
                      void startAiRecord();
                    }}
                    aria-label="AI에 전달할 기록 내용"
                    disabled={aiOrganizing}
                  />
                  <div className="ai-record-actions">
                    <button
                      type="button"
                      className="ai-submit-button"
                      onClick={() => void startAiRecord()}
                      disabled={!aiDraft.trim() || aiOrganizing}
                    >
                      <span aria-hidden="true">●</span>
                      {aiOrganizing
                        ? "AI 정리 중…"
                        : session?.aiConfigured === false
                          ? "API 연결 필요"
                          : "사이트에서 AI 정리"}
                    </button>
                  </div>
                </div>
                <small>
                  Enter는 AI 정리, Ctrl+Enter는 줄바꿈이며 저장 전 내용을 직접
                  확인할 수 있습니다.
                </small>
                {session?.aiConfigured === false && (
                  <div className="ai-connection-note">
                    <span>API 연결 준비 중</span>
                    관리자에게 사이트 AI API 연결 상태를 확인해 주세요.
                  </div>
                )}
                {aiError && <div className="ai-inline-error">{aiError}</div>}
                {(aiMessages.length > 0 || aiOrganizing) && (
                  <div className="ai-chat-thread" aria-live="polite">
                    {aiMessages.map((message, index) => (
                      <div
                        className={`ai-chat-message ${message.role}`}
                        key={`${message.role}-${index}`}
                      >
                        <b>{message.role === "user" ? "나" : "AI"}</b>
                        <p>{message.text}</p>
                      </div>
                    ))}
                    {aiOrganizing && (
                      <div className="ai-chat-message assistant is-loading">
                        <b>AI</b>
                        <p>입력한 내용을 관리표 항목에 맞춰 정리하고 있습니다…</p>
                      </div>
                    )}
                  </div>
                )}
                {aiPreviews.length > 0 && (
                  <section className="ai-preview-batch">
                    <div className="ai-preview-batch-header">
                      <div>
                        <span>기관별 분석 완료</span>
                        <strong>{aiPreviews.length}개 기관으로 나눴습니다</strong>
                      </div>
                      <div>
                        {aiPreviews.length > 1 && (
                          <button
                            type="button"
                            className="ai-preview-batch-save"
                            onClick={() => void saveAiPreviewBatch()}
                            disabled={aiBatchSaving}
                          >
                            {aiBatchSaving
                              ? "기관별 저장 중…"
                              : `${aiPreviews.length}개 기관 한 번에 저장`}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setAiPreviews([]);
                            setAiMessages([]);
                            setAiError("");
                          }}
                          disabled={aiBatchSaving}
                        >
                          전체 다시 입력
                        </button>
                      </div>
                    </div>
                    <div className="ai-preview-list">
                      {aiPreviews.map((aiPreview, index) => (
                        <article
                          className="ai-preview-card"
                          key={`${aiPreview.organization}-${index}`}
                        >
                          <div className="ai-preview-header">
                            <div>
                              <span>저장 전 확인</span>
                              <h3>{aiPreview.organization}</h3>
                            </div>
                            <em>{aiPreview.activityType || "활동 유형 미정"}</em>
                          </div>
                          <div className="ai-preview-grid">
                            <div><span>날짜</span><strong>{formatDate(aiPreview.activityDate)}</strong></div>
                            <div><span>컨택</span><strong>{aiPreview.contactMethod || "—"}</strong></div>
                            <div><span>지역</span><strong>{aiPreview.region || "—"}</strong></div>
                            <div><span>예산</span><strong>{[aiPreview.budgetType, formatMoneyInput(aiPreview.budgetAmount)].filter(Boolean).join(" · ") || "—"}</strong></div>
                            <div><span>상태</span><strong>{aiPreview.status || "—"}</strong></div>
                            <div><span>수주</span><strong>{aiPreview.awardStatus || "미정"}</strong></div>
                            <div><span>사업방식</span><strong>{[aiPreview.executionType, aiPreview.consortiumCompany].filter((value) => value && value !== "미정").join(" · ") || "미정"}</strong></div>
                            <div><span>수주 현재 상태</span><strong>{aiPreview.awardStage || "미정"}</strong></div>
                            <div><span>진행 담당자</span><strong>{aiPreview.progressManager || "미정"}</strong></div>
                          </div>
                          <p className="ai-preview-summary">
                            {aiPreview.summary || "요약 내용이 없습니다. 확인 화면에서 보완해 주세요."}
                          </p>
                          <div className="ai-preview-equipment">
                            <span>
                              사업 자동 연결 ·{" "}
                              {aiPreview.equipmentProjectName || "사업명 미입력"}
                              {" · "}
                              {aiPreview.equipmentProjectStatus || "제안"}
                            </span>
                            {aiPreview.equipmentItems.length > 0 ? (
                              aiPreview.equipmentItems.map((item) => (
                                <div
                                  key={`${item.productName}-${item.specification}`}
                                >
                                  <strong>{item.productName}</strong>
                                  <small>
                                    {item.specification
                                      ? `${item.specification} · `
                                      : ""}
                                    제안 {item.proposedQty}{item.unit} · 수주{" "}
                                    {item.awardedQty}{item.unit} · 설치{" "}
                                    {item.installedQty}{item.unit}
                                  </small>
                                </div>
                              ))
                            ) : (
                              <small>품목은 내용에 언급된 경우에만 자동 추가됩니다.</small>
                            )}
                          </div>
                          {parseProgressSchedule(aiPreview.progressSchedule).length > 0 && (
                            <div className="ai-preview-schedule">
                              <span>진행 일정</span>
                              {parseProgressSchedule(aiPreview.progressSchedule).map((item) => (
                                <b key={`${item.label}-${item.date}`}>
                                  {item.label} {formatScheduleDate(item.date)}
                                </b>
                              ))}
                            </div>
                          )}
                          <div className="ai-preview-actions">
                            <button
                              type="button"
                              className="ai-preview-primary"
                              onClick={() => {
                                setEditingId(null);
                                setCreatingAward(false);
                                setForm(aiPreview);
                                setModalOpen(true);
                              }}
                            >
                              {aiPreviews.length === 1
                                ? "내용 확인·저장"
                                : "개별 확인·수정"}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                )}
              </section>

              <section className="metric-grid" aria-label="핵심 지표">
                <button
                  type="button"
                  className="metric-card accent-coral"
                  onClick={() => openMetricList("followup")}
                  aria-label={`2일 내 재연락 기관 ${dueSoonFollowups.length}곳 목록 보기`}
                >
                  <div className="metric-top"><span>2일 내 재연락</span><i>01</i></div>
                  <strong>{loading ? "—" : dueSoonFollowups.length}</strong>
                  <p>기한 경과 포함 · 예정일 입력 기관</p>
                  <span className="metric-link">목록 보기 →</span>
                </button>
                <button
                  type="button"
                  className="metric-card accent-green"
                  onClick={() => openMetricList("schedules")}
                  aria-label={`다가오는 진행 일정 ${upcomingProgressScheduleCount}건 목록 보기`}
                >
                  <div className="metric-top"><span>다가오는 진행 일정</span><i>02</i></div>
                  <strong>{loading ? "—" : upcomingProgressScheduleCount}</strong>
                  <p><b>{upcomingProgressSchedules.length}</b>개 기관의 예정 일정</p>
                  <span className="metric-link">목록 보기 →</span>
                </button>
                <button
                  type="button"
                  className="metric-card accent-violet"
                  onClick={() => openMetricList("active-awards")}
                  aria-label={`진행 중 수주 ${activeAwardOrganizationCount}곳 목록 보기`}
                >
                  <div className="metric-top"><span>진행 중 수주</span><i>03</i></div>
                  <strong>{loading ? "—" : activeAwardOrganizationCount}</strong>
                  <p>완공 전 기관</p>
                  <span className="metric-link">목록 보기 →</span>
                </button>
              </section>

              <section className="dashboard-grid schedule-dashboard-grid">
                <article className="panel schedule-panel">
                  <div className="panel-header">
                    <div><span className="section-kicker">PROGRESS CALENDAR</span><h2>수주 후 진행 일정표</h2></div>
                    <span className="period-label">{progressSchedules.length}개 기관 · {progressScheduleCount}개 일정</span>
                  </div>
                  <div className="schedule-list">
                    <div className="schedule-head" aria-hidden="true">
                      <span>학교·기관</span>
                      <span>진행 일정</span>
                    </div>
                    {progressSchedules.map((row) => (
                      <div className="schedule-row" key={row.organization}>
                        <strong>{row.organization}</strong>
                        <div className="schedule-dates">
                          {row.items.map((item) => (
                            <span
                              className="schedule-chip"
                              key={`${row.organization}-${item.label}-${item.date}`}
                              title={`${item.label} ${item.date}`}
                            >
                              <small>{item.label}</small>
                              <b>{formatScheduleDate(item.date)}</b>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                    {!loading && progressSchedules.length === 0 && (
                      <div className="empty-state schedule-empty">
                        AI 기록에 “목공 6/17일 시스템 6/19일”처럼 입력하면 수주 구분과 관계없이 기관별 일정이 여기에 표시됩니다.
                      </div>
                    )}
                  </div>
                </article>

              </section>
            </>
          )}

          {view === "map" ? (
            <SalesMapPage
              records={records}
              isAdmin={canManageMap}
              search={search}
              onSearchChange={setSearch}
              onOpenOrganization={setDetailOrganization}
              onRecordsChanged={loadRecords}
            />
          ) : view === "schedules" ? (
            <section className="panel schedule-panel schedule-list-page">
              <div className="panel-header">
                <div>
                  <span className="section-kicker">UPCOMING SCHEDULE</span>
                  <h2>다가오는 진행 일정</h2>
                </div>
                <span className="record-count">
                  {upcomingProgressSchedules.length}개 기관 ·{" "}
                  {upcomingProgressScheduleCount}개 일정
                </span>
              </div>
              <div className="schedule-list">
                <div className="schedule-head" aria-hidden="true">
                  <span>학교·기관</span>
                  <span>오늘 이후 진행 일정</span>
                </div>
                {upcomingProgressSchedules.map((row) => (
                  <button
                    type="button"
                    className="schedule-row schedule-row-button"
                    key={row.organization}
                    onClick={() => setDetailOrganization(row.organization)}
                    aria-label={`${row.organization} 일정과 이전 히스토리 보기`}
                  >
                    <strong>{row.organization}</strong>
                    <span className="schedule-dates">
                      {row.items.map((item) => (
                        <span
                          className="schedule-chip"
                          key={`${row.organization}-${item.label}-${item.date}`}
                          title={`${item.label} ${item.date}`}
                        >
                          <small>{item.label}</small>
                          <b>{formatScheduleDate(item.date)}</b>
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
                {!loading && upcomingProgressSchedules.length === 0 && (
                  <div className="empty-state schedule-empty">
                    오늘 이후 예정된 진행 일정이 없습니다.
                  </div>
                )}
              </div>
            </section>
          ) : view === "team" ? (
            <section className="team-layout">
              <article className="panel team-guide">
                <div className="panel-header">
                  <div>
                    <span className="section-kicker">INVITE FLOW</span>
                    <h2>동료 초대 방법</h2>
                  </div>
                  <span className="record-count">{session.approvedCount}명 사용 중</span>
                </div>
                <div className="invite-flow">
                  <div><b>01</b><strong>링크 전달</strong><p>현재 관리사이트 주소를 동료에게 보냅니다.</p></div>
                  <div><b>02</b><strong>Google 로그인</strong><p>동료가 자기 Google 계정으로 처음 접속합니다.</p></div>
                  <div><b>03</b><strong>대표 승인</strong><p>아래 승인 대기 목록에서 사용을 허용합니다.</p></div>
                </div>
                <button
                  className="copy-invite"
                  onClick={() =>
                    void copyText(
                      window.location.origin,
                      "동료에게 보낼 사이트 주소를 복사했습니다.",
                    )
                  }
                >
                  사이트 초대 링크 복사
                </button>
              </article>

              <article className="panel members-panel">
                <div className="panel-header">
                  <div>
                    <span className="section-kicker">TEAM ACCESS</span>
                    <h2>구성원 승인·권한</h2>
                  </div>
                  <button onClick={() => void loadTeam()}>새로고침</button>
                </div>
                {teamLoading ? (
                  <div className="loading-state"><i /><span>구성원을 확인하는 중입니다</span></div>
                ) : (
                  <div className="member-list">
                    {teamMembers.map((member) => (
                      <div className="member-row" key={member.id}>
                        <span className={`member-avatar member-${member.status}`}>
                          {member.displayName.slice(0, 1)}
                        </span>
                        <div className="member-main">
                          <div className="member-name-editor">
                            <input
                              aria-label={`${member.email} 표시 이름`}
                              disabled={!isOwner && member.role !== "member"}
                              maxLength={40}
                              value={member.displayName}
                              onChange={(event) =>
                                setTeamMembers((current) =>
                                  current.map((item) =>
                                    item.id === member.id
                                      ? { ...item, displayName: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  void updateMemberDisplayName(member);
                                }
                              }}
                            />
                            <button
                              type="button"
                              disabled={!isOwner && member.role !== "member"}
                              onClick={() => void updateMemberDisplayName(member)}
                            >
                              이름 저장
                            </button>
                          </div>
                          <small>{member.email}</small>
                        </div>
                        <div className="member-meta">
                          <span className={`member-status ${member.status}`}>
                            {member.status === "approved"
                              ? "사용 중"
                              : member.status === "suspended"
                                ? "사용 중지"
                                : "승인 대기"}
                          </span>
                          <small>
                            {member.role === "admin"
                              ? "대표관리자"
                              : member.role === "assistant"
                                ? "보조관리자"
                                : "구성원"}
                          </small>
                        </div>
                        <div className="member-actions">
                          {member.id === session.member.id ? (
                            <span>현재 계정</span>
                          ) : !isOwner && member.role !== "member" ? (
                            <span>대표관리자만 변경</span>
                          ) : member.status === "pending" ? (
                            <>
                              <button
                                className="approve"
                                onClick={() => void updateMember(member, "approved")}
                              >
                                승인
                              </button>
                              <button
                                onClick={() => void updateMember(member, "suspended")}
                              >
                                거절
                              </button>
                            </>
                          ) : member.status === "approved" ? (
                            <button
                              className="suspend"
                              onClick={() => void updateMember(member, "suspended")}
                            >
                              사용 중지
                            </button>
                          ) : (
                            <button
                              className="approve"
                              onClick={() => void updateMember(member, "approved")}
                            >
                              다시 승인
                            </button>
                          )}
                        </div>
                        {isOwner && member.role !== "admin" && (
                          <div className="member-access-editor">
                            <label className="member-role-select">
                              <span>역할</span>
                              <select
                                aria-label={`${member.displayName} 역할`}
                                value={member.role}
                                onChange={(event) => {
                                  const role =
                                    event.target.value === "assistant"
                                      ? "assistant"
                                      : "member";
                                  setTeamMembers((current) =>
                                    current.map((item) =>
                                      item.id === member.id
                                        ? {
                                            ...item,
                                            role,
                                            permissions:
                                              role === "assistant"
                                                ? item.permissions.length
                                                  ? item.permissions
                                                  : ["records:manage", "map:manage"]
                                                : [],
                                          }
                                        : item,
                                    ),
                                  );
                                }}
                              >
                                <option value="member">일반 구성원</option>
                                <option value="assistant">보조관리자</option>
                              </select>
                            </label>
                            <div className="member-permission-list">
                              {memberPermissionOptions.map((option) => (
                                <label
                                  className={
                                    member.role === "assistant" ? "" : "disabled"
                                  }
                                  key={option.id}
                                >
                                  <input
                                    type="checkbox"
                                    checked={member.permissions.includes(option.id)}
                                    disabled={member.role !== "assistant"}
                                    onChange={(event) =>
                                      setTeamMembers((current) =>
                                        current.map((item) =>
                                          item.id === member.id
                                            ? {
                                                ...item,
                                                permissions: event.target.checked
                                                  ? [
                                                      ...new Set([
                                                        ...item.permissions,
                                                        option.id,
                                                      ]),
                                                    ]
                                                  : item.permissions.filter(
                                                      (permission) =>
                                                        permission !== option.id,
                                                    ),
                                              }
                                            : item,
                                        ),
                                      )
                                    }
                                  />
                                  <span>
                                    <b>{option.label}</b>
                                    <small>{option.description}</small>
                                  </span>
                                </label>
                              ))}
                            </div>
                            <button
                              type="button"
                              className="save-access"
                              onClick={() => void saveMemberAccess(member)}
                            >
                              역할·권한 저장
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {!teamMembers.length && (
                      <div className="empty-state large">
                        아직 접속한 동료가 없습니다.
                      </div>
                    )}
                  </div>
                )}
              </article>
            </section>
          ) : view === "integration" ? (
            <section className="integration-layout">
              <article className="panel integration-intro">
                <div className="integration-hero">
                  <div>
                    <span className="section-kicker">VOICE TO CRM</span>
                    <h2>말로 설명하고, 확인 후 공동 관리표에 저장</h2>
                    <p>
                      공유 GPT는 사용자의 ChatGPT에서 내용을 정리하고, 승인된
                      본인 이름으로 이 시스템에 기록합니다.
                    </p>
                  </div>
                  <button className="ai-launch-large" onClick={openSharedGpt}>
                    <span>●</span>
                    {session.sharedGptUrl ? "공유 GPT 열기" : "GPT 연결 준비"}
                  </button>
                </div>
                <div className="integration-flow">
                  <span>음성·텍스트 입력</span><i>→</i>
                  <span>GPT 구조화</span><i>→</i>
                  <span>사용자 확인</span><i>→</i>
                  <span>공동 관리표 저장</span>
                </div>
              </article>

              <div className="integration-grid">
                <article className="panel setup-card">
                  <div className="setup-number">01</div>
                  <h3>OAuth 연결키</h3>
                  <p>공유 GPT가 사용자별 승인을 받을 때 사용하는 연결 정보입니다.</p>
                  {oauthClient ? (
                    <div className="credential-box">
                      <label>
                        <span>Client ID</span>
                        <div><code>{oauthClient.client_id}</code><button onClick={() => void copyText(oauthClient.client_id)}>복사</button></div>
                      </label>
                      {oauthSecret ? (
                        <label className="secret-once">
                          <span>Client Secret · 지금 한 번만 표시</span>
                          <div><code>{oauthSecret}</code><button onClick={() => void copyText(oauthSecret)}>복사</button></div>
                        </label>
                      ) : (
                        <p className="secret-note">비밀키는 보안을 위해 다시 표시하지 않습니다.</p>
                      )}
                      <button className="outline-danger" onClick={() => void generateOAuthClient()}>
                        연결키 다시 발급
                      </button>
                    </div>
                  ) : (
                    <button className="setup-primary" onClick={() => void generateOAuthClient()}>
                      첫 연결키 발급
                    </button>
                  )}
                </article>

                <article className="panel setup-card">
                  <div className="setup-number">02</div>
                  <h3>GPT Actions 주소</h3>
                  <p>GPT 만들기 화면의 인증과 스키마 항목에 아래 주소를 사용합니다.</p>
                  <div className="endpoint-list">
                    {[
                      ["Authorization URL", "/oauth/authorize"],
                      ["Token URL", "/api/oauth/token"],
                      ["OpenAPI Schema", "/gpt-action-openapi.yaml"],
                      ["Privacy Policy", "/privacy"],
                    ].map(([label, path]) => (
                      <div key={path}>
                        <span>{label}</span>
                        <code>{path}</code>
                        <button onClick={() => void copyText(new URL(path, window.location.origin).toString())}>주소 복사</button>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="panel setup-card setup-wide">
                  <div className="setup-number">03</div>
                  <h3>공유 GPT 지침</h3>
                  <p>GPT 만들기 화면의 ‘지침’에 붙여 넣을 기본 문구입니다.</p>
                  <div className="instruction-box">
                    <pre>{gptInstructions}</pre>
                    <button onClick={() => void copyText(gptInstructions)}>
                      지침 전체 복사
                    </button>
                  </div>
                </article>

                <article className="panel setup-card setup-wide">
                  <div className="setup-number">04</div>
                  <h3>완성된 GPT 링크 등록</h3>
                  <p>GPT를 만든 뒤 공유 링크를 저장하면 모든 구성원의 ‘AI로 기록’ 버튼에 연결됩니다.</p>
                  <div className="gpt-url-row">
                    <input
                      value={sharedGptUrl}
                      onChange={(event) => setSharedGptUrl(event.target.value)}
                      placeholder="https://chatgpt.com/g/..."
                    />
                    <button onClick={() => void saveSharedGptUrl()}>링크 저장</button>
                  </div>
                </article>
              </div>
            </section>
          ) : view === "organizations" ? (
            <section className="panel organization-panel">
              <div className="panel-header organization-header">
                <div><span className="section-kicker">ORGANIZATIONS</span><h2>기관·파트너별 접점</h2></div>
                <div className="organization-header-actions">
                  <span className="record-count">{organizations.length}곳</span>
                  {canManageRecords && (
                    <>
                      <button
                        className="organization-select-all"
                        onClick={() =>
                          setSelectedOrganizations(
                            selectedOrganizations.length === organizations.length
                              ? []
                              : organizations.map((organization) => organization.name),
                          )
                        }
                      >
                        {selectedOrganizations.length === organizations.length &&
                        organizations.length > 0
                          ? "선택 해제"
                          : "전체 선택"}
                      </button>
                      <button
                        className="organization-bulk-delete"
                        disabled={!selectedOrganizations.length}
                        onClick={() => void removeSelectedOrganizations()}
                      >
                        선택 삭제
                        {selectedOrganizations.length > 0
                          ? ` ${selectedOrganizations.length}`
                          : ""}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="organization-grid">
                {organizations.map((organization) => (
                  <article
                    className={`organization-card ${
                      selectedOrganizations.includes(organization.name)
                        ? "selected"
                        : ""
                    }`}
                    key={organization.name}
                  >
                    {canManageRecords && (
                      <label className="organization-check">
                        <input
                          type="checkbox"
                          checked={selectedOrganizations.includes(
                            organization.name,
                          )}
                          onChange={() => toggleOrganization(organization.name)}
                        />
                        <span>선택</span>
                      </label>
                    )}
                    <div className="organization-card-top">
                      <span className={`org-avatar temp-${organization.temperature}`}>{organization.name.slice(0, 1)}</span>
                      <div><strong>{organization.name}</strong><small>최근 {formatDate(organization.lastDate)}</small></div>
                    </div>
                    <div className="org-stats"><span>활동 <b>{organization.count}</b></span><span>재연락 <b>{organization.followups}</b></span><span>수주 결과 <b>{organization.awardResults}</b></span></div>
                  </article>
                ))}
              </div>
            </section>
          ) : view === "followup" ? (
            <section className="panel records-panel followup-management">
              <div className="panel-header records-heading">
                <div>
                  <span className="section-kicker">CONTACT MANAGEMENT</span>
                  <h2>
                    {followupDueSoonOnly
                      ? "2일 내 재연락 기관"
                      : "기관별 관리 현황"}
                  </h2>
                </div>
                <span className="record-count">{followupRows.length}곳</span>
              </div>
              <div className="filter-row">
                <div className="inline-search">
                  <span>⌕</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="기관·담당자·메일·지역·예산 검색"
                  />
                </div>
                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                  aria-label="활동 유형 필터"
                >
                  <option>전체 유형</option>
                  {[...new Set(records.map((record) => record.activityType))]
                    .sort()
                    .map((type) => <option key={type}>{type}</option>)}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  aria-label="상태 필터"
                >
                  <option>전체 상태</option>
                  {[...new Set(records.map((record) => record.status))]
                    .sort()
                    .map((status) => <option key={status}>{status}</option>)}
                </select>
                <select
                  value={awardFilter}
                  onChange={(event) => setAwardFilter(event.target.value)}
                  aria-label="수주 결과 필터"
                >
                  <option value="전체 수주">전체</option>
                  <option>위즈업 수주</option>
                  <option>타업체 수주</option>
                  <option>미정</option>
                </select>
                <select
                  className="sort-select"
                  value={followupSort}
                  onChange={(event) => setFollowupSort(event.target.value)}
                  aria-label="기관별 관리 정렬"
                >
                  <option value="activity-desc">최종 컨택 최신순</option>
                  <option value="followup-asc">재연락 예정일 임박순</option>
                  <option value="activity-asc">최종 컨택 오래된순</option>
                  <option value="organization">기관명순</option>
                  <option value="amount-desc">금액 높은순</option>
                  <option value="amount-asc">금액 낮은순</option>
                </select>
                {(search ||
                  typeFilter !== "전체 유형" ||
                  statusFilter !== "전체 상태" ||
                  awardFilter !== "전체 수주" ||
                  followupSort !== "activity-desc" ||
                  followupDueSoonOnly) && (
                  <button
                    className="reset-filter"
                    onClick={() => {
                      setSearch("");
                      setTypeFilter("전체 유형");
                      setStatusFilter("전체 상태");
                      setAwardFilter("전체 수주");
                      setFollowupSort("activity-desc");
                      setFollowupDueSoonOnly(false);
                    }}
                  >
                    초기화
                  </button>
                )}
              </div>
              <div className="table-wrap">
                <table className="followup-table">
                  <thead>
                    <tr>
                      <th>순번</th>
                      <th>최종 컨택일</th>
                      <th>지역</th>
                      <th>기관명</th>
                      <th>기관 담당자</th>
                      <th>기관 메일</th>
                      <th>예산 종류</th>
                      <th>금액</th>
                      <th>내용 요약</th>
                      <th>사업방식</th>
                      <th>수주</th>
                      <th>진행 담당자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {followupRows.map((record, index) => (
                      <tr
                        className="followup-contact-row"
                        key={record.organization}
                        tabIndex={0}
                        role="button"
                        aria-label={`${record.organization} 상세와 이전 히스토리 보기`}
                        onClick={() => setDetailOrganization(record.organization)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setDetailOrganization(record.organization);
                          }
                        }}
                      >
                        <td className="sequence-cell">{index + 1}</td>
                        <td>
                          <span className="date-cell">
                            {formatDate(record.activityDate)}
                          </span>
                          <small>
                            {record.followUpDate
                              ? `재연락 ${formatDate(record.followUpDate)}`
                              : "재연락일 미정"}
                          </small>
                        </td>
                        <td>
                          <span className="region-cell">{record.region || "—"}</span>
                        </td>
                        <td>
                          <strong className="org-name">{record.organization}</strong>
                          <small>{record.category}</small>
                        </td>
                        <td>
                          <strong className="contact-person-cell">
                            {record.contactName || "미등록"}
                          </strong>
                          <small>
                            {record.contactPhone || "전화 미등록"}
                          </small>
                        </td>
                        <td>
                          <span className="institution-email-cell">
                            {record.contactEmail || "미등록"}
                          </span>
                        </td>
                        <td>
                          <span className="budget-cell">
                            {record.budgetType || "미정"}
                          </span>
                        </td>
                        <td>
                          <strong className="budget-amount">
                            {formatMoneyInput(record.budgetAmount) || "미정"}
                          </strong>
                        </td>
                        <td>
                          <strong className="followup-summary">
                            {record.summary || record.topic || "내용 미입력"}
                          </strong>
                          <small>{record.nextAction || "다음 행동 미지정"}</small>
                        </td>
                        <td>
                          <span
                            className={`execution-pill ${
                              record.executionType === "컨소"
                                ? "consortium"
                                : record.executionType === "직영"
                                  ? "direct"
                                  : "pending"
                            }`}
                          >
                            {record.executionType || "미정"}
                          </span>
                          {record.executionType === "컨소" && (
                            <small>{record.consortiumCompany || "업체명 미입력"}</small>
                          )}
                        </td>
                        <td>
                          {record.awardStatus === "미정" ? (
                            <span className="award-pill pending">미정</span>
                          ) : (
                            <>
                              <span
                                className={`award-pill ${
                                  record.awardStatus === "위즈업 수주"
                                    ? "ours"
                                    : "other"
                                }`}
                              >
                                {record.awardStatus}
                              </span>
                              <small>{record.awardCompany}</small>
                            </>
                          )}
                        </td>
                        <td>
                          <strong className="progress-manager-cell">
                            {record.progressManager || "미등록"}
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {loading && (
                  <div className="loading-state">
                    <i />
                    <span>기록을 불러오는 중입니다</span>
                  </div>
                )}
                {!loading && followupRows.length === 0 && (
                  <div className="empty-state large">
                    현재 재연락할 기관이 없습니다.
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className={`panel records-panel ${view === "dashboard" ? "dashboard-records" : ""}`}>
              <div className="panel-header records-heading">
                <div>
                  <span className="section-kicker">ACTIVITY LOG</span>
                  <h2>{view === "awards" ? activeAwardsOnly ? "진행 중 수주 목록" : "수주 관리 현황" : view === "dashboard" ? "최근 활동 이력" : recordDateScope === "recent" ? "최근 30일 활동 기록" : "팀 전체 활동 기록"}</h2>
                </div>
                <div className="records-heading-actions">
                  {view === "awards" && (
                    <button
                      type="button"
                      className="award-register-button"
                      onClick={openNewAward}
                    >
                      <span>＋</span>
                      수주 등록
                    </button>
                  )}
                  <span className="record-count">
                    {view === "dashboard"
                      ? `최신 ${dashboardRecentRecords.length}건`
                      : `${filtered.length}건`}
                  </span>
                </div>
              </div>
              {view !== "dashboard" && (
                <div className="filter-row">
                  <div className="inline-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="목록에서 검색" /></div>
                  {view !== "awards" && (
                    <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="활동 유형 필터">
                      <option>전체 유형</option>
                      {[...new Set(records.map((record) => record.activityType))].sort().map((type) => <option key={type}>{type}</option>)}
                    </select>
                  )}
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label={view === "awards" ? "현재 상태 필터" : "상태 필터"}>
                    <option>전체 상태</option>
                    {[...new Set(records.map((record) => view === "awards" ? record.awardStage : record.status))].filter(Boolean).sort().map((status) => <option key={status}>{status}</option>)}
                  </select>
                  <select value={awardFilter} onChange={(event) => setAwardFilter(event.target.value)} aria-label="수주 결과 필터">
                    <option>전체 수주</option>
                    <option>위즈업 수주</option>
                    <option>타업체 수주</option>
                    <option>미정</option>
                  </select>
                  {view === "awards" && (
                    <select
                      className="sort-select"
                      value={awardSort}
                      onChange={(event) => setAwardSort(event.target.value)}
                      aria-label="수주 관리 정렬"
                    >
                      <option value="date-desc">최신순</option>
                      <option value="date-asc">오래된순</option>
                      <option value="amount-desc">금액 높은순</option>
                      <option value="amount-asc">금액 낮은순</option>
                      <option value="organization">기관명순</option>
                      <option value="stage">진행 상태순</option>
                    </select>
                  )}
                  {(search || (view !== "awards" && typeFilter !== "전체 유형") || statusFilter !== "전체 상태" || awardFilter !== "전체 수주" || (view === "awards" && (awardSort !== "date-desc" || activeAwardsOnly)) || (view === "records" && recordDateScope !== "all")) && (
                    <button className="reset-filter" onClick={() => { setSearch(""); setTypeFilter("전체 유형"); setStatusFilter("전체 상태"); setAwardFilter("전체 수주"); setAwardSort("date-desc"); setRecordDateScope("all"); setActiveAwardsOnly(false); }}>초기화</button>
                  )}
                </div>
              )}

              <div className="table-wrap">
                <table className={view === "awards" ? "awards-table" : view === "records" ? "records-table" : undefined}>
                  <thead>
                    {view === "awards" ? (
                      <tr>
                        <th>순번</th>
                        <th>날짜</th>
                        <th>기관</th>
                        <th>사업방식</th>
                        <th>수주 업체</th>
                        <th>수주 금액</th>
                        <th>진행 담당자</th>
                        <th>현재 상태</th>
                        <th>진행 내용</th>
                      </tr>
                    ) : view === "records" ? (
                      <tr><th>순번</th><th>날짜</th><th>기관·파트너</th><th>활동</th><th>주제 / 다음 행동</th><th>상태</th><th>수주</th><th>재연락</th><th><span className="sr-only">관리</span></th></tr>
                    ) : (
                      <tr><th>날짜</th><th>기관·파트너</th><th>활동</th><th>내용</th><th>진행 담당자</th><th>상태</th><th>수주</th><th>재연락</th><th><span className="sr-only">관리</span></th></tr>
                    )}
                  </thead>
                  <tbody>
                    {(view === "dashboard" ? dashboardRecentRecords : displayedRecords).map((record, index) =>
                      view === "awards" ? (
                        <tr
                          className="award-record-row"
                          key={record.id}
                          tabIndex={0}
                          role="button"
                          aria-label={`${record.organization} 수주 진행 내용 수정`}
                          onClick={() => openEdit(record)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openEdit(record);
                            }
                          }}
                        >
                          <td className="sequence-cell">{index + 1}</td>
                          <td><span className="date-cell">{formatDate(record.activityDate)}</span></td>
                          <td><strong className="org-name">{record.organization}</strong><small>{record.region || record.category}</small></td>
                          <td>
                            <span className={`execution-pill ${record.executionType === "컨소" ? "consortium" : record.executionType === "직영" ? "direct" : "pending"}`}>
                              {record.executionType || "미정"}
                            </span>
                            {record.executionType === "컨소" && (
                              <small>{record.consortiumCompany || "업체명 미입력"}</small>
                            )}
                          </td>
                          <td>
                            <strong className="award-company">{record.awardCompany || "미정"}</strong>
                            <small>{record.awardStatus}</small>
                          </td>
                          <td>
                            <strong className="budget-amount">
                              {formatMoneyInput(record.budgetAmount) || "미정"}
                            </strong>
                            <small>{record.budgetType || "예산 종류 미정"}</small>
                          </td>
                          <td>
                            <strong className="progress-manager-cell">
                              {record.progressManager || "미등록"}
                            </strong>
                          </td>
                          <td>
                            <span className={`award-stage stage-${record.awardStage.replaceAll(" ", "-")}`}>
                              {record.awardStage || "미정"}
                            </span>
                          </td>
                          <td><strong className="topic-cell">{record.nextAction || record.summary || "진행 내용 미입력"}</strong><small>{record.topic || record.activityType}</small></td>
                        </tr>
                      ) : (
                        <tr key={record.id}>
                          {view === "records" && (
                            <td className="sequence-cell">{index + 1}</td>
                          )}
                          <td><span className="date-cell">{formatDate(record.activityDate)}</span></td>
                          <td><strong className="org-name">{record.organization}</strong><small>{record.category}</small></td>
                          <td><span className="type-pill">{record.activityType}</span></td>
                          <td>
                            {view === "dashboard" ? (
                              <button
                                type="button"
                                className="activity-detail-link"
                                onClick={() =>
                                  setDetailOrganization(record.organization)
                                }
                                aria-label={`${record.organization} 상세와 이전 이력 보기`}
                              >
                                <strong className="topic-cell">
                                  {record.summary || record.topic || "내용 미입력"}
                                </strong>
                                <small>{record.topic || record.activityType}</small>
                              </button>
                            ) : (
                              <>
                                <strong className="topic-cell">{record.topic || "내용 미입력"}</strong>
                                <small>{record.nextAction || record.summary || "다음 행동 미지정"}</small>
                              </>
                            )}
                          </td>
                          {view === "dashboard" && (
                            <td>
                              <strong className="progress-manager-cell">
                                {record.progressManager || "미등록"}
                              </strong>
                            </td>
                          )}
                          <td><span className={`status-pill ${statusClass(record.status)}`}>{record.status}</span></td>
                          <td>
                            {record.awardStatus === "미정" ? (
                              <span className="award-pill pending">미정</span>
                            ) : (
                              <>
                                <span className={`award-pill ${record.awardStatus === "위즈업 수주" ? "ours" : "other"}`}>{record.awardStatus}</span>
                                <small>{record.awardCompany}</small>
                              </>
                            )}
                          </td>
                          <td><span className={record.followUpRequired ? "follow-yes" : "follow-no"}>{record.followUpRequired ? (record.followUpDate ? formatDate(record.followUpDate) : "필요") : "완료"}</span></td>
                          <td><div className="row-actions"><button onClick={() => openEdit(record)}>수정</button>{canManageRecords && <button className="delete" onClick={() => void removeRecord(record)}>삭제</button>}</div></td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
                {loading && <div className="loading-state"><i /><span>기록을 불러오는 중입니다</span></div>}
                {!loading && (view === "dashboard" ? dashboardRecentRecords.length === 0 : filtered.length === 0) && <div className="empty-state large">{view === "dashboard" ? "아직 등록된 활동 기록이 없습니다." : "조건에 맞는 기록이 없습니다."}</div>}
              </div>
              {view === "dashboard" && records.length > 8 && canManageRecords && <button className="show-all" onClick={() => void selectView("records")}>팀 활동 로그에서 전체 {records.length}건 보기 →</button>}
            </section>
          )}
        </div>
      </section>

      {detailOrganization && detailLatest && (
        <div
          className="history-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-title"
        >
          <button
            className="history-backdrop"
            aria-label="기관 히스토리 닫기"
            onClick={() => setDetailOrganization(null)}
          />
          <aside className="history-drawer">
            <div className="history-header">
              <div>
                <span className="section-kicker">ORGANIZATION HISTORY</span>
                <h2 id="history-title">{detailOrganization}</h2>
                <p>
                  {detailLatest.region || "지역 미입력"} ·{" "}
                  {detailHistory.length}건의 컨택 기록
                </p>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setDetailOrganization(null)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <div className="history-body">
              <section className="history-summary-grid" aria-label="최신 컨택 요약">
                <div>
                  <span>최종 컨택일</span>
                  <strong>{formatDate(detailLatest.activityDate)}</strong>
                </div>
                <div>
                  <span>컨택 유형</span>
                  <strong>{displayContactMethod(detailLatest)}</strong>
                </div>
                <div>
                  <span>예산</span>
                  <strong>{detailLatest.budgetType || "미정"}</strong>
                  <small>{formatMoneyInput(detailLatest.budgetAmount) || "금액 미정"}</small>
                </div>
                <div>
                  <span>기관 담당자</span>
                  <strong>{detailLatest.contactName || "미등록"}</strong>
                  <small>{detailLatest.contactEmail || "기관 메일 미등록"}</small>
                </div>
                <div>
                  <span>상태 · 수주</span>
                  <strong>{detailLatest.status}</strong>
                  <small>
                    {detailLatest.awardStatus}
                    {detailLatest.awardCompany
                      ? ` · ${detailLatest.awardCompany}`
                      : ""}
                  </small>
                </div>
                <div>
                  <span>사업방식</span>
                  <strong>{detailLatest.executionType || "미정"}</strong>
                  <small>
                    {detailLatest.executionType === "컨소"
                      ? detailLatest.consortiumCompany || "컨소 업체 미등록"
                      : "직영/컨소 구분"}
                  </small>
                </div>
                <div>
                  <span>진행 담당자</span>
                  <strong>{detailLatest.progressManager || "미등록"}</strong>
                </div>
              </section>

              <OrganizationEquipmentManager
                organization={detailOrganization}
                latestRecord={detailLatest}
                onToast={setToast}
                onOrganizationRenamed={async (nextOrganization) => {
                  await loadRecords();
                  setDetailOrganization(nextOrganization);
                }}
              />

              <section className="history-latest">
                <div className="history-section-heading">
                  <div>
                    <span className="section-kicker">LATEST CONTACT</span>
                    <h3>최근 컨택 상세</h3>
                  </div>
                  <button
                    onClick={() => {
                      setDetailOrganization(null);
                      openEdit(detailLatest);
                    }}
                  >
                    최신 기록 수정
                  </button>
                </div>
                <dl>
                  <div>
                    <dt>주제</dt>
                    <dd>{detailLatest.topic || "입력 없음"}</dd>
                  </div>
                  <div>
                    <dt>내용</dt>
                    <dd>{detailLatest.summary || "입력 없음"}</dd>
                  </div>
                  <div>
                    <dt>다음 행동</dt>
                    <dd>{detailLatest.nextAction || "미정"}</dd>
                  </div>
                  <div>
                    <dt>재연락</dt>
                    <dd>
                      {detailLatest.followUpDate
                        ? formatDate(detailLatest.followUpDate)
                        : "일정 미정"}
                    </dd>
                  </div>
                  {detailLatest.notes && (
                    <div>
                      <dt>메모</dt>
                      <dd>{detailLatest.notes}</dd>
                    </div>
                  )}
                </dl>
              </section>

              <section className="history-timeline-section">
                <div className="history-section-heading">
                  <div>
                    <span className="section-kicker">FULL TIMELINE</span>
                    <h3>이전 히스토리</h3>
                  </div>
                  <span>{detailHistory.length}건</span>
                </div>
                <div className="history-timeline">
                  {detailHistory.map((record, index) => (
                    <article className="history-event" key={record.id}>
                      <div className="history-event-date">
                        <b>{formatDate(record.activityDate)}</b>
                        <span>{index === 0 ? "최신" : String(index + 1).padStart(2, "0")}</span>
                      </div>
                      <div className="history-event-main">
                        <div className="history-event-toolbar">
                          <div className="history-event-pills">
                            <span className="contact-pill">
                              {displayContactMethod(record)}
                            </span>
                            <span className="type-pill">{record.activityType}</span>
                            <span className={`status-pill ${statusClass(record.status)}`}>
                              {record.status}
                            </span>
                          </div>
                          <div className="history-event-actions">
                            <button
                              type="button"
                              onClick={() => {
                                setDetailOrganization(null);
                                openEdit(record);
                              }}
                            >
                              수정
                            </button>
                            {canManageRecords && (
                              <button
                                type="button"
                                className="delete"
                                onClick={() => void removeRecord(record)}
                              >
                                삭제
                              </button>
                            )}
                          </div>
                        </div>
                        <strong>{record.topic || "주제 미입력"}</strong>
                        <p>{record.summary || "상세 내용이 없습니다."}</p>
                        <small>
                          {record.region || "지역 미입력"} ·{" "}
                          {record.budgetType || "예산 미정"} ·{" "}
                          {formatMoneyInput(record.budgetAmount) || "금액 미정"}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}

      {modalOpen && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="record-modal-title">
          <button className="modal-backdrop" aria-label="창 닫기" onClick={() => setModalOpen(false)} />
          <form className="record-modal" onSubmit={saveRecord}>
            <div className="modal-header">
              <div><span className="section-kicker">ACTIVITY RECORD</span><h2 id="record-modal-title">{editingId ? "영업 기록 수정" : creatingAward ? "수주 등록" : "새 영업 기록"}</h2></div>
              <button type="button" className="close-button" onClick={() => setModalOpen(false)} aria-label="닫기">×</button>
            </div>
            <div className="form-body">
              <div className="form-section-title"><span>01</span><strong>기본 정보</strong></div>
              <div className="form-grid">
                <label className="span-2"><span>기관·파트너명 *</span><input required value={form.organization} onChange={(event) => setForm({ ...form, organization: event.target.value })} placeholder="예: 창경초등학교" /></label>
                <label><span>활동 날짜</span><input type="date" value={form.activityDate.length === 10 ? form.activityDate : ""} onChange={(event) => setForm({ ...form, activityDate: event.target.value })} /></label>
                <label><span>활동 유형 *</span><select required value={form.activityType} onChange={(event) => setForm({ ...form, activityType: event.target.value })}>{typeOptions.map((type) => <option key={type}>{type}</option>)}</select></label>
                <label><span>기관 구분</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>학교</option><option>기관</option><option>협력사</option><option>내부</option><option>기타</option></select></label>
                <label><span>지역</span><input value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })} placeholder="예: 경기 성남, 충북 청주" /></label>
                <label><span>컨택 유형</span><select value={form.contactMethod} onChange={(event) => setForm({ ...form, contactMethod: event.target.value })}><option>유선</option><option>방문</option><option>온라인</option><option>진행 공유</option><option>기타</option></select></label>
              </div>

              <div className="form-section-title"><span>02</span><strong>상담 내용</strong></div>
              <div className="form-grid">
                <label className="span-2"><span>주제</span><input value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} placeholder="제품, 사업명, 논의 주제" /></label>
                <label><span>예산 종류</span><input value={form.budgetType} onChange={(event) => setForm({ ...form, budgetType: event.target.value })} placeholder="예: 자체예산, 문체부, 늘봄" /></label>
                <label><span>예산 금액</span><input inputMode="decimal" value={form.budgetAmount} onChange={(event) => setForm({ ...form, budgetAmount: formatMoneyInput(event.target.value) })} placeholder="예: 2,480만원" /></label>
                <label className="span-2"><span>내용 요약</span><textarea rows={3} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder="통화나 미팅에서 논의한 핵심 내용을 입력하세요." /></label>
                <label><span>진행 상태</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></label>
                <label><span>관심도</span><select value={form.temperature} onChange={(event) => setForm({ ...form, temperature: event.target.value })}><option>높음</option><option>중간</option><option>낮음</option></select></label>
              </div>

              <div className="form-section-title"><span>03</span><strong>후속 관리</strong></div>
              <div className="form-grid">
                <label className="toggle-label span-2"><input type="checkbox" checked={form.followUpRequired} onChange={(event) => setForm({ ...form, followUpRequired: event.target.checked })} /><span className="toggle" /><span>재연락이 필요한 기록으로 표시</span></label>
                <label><span>재연락 예정일</span><input type="date" disabled={!form.followUpRequired} value={form.followUpDate} onChange={(event) => setForm({ ...form, followUpDate: event.target.value })} /></label>
                <label><span>다음 행동</span><input value={form.nextAction} onChange={(event) => setForm({ ...form, nextAction: event.target.value })} placeholder="예: 견적서 발송 후 전화" /></label>
                <label className="span-2">
                  <span>수주 후 진행 일정</span>
                  <textarea
                    rows={3}
                    value={form.progressSchedule}
                    onChange={(event) => setForm({ ...form, progressSchedule: event.target.value })}
                    placeholder={"목공 2026-06-17\n시스템 2026-06-19"}
                  />
                </label>
                <label><span>기관 담당자</span><input value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} placeholder="이름 / 직책" /></label>
                <label><span>기관 전화번호</span><input value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} placeholder="010-0000-0000" /></label>
                <label><span>기관 메일</span><input type="email" value={form.contactEmail} onChange={(event) => setForm({ ...form, contactEmail: event.target.value })} placeholder="name@example.com" /></label>
                <label><span>기록 출처</span><input value={form.sourceChat} onChange={(event) => setForm({ ...form, sourceChat: event.target.value })} /></label>
                <label className="span-2"><span>추가 메모</span><textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
              </div>

              <div className="form-section-title"><span>04</span><strong>수주 결과</strong></div>
              <div className="form-grid">
                <label>
                  <span>사업방식</span>
                  <select
                    value={form.executionType}
                    onChange={(event) => {
                      const executionType = event.target.value;
                      setForm({
                        ...form,
                        executionType,
                        consortiumCompany:
                          executionType === "컨소"
                            ? form.consortiumCompany
                            : "",
                      });
                    }}
                  >
                    <option>미정</option>
                    <option>직영</option>
                    <option>컨소</option>
                  </select>
                </label>
                <label>
                  <span>컨소 업체명</span>
                  <input
                    required={form.executionType === "컨소"}
                    disabled={form.executionType !== "컨소"}
                    value={form.consortiumCompany}
                    onChange={(event) =>
                      setForm({ ...form, consortiumCompany: event.target.value })
                    }
                    placeholder={
                      form.executionType === "컨소"
                        ? "함께 진행하는 업체명"
                        : "컨소 선택 시 입력"
                    }
                  />
                </label>
                <label>
                  <span>수주 구분</span>
                  <select
                    value={form.awardStatus}
                    onChange={(event) => {
                      const awardStatus = event.target.value;
                      setForm({
                        ...form,
                        awardStatus,
                        awardCompany:
                          awardStatus === "위즈업 수주"
                            ? "위즈업"
                            : awardStatus === "미정" ||
                                form.awardCompany === "위즈업"
                              ? ""
                              : form.awardCompany,
                      });
                    }}
                  >
                    <option>미정</option>
                    <option>위즈업 수주</option>
                    <option>타업체 수주</option>
                  </select>
                </label>
                <label>
                  <span>수주 업체명</span>
                  <input
                    required={form.awardStatus === "타업체 수주"}
                    disabled={form.awardStatus !== "타업체 수주"}
                    value={
                      form.awardStatus === "위즈업 수주"
                        ? "위즈업"
                        : form.awardCompany
                    }
                    onChange={(event) =>
                      setForm({ ...form, awardCompany: event.target.value })
                    }
                    placeholder={
                      form.awardStatus === "타업체 수주"
                        ? "실제 수주한 업체명"
                        : "타업체 수주 선택 시 입력"
                    }
                  />
                </label>
                <label>
                  <span>현재 상태</span>
                  <select
                    value={form.awardStage}
                    onChange={(event) =>
                      setForm({ ...form, awardStage: event.target.value })
                    }
                  >
                    {awardStageOptions.map((stage) => (
                      <option key={stage}>{stage}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>진행 담당자</span>
                  <input
                    value={form.progressManager}
                    onChange={(event) =>
                      setForm({ ...form, progressManager: event.target.value })
                    }
                    placeholder="수주 후 진행을 맡는 담당자"
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              {editingId && canManageRecords && (
                <button
                  type="button"
                  className="modal-delete-button"
                  onClick={() => void removeEditingRecord()}
                >
                  이 기록 삭제
                </button>
              )}
              <div className="modal-footer-actions">
                <button type="button" className="cancel-button" onClick={() => setModalOpen(false)}>취소</button>
                <button className="primary-button save-button" disabled={saving}>{saving ? "저장 중…" : editingId ? "수정 저장" : creatingAward ? "수주 등록" : "기록 추가"}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
