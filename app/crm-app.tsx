"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  downloadActivityTemplate,
  downloadRowsXlsx,
  parseActivityImportFile,
  type ActivityImportRow,
  type ActivityImportValues,
} from "./activity-xlsx";
import DataBackupPage from "./data-backup-page";
import { fetchWithInstitutionConfirmation } from "./institution-confirmation";
import SalesMapPage from "./sales-map";
import { resolveRegisteredSalesName } from "../lib/sales-names";
import { isSameRegionInstitution } from "../lib/institution-names";
import {
  compactShareSummary,
  formalizeShareSummary,
  removeRepeatedContactStatement,
  replaceOrganizationReferences,
  resolveContactRole,
} from "../lib/share-text";

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
  contactRole: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  sourceChat: string;
  notes: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

type FormState = Omit<
  Activity,
  "id" | "createdByName" | "createdAt" | "updatedAt"
>;
type ReviewedActivityImportRow = ActivityImportRow & {
  duplicate: boolean;
  selected: boolean;
};
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
type AiRecommendedProduct = {
  name: string;
  reason: string;
};
type AiRecommendationDraft = {
  meetingSummary: string;
  interests: string[];
  recommendedProducts: AiRecommendedProduct[];
  followUpQuestions: string[];
  recommendedActions: string[];
};
type AiRecommendationRecord = AiRecommendationDraft & {
  id: number;
  activityId: number;
  organization: string;
  appliedProducts: string[];
  appliedQuestions: string[];
  appliedActions: string[];
  followUpDate: string;
  createdAt: string;
  updatedAt: string;
};
type AiRecommendationBatchItem = {
  activity: Activity;
  recommendation: AiRecommendationRecord | null;
  recommendationPending: boolean;
};
type AiRecommendationSelection = {
  products: string[];
  questions: string[];
  actions: string[];
  followUpDate: string;
};
type AiPreview = FormState & {
  equipmentProjectName: string;
  equipmentProjectStatus: string;
  equipmentItems: EquipmentItemDraft[];
  recommendation: AiRecommendationDraft;
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
  | "backup"
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
  isSales: boolean;
};

type SessionPayload = {
  member: SessionMember;
  pendingCount: number;
  approvedCount: number;
  aiConfigured: boolean;
  aiModel: string;
  canViewPresence: boolean;
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
  isSales: boolean;
  createdAt: string;
  lastSeenAt: string;
};

type MemberPresence = {
  memberId: number;
  lastSeenAt: string;
  isOnline: boolean;
};

async function requestMemberPresence() {
  const response = await fetch("/api/presence", { cache: "no-store" });
  const payload = (await response.json()) as {
    members?: Record<string, unknown>[];
    serverTime?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "접속 현황을 불러오지 못했습니다.");
  }
  const members: Record<number, MemberPresence> = {};
  for (const row of payload.members ?? []) {
    const memberId = Number(row.id);
    members[memberId] = {
      memberId,
      lastSeenAt: String(row.last_seen_at ?? ""),
      isOnline: Number(row.is_online ?? 0) === 1,
    };
  }
  return {
    members,
    serverTime: String(payload.serverTime ?? new Date().toISOString()),
  };
}

type ActivityReviewAssignee = {
  id: number;
  displayName: string;
};

type ManagerIssueFilter =
  | "attention"
  | "overdue"
  | "stalled"
  | "ownerless"
  | "missing"
  | "processed"
  | "all";

type TeamPeriod = 7 | 30 | "all";
type ScheduleRange = 14 | 30 | "all";
type TeamMetricFocus = "all" | "active" | "attention";
type TeamDetailMode = "activity" | "attention";

type ManagerAlertAcknowledgement = {
  organization: string;
  issueSignature: string;
  snoozedUntil: string;
  updatedAt: string;
};

type ActivityReviewAcknowledgement = {
  activityId: number;
  issueSignature: string;
  snoozedUntil: string;
  updatedAt: string;
};

type ActivityReviewFieldKey =
  | "activityDate"
  | "region"
  | "topic"
  | "summary"
  | "budgetType"
  | "budgetAmount"
  | "contactName"
  | "contactPhone"
  | "contactEmail"
  | "followUpDate"
  | "nextAction"
  | "progressManager";

type ActivityReviewField = {
  key: ActivityReviewFieldKey;
  label: string;
  inputType: "text" | "email" | "date";
  placeholder: string;
  reason: string;
};

type ActivityReviewDraft = Partial<
  Record<ActivityReviewFieldKey, string>
>;

type OrganizationHealth = {
  name: string;
  latest: Activity;
  count: number;
  daysSinceActivity: number;
  overdue: boolean;
  stalled: boolean;
  ownerless: boolean;
  missingInfo: boolean;
  highOpportunity: boolean;
  issues: string[];
  issueSignature: string;
  score: number;
};

type TeamWorkMetric = {
  name: string;
  activityCount: number;
  organizationCount: number;
  followUpCount: number;
  overdueCount: number;
  followUpRate: number | null;
  missingCount: number;
  conversionWonCount: number;
  conversionOrganizationCount: number;
  conversionRate: number | null;
  lastDate: string;
  inactiveDays: number;
  status: "good" | "check" | "support";
};

type TeamAttentionItem = {
  record: Activity;
  reasons: string[];
};

type MemberPermission =
  | "records:manage"
  | "members:manage"
  | "integration:manage"
  | "backup:manage";

const memberPermissionOptions: {
  id: MemberPermission;
  group: "operations";
  label: string;
  description: string;
}[] = [
  {
    id: "records:manage",
    group: "operations",
    label: "팀 업무 현황 · 관리자 영업 점검",
    description: "두 운영 도구 메뉴를 함께 사용",
  },
  {
    id: "members:manage",
    group: "operations",
    label: "구성원 관리",
    description: "가입 승인·상태·역할·접근 권한 관리",
  },
  {
    id: "integration:manage",
    group: "operations",
    label: "API 등록·관리",
    description: "OpenAI·카카오맵 API 등록과 연결 점검",
  },
  {
    id: "backup:manage",
    group: "operations",
    label: "데이터 백업·복구",
    description: "전체 DB 백업·복원과 복구 도구",
  },
];

const assistantRecommendedPermissions: MemberPermission[] =
  memberPermissionOptions.map((option) => option.id);

const openAIModelOptions = ["gpt-5.4-mini", "gpt-5.4", "gpt-5-mini"];
type MemberAccessPreset = "member" | "assistant" | "custom";

function hasExactPermissions(
  current: MemberPermission[],
  expected: MemberPermission[],
) {
  return (
    current.length === expected.length &&
    expected.every((permission) => current.includes(permission))
  );
}

function memberAccessPreset(
  member: Pick<TeamMember, "role" | "permissions">,
): MemberAccessPreset {
  if (member.role === "member") return "member";
  return hasExactPermissions(
    member.permissions,
    assistantRecommendedPermissions,
  )
    ? "assistant"
    : "custom";
}

type OpenAISettingsStatus = {
  configured: boolean;
  source: "registered" | "server";
  keyLast4: string;
  model: string;
  updatedAt: string;
  serverFallbackConfigured: boolean;
  serverFallbackLast4: string;
};

type KakaoSettingsStatus = {
  configured: boolean;
  source: "registered" | "server" | "none";
  javascriptKey: string;
  keyLast4: string;
  updatedAt: string;
  serverFallbackConfigured: boolean;
  serverFallbackLast4: string;
};

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
  executionType: "직영",
  consortiumCompany: "",
  awardStage: "미정",
  progressManager: "",
  followUpRequired: true,
  followUpDate: "",
  nextAction: "",
  progressSchedule: "",
  contactRole: "",
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
const equipmentItemStatuses = [
  "제안 예정",
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
  "backup",
  "integration",
]);
const managementViews = new Set<View>([
  "records",
  "organizations",
  "team",
  "integration",
  "backup",
]);
const presentationModeStorageKey = "whizzup-presentation-mode";

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
기관명이 정정되거나 기존 기관명으로 확정되면 제목뿐 아니라 핵심요약, 다음행동, AI 미팅 요약 등 모든 문장에 최종 기관명을 동일하게 사용하고 이전 오타는 남기지 마세요.
요약에는 확인된 일정·결정·후속 행동만 간결하게 적으세요. “일정 확인이 핵심”, “별도 장비나 수주 정보 없음”, “추가 정보 없음” 같은 해설이나 없는 정보에 대한 문장은 만들지 마세요. 단, 기관이 장비가 필요 없다고 말했거나 미수주로 결정된 것처럼 실제 전달·결정된 부정 사실은 보존하세요.
컨택 유형은 전화·TM이면 “유선”, 직접 찾아가거나 대면 미팅이면 “방문”, 화상 미팅이면 “온라인”으로 정리하세요.
사용자가 “통화했어”, “전화했어”, “TM 진행”처럼 실제 활동을 직접 표현하면 다른 문맥보다 우선하여 활동유형을 “TM·통화”로 정리하세요. 다음 미팅 예정이라는 문구가 함께 있어도 이번 활동이 통화였다면 미팅으로 바꾸지 마세요.
수주 후 공사·설치·교육 일정이나 진행 상황을 기관·학교에 전달하고 공유한 기록이면 “진행 공유”로 정리하세요.
예산의 출처나 종류는 budgetType에, 금액은 사용자가 말한 단위까지 포함해 budgetAmount에 저장하세요. 모르면 빈 값으로 두세요.
학교 관련 영업이 계속 진행 중인 기록의 활동유형은 “학교 진행 중”을 사용하세요.
수주 후 진행 중인 학교·기관에서 “목공 6/17, 시스템 6/19”처럼 여러 일정을 말하면 progressSchedule 배열에 빠짐없이 나누어 저장하세요. label은 목공·시스템처럼 짧게 쓰고 date는 현재 연도를 기준으로 YYYY-MM-DD 형식으로 정리하세요.
수주 결과는 미정, 위즈업 수주, 타업체 수주 중 하나입니다. 타업체 수주라면 실제 수주 업체명을 반드시 확인하세요.
수주 건의 사업방식은 컨소와 업체명을 명시한 경우만 컨소로 정리하고, 그 외에는 모두 직영으로 정리하세요.
수주 건의 현재 상태는 미정, 품의, 협상, 계약, 일정 조율, 완공, 검수, 교육 중 하나로 정리하세요.
기관 인물의 역할이 공사 담당자·회계 담당자·행정 담당자처럼 명시되면 contactRole에 역할을 그대로 넣고 이름·직책은 contactName에 넣으세요. 같은 역할과 이름을 핵심요약에 다시 반복하지 마세요.
progressManager는 위즈업 내부에서 수주 후 진행을 맡는 사람이며 기관 담당자와 구분하세요. 기관 메일은 contactEmail에 정리하세요.
summary와 recommendation.meetingSummary는 단톡 공유에 바로 쓸 수 있도록 “논의했습니다”, “확인했습니다”, “진행합니다” 같은 존댓말 보고체로 작성하세요. “논의했다”, “확인한다”, “진행함” 같은 반말·메모체 종결은 사용하지 마세요.
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
    executionType:
      String(value("executionType", "execution_type")) === "컨소"
        ? "컨소"
        : "직영",
    consortiumCompany: String(
      value("consortiumCompany", "consortium_company"),
    ),
    awardStage: String(value("awardStage", "award_stage")) || "미정",
    progressManager: String(value("progressManager", "progress_manager")),
    followUpRequired: Boolean(Number(value("followUpRequired", "follow_up_required"))),
    followUpDate: String(value("followUpDate", "follow_up_date")),
    nextAction: String(value("nextAction", "next_action")),
    progressSchedule: String(value("progressSchedule", "progress_schedule")),
    contactRole: String(value("contactRole", "contact_role")),
    contactName: String(value("contactName", "contact_name")),
    contactPhone: String(value("contactPhone", "contact_phone")),
    contactEmail: String(value("contactEmail", "contact_email")),
    sourceChat: String(value("sourceChat", "source_chat")),
    notes: String(row.notes ?? ""),
    createdByName: String(value("createdByName", "created_by_name")) || "가져온 기록",
    createdAt: String(value("createdAt", "created_at")),
    updatedAt: String(value("updatedAt", "updated_at")),
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
  const budgetType = String(value("budgetType", "budget_type"));
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
    name: budgetType.trim() || displayName,
    status: String(row.status ?? "") || "제안",
    budgetType,
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

const emptyAiRecommendationSelection: AiRecommendationSelection = {
  products: [],
  questions: [],
  actions: [],
  followUpDate: "",
};

function cleanStringList(value: unknown, maxItems = 8) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .slice(0, maxItems)
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeAiRecommendationDraft(value: unknown): AiRecommendationDraft {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const recommendedProducts = Array.isArray(source.recommendedProducts)
    ? source.recommendedProducts
        .slice(0, 6)
        .map((item) => {
          const product =
            item && typeof item === "object"
              ? (item as Record<string, unknown>)
              : {};
          return {
            name: String(product.name ?? "").trim(),
            reason: String(product.reason ?? "").trim(),
          };
        })
        .filter((item) => item.name)
    : [];
  return {
    meetingSummary: String(source.meetingSummary ?? "").trim(),
    interests: cleanStringList(source.interests),
    recommendedProducts,
    followUpQuestions: cleanStringList(source.followUpQuestions),
    recommendedActions: cleanStringList(source.recommendedActions),
  };
}

function mergeAiRecommendations(
  left: AiRecommendationDraft,
  right: AiRecommendationDraft,
): AiRecommendationDraft {
  const products = new Map<string, AiRecommendedProduct>();
  [...left.recommendedProducts, ...right.recommendedProducts].forEach(
    (product) => {
      const key = product.name.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
      if (!products.has(key)) products.set(key, product);
    },
  );
  return {
    meetingSummary: [left.meetingSummary, right.meetingSummary]
      .filter(Boolean)
      .filter((item, index, items) => items.indexOf(item) === index)
      .join(" "),
    interests: cleanStringList([...left.interests, ...right.interests]),
    recommendedProducts: [...products.values()].slice(0, 6),
    followUpQuestions: cleanStringList([
      ...left.followUpQuestions,
      ...right.followUpQuestions,
    ]),
    recommendedActions: cleanStringList([
      ...left.recommendedActions,
      ...right.recommendedActions,
    ]),
  };
}

function normalizeAiRecommendationRecord(
  value: Record<string, unknown>,
): AiRecommendationRecord {
  const draft = normalizeAiRecommendationDraft(value);
  return {
    ...draft,
    id: Number(value.id),
    activityId: Number(value.activityId),
    organization: String(value.organization ?? ""),
    appliedProducts: cleanStringList(value.appliedProducts),
    appliedQuestions: cleanStringList(value.appliedQuestions),
    appliedActions: cleanStringList(value.appliedActions),
    followUpDate: String(value.followUpDate ?? ""),
    createdAt: String(value.createdAt ?? ""),
    updatedAt: String(value.updatedAt ?? ""),
  };
}

function normalizeAiDraft(draft: Partial<AiPreview> | undefined): AiPreview {
  const budgetType = String(draft?.budgetType ?? "").trim();
  const organization = String(draft?.organization ?? "").trim();
  const recommendation = normalizeAiRecommendationDraft(draft?.recommendation);
  return {
    ...emptyForm,
    ...draft,
    organization,
    summary: compactShareSummary(draft?.summary),
    budgetType,
    budgetAmount: formatMoneyInput(String(draft?.budgetAmount ?? "")),
    followUpRequired:
      typeof draft?.followUpRequired === "boolean"
        ? draft.followUpRequired
        : emptyForm.followUpRequired,
    progressSchedule: String(draft?.progressSchedule ?? ""),
    equipmentProjectName:
      budgetType || String(draft?.equipmentProjectName ?? "").trim(),
    equipmentProjectStatus:
      String(draft?.equipmentProjectStatus ?? "").trim() || "제안",
    equipmentItems: cleanAiEquipmentItems(draft?.equipmentItems),
    recommendation: {
      ...recommendation,
      meetingSummary: compactShareSummary(recommendation.meetingSummary),
    },
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

function activityToForm(record: Activity): FormState {
  return {
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
    contactRole: record.contactRole,
    contactName: record.contactName,
    contactPhone: record.contactPhone,
    contactEmail: record.contactEmail,
    sourceChat: record.sourceChat,
    notes: record.notes,
  };
}

function activityReviewFields(record: Activity): ActivityReviewField[] {
  const fields: ActivityReviewField[] = [];
  const add = (
    key: ActivityReviewFieldKey,
    label: string,
    inputType: ActivityReviewField["inputType"],
    placeholder: string,
    reason: string,
  ) => fields.push({ key, label, inputType, placeholder, reason });
  const contactActivity = /TM|통화|미팅|방문|상담|제안/.test(
    record.activityType,
  );

  if (!record.activityDate || record.dateConfidence !== "확정") {
    add(
      "activityDate",
      "활동 날짜",
      "date",
      "",
      record.activityDate
        ? "AI가 대화 시점을 기준으로 추정했습니다."
        : "활동 날짜가 비어 있습니다.",
    );
  }
  if (!record.region.trim()) {
    add("region", "지역", "text", "예: 경기 김포", "기관 지역이 비어 있습니다.");
  }
  if (!record.topic.trim()) {
    add(
      "topic",
      "사업명·상담 주제",
      "text",
      "예: 스마트 체육공간 조성",
      "사업명이나 상담 주제가 비어 있습니다.",
    );
  }
  if (!record.summary.trim()) {
    add(
      "summary",
      "상담 내용",
      "text",
      "통화·미팅의 핵심 내용을 입력하세요.",
      "상담 내용 요약이 비어 있습니다.",
    );
  }
  if (contactActivity && !record.contactName.trim()) {
    add(
      "contactName",
      "기관 담당자",
      "text",
      "이름 / 직책",
      "기관 담당자가 비어 있습니다.",
    );
  }
  if (contactActivity && !record.contactPhone.trim()) {
    add(
      "contactPhone",
      "담당자 연락처",
      "text",
      "010-0000-0000",
      "담당자 연락처가 비어 있습니다.",
    );
  }
  if (contactActivity && !record.contactEmail.trim()) {
    add(
      "contactEmail",
      "담당자 이메일",
      "email",
      "name@example.com",
      "담당자 이메일이 비어 있습니다.",
    );
  }
  if (contactActivity && !record.budgetType.trim()) {
    add(
      "budgetType",
      "예산명·종류",
      "text",
      "예: 자체예산, 늘봄, 공간재구조화",
      "예산명 또는 예산 종류가 비어 있습니다.",
    );
  }
  if (contactActivity && !record.budgetAmount.trim()) {
    add(
      "budgetAmount",
      "예상 예산액",
      "text",
      "예: 5,000만원",
      "예상 예산액이 비어 있습니다.",
    );
  }
  if (record.followUpRequired && !record.nextAction.trim()) {
    add(
      "nextAction",
      "다음 행동",
      "text",
      "예: 견적서 전달 후 재통화",
      "다음 행동이 비어 있습니다.",
    );
  }
  if (record.followUpRequired && !record.followUpDate) {
    add(
      "followUpDate",
      "재연락 예정일",
      "date",
      "",
      "재연락 날짜가 비어 있습니다.",
    );
  }
  if (!record.progressManager.trim()) {
    add(
      "progressManager",
      "진행 담당자",
      "text",
      "이 기록을 이어서 진행할 담당자",
      "진행 담당자가 비어 있습니다.",
    );
  }
  return fields;
}

function activityReviewSignature(record: Activity) {
  const fields = activityReviewFields(record);
  return JSON.stringify({
    activityId: record.id,
    updatedAt: record.updatedAt,
    issues: fields.map((field) => [
      field.key,
      String(record[field.key] ?? ""),
    ]),
  });
}

function timestampDateValue(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function presenceTimeLabel(value: string, nowValue: string) {
  if (!value) return "접속 기록 없음";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  const now = new Date(nowValue || Date.now());
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) {
    return "마지막 활동 확인 중";
  }
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return "방금 전 활동";
  if (minutes < 60) return `${minutes}분 전 활동`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전 활동`;
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysSinceDate(value: string, todayValue: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 999;
  const current = new Date(`${todayValue}T00:00:00`);
  const target = new Date(`${value}T00:00:00`);
  const difference = current.getTime() - target.getTime();
  return Math.max(0, Math.floor(difference / 86_400_000));
}

function buildActivityShareText(
  activity: Activity | null,
  recommendation: AiRecommendationRecord | null,
  includeAiSuggestions: boolean,
) {
  const organization =
    activity?.organization || recommendation?.organization || "기관";
  const activityType = activity?.activityType || "미팅·TM";
  const rawSummary =
    recommendation?.meetingSummary ||
    activity?.summary ||
    activity?.topic ||
    "미팅·TM 내용을 기록했습니다.";
  const contactRole = resolveContactRole(
    activity?.contactRole,
    rawSummary,
    activity?.summary,
    activity?.topic,
    activity?.notes,
  );
  const compactSummary =
    compactShareSummary(
      replaceOrganizationReferences(
        rawSummary,
        recommendation?.organization,
        organization,
      ),
    ) || activity?.topic || "미팅·TM 내용을 기록했습니다.";
  const summary = formalizeShareSummary(
    removeRepeatedContactStatement(
      compactSummary,
      contactRole,
      activity?.contactName,
    ) || activity?.topic || "미팅·TM 내용을 기록했습니다.",
  );
  const lines = [
    `[${organization} ${activityType}]`,
    activity?.progressManager || activity?.createdByName
      ? `담당: ${activity.progressManager || activity.createdByName}`
      : "",
    activity?.contactName
      ? `${contactRole || "기관 담당자"}: ${activity.contactName}`
      : "",
    activity?.budgetType ? `예산명: ${activity.budgetType}` : "",
    activity?.budgetAmount ? `예산액: ${activity.budgetAmount}` : "",
    activity?.contactEmail ? `메일: ${activity.contactEmail}` : "",
    activity?.activityDate ? `일자: ${formatDate(activity.activityDate)}` : "",
    activity?.followUpDate
      ? `재연락: ${formatDate(activity.followUpDate)}`
      : "",
  ].filter(Boolean);

  if (includeAiSuggestions && recommendation) {
    const products = recommendation.recommendedProducts
      .map((product) => product.name)
      .filter(Boolean);
    const actions = recommendation.recommendedActions.filter(Boolean);
    if (products.length) {
      lines.push(`AI 참고 제품: ${products.join(", ")}`);
    }
    if (actions.length) {
      lines.push(`AI 참고 대응: ${actions.join(" / ")}`);
    }
  }

  lines.push("", "내용", summary.trim());

  return lines.join("\n");
}

function batchOrganizationKey(value: string) {
  return value.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function groupAiRecommendationBatch(items: AiRecommendationBatchItem[]) {
  const groups = new Map<string, AiRecommendationBatchItem[]>();
  items.forEach((item) => {
    const key = batchOrganizationKey(item.activity.organization);
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  });
  return [...groups.values()];
}

function aiBatchOrganizationCount(items: AiRecommendationBatchItem[]) {
  return groupAiRecommendationBatch(items).length;
}

type AiBatchShareDetails = {
  organization: string;
  region: string;
  contacts: Map<string, string>;
  budgets: Set<string>;
  summaries: Set<string>;
  followUpDates: Set<string>;
  products: Set<string>;
  actions: Set<string>;
};

function batchRegionLabel(value: string) {
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const localName = normalized.split(/[\s,]+/).filter(Boolean).at(-1) ?? "";
  return (
    localName.replace(/(?:특별자치시|특별시|광역시|자치시|시|군|구)$/u, "") ||
    localName ||
    normalized
  );
}

function batchRegionKey(value: string) {
  return batchRegionLabel(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function collectAiBatchShareDetails(
  group: AiRecommendationBatchItem[],
  includeAiSuggestions: boolean,
): AiBatchShareDetails {
  const organization = group[0]?.activity.organization || "기관";
  const contacts = new Map<string, string>();
  const budgets = new Set<string>();
  const summaries = new Set<string>();
  const followUpDates = new Set<string>();
  const products = new Set<string>();
  const actions = new Set<string>();

  group.forEach(({ activity, recommendation }) => {
    const rawSummary =
      recommendation?.meetingSummary ||
      activity.summary ||
      activity.topic ||
      "미팅·TM 내용을 기록했습니다.";
    const contactRole = resolveContactRole(
      activity.contactRole,
      rawSummary,
      activity.summary,
      activity.topic,
      activity.notes,
    );
    const compactSummary =
      compactShareSummary(
        replaceOrganizationReferences(
          rawSummary,
          recommendation?.organization,
          organization,
        ),
      ) || activity.topic || "미팅·TM 내용을 기록했습니다.";
    const summary = formalizeShareSummary(
      removeRepeatedContactStatement(
        compactSummary,
        contactRole,
        activity.contactName,
      ) || activity.topic || "미팅·TM 내용을 기록했습니다.",
    );
    const budget = [activity.budgetType, activity.budgetAmount]
      .filter(Boolean)
      .join(" · ");

    if (activity.contactName) {
      const label = contactRole || "기관 담당자";
      const previousLabel = contacts.get(activity.contactName);
      if (!previousLabel || previousLabel === "기관 담당자") {
        contacts.set(activity.contactName, label);
      }
    }
    if (budget) budgets.add(budget);
    if (summary.trim()) summaries.add(summary.trim());
    if (activity.followUpDate) {
      followUpDates.add(formatDate(activity.followUpDate));
    }
    if (includeAiSuggestions && recommendation) {
      recommendation.recommendedProducts
        .map((product) => product.name)
        .filter(Boolean)
        .forEach((product) => products.add(product));
      recommendation.recommendedActions
        .filter(Boolean)
        .forEach((action) => actions.add(action));
    }
  });

  return {
    organization,
    region: group.find((item) => item.activity.region.trim())?.activity.region ?? "",
    contacts,
    budgets,
    summaries,
    followUpDates,
    products,
    actions,
  };
}

function removeLeadingOrganizationFromSummary(
  summary: string,
  organization: string,
) {
  const pattern = organization
    .replace(/\s+/g, "")
    .split("")
    .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  if (!pattern) return summary;
  const stripped = summary.replace(
    new RegExp(`^${pattern}\\s*(?:은|는|이|가)?\\s*(?::|：|-)?\\s*`, "u"),
    "",
  );
  return stripped || summary;
}

function appendSingleInstitutionShare(
  lines: string[],
  details: AiBatchShareDetails,
) {
  lines.push("", `[${details.organization}]`);
  details.contacts.forEach((role, name) => lines.push(`- ${role}: ${name}`));
  details.budgets.forEach((budget) => lines.push(`- 예산: ${budget}`));
  details.summaries.forEach((summary) => lines.push(`- ${summary}`));
  details.followUpDates.forEach((date) => lines.push(`- 재연락: ${date}`));
  if (details.products.size) {
    lines.push(`- AI 참고 제품: ${[...details.products].join(", ")}`);
  }
  if (details.actions.size) {
    lines.push(`- AI 참고 대응: ${[...details.actions].join(" / ")}`);
  }
}

function appendRegionalInstitutionShare(
  lines: string[],
  detailsGroup: AiBatchShareDetails[],
) {
  const region = batchRegionLabel(
    detailsGroup.find((details) => details.region)?.region ?? "",
  );
  lines.push("", `[${region || "지역 미등록"}]`);

  const contacts = new Map<
    string,
    { role: string; name: string; organizations: Set<string> }
  >();
  const summaries = new Map<
    string,
    { summary: string; organizations: Set<string> }
  >();
  const products = new Set<string>();
  const actions = new Set<string>();

  detailsGroup.forEach((details) => {
    details.contacts.forEach((role, name) => {
      const key = `${role}\u0000${name}`;
      const entry = contacts.get(key) ?? {
        role,
        name,
        organizations: new Set<string>(),
      };
      entry.organizations.add(details.organization);
      contacts.set(key, entry);
    });
    details.summaries.forEach((summary) => {
      const compact = removeLeadingOrganizationFromSummary(
        summary,
        details.organization,
      );
      const key = compact.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
      const entry = summaries.get(key) ?? {
        summary: compact,
        organizations: new Set<string>(),
      };
      entry.organizations.add(details.organization);
      summaries.set(key, entry);
    });
    details.products.forEach((product) => products.add(product));
    details.actions.forEach((action) => actions.add(action));
  });

  contacts.forEach(({ role, name, organizations }) => {
    const appliesToAll = organizations.size === detailsGroup.length;
    lines.push(
      appliesToAll
        ? `- ${role}: ${name}`
        : `- ${[...organizations].join(" · ")} ${role}: ${name}`,
    );
  });
  summaries.forEach(({ summary, organizations }) => {
    lines.push(`- ${[...organizations].join(" · ")}: ${summary}`);
  });
  detailsGroup.forEach((details) => {
    details.budgets.forEach((budget) =>
      lines.push(`- ${details.organization} 예산: ${budget}`),
    );
    details.followUpDates.forEach((date) =>
      lines.push(`- ${details.organization} 재연락: ${date}`),
    );
  });
  if (products.size) {
    lines.push(`- AI 참고 제품: ${[...products].join(", ")}`);
  }
  if (actions.size) {
    lines.push(`- AI 참고 대응: ${[...actions].join(" / ")}`);
  }
}

function buildActivityBatchShareText(
  items: AiRecommendationBatchItem[],
  includeAiSuggestions: boolean,
) {
  if (!items.length) return "";

  const groupedItems = groupAiRecommendationBatch(items);
  const activities = items.map((item) => item.activity);
  const dates = [
    ...new Set(
      activities
        .map((activity) => activity.activityDate)
        .filter(Boolean),
    ),
  ];
  const activityTypes = [
    ...new Set(
      activities
        .map((activity) => activity.activityType)
        .filter(Boolean),
    ),
  ];
  const topics = [
    ...new Set(
      activities
        .map((activity) => activity.topic.trim())
        .filter(Boolean),
    ),
  ];
  const dateLabel =
    dates.length === 1
      ? formatDate(dates[0])
      : `${groupedItems.length}개 기관`;
  const activityLabel =
    activityTypes.length === 1 ? activityTypes[0] : "영업";
  const topicLabel = topics.length === 1 ? ` (${topics[0]})` : "";
  const lines = [
    `[${dateLabel} ${activityLabel} 진행 내용 정리${topicLabel}]`,
  ];

  const details = groupedItems.map((group) =>
    collectAiBatchShareDetails(group, includeAiSuggestions),
  );
  const regionalGroups = new Map<string, AiBatchShareDetails[]>();
  details.forEach((item) => {
    const regionKey = batchRegionKey(item.region);
    const key = regionKey
      ? `region:${regionKey}`
      : `organization:${batchOrganizationKey(item.organization)}`;
    const current = regionalGroups.get(key) ?? [];
    current.push(item);
    regionalGroups.set(key, current);
  });
  regionalGroups.forEach((detailsGroup) => {
    if (detailsGroup.length > 1 && detailsGroup.every((item) => item.region)) {
      appendRegionalInstitutionShare(lines, detailsGroup);
      return;
    }
    detailsGroup.forEach((item) => appendSingleInstitutionShare(lines, item));
  });

  return lines.join("\n");
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

function activityImportSignature(
  value: Pick<
    ActivityImportValues,
    "activityDate" | "organization" | "activityType" | "summary"
  >,
) {
  const normalizeText = (text: string) =>
    text.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
  return [
    value.activityDate,
    normalizeText(value.organization),
    normalizeText(value.activityType),
    normalizeText(value.summary),
  ].join("|");
}

function automaticProgressManagement(value: string) {
  if (!value.trim()) return null;
  const todayValue = toLocalDateValue(new Date());
  const items = parseProgressSchedule(value).sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.label.localeCompare(right.label, "ko-KR"),
  );
  const dueItems = items.filter((item) => item.date < todayValue);
  const constructionCompleted = dueItems.some((item) =>
    /완공|준공|설치\s*완료|시공\s*완료|공사\s*완료|납품\s*완료/.test(
      item.label,
    ),
  );
  const inspectionCompleted = dueItems.some((item) =>
    /검수(?:\s*완료)?/.test(item.label),
  );
  const trainingCompleted = dueItems.some((item) =>
    /교육(?:\s*완료)?/.test(item.label),
  );
  if (constructionCompleted && inspectionCompleted && trainingCompleted) {
    return { status: "완료", awardStage: "완공" };
  }
  const hasCurrentOrFutureSchedule = items.some(
    (item) => item.date >= todayValue,
  );
  if (items.length > 0 && !hasCurrentOrFutureSchedule) {
    const latestDueLabel = dueItems.at(-1)?.label ?? "";
    return {
      status: "결과 확인",
      awardStage: /검수/.test(latestDueLabel)
        ? "검수"
        : /교육/.test(latestDueLabel)
          ? "교육"
          : "일정 조율",
    };
  }
  return { status: "진행 중", awardStage: "일정 조율" };
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
    const aliasKey = organization
      .replace(/\s+/g, "")
      .toLocaleLowerCase("ko-KR");
    const sameRegionEntry = [...grouped.entries()].find(([, existing]) =>
      isSameRegionInstitution(
        { organization, region: draft.region },
        {
          organization: existing.organization,
          region: existing.region,
        },
      ),
    );
    const key = sameRegionEntry?.[0] ?? aliasKey;
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
    const mergeUniqueText = (left: string, right: string, separator = " / ") =>
      [...new Set([left.trim(), right.trim()].filter(Boolean))].join(separator);
    grouped.set(key, {
      ...draft,
      ...existing,
      summary,
      topic: mergeUniqueText(existing.topic, draft.topic),
      nextAction: mergeUniqueText(existing.nextAction, draft.nextAction),
      notes: mergeUniqueText(existing.notes, draft.notes, " · "),
      contactRole: existing.contactRole || draft.contactRole,
      contactName: existing.contactName || draft.contactName,
      contactPhone: existing.contactPhone || draft.contactPhone,
      contactEmail: existing.contactEmail || draft.contactEmail,
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
      recommendation: mergeAiRecommendations(
        existing.recommendation,
        draft.recommendation,
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

type RecordsScope = "dashboard" | "full";

async function requestRecords(scope: RecordsScope = "full") {
  const pageSize = 250;
  const maximumPages = 1_000;
  const recordsById = new Map<number, Activity>();
  let offset = 0;

  for (let page = 0; page < maximumPages; page += 1) {
    const response = await fetch(
      `/api/records?scope=${scope}&limit=${pageSize}&offset=${offset}`,
      { cache: "no-store" },
    );
    const payload = (await response.json()) as {
      records?: Record<string, unknown>[];
      pagination?: {
        hasMore?: boolean;
        nextOffset?: number | null;
      };
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || "기록을 불러오지 못했습니다.");
    }

    const pageRecords = (payload.records ?? []).map(normalize);
    pageRecords.forEach((record) => recordsById.set(record.id, record));
    if (!payload.pagination?.hasMore) {
      return [...recordsById.values()];
    }

    const nextOffset = Number(payload.pagination.nextOffset);
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
      throw new Error("다음 기록 묶음의 위치를 확인하지 못했습니다.");
    }
    offset = nextOffset;
  }

  throw new Error("기록이 너무 많아 전체 목록을 불러오지 못했습니다.");
}

function upsertActivity(
  current: Activity[],
  saved: Activity,
) {
  return [
    saved,
    ...current.filter((record) => record.id !== saved.id),
  ];
}

async function requestSession(): Promise<SessionPayload> {
  const response = await fetch("/api/session", { cache: "no-store" });
  const payload = (await response.json()) as SessionPayload & { error?: string };
  if (!response.ok) throw new Error(payload.error || "사용자 정보를 확인하지 못했습니다.");
  const role: SessionMember["role"] =
    payload.member.role === "admin"
      ? "admin"
      : payload.member.role === "assistant"
        ? "assistant"
        : "member";
  return {
    ...payload,
    member: {
      ...payload.member,
      role,
      permissions: normalizeMemberPermissions(payload.member.permissions),
    },
  };
}

async function requestActivityReviewAcknowledgements() {
  const response = await fetch("/api/record-reviews", { cache: "no-store" });
  const payload = (await response.json()) as {
    acknowledgements?: Record<string, unknown>[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "내 기록 점검 상태를 불러오지 못했습니다.");
  }
  return (payload.acknowledgements ?? []).map(
    (value): ActivityReviewAcknowledgement => ({
      activityId: Number(value.activityId ?? value.activity_id),
      issueSignature: String(value.issueSignature ?? value.issue_signature ?? ""),
      snoozedUntil: String(value.snoozedUntil ?? value.snoozed_until ?? ""),
      updatedAt: String(value.updatedAt ?? value.updated_at ?? ""),
    }),
  );
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
      items: [],
    }),
  });
  return response.ok;
}

function OrganizationEquipmentManager({
  organization,
  latestRecord,
  onToast,
}: {
  organization: string;
  latestRecord: Activity;
  onToast: (message: string) => void;
}) {
  const [equipmentState, setEquipmentState] = useState<{
    organization: string;
    projects: EquipmentProject[];
    error: string;
  }>({ organization: "", projects: [], error: "" });
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
          <p>상담내용의 예산 정보는 자동 반영되며 품목만 추가·관리합니다.</p>
        </div>
      </div>

      {loading ? (
        <div className="equipment-empty">사업과 품목을 불러오고 있습니다…</div>
      ) : equipmentState.error ? (
        <div className="equipment-empty error">{equipmentState.error}</div>
      ) : projects.length === 0 ? (
        <div className="equipment-empty">
          <strong>아직 연결된 사업이 없습니다.</strong>
          <p>상담내용에서 예산 종류를 입력하면 사업이 자동으로 연결됩니다.</p>
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
                      <h4>{project.name}</h4>
                    </div>
                    <strong className="equipment-project-amount">
                      {syncedBudgetAmount}
                    </strong>
                    <p>{project.items.length}개 품목</p>
                  </div>
                </header>
                <div className="equipment-project-summary">
                  <span>제안 <b>{proposedKinds}</b>종</span>
                  <span>수주 <b>{awardedKinds}</b>종</span>
                  <span>설치·진행 <b>{installingKinds}</b>종</span>
                </div>

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

function OrganizationAiRecommendations({
  organization,
  onOpen,
}: {
  organization: string;
  onOpen: (recommendation: AiRecommendationRecord) => void;
}) {
  const [state, setState] = useState<{
    organization: string;
    recommendations: AiRecommendationRecord[];
    loading: boolean;
  }>({ organization: "", recommendations: [], loading: true });

  useEffect(() => {
    let active = true;
    void fetch(
      `/api/ai/recommendations?organization=${encodeURIComponent(organization)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          recommendations?: Record<string, unknown>[];
        };
        if (!response.ok) throw new Error();
        if (active) {
          setState({
            organization,
            recommendations: (payload.recommendations ?? []).map(
              normalizeAiRecommendationRecord,
            ),
            loading: false,
          });
        }
      })
      .catch(() => {
        if (active) {
          setState({ organization, recommendations: [], loading: false });
        }
      });
    return () => {
      active = false;
    };
  }, [organization]);

  const recommendations =
    state.organization === organization ? state.recommendations : [];
  if (state.loading || !recommendations.length) return null;

  return (
    <section className="history-ai-recommendations">
      <div className="history-section-heading">
        <div>
          <span className="section-kicker">AI RESPONSE GUIDE</span>
          <h3>저장된 AI 대응 제안</h3>
        </div>
        <span>{recommendations.length}건</span>
      </div>
      <div className="history-ai-recommendation-list">
        {recommendations.slice(0, 4).map((recommendation) => {
          const appliedCount =
            recommendation.appliedProducts.length +
            recommendation.appliedQuestions.length +
            recommendation.appliedActions.length;
          return (
            <article key={recommendation.id}>
              <div>
                <strong>
                  {recommendation.meetingSummary || "AI 대응 제안"}
                </strong>
                <small>
                  {formatDate(recommendation.updatedAt.slice(0, 10))}
                  {appliedCount > 0 ? ` · ${appliedCount}개 반영됨` : " · 미반영"}
                </small>
              </div>
              <button type="button" onClick={() => onOpen(recommendation)}>
                제안 열기
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AiBatchRecommendationDetails({
  item,
  onOpen,
}: {
  item: AiRecommendationBatchItem;
  onOpen: (
    recommendation: AiRecommendationRecord,
    activity: Activity,
  ) => void;
}) {
  const { activity, recommendation, recommendationPending } = item;
  return (
    <div className="ai-batch-recommendation-content">
      {recommendationPending ? (
        <div className="loading-state">
          <i />
          <span>AI 추천 대응을 준비하고 있습니다</span>
        </div>
      ) : recommendation ? (
        <>
          {recommendation.interests.length > 0 && (
            <div className="ai-response-chips">
              {recommendation.interests.map((interest) => (
                <span key={interest}>{interest}</span>
              ))}
            </div>
          )}

          {recommendation.recommendedProducts.length > 0 && (
            <div className="ai-batch-recommendation-group">
              <span>추천 제품</span>
              <ul>
                {recommendation.recommendedProducts.map((product) => (
                  <li key={product.name}>
                    <strong>{product.name}</strong>
                    <small>{product.reason}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recommendation.followUpQuestions.length > 0 && (
            <div className="ai-batch-recommendation-group">
              <span>다음 확인 질문</span>
              <ul>
                {recommendation.followUpQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          )}

          {recommendation.recommendedActions.length > 0 && (
            <div className="ai-batch-recommendation-group">
              <span>추천 대응 행동</span>
              <ul>
                {recommendation.recommendedActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            className="ai-batch-apply-button"
            onClick={() => onOpen(recommendation, activity)}
          >
            선택해서 기록에 반영
          </button>
        </>
      ) : (
        <div className="ai-batch-recommendation-error">
          <strong>AI 추천 대응을 준비하지 못했습니다.</strong>
          <p>
            영업 기록은 정상 저장됐습니다. 기관별 관리에서 기록을 확인할 수
            있습니다.
          </p>
        </div>
      )}
    </div>
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
  const [selectedInstitutionIds, setSelectedInstitutionIds] = useState<number[]>(
    [],
  );
  const [selectedAwardIds, setSelectedAwardIds] = useState<number[]>([]);
  const [view, setView] = useState<View>("dashboard");
  const [mapVisited, setMapVisited] = useState(false);
  const [recordsFullyLoaded, setRecordsFullyLoaded] = useState(false);
  const recordsFullyLoadedRef = useRef(false);
  const fullRecordsLoadingRef = useRef(false);
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
  const [managerIssueFilter, setManagerIssueFilter] =
    useState<ManagerIssueFilter>("attention");
  const [managerSearch, setManagerSearch] = useState("");
  const [teamPeriodDays, setTeamPeriodDays] = useState<TeamPeriod>(7);
  const [scheduleRange, setScheduleRange] = useState<ScheduleRange>(30);
  const [teamMetricFocus, setTeamMetricFocus] =
    useState<TeamMetricFocus>("all");
  const [selectedTeamMember, setSelectedTeamMember] = useState("전체");
  const [teamDetailMode, setTeamDetailMode] =
    useState<TeamDetailMode>("activity");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creatingAward, setCreatingAward] = useState(false);
  const [recordEntryMode, setRecordEntryMode] = useState<"manual" | "excel">(
    "manual",
  );
  const [activityImportFileName, setActivityImportFileName] = useState("");
  const [activityImportRows, setActivityImportRows] = useState<
    ReviewedActivityImportRow[]
  >([]);
  const [activityImportError, setActivityImportError] = useState("");
  const [activityImportSaving, setActivityImportSaving] = useState(false);
  const [activityImportProgress, setActivityImportProgress] = useState("");
  const activityImportInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const formOrganizationSourceRef = useRef("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [memberPresence, setMemberPresence] = useState<
    Record<number, MemberPresence>
  >({});
  const [presenceOnlineOnly, setPresenceOnlineOnly] = useState(false);
  const [presenceUpdatedAt, setPresenceUpdatedAt] = useState("");
  const [openAISettings, setOpenAISettings] =
    useState<OpenAISettingsStatus | null>(null);
  const [openAIApiKey, setOpenAIApiKey] = useState("");
  const [openAIModel, setOpenAIModel] = useState("gpt-5.4-mini");
  const [openAISettingsBusy, setOpenAISettingsBusy] = useState(false);
  const [openAIConnectionMessage, setOpenAIConnectionMessage] = useState("");
  const [kakaoSettings, setKakaoSettings] =
    useState<KakaoSettingsStatus | null>(null);
  const [kakaoJavascriptKey, setKakaoJavascriptKey] = useState("");
  const [kakaoSettingsBusy, setKakaoSettingsBusy] = useState(false);
  const [kakaoConnectionMessage, setKakaoConnectionMessage] = useState("");
  const [aiDraft, setAiDraft] = useState("");
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([]);
  const [aiPreviews, setAiPreviews] = useState<AiPreview[]>([]);
  const [aiOrganizing, setAiOrganizing] = useState(false);
  const [aiBatchSaving, setAiBatchSaving] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiRecommendationPanel, setAiRecommendationPanel] =
    useState<AiRecommendationRecord | null>(null);
  const [aiRecommendationActivity, setAiRecommendationActivity] =
    useState<Activity | null>(null);
  const [aiRecommendationBatch, setAiRecommendationBatch] = useState<
    AiRecommendationBatchItem[]
  >([]);
  const [aiBatchExpandedActivityIds, setAiBatchExpandedActivityIds] = useState<
    number[]
  >([]);
  const [aiRecommendationJustSaved, setAiRecommendationJustSaved] =
    useState(false);
  const [aiRecommendationExpanded, setAiRecommendationExpanded] =
    useState(false);
  const [includeAiSuggestionsInShare, setIncludeAiSuggestionsInShare] =
    useState(false);
  const [
    includeAiSuggestionsInBatchShare,
    setIncludeAiSuggestionsInBatchShare,
  ] = useState(false);
  const [aiRecommendationSelection, setAiRecommendationSelection] =
    useState<AiRecommendationSelection>(emptyAiRecommendationSelection);
  const [aiRecommendationApplying, setAiRecommendationApplying] =
    useState(false);
  const aiDraftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [detailOrganization, setDetailOrganization] = useState<string | null>(
    null,
  );
  const [selectedOrganizations, setSelectedOrganizations] = useState<string[]>(
    [],
  );
  const [managerAlertAcknowledgements, setManagerAlertAcknowledgements] =
    useState<ManagerAlertAcknowledgement[]>([]);
  const [managerAlertsLoading, setManagerAlertsLoading] = useState(false);
  const [managerAlertsSaving, setManagerAlertsSaving] = useState(false);
  const [
    activityReviewAcknowledgements,
    setActivityReviewAcknowledgements,
  ] = useState<ActivityReviewAcknowledgement[]>([]);
  const [activityReviewsLoading, setActivityReviewsLoading] = useState(false);
  const [activityReviewOpen, setActivityReviewOpen] = useState(false);
  const [activityReviewDrafts, setActivityReviewDrafts] = useState<
    Record<number, ActivityReviewDraft>
  >({});
  const [activityReviewSavingIds, setActivityReviewSavingIds] = useState<
    number[]
  >([]);
  const [activityReviewAssignees, setActivityReviewAssignees] = useState<
    ActivityReviewAssignee[]
  >([]);
  const [activityReviewAssigneesLoading, setActivityReviewAssigneesLoading] =
    useState(false);
  const [activityReviewTransferOpenId, setActivityReviewTransferOpenId] =
    useState<number | null>(null);
  const [activityReviewTransferTargets, setActivityReviewTransferTargets] =
    useState<Record<number, string>>({});
  const sessionRole = session?.member.role;
  const sessionStatus = session?.member.status;
  const isOwner = session?.member.role === "admin";
  const isApprovedMember = sessionStatus === "approved";
  const canManageMembers = Boolean(
    session && memberCan(session.member, "members:manage"),
  );
  const canManageRecords = Boolean(
    session && memberCan(session.member, "records:manage"),
  );
  const canManageIntegration = Boolean(
    session && memberCan(session.member, "integration:manage"),
  );
  const canManageBackup = Boolean(
    session && memberCan(session.member, "backup:manage"),
  );
  const canDeleteRecords = isApprovedMember;
  const canManageMap = isApprovedMember;
  const canExportData = isApprovedMember;
  const managementNavItems = session
    ? [
        canManageRecords && {
          id: "records" as View,
          label: "팀 업무 현황",
          mark: "C",
        },
        canManageRecords && {
          id: "organizations" as View,
          label: "관리자 영업 점검",
          mark: "O",
        },
        canManageMembers && {
          id: "team" as View,
          label: "구성원 관리",
          mark: "T",
        },
        canManageIntegration && {
          id: "integration" as View,
          label: "API 등록·관리",
          mark: "A",
        },
        canManageBackup && {
          id: "backup" as View,
          label: "데이터 백업·복구",
          mark: "B",
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

  async function loadRecords(scope?: RecordsScope) {
    try {
      setLoading(true);
      const requestedScope =
        scope ??
        (recordsFullyLoaded || view !== "dashboard" ? "full" : "dashboard");
      const nextRecords = await requestRecords(requestedScope);
      setRecords(nextRecords);
      if (requestedScope === "full") {
        recordsFullyLoadedRef.current = true;
        setRecordsFullyLoaded(true);
      }
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "기록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshRecordsInBackground() {
    try {
      const requestedScope =
        recordsFullyLoaded || view !== "dashboard" ? "full" : "dashboard";
      const nextRecords = await requestRecords(requestedScope);
      setRecords(nextRecords);
      if (requestedScope === "full") {
        recordsFullyLoadedRef.current = true;
        setRecordsFullyLoaded(true);
      }
      setError("");
    } catch {
      setToast("저장은 완료했습니다. 최신 목록은 잠시 후 다시 확인해 주세요.");
    }
  }

  async function loadActivityReviews() {
    try {
      setActivityReviewsLoading(true);
      const acknowledgements =
        await requestActivityReviewAcknowledgements();
      setActivityReviewAcknowledgements(acknowledgements);
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "내 기록 점검 상태를 불러오지 못했습니다.",
      );
    } finally {
      setActivityReviewsLoading(false);
    }
  }

  async function loadActivityReviewAssignees() {
    try {
      setActivityReviewAssigneesLoading(true);
      const response = await fetch("/api/members?scope=assignees", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        members?: Record<string, unknown>[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "담당자 목록을 불러오지 못했습니다.");
      }
      setActivityReviewAssignees(
        (payload.members ?? []).map((member) => ({
          id: Number(member.id),
          displayName: String(member.display_name ?? ""),
        })),
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "담당자 목록을 불러오지 못했습니다.",
      );
    } finally {
      setActivityReviewAssigneesLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const recordsPromise = requestRecords("dashboard")
      .then((nextRecords) => ({ nextRecords, recordsError: null }))
      .catch((recordsError: unknown) => ({
        nextRecords: null,
        recordsError,
      }));
    void requestSession()
      .then(async (nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setSessionLoading(false);
        if (nextSession.member.status === "approved") {
          void loadActivityReviewAssignees();
          const { nextRecords, recordsError } = await recordsPromise;
          if (!active) return;
          if (recordsError) throw recordsError;
          if (!recordsFullyLoadedRef.current) {
            setRecords(nextRecords ?? []);
            setRecordsFullyLoaded(false);
          }
          void requestActivityReviewAcknowledgements()
            .then((acknowledgements) => {
              if (active) {
                setActivityReviewAcknowledgements(acknowledgements);
              }
            })
            .catch(() => {
              // 기록 본문은 그대로 사용할 수 있으므로 점검 상태만 다음에 다시 불러옵니다.
            });
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
    if (view === "map") {
      setMapVisited(true);
    }
  }, [view]);

  useEffect(() => {
    if (sessionStatus !== "approved") return;
    const heartbeat = () => {
      void fetch("/api/presence", {
        method: "POST",
        cache: "no-store",
        keepalive: true,
      }).catch(() => undefined);
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 15_000);
    return () => window.clearInterval(timer);
  }, [sessionStatus]);

  useEffect(() => {
    if (view !== "team" || !session?.canViewPresence) return;
    let active = true;
    const refresh = () => {
      void requestMemberPresence()
        .then((result) => {
          if (!active) return;
          setMemberPresence(result.members);
          setPresenceUpdatedAt(result.serverTime);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [session?.canViewPresence, view]);

  useEffect(() => {
    if (
      sessionStatus !== "approved" ||
      view === "dashboard" ||
      recordsFullyLoaded ||
      fullRecordsLoadingRef.current
    ) {
      return;
    }
    fullRecordsLoadingRef.current = true;
    setLoading(true);
    void requestRecords("full")
      .then((nextRecords) => {
        setRecords(nextRecords);
        recordsFullyLoadedRef.current = true;
        setRecordsFullyLoaded(true);
        setError("");
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "전체 기록을 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        fullRecordsLoadingRef.current = false;
        setLoading(false);
      });
  }, [recordsFullyLoaded, sessionStatus, view]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setPresentationMode(
      window.sessionStorage.getItem(presentationModeStorageKey) === "active",
    );
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeProfileMenu = (event: PointerEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setProfileMenuOpen(false);
      }
    };
    const closeProfileMenuWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeProfileMenu);
    document.addEventListener("keydown", closeProfileMenuWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeProfileMenu);
      document.removeEventListener("keydown", closeProfileMenuWithEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!session || isOwner || !presentationMode) return;
    window.sessionStorage.removeItem(presentationModeStorageKey);
    setPresentationMode(false);
  }, [session, isOwner, presentationMode]);

  useEffect(() => {
    if (!isOwner || !presentationMode) return;
    const exitPresentationMode = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      window.sessionStorage.removeItem(presentationModeStorageKey);
      setPresentationMode(false);
      setToast("시연 모드를 종료했습니다.");
    };
    document.addEventListener("keydown", exitPresentationMode);
    return () => document.removeEventListener("keydown", exitPresentationMode);
  }, [isOwner, presentationMode]);

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
        (presentationMode && managementViews.has(nextView)) ||
        ((nextView === "organizations" || nextView === "records") &&
          !canManageRecords) ||
        (nextView === "team" && !canManageMembers) ||
        (nextView === "integration" && !canManageIntegration) ||
        (nextView === "backup" && !canManageBackup)
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
      if (
        (nextView === "records" || nextView === "team") &&
        canManageMembers
      ) {
        void loadTeam();
      }
      if (nextView === "organizations" && canManageRecords) {
        void loadManagerAlerts();
      }

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
    canManageIntegration,
    canManageBackup,
    isOwner,
    presentationMode,
  ]);

  const registeredSalesNames = useMemo(
    () => [
      ...new Set(
        activityReviewAssignees
          .map((member) => member.displayName.trim())
          .filter(Boolean),
      ),
    ],
    [activityReviewAssignees],
  );

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
      if (view === "records" && teamPeriodDays !== "all") {
        const today = new Date();
        const recentStart = new Date(today);
        recentStart.setDate(today.getDate() - (teamPeriodDays - 1));
        if (
          record.activityDate < toLocalDateValue(recentStart) ||
          record.activityDate > toLocalDateValue(today)
        ) {
          return false;
        }
      }
      const registeredSalesManager = resolveRegisteredSalesName(
        record.progressManager,
        registeredSalesNames,
      );
      if (view === "records" && !registeredSalesManager) return false;
      if (
        view === "records" &&
        selectedTeamMember !== "전체" &&
        registeredSalesManager !== selectedTeamMember
      ) {
        return false;
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
    teamPeriodDays,
    activeAwardsOnly,
    registeredSalesNames,
    selectedTeamMember,
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
        .slice(0, 20),
    [records],
  );

  const today = new Date();
  const todayValue = toLocalDateValue(today);
  const activityReviewById = useMemo(
    () =>
      new Map(
        activityReviewAcknowledgements.map(
          (acknowledgement) =>
            [acknowledgement.activityId, acknowledgement] as const,
        ),
      ),
    [activityReviewAcknowledgements],
  );
  const myRecentReviewRecords = useMemo(() => {
    const displayName = session?.member.displayName.trim() ?? "";
    if (!displayName) return [];
    return [...records]
      .filter(
        (record) =>
          record.category !== "내부" &&
          record.progressManager.trim() === displayName,
      )
      .filter((record) => {
        const createdDate =
          timestampDateValue(record.createdAt) || record.activityDate;
        return (
          Boolean(createdDate) &&
          createdDate <= todayValue &&
          daysSinceDate(createdDate, todayValue) <= 7
        );
      })
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.activityDate.localeCompare(left.activityDate) ||
          right.id - left.id,
      );
  }, [records, session, todayValue]);
  const isActivityReviewProcessed = (record: Activity) => {
    const acknowledgement = activityReviewById.get(record.id);
    return Boolean(
      acknowledgement &&
        acknowledgement.issueSignature === activityReviewSignature(record) &&
        (!acknowledgement.snoozedUntil ||
          acknowledgement.snoozedUntil >= todayValue),
    );
  };
  const pendingActivityReviewRecords = myRecentReviewRecords.filter(
    (record) =>
      activityReviewFields(record).length > 0 &&
      !isActivityReviewProcessed(record),
  );
  const todayActivityReviewRecords = myRecentReviewRecords.filter(
    (record) => timestampDateValue(record.createdAt) === todayValue,
  );
  const completedTodayActivityReviewCount = todayActivityReviewRecords.filter(
    (record) =>
      activityReviewFields(record).length === 0 ||
      isActivityReviewProcessed(record),
  ).length;
  const formProgressManagement = automaticProgressManagement(
    form.progressSchedule,
  );
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
  const schedulesWithinRange = (range: ScheduleRange) => {
    const endValue =
      range === "all"
        ? ""
        : (() => {
            const end = new Date(`${todayValue}T00:00:00`);
            end.setDate(end.getDate() + range - 1);
            return toLocalDateValue(end);
          })();
    return progressSchedules
      .map((row) => ({
        ...row,
        items: row.items.filter(
          (item) =>
            item.date >= todayValue &&
            (!endValue || item.date <= endValue),
        ),
      }))
      .filter((row) => row.items.length > 0);
  };
  const dashboardUpcomingProgressSchedules = schedulesWithinRange(14);
  const dashboardUpcomingProgressScheduleCount =
    dashboardUpcomingProgressSchedules.reduce(
      (total, row) => total + row.items.length,
      0,
    );
  const upcomingProgressSchedules = schedulesWithinRange(scheduleRange);
  const upcomingProgressScheduleCount = upcomingProgressSchedules.reduce(
    (total, row) => total + row.items.length,
    0,
  );

  const organizations = useMemo<OrganizationHealth[]>(() => {
    const map = new Map<string, Activity[]>();
    records.forEach((record) => {
      const current = map.get(record.organization) ?? [];
      current.push(record);
      map.set(record.organization, current);
    });
    return [...map.entries()]
      .map(([name, history]) => {
        const latest = [...history].sort(
          (left, right) =>
            right.activityDate.localeCompare(left.activityDate) ||
            right.id - left.id,
        )[0];
        const daysSinceActivity = daysSinceDate(
          latest.activityDate,
          todayValue,
        );
        const completed =
          latest.status.includes("완료") ||
          completedAwardStages.has(latest.awardStage);
        const overdue =
          !completed &&
          latest.followUpRequired &&
          Boolean(
            latest.followUpDate && latest.followUpDate < todayValue,
          );
        const stalled = !completed && daysSinceActivity >= 14;
        const ownerless = !latest.progressManager.trim();
        const contactActivity =
          /TM|통화|미팅|방문|상담|제안/.test(latest.activityType);
        const missingInfo =
          (latest.followUpRequired && !latest.followUpDate) ||
          (latest.followUpRequired && !latest.nextAction.trim()) ||
          (contactActivity && !latest.contactName.trim());
        const highOpportunity =
          latest.temperature === "높음" ||
          latest.awardStatus === "위즈업 수주" ||
          (!completed &&
            latest.awardStage !== "미정" &&
            latest.awardStage !== "") ||
          parseMoneyAmount(latest.budgetAmount) > 0;
        const issues: string[] = [];
        if (overdue) issues.push("재연락 기한 경과");
        if (stalled) issues.push(`${daysSinceActivity}일간 활동 없음`);
        if (ownerless) issues.push("진행 담당자 미지정");
        if (latest.followUpRequired && !latest.followUpDate) {
          issues.push("재연락 날짜 미지정");
        }
        if (latest.followUpRequired && !latest.nextAction.trim()) {
          issues.push("다음 행동 미입력");
        }
        if (contactActivity && !latest.contactName.trim()) {
          issues.push("기관 담당자 미입력");
        }
        let score =
          (overdue ? 100 : 0) +
          (stalled ? 35 : 0) +
          (ownerless ? 25 : 0) +
          (missingInfo ? 20 : 0);
        if (highOpportunity && issues.length) score += 15;
        const issueSignature = JSON.stringify({
          latestId: latest.id,
          updatedAt: latest.updatedAt,
          overdue,
          stalled,
          ownerless,
          missingInfo,
          followUpRequired: latest.followUpRequired,
          followUpDate: latest.followUpDate,
          nextAction: latest.nextAction,
          progressManager: latest.progressManager,
          contactName: latest.contactName,
          status: latest.status,
        });
        return {
          name,
          latest,
          count: history.length,
          daysSinceActivity,
          overdue,
          stalled,
          ownerless,
          missingInfo,
          highOpportunity,
          issues,
          issueSignature,
          score,
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.latest.activityDate.localeCompare(left.latest.activityDate) ||
          left.name.localeCompare(right.name, "ko-KR"),
      );
  }, [records, todayValue]);

  const managerAlertByOrganization = useMemo(
    () =>
      new Map(
        managerAlertAcknowledgements.map(
          (acknowledgement) =>
            [acknowledgement.organization, acknowledgement] as const,
        ),
      ),
    [managerAlertAcknowledgements],
  );

  const isManagerAlertProcessed = (organization: OrganizationHealth) => {
    const acknowledgement = managerAlertByOrganization.get(organization.name);
    return Boolean(
      acknowledgement &&
        acknowledgement.issueSignature === organization.issueSignature &&
        (!acknowledgement.snoozedUntil ||
          acknowledgement.snoozedUntil >= todayValue),
    );
  };

  const activeManagerOrganizations = organizations.filter(
    (organization) =>
      organization.issues.length > 0 && !isManagerAlertProcessed(organization),
  );
  const processedManagerOrganizations = organizations.filter(
    (organization) =>
      organization.issues.length > 0 && isManagerAlertProcessed(organization),
  );

  const managerOrganizations = useMemo(() => {
    const keyword = managerSearch.trim().toLocaleLowerCase("ko-KR");
    const source =
      managerIssueFilter === "processed"
        ? processedManagerOrganizations
        : activeManagerOrganizations;
    return source.filter((organization) => {
      if (
        managerIssueFilter === "attention" &&
        organization.issues.length === 0
      ) {
        return false;
      }
      if (managerIssueFilter === "overdue" && !organization.overdue) {
        return false;
      }
      if (managerIssueFilter === "stalled" && !organization.stalled) {
        return false;
      }
      if (managerIssueFilter === "ownerless" && !organization.ownerless) {
        return false;
      }
      if (managerIssueFilter === "missing" && !organization.missingInfo) {
        return false;
      }
      if (!keyword) return true;
      return [
        organization.name,
        organization.latest.progressManager,
        organization.latest.contactName,
        organization.latest.region,
        organization.latest.topic,
        organization.latest.nextAction,
        ...organization.issues,
      ].some((value) =>
        value.toLocaleLowerCase("ko-KR").includes(keyword),
      );
    });
  }, [
    activeManagerOrganizations,
    processedManagerOrganizations,
    managerIssueFilter,
    managerSearch,
  ]);

  const teamPeriodRecords = useMemo(() => {
    const periodRecords =
      teamPeriodDays === "all"
        ? records
        : records.filter((record) => {
            const periodStart = new Date();
            periodStart.setDate(periodStart.getDate() - (teamPeriodDays - 1));
            const periodStartValue = toLocalDateValue(periodStart);
            return (
              record.activityDate >= periodStartValue &&
              record.activityDate <= todayValue
            );
          });
    return periodRecords.filter((record) =>
      Boolean(
        resolveRegisteredSalesName(
          record.progressManager,
          registeredSalesNames,
        ),
      ),
    );
  }, [records, registeredSalesNames, teamPeriodDays, todayValue]);

  const teamPeriodLatestRecords = useMemo(() => {
    const latestByOrganization = new Map<string, Activity>();
    teamPeriodRecords.forEach((record) => {
      const current = latestByOrganization.get(record.organization);
      if (
        !current ||
        record.activityDate > current.activityDate ||
        (record.activityDate === current.activityDate &&
          record.id > current.id)
      ) {
        latestByOrganization.set(record.organization, record);
      }
    });
    return [...latestByOrganization.values()];
  }, [teamPeriodRecords]);

  const teamWorkMetrics = useMemo<TeamWorkMetric[]>(() => {
    const statusOrder = { support: 0, check: 1, good: 2 } as const;
    return registeredSalesNames
      .map((name) => {
        const managedPeriodRecords = teamPeriodRecords.filter(
          (record) =>
            resolveRegisteredSalesName(
              record.progressManager,
              registeredSalesNames,
            ) === name,
        );
        const allManagedRecords = records.filter(
          (record) =>
            resolveRegisteredSalesName(
              record.progressManager,
              registeredSalesNames,
            ) === name,
        );
        const assignedRecords = teamPeriodLatestRecords.filter(
          (record) =>
            resolveRegisteredSalesName(
              record.progressManager,
              registeredSalesNames,
            ) === name &&
            !record.status.includes("완료") &&
            !completedAwardStages.has(record.awardStage),
        );
        const conversionRecords = teamPeriodLatestRecords.filter(
          (record) =>
            resolveRegisteredSalesName(
              record.progressManager,
              registeredSalesNames,
            ) === name,
        );
        const followUpRecords = assignedRecords.filter(
          (record) => record.followUpRequired,
        );
        const overdueCount = followUpRecords.filter(
          (record) =>
            Boolean(
              record.followUpDate &&
                record.followUpDate < todayValue,
            ),
        ).length;
        const missingDueDate = followUpRecords.filter(
          (record) => !record.followUpDate,
        ).length;
        const missingCount = assignedRecords.filter((record) => {
          const contactActivity =
            /TM|통화|미팅|방문|상담|제안/.test(record.activityType);
          return (
            (record.followUpRequired && !record.followUpDate) ||
            (record.followUpRequired && !record.nextAction.trim()) ||
            (contactActivity && !record.contactName)
          );
        }).length;
        const lastDate = allManagedRecords.reduce(
          (latest, record) =>
            record.activityDate > latest ? record.activityDate : latest,
          "",
        );
        const inactiveDays = daysSinceDate(lastDate, todayValue);
        const followUpCount = followUpRecords.length;
        const followUpRate = followUpCount
          ? Math.max(
              0,
              Math.round(
                ((followUpCount - overdueCount - missingDueDate) /
                  followUpCount) *
                100,
              ),
            )
          : null;
        const conversionWonCount = conversionRecords.filter(
          (record) => record.awardStatus === "위즈업 수주",
        ).length;
        const conversionOrganizationCount = conversionRecords.length;
        const conversionRate = conversionOrganizationCount
          ? Math.round(
              (conversionWonCount / conversionOrganizationCount) * 100,
            )
          : null;
        const organizationCount = new Set(
          managedPeriodRecords.map((record) => record.organization),
        ).size;
        const status: TeamWorkMetric["status"] =
          overdueCount >= 3 || missingCount >= 5
            ? "support"
            : overdueCount > 0 || missingCount > 0
              ? "check"
              : "good";
        return {
          name,
          activityCount: managedPeriodRecords.length,
          organizationCount,
          followUpCount,
          overdueCount,
          followUpRate,
          missingCount,
          conversionWonCount,
          conversionOrganizationCount,
          conversionRate,
          lastDate,
          inactiveDays,
          status,
        };
      })
      .sort(
        (left, right) =>
          statusOrder[left.status] - statusOrder[right.status] ||
          right.overdueCount - left.overdueCount ||
          right.activityCount - left.activityCount ||
          left.name.localeCompare(right.name, "ko-KR"),
      );
  }, [
    records,
    registeredSalesNames,
    teamPeriodLatestRecords,
    teamPeriodRecords,
    todayValue,
  ]);

  const allTeamAttentionItems = useMemo<TeamAttentionItem[]>(() => {
    return teamPeriodLatestRecords
      .filter((record) => {
        const completed =
          record.status.includes("완료") ||
          completedAwardStages.has(record.awardStage);
        if (completed || !record.progressManager.trim()) return false;
        const overdue = Boolean(
          record.followUpRequired &&
            record.followUpDate &&
            record.followUpDate < todayValue,
        );
        const contactActivity =
          /TM|통화|미팅|방문|상담|제안/.test(record.activityType);
        return (
          overdue ||
          (record.followUpRequired && !record.followUpDate) ||
          (record.followUpRequired && !record.nextAction.trim()) ||
          (contactActivity && !record.contactName.trim())
        );
      })
      .map((record) => {
        const reasons: string[] = [];
        if (
          record.followUpRequired &&
          record.followUpDate &&
          record.followUpDate < todayValue
        ) {
          reasons.push(
            `재연락 ${Math.max(
              daysSinceDate(record.followUpDate, todayValue),
              1,
            )}일 지연`,
          );
        }
        if (record.followUpRequired && !record.followUpDate) {
          reasons.push("재연락 날짜 미지정");
        }
        if (record.followUpRequired && !record.nextAction.trim()) {
          reasons.push("다음 행동 미입력");
        }
        if (
          /TM|통화|미팅|방문|상담|제안/.test(record.activityType) &&
          !record.contactName.trim()
        ) {
          reasons.push("기관 담당자 미입력");
        }
        return { record, reasons };
      })
      .sort((left, right) => {
        const leftOverdue = left.reasons.some((reason) =>
          reason.startsWith("재연락 "),
        );
        const rightOverdue = right.reasons.some((reason) =>
          reason.startsWith("재연락 "),
        );
        if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
        return (
          (left.record.followUpDate || "9999-12-31").localeCompare(
            right.record.followUpDate || "9999-12-31",
          ) ||
          right.record.activityDate.localeCompare(left.record.activityDate) ||
          right.record.id - left.record.id
        );
      });
  }, [teamPeriodLatestRecords, todayValue]);

  const teamAttentionCountByManager = useMemo(() => {
    const counts = new Map<string, number>();
    allTeamAttentionItems.forEach(({ record }) => {
      const manager = resolveRegisteredSalesName(
        record.progressManager,
        registeredSalesNames,
      );
      if (!manager) return;
      counts.set(
        manager,
        (counts.get(manager) ?? 0) + 1,
      );
    });
    return counts;
  }, [allTeamAttentionItems, registeredSalesNames]);

  const visibleTeamWorkMetrics = useMemo(
    () =>
      teamWorkMetrics.filter((metric) => {
        if (teamMetricFocus === "active") return metric.activityCount > 0;
        if (teamMetricFocus === "attention") {
          return (teamAttentionCountByManager.get(metric.name) ?? 0) > 0;
        }
        return true;
      }),
    [teamAttentionCountByManager, teamMetricFocus, teamWorkMetrics],
  );

  const teamAttentionItems = useMemo<TeamAttentionItem[]>(
    () =>
      selectedTeamMember === "전체"
        ? allTeamAttentionItems
        : allTeamAttentionItems.filter(
            ({ record }) =>
              resolveRegisteredSalesName(
                record.progressManager,
                registeredSalesNames,
              ) === selectedTeamMember,
          ),
    [allTeamAttentionItems, registeredSalesNames, selectedTeamMember],
  );

  const teamAttentionByRecordId = useMemo(
    () =>
      new Map(
        teamAttentionItems.map((item) => [item.record.id, item] as const),
      ),
    [teamAttentionItems],
  );

  const teamDetailRecords =
    view === "records" && teamDetailMode === "attention"
      ? teamAttentionItems.map((item) => item.record)
      : displayedRecords;

  function openNew() {
    setEditingId(null);
    setCreatingAward(false);
    formOrganizationSourceRef.current = "";
    setRecordEntryMode("manual");
    setActivityImportFileName("");
    setActivityImportRows([]);
    setActivityImportError("");
    setActivityImportProgress("");
    setForm({ ...emptyForm, activityDate: new Date().toISOString().slice(0, 10) });
    setModalOpen(true);
  }

  function openNewAward() {
    setEditingId(null);
    setCreatingAward(true);
    formOrganizationSourceRef.current = "";
    setRecordEntryMode("manual");
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
    formOrganizationSourceRef.current = record.organization;
    setRecordEntryMode("manual");
    setForm(activityToForm(record));
    setModalOpen(true);
  }

  function updateFormOrganization(nextOrganization: string) {
    setForm((current) => {
      const canonical = nextOrganization.trim();
      const sourceOrganizations = [
        current.organization.trim(),
        formOrganizationSourceRef.current.trim(),
      ].filter(
        (value, index, values) =>
          Boolean(value) && values.indexOf(value) === index,
      );
      const replaceReferences = (value: string) =>
        canonical
          ? sourceOrganizations.reduce(
              (result, source) =>
                replaceOrganizationReferences(result, source, canonical),
              value,
            )
          : value;
      const aiForm = current as FormState & {
        recommendation?: AiRecommendationDraft;
      };
      const updated = {
        ...current,
        organization: nextOrganization,
        topic: replaceReferences(current.topic),
        summary: compactShareSummary(replaceReferences(current.summary)),
        nextAction: replaceReferences(current.nextAction),
        notes: replaceReferences(current.notes),
      } as FormState & { recommendation?: AiRecommendationDraft };
      if (aiForm.recommendation) {
        updated.recommendation = {
          ...aiForm.recommendation,
          meetingSummary: compactShareSummary(
            replaceReferences(aiForm.recommendation.meetingSummary),
          ),
        };
      }
      return updated;
    });
  }

  function reviewActivityImportRows(rows: ActivityImportRow[]) {
    const existing = new Set(
      records.map((record) => activityImportSignature(record)),
    );
    const seen = new Set<string>();
    return rows.map<ReviewedActivityImportRow>((row) => {
      const signature = activityImportSignature(row.values);
      const duplicate = existing.has(signature) || seen.has(signature);
      seen.add(signature);
      return {
        ...row,
        duplicate,
        selected: row.errors.length === 0 && !duplicate,
        warnings: duplicate
          ? [...row.warnings, "현재 기록 또는 업로드 파일 안에 같은 내용이 있습니다."]
          : row.warnings,
      };
    });
  }

  async function handleActivityImportFile(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setActivityImportError("");
    setActivityImportProgress("");
    if (file.size > 12 * 1024 * 1024) {
      setActivityImportFileName("");
      setActivityImportRows([]);
      setActivityImportError("12MB 이하의 엑셀 또는 CSV 파일을 선택해 주세요.");
      return;
    }
    try {
      const rows = await parseActivityImportFile(file);
      setActivityImportFileName(file.name);
      setActivityImportRows(reviewActivityImportRows(rows));
    } catch (caught) {
      setActivityImportFileName(file.name);
      setActivityImportRows([]);
      setActivityImportError(
        caught instanceof Error
          ? caught.message
          : "엑셀 파일을 읽지 못했습니다.",
      );
    }
  }

  function selectImportableActivityRows() {
    setActivityImportRows((current) =>
      current.map((row) => ({
        ...row,
        selected: row.errors.length === 0 && !row.duplicate,
      })),
    );
  }

  async function saveActivityImportBatch(event: FormEvent) {
    event.preventDefault();
    const selectedRows = activityImportRows.filter(
      (row) => row.selected && row.errors.length === 0,
    );
    if (!selectedRows.length || activityImportSaving) {
      setActivityImportError("저장할 정상 기록을 한 건 이상 선택해 주세요.");
      return;
    }

    const savedRows = new Set<number>();
    const failedRows = new Map<number, string>();
    setActivityImportSaving(true);
    setActivityImportError("");
    setActivityImportProgress(`0 / ${selectedRows.length}건 저장 중`);
    const institutionDecisions = new Map();
    for (let index = 0; index < selectedRows.length; index += 1) {
      const row = selectedRows[index];
      try {
        const { response, payload } =
          await fetchWithInstitutionConfirmation("/api/records", {
          method: "POST",
            body: row.values as unknown as Record<string, unknown>,
          }, institutionDecisions);
        if (!response.ok) {
          throw new Error(
            String(payload.error || `${row.rowNumber}행을 저장하지 못했습니다.`),
          );
        }
        const savedId = Number(payload.record?.id);
        if (Number.isInteger(savedId) && savedId > 0) {
          const savedActivity = normalize({
            ...row.values,
            ...(payload.record ?? {}),
            id: savedId,
            createdByName: identity.displayName,
          });
          setRecords((current) => upsertActivity(current, savedActivity));
        }
        savedRows.add(row.rowNumber);
      } catch (caught) {
        failedRows.set(
          row.rowNumber,
          caught instanceof Error
            ? caught.message
            : `${row.rowNumber}행을 저장하지 못했습니다.`,
        );
      }
      setActivityImportProgress(
        `${index + 1} / ${selectedRows.length}건 확인 중`,
      );
    }

    const remainingRows = activityImportRows
      .filter((row) => !savedRows.has(row.rowNumber))
      .map((row) => {
        const failedMessage = failedRows.get(row.rowNumber);
        return failedMessage
          ? {
              ...row,
              selected: false,
              errors: [...row.errors, failedMessage],
            }
          : row;
      });
    setActivityImportRows(remainingRows);
    setActivityImportSaving(false);
    setActivityImportProgress("");
    void refreshRecordsInBackground();

    if (!remainingRows.length) {
      setModalOpen(false);
      setToast(`${savedRows.size}건의 새 기록을 한 번에 등록했습니다.`);
      return;
    }
    setToast(
      failedRows.size
        ? `${savedRows.size}건을 저장했고 ${failedRows.size}건은 오류 내용을 확인해 주세요.`
        : `${savedRows.size}건을 저장했습니다. 제외된 ${remainingRows.length}건은 미리보기에 남겨두었습니다.`,
    );
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
          isSales: Number(member.is_sales ?? 0) === 1,
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

  async function loadPresence() {
    if (!session?.canViewPresence) return;
    try {
      const result = await requestMemberPresence();
      setMemberPresence(result.members);
      setPresenceUpdatedAt(result.serverTime);
    } catch {
      // 업무 화면 사용에는 영향이 없으므로 다음 자동 갱신에서 다시 시도합니다.
    }
  }

  async function loadManagerAlerts() {
    try {
      setManagerAlertsLoading(true);
      const response = await fetch("/api/manager-alerts", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        acknowledgements?: ManagerAlertAcknowledgement[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error || "처리한 관리자 알림을 불러오지 못했습니다.",
        );
      }
      setManagerAlertAcknowledgements(payload.acknowledgements ?? []);
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "처리한 관리자 알림을 불러오지 못했습니다.",
      );
    } finally {
      setManagerAlertsLoading(false);
    }
  }

  async function loadIntegration() {
    try {
      const [openAIResponse, kakaoResponse] = await Promise.all([
        fetch("/api/openai-settings", { cache: "no-store" }),
        fetch("/api/map/config", { cache: "no-store" }),
      ]);
      const openAIPayload =
        (await openAIResponse.json()) as OpenAISettingsStatus & {
          error?: string;
        };
      const kakaoPayload =
        (await kakaoResponse.json()) as KakaoSettingsStatus & {
          error?: string;
        };
      if (!openAIResponse.ok) {
        throw new Error(
          openAIPayload.error || "OpenAI API 설정을 불러오지 못했습니다.",
        );
      }
      if (!kakaoResponse.ok) {
        throw new Error(
          kakaoPayload.error || "카카오맵 API 설정을 불러오지 못했습니다.",
        );
      }
      setOpenAISettings(openAIPayload);
      setOpenAIModel(openAIPayload.model || "gpt-5.4-mini");
      setOpenAIApiKey("");
      setOpenAIConnectionMessage("");
      setKakaoSettings(kakaoPayload);
      setKakaoJavascriptKey("");
      setKakaoConnectionMessage("");
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "API 연결 정보를 불러오지 못했습니다.",
      );
    }
  }

  async function manageOpenAISettings(action: "test" | "save" | "revert") {
    if (
      action !== "revert" &&
      (!openAIApiKey.trim() || !openAIApiKey.trim().startsWith("sk-"))
    ) {
      setOpenAIConnectionMessage("새 OpenAI API 키를 입력해 주세요.");
      return;
    }
    if (
      action === "revert" &&
      !window.confirm("등록한 키를 지우고 서버의 기존 키로 되돌릴까요?")
    ) {
      return;
    }
    try {
      setOpenAISettingsBusy(true);
      setOpenAIConnectionMessage("");
      const response = await fetch("/api/openai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          apiKey: openAIApiKey,
          model: openAIModel,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        keyLast4?: string;
        model?: string;
        status?: OpenAISettingsStatus;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "OpenAI API 설정을 처리하지 못했습니다.");
      }
      if (action === "test") {
        setOpenAIConnectionMessage(
          `연결 확인 완료 · ${payload.model || openAIModel} · 키 끝 ${
            payload.keyLast4 || ""
          }`,
        );
        return;
      }
      if (payload.status) {
        setOpenAISettings(payload.status);
        setOpenAIModel(payload.status.model);
      }
      setOpenAIApiKey("");
      setOpenAIConnectionMessage(
        action === "save"
          ? "새 API 키로 교체했습니다."
          : "서버의 기존 API 키로 되돌렸습니다.",
      );
      setToast(
        action === "save"
          ? "OpenAI API 키를 안전하게 교체했습니다."
          : "서버의 기존 OpenAI API 키를 사용합니다.",
      );
    } catch (caught) {
      setOpenAIConnectionMessage(
        caught instanceof Error
          ? caught.message
          : "OpenAI API 설정을 처리하지 못했습니다.",
      );
    } finally {
      setOpenAISettingsBusy(false);
    }
  }

  async function manageKakaoSettings(action: "test" | "save" | "revert") {
    if (
      action !== "revert" &&
      !/^[A-Za-z0-9_-]{16,128}$/.test(kakaoJavascriptKey.trim())
    ) {
      setKakaoConnectionMessage("카카오 JavaScript 키를 다시 확인해 주세요.");
      return;
    }
    if (
      action === "revert" &&
      !window.confirm("등록한 키를 지우고 서버의 기존 카카오맵 키로 되돌릴까요?")
    ) {
      return;
    }
    try {
      setKakaoSettingsBusy(true);
      setKakaoConnectionMessage("");
      const response = await fetch("/api/map/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          javascriptKey: kakaoJavascriptKey,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        keyLast4?: string;
        status?: KakaoSettingsStatus;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "카카오맵 API 설정을 처리하지 못했습니다.");
      }
      if (action === "test") {
        setKakaoConnectionMessage(
          `지도 연결 확인 완료 · 키 끝 ${payload.keyLast4 || ""}`,
        );
        return;
      }
      if (payload.status) {
        setKakaoSettings(payload.status);
      }
      setKakaoJavascriptKey("");
      setKakaoConnectionMessage(
        action === "save"
          ? "새 카카오 JavaScript 키로 교체했습니다."
          : "서버의 기존 카카오맵 키로 되돌렸습니다.",
      );
      setToast(
        action === "save"
          ? "카카오맵 API 키를 안전하게 교체했습니다."
          : "서버의 기존 카카오맵 API 키를 사용합니다.",
      );
    } catch (caught) {
      setKakaoConnectionMessage(
        caught instanceof Error
          ? caught.message
          : "카카오맵 API 설정을 처리하지 못했습니다.",
      );
    } finally {
      setKakaoSettingsBusy(false);
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
      (presentationMode && managementViews.has(nextView)) ||
      ((nextView === "organizations" || nextView === "records") &&
        !canManageRecords) ||
      (nextView === "team" && !canManageMembers) ||
      (nextView === "integration" && !canManageIntegration) ||
      (nextView === "backup" && !canManageBackup)
    ) {
      navigateTo("dashboard", { replace: true });
      setMobileNav(false);
      setToast("이 메뉴를 사용할 권한이 없습니다.");
      return;
    }
    navigateTo(nextView);
    setMobileNav(false);
    if (nextView === "records") {
      await loadActivityReviewAssignees();
    }
    if (nextView === "team" && canManageMembers) {
      await Promise.all([loadTeam(), loadActivityReviewAssignees()]);
    }
    if (nextView === "organizations" && canManageRecords) {
      await loadManagerAlerts();
    }
    if (nextView === "integration" && canManageIntegration) {
      await loadIntegration();
    }
  }

  function updatePresentationMode(enabled: boolean) {
    if (!isOwner) return;
    if (enabled) {
      window.sessionStorage.setItem(presentationModeStorageKey, "active");
      if (managementViews.has(view)) {
        navigateTo("dashboard", { replace: true });
      }
    } else {
      window.sessionStorage.removeItem(presentationModeStorageKey);
    }
    setPresentationMode(enabled);
    setProfileMenuOpen(false);
    setMobileNav(false);
    setToast(
      enabled
        ? "시연 모드를 시작했습니다. 운영 도구와 사용자 정보를 숨겼습니다. 종료하려면 Esc 키를 누르세요."
        : "시연 모드를 종료했습니다.",
    );
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
          isSales: member.isSales,
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
      await Promise.all([loadTeam(), loadActivityReviewAssignees()]);
      setSession((current) =>
        current
          ? {
              ...current,
              pendingCount: Math.max(
                0,
                current.pendingCount +
                  (member.status === "pending" && status !== "pending"
                    ? -1
                    : member.status !== "pending" && status === "pending"
                      ? 1
                      : 0),
              ),
              approvedCount: Math.max(
                0,
                current.approvedCount +
                  (member.status !== "approved" && status === "approved"
                    ? 1
                    : member.status === "approved" && status !== "approved"
                      ? -1
                      : 0),
              ),
            }
          : current,
      );
      return true;
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "권한을 변경하지 못했습니다.");
      return false;
    }
  }

  async function updateMemberSalesStatus(
    member: TeamMember,
    isSales: boolean,
  ) {
    try {
      const response = await fetch("/api/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: member.id, isSales }),
      });
      const payload = (await response.json()) as {
        member?: Record<string, unknown>;
        error?: string;
      };
      if (!response.ok || !payload.member) {
        throw new Error(
          payload.error || "영업 담당자 설정을 저장하지 못했습니다.",
        );
      }
      setTeamMembers((current) =>
        current.map((item) =>
          item.id === member.id ? { ...item, isSales } : item,
        ),
      );
      if (member.id === session?.member.id) {
        setSession((current) =>
          current
            ? { ...current, member: { ...current.member, isSales } }
            : current,
        );
      }
      if (!isSales && selectedTeamMember === member.displayName) {
        setSelectedTeamMember("전체");
      }
      await loadActivityReviewAssignees();
      setToast(
        isSales
          ? `${member.displayName} 님을 영업 담당자로 등록했습니다.`
          : `${member.displayName} 님은 사이트만 이용하도록 변경했습니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "영업 담당자 설정을 저장하지 못했습니다.",
      );
    }
  }

  async function deleteMember(member: TeamMember, rejection = false) {
    const confirmed = window.confirm(
      rejection
        ? `${member.displayName} 님의 가입을 거절하고 계정을 삭제할까요?\n다시 접속하면 새 승인 요청으로 등록됩니다.`
        : `${member.displayName} 님의 계정을 영구 삭제할까요?\n연결된 업무 이력은 보존되고 로그인 계정만 삭제됩니다.`,
    );
    if (!confirmed) return;

    try {
      const response = await fetch("/api/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: member.id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "계정을 삭제하지 못했습니다.");
      }
      setTeamMembers((current) =>
        current.filter((item) => item.id !== member.id),
      );
      await loadActivityReviewAssignees();
      setSession((current) =>
        current
          ? {
              ...current,
              pendingCount:
                member.status === "pending"
                  ? Math.max(0, current.pendingCount - 1)
                  : current.pendingCount,
            }
          : current,
      );
      setToast(
        rejection
          ? `${member.displayName} 님의 가입을 거절하고 계정을 삭제했습니다.`
          : `${member.displayName} 님의 계정을 삭제했습니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error ? caught.message : "계정을 삭제하지 못했습니다.",
      );
    }
  }

  async function copyText(value: string, message = "복사했습니다.") {
    await navigator.clipboard.writeText(value);
    setToast(message);
  }

  async function copyAiShareText(closeAfterCopy = false) {
    if (!aiRecommendationPanel) return;
    const activity =
      aiRecommendationActivity ??
      records.find(
        (record) => record.id === aiRecommendationPanel.activityId,
      ) ??
      null;
    await copyText(
      buildActivityShareText(
        activity,
        aiRecommendationPanel,
        includeAiSuggestionsInShare,
      ),
      "단톡방 공유 문구를 복사했습니다.",
    );
    if (closeAfterCopy) {
      setAiRecommendationPanel(null);
    }
  }

  function closeAiRecommendationBatch() {
    setAiRecommendationBatch([]);
    setAiBatchExpandedActivityIds([]);
    setIncludeAiSuggestionsInBatchShare(false);
  }

  async function copyAiBatchShareText(closeAfterCopy = false) {
    if (!aiRecommendationBatch.length) return;
    const organizationCount = aiBatchOrganizationCount(aiRecommendationBatch);
    await copyText(
      buildActivityBatchShareText(
        aiRecommendationBatch,
        includeAiSuggestionsInBatchShare,
      ),
      `${organizationCount}개 기관 공유 문구를 복사했습니다.`,
    );
    if (closeAfterCopy) {
      closeAiRecommendationBatch();
    }
  }

  async function shareAiBatchShareText() {
    if (!aiRecommendationBatch.length) return;
    const organizationCount = aiBatchOrganizationCount(aiRecommendationBatch);
    const text = buildActivityBatchShareText(
      aiRecommendationBatch,
      includeAiSuggestionsInBatchShare,
    );
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `${organizationCount}개 기관 미팅·TM 공유`,
          text,
        });
        return;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
      }
    }
    await copyText(
      text,
      "공유 창을 열 수 없어 전체 기관 문구를 대신 복사했습니다.",
    );
  }

  function toggleAiBatchRecommendation(activityId: number) {
    setAiBatchExpandedActivityIds((current) =>
      current.includes(activityId)
        ? current.filter((id) => id !== activityId)
        : [...current, activityId],
    );
  }

  async function shareAiShareText() {
    if (!aiRecommendationPanel) return;
    const activity =
      aiRecommendationActivity ??
      records.find(
        (record) => record.id === aiRecommendationPanel.activityId,
      ) ??
      null;
    const text = buildActivityShareText(
      activity,
      aiRecommendationPanel,
      includeAiSuggestionsInShare,
    );
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `${aiRecommendationPanel.organization} 미팅·TM 공유`,
          text,
        });
        return;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
      }
    }
    await copyText(
      text,
      "공유 창을 열 수 없어 문구를 대신 복사했습니다.",
    );
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
    closeAiRecommendationBatch();
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

  function openAiRecommendation(
    recommendation: AiRecommendationRecord,
    activity: Activity | null = null,
    justSaved = false,
    preserveBatch = false,
  ) {
    if (!preserveBatch) {
      closeAiRecommendationBatch();
    }
    setAiRecommendationPanel(recommendation);
    setAiRecommendationActivity(
      activity ??
        records.find((record) => record.id === recommendation.activityId) ??
        null,
    );
    setAiRecommendationJustSaved(justSaved);
    setAiRecommendationExpanded(false);
    setIncludeAiSuggestionsInShare(false);
    setAiRecommendationSelection({
      products: recommendation.appliedProducts,
      questions: recommendation.appliedQuestions,
      actions: recommendation.appliedActions,
      followUpDate: recommendation.followUpDate,
    });
  }

  async function saveAiRecommendationForRecord(
    activityId: number,
    preview: AiPreview,
    canonicalOrganization = preview.organization,
  ) {
    const recommendation = {
      ...preview.recommendation,
      sourceOrganization: preview.organization,
      meetingSummary: compactShareSummary(
        replaceOrganizationReferences(
          preview.recommendation.meetingSummary,
          preview.organization,
          canonicalOrganization,
        ),
      ),
    };
    const response = await fetch("/api/ai/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activityId,
        recommendation,
      }),
    });
    const payload = (await response.json()) as {
      recommendation?: Record<string, unknown>;
      error?: string;
    };
    if (!response.ok || !payload.recommendation) {
      throw new Error(payload.error || "AI 대응 제안을 저장하지 못했습니다.");
    }
    return normalizeAiRecommendationRecord(payload.recommendation);
  }

  function toggleAiRecommendationSelection(
    group: "products" | "questions" | "actions",
    value: string,
  ) {
    setAiRecommendationSelection((current) => ({
      ...current,
      [group]: current[group].includes(value)
        ? current[group].filter((item) => item !== value)
        : [...current[group], value],
    }));
  }

  async function applyAiRecommendationSelection() {
    if (!aiRecommendationPanel || aiRecommendationApplying) return;
    const hasSelection =
      aiRecommendationSelection.products.length > 0 ||
      aiRecommendationSelection.questions.length > 0 ||
      aiRecommendationSelection.actions.length > 0 ||
      Boolean(aiRecommendationSelection.followUpDate);
    if (!hasSelection) {
      setToast("반영할 제안이나 후속 일정을 먼저 선택해 주세요.");
      return;
    }
    setAiRecommendationApplying(true);
    try {
      const response = await fetch("/api/ai/recommendations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId: aiRecommendationPanel.activityId,
          ...aiRecommendationSelection,
        }),
      });
      const payload = (await response.json()) as {
        recommendation?: Record<string, unknown>;
        error?: string;
      };
      if (!response.ok || !payload.recommendation) {
        throw new Error(payload.error || "선택한 AI 제안을 반영하지 못했습니다.");
      }
      setAiRecommendationPanel(null);
      setAiRecommendationSelection(emptyAiRecommendationSelection);
      setToast(
        aiRecommendationSelection.products.length > 0
          ? "선택한 제품은 ‘제안 예정’으로 등록했습니다. 실제 제안 활동을 기록하면 ‘제안’으로 바뀝니다."
          : "선택한 AI 대응 제안만 영업 기록에 반영했습니다.",
      );
      await loadRecords();
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "선택한 AI 제안을 반영하지 못했습니다.",
      );
    } finally {
      setAiRecommendationApplying(false);
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
    const institutionDecisions = new Map();
    const recommendationFailedOrganizations: string[] = [];
    const backgroundTasks: Promise<void>[] = [];
    closeAiRecommendationBatch();
    setAiBatchSaving(true);
    try {
      for (const preview of aiPreviews) {
        const { response, payload } =
          await fetchWithInstitutionConfirmation(
            "/api/records",
            {
              method: "POST",
              body: preview as unknown as Record<string, unknown>,
            },
            institutionDecisions,
          );
        if (!response.ok) {
          throw new Error(
            String(
              payload.error ||
                `${preview.organization} 기록을 저장하지 못했습니다.`,
            ),
          );
        }
        const activityId = Number(payload.record?.id);
        const savedActivity =
          Number.isInteger(activityId) && activityId > 0
            ? normalize({
                ...preview,
                ...(payload.record ?? {}),
                id: activityId,
                createdByName: identity.displayName,
              })
            : null;
        if (savedActivity) {
          setRecords((current) => upsertActivity(current, savedActivity));
          setAiRecommendationBatch((current) => [
            ...current.filter(
              (item) => item.activity.id !== savedActivity.id,
            ),
            {
              activity: savedActivity,
              recommendation: null,
              recommendationPending: true,
            },
          ]);
          backgroundTasks.push(
            (async () => {
              try {
                if (
                  !(await saveAiEquipmentPreview({
                    ...preview,
                    organization: savedActivity.organization,
                  }))
                ) {
                  equipmentFailedOrganizations.push(preview.organization);
                }
              } catch {
                equipmentFailedOrganizations.push(preview.organization);
              }
              let recommendation: AiRecommendationRecord | null = null;
              try {
                recommendation = await saveAiRecommendationForRecord(
                  activityId,
                  preview,
                  savedActivity.organization,
                );
              } catch {
                recommendationFailedOrganizations.push(preview.organization);
              }
              setAiRecommendationBatch((current) =>
                current.map((item) =>
                  item.activity.id === savedActivity.id
                    ? {
                        ...item,
                        recommendation,
                        recommendationPending: false,
                      }
                    : item,
                ),
              );
            })(),
          );
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
        `${savedCount}개 기관 기록을 저장했습니다. AI 대응 제안은 준비되는 대로 표시합니다.`,
      );
      void refreshRecordsInBackground();
      void Promise.allSettled(backgroundTasks).then(() => {
        const failedParts = [
          equipmentFailedOrganizations.length
            ? `사업·품목 ${equipmentFailedOrganizations.length}곳`
            : "",
          recommendationFailedOrganizations.length
            ? `AI 대응 제안 ${recommendationFailedOrganizations.length}곳`
            : "",
        ].filter(Boolean);
        setToast(
          failedParts.length
            ? `기록 저장은 완료했습니다. ${failedParts.join(", ")}은 다시 확인해 주세요.`
            : `${savedCount}개 기관의 AI 대응 제안까지 준비했습니다.`,
        );
      });
    } catch (caught) {
      void refreshRecordsInBackground();
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
      const sourceOrganization = formOrganizationSourceRef.current.trim();
      const recordPayload = sourceOrganization
        ? { ...form, sourceOrganization }
        : form;
      const { response, payload } =
        await fetchWithInstitutionConfirmation("/api/records", {
          method: editingId ? "PUT" : "POST",
          body: editingId ? { id: editingId, ...recordPayload } : recordPayload,
        });
      if (!response.ok) {
        throw new Error(String(payload.error || "저장하지 못했습니다."));
      }
      const aiEquipmentPreview = form as AiPreview;
      const activityId = Number(payload.record?.id ?? editingId);
      const savedActivity =
        Number.isInteger(activityId) && activityId > 0
          ? normalize({
              ...form,
              ...(payload.record ?? {}),
              id: activityId,
              createdByName: identity.displayName,
            })
          : null;
      if (savedActivity) {
        setRecords((current) => upsertActivity(current, savedActivity));
      }
      setModalOpen(false);
      setToast(
        editingId
          ? "기록을 수정했습니다."
          : form.sourceChat === "사이트 AI 입력"
            ? "영업 기록을 저장했습니다. AI 대응 제안은 준비되는 대로 표시합니다."
            : "새 기록을 추가했습니다.",
      );
      if (!editingId && form.sourceChat === "사이트 AI 입력") {
        const originalOrganization =
          formOrganizationSourceRef.current.trim();
        const remainingPreviews = aiPreviews.filter(
          (preview) =>
            preview.organization !== form.organization &&
            preview.organization !== originalOrganization,
        );
        setAiPreviews(remainingPreviews);
        if (!remainingPreviews.length) {
          setAiMessages([]);
          setAiDraft("");
          setAiError("");
        }
      }
      void refreshRecordsInBackground();
      if (
        savedActivity &&
        form.sourceChat === "사이트 AI 입력"
      ) {
        void (async () => {
          let equipmentSaved = true;
          try {
            equipmentSaved =
              !Array.isArray(aiEquipmentPreview.equipmentItems) ||
              (await saveAiEquipmentPreview({
                ...aiEquipmentPreview,
                organization: savedActivity.organization,
              }));
          } catch {
            equipmentSaved = false;
          }
          let recommendationSaved = true;
          if (!editingId) {
            try {
              const recommendation = await saveAiRecommendationForRecord(
                savedActivity.id,
                aiEquipmentPreview,
                savedActivity.organization,
              );
              openAiRecommendation(recommendation, savedActivity, true);
            } catch {
              recommendationSaved = false;
            }
          }
          setToast(
            !equipmentSaved
              ? "기록은 저장했습니다. 사업·품목은 기관 상세에서 확인해 주세요."
              : !recommendationSaved
                ? "기록은 저장했습니다. AI 대응 제안은 다시 확인해 주세요."
                : editingId
                  ? "기록과 연결 사업을 수정했습니다."
                  : aiEquipmentPreview.equipmentItems?.length
                    ? "제안·수주 품목과 AI 대응 제안까지 준비했습니다."
                    : "AI 대응 제안까지 준비했습니다.",
          );
        })();
      }
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
      const preset = memberAccessPreset(member);
      setToast(
        preset === "member"
          ? `${member.displayName} 님을 일반 구성원으로 설정했습니다.`
          : preset === "assistant"
            ? `${member.displayName} 님을 보조관리자로 설정했습니다.`
            : `${member.displayName} 님의 권한을 직접 설정했습니다.`,
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

  function openActivityReview() {
    const displayName = session?.member.isSales
      ? session.member.displayName
      : "";
    const initialDrafts: Record<number, ActivityReviewDraft> = {};
    pendingActivityReviewRecords.forEach((record) => {
      initialDrafts[record.id] = {
        ...(record.activityDate ? { activityDate: record.activityDate } : {}),
        ...(!record.progressManager.trim() && displayName
          ? { progressManager: displayName }
          : {}),
      };
    });
    setActivityReviewDrafts(initialDrafts);
    setActivityReviewTransferOpenId(null);
    setActivityReviewTransferTargets({});
    setActivityReviewOpen(true);
    void loadActivityReviews();
    void loadActivityReviewAssignees();
  }

  function updateActivityReviewDraft(
    activityId: number,
    key: ActivityReviewFieldKey,
    value: string,
  ) {
    setActivityReviewDrafts((current) => ({
      ...current,
      [activityId]: {
        ...current[activityId],
        [key]: key === "budgetAmount" ? formatMoneyInput(value) : value,
      },
    }));
  }

  async function transferActivityReview(record: Activity) {
    if (activityReviewSavingIds.includes(record.id)) return;
    const targetMemberId = Number(
      activityReviewTransferTargets[record.id] ?? "",
    );
    const assignee = activityReviewAssignees.find(
      (member) => member.id === targetMemberId,
    );
    if (!assignee) {
      setToast("새 진행 담당자를 선택해 주세요.");
      return;
    }
    if (
      !window.confirm(
        `${record.organization}의 진행 담당자를 ${assignee.displayName}님으로 변경하시겠습니까?`,
      )
    ) {
      return;
    }

    try {
      setActivityReviewSavingIds((current) => [...current, record.id]);
      const response = await fetch("/api/records/assignee", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId: record.id,
          targetMemberId: assignee.id,
        }),
      });
      const payload = (await response.json()) as {
        record?: Record<string, unknown>;
        error?: string;
      };
      if (!response.ok || !payload.record) {
        throw new Error(payload.error || "진행 담당자를 변경하지 못했습니다.");
      }
      const transferredRecord = normalize({
        ...payload.record,
        createdByName: record.createdByName,
        createdAt: record.createdAt,
      });
      setRecords((current) =>
        current.map((item) =>
          item.id === transferredRecord.id ? transferredRecord : item,
        ),
      );
      setActivityReviewDrafts((current) => {
        const next = { ...current };
        delete next[record.id];
        return next;
      });
      setActivityReviewTransferTargets((current) => {
        const next = { ...current };
        delete next[record.id];
        return next;
      });
      setActivityReviewTransferOpenId(null);
      setToast(
        `${record.organization}의 진행 담당자를 ${assignee.displayName}님으로 변경했습니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "진행 담당자를 변경하지 못했습니다.",
      );
    } finally {
      setActivityReviewSavingIds((current) =>
        current.filter((id) => id !== record.id),
      );
    }
  }

  async function saveActivityReviewState(
    record: Activity,
    issueSignature: string,
    snoozedUntil: string | null,
  ) {
    const response = await fetch("/api/record-reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            activityId: record.id,
            issueSignature,
            snoozedUntil,
          },
        ],
      }),
    });
    const payload = (await response.json()) as {
      acknowledgements?: ActivityReviewAcknowledgement[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || "점검 결과를 저장하지 못했습니다.");
    }
    setActivityReviewAcknowledgements(payload.acknowledgements ?? []);
  }

  async function completeActivityReview(record: Activity) {
    if (activityReviewSavingIds.includes(record.id)) return;
    const draft = activityReviewDrafts[record.id] ?? {};
    const nextForm = activityToForm(record);
    let changed = false;

    activityReviewFields(record).forEach((field) => {
      const value = draft[field.key];
      if (value === undefined || !value.trim()) return;
      if (String(nextForm[field.key] ?? "") !== value) {
        nextForm[field.key] = value;
        changed = true;
      }
      if (
        field.key === "activityDate" &&
        nextForm.dateConfidence !== "확정"
      ) {
        nextForm.dateConfidence = "확정";
        changed = true;
      }
    });

    try {
      setActivityReviewSavingIds((current) => [...current, record.id]);
      let reviewedRecord = record;
      if (changed) {
        const response = await fetch("/api/records", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: record.id, ...nextForm }),
        });
        const payload = (await response.json()) as {
          record?: Record<string, unknown>;
          error?: string;
        };
        if (!response.ok || !payload.record) {
          throw new Error(payload.error || "보완한 내용을 저장하지 못했습니다.");
        }
        reviewedRecord = normalize({
          ...payload.record,
          createdByName: record.createdByName,
          createdAt: record.createdAt,
        });
        setRecords((current) =>
          current.map((item) =>
            item.id === reviewedRecord.id ? reviewedRecord : item,
          ),
        );
      }

      await saveActivityReviewState(
        reviewedRecord,
        activityReviewSignature(reviewedRecord),
        null,
      );
      setActivityReviewDrafts((current) => {
        const next = { ...current };
        delete next[record.id];
        return next;
      });
      setToast(
        changed
          ? `${record.organization}의 부족한 정보를 보완하고 점검을 완료했습니다.`
          : `${record.organization} 기록을 현재 정보로 확인 완료했습니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "내 기록 점검을 완료하지 못했습니다.",
      );
    } finally {
      setActivityReviewSavingIds((current) =>
        current.filter((id) => id !== record.id),
      );
    }
  }

  async function snoozeActivityReview(record: Activity) {
    if (activityReviewSavingIds.includes(record.id)) return;
    const tomorrow = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    tomorrow.setDate(tomorrow.getDate() + 1);
    try {
      setActivityReviewSavingIds((current) => [...current, record.id]);
      await saveActivityReviewState(
        record,
        activityReviewSignature(record),
        toLocalDateValue(tomorrow),
      );
      setToast(`${record.organization} 기록은 내일 다시 보여드립니다.`);
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "다시 알림을 저장하지 못했습니다.",
      );
    } finally {
      setActivityReviewSavingIds((current) =>
        current.filter((id) => id !== record.id),
      );
    }
  }

  function toggleOrganization(name: string) {
    setSelectedOrganizations((current) =>
      current.includes(name)
        ? current.filter((organization) => organization !== name)
        : [...current, name],
    );
  }

  function selectManagerIssueFilter(filter: ManagerIssueFilter) {
    setManagerIssueFilter(filter);
    setSelectedOrganizations([]);
  }

  async function saveManagerAlerts(
    organizationsToSave: string[],
    remindAfterDays?: 3 | 7,
  ) {
    const selected = organizations.filter(
      (organization) =>
        organizationsToSave.includes(organization.name) &&
        organization.issues.length > 0,
    );
    if (!selected.length || managerAlertsSaving) return;
    const remindDate = remindAfterDays
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate())
      : null;
    if (remindDate && remindAfterDays) {
      remindDate.setDate(remindDate.getDate() + remindAfterDays);
    }
    try {
      setManagerAlertsSaving(true);
      const response = await fetch("/api/manager-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: selected.map((organization) => ({
            organization: organization.name,
            issueSignature: organization.issueSignature,
            snoozedUntil: remindDate ? toLocalDateValue(remindDate) : null,
          })),
        }),
      });
      const payload = (await response.json()) as {
        acknowledgements?: ManagerAlertAcknowledgement[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "관리자 알림을 처리하지 못했습니다.");
      }
      setManagerAlertAcknowledgements(payload.acknowledgements ?? []);
      setSelectedOrganizations([]);
      setToast(
        remindAfterDays
          ? `${selected.length}개 기관 알림을 ${remindAfterDays}일 후 다시 알려드립니다.`
          : `${selected.length}개 기관 알림을 확인 완료했습니다. 기관과 기록은 그대로 유지됩니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "관리자 알림을 처리하지 못했습니다.",
      );
    } finally {
      setManagerAlertsSaving(false);
    }
  }

  async function restoreManagerAlerts(organizationsToRestore: string[]) {
    if (!organizationsToRestore.length || managerAlertsSaving) return;
    try {
      setManagerAlertsSaving(true);
      const response = await fetch("/api/manager-alerts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizations: organizationsToRestore }),
      });
      const payload = (await response.json()) as {
        acknowledgements?: ManagerAlertAcknowledgement[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "처리한 알림을 복구하지 못했습니다.");
      }
      setManagerAlertAcknowledgements(payload.acknowledgements ?? []);
      setSelectedOrganizations([]);
      setToast(
        `${organizationsToRestore.length}개 기관 알림을 점검 목록으로 복구했습니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "처리한 알림을 복구하지 못했습니다.",
      );
    } finally {
      setManagerAlertsSaving(false);
    }
  }

  function exportRecordWorkbook(
    scopeLabel: string,
    scopeRecords: Activity[],
  ) {
    if (scopeRecords.length === 0) {
      setToast("내려받을 기록이 없습니다.");
      return;
    }
    const headers = [
      "활동일",
      "지역",
      "기관명",
      "기관 구분",
      "담당 역할",
      "기관 담당자",
      "기관 전화",
      "기관 메일",
      "예산 종류",
      "예산 금액",
      "활동 유형",
      "컨택 방식",
      "주제",
      "내용",
      "다음 행동",
      "재연락 예정일",
      "상태",
      "수주 결과",
      "수주 업체",
      "사업 방식",
      "컨소 업체",
      "현재 상태",
      "진행 담당자",
      "진행 일정",
      "메모",
    ];
    const rows = scopeRecords.map((record) => [
        record.activityDate,
        record.region,
        record.organization,
        record.category,
        record.contactRole,
        record.contactName,
        record.contactPhone,
        record.contactEmail,
        record.budgetType,
        formatMoneyInput(record.budgetAmount),
        record.activityType,
        displayContactMethod(record),
        record.topic,
        record.summary,
        record.nextAction,
        record.followUpDate,
        record.status,
        record.awardStatus,
        record.awardCompany,
        record.executionType,
        record.consortiumCompany,
        record.awardStage,
        record.progressManager,
        record.progressSchedule.replaceAll("\t", " "),
        record.notes,
      ]);
    downloadRowsXlsx({
      filename: `WHIZZUP_${scopeLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: scopeLabel,
      headers,
      rows,
      widths: [
        13, 13, 24, 12, 16, 14, 16, 24, 16, 14, 13, 12, 22, 42, 34, 14,
        12, 14, 16, 13, 15, 14, 32, 28, 28,
      ],
    });
    setToast(`${scopeRecords.length}건을 엑셀 파일로 만들었습니다.`);
  }

  function exportInstitutionWorkbook() {
    const selectedRecords = followupRows.filter((record) =>
      selectedInstitutionIds.includes(record.id),
    );
    exportRecordWorkbook(
      "기관별관리",
      selectedRecords.length > 0 ? selectedRecords : followupRows,
    );
  }

  function exportAwardWorkbook() {
    const selectedRecords = displayedRecords.filter((record) =>
      selectedAwardIds.includes(record.id),
    );
    exportRecordWorkbook(
      "수주관리",
      selectedRecords.length > 0 ? selectedRecords : displayedRecords,
    );
  }

  const activeAiRecommendationActivity =
    aiRecommendationActivity ??
    (aiRecommendationPanel
      ? records.find(
          (record) => record.id === aiRecommendationPanel.activityId,
        ) ?? null
      : null);
  const aiShareText = aiRecommendationPanel
    ? buildActivityShareText(
        activeAiRecommendationActivity,
        aiRecommendationPanel,
        includeAiSuggestionsInShare,
      )
    : "";
  const aiBatchShareText = buildActivityBatchShareText(
    aiRecommendationBatch,
    includeAiSuggestionsInBatchShare,
  );
  const aiBatchOrganizationTotal = aiBatchOrganizationCount(
    aiRecommendationBatch,
  );
  const aiBatchRecommendationGroups = groupAiRecommendationBatch(
    aiRecommendationBatch,
  );
  const aiBatchReadyOrganizationTotal = aiBatchRecommendationGroups.filter(
    (group) => group.some((item) => item.recommendation),
  ).length;
  const teamPeriodLabel =
    teamPeriodDays === "all" ? "전체 기간" : `최근 ${teamPeriodDays}일`;
  const onlineMemberCount = Object.values(memberPresence).filter(
    (presence) => presence.isOnline,
  ).length;
  const visibleTeamMembers =
    session?.canViewPresence && presenceOnlineOnly
      ? teamMembers.filter((member) => memberPresence[member.id]?.isOnline)
      : teamMembers;

  const title =
    view === "dashboard"
      ? "영업 대시보드"
        : view === "records"
        ? teamPeriodDays === "all"
          ? "팀 업무 현황"
          : `${teamPeriodLabel} 팀 업무`
        : view === "followup"
          ? "기관별 관리"
          : view === "schedules"
            ? "다가오는 진행 일정"
          : view === "organizations"
            ? "관리자 영업 점검"
            : view === "awards"
              ? activeAwardsOnly
                ? "진행 중 수주"
                : "수주 관리"
              : view === "map"
                ? "영업·수주 지도"
              : view === "team"
                ? "구성원 관리"
                : view === "backup"
                  ? "데이터 백업·복구"
                  : "API 등록·관리";

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

  const selectedActivityImportCount = activityImportRows.filter(
    (row) => row.selected && row.errors.length === 0,
  ).length;
  const activityImportErrorCount = activityImportRows.filter(
    (row) => row.errors.length > 0,
  ).length;
  const activityImportDuplicateCount = activityImportRows.filter(
    (row) => row.duplicate,
  ).length;
  const managerIssueCards: {
    id: ManagerIssueFilter;
    label: string;
    value: number;
    help: string;
  }[] = [
    {
      id: "attention",
      label: "오늘 점검 필요",
      value: activeManagerOrganizations.length,
      help: "놓치기 쉬운 기관을 한 번에 확인",
    },
    {
      id: "overdue",
      label: "재연락 지연",
      value: activeManagerOrganizations.filter(
        (organization) => organization.overdue,
      ).length,
      help: "약속한 연락일이 지난 기관",
    },
    {
      id: "stalled",
      label: "14일 이상 정체",
      value: activeManagerOrganizations.filter(
        (organization) => organization.stalled,
      ).length,
      help: "최근 활동이 없는 진행 기관",
    },
    {
      id: "ownerless",
      label: "담당자 미지정",
      value: activeManagerOrganizations.filter(
        (organization) => organization.ownerless,
      ).length,
      help: "진행 담당자가 비어 있는 기관",
    },
    {
      id: "missing",
      label: "정보 보완 필요",
      value: activeManagerOrganizations.filter(
        (organization) => organization.missingInfo,
      ).length,
      help: "다음 행동·날짜·담당자 누락",
    },
  ];
  const teamWorkSummary = {
    activeMembers: teamWorkMetrics.filter((metric) => metric.activityCount > 0)
      .length,
    activityCount: teamPeriodRecords.length,
    overdueCount: teamWorkMetrics.reduce(
      (total, metric) => total + metric.overdueCount,
      0,
    ),
    attentionCount: allTeamAttentionItems.length,
  };
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
          {!presentationMode &&
            (managementNavItems.length > 0 || isOwner) && (
            <div className="admin-nav-group">
              <p>
                운영 도구
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

        {!presentationMode && (
          <>
            <div className="sidebar-note">
              <span className="privacy-dot" />
              <div>
                <strong>승인된 구성원 전용</strong>
                <p>ChatGPT 로그인과 관리자 승인을 모두 확인합니다.</p>
              </div>
            </div>
            <div className="profile-menu" ref={profileMenuRef}>
              <button
                type="button"
                className="profile"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                onClick={() => setProfileMenuOpen((current) => !current)}
              >
                <span className="avatar">
                  {session.member.displayName.slice(0, 1)}
                </span>
                <span className="profile-copy">
                  <strong>{session.member.displayName}</strong>
                  <span>
                    {session.member.role === "admin"
                      ? "대표관리자"
                      : session.member.role === "assistant"
                        ? "보조관리자"
                        : "구성원"}
                  </span>
                </span>
                <span className="profile-chevron" aria-hidden="true">
                  {profileMenuOpen ? "⌃" : "⌄"}
                </span>
              </button>
              {profileMenuOpen && (
                <div className="profile-popover" role="menu">
                  {isOwner && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => updatePresentationMode(true)}
                    >
                      <strong>시연 모드 시작</strong>
                      <span>발표 중 운영 도구와 사용자 정보를 숨깁니다.</span>
                    </button>
                  )}
                  <a href={signOutPath} role="menuitem">
                    로그아웃
                  </a>
                </div>
              )}
            </div>
          </>
        )}
      </aside>

      {mobileNav && <button className="nav-scrim" aria-label="메뉴 닫기" onClick={() => setMobileNav(false)} />}

      <section className="workspace">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="메뉴 열기">
            ☰
          </button>
          {view !== "dashboard" && view !== "map" && (
            <div className="global-search">
              <span>⌕</span>
              <input
                value={view === "organizations" ? managerSearch : search}
                onChange={(event) =>
                  view === "organizations"
                    ? setManagerSearch(event.target.value)
                    : setSearch(event.target.value)
                }
                placeholder={
                  view === "organizations"
                    ? "기관명, 진행 담당자, 점검 사유 검색"
                    : "기관명, 담당자, 주제 검색"
                }
                aria-label="통합 검색"
              />
              <kbd>⌘ K</kbd>
            </div>
          )}
          <div className="top-actions">
            <button className="ai-button" onClick={openAiRecorder}>
              <span>●</span> AI로 기록
            </button>
            <button className="primary-button" onClick={openNew}><span>＋</span> 새 기록</button>
          </div>
        </header>

        <div className={`content ${view === "followup" || view === "map" || view === "backup" || view === "records" || view === "organizations" ? "content-wide" : ""}`}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">TM · MEETING MANAGEMENT</p>
              <h1>{title}</h1>
              <p>
                {view === "team"
                  ? "가입 승인, 역할·권한, 영업 담당자와 실시간 접속 현황을 관리합니다."
                  : view === "backup"
                    ? "전체 업무 데이터를 안전하게 보관하고, 필요할 때 검증 후 복원합니다."
                   : view === "integration"
                     ? "사이트에서 사용할 OpenAI API 키와 모델을 안전하게 등록·교체합니다."
                    : view === "awards"
                      ? activeAwardsOnly
                        ? "완공·검수·교육이 모두 끝나지 않은 수주 건만 모아 확인합니다."
                        : "위즈업 수주와 타업체 수주 결과를 함께 관리합니다."
                      : view === "map"
                        ? "기관 위치와 진행 상태를 확인하고, 방문할 학교를 선택해 영업 동선을 계획합니다."
                      : view === "schedules"
                        ? "기본 30일 일정을 확인하고 필요하면 14일 또는 전체 일정으로 전환합니다."
                      : view === "records"
                          ? `${teamPeriodLabel} 활동과 현재 후속조치 현황을 함께 확인합니다.`
                        : view === "organizations"
                          ? "재연락 지연, 장기 정체와 정보 누락 기관을 우선순위대로 점검합니다."
                    : "승인된 구성원이 통화·미팅 이력을 한곳에서 함께 관리합니다."}
              </p>
            </div>
            <div className="heading-meta">
              <span className="live-dot" />
              데이터 연결됨
            </div>
          </div>

          {loading && (
            <div className="data-loading-banner" role="status">
              <span className="access-spinner" />
              <div>
                <strong>화면은 먼저 준비했습니다.</strong>
                <span>최신 영업 기록을 불러오는 중입니다.</span>
              </div>
            </div>
          )}

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
                                formOrganizationSourceRef.current =
                                  aiPreview.organization;
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

              <section
                className={`my-record-review-card ${
                  pendingActivityReviewRecords.length
                    ? "needs-review"
                    : "is-complete"
                }`}
                aria-labelledby="my-record-review-title"
              >
                <div className="my-record-review-copy">
                  <span className="record-review-mark" aria-hidden="true">
                    ✓
                  </span>
                  <div>
                    <span className="section-kicker">MY RECORD CHECK</span>
                    <h2 id="my-record-review-title">내 기록 점검</h2>
                    <p>
                      {pendingActivityReviewRecords.length
                        ? "내가 진행 담당자인 기록에서 비어 있거나 확인이 필요한 항목만 보완합니다."
                        : "내가 진행 담당자인 최근 기록에서 확인이 필요한 항목이 없습니다."}
                    </p>
                  </div>
                </div>
                <div className="my-record-review-summary">
                  <span>
                    오늘 입력 <b>{todayActivityReviewRecords.length}</b>건
                  </span>
                  <span>
                    보완 필요 <b>{pendingActivityReviewRecords.length}</b>건
                  </span>
                  <span>
                    오늘 확인 완료{" "}
                    <b>{completedTodayActivityReviewCount}</b>건
                  </span>
                </div>
                <button
                  type="button"
                  onClick={openActivityReview}
                  disabled={
                    activityReviewsLoading ||
                    pendingActivityReviewRecords.length === 0
                  }
                >
                  {activityReviewsLoading
                    ? "점검 상태 확인 중…"
                    : pendingActivityReviewRecords.length
                      ? "기록 점검하기"
                      : "점검 완료"}
                </button>
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
                  aria-label={`향후 14일 진행 일정 ${dashboardUpcomingProgressScheduleCount}건 목록 보기`}
                >
                  <div className="metric-top"><span>다가오는 진행 일정</span><i>02</i></div>
                  <strong>{loading ? "—" : dashboardUpcomingProgressScheduleCount}</strong>
                  <p>향후 14일 · <b>{dashboardUpcomingProgressSchedules.length}</b>개 기관</p>
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
                  <p>완공·검수·교육 완료 전 기관</p>
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

          {mapVisited && (
            <div hidden={view !== "map"}>
              <SalesMapPage
                active={view === "map"}
                records={records}
                isOwner={isOwner}
                canManageCampaigns={canManageMap}
                canEditLocations={sessionStatus === "approved"}
                search={search}
                onSearchChange={setSearch}
                onOpenOrganization={setDetailOrganization}
                onRecordsChanged={loadRecords}
              />
            </div>
          )}

          {view === "map" ? null : view === "schedules" ? (
            <section className="panel schedule-panel schedule-list-page">
              <div className="panel-header">
                <div>
                  <span className="section-kicker">UPCOMING SCHEDULE</span>
                  <h2>다가오는 진행 일정</h2>
                  <p className="schedule-range-note">
                    오늘을 포함해 선택한 기간의 일정만 표시합니다.
                  </p>
                </div>
                <div className="schedule-header-controls">
                  <div className="team-period-switch" aria-label="진행 일정 표시 기간">
                    <button
                      type="button"
                      className={scheduleRange === 14 ? "active" : ""}
                      onClick={() => setScheduleRange(14)}
                    >
                      14일
                    </button>
                    <button
                      type="button"
                      className={scheduleRange === 30 ? "active" : ""}
                      onClick={() => setScheduleRange(30)}
                    >
                      30일
                    </button>
                    <button
                      type="button"
                      className={scheduleRange === "all" ? "active" : ""}
                      onClick={() => setScheduleRange("all")}
                    >
                      전체
                    </button>
                  </div>
                  <span className="record-count">
                    {upcomingProgressSchedules.length}개 기관 ·{" "}
                    {upcomingProgressScheduleCount}개 일정
                  </span>
                </div>
              </div>
              <div className="schedule-list">
                <div className="schedule-head" aria-hidden="true">
                  <span>학교·기관</span>
                  <span>
                    {scheduleRange === "all"
                      ? "오늘 이후 전체 일정"
                      : `오늘부터 ${scheduleRange}일 이내`}
                  </span>
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
                    선택한 기간에 예정된 진행 일정이 없습니다.
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
                  <div><b>02</b><strong>ChatGPT 로그인</strong><p>동료가 자기 ChatGPT 계정으로 처음 접속합니다.</p></div>
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
                    <h2>승인·권한 관리</h2>
                  </div>
                  <button
                    onClick={() =>
                      void Promise.all([
                        loadTeam(),
                        loadActivityReviewAssignees(),
                        loadPresence(),
                      ])
                    }
                  >
                    새로고침
                  </button>
                </div>
                {session.canViewPresence && (
                  <div className="member-presence-overview">
                    <div>
                      <span className="presence-live-dot" aria-hidden="true" />
                      <div>
                        <strong>현재 접속 중 {onlineMemberCount}명</strong>
                        <small>
                          15초마다 갱신 · 35초 동안 신호가 없으면 접속 종료
                          {presenceUpdatedAt
                            ? ` · ${presenceTimeLabel(presenceUpdatedAt, presenceUpdatedAt)}`
                            : ""}
                        </small>
                      </div>
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={presenceOnlineOnly}
                        onChange={(event) => setPresenceOnlineOnly(event.target.checked)}
                      />
                      접속 중만 보기
                    </label>
                  </div>
                )}
                <div className="member-default-access">
                  <div>
                    <strong>일반 구성원 기본 기능</strong>
                    <span>승인만 되면 아래 기능을 함께 사용합니다.</span>
                  </div>
                  <div className="member-default-access-list">
                    <span>AI·수동 기록 등록</span>
                    <span>기관·수주·사업 보기</span>
                    <span>지도 위치 수정</span>
                    <span>미등록 위치 확인</span>
                    <span>영업 엑셀 가져오기</span>
                    <span>내 주변 설치학교</span>
                    <span>영업 담당자는 별도 등록</span>
                  </div>
                  <p>
                    사이트 이용 승인과 영업 담당자 등록은 별개입니다. 회계·지원
                    직원은 사이트만 이용하게 두고, 실제 영업 직원만 각 계정의
                    ‘영업 담당자’ 항목을 켜주세요.
                  </p>
                </div>
                {teamLoading ? (
                  <div className="loading-state"><i /><span>구성원을 확인하는 중입니다</span></div>
                ) : (
                  <div className="member-list">
                    {visibleTeamMembers.map((member) => (
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
                          {session.canViewPresence && member.status === "approved" && (
                            <span
                              className={`member-presence-badge ${
                                memberPresence[member.id]?.isOnline ? "online" : "offline"
                              }`}
                            >
                              <i aria-hidden="true" />
                              {memberPresence[member.id]?.isOnline
                                ? "접속 중"
                                : presenceTimeLabel(
                                    memberPresence[member.id]?.lastSeenAt || member.lastSeenAt,
                                    presenceUpdatedAt,
                                  )}
                            </span>
                          )}
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
                              : memberAccessPreset(member) === "assistant"
                                ? "보조관리자"
                                : memberAccessPreset(member) === "custom"
                                  ? "직접 설정"
                                  : "구성원"}
                          </small>
                          <small
                            className={`member-sales-state ${
                              member.isSales ? "active" : ""
                            }`}
                          >
                            {member.isSales ? "영업 담당자" : "사이트 이용만"}
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
                              {isOwner && (
                                <button
                                  className="delete-member"
                                  onClick={() => void deleteMember(member, true)}
                                >
                                  거절·삭제
                                </button>
                              )}
                            </>
                          ) : member.status === "approved" ? (
                            <button
                              className="suspend"
                              onClick={() => void updateMember(member, "suspended")}
                            >
                              사용 중지
                            </button>
                          ) : (
                            <>
                              <button
                                className="approve"
                                onClick={() => void updateMember(member, "approved")}
                              >
                                다시 승인
                              </button>
                              {isOwner && (
                                <button
                                  className="delete-member"
                                  onClick={() => void deleteMember(member)}
                                >
                                  영구 삭제
                                </button>
                              )}
                            </>
                          )}
                        </div>
                        {isOwner && (
                          <div
                            className={`member-sales-editor ${
                              member.isSales ? "active" : ""
                            }`}
                          >
                            <div>
                              <strong>영업 담당자 등록</strong>
                              <span>
                                켜진 승인 계정만 영업 현황·담당자 선택 목록에
                                표시됩니다.
                              </span>
                            </div>
                            <label>
                              <input
                                type="checkbox"
                                checked={member.isSales}
                                onChange={(event) =>
                                  void updateMemberSalesStatus(
                                    member,
                                    event.target.checked,
                                  )
                                }
                              />
                              <span>
                                {member.isSales
                                  ? member.status === "approved"
                                    ? "영업 목록에 노출 중"
                                    : "승인 시 영업 목록 노출"
                                  : "사이트 이용만"}
                              </span>
                            </label>
                          </div>
                        )}
                        {isOwner && member.role !== "admin" && (
                          <div className="member-access-editor">
                            <label className="member-role-select">
                              <span>역할</span>
                              <select
                                aria-label={`${member.displayName} 역할`}
                                value={memberAccessPreset(member)}
                                onChange={(event) => {
                                  const preset = event.target
                                    .value as MemberAccessPreset;
                                  setTeamMembers((current) =>
                                    current.map((item) =>
                                      item.id === member.id
                                        ? {
                                            ...item,
                                            role:
                                              preset === "member"
                                                ? "member"
                                                : "assistant",
                                            permissions:
                                              preset === "member"
                                                ? []
                                                : preset === "assistant"
                                                  ? [
                                                      ...assistantRecommendedPermissions,
                                                    ]
                                                  : item.role === "member"
                                                    ? []
                                                    : item.permissions,
                                          }
                                        : item,
                                    ),
                                  );
                                }}
                              >
                                <option value="member">일반 구성원</option>
                                <option value="assistant">보조관리자</option>
                                <option value="custom">직접 설정</option>
                              </select>
                            </label>
                            <p className="member-base-access-note">
                              일반 구성원은 기록 추가·수정, 기관·수주·사업 보기,
                              기록 삭제, 지도 확인·위치 수정, 엑셀 내보내기 등
                              공동 업무를 기본으로 이용합니다.
                            </p>
                            {memberAccessPreset(member) === "custom" ? (
                              <div className="member-permission-groups">
                                {[
                                  {
                                    id: "operations" as const,
                                    title: "운영 도구 접근",
                                    description: "왼쪽 운영 도구 메뉴 표시 기준",
                                  },
                                ].map((group) => (
                                  <section
                                    className="member-permission-group"
                                    key={group.id}
                                  >
                                    <div className="member-permission-heading">
                                      <strong>{group.title}</strong>
                                      <span>{group.description}</span>
                                    </div>
                                    <div className="member-permission-list">
                                      {memberPermissionOptions
                                        .filter((option) => option.group === group.id)
                                        .map((option) => (
                                          <label key={option.id}>
                                            <input
                                              type="checkbox"
                                              checked={member.permissions.includes(
                                                option.id,
                                              )}
                                              onChange={(event) =>
                                                setTeamMembers((current) =>
                                                  current.map((item) =>
                                                    item.id === member.id
                                                      ? {
                                                          ...item,
                                                          permissions:
                                                            event.target.checked
                                                              ? [
                                                                  ...new Set([
                                                                    ...item.permissions,
                                                                    option.id,
                                                                  ]),
                                                                ]
                                                              : item.permissions.filter(
                                                                  (permission) =>
                                                                    permission !==
                                                                    option.id,
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
                                  </section>
                                ))}
                              </div>
                            ) : (
                              <div className="member-permission-summary">
                                <strong>
                                  {memberAccessPreset(member) === "assistant"
                                    ? "보조관리자 추천 권한"
                                    : "일반 구성원 기본 권한"}
                                </strong>
                                <span>
                                  {memberAccessPreset(member) === "assistant"
                                    ? "운영 도구의 네 가지 메뉴를 모두 사용합니다."
                                    : "일상적인 기록·기관·수주·지도 업무를 이용하며 운영 도구 메뉴는 표시되지 않습니다."}
                                </span>
                              </div>
                            )}
                            <p className="owner-only-access-note">
                              선택한 운영 도구 메뉴만 왼쪽 메뉴에 표시됩니다.
                              대표관리자 권한 변경은 대표관리자만 가능합니다.
                            </p>
                            <button
                              type="button"
                              className="save-access"
                              onClick={() => void saveMemberAccess(member)}
                            >
                              역할·접근 권한 저장
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {presenceOnlineOnly && visibleTeamMembers.length === 0 && (
                      <div className="member-presence-empty">
                        현재 접속 중인 구성원이 없습니다.
                      </div>
                    )}
                    {!teamMembers.length && (
                      <div className="empty-state large">
                        아직 접속한 동료가 없습니다.
                      </div>
                    )}
                  </div>
                )}
              </article>
            </section>
          ) : view === "backup" ? (
            <DataBackupPage
              onDataChanged={loadRecords}
              notify={setToast}
            />
          ) : view === "integration" ? (
            <section className="integration-layout">
              <article className="panel openai-settings-card">
                <div className="openai-settings-heading">
                  <div>
                    <span className="section-kicker">OPENAI API</span>
                    <h2>API 등록·관리</h2>
                    <p>
                      회사 계정의 API 키로 교체할 때 이 화면에서 연결을 확인하고
                      안전하게 등록할 수 있습니다.
                    </p>
                  </div>
                  <span
                    className={`openai-connection-status ${
                      openAISettings?.configured ? "connected" : "disconnected"
                    }`}
                  >
                    <i />
                    {openAISettings?.configured ? "현재 연결됨" : "연결 필요"}
                  </span>
                </div>

                <div className="openai-current-settings">
                  <div>
                    <span>사용 중인 설정</span>
                    <strong>
                      {openAISettings?.source === "registered"
                        ? "화면에서 등록한 API 키"
                        : "서버에 설정된 기존 API 키"}
                    </strong>
                    <small>
                      {openAISettings?.configured
                        ? `키 끝 4자리 · ${openAISettings.keyLast4 || "확인 불가"}`
                        : "사용 가능한 API 키가 없습니다."}
                    </small>
                  </div>
                  <div>
                    <span>AI 모델</span>
                    <strong>{openAISettings?.model || openAIModel}</strong>
                    <small>
                      {openAISettings?.updatedAt
                        ? `최근 교체 · ${openAISettings.updatedAt
                            .replace("T", " ")
                            .slice(0, 16)}`
                        : "서버 기본 설정"}
                    </small>
                  </div>
                  <div>
                    <span>서버 기본 키</span>
                    <strong>
                      {openAISettings?.serverFallbackConfigured
                        ? "되돌리기 가능"
                        : "등록되지 않음"}
                    </strong>
                    <small>
                      {openAISettings?.serverFallbackConfigured
                        ? `키 끝 4자리 · ${openAISettings.serverFallbackLast4}`
                        : "서버 환경변수에서 별도 관리합니다."}
                    </small>
                  </div>
                </div>

                <div className="openai-registration-form">
                  <label>
                    <span>새 OpenAI API 키</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={openAIApiKey}
                      onChange={(event) => setOpenAIApiKey(event.target.value)}
                      placeholder="sk-로 시작하는 새 API 키"
                    />
                    <small>
                      저장된 키는 다시 표시하지 않으며 끝 4자리만 확인할 수 있습니다.
                    </small>
                  </label>
                  <label>
                    <span>AI 모델</span>
                    <select
                      value={openAIModel}
                      onChange={(event) => setOpenAIModel(event.target.value)}
                    >
                      {openAIModelOptions.map((model) => (
                        <option value={model} key={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <small>새 키를 저장하면 선택한 모델도 함께 적용됩니다.</small>
                  </label>
                </div>

                <div className="openai-settings-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={openAISettingsBusy}
                    onClick={() => void manageOpenAISettings("test")}
                  >
                    입력한 키 연결 테스트
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={openAISettingsBusy}
                    onClick={() => void manageOpenAISettings("save")}
                  >
                    새 키로 교체
                  </button>
                  <button
                    type="button"
                    className="outline-danger"
                    disabled={
                      openAISettingsBusy ||
                      !openAISettings?.serverFallbackConfigured ||
                      openAISettings.source === "server"
                    }
                    onClick={() => void manageOpenAISettings("revert")}
                  >
                    서버 기존 키로 되돌리기
                  </button>
                </div>
                {openAIConnectionMessage && (
                  <p className="openai-connection-message" role="status">
                    {openAIConnectionMessage}
                  </p>
                )}
                <p className="openai-security-note">
                  API 키 원문은 화면에 다시 노출되지 않고 전체 DB 백업에도
                  포함되지 않습니다. 이 설정과 전체 DB 복원은 대표관리자만
                  사용할 수 있습니다.
                </p>
              </article>

              <article className="panel openai-settings-card kakao-settings-card">
                <div className="openai-settings-heading">
                  <div>
                    <span className="section-kicker">KAKAO MAP API</span>
                    <h2>카카오맵 API 등록·관리</h2>
                    <p>
                      지도 위치 확인에 사용할 카카오 JavaScript 키를 등록하고
                      연결 상태를 확인합니다.
                    </p>
                  </div>
                  <span
                    className={`openai-connection-status ${
                      kakaoSettings?.configured ? "connected" : "disconnected"
                    }`}
                  >
                    <i />
                    {kakaoSettings?.configured ? "현재 연결됨" : "연결 필요"}
                  </span>
                </div>

                <div className="openai-current-settings kakao-current-settings">
                  <div>
                    <span>사용 중인 설정</span>
                    <strong>
                      {kakaoSettings?.source === "registered"
                        ? "화면에서 등록한 카카오 키"
                        : kakaoSettings?.source === "server"
                          ? "서버에 설정된 기존 카카오 키"
                          : "등록되지 않음"}
                    </strong>
                    <small>
                      {kakaoSettings?.configured
                        ? `키 끝 4자리 · ${kakaoSettings.keyLast4 || "확인 불가"}`
                        : "사용 가능한 카카오맵 키가 없습니다."}
                    </small>
                  </div>
                  <div>
                    <span>서버 기본 키</span>
                    <strong>
                      {kakaoSettings?.serverFallbackConfigured
                        ? "되돌리기 가능"
                        : "등록되지 않음"}
                    </strong>
                    <small>
                      {kakaoSettings?.serverFallbackConfigured
                        ? `키 끝 4자리 · ${kakaoSettings.serverFallbackLast4}`
                        : "서버 환경변수에서 별도 관리합니다."}
                    </small>
                  </div>
                </div>

                <div className="openai-registration-form kakao-registration-form">
                  <label>
                    <span>새 카카오 JavaScript 키</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={kakaoJavascriptKey}
                      onChange={(event) =>
                        setKakaoJavascriptKey(event.target.value)
                      }
                      placeholder="Kakao Developers의 JavaScript 키"
                    />
                    <small>
                      저장된 키는 다시 표시하지 않으며 끝 4자리만 확인할 수
                      있습니다.
                    </small>
                  </label>
                </div>

                <div className="openai-settings-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={kakaoSettingsBusy}
                    onClick={() => void manageKakaoSettings("test")}
                  >
                    입력한 키 연결 테스트
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={kakaoSettingsBusy}
                    onClick={() => void manageKakaoSettings("save")}
                  >
                    새 키로 교체
                  </button>
                  <button
                    type="button"
                    className="outline-danger"
                    disabled={
                      kakaoSettingsBusy ||
                      !kakaoSettings?.serverFallbackConfigured ||
                      kakaoSettings.source === "server"
                    }
                    onClick={() => void manageKakaoSettings("revert")}
                  >
                    서버 기존 키로 되돌리기
                  </button>
                </div>
                {kakaoConnectionMessage && (
                  <p className="openai-connection-message" role="status">
                    {kakaoConnectionMessage}
                  </p>
                )}
                <p className="openai-security-note">
                  카카오 키 원문은 화면에 다시 노출되지 않고 전체 DB 백업에도
                  포함되지 않습니다.
                </p>
              </article>

              <article className="panel gpt-instruction-copy-card">
                <div>
                  <span className="section-kicker">AI ORGANIZE GUIDE</span>
                  <h2>GPT 지침 복사</h2>
                  <p>
                    지침 원문은 화면에 펼치지 않습니다. 필요할 때 복사해서
                    확인할 수 있으며, 이 화면에서 실수로 수정되지는 않습니다.
                  </p>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    void copyText(gptInstructions, "GPT 지침을 복사했습니다.")
                  }
                >
                  GPT 지침 복사
                </button>
              </article>
            </section>
          ) : view === "organizations" ? (
            <div className="manager-inspection-page">
              <section className="manager-kpi-grid" aria-label="관리자 영업 점검 요약">
                {managerIssueCards.map((item) => (
                  <button
                    type="button"
                    className={`manager-kpi-card ${
                      managerIssueFilter === item.id ? "active" : ""
                    } ${item.value > 0 ? "has-issue" : ""}`}
                    key={item.id}
                    onClick={() => selectManagerIssueFilter(item.id)}
                  >
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.help}</small>
                  </button>
                ))}
              </section>

              <section className="panel manager-priority-panel">
                <div className="panel-header manager-priority-header">
                  <div>
                    <span className="section-kicker">MANAGER CHECK</span>
                    <h2>우선 점검 기관</h2>
                    <p>
                      {managerAlertsLoading
                        ? "처리한 알림을 확인하고 있습니다."
                        : "확인 완료해도 기관과 영업 기록은 그대로 유지됩니다."}
                    </p>
                  </div>
                  <div className="manager-header-actions">
                    <button
                      type="button"
                      className={managerIssueFilter === "all" ? "active" : ""}
                      onClick={() => selectManagerIssueFilter("all")}
                    >
                      미처리 전체 {activeManagerOrganizations.length}곳
                    </button>
                    <button
                      type="button"
                      className={
                        managerIssueFilter === "processed" ? "active" : ""
                      }
                      onClick={() => selectManagerIssueFilter("processed")}
                    >
                      처리한 알림 {processedManagerOrganizations.length}곳
                    </button>
                    <span className="record-count">{managerOrganizations.length}곳</span>
                  </div>
                </div>
                <div className="manager-toolbar">
                  <div className="inline-search">
                    <span>⌕</span>
                    <input
                      value={managerSearch}
                      onChange={(event) => setManagerSearch(event.target.value)}
                      placeholder="기관명, 진행 담당자, 점검 사유 검색"
                    />
                  </div>
                  {canManageRecords && (
                    <div className="manager-selection-actions">
                      <button
                        type="button"
                        onClick={() => {
                          const visibleNames = managerOrganizations.map(
                            (organization) => organization.name,
                          );
                          const allVisibleSelected =
                            visibleNames.length > 0 &&
                            visibleNames.every((name) =>
                              selectedOrganizations.includes(name),
                            );
                          setSelectedOrganizations((current) =>
                            allVisibleSelected
                              ? current.filter((name) => !visibleNames.includes(name))
                              : [...new Set([...current, ...visibleNames])],
                          );
                        }}
                      >
                        {managerOrganizations.length > 0 &&
                        managerOrganizations.every((organization) =>
                          selectedOrganizations.includes(organization.name),
                        )
                          ? "표시 기관 선택 해제"
                          : "표시 기관 전체 선택"}
                      </button>
                      <button
                        type="button"
                        className={
                          managerIssueFilter === "processed"
                            ? "manager-alert-restore"
                            : "manager-alert-complete"
                        }
                        disabled={
                          !selectedOrganizations.length || managerAlertsSaving
                        }
                        onClick={() =>
                          managerIssueFilter === "processed"
                            ? void restoreManagerAlerts(selectedOrganizations)
                            : void saveManagerAlerts(selectedOrganizations)
                        }
                      >
                        {managerIssueFilter === "processed"
                          ? "선택 알림 복구"
                          : "선택 알림 확인 완료"}
                        {selectedOrganizations.length > 0
                          ? ` ${selectedOrganizations.length}`
                          : ""}
                      </button>
                      {managerIssueFilter !== "processed" && (
                        <>
                          <button
                            type="button"
                            className="manager-alert-snooze"
                            disabled={
                              !selectedOrganizations.length ||
                              managerAlertsSaving
                            }
                            onClick={() =>
                              void saveManagerAlerts(selectedOrganizations, 3)
                            }
                          >
                            3일 후 다시
                          </button>
                          <button
                            type="button"
                            className="manager-alert-snooze"
                            disabled={
                              !selectedOrganizations.length ||
                              managerAlertsSaving
                            }
                            onClick={() =>
                              void saveManagerAlerts(selectedOrganizations, 7)
                            }
                          >
                            7일 후 다시
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="table-wrap">
                  <table className="manager-inspection-table">
                    <thead>
                      <tr>
                        {canManageRecords && <th>선택</th>}
                        <th>우선순위</th>
                        <th>기관</th>
                        <th>진행 담당자</th>
                        <th>최근 접촉</th>
                        <th>다음 행동</th>
                        <th>현재 상태</th>
                        <th>점검 사유</th>
                        <th><span className="sr-only">상세</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {managerOrganizations.map((organization) => {
                        const record = organization.latest;
                        const processed =
                          managerIssueFilter === "processed";
                        const acknowledgement =
                          managerAlertByOrganization.get(organization.name);
                        const priority = processed
                          ? "processed"
                          : organization.overdue
                            ? "urgent"
                            : "check";
                        return (
                          <tr
                            className="manager-organization-row"
                            key={organization.name}
                            onClick={(event) => {
                              if (
                                (event.target as HTMLElement).closest(
                                  "button, input, label",
                                )
                              ) {
                                return;
                              }
                              setDetailOrganization(organization.name);
                            }}
                          >
                            {canManageRecords && (
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={`${organization.name} 선택`}
                                  checked={selectedOrganizations.includes(
                                    organization.name,
                                  )}
                                  onChange={() => toggleOrganization(organization.name)}
                                />
                              </td>
                            )}
                            <td>
                              <span className={`manager-priority ${priority}`}>
                                {priority === "urgent"
                                  ? "긴급"
                                  : priority === "check"
                                    ? "확인"
                                    : "처리됨"}
                              </span>
                            </td>
                            <td>
                              <strong className="manager-organization-name">
                                {organization.name}
                              </strong>
                              <small>
                                {record.region || record.category || "지역 미등록"}
                                {organization.highOpportunity
                                  ? " · 주요 영업 기회"
                                  : ""}
                              </small>
                            </td>
                            <td>
                              <strong>{record.progressManager || "미지정"}</strong>
                            </td>
                            <td>
                              <strong>{formatDate(record.activityDate)}</strong>
                              <small>
                                {organization.daysSinceActivity === 0
                                  ? "오늘 활동"
                                  : `${organization.daysSinceActivity}일 전`}
                              </small>
                            </td>
                            <td>
                              <strong>{record.nextAction || "다음 행동 미입력"}</strong>
                              <small>
                                {record.followUpRequired
                                  ? record.followUpDate
                                    ? `재연락 ${formatDate(record.followUpDate)}`
                                    : "재연락 날짜 미지정"
                                  : "재연락 완료"}
                              </small>
                            </td>
                            <td>
                              <span className={`status-pill ${statusClass(record.status)}`}>
                                {record.status}
                              </span>
                              <small>{record.awardStatus}</small>
                            </td>
                            <td>
                              <div className="manager-issue-list">
                                {processed && (
                                  <span className="processed">
                                    {acknowledgement?.snoozedUntil
                                      ? `${formatDate(acknowledgement.snoozedUntil)} 다시 알림`
                                      : "알림 확인 완료"}
                                  </span>
                                )}
                                {organization.issues.length > 0 ? (
                                  organization.issues.slice(0, 3).map((issue) => (
                                    <span key={issue}>{issue}</span>
                                  ))
                                ) : (
                                  <span className="clear">현재 누락 없음</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <div className="manager-row-actions">
                                {canManageRecords &&
                                  (processed ? (
                                    <button
                                      type="button"
                                      className="manager-alert-restore"
                                      disabled={managerAlertsSaving}
                                      onClick={() =>
                                        void restoreManagerAlerts([
                                          organization.name,
                                        ])
                                      }
                                    >
                                      알림 복구
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        className="manager-alert-complete"
                                        disabled={managerAlertsSaving}
                                        onClick={() =>
                                          void saveManagerAlerts([
                                            organization.name,
                                          ])
                                        }
                                      >
                                        확인 완료
                                      </button>
                                      <button
                                        type="button"
                                        className="manager-alert-snooze"
                                        disabled={managerAlertsSaving}
                                        onClick={() =>
                                          void saveManagerAlerts(
                                            [organization.name],
                                            3,
                                          )
                                        }
                                      >
                                        3일 후
                                      </button>
                                      <button
                                        type="button"
                                        className="manager-alert-snooze"
                                        disabled={managerAlertsSaving}
                                        onClick={() =>
                                          void saveManagerAlerts(
                                            [organization.name],
                                            7,
                                          )
                                        }
                                      >
                                        7일 후
                                      </button>
                                    </>
                                  ))}
                                <button
                                  type="button"
                                  className="manager-detail-button"
                                  onClick={() =>
                                    setDetailOrganization(organization.name)
                                  }
                                >
                                  상세
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!loading && managerOrganizations.length === 0 && (
                    <div className="empty-state large">
                      현재 조건에 해당하는 점검 기관이 없습니다.
                    </div>
                  )}
                </div>
              </section>
            </div>
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
                <div className="records-heading-actions">
                  {canExportData && (
                    <button
                      type="button"
                      className="excel-export-button"
                      onClick={exportInstitutionWorkbook}
                    >
                      {selectedInstitutionIds.length > 0
                        ? `선택 ${selectedInstitutionIds.length}건 엑셀`
                        : "엑셀 내보내기"}
                    </button>
                  )}
                  <span className="record-count">{followupRows.length}곳</span>
                </div>
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
                      <th className="selection-cell">
                        <input
                          className="row-select-checkbox"
                          type="checkbox"
                          aria-label="현재 기관 목록 전체 선택"
                          checked={
                            followupRows.length > 0 &&
                            followupRows.every((record) =>
                              selectedInstitutionIds.includes(record.id),
                            )
                          }
                          onChange={() =>
                            setSelectedInstitutionIds((current) => {
                              const allSelected = followupRows.every((record) =>
                                current.includes(record.id),
                              );
                              const visibleIds = new Set(
                                followupRows.map((record) => record.id),
                              );
                              return allSelected
                                ? current.filter((id) => !visibleIds.has(id))
                                : [
                                    ...new Set([
                                      ...current,
                                      ...followupRows.map(
                                        (record) => record.id,
                                      ),
                                    ]),
                                  ];
                            })
                          }
                        />
                      </th>
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
                        key={record.id}
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
                        <td className="selection-cell">
                          <input
                            className="row-select-checkbox"
                            type="checkbox"
                            aria-label={`${record.organization} 선택`}
                            checked={selectedInstitutionIds.includes(record.id)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() =>
                              setSelectedInstitutionIds((current) =>
                                current.includes(record.id)
                                  ? current.filter((id) => id !== record.id)
                                  : [...current, record.id],
                              )
                            }
                          />
                        </td>
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
                            {[record.contactRole, record.contactPhone]
                              .filter(Boolean)
                              .join(" · ") || "전화 미등록"}
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
            <>
              {view === "records" && (
                <div className="team-work-page">
                  <section className="team-work-kpi-grid" aria-label="팀 업무 요약">
                    <button
                      type="button"
                      className={`team-work-kpi-card ${
                        teamMetricFocus === "active" ? "active" : ""
                      }`}
                      onClick={() => {
                        setTeamMetricFocus("active");
                        setSelectedTeamMember("전체");
                        setTeamDetailMode("activity");
                        document
                          .getElementById("team-work-panel")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <span>활동 직원</span>
                      <strong>{teamWorkSummary.activeMembers}</strong>
                      <small>{teamPeriodLabel} 기록이 있는 직원</small>
                    </button>
                    <button
                      type="button"
                      className="team-work-kpi-card"
                      onClick={() => {
                        setTeamMetricFocus("all");
                        setSelectedTeamMember("전체");
                        setTeamDetailMode("activity");
                        document
                          .getElementById("team-detail-panel")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <span>팀 활동 기록</span>
                      <strong>{teamWorkSummary.activityCount}</strong>
                      <small>{teamPeriodLabel} 입력된 전체 기록</small>
                    </button>
                    <button
                      type="button"
                      className={`team-work-kpi-card ${
                        teamWorkSummary.overdueCount ? "alert" : ""
                      }`}
                      onClick={() => {
                        selectManagerIssueFilter("overdue");
                        navigateTo("organizations");
                      }}
                    >
                      <span>재연락 지연</span>
                      <strong>{teamWorkSummary.overdueCount}</strong>
                      <small>현재 담당 기관 중 연락일이 지난 건</small>
                    </button>
                    <button
                      type="button"
                      className={`team-work-kpi-card ${
                        teamWorkSummary.attentionCount ? "alert" : ""
                      } ${
                        teamMetricFocus === "attention" ? "active" : ""
                      }`}
                      onClick={() => {
                        setTeamMetricFocus("attention");
                        setSelectedTeamMember("전체");
                        setTeamDetailMode("attention");
                        document
                          .getElementById("team-detail-panel")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <span>확인 필요</span>
                      <strong>{teamWorkSummary.attentionCount}</strong>
                      <small>재연락 지연·필수 정보 누락 업무</small>
                    </button>
                  </section>

                  <section
                    className="panel team-work-panel"
                    id="team-work-panel"
                  >
                    <div className="panel-header team-work-header">
                      <div>
                        <span className="section-kicker">TEAM WORK CHECK</span>
                        <h2>직원별 업무 점검</h2>
                        <p>
                          입력된 활동과 후속조치를 기준으로 업무량과 놓친 일을
                          확인합니다.
                        </p>
                      </div>
                      <div className="team-work-controls">
                        <button
                          type="button"
                          className={
                            selectedTeamMember === "전체" &&
                            teamMetricFocus === "all"
                              ? "active"
                              : ""
                          }
                          onClick={() => {
                            setSelectedTeamMember("전체");
                            setTeamMetricFocus("all");
                            setTeamDetailMode("activity");
                          }}
                        >
                          전체 직원
                        </button>
                        <div className="team-period-switch">
                          <button
                            type="button"
                            className={teamPeriodDays === 7 ? "active" : ""}
                            onClick={() => {
                              setTeamPeriodDays(7);
                              setRecordDateScope("all");
                            }}
                          >
                            7일
                          </button>
                          <button
                            type="button"
                            className={teamPeriodDays === 30 ? "active" : ""}
                            onClick={() => {
                              setTeamPeriodDays(30);
                              setRecordDateScope("all");
                            }}
                          >
                            30일
                          </button>
                          <button
                            type="button"
                            className={teamPeriodDays === "all" ? "active" : ""}
                            onClick={() => {
                              setTeamPeriodDays("all");
                              setRecordDateScope("all");
                            }}
                          >
                            전체
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="table-wrap">
                      <table className="team-work-table">
                        <thead>
                          <tr>
                            <th>직원</th>
                            <th>기간 활동</th>
                            <th>접촉 기관</th>
                            <th>후속 관리율</th>
                            <th>재연락 지연</th>
                            <th>기록 보완</th>
                            <th>수주 전환</th>
                            <th>관리 상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleTeamWorkMetrics.map((metric) => {
                            const attentionCount =
                              teamAttentionCountByManager.get(metric.name) ?? 0;
                            return (
                            <tr
                              className={
                                selectedTeamMember === metric.name ? "selected" : ""
                              }
                              key={metric.name}
                              tabIndex={0}
                              role="button"
                              onClick={() => {
                                setSelectedTeamMember(metric.name);
                                if (attentionCount > 0) {
                                  setTeamMetricFocus("attention");
                                  setTeamDetailMode("attention");
                                } else {
                                  setTeamDetailMode("activity");
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setSelectedTeamMember(metric.name);
                                  if (attentionCount > 0) {
                                    setTeamMetricFocus("attention");
                                    setTeamDetailMode("attention");
                                  } else {
                                    setTeamDetailMode("activity");
                                  }
                                }
                              }}
                            >
                              <td>
                                <strong className="team-member-name">
                                  {metric.name}
                                </strong>
                                <small>
                                  {metric.lastDate
                                    ? `최근 ${formatDate(metric.lastDate)}`
                                    : "아직 입력한 기록 없음"}
                                </small>
                              </td>
                              <td><strong>{metric.activityCount}건</strong></td>
                              <td><strong>{metric.organizationCount}곳</strong></td>
                              <td>
                                <strong>
                                  {metric.followUpRate === null
                                    ? "—"
                                    : `${metric.followUpRate}%`}
                                </strong>
                                <small>
                                  {metric.followUpCount
                                    ? `관리 대상 ${metric.followUpCount}건`
                                    : "현재 관리 대상 없음"}
                                </small>
                              </td>
                              <td>
                                <strong
                                  className={metric.overdueCount ? "team-alert-text" : ""}
                                >
                                  {metric.overdueCount}건
                                </strong>
                              </td>
                              <td>
                                <strong
                                  className={metric.missingCount ? "team-alert-text" : ""}
                                >
                                  {metric.missingCount}건
                                </strong>
                              </td>
                              <td>
                                <strong>
                                  {metric.conversionRate === null
                                    ? "—"
                                    : `${metric.conversionRate}%`}
                                </strong>
                                <small>
                                  {metric.conversionOrganizationCount
                                    ? `${metric.conversionWonCount} / ${metric.conversionOrganizationCount}곳`
                                    : "진행 기관 없음"}
                                </small>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className={`team-work-status ${
                                    attentionCount ? metric.status : "good"
                                  }`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedTeamMember(metric.name);
                                    if (!attentionCount) {
                                      setTeamDetailMode("activity");
                                      return;
                                    }
                                    setTeamMetricFocus("attention");
                                    setTeamDetailMode("attention");
                                    document
                                      .getElementById("team-detail-panel")
                                      ?.scrollIntoView({
                                        behavior: "smooth",
                                        block: "start",
                                      });
                                  }}
                                  aria-label={
                                    !attentionCount
                                      ? `${metric.name} 활동 기록 보기`
                                      : `${metric.name} 확인 필요 업무 ${attentionCount}건 보기`
                                  }
                                >
                                  {!attentionCount
                                    ? "확인 없음"
                                    : `확인 필요 ${attentionCount}건`}
                                </button>
                              </td>
                            </tr>
                          )})}
                        </tbody>
                      </table>
                      {!loading && visibleTeamWorkMetrics.length === 0 && (
                        <div className="empty-state large">
                          선택한 조건에 해당하는 구성원이 없습니다.
                        </div>
                      )}
                    </div>
                    <p className="team-work-note">
                      이 화면은 시스템에 입력된 기록을 기준으로 합니다. 개인을
                      단순 평가하기보다 지연된 후속조치와 지원이 필요한 업무를
                      확인하는 용도로 사용해 주세요.
                    </p>
                  </section>
                </div>
              )}

              <section
                className={`panel records-panel ${
                  view === "dashboard" ? "dashboard-records" : ""
                }`}
                id={view === "records" ? "team-detail-panel" : undefined}
              >
              <div className="panel-header records-heading">
                <div>
                  <span className="section-kicker">ACTIVITY LOG</span>
                  <h2>
                    {view === "awards"
                      ? activeAwardsOnly
                        ? "진행 중 수주 목록"
                        : "수주 관리 현황"
                      : view === "dashboard"
                        ? "최근 활동 이력"
                        : teamDetailMode === "attention"
                          ? selectedTeamMember !== "전체"
                            ? `${selectedTeamMember} · 확인 필요 업무`
                            : "팀 전체 확인 필요 업무"
                        : selectedTeamMember !== "전체"
                          ? `${selectedTeamMember} · ${teamPeriodLabel} 상세 기록`
                          : `${teamPeriodLabel} 팀 상세 기록`}
                  </h2>
                  {view === "records" && teamDetailMode === "attention" && (
                    <p className="team-detail-mode-copy">
                      선택한 기간 안에서 확인이 필요한 재연락·필수 정보
                      업무입니다.
                    </p>
                  )}
                </div>
                <div className="records-heading-actions">
                  {view === "awards" && canExportData && (
                    <button
                      type="button"
                      className="excel-export-button"
                      onClick={exportAwardWorkbook}
                    >
                      {selectedAwardIds.length > 0
                        ? `선택 ${selectedAwardIds.length}건 엑셀`
                        : "엑셀 내보내기"}
                    </button>
                  )}
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
                  {view === "records" && teamDetailMode === "attention" && (
                    <button
                      type="button"
                      className="team-detail-reset"
                      onClick={() => {
                        setTeamDetailMode("activity");
                        setTeamMetricFocus("all");
                      }}
                    >
                      전체 활동 보기
                    </button>
                  )}
                  <span className="record-count">
                    {view === "dashboard"
                      ? `최신 ${dashboardRecentRecords.length}건`
                      : view === "records" && teamDetailMode === "attention"
                        ? `${teamAttentionItems.length}건`
                        : `${filtered.length}건`}
                  </span>
                </div>
              </div>
              {view !== "dashboard" &&
                !(view === "records" && teamDetailMode === "attention") && (
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
                  {(search || (view !== "awards" && typeFilter !== "전체 유형") || statusFilter !== "전체 상태" || awardFilter !== "전체 수주" || (view === "awards" && (awardSort !== "date-desc" || activeAwardsOnly)) || (view === "records" && (teamPeriodDays !== "all" || selectedTeamMember !== "전체" || teamMetricFocus !== "all" || teamDetailMode !== "activity"))) && (
                    <button className="reset-filter" onClick={() => { setSearch(""); setTypeFilter("전체 유형"); setStatusFilter("전체 상태"); setAwardFilter("전체 수주"); setAwardSort("date-desc"); setRecordDateScope("all"); setTeamPeriodDays("all"); setTeamMetricFocus("all"); setSelectedTeamMember("전체"); setTeamDetailMode("activity"); setActiveAwardsOnly(false); }}>초기화</button>
                  )}
                </div>
              )}

              <div
                className={`table-wrap ${
                  view === "dashboard" ? "dashboard-table-wrap" : ""
                }`}
              >
                <table className={view === "awards" ? "awards-table" : view === "records" ? "records-table" : undefined}>
                  <thead>
                    {view === "awards" ? (
                      <tr>
                        <th className="selection-cell">
                          <input
                            className="row-select-checkbox"
                            type="checkbox"
                            aria-label="현재 수주 목록 전체 선택"
                            checked={
                              displayedRecords.length > 0 &&
                              displayedRecords.every((record) =>
                                selectedAwardIds.includes(record.id),
                              )
                            }
                            onChange={() =>
                              setSelectedAwardIds((current) => {
                                const allSelected = displayedRecords.every(
                                  (record) => current.includes(record.id),
                                );
                                const visibleIds = new Set(
                                  displayedRecords.map((record) => record.id),
                                );
                                return allSelected
                                  ? current.filter((id) => !visibleIds.has(id))
                                  : [
                                      ...new Set([
                                        ...current,
                                        ...displayedRecords.map(
                                          (record) => record.id,
                                        ),
                                      ]),
                                    ];
                              })
                            }
                          />
                        </th>
                        <th>순번</th>
                        <th>날짜</th>
                        <th>기관</th>
                        <th>사업방식</th>
                        <th>수주 업체</th>
                        <th>수주 금액</th>
                        <th>진행 담당자</th>
                        <th>현재 상태</th>
                        <th>진행 내용</th>
                        <th>관리</th>
                      </tr>
                    ) : view === "records" ? (
                      <tr>
                        <th>순번</th><th>날짜</th><th>기관·파트너</th><th>활동</th><th>주제 / 다음 행동</th>
                        {teamDetailMode === "attention" && <th>진행 담당자</th>}
                        <th>상태</th><th>수주</th><th>재연락</th><th><span className="sr-only">관리</span></th>
                      </tr>
                    ) : (
                      <tr><th>날짜</th><th>기관·파트너</th><th>활동</th><th>내용</th><th>진행 담당자</th><th>상태</th><th>수주</th><th>재연락</th><th><span className="sr-only">관리</span></th></tr>
                    )}
                  </thead>
                  <tbody>
                    {(view === "dashboard" ? dashboardRecentRecords : teamDetailRecords).map((record, index) =>
                      view === "awards" ? (
                        <tr
                          className="award-record-row"
                          key={record.id}
                          tabIndex={0}
                          role="button"
                          aria-label={`${record.organization} 상세와 이전 히스토리 보기`}
                          onClick={(event) => {
                            if (
                              (event.target as HTMLElement).closest(
                                "button, a, input, select, textarea",
                              )
                            ) {
                              return;
                            }
                            setDetailOrganization(record.organization);
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.target !== event.currentTarget ||
                              (event.key !== "Enter" && event.key !== " ")
                            ) {
                              return;
                            }
                            event.preventDefault();
                            setDetailOrganization(record.organization);
                          }}
                        >
                          <td className="selection-cell">
                            <input
                              className="row-select-checkbox"
                              type="checkbox"
                              aria-label={`${record.organization} 수주 선택`}
                              checked={selectedAwardIds.includes(record.id)}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() =>
                                setSelectedAwardIds((current) =>
                                  current.includes(record.id)
                                    ? current.filter((id) => id !== record.id)
                                    : [...current, record.id],
                                )
                              }
                            />
                          </td>
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
                          <td>
                            <div className="row-actions award-row-actions">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEdit(record);
                                }}
                                aria-label={`${record.organization} 수주 진행 내용 수정`}
                              >
                                수정
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr
                          key={record.id}
                          className={
                            view === "dashboard"
                              ? "dashboard-activity-row"
                              : view === "records" &&
                                  teamDetailMode === "attention"
                                ? "team-attention-row"
                                : undefined
                          }
                          tabIndex={
                            view === "dashboard" ||
                            (view === "records" &&
                              teamDetailMode === "attention")
                              ? 0
                              : undefined
                          }
                          aria-label={
                            view === "dashboard" ||
                            (view === "records" &&
                              teamDetailMode === "attention")
                              ? `${record.organization} 상세와 이전 이력 보기`
                              : undefined
                          }
                          onClick={
                            view === "dashboard" ||
                            (view === "records" &&
                              teamDetailMode === "attention")
                              ? (event) => {
                                  if (
                                    (event.target as HTMLElement).closest(
                                      "button, a, input, select, textarea",
                                    )
                                  ) {
                                    return;
                                  }
                                  setDetailOrganization(record.organization);
                                }
                              : undefined
                          }
                          onKeyDown={
                            view === "dashboard" ||
                            (view === "records" &&
                              teamDetailMode === "attention")
                              ? (event) => {
                                  if (
                                    event.target !== event.currentTarget ||
                                    (event.key !== "Enter" && event.key !== " ")
                                  ) {
                                    return;
                                  }
                                  event.preventDefault();
                                  setDetailOrganization(record.organization);
                                }
                              : undefined
                          }
                        >
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
                                <strong
                                  className={`topic-cell ${
                                    teamDetailMode === "attention"
                                      ? "team-alert-text"
                                      : ""
                                  }`}
                                >
                                  {teamDetailMode === "attention"
                                    ? teamAttentionByRecordId
                                        .get(record.id)
                                        ?.reasons.join(" · ") ||
                                      "확인 필요"
                                    : record.topic || "내용 미입력"}
                                </strong>
                                <small>{record.nextAction || record.summary || "다음 행동 미지정"}</small>
                              </>
                            )}
                          </td>
                          {view === "records" &&
                            teamDetailMode === "attention" && (
                              <td>
                                <button
                                  type="button"
                                  className="team-manager-filter"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedTeamMember(
                                      record.progressManager || "전체",
                                    );
                                    setTeamMetricFocus("attention");
                                    setTeamDetailMode("attention");
                                  }}
                                >
                                  {record.progressManager || "미등록"}
                                </button>
                              </td>
                            )}
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
                          <td><div className="row-actions"><button onClick={() => openEdit(record)}>수정</button>{canDeleteRecords && <button className="delete" onClick={() => void removeRecord(record)}>삭제</button>}</div></td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
                {loading && <div className="loading-state"><i /><span>기록을 불러오는 중입니다</span></div>}
                {!loading &&
                  (view === "dashboard"
                    ? dashboardRecentRecords.length === 0
                    : view === "records" && teamDetailMode === "attention"
                      ? teamAttentionItems.length === 0
                      : filtered.length === 0) && (
                    <div className="empty-state large">
                      {view === "dashboard"
                        ? "아직 등록된 활동 기록이 없습니다."
                        : view === "records" &&
                            teamDetailMode === "attention"
                          ? "현재 확인 필요 업무가 없습니다."
                          : "조건에 맞는 기록이 없습니다."}
                    </div>
                  )}
              </div>
              </section>
            </>
          )}
        </div>
      </section>

      {aiRecommendationBatch.length > 0 && !aiRecommendationPanel && (
        <aside
          className="ai-response-panel ai-batch-response-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="ai-batch-response-title"
        >
          <div className="ai-response-panel-handle" aria-hidden="true" />
          <header className="ai-response-panel-header">
            <div>
              <span className="section-kicker">AI BATCH RESPONSE</span>
              <h2 id="ai-batch-response-title">
                {aiBatchSaving
                  ? `${aiBatchOrganizationTotal}개 기관 저장 완료`
                  : `${aiBatchOrganizationTotal}개 기관 저장 완료!`}
              </h2>
              <p>
                기록과 전체 공유 문구를 먼저 보여드리고, 기관별 AI 추천은
                준비되는 대로 채워집니다.
              </p>
            </div>
            <button
              type="button"
              className="close-button"
              onClick={closeAiRecommendationBatch}
              aria-label="일괄 저장 결과 닫기"
            >
              ×
            </button>
          </header>

          <div className="ai-response-panel-body">
            <section className="ai-share-card ai-batch-share-card">
              <div className="ai-share-card-heading">
                <div>
                  <span>단톡방 전체 공유용</span>
                  <strong>
                    저장된 {aiBatchOrganizationTotal}개 기관을 한 번에
                    정리했어요
                  </strong>
                </div>
                <span className="ai-share-ready">전체 복사 준비</span>
              </div>
              <pre>{aiBatchShareText}</pre>
              <label className="ai-share-suggestion-toggle">
                <input
                  type="checkbox"
                  checked={includeAiSuggestionsInBatchShare}
                  onChange={(event) =>
                    setIncludeAiSuggestionsInBatchShare(event.target.checked)
                  }
                />
                <span>기관별 AI 추천 제품·대응도 전체 공유 문구에 포함</span>
              </label>
              <div className="ai-share-actions">
                <button
                  type="button"
                  className="cancel-button"
                  onClick={() => void shareAiBatchShareText()}
                >
                  바로 공유
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void copyAiBatchShareText(true)}
                >
                  전체 복사 후 닫기
                </button>
              </div>
            </section>

            <section
              className="ai-batch-recommendations"
              aria-labelledby="ai-batch-recommendations-title"
            >
              <div className="ai-batch-recommendations-heading">
                <div>
                  <span>기관별 AI 추천 대응</span>
                  <strong id="ai-batch-recommendations-title">
                    {aiRecommendationBatch.some(
                      (item) => item.recommendationPending,
                    )
                      ? "저장은 끝났습니다. AI 추천을 준비하고 있습니다"
                      : "필요한 기관을 펼쳐서 확인하세요"}
                  </strong>
                </div>
                <b>{aiBatchReadyOrganizationTotal}곳 준비</b>
              </div>

              <div className="ai-batch-recommendation-list">
                {aiBatchRecommendationGroups.map((group) => {
                    const firstItem = group[0];
                    if (!firstItem) return null;
                    const groupId = firstItem.activity.id;
                    const organization = firstItem.activity.organization;
                    const expanded = aiBatchExpandedActivityIds.includes(groupId);
                    const recommendationPending = group.some(
                      (item) => item.recommendationPending,
                    );
                    const readyItem = group.find((item) => item.recommendation);
                    const preview =
                      readyItem?.recommendation?.meetingSummary ||
                      readyItem?.activity.summary ||
                      firstItem.activity.summary ||
                      "AI 추천 대응을 준비했습니다.";
                    return (
                      <article
                        key={batchOrganizationKey(organization)}
                        className={expanded ? "is-expanded" : ""}
                      >
                        <button
                          type="button"
                          className="ai-batch-recommendation-toggle"
                          aria-expanded={expanded}
                          onClick={() => toggleAiBatchRecommendation(groupId)}
                        >
                          <span>
                            <strong>{organization}</strong>
                            <small>
                              {recommendationPending
                                ? "기록 저장 완료 · AI 추천 대응 준비 중"
                                : `${group.length > 1 ? `${group.length}건 기록 · ` : ""}${preview}`}
                            </small>
                          </span>
                          <b>{expanded ? "접기 ↑" : "보기 ↓"}</b>
                        </button>

                        {expanded && (
                          <div className="ai-batch-recommendation-records">
                            {group.map((item, index) => (
                              <div
                                className="ai-batch-recommendation-record"
                                key={item.activity.id}
                              >
                                {group.length > 1 && (
                                  <div className="ai-batch-recommendation-record-heading">
                                    <strong>기록 {index + 1}</strong>
                                    <span>
                                      {formatDate(item.activity.activityDate)}
                                      {item.activity.topic
                                        ? ` · ${item.activity.topic}`
                                        : ""}
                                    </span>
                                  </div>
                                )}
                                <AiBatchRecommendationDetails
                                  item={item}
                                  onOpen={(recommendation, activity) =>
                                    openAiRecommendation(
                                      recommendation,
                                      activity,
                                      false,
                                      true,
                                    )
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
              </div>
            </section>
          </div>

          <footer className="ai-response-panel-footer ai-batch-panel-footer">
            <button
              type="button"
              className="primary-button"
              onClick={closeAiRecommendationBatch}
            >
              확인 완료
            </button>
          </footer>
        </aside>
      )}

      {aiRecommendationPanel && (
        <aside
          className="ai-response-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="ai-response-title"
        >
          <div className="ai-response-panel-handle" aria-hidden="true" />
          <header className="ai-response-panel-header">
            <div>
              <span className="section-kicker">AI RESPONSE GUIDE</span>
              <h2 id="ai-response-title">
                {aiRecommendationJustSaved
                  ? "저장 완료! 공유 문구도 준비했어요"
                  : "공유 문구와 AI 대응 제안"}
              </h2>
              <p>{aiRecommendationPanel.organization}</p>
            </div>
            <button
              type="button"
              className="close-button"
              onClick={() => setAiRecommendationPanel(null)}
              aria-label="AI 대응 제안 닫기"
            >
              ×
            </button>
          </header>

          <div className="ai-response-panel-body">
            <section className="ai-share-card">
              <div className="ai-share-card-heading">
                <div>
                  <span>단톡방 공유용</span>
                  <strong>확인된 기록만 보기 좋게 정리했어요</strong>
                </div>
                <span className="ai-share-ready">복사 준비 완료</span>
              </div>
              <pre>{aiShareText}</pre>
              <label className="ai-share-suggestion-toggle">
                <input
                  type="checkbox"
                  checked={includeAiSuggestionsInShare}
                  onChange={(event) =>
                    setIncludeAiSuggestionsInShare(event.target.checked)
                  }
                />
                <span>AI 추천 제품·대응도 공유 문구에 포함</span>
              </label>
              <div className="ai-share-actions">
                <button
                  type="button"
                  className="cancel-button"
                  onClick={() => void shareAiShareText()}
                >
                  바로 공유
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void copyAiShareText(true)}
                >
                  복사 후 닫기
                </button>
              </div>
            </section>

            <button
              type="button"
              className="ai-response-recommendation-toggle"
              aria-expanded={aiRecommendationExpanded}
              onClick={() =>
                setAiRecommendationExpanded((current) => !current)
              }
            >
              <span>
                <strong>AI 추천 대응도 함께 준비했어요</strong>
                <small>추천 제품·확인 질문·다음 행동을 선택해 반영할 수 있어요.</small>
              </span>
              <b>{aiRecommendationExpanded ? "접기 ↑" : "보기 ↓"}</b>
            </button>

            {aiRecommendationExpanded && (
              <div className="ai-response-recommendation-content">
            <div className="ai-response-safety-note">
              <span>✓</span>
              <p>
                바로 저장되지 않아요. 아래에서 고른 항목만 영업 기록에
                반영됩니다.
              </p>
            </div>

            <section className="ai-response-summary">
              <span>미팅·TM 요약</span>
              <p>
                {aiRecommendationPanel.meetingSummary ||
                  "기존 영업 기록의 요약을 참고해 다음 대응을 준비했습니다."}
              </p>
            </section>

            {aiRecommendationPanel.interests.length > 0 && (
              <section className="ai-response-section">
                <div className="ai-response-section-title">
                  <span>관심사·필요사항</span>
                </div>
                <div className="ai-response-chips">
                  {aiRecommendationPanel.interests.map((interest) => (
                    <span key={interest}>{interest}</span>
                  ))}
                </div>
              </section>
            )}

            <div className="ai-response-select-toolbar">
              <span>
                선택{" "}
                {aiRecommendationSelection.products.length +
                  aiRecommendationSelection.questions.length +
                  aiRecommendationSelection.actions.length}
                개
              </span>
              <button
                type="button"
                onClick={() =>
                  setAiRecommendationSelection((current) => ({
                    ...current,
                    products: aiRecommendationPanel.recommendedProducts.map(
                      (product) => product.name,
                    ),
                    questions: aiRecommendationPanel.followUpQuestions,
                    actions: aiRecommendationPanel.recommendedActions,
                  }))
                }
              >
                추천 전체 선택
              </button>
            </div>

            {aiRecommendationPanel.recommendedProducts.length > 0 && (
              <section className="ai-response-section">
                <div className="ai-response-section-title">
                  <span>추천 제품</span>
                  <small>선택하면 사업·품목 관리에 ‘제안 예정’으로 등록</small>
                </div>
                <div className="ai-response-option-list products">
                  {aiRecommendationPanel.recommendedProducts.map((product) => (
                    <label key={product.name}>
                      <input
                        type="checkbox"
                        checked={aiRecommendationSelection.products.includes(
                          product.name,
                        )}
                        onChange={() =>
                          toggleAiRecommendationSelection(
                            "products",
                            product.name,
                          )
                        }
                      />
                      <span>
                        <strong>{product.name}</strong>
                        <small>{product.reason}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {aiRecommendationPanel.followUpQuestions.length > 0 && (
              <section className="ai-response-section">
                <div className="ai-response-section-title">
                  <span>다음 확인 질문</span>
                </div>
                <div className="ai-response-option-list">
                  {aiRecommendationPanel.followUpQuestions.map((question) => (
                    <label key={question}>
                      <input
                        type="checkbox"
                        checked={aiRecommendationSelection.questions.includes(
                          question,
                        )}
                        onChange={() =>
                          toggleAiRecommendationSelection(
                            "questions",
                            question,
                          )
                        }
                      />
                      <span>{question}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {aiRecommendationPanel.recommendedActions.length > 0 && (
              <section className="ai-response-section">
                <div className="ai-response-section-title">
                  <span>추천 대응 행동</span>
                </div>
                <div className="ai-response-option-list">
                  {aiRecommendationPanel.recommendedActions.map((action) => (
                    <label key={action}>
                      <input
                        type="checkbox"
                        checked={aiRecommendationSelection.actions.includes(
                          action,
                        )}
                        onChange={() =>
                          toggleAiRecommendationSelection("actions", action)
                        }
                      />
                      <span>{action}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            <label className="ai-response-followup-date">
              <span>후속 연락일</span>
              <input
                type="date"
                value={aiRecommendationSelection.followUpDate}
                onChange={(event) =>
                  setAiRecommendationSelection((current) => ({
                    ...current,
                    followUpDate: event.target.value,
                  }))
                }
              />
            </label>
              </div>
            )}
          </div>

          <footer className="ai-response-panel-footer">
            <button
              type="button"
              className="cancel-button"
              onClick={() => setAiRecommendationPanel(null)}
            >
              닫기
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={aiRecommendationExpanded && aiRecommendationApplying}
              onClick={() =>
                aiRecommendationExpanded
                  ? void applyAiRecommendationSelection()
                  : setAiRecommendationExpanded(true)
              }
            >
              {aiRecommendationExpanded
                ? aiRecommendationApplying
                  ? "선택 항목 반영 중…"
                  : "선택 항목만 반영"
                : "AI 추천 대응 보기"}
            </button>
          </footer>
        </aside>
      )}

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
                  <span>{detailLatest.contactRole || "기관 담당자"}</span>
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

              <OrganizationAiRecommendations
                organization={detailOrganization}
                onOpen={(recommendation) => {
                  setDetailOrganization(null);
                  openAiRecommendation(recommendation);
                }}
              />

              <OrganizationEquipmentManager
                organization={detailOrganization}
                latestRecord={detailLatest}
                onToast={setToast}
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
                            {canDeleteRecords && (
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

      {activityReviewOpen && (
        <div
          className="record-review-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-review-title"
        >
          <button
            className="record-review-backdrop"
            aria-label="내 기록 점검 닫기"
            onClick={() => setActivityReviewOpen(false)}
          />
          <aside className="record-review-drawer">
            <header className="record-review-header">
              <div>
                <span className="section-kicker">MY RECORD CHECK</span>
                <h2 id="record-review-title">내 기록 점검</h2>
                <p>
                  최근 7일 동안 내가 진행 담당자인 기록에서 필요한 항목만
                  보여드립니다.
                </p>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setActivityReviewOpen(false)}
                aria-label="닫기"
              >
                ×
              </button>
            </header>
            <div className="record-review-body">
              <div className="record-review-guide">
                <strong>
                  보완 필요 {pendingActivityReviewRecords.length}건
                </strong>
                <span>
                  알고 있는 내용만 입력하고, 아직 모르는 항목은 현재 정보로
                  확인하거나 내일 다시 볼 수 있습니다.
                </span>
              </div>
              {pendingActivityReviewRecords.map((record) => {
                const fields = activityReviewFields(record);
                const draft = activityReviewDrafts[record.id] ?? {};
                const hasChanges = fields.some((field) => {
                  const value = draft[field.key];
                  if (value === undefined || !value.trim()) return false;
                  return (
                    value !== String(record[field.key] ?? "") ||
                    (field.key === "activityDate" &&
                      record.dateConfidence !== "확정")
                  );
                });
                const isSaving = activityReviewSavingIds.includes(record.id);
                return (
                  <article className="record-review-item" key={record.id}>
                    <header>
                      <div>
                        <span>
                          {formatDate(record.activityDate)} ·{" "}
                          {record.activityType}
                        </span>
                        <h3>{record.organization}</h3>
                      </div>
                      <div className="record-review-heading-actions">
                        <em>{fields.length}개 확인 필요</em>
                        <button
                          type="button"
                          disabled={isSaving}
                          aria-expanded={
                            activityReviewTransferOpenId === record.id
                          }
                          onClick={() =>
                            setActivityReviewTransferOpenId((current) =>
                              current === record.id ? null : record.id,
                            )
                          }
                        >
                          진행 담당자 변경
                        </button>
                      </div>
                    </header>
                    {activityReviewTransferOpenId === record.id && (
                      <div className="record-review-assignee-panel">
                        <div>
                          <strong>진행 담당자 변경</strong>
                          <span>
                            변경하면 이 기록은 새 담당자의 점검 목록으로
                            이동하며 변경자와 시간이 이력에 저장됩니다.
                          </span>
                        </div>
                        <select
                          value={
                            activityReviewTransferTargets[record.id] ?? ""
                          }
                          disabled={activityReviewAssigneesLoading || isSaving}
                          onChange={(event) =>
                            setActivityReviewTransferTargets((current) => ({
                              ...current,
                              [record.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">
                            {activityReviewAssigneesLoading
                              ? "담당자 불러오는 중…"
                              : "새 담당자 선택"}
                          </option>
                          {activityReviewAssignees
                            .filter(
                              (member) =>
                                member.displayName !== record.progressManager,
                            )
                            .map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.displayName}
                              </option>
                            ))}
                        </select>
                        <div className="record-review-assignee-actions">
                          <button
                            type="button"
                            className="record-review-assignee-cancel"
                            disabled={isSaving}
                            onClick={() =>
                              setActivityReviewTransferOpenId(null)
                            }
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            className="record-review-assignee-save"
                            disabled={
                              isSaving ||
                              !activityReviewTransferTargets[record.id]
                            }
                            onClick={() =>
                              void transferActivityReview(record)
                            }
                          >
                            {isSaving ? "변경 중…" : "담당자 변경"}
                          </button>
                        </div>
                      </div>
                    )}
                    <p className="record-review-context">
                      {record.summary ||
                        record.topic ||
                        "상담 요약이 없어 내용을 확인해 주세요."}
                    </p>
                    <div className="record-review-fields">
                      {fields.map((field) => {
                        const currentValue = String(record[field.key] ?? "");
                        const value =
                          draft[field.key] !== undefined
                            ? draft[field.key] ?? ""
                            : currentValue;
                        return (
                          <label key={field.key}>
                            <span>
                              <b>{field.label}</b>
                              <small>{field.reason}</small>
                            </span>
                            {field.key === "summary" ||
                            field.key === "nextAction" ? (
                              <textarea
                                rows={2}
                                value={value}
                                placeholder={field.placeholder}
                                onChange={(event) =>
                                  updateActivityReviewDraft(
                                    record.id,
                                    field.key,
                                    event.target.value,
                                  )
                                }
                              />
                            ) : field.key === "progressManager" ? (
                              <select
                                value={value}
                                onChange={(event) =>
                                  updateActivityReviewDraft(
                                    record.id,
                                    field.key,
                                    event.target.value,
                                  )
                                }
                              >
                                <option value="">미지정</option>
                                {value &&
                                  !registeredSalesNames.includes(value) && (
                                    <option value={value}>
                                      {value} (기존값·미등록)
                                    </option>
                                  )}
                                {registeredSalesNames.map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={field.inputType}
                                value={value}
                                placeholder={field.placeholder}
                                onChange={(event) =>
                                  updateActivityReviewDraft(
                                    record.id,
                                    field.key,
                                    event.target.value,
                                  )
                                }
                              />
                            )}
                          </label>
                        );
                      })}
                    </div>
                    <footer>
                      <button
                        type="button"
                        className="record-review-full"
                        disabled={isSaving}
                        onClick={() => {
                          setActivityReviewOpen(false);
                          openEdit(record);
                        }}
                      >
                        전체 기록 보기
                      </button>
                      <button
                        type="button"
                        className="record-review-later"
                        disabled={isSaving}
                        onClick={() => void snoozeActivityReview(record)}
                      >
                        내일 다시 보기
                      </button>
                      <button
                        type="button"
                        className="record-review-complete"
                        disabled={isSaving}
                        onClick={() => void completeActivityReview(record)}
                      >
                        {isSaving
                          ? "저장 중…"
                          : hasChanges
                            ? "보완 저장·점검 완료"
                            : "현재 정보로 확인 완료"}
                      </button>
                    </footer>
                  </article>
                );
              })}
              {!activityReviewsLoading &&
                pendingActivityReviewRecords.length === 0 && (
                  <div className="record-review-empty">
                    <span>✓</span>
                    <strong>점검할 기록이 없습니다</strong>
                    <p>최근 기록의 필요한 정보가 모두 확인되었습니다.</p>
                  </div>
                )}
            </div>
          </aside>
        </div>
      )}

      {modalOpen && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="record-modal-title">
          <button className="modal-backdrop" aria-label="창 닫기" onClick={() => setModalOpen(false)} />
          <form
            className={`record-modal ${recordEntryMode === "excel" ? "record-modal-bulk" : ""}`}
            onSubmit={
              recordEntryMode === "excel"
                ? saveActivityImportBatch
                : saveRecord
            }
          >
            <div className="modal-header">
              <div><span className="section-kicker">ACTIVITY RECORD</span><h2 id="record-modal-title">{editingId ? "영업 기록 수정" : creatingAward ? "수주 등록" : "새 영업 기록"}</h2></div>
              <button type="button" className="close-button" onClick={() => setModalOpen(false)} aria-label="닫기">×</button>
            </div>
            {!editingId && !creatingAward && (
              <div className="record-entry-tabs" role="tablist" aria-label="새 기록 입력 방법">
                <button
                  type="button"
                  role="tab"
                  aria-selected={recordEntryMode === "manual"}
                  className={recordEntryMode === "manual" ? "active" : ""}
                  onClick={() => setRecordEntryMode("manual")}
                >
                  직접 입력
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={recordEntryMode === "excel"}
                  className={recordEntryMode === "excel" ? "active" : ""}
                  onClick={() => setRecordEntryMode("excel")}
                >
                  엑셀 대량 등록
                </button>
              </div>
            )}
            <div className="form-body">
              {recordEntryMode === "excel" ? (
                <div className="activity-import">
                  <section className="activity-import-guide">
                    <div>
                      <span className="section-kicker">BULK ACTIVITY</span>
                      <h3>엑셀로 새 기록 한 번에 등록</h3>
                      <p>
                        제공된 양식에 기록을 작성한 뒤 올려주세요. 저장 전에
                        오류와 중복 가능성을 먼저 확인합니다.
                      </p>
                    </div>
                    <ol>
                      <li><b>1</b><span>양식 다운로드</span></li>
                      <li><b>2</b><span>기록 작성</span></li>
                      <li><b>3</b><span>미리보기 후 저장</span></li>
                    </ol>
                  </section>

                  <section className="activity-import-actions">
                    <button
                      type="button"
                      className="activity-template-download"
                      onClick={downloadActivityTemplate}
                    >
                      <b aria-hidden="true">↓</b>
                      <span>
                        <strong>엑셀 양식 다운로드</strong>
                        <small>작성 안내·선택값이 함께 들어 있습니다.</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="activity-file-select"
                      onClick={() => activityImportInputRef.current?.click()}
                    >
                      <b aria-hidden="true">＋</b>
                      <span>
                        <strong>작성한 파일 업로드</strong>
                        <small>.xlsx 또는 .csv · 최대 500건</small>
                      </span>
                    </button>
                    <input
                      ref={activityImportInputRef}
                      type="file"
                      accept=".xlsx,.csv"
                      hidden
                      onChange={(event) => void handleActivityImportFile(event)}
                    />
                  </section>

                  {activityImportError && (
                    <p className="activity-import-error">{activityImportError}</p>
                  )}

                  {activityImportRows.length > 0 && (
                    <section className="activity-import-preview">
                      <header>
                        <div>
                          <span>업로드 미리보기</span>
                          <strong>{activityImportFileName}</strong>
                        </div>
                        <button
                          type="button"
                          onClick={selectImportableActivityRows}
                        >
                          정상 기록만 다시 선택
                        </button>
                      </header>
                      <div className="activity-import-counts">
                        <span className="ready">
                          저장 선택 <b>{selectedActivityImportCount}</b>건
                        </span>
                        <span className="error">
                          오류 <b>{activityImportErrorCount}</b>건
                        </span>
                        <span className="duplicate">
                          중복 의심 <b>{activityImportDuplicateCount}</b>건
                        </span>
                      </div>
                      <p className="activity-import-note">
                        중복 의심 기록은 기본적으로 제외됩니다. 꼭 필요한
                        기록이면 행의 체크박스를 다시 선택할 수 있습니다.
                      </p>
                      <div className="activity-import-table-wrap">
                        <table className="activity-import-table">
                          <thead>
                            <tr>
                              <th>저장</th>
                              <th>행</th>
                              <th>활동일자</th>
                              <th>기관명</th>
                              <th>활동 유형</th>
                              <th>상담 내용</th>
                              <th>검토 결과</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activityImportRows.map((row) => (
                              <tr
                                key={row.rowNumber}
                                className={
                                  row.errors.length
                                    ? "has-error"
                                    : row.duplicate
                                      ? "has-duplicate"
                                      : ""
                                }
                              >
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={`${row.rowNumber}행 저장 선택`}
                                    checked={row.selected}
                                    disabled={row.errors.length > 0}
                                    onChange={(event) =>
                                      setActivityImportRows((current) =>
                                        current.map((item) =>
                                          item.rowNumber === row.rowNumber
                                            ? {
                                                ...item,
                                                selected: event.target.checked,
                                              }
                                            : item,
                                        ),
                                      )
                                    }
                                  />
                                </td>
                                <td>{row.rowNumber}</td>
                                <td>{row.values.activityDate || "—"}</td>
                                <td><strong>{row.values.organization || "—"}</strong></td>
                                <td>{row.values.activityType || "—"}</td>
                                <td><span>{row.values.summary || "—"}</span></td>
                                <td>
                                  {row.errors.length > 0 ? (
                                    <em>{row.errors.join(" ")}</em>
                                  ) : row.warnings.length > 0 ? (
                                    <small>{row.warnings.join(" ")}</small>
                                  ) : (
                                    <b>정상</b>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </div>
              ) : (
                <>
              <div className="form-section-title"><span>01</span><strong>기본 정보</strong></div>
              <div className="form-grid">
                <label className="span-2"><span>기관·파트너명 *</span><input required value={form.organization} onChange={(event) => updateFormOrganization(event.target.value)} placeholder="예: 창경초등학교" /></label>
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
                <label>
                  <span>진행 상태</span>
                  <select
                    disabled={Boolean(formProgressManagement)}
                    value={formProgressManagement?.status ?? form.status}
                    onChange={(event) =>
                      setForm({ ...form, status: event.target.value })
                    }
                  >
                    {statusOptions.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                  {formProgressManagement && (
                    <small className="automatic-field-note">
                      진행 일정에 따라 자동 설정됩니다.
                    </small>
                  )}
                </label>
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
                    onChange={(event) => {
                      const progressSchedule = event.target.value;
                      const management =
                        automaticProgressManagement(progressSchedule);
                      const awardStatus =
                        management && form.awardStatus !== "타업체 수주"
                          ? "위즈업 수주"
                          : form.awardStatus;
                      setForm({
                        ...form,
                        progressSchedule,
                        status: management?.status ?? form.status,
                        awardStage:
                          management?.awardStage ?? form.awardStage,
                        awardStatus,
                        awardCompany:
                          awardStatus === "위즈업 수주"
                            ? "위즈업"
                            : form.awardCompany,
                      });
                    }}
                    placeholder={"목공 2026-06-17\n시스템 2026-06-19"}
                  />
                  <small className="automatic-field-note">
                    일정 날짜가 지나면 기관 상태와 연결된 품목 상태가 자동으로 바뀝니다.
                  </small>
                </label>
                <label><span>담당 역할</span><input value={form.contactRole} onChange={(event) => setForm({ ...form, contactRole: event.target.value })} placeholder="예: 공사 담당자" /></label>
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
                    disabled={Boolean(formProgressManagement)}
                    value={
                      formProgressManagement?.awardStage ?? form.awardStage
                    }
                    onChange={(event) =>
                      setForm({ ...form, awardStage: event.target.value })
                    }
                  >
                    {awardStageOptions.map((stage) => (
                      <option key={stage}>{stage}</option>
                    ))}
                  </select>
                  {formProgressManagement && (
                    <small className="automatic-field-note">
                      진행 일정에 따라 자동 설정됩니다.
                    </small>
                  )}
                </label>
                <label>
                  <span>진행 담당자</span>
                  <select
                    value={form.progressManager}
                    onChange={(event) =>
                      setForm({ ...form, progressManager: event.target.value })
                    }
                  >
                    <option value="">미지정</option>
                    {form.progressManager &&
                      !registeredSalesNames.includes(form.progressManager) && (
                        <option value={form.progressManager}>
                          {form.progressManager} (기존값·미등록)
                        </option>
                      )}
                    {registeredSalesNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {!registeredSalesNames.length && (
                    <small className="automatic-field-note">
                      구성원 승인 화면에서 영업 담당자를 먼저 등록해 주세요.
                    </small>
                  )}
                </label>
              </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              {recordEntryMode === "excel" && activityImportProgress && (
                <span className="activity-import-progress">
                  {activityImportProgress}
                </span>
              )}
              {recordEntryMode === "manual" && editingId && canDeleteRecords && (
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
                <button
                  className="primary-button save-button"
                  disabled={
                    recordEntryMode === "excel"
                      ? activityImportSaving ||
                        selectedActivityImportCount === 0
                      : saving
                  }
                >
                  {recordEntryMode === "excel"
                    ? activityImportSaving
                      ? "대량 저장 중…"
                      : `${selectedActivityImportCount}건 한 번에 저장`
                    : saving
                      ? "저장 중…"
                      : editingId
                        ? "수정 저장"
                        : creatingAward
                          ? "수주 등록"
                          : "기록 추가"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
