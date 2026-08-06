"use client";

import {
  ChangeEvent,
  Fragment,
  FormEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyAwardCompanyToSelectedRows,
  awardCompanyKey,
  classifyAwardCompany,
  downloadActivityTemplate,
  downloadAwardTemplate,
  downloadRowsXlsx,
  mergeAwardImportRows,
  parseActivityImportFile,
  prepareAwardImportValues,
  type ActivityImportRow,
  type ActivityImportValues,
} from "./activity-xlsx";
import {
  fetchWithInstitutionConfirmation,
  requestOfficialSchoolDecision,
  type OfficialSchoolConfirmation,
} from "./institution-confirmation";
import { resilientFetch } from "./resilient-fetch";
import type {
  AccountingEntry,
  AccountingWorkspaceTab,
} from "./accounting-page";
import BudgetNameManager from "./budget-name-manager";
import BudgetNameSelector, {
  type BudgetAmountMode,
  type BudgetKind,
  type BudgetSelection,
} from "./budget-name-selector";
import JointProjectModal, {
  type JointProjectCandidate,
} from "./joint-project-modal";
import JointProjectSummary from "./joint-project-summary";
import JointProjectMemberList from "./joint-project-member-list";
import {
  filterJointProjectGroupsByMember,
  groupJointProjectRows,
  jointProjectGroupMemberIds,
} from "../lib/joint-project-display";
import { normalizeAiSuggestedStatus } from "../lib/ai-status";
import { resolveRegisteredSalesName } from "../lib/sales-names";
import {
  institutionAliasKey,
  isSameRegionInstitution,
  resolveUniqueExistingInstitutionName,
} from "../lib/institution-names";
import { analyticsBusinessRoundKey } from "../lib/analytics-business-rounds";
import GlobalInstitutionSearch from "./global-institution-search";
import {
  DEFAULT_PROCUREMENT_FEE_RATE,
  hasProcurementSignal,
} from "../lib/procurement-product";
import {
  emptyInstitutionContact,
  normalizeInstitutionContacts,
  primaryInstitutionContact,
  type InstitutionContact,
} from "../lib/institution-contacts";
import {
  inheritInstitutionState,
  mergeInstitutionStateSnapshots,
  resolveInstitutionContactSet,
  type InstitutionContactResolution,
  type InstitutionStateSnapshot,
} from "../lib/institution-state-carryover";
import {
  filterManagerInspectionRows,
  managerInspectionCounts,
  type ManagerInspectionFilter,
} from "../lib/manager-inspection";
import {
  calculateEquipmentFinance,
  equipmentSettlementQuantity,
} from "../lib/equipment-finance";
import { calculateConstructionFinance } from "../lib/construction-finance";
import {
  collapseRepeatedOrganizationRegionPrefix,
  compactRepeatedAiText,
  compactShareSummary,
  replaceOrganizationReferences,
} from "../lib/share-text";
import {
  formatScheduleDate,
  sortScheduleRowsForDashboard,
  sortScheduleRowsByEarliestDate,
} from "../lib/schedule-presentation";
import {
  AWARD_STAGE_OPTIONS,
  COMPLETED_AWARD_STAGE,
  isCompletedAwardStage,
  normalizeActivityType,
  normalizeAwardStage,
  normalizeSalesProgress,
} from "../lib/sales-taxonomy";
import {
  activityBudgetsFromRecord,
  canonicalBusinessRoundBudgets,
  emptyActivityBudget,
  sameActivityBudgets,
  summarizeActivityBudgets,
  type ActivityBudgetAllocation,
} from "../lib/activity-budgets";

const DataBackupPage = lazy(() => import("./data-backup-page"));
const HoldemLounge = lazy(() => import("./holdem-lounge"));
const ProductCatalogPage = lazy(() => import("./product-catalog-page"));
const AwardVendorPage = lazy(() => import("./award-vendor-page"));
const AccountingPage = lazy(() => import("./accounting-page"));
const AnalyticsPage = lazy(() => import("./analytics-page"));
const OwnerPerformancePage = lazy(() => import("./owner-performance-page"));
const InventoryPage = lazy(() => import("./inventory-page"));
const ConstructionSchedulePage = lazy(() => import("./construction-schedule-page"));
const QuotationDocuments = lazy(() => import("./quotation-documents"));
const SalesMapPage = lazy(() => import("./sales-map"));
const HomeCalendar = lazy(() => import("./home-calendar"));

type Activity = {
  id: number;
  activityDate: string;
  dateConfidence: string;
  activityType: string;
  category: string;
  contactMethod: string;
  region: string;
  organization: string;
  businessRound: number;
  jointProjectId?: number | null;
  jointProjectName?: string;
  jointProjectSponsor?: string;
  jointProjectRole?: "sponsor" | "site" | "";
  jointProjectBudgetGroupId?: number | null;
  jointProjectBudgetType?: string;
  jointProjectYear?: number | null;
  jointProjectRound?: number | null;
  jointProjectMemberBudgetAmount?: number | null;
  budgetType: string;
  budgetAmount: string;
  budgetOriginalName?: string;
  budgetGroupId?: number | null;
  budgetMatchStatus?: string;
  budgetMatchMethod?: string;
  budgetRequestId?: string | null;
  budgetKind?: BudgetKind | string;
  budgetAmountMode?: BudgetAmountMode | string;
  budgetInstitutionAmount?: string;
  budgetQuoteAmount?: number | null;
  budgetAmountOverride?: string;
  budgetAmountSource?: string;
  budgets: ActivityBudgetAllocation[];
  topic: string;
  summary: string;
  detailLevel: ActivityDetailLevel;
  detailSummary: string;
  detailKeyFacts: ActivityDetailFact[];
  detailSections: ActivityDetailSection[];
  rawInput: string;
  status: string;
  statusManual: boolean;
  temperature: string;
  awardStatus: string;
  awardCompany: string;
  executionType: string;
  consortiumCompany: string;
  awardStage: string;
  awardCompletedDate: string;
  progressManager: string;
  progressManagerLocked: boolean;
  followUpRequired: boolean;
  followUpDate: string;
  nextAction: string;
  progressSchedule: string;
  contactRole: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  contacts: InstitutionContact[];
  sourceChat: string;
  notes: string;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

type ActivityDetailLevel = "compact" | "standard" | "detailed";
type ActivityDetailFact = {
  label: string;
  value: string;
};
type ActivityDetailSection = {
  title: string;
  items: string[];
};

function isPdfCampaignRegistration(record: Pick<Activity, "sourceChat">) {
  return record.sourceChat === "영업지도 PDF 가져오기";
}

function isCampaignRegistrationSystemRecord(
  record: Pick<Activity, "sourceChat" | "activityType">,
) {
  return (
    record.activityType === "사업 대상 등록" &&
    [
      "예산별 기관 PDF 가져오기",
      "예산별 기관 엑셀 가져오기",
      "예산별 기관 직접 등록",
    ].includes(record.sourceChat)
  );
}

function isAwardManagementSystemRecord(
  record: Pick<Activity, "sourceChat">,
) {
  return (
    record.sourceChat === "수주 관리 엑셀 등록" ||
    record.sourceChat === "수주 관리 직접 등록" ||
    record.sourceChat.startsWith("구글 시트 연동|")
  );
}

function isPartnerRegistrationSystemRecord(
  record: Pick<Activity, "sourceChat" | "activityType">,
) {
  return (
    record.sourceChat === "수주업체 관리" &&
    ["협력사 등록", "협력사 등록 해제"].includes(record.activityType)
  );
}

type FormState = Omit<
  Activity,
  "id" | "createdByName" | "updatedByName" | "createdAt" | "updatedAt"
> & {
  normalizeOfficialSchoolAliases?: boolean;
};

function formWithActivityBudgets<T extends FormState>(
  current: T,
  budgets: ActivityBudgetAllocation[],
): T {
  const normalized = budgets.length ? budgets : [emptyActivityBudget()];
  return { ...current, ...normalized[0], budgets: normalized } as T;
}

function canonicalBudgetsForBusinessRound(
  records: Activity[],
  organization: string,
  businessRound: number,
  region = "",
) {
  const resolvedOrganization = resolveUniqueExistingInstitutionName(
    { organization, region },
    records.map((record) => ({
      organization: record.organization,
      region: record.region,
    })),
  );
  const organizationKey = institutionAliasKey(
    resolvedOrganization || organization,
  );
  const newestFirst = records
    .filter(
      (record) =>
        institutionAliasKey(record.organization) === organizationKey &&
        record.businessRound === businessRound,
    )
    .sort(
      (left, right) =>
        right.activityDate.localeCompare(left.activityDate) ||
        right.id - left.id,
    );
  return canonicalBusinessRoundBudgets(
    newestFirst as unknown as Record<string, unknown>[],
  );
}

function hasActivityDetailDraft(form: FormState) {
  return Boolean(
    form.detailSummary.trim() ||
      form.detailKeyFacts.some((fact) => fact.label.trim() || fact.value.trim()) ||
      form.detailSections.some(
        (section) =>
          section.title.trim() || section.items.some((item) => item.trim()),
      ) ||
      form.rawInput.trim(),
  );
}

function isDerivedBudgetDetailFact(label: string) {
  return /(총예산|예산명|확보예산|사업명)/.test(
    label.replace(/\s+/g, ""),
  );
}

function isDerivedBudgetDetailSection(title: string) {
  return /예산/.test(title.replace(/\s+/g, ""));
}
type ReviewedActivityImportRow = ActivityImportRow & {
  duplicate: boolean;
  selected: boolean;
  budgetOriginalName: string;
  budgetResolvedName: string;
  budgetGroupId: number | null;
  budgetMatchStatus: string;
  budgetMatchMethod: string;
  budgetCandidates: string[];
  budgetKind: BudgetKind;
  budgetAmountMode: BudgetAmountMode;
  existingRecordId?: number;
  syncAction?: "create" | "update" | "unchanged";
  saveState?: "saving" | "failed";
  saveError?: string;
};

type BudgetReviewCatalogOption = {
  id: number;
  canonicalName: string;
  budgetKind: BudgetKind;
  amountMode: BudgetAmountMode;
  aliases: string[];
};

type BudgetCatalogResolution = {
  originalName: string;
  canonicalName: string;
  groupId: number | null;
  budgetKind: BudgetKind;
  amountMode: BudgetAmountMode;
  matchStatus: string;
  matchMethod: string;
  candidates: string[];
};

function budgetNameKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s._·/\\()[\]{}'"`~!@#$%^&*+=:;?,<>|-]+/g, "")
    .trim();
}

function matchesStandardBudgetFilter(
  record: Activity,
  filter: string,
  catalog: BudgetReviewCatalogOption[],
) {
  if (filter === "all") return true;
  const recordBudgets = record.budgets.length
    ? record.budgets
    : activityBudgetsFromRecord(record as unknown as Record<string, unknown>);
  const recordGroupIds = new Set(
    recordBudgets
      .map((budget) => Number(budget.budgetGroupId))
      .filter((id) => Number.isInteger(id) && id > 0),
  );
  const recordKeys = new Set(
    recordBudgets
      .flatMap((budget) => [budget.budgetType, budget.budgetOriginalName])
      .map(budgetNameKey)
      .filter(Boolean),
  );
  const matchesOption = (option: BudgetReviewCatalogOption) =>
    recordGroupIds.has(option.id) ||
    [option.canonicalName, ...option.aliases]
      .map(budgetNameKey)
      .some((key) => key && recordKeys.has(key));
  if (filter === "unclassified") {
    return !catalog.some(matchesOption);
  }
  const selected = catalog.find((option) => option.id === Number(filter));
  return Boolean(selected && matchesOption(selected));
}

function normalizeBudgetKind(value: unknown): BudgetKind {
  const text = String(value ?? "").trim();
  if (text === "self" || text === "자체예산") return "self";
  if (text === "purpose" || text === "목적예산") return "purpose";
  return "";
}

function normalizeBudgetAmountMode(value: unknown): BudgetAmountMode {
  const text = String(value ?? "").trim();
  if (
    text === "quote_auto" ||
    text === "자동 계산" ||
    text === "품목 합계 자동 계산"
  ) {
    return "quote_auto";
  }
  if (text === "manual" || text === "직접 입력" || text === "수기 입력") {
    return "manual";
  }
  return "";
}

function normalizeBudgetCatalogOption(
  value: unknown,
): BudgetReviewCatalogOption | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const id = Number(row.id ?? row.groupId ?? row.group_id);
  const canonicalName = String(
    row.canonicalName ?? row.canonical_name ?? row.name ?? "",
  ).trim();
  const activeValue = row.active ?? row.isActive ?? row.is_active;
  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    !canonicalName ||
    (activeValue !== undefined &&
      (activeValue === false || Number(activeValue) === 0))
  ) {
    return null;
  }
  return {
    id,
    canonicalName,
    budgetKind: normalizeBudgetKind(
      row.budgetKind ?? row.budget_kind ?? row.kind,
    ),
    amountMode: normalizeBudgetAmountMode(
      row.amountMode ?? row.amount_mode ?? row.amountHandling,
    ),
    aliases: (Array.isArray(row.aliases) ? row.aliases : [])
      .map((alias) => {
        if (typeof alias === "string") return alias.trim();
        const aliasRow = (alias ?? {}) as Record<string, unknown>;
        return String(
          aliasRow.aliasName ?? aliasRow.alias_name ?? aliasRow.name ?? "",
        ).trim();
      })
      .filter(Boolean),
  };
}

async function requestBudgetReviewCatalog() {
  const response = await fetch("/api/budget-catalog", { cache: "no-store" });
  const payload = (await response.json()) as {
    catalog?: unknown[];
    groups?: unknown[];
    options?: unknown[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "표준 예산명 목록을 불러오지 못했습니다.");
  }
  const source = payload.catalog ?? payload.groups ?? payload.options ?? [];
  return source
    .map(normalizeBudgetCatalogOption)
    .filter((option): option is BudgetReviewCatalogOption => Boolean(option));
}

function budgetSuggestionScore(
  option: BudgetReviewCatalogOption,
  originalName: string,
) {
  const query = budgetNameKey(originalName);
  if (!query) return 0;
  return [option.canonicalName, ...option.aliases].reduce((best, name) => {
    const candidate = budgetNameKey(name);
    if (candidate === query) return 100;
    if (candidate.includes(query) || query.includes(candidate)) {
      return Math.max(best, 70 - Math.abs(candidate.length - query.length));
    }
    const shared = [...new Set(query)].filter((letter) =>
      candidate.includes(letter),
    ).length;
    return Math.max(
      best,
      Math.round((shared / Math.max(query.length, candidate.length, 1)) * 50),
    );
  }, 0);
}

function resolveBudgetFromCatalog(
  value: unknown,
  catalog: BudgetReviewCatalogOption[],
  excluded = false,
): BudgetCatalogResolution {
  const originalName = String(value ?? "").normalize("NFKC").trim();
  if (excluded) {
    return {
      originalName,
      canonicalName: originalName,
      groupId: null,
      budgetKind: "",
      amountMode: "",
      matchStatus: "excluded",
      matchMethod: "award-excluded",
      candidates: [],
    };
  }
  const originalKey = budgetNameKey(originalName);
  if (!originalKey) {
    return {
      originalName: "",
      canonicalName: "",
      groupId: null,
      budgetKind: "",
      amountMode: "",
      matchStatus: "unclassified",
      matchMethod: "blank",
      candidates: [],
    };
  }
  const exactMatches = catalog
    .map((option) => {
      const canonicalMatch =
        budgetNameKey(option.canonicalName) === originalKey;
      const aliasMatch = option.aliases.some(
        (alias) => budgetNameKey(alias) === originalKey,
      );
      return canonicalMatch || aliasMatch
        ? {
            option,
            method: canonicalMatch ? "canonical" : "alias",
          }
        : null;
    })
    .filter(
      (
        item,
      ): item is {
        option: BudgetReviewCatalogOption;
        method: string;
      } => Boolean(item),
    );
  if (exactMatches.length === 1) {
    const exact = exactMatches[0];
    return {
      originalName,
      canonicalName: exact.option.canonicalName,
      groupId: exact.option.id,
      budgetKind: exact.option.budgetKind,
      amountMode: exact.option.amountMode,
      matchStatus: "auto",
      matchMethod: exact.method,
      candidates: [],
    };
  }
  if (exactMatches.length > 1) {
    return {
      originalName,
      canonicalName: "",
      groupId: null,
      budgetKind: "",
      amountMode: "",
      matchStatus: "review",
      matchMethod: "ambiguous-exact",
      candidates: exactMatches.map((item) => item.option.canonicalName),
    };
  }
  const candidates = catalog
    .map((option) => ({
      option,
      score: budgetSuggestionScore(option, originalName),
    }))
    .filter((item) => item.score >= 42)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.option.canonicalName.localeCompare(
          right.option.canonicalName,
          "ko-KR",
        ),
    )
    .slice(0, 3)
    .map((item) => item.option.canonicalName);
  return {
    originalName,
    canonicalName: "",
    groupId: null,
    budgetKind: "",
    amountMode: "",
    matchStatus: candidates.length ? "review" : "unclassified",
    matchMethod: candidates.length ? "similar-candidate" : "unmatched",
    candidates,
  };
}

function budgetMatchStatusLabel(value: string) {
  switch (value) {
    case "auto":
    case "approved":
      return "표준 연결";
    case "review":
      return "확인 필요";
    case "pending":
      return "승인 대기";
    case "hold":
      return "보류";
    case "rejected":
      return "반려";
    case "excluded":
      return "표준화 제외";
    default:
      return "미분류";
  }
}

function applyBudgetCatalogResolution(
  value: BudgetSelection,
  catalog: BudgetReviewCatalogOption[],
  excluded = false,
): BudgetSelection {
  const resolution = resolveBudgetFromCatalog(
    value.budgetOriginalName || value.budgetType,
    catalog,
    excluded,
  );
  if (
    value.budgetMatchStatus === "pending" ||
    value.budgetMatchStatus === "hold"
  ) {
    return value;
  }
  return {
    ...value,
    budgetType: resolution.canonicalName || resolution.originalName,
    budgetOriginalName: resolution.originalName,
    budgetGroupId: resolution.groupId,
    budgetMatchStatus: resolution.matchStatus,
    budgetMatchMethod: resolution.matchMethod,
    budgetKind: resolution.budgetKind,
    budgetAmountMode: resolution.amountMode,
  };
}

type BulkRecordSaveResult = {
  clientKey: string;
  status: number;
  payload: Record<string, any>;
};

type ActivityChangeBatch = {
  id: string;
  scope: "pre_awards" | "awards";
  scopeLabel: string;
  label: string;
  actionType: string;
  status: string;
  operationTotal: number;
  itemCount: number;
  appliedCount: number;
  changedByName: string;
  createdAt: string;
  undoneAt: string;
  undoable: boolean;
  conflictCount: number;
  sampleOrganizations: string[];
};

const ACTIVITY_IMPORT_BATCH_SIZE = 10;
const AWARD_BULK_BATCH_SIZE = 500;
const AWARD_BULK_MAX_COUNT = 5_000;
const AWARD_LIST_PAGE_SIZE = 50;
const DATA_LIST_PAGE_SIZE = 50;

type BufferedInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> & {
  value: string;
  onCommit: (value: string) => void;
  commitDelay?: number;
};

function BufferedInput({
  value,
  onCommit,
  commitDelay = 220,
  onBlur,
  ...props
}: BufferedInputProps) {
  const [draft, setDraft] = useState(value);
  const onCommitRef = useRef(onCommit);
  const externalValueRef = useRef(value);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    const previousValue = externalValueRef.current;
    externalValueRef.current = value;
    setDraft((current) => (current === previousValue ? value : current));
  }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = window.setTimeout(() => {
      onCommitRef.current(draft);
    }, commitDelay);
    return () => window.clearTimeout(timer);
  }, [commitDelay, draft, value]);

  return (
    <input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        if (draft !== value) onCommitRef.current(draft);
        onBlur?.(event);
      }}
    />
  );
}

type BufferedTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> & {
  value: string;
  onCommit: (value: string) => void;
  commitDelay?: number;
};

function BufferedTextarea({
  value,
  onCommit,
  commitDelay = 220,
  onBlur,
  ...props
}: BufferedTextareaProps) {
  const [draft, setDraft] = useState(value);
  const onCommitRef = useRef(onCommit);
  const externalValueRef = useRef(value);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    const previousValue = externalValueRef.current;
    externalValueRef.current = value;
    setDraft((current) => (current === previousValue ? value : current));
  }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = window.setTimeout(() => {
      onCommitRef.current(draft);
    }, commitDelay);
    return () => window.clearTimeout(timer);
  }, [commitDelay, draft, value]);

  return (
    <textarea
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        if (draft !== value) onCommitRef.current(draft);
        onBlur?.(event);
      }}
    />
  );
}

function DeferredPageFallback() {
  return (
    <div className="data-loading-banner" role="status">
      <span className="access-spinner" />
      <div>
        <strong>화면을 준비하고 있습니다.</strong>
        <span>필요한 기능만 불러오는 중입니다.</span>
      </div>
    </div>
  );
}

function DataListPagination({
  page,
  pageCount,
  total,
  label,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  label: string;
  onPageChange: (page: number) => void;
}) {
  if (!total) return null;
  return (
    <nav className="award-list-pagination data-list-pagination" aria-label={label}>
      <button type="button" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
        이전
      </button>
      <span>
        {page.toLocaleString()} / {pageCount.toLocaleString()} 페이지
        <small>총 {total.toLocaleString()}건 · 페이지당 {DATA_LIST_PAGE_SIZE}건</small>
      </span>
      <button
        type="button"
        disabled={page === pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        다음
      </button>
    </nav>
  );
}

function waitForBulkRetry(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function saveRecordBulkWithRetry(
  items: Array<{
    clientKey: string;
    method: "POST" | "PUT";
    body: Record<string, unknown>;
  }>,
) {
  let lastError = "대량 저장 요청을 완료하지 못했습니다.";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch("/api/records/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const payload = (await response.json()) as {
        error?: string;
        results?: BulkRecordSaveResult[];
      };
      if (response.ok && Array.isArray(payload.results)) {
        return payload.results;
      }
      lastError = payload.error || lastError;
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
        break;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
    if (attempt < 3) await waitForBulkRetry(attempt * 800);
  }
  throw new Error(lastError);
}
type GoogleSheetAnalysis = {
  sheetTitle: string;
  spreadsheetId: string;
  gid: string;
  stats: {
    headerRow: number;
    sourceRowCount: number;
    institutionCount: number;
    duplicateRowCount: number;
    missingDateCount: number;
    invalidDateCount: number;
    missingRegionCount: number;
    missingOrganizationCount: number;
    inheritedOrganizationCount: number;
  };
};
type PartnerCompanyDraft = {
  organization: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  notes: string;
};
type PartnerCompany = PartnerCompanyDraft & {
  id: number;
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
type EquipmentPriceStatus =
  | "금액 미입력"
  | "입력 완료"
  | "무상 제공"
  | "계약금액에 포함"
  | "서비스 품목";
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
type AiPreview = FormState & {
  equipmentProjectName: string;
  equipmentProjectStatus: string;
  equipmentItems: EquipmentItemDraft[];
  recommendation: AiRecommendationDraft;
};
type EquipmentItem = EquipmentItemDraft & {
  id: number;
  projectId: number;
  catalogItemId: string;
  catalogUnitPrice: number | null;
  priceStatus: EquipmentPriceStatus;
  catalogNote: string;
  executionType: "직영" | "컨소";
  commissionInputType: "rate" | "amount";
  commissionRate: number | null;
  supplyType: "partner" | "direct";
  marginRate: number | null;
  procurementFeeRate: number | null;
  consortiumCommissionRate: number | null;
  consortiumPaymentAmount: number | null;
  protectionStatus: "신청 필요" | "신청 완료";
  protectionCompletedAt: string;
};
type ProductCatalogChoice = {
  id: string;
  name: string;
  specification: string;
  unitPrice: number | null;
  supplyType: "partner" | "direct";
  commissionRate: number | null;
  marginRate: number | null;
  supplierVendorName: string;
  note: string;
  reference: string;
};
type EquipmentSettlementDraft = {
  supplyType: "partner" | "direct";
  executionType: "직영" | "컨소";
  wizupCommissionRateInput: string;
  sourceRate: number | null;
  rateEdited: boolean;
  commissionInputType: "rate" | "amount";
  consortiumInputValue: string;
};
type ProtectionReviewItem = {
  id: number;
  projectId: number;
  organization: string;
  projectName: string;
  productName: string;
  specification: string;
  progressManager: string;
  protectionStatus: "신청 필요" | "신청 완료";
};
type EquipmentCorrectionRequest = {
  id: string;
  activityId: number;
  businessRound: number;
  organization: string;
  assigneeName: string;
  itemIds: number[];
  itemNames: string[];
  requestedByName: string;
  status: "open" | "completed";
  createdAt: string;
  updatedAt: string;
};
type EquipmentProject = {
  id: number;
  organization: string;
  businessRound: number;
  name: string;
  status: string;
  budgetType: string;
  budgetOriginalName: string;
  budgetGroupId: number | null;
  notes: string;
  constructionAmount: number | null;
  actualConstructionCost: number | null;
  createdByName: string;
  items: EquipmentItem[];
};
type EquipmentQuoteStatus = "complete" | "partial" | "missing";
type EquipmentQuoteSummary = {
  organization: string;
  businessRound: number;
  projectCount: number;
  itemCount: number;
  contractAmountReference: number;
  quoteStatus: EquipmentQuoteStatus;
  quoteItemCount: number;
  quoteMissingAmountItemCount: number;
  quoteConstructionCount: number;
};
type View =
  | "dashboard"
  | "budget-institutions"
  | "records"
  | "followup"
  | "schedules"
  | "organizations"
  | "awards"
  | "vendors"
  | "products"
  | "map"
  | "lounge"
  | "team"
  | "trash"
  | "backup"
  | "accounting"
  | "analytics"
  | "owner-performance"
  | "inventory"
  | "installation-schedule"
  | "quotations"
  | "integration";

type AccountingActivityStatus = {
  activityId: number;
  confirmed: boolean;
  commissionCollectedAmount: number;
  receivableBalance: number;
  accountingStatus: string;
};

type ConstructionDashboardCounts = {
  planned: number;
  active: number;
  completed: number;
};

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
  canManageActivityHistory: boolean;
};

type AiChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type VoiceRecordingStatus = "idle" | "recording" | "transcribing";

type AiImageAttachment = {
  id: string;
  file: File;
  previewUrl: string;
};

type AiOrganizePayload = {
  needsClarification?: boolean;
  assistantMessage?: string;
  draft?: Partial<AiPreview>;
  drafts?: Partial<AiPreview>[];
  schoolConfirmations?: OfficialSchoolConfirmation[];
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
  currentView: string;
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
      currentView: String(row.current_view ?? ""),
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

type ManagerIssueFilter = ManagerInspectionFilter;

type TeamPeriod = 7 | 30 | "all";
type ScheduleRange = 14 | 30 | "all";
type DashboardActivityScope = "mine" | "all";
type TeamMetricFocus = "all" | "active" | "attention";
type TeamDetailMode = "activity" | "attention" | "conversion";

type ManagerAlertAcknowledgement = {
  organization: string;
  issueSignature: string;
  snoozedUntil: string;
  hiddenAt: string;
  updatedAt: string;
};

type ManagerAlertMemberOption = {
  id: number;
  displayName: string;
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

type DetailInlineField =
  | "budget"
  | "contact"
  | "awardStage"
  | "execution"
  | "progressManager";

type OrganizationHealth = {
  name: string;
  effectiveContactName: string;
  latest: Activity;
  count: number;
  latestContact: InstitutionContactResolution<Activity>;
  recentRecords: Array<{
    record: Activity;
    contact: InstitutionContactResolution<Activity>;
  }>;
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

type InstitutionMergeItem = {
  organization: string;
  activityCount: number;
  assignmentHistoryCount: number;
  reviewCount: number;
  recommendationCount: number;
  campaignCount: number;
  equipmentProjectCount: number;
  equipmentItemCount: number;
  managerAlertCount: number;
  quotationCount: number;
  schoolLinkCount: number;
  decisionCount: number;
  trashSnapshotCount: number;
  accountingCount: number;
  hasLocation: boolean;
  locationRegion: string;
  locationAddress: string;
};

type InstitutionMergePreview = {
  organizations: InstitutionMergeItem[];
  recommendedTarget: string;
  conflicts: Array<{
    key: string;
    field: "progressManager" | "location";
    label: string;
    businessRound: number | null;
    recommendedValue: string;
    options: Array<{
      value: string;
      label: string;
      organization: string;
    }>;
  }>;
  autoFilledFields: string[];
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
  | "activity-history:manage"
  | "accounting:manage"
  | "analytics:view"
  | "inventory:manage"
  | "trash:manage"
  | "integration:manage"
  | "backup:manage"
  | "ai:voice"
  | "ai:images";

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
    id: "activity-history:manage",
    group: "operations",
    label: "일괄 변경 이력·되돌리기",
    description: "수주 전·후 일괄 변경 이력 조회와 안전 복원",
  },
  {
    id: "accounting:manage",
    group: "operations",
    label: "수금·채권 관리",
    description: "위즈업 수주의 입금 예정·실 수금·채권과 결산 관리",
  },
  {
    id: "analytics:view",
    group: "operations",
    label: "수주·제품 통계",
    description: "회사 전체 월간·연간 수주·제품 통계 확인",
  },
  {
    id: "inventory:manage",
    group: "operations",
    label: "물류·재고 관리",
    description: "재고 품목과 입고·출고·재고 조정 이력 관리",
  },
  {
    id: "trash:manage",
    group: "operations",
    label: "휴지통 복구",
    description: "백업·복구 화면에서 삭제된 자료 확인·복원",
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

const memberAiInputPermissionOptions: {
  id: Extract<MemberPermission, "ai:voice" | "ai:images">;
  label: string;
  description: string;
}[] = [
  {
    id: "ai:voice",
    label: "음성으로 입력",
    description: "마이크 녹음을 글자로 변환해 AI 기록 입력창에 추가",
  },
  {
    id: "ai:images",
    label: "사진 추가·분석",
    description: "사진 선택·드래그·붙여넣기로 내용을 읽어 입력창에 추가",
  },
];

const openAIModelOptions = ["gpt-5.4-mini", "gpt-5.4", "gpt-5-mini"];
type MemberAccessPreset =
  | "sales"
  | "salesManager"
  | "accounting"
  | "operations"
  | "custom";

const memberAccessPresetDefinitions: Record<
  Exclude<MemberAccessPreset, "custom">,
  {
    label: string;
    role: "member" | "assistant";
    permissions: MemberPermission[];
    isSales: boolean;
    description: string;
  }
> = {
  sales: {
    label: "영업 담당자",
    role: "member",
    permissions: [],
    isSales: true,
    description: "일상 영업 기록·기관·수주·지도 업무를 사용합니다.",
  },
  salesManager: {
    label: "영업 관리자",
    role: "assistant",
    permissions: ["records:manage"],
    isSales: true,
    description: "영업 업무와 팀 업무 현황·관리자 영업 점검을 사용합니다.",
  },
  accounting: {
    label: "회계 담당자",
    role: "assistant",
    permissions: ["accounting:manage", "analytics:view"],
    isSales: false,
    description: "입금 예정·실 수금·채권 관리와 수주·제품 통계를 사용합니다.",
  },
  operations: {
    label: "운영 관리자",
    role: "assistant",
    permissions: memberPermissionOptions
      .map((option) => option.id)
      .filter((permission) => permission !== "activity-history:manage"),
    isSales: false,
    description: "구성원·회계·통계·물류·재고·휴지통·API·백업 등 모든 운영 도구를 사용합니다.",
  },
};

const memberAccessPresetLabels: Record<MemberAccessPreset, string> = {
  sales: "영업 담당자",
  salesManager: "영업 관리자",
  accounting: "회계 담당자",
  operations: "운영 관리자",
  custom: "직접 설정",
};

function memberAccessPresetDescription(preset: MemberAccessPreset) {
  return preset === "custom"
    ? "선택한 운영 도구별로 접근 권한을 직접 설정합니다."
    : memberAccessPresetDefinitions[preset].description;
}

function hasExactPermissions(
  current: MemberPermission[],
  expected: MemberPermission[],
) {
  const currentOperations = current.filter((permission) =>
    memberPermissionOptions.some((option) => option.id === permission),
  );
  return (
    currentOperations.length === expected.length &&
    expected.every((permission) => current.includes(permission))
  );
}

function memberAccessPreset(
  member: Pick<TeamMember, "role" | "permissions" | "isSales">,
): MemberAccessPreset {
  const matched = (
    Object.entries(memberAccessPresetDefinitions) as [
      Exclude<MemberAccessPreset, "custom">,
      (typeof memberAccessPresetDefinitions)[Exclude<MemberAccessPreset, "custom">],
    ][]
  ).find(
    ([, definition]) =>
      member.role === definition.role &&
      member.isSales === definition.isSales &&
      hasExactPermissions(member.permissions, definition.permissions),
  );
  return matched?.[0] ?? "custom";
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

type SchoolDirectorySettingsStatus = {
  configured: boolean;
  source: "registered" | "server" | "none";
  keyLast4: string;
  updatedAt: string;
  serverFallbackConfigured: boolean;
  serverFallbackLast4: string;
  totalCount?: number;
  directoryCount?: number;
  linkedCount?: number;
  lastPage?: number;
  lastSyncedAt?: string;
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
  return [...memberPermissionOptions, ...memberAiInputPermissionOptions]
    .map((option) => option.id)
    .filter((permission) => source.includes(permission));
}

function memberCan(
  member: Pick<SessionMember, "role" | "permissions">,
  permission: MemberPermission,
) {
  return member.role === "admin" || member.permissions.includes(permission);
}

const emptyForm: FormState = {
  activityDate: new Date().toISOString().slice(0, 10),
  dateConfidence: "확정",
  activityType: "TM·통화",
  category: "",
  contactMethod: "유선",
  region: "",
  organization: "",
  businessRound: 1,
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
  budgets: [emptyActivityBudget()],
  topic: "",
  summary: "",
  detailLevel: "compact",
  detailSummary: "",
  detailKeyFacts: [],
  detailSections: [],
  rawInput: "",
  status: "상담 진행",
  statusManual: false,
  temperature: "중간",
  awardStatus: "미정",
  awardCompany: "",
  executionType: "직영",
  consortiumCompany: "",
  awardStage: "미정",
  awardCompletedDate: "",
  progressManager: "",
  progressManagerLocked: false,
  followUpRequired: false,
  followUpDate: "",
  nextAction: "",
  progressSchedule: "",
  contactRole: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  contacts: [emptyInstitutionContact(true)],
  sourceChat: "직접 입력",
  notes: "",
};

const navItems: { id: View; label: string; mark: string }[] = [
  { id: "dashboard", label: "대시보드", mark: "D" },
  { id: "budget-institutions", label: "예산별 기관", mark: "B" },
  { id: "followup", label: "기관별 관리(수주 전)", mark: "F" },
  { id: "awards", label: "기관별 관리(수주 후)", mark: "W" },
  { id: "vendors", label: "협력사 관리", mark: "V" },
  { id: "products", label: "제품·견적 관리", mark: "P" },
  { id: "map", label: "영업·수주 지도", mark: "M" },
];

const presenceViewLabels: Record<View, string> = {
  dashboard: "대시보드",
  "budget-institutions": "예산별 기관",
  records: "영업 기록",
  followup: "기관별 관리(수주 전)",
  schedules: "일정",
  organizations: "관리자 영업 점검",
  awards: "기관별 관리(수주 후)",
  vendors: "협력사 관리",
  products: "제품·견적 관리",
  map: "영업·수주 지도",
  lounge: "휴게실",
  team: "구성원 관리",
  trash: "휴지통",
  backup: "데이터 백업·복구",
  accounting: "수금·채권 관리",
  analytics: "수주·제품 통계",
  "owner-performance": "대시보드",
  inventory: "물류·재고 관리",
  "installation-schedule": "시공·납품 일정",
  quotations: "견적서 관리",
  integration: "API 등록·관리",
};

function presenceViewLabel(value: string) {
  return presenceViewLabels[value as View] ?? "";
}

const menuOrderStoragePrefix = "whizzup:menu-order:v1:";
type MenuGroup = "workspace" | "management";
type MenuDragState = { group: MenuGroup; id: View };

function orderMenuItems<T extends { id: View }>(items: T[], order: View[]) {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((left, right) => {
    const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
}

function completeWorkspaceMenuOrder(order: View[]) {
  const available = new Set(navItems.map((item) => item.id));
  const completed = [
    ...new Set(order.filter((id) => available.has(id))),
  ];
  navItems.forEach((item) => {
    if (completed.includes(item.id)) return;
    if (item.id === "budget-institutions") {
      const dashboardIndex = completed.indexOf("dashboard");
      completed.splice(Math.max(0, dashboardIndex + 1), 0, item.id);
    } else {
      completed.push(item.id);
    }
  });
  return completed;
}

const awardStageOptions = [...AWARD_STAGE_OPTIONS];

const completedAwardStages = new Set([COMPLETED_AWARD_STAGE, "완공"]);
const availableViews = new Set<View>([
  "dashboard",
  "budget-institutions",
  "records",
  "followup",
  "schedules",
  "organizations",
  "awards",
  "vendors",
  "products",
  "map",
  "lounge",
  "team",
  "trash",
  "backup",
  "accounting",
  "analytics",
  "owner-performance",
  "inventory",
  "installation-schedule",
  "quotations",
  "integration",
]);
const presentationHiddenViews = new Set<View>([
  "records",
  "organizations",
]);
const presentationModeStorageKey = "whizzup-presentation-mode";

function simplifiedActivityType(value: string) {
  return normalizeActivityType(value);
}

function contactMethodForActivityType(value: string) {
  const activityType = simplifiedActivityType(value);
  if (activityType === "미팅·방문") return "방문";
  if (activityType === "문자·메일") return "온라인";
  if (activityType === "기타") return "기타";
  return "유선";
}

const gptInstructions = `당신은 위즈업의 TM·미팅 기록 정리 도우미입니다.
상담 분류는 사용하지 않습니다. 호환성 필드인 topic은 항상 빈 문자열로 두고, 실제 상담 내용은 summary에만 정리하세요.
사용자가 입력한 내용을 기관명, 날짜, 지역, 예산, 예산금액, 핵심요약, 다음행동, 재연락일, 수주 결과로 구조화하세요.
기관명이 정정되거나 기존 기관명으로 확정되면 제목뿐 아니라 핵심요약, 다음행동, AI 미팅 요약 등 모든 문장에 최종 기관명을 동일하게 사용하고 이전 오타는 남기지 마세요.
기관명에 지역명이 이미 포함되어 있으면 지역명을 앞에 다시 붙이지 마세요. 예를 들어 “서울천동초등학교”를 “서울서울천동초등학교”로 쓰면 안 됩니다.
요약에는 확인된 일정·결정·후속 행동만 간결하게 적으세요. “일정 확인이 핵심”, “별도 장비나 수주 정보 없음”, “추가 정보 없음” 같은 해설이나 없는 정보에 대한 문장은 만들지 마세요. 단, 기관이 장비가 필요 없다고 말했거나 미수주로 결정된 것처럼 실제 전달·결정된 부정 사실은 보존하세요.
예산은 budgetType에, 금액은 사용자가 말한 단위까지 포함해 budgetAmount에 저장하세요. 모르면 빈 값으로 두세요.
위즈업 수주 후 진행 중인 학교·기관에서 철거·목공·도장·바닥·시스템·검수·교육 중 정확한 단계와 날짜가 함께 확인될 때만 progressSchedule 배열에 나누어 저장하세요. label은 해당 단계명만 쓰고 date는 현재 연도를 기준으로 YYYY-MM-DD 형식으로 정리하세요. 날짜 없는 단순 단계 언급은 일정으로 만들지 마세요.
수주 결과는 미정, 위즈업 수주, 협력사 수주, 타업체 수주 중 하나입니다. 수주업체명을 awardCompany에 적고, 업체명이 없으면 미정으로 두세요. 타업체 수주라면 실제 수주업체명을 반드시 확인하세요.
호환성 필드인 activityType은 기타, contactMethod는 기타, status는 상담 진행으로 고정하세요. 활동 유형과 영업 진행상황을 추측하거나 분류하지 마세요.
타업체 수주라면 사업방식은 해당 없음, 수주 진행 단계는 해당 없음으로 정리하세요.
그 외 수주 건의 사업방식은 컨소와 업체명을 명시한 경우만 컨소로 정리하고, 나머지는 직영으로 정리하세요.
수주 건의 진행 단계는 미정, 협상, 계약, 일정 조율, 설치·공사 진행, 검수·교육 진행, 납품 완료 중 하나로 정리하세요.
설치·공사가 끝났더라도 검수·교육이나 최종 인계가 남아 있으면 검수·교육 진행으로 두고, 납품 완료는 최종 완료가 분명한 경우에만 사용하세요.
기관 인물의 역할이 공사 담당자·회계 담당자·행정 담당자처럼 명시되면 contactRole에 역할을 그대로 넣고 이름·직책은 contactName에 넣으세요. 같은 역할과 이름을 핵심요약에 다시 반복하지 마세요.
progressManager는 위즈업 내부에서 수주 후 진행을 맡는 사람이며 기관 담당자와 구분하세요. 기관 메일은 contactEmail에 정리하세요.
summary와 recommendation.meetingSummary는 “논의했습니다”, “확인했습니다”, “진행합니다” 같은 존댓말 보고체로 작성하세요. “논의했다”, “확인한다”, “진행함” 같은 반말·메모체 종결은 사용하지 마세요.
기관 담당자가 말한 상황을 “전달했습니다”라고 쓰지 마세요. 기관의 설명은 “말씀하셨습니다”, “안내받았습니다”, “확인됐습니다”처럼 누가 말했는지 자연스럽게 이해되는 표현으로 정리하세요. “전달했습니다”는 위즈업 담당자가 실제로 자료나 내용을 전달한 경우에만 사용하세요.
녹취가 불명확하거나 오인식된 단어는 그대로 옮기거나 추측해 구체화하지 말고, 앞뒤 문맥에서 확실한 범위의 일반적인 표현으로 정리하세요. 예를 들어 준비 대상이 불명확하면 “교내 일정 준비로 업무가 분주한 상황”처럼 쓰세요.
재연락일과 후속 연락 일정은 별도 관리 항목이므로 summary와 recommendation.meetingSummary에는 넣지 마세요.
정보가 꼭 필요한데 빠졌을 때만 짧게 한 번 질문하세요.
저장하기 전에는 반드시 정리된 내용을 사용자에게 보여주고 “이대로 저장할까요?”라고 확인하세요.
사용자가 명시적으로 승인한 경우에만 createActivityRecord 액션을 호출하세요.
추측한 정보는 확정 사실처럼 기록하지 말고 날짜나 수주 결과를 모르면 빈 값 또는 미정으로 두세요.
저장 후에는 기관명, 다음 행동, 수주업체, 현재 상태를 짧게 다시 알려주세요.`;

function normalizeActivityDetailLevel(value: unknown): ActivityDetailLevel {
  return ["compact", "standard", "detailed"].includes(String(value ?? ""))
    ? (String(value) as ActivityDetailLevel)
    : "compact";
}

function parseActivityDetailFacts(value: unknown): ActivityDetailFact[] {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      source = [];
    }
  }
  if (!Array.isArray(source)) return [];
  return source
    .slice(0, 12)
    .map((item) => {
      const row =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      return {
        label: String(row.label ?? "").trim(),
        value: String(row.value ?? "").trim(),
      };
    })
    .filter((item) => item.label && item.value);
}

function parseActivityDetailSections(value: unknown): ActivityDetailSection[] {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      source = [];
    }
  }
  if (!Array.isArray(source)) return [];
  return source
    .slice(0, 12)
    .map((item) => {
      const row =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      return {
        title: String(row.title ?? "").trim(),
        items: Array.isArray(row.items)
          ? row.items
              .slice(0, 20)
              .map((entry) => String(entry ?? "").trim())
              .filter(Boolean)
          : [],
      };
    })
    .filter((item) => item.title && item.items.length);
}

function normalize(row: Record<string, unknown>): Activity {
  const value = (camel: string, snake: string) => row[camel] ?? row[snake] ?? "";
  const awardStatus =
    String(value("awardStatus", "award_status")) || "미정";
  const isOtherCompanyAward = awardStatus === "타업체 수주";
  const region = String(row.region ?? "");
  const organization = String(row.organization ?? "");
  const rawBudgetQuoteAmount =
    row.budgetQuoteAmount ?? row.budget_quote_amount;
  const parsedBudgetQuoteAmount = Number(rawBudgetQuoteAmount);
  const normalizedBudgetQuoteAmount =
    rawBudgetQuoteAmount === null ||
    rawBudgetQuoteAmount === undefined ||
    rawBudgetQuoteAmount === "" ||
    !Number.isFinite(parsedBudgetQuoteAmount)
      ? null
      : parsedBudgetQuoteAmount;
  const rawBudgetAmount = String(value("budgetAmount", "budget_amount"));
  const normalizedBudgetAmountMode = normalizeBudgetAmountMode(
    value("budgetAmountMode", "budget_amount_mode"),
  );
  const normalizedBudgetAmountOverride = formatMoneyInput(
    String(
      row.budgetAmountOverride ??
        row.budget_amount_override ??
        row.budgetOverrideAmount ??
        row.budget_override_amount ??
        "",
    ),
  );
  const rawBudgetAmountSource = String(
    value("budgetAmountSource", "budget_amount_source"),
  );
  const normalizedBudgetAmountSource =
    normalizedBudgetAmountMode === "quote_auto"
      ? hasExplicitBudgetAmount(normalizedBudgetAmountOverride) ||
        rawBudgetAmountSource === "manual"
        ? "manual"
        : normalizedBudgetQuoteAmount !== null ||
            rawBudgetAmountSource === "auto"
          ? "auto"
          : hasExplicitBudgetAmount(rawBudgetAmount)
            ? "manual"
            : "missing"
      : rawBudgetAmountSource ||
        (hasExplicitBudgetAmount(rawBudgetAmount) ? "manual" : "missing");
  const normalizedBudgets = activityBudgetsFromRecord(row).map((budget) => ({
    ...budget,
    budgetAmount: formatMoneyInput(budget.budgetAmount),
    budgetInstitutionAmount: formatMoneyInput(
      budget.budgetInstitutionAmount || budget.budgetAmount,
    ),
    budgetAmountOverride: formatMoneyInput(budget.budgetAmountOverride),
  }));
  return {
    id: Number(row.id),
    activityDate: String(value("activityDate", "activity_date")),
    dateConfidence: String(value("dateConfidence", "date_confidence")),
    activityType: String(value("activityType", "activity_type")),
    category: String(row.category ?? ""),
    contactMethod: String(value("contactMethod", "contact_method")),
    region,
    organization,
    businessRound: Math.max(
      1,
      Number(value("businessRound", "business_round")) || 1,
    ),
    jointProjectId:
      Number(value("jointProjectId", "joint_project_id")) > 0
        ? Number(value("jointProjectId", "joint_project_id"))
        : null,
    jointProjectName: String(
      value("jointProjectName", "joint_project_name"),
    ),
    jointProjectSponsor: String(
      value("jointProjectSponsor", "joint_project_sponsor"),
    ),
    jointProjectRole:
      String(value("jointProjectRole", "joint_project_role")) === "sponsor"
        ? "sponsor"
        : String(value("jointProjectRole", "joint_project_role")) === "site"
          ? "site"
          : "",
    jointProjectBudgetGroupId:
      Number(value("jointProjectBudgetGroupId", "joint_project_budget_group_id")) > 0
        ? Number(value("jointProjectBudgetGroupId", "joint_project_budget_group_id"))
        : null,
    jointProjectBudgetType: String(
      value("jointProjectBudgetType", "joint_project_budget_type"),
    ),
    jointProjectYear:
      Number(value("jointProjectYear", "joint_project_year")) > 0
        ? Number(value("jointProjectYear", "joint_project_year"))
        : null,
    jointProjectRound:
      Number(value("jointProjectRound", "joint_project_round")) > 0
        ? Number(value("jointProjectRound", "joint_project_round"))
        : null,
    jointProjectMemberBudgetAmount:
      Number(value("jointProjectMemberBudgetAmount", "joint_project_member_budget_amount")) >= 0
        ? Number(value("jointProjectMemberBudgetAmount", "joint_project_member_budget_amount"))
        : null,
    budgetType: String(value("budgetType", "budget_type")),
    budgetAmount: formatMoneyInput(rawBudgetAmount),
    budgetOriginalName: String(
      value("budgetOriginalName", "budget_original_name"),
    ),
    budgetGroupId:
      Number(value("budgetGroupId", "budget_group_id")) > 0
        ? Number(value("budgetGroupId", "budget_group_id"))
        : null,
    budgetMatchStatus:
      String(value("budgetMatchStatus", "budget_match_status")) ||
      (String(value("budgetType", "budget_type")).trim()
        ? "unclassified"
        : "unclassified"),
    budgetMatchMethod: String(
      value("budgetMatchMethod", "budget_match_method"),
    ),
    budgetRequestId:
      String(value("budgetRequestId", "budget_request_id")).trim() || null,
    budgetKind: normalizeBudgetKind(
      value("budgetKind", "budget_kind"),
    ),
    budgetAmountMode: normalizedBudgetAmountMode,
    budgetInstitutionAmount: formatMoneyInput(
      String(value("budgetInstitutionAmount", "budget_institution_amount")),
    ),
    budgetQuoteAmount: normalizedBudgetQuoteAmount,
    budgetAmountOverride: normalizedBudgetAmountOverride,
    budgetAmountSource: normalizedBudgetAmountSource,
    budgets: normalizedBudgets.length
      ? normalizedBudgets
      : [
          {
            ...emptyActivityBudget(),
            budgetType: String(value("budgetType", "budget_type")),
            budgetAmount: formatMoneyInput(rawBudgetAmount),
            budgetOriginalName: String(
              value("budgetOriginalName", "budget_original_name"),
            ),
            budgetGroupId:
              Number(value("budgetGroupId", "budget_group_id")) > 0
                ? Number(value("budgetGroupId", "budget_group_id"))
                : null,
            budgetMatchStatus:
              String(value("budgetMatchStatus", "budget_match_status")) ||
              "unclassified",
            budgetMatchMethod: String(
              value("budgetMatchMethod", "budget_match_method"),
            ),
            budgetRequestId:
              String(value("budgetRequestId", "budget_request_id")).trim() ||
              null,
            budgetKind: normalizeBudgetKind(
              value("budgetKind", "budget_kind"),
            ),
            budgetAmountMode: normalizedBudgetAmountMode,
            budgetInstitutionAmount: formatMoneyInput(
              String(
                value(
                  "budgetInstitutionAmount",
                  "budget_institution_amount",
                ),
              ),
            ),
            budgetQuoteAmount: normalizedBudgetQuoteAmount,
            budgetAmountOverride: normalizedBudgetAmountOverride,
            budgetAmountSource: normalizedBudgetAmountSource,
          },
        ],
    topic: String(row.topic ?? ""),
    summary: collapseRepeatedOrganizationRegionPrefix(
      row.summary,
      organization,
      region,
    ),
    detailLevel: normalizeActivityDetailLevel(
      value("detailLevel", "detail_level"),
    ),
    detailSummary: String(value("detailSummary", "detail_summary")),
    detailKeyFacts: parseActivityDetailFacts(
      value("detailKeyFacts", "detail_key_facts_json"),
    ),
    detailSections: parseActivityDetailSections(
      value("detailSections", "detail_sections_json"),
    ),
    rawInput: String(value("rawInput", "raw_input")),
    status: String(row.status ?? ""),
    statusManual: Boolean(Number(value("statusManual", "status_manual"))),
    temperature: String(row.temperature ?? ""),
    awardStatus,
    awardCompany: String(value("awardCompany", "award_company")),
    executionType: isOtherCompanyAward
      ? "해당 없음"
      : String(value("executionType", "execution_type")) === "컨소"
        ? "컨소"
        : "직영",
    consortiumCompany: isOtherCompanyAward
      ? ""
      : String(value("consortiumCompany", "consortium_company")),
    awardStage: isOtherCompanyAward
      ? "해당 없음"
      : normalizeAwardStage(value("awardStage", "award_stage")),
    awardCompletedDate: String(
      value("awardCompletedDate", "award_completed_date"),
    ),
    progressManager: String(value("progressManager", "progress_manager")),
    progressManagerLocked:
      Number(value("progressManagerLocked", "progress_manager_locked")) === 1,
    followUpRequired: Boolean(Number(value("followUpRequired", "follow_up_required"))),
    followUpDate: String(value("followUpDate", "follow_up_date")),
    nextAction: compactRepeatedAiText(
      value("nextAction", "next_action"),
      400,
    ),
    progressSchedule: String(value("progressSchedule", "progress_schedule")),
    contactRole: String(value("contactRole", "contact_role")),
    contactName: String(value("contactName", "contact_name")),
    contactPhone: String(value("contactPhone", "contact_phone")),
    contactEmail: String(value("contactEmail", "contact_email")),
    contacts: normalizeInstitutionContacts(
      value("contacts", "contacts_json"),
      {
        role: String(value("contactRole", "contact_role")),
        name: String(value("contactName", "contact_name")),
        phone: String(value("contactPhone", "contact_phone")),
        email: String(value("contactEmail", "contact_email")),
      },
    ),
    sourceChat: String(value("sourceChat", "source_chat")),
    notes: String(row.notes ?? ""),
    createdByName: String(value("createdByName", "created_by_name")) || "가져온 기록",
    updatedByName: String(value("updatedByName", "updated_by_name")),
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
    catalogItemId: String(value("catalogItemId", "catalog_item_id")),
    catalogUnitPrice:
      value("catalogUnitPrice", "catalog_unit_price") === null ||
      value("catalogUnitPrice", "catalog_unit_price") === ""
        ? null
        : Number(value("catalogUnitPrice", "catalog_unit_price")),
    priceStatus: (
      [
        "입력 완료",
        "무상 제공",
        "계약금액에 포함",
        "서비스 품목",
      ].includes(String(value("priceStatus", "price_status")))
        ? String(value("priceStatus", "price_status"))
        : "금액 미입력"
    ) as EquipmentPriceStatus,
    catalogNote: String(value("catalogNote", "catalog_note")),
    executionType:
      String(value("executionType", "execution_type")) === "컨소"
        ? "컨소"
        : "직영",
    commissionInputType:
      String(value("commissionInputType", "commission_input_type")) === "amount"
        ? "amount"
        : "rate",
    commissionRate:
      value("commissionRate", "commission_rate") === null ||
      value("commissionRate", "commission_rate") === ""
        ? null
        : Number(value("commissionRate", "commission_rate")),
    supplyType:
      String(value("supplyType", "supply_type")) === "direct"
        ? "direct"
        : "partner",
    marginRate:
      value("marginRate", "margin_rate") === null ||
      value("marginRate", "margin_rate") === ""
        ? null
        : Number(value("marginRate", "margin_rate")),
    procurementFeeRate:
      value("procurementFeeRate", "procurement_fee_rate") === null ||
      value("procurementFeeRate", "procurement_fee_rate") === ""
        ? null
        : Number(value("procurementFeeRate", "procurement_fee_rate")),
    consortiumCommissionRate:
      value("consortiumCommissionRate", "consortium_commission_rate") === null ||
      value("consortiumCommissionRate", "consortium_commission_rate") === ""
        ? null
        : Number(
            value("consortiumCommissionRate", "consortium_commission_rate"),
          ),
    consortiumPaymentAmount:
      value("consortiumPaymentAmount", "consortium_payment_amount") === null ||
      value("consortiumPaymentAmount", "consortium_payment_amount") === ""
        ? null
        : Number(value("consortiumPaymentAmount", "consortium_payment_amount")),
    protectionStatus:
      String(value("protectionStatus", "protection_status")) === "신청 완료"
        ? "신청 완료"
        : "신청 필요",
    protectionCompletedAt: String(
      value("protectionCompletedAt", "protection_completed_at"),
    ),
  };
}

function storedEquipmentFinance(item: EquipmentItem) {
  return calculateEquipmentFinance({
    unitPrice: item.catalogUnitPrice,
    quantity: equipmentSettlementQuantity(item),
    executionType: item.executionType,
    commissionInputType: item.commissionInputType,
    commissionRate: item.commissionRate,
    supplyType: item.supplyType,
    marginRate: item.marginRate,
    procurementFeeRate: item.procurementFeeRate,
    consortiumCommissionRate: item.consortiumCommissionRate,
    consortiumPaymentAmount: item.consortiumPaymentAmount,
  });
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
    businessRound: Math.max(
      1,
      Number(value("businessRound", "business_round")) || 1,
    ),
    name: budgetType.trim() || displayName,
    status: String(row.status ?? "") || "제안",
    budgetType,
    budgetOriginalName: String(value("budgetOriginalName", "budget_original_name")),
    budgetGroupId:
      Number(value("budgetGroupId", "budget_group_id")) > 0
        ? Number(value("budgetGroupId", "budget_group_id"))
        : null,
    notes,
    constructionAmount:
      value("constructionAmount", "construction_amount") === null ||
      value("constructionAmount", "construction_amount") === ""
        ? null
        : Number(value("constructionAmount", "construction_amount")),
    actualConstructionCost:
      value("actualConstructionCost", "actual_construction_cost") === null ||
      value("actualConstructionCost", "actual_construction_cost") === ""
        ? null
        : Number(value("actualConstructionCost", "actual_construction_cost")),
    createdByName: String(value("createdByName", "created_by_name")) || "등록자",
    items: Array.isArray(row.items)
      ? row.items.map((item) =>
          normalizeEquipmentItem(item as Record<string, unknown>),
        )
      : [],
  };
}

function equipmentBudgetKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
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

function normalizeAiDraft(draft: Partial<AiPreview> | undefined): AiPreview {
  const budgetType = String(draft?.budgetType ?? "").trim();
  const organization = String(draft?.organization ?? "").trim();
  const region = String(draft?.region ?? "").trim();
  const recommendation = normalizeAiRecommendationDraft(draft?.recommendation);
  const followUpRequired = false;
  const parsedBudgetQuoteAmount = Number(draft?.budgetQuoteAmount);
  return {
    ...emptyForm,
    ...draft,
    organization,
    region,
    summary: collapseRepeatedOrganizationRegionPrefix(
      compactShareSummary(draft?.summary),
      organization,
      region,
    ),
    detailLevel: normalizeActivityDetailLevel(draft?.detailLevel),
    detailSummary: String(draft?.detailSummary ?? "").trim(),
    detailKeyFacts: parseActivityDetailFacts(draft?.detailKeyFacts),
    detailSections: parseActivityDetailSections(draft?.detailSections),
    rawInput: String(draft?.rawInput ?? ""),
    nextAction: compactRepeatedAiText(draft?.nextAction, 400),
    budgetType,
    budgetAmount: formatMoneyInput(String(draft?.budgetAmount ?? "")),
    budgetOriginalName:
      String(draft?.budgetOriginalName ?? "").trim() || budgetType,
    budgetGroupId:
      Number(draft?.budgetGroupId) > 0 ? Number(draft?.budgetGroupId) : null,
    budgetMatchStatus:
      String(draft?.budgetMatchStatus ?? "").trim() ||
      (budgetType ? "unclassified" : "unclassified"),
    budgetMatchMethod: String(draft?.budgetMatchMethod ?? "").trim(),
    budgetRequestId:
      String(draft?.budgetRequestId ?? "").trim() || null,
    budgetKind: normalizeBudgetKind(draft?.budgetKind),
    budgetAmountMode: normalizeBudgetAmountMode(draft?.budgetAmountMode),
    budgetInstitutionAmount: formatMoneyInput(
      String(draft?.budgetInstitutionAmount ?? draft?.budgetAmount ?? ""),
    ),
    budgetQuoteAmount:
      draft?.budgetQuoteAmount === null ||
      draft?.budgetQuoteAmount === undefined ||
      !Number.isFinite(parsedBudgetQuoteAmount)
        ? null
        : parsedBudgetQuoteAmount,
    budgetAmountOverride: formatMoneyInput(
      String(
        draft?.budgetAmountOverride ??
          (draft as Record<string, unknown> | undefined)?.budgetOverrideAmount ??
          "",
      ),
    ),
    budgetAmountSource:
      String(draft?.budgetAmountSource ?? "").trim() ||
      (hasExplicitBudgetAmount(draft?.budgetAmount) ? "manual" : "missing"),
    status: normalizeAiSuggestedStatus(draft?.status, followUpRequired),
    statusManual: false,
    followUpRequired,
    followUpDate: "",
    progressSchedule: String(draft?.progressSchedule ?? ""),
    equipmentProjectName:
      budgetType || String(draft?.equipmentProjectName ?? "").trim(),
    equipmentProjectStatus:
      String(draft?.equipmentProjectStatus ?? "").trim() || "제안",
    equipmentItems: cleanAiEquipmentItems(draft?.equipmentItems),
    recommendation: {
      ...recommendation,
      meetingSummary: collapseRepeatedOrganizationRegionPrefix(
        compactShareSummary(recommendation.meetingSummary),
        organization,
        region,
      ),
    },
    sourceChat: "사이트 AI 입력",
  };
}

function escapeOfficialSchoolPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceWithOfficialSchoolName(
  value: unknown,
  previousOrganization: string,
  officialOrganization: string,
) {
  let result = replaceOrganizationReferences(
    value,
    previousOrganization,
    officialOrganization,
  );
  const officialPattern = escapeOfficialSchoolPattern(officialOrganization);
  const duplicateSuffix = officialOrganization.endsWith("초등학교")
    ? "(?:초등학교|등학교)"
    : officialOrganization.endsWith("중학교")
      ? "(?:중학교|학교)"
      : officialOrganization.endsWith("고등학교")
        ? "(?:고등학교|등학교)"
        : officialOrganization.endsWith("유치원")
          ? "(?:유치원|치원)"
          : "";
  if (duplicateSuffix) {
    result = result.replace(
      new RegExp(`${officialPattern}(?:${duplicateSuffix})+`, "gu"),
      officialOrganization,
    );
  }
  return result;
}

function applyOfficialSchoolDecision(
  preview: AiPreview,
  confirmation: OfficialSchoolConfirmation,
  organization: string,
  normalizeExistingAliases: boolean,
) {
  const previousOrganization = preview.organization.trim();
  const candidate = confirmation.candidates.find(
    (item) => item.name === organization,
  );
  const region = preview.region.trim() || candidate?.region || "";
  const replace = (value: unknown) =>
    compactRepeatedAiText(
      collapseRepeatedOrganizationRegionPrefix(
        replaceWithOfficialSchoolName(
          value,
          previousOrganization,
          organization,
        ),
        organization,
        region,
      ),
      600,
    );
  return {
    ...preview,
    organization,
    region,
    topic: replace(preview.topic),
    summary: compactShareSummary(replace(preview.summary)),
    detailSummary: replace(preview.detailSummary),
    detailKeyFacts: preview.detailKeyFacts.map((item) => ({
      label: item.label,
      value: replace(item.value),
    })),
    detailSections: preview.detailSections.map((section) => ({
      title: section.title,
      items: section.items.map(replace),
    })),
    nextAction: replace(preview.nextAction),
    notes: replace(preview.notes),
    normalizeOfficialSchoolAliases: normalizeExistingAliases,
    recommendation: {
      ...preview.recommendation,
      meetingSummary: compactShareSummary(
        replace(preview.recommendation.meetingSummary),
      ),
    },
  };
}

function formatDate(value: string) {
  if (!value) return "날짜 미상";
  const parts = value.split("-");
  if (parts.length === 2) return `${parts[0]}.${parts[1]}`;
  if (parts.length === 3) return `${parts[0]}.${parts[1]}.${parts[2]}`;
  return value;
}

function formatInputTime(value: string) {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  return `입력 ${date.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}`;
}

function hasActivityDetail(record: Activity) {
  return Boolean(
    record.detailSummary ||
      record.detailKeyFacts.length ||
      record.detailSections.length ||
      record.rawInput ||
      record.summary.length >= 220 ||
      record.notes.length >= 220,
  );
}

function activityDetailLevelLabel(level: ActivityDetailLevel) {
  if (level === "detailed") return "상세 기록";
  if (level === "standard") return "일반 기록";
  return "기존 기록";
}

function formatChangeHistoryTime(value: string) {
  if (!value) return "시간 미상";
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function activityToForm(record: Activity): FormState {
  return {
    activityDate: record.activityDate,
    dateConfidence: record.dateConfidence,
    activityType: simplifiedActivityType(record.activityType),
    category: record.category,
    contactMethod: contactMethodForActivityType(record.activityType),
    region: record.region,
    organization: record.organization,
    businessRound: record.businessRound,
    budgetType: record.budgetType,
    budgetAmount: formatMoneyInput(record.budgetAmount),
    budgetOriginalName: record.budgetOriginalName || record.budgetType,
    budgetGroupId: record.budgetGroupId ?? null,
    budgetMatchStatus: record.budgetMatchStatus || "unclassified",
    budgetMatchMethod: record.budgetMatchMethod || "",
    budgetRequestId: record.budgetRequestId ?? null,
    budgetKind: record.budgetKind || "",
    budgetAmountMode: record.budgetAmountMode || "",
    budgetInstitutionAmount:
      record.budgetInstitutionAmount || record.budgetAmount,
    budgetQuoteAmount: record.budgetQuoteAmount ?? null,
    budgetAmountOverride: record.budgetAmountOverride || "",
    budgetAmountSource:
      record.budgetAmountSource ||
      (hasExplicitBudgetAmount(record.budgetAmount) ? "manual" : "missing"),
    budgets: record.budgets.length
      ? record.budgets.map((budget) => ({ ...budget }))
      : [emptyActivityBudget()],
    topic: record.topic,
    summary: record.summary,
    detailLevel: record.detailLevel,
    detailSummary: record.detailSummary,
    detailKeyFacts: record.detailKeyFacts.map((item) => ({ ...item })),
    detailSections: record.detailSections.map((section) => ({
      ...section,
      items: [...section.items],
    })),
    rawInput: record.rawInput,
    status: record.status,
    statusManual: record.statusManual,
    temperature: record.temperature,
    awardStatus: record.awardStatus,
    awardCompany: record.awardCompany,
    executionType: record.executionType,
    consortiumCompany: record.consortiumCompany,
    awardStage: record.awardStage,
    awardCompletedDate: record.awardCompletedDate,
    progressManager: record.progressManager,
    progressManagerLocked: record.progressManagerLocked,
    followUpRequired: record.followUpRequired,
    followUpDate: record.followUpDate,
    nextAction: record.nextAction,
    progressSchedule: record.progressSchedule,
    contactRole: record.contactRole,
    contactName: record.contactName,
    contactPhone: record.contactPhone,
    contactEmail: record.contactEmail,
    contacts:
      record.contacts.length > 0
        ? record.contacts.map((contact) => ({ ...contact }))
        : [emptyInstitutionContact(true)],
    sourceChat: record.sourceChat,
    notes: record.notes,
  };
}

function activityReviewInstitutionValue(
  record: Activity,
  institutionState: InstitutionStateSnapshot | null,
  key:
    | "contactName"
    | "contactPhone"
    | "contactEmail"
    | "budgetType"
    | "budgetAmount",
) {
  return String(record[key] || institutionState?.[key] || "").trim();
}

function effectiveInstitutionContactName(
  record: Activity,
  institutionStateByBusiness: Map<string, InstitutionStateSnapshot>,
) {
  return activityReviewInstitutionValue(
    record,
    institutionStateByBusiness.get(
      analyticsBusinessRoundKey(record.organization, record.businessRound),
    ) ?? null,
    "contactName",
  );
}

function activityReviewFields(
  record: Activity,
  institutionState: InstitutionStateSnapshot | null = null,
): ActivityReviewField[] {
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

  if (!record.region.trim()) {
    add("region", "지역", "text", "예: 경기 김포", "기관 지역이 비어 있습니다.");
  }
  if (contactActivity && !record.summary.trim()) {
    add(
      "summary",
      "상담 내용",
      "text",
      "통화·미팅의 핵심 내용을 입력하세요.",
      "상담 내용 요약이 비어 있습니다.",
    );
  }
  if (
    contactActivity &&
    !activityReviewInstitutionValue(record, institutionState, "contactName")
  ) {
    add(
      "contactName",
      "기관 담당자",
      "text",
      "이름 / 직책",
      "기관 담당자가 비어 있습니다.",
    );
  }
  if (
    contactActivity &&
    !activityReviewInstitutionValue(record, institutionState, "contactPhone")
  ) {
    add(
      "contactPhone",
      "담당자 연락처",
      "text",
      "010-0000-0000",
      "담당자 연락처가 비어 있습니다.",
    );
  }
  if (
    contactActivity &&
    !activityReviewInstitutionValue(record, institutionState, "contactEmail")
  ) {
    add(
      "contactEmail",
      "담당자 이메일",
      "email",
      "name@example.com",
      "담당자 이메일이 비어 있습니다.",
    );
  }
  if (
    contactActivity &&
    !activityReviewInstitutionValue(record, institutionState, "budgetType")
  ) {
    add(
      "budgetType",
      "예산",
      "text",
      "예: 자체예산, 늘봄, 공간재구조화",
      "예산이 비어 있습니다.",
    );
  }
  if (
    contactActivity &&
    !activityReviewInstitutionValue(record, institutionState, "budgetAmount")
  ) {
    add(
      "budgetAmount",
      "예산금액",
      "text",
      "예: 5,000만원",
      "예산금액이 비어 있습니다.",
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

function activityReviewSignature(
  record: Activity,
  institutionState: InstitutionStateSnapshot | null = null,
) {
  const fields = activityReviewFields(record, institutionState);
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

function formatMoneyInput(value: string) {
  return value.replace(/\d[\d,]*/g, (number) => {
    const digits = number.replaceAll(",", "");
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  });
}

function hasExplicitBudgetAmount(value: unknown) {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return false;
  const key = text
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s._·/\\()[\]{}'"`~!@#$%^&*+=:;?,<>|-]+/g, "");
  return ![
    "",
    "미정",
    "미등록",
    "미확인",
    "확인필요",
    "예산미정",
    "금액미정",
    "예산금액미정",
    "품목견적미등록",
    "모름",
    "없음",
    "unknown",
    "na",
  ].includes(key);
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

function parseSignedMoneyAmount(value: string) {
  const sign = value.trim().startsWith("-") ? -1 : 1;
  return sign * parseMoneyAmount(value);
}

function formatBudgetDisplay(value: string) {
  const input = value.trim();
  if (!input) return "";
  const rawNumber = Number(input.replace(/[^\d.]/g, ""));
  const explicitKoreanUnit = /억|만/.test(input);
  const explicitWonUnit = /원/.test(input) && !explicitKoreanUnit;
  const amount = explicitKoreanUnit || explicitWonUnit
    ? parseMoneyAmount(input)
    : Number.isFinite(rawNumber) && rawNumber > 0 && rawNumber < 1_000_000
      ? rawNumber * 10_000
      : parseMoneyAmount(input);
  if (!amount) return "";
  return `${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
  }).format(amount / 10_000)}만원`;
}

function isUnregisteredBudgetName(value: string) {
  return !value.trim() || ["미정", "예산"].includes(value.trim());
}

function isUnregisteredBudgetAmount(value: string) {
  return !value.trim() || value.trim() === "미정";
}

function sharedFieldValue(
  values: string[],
  normalize: (value: string) => string = (value) => value.trim(),
) {
  const unique = [...new Set(values.map(normalize))];
  return {
    value: unique.length === 1 ? unique[0] : "",
    mixed: unique.length > 1,
  };
}

function summarizeInstitutionNames(names: string[]) {
  if (!names.length) return "선택한 기관";
  if (names.length === 1) return names[0];
  return `${names[0]} 외 ${names.length - 1}곳`;
}

function toLocalDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type ProgressScheduleItem = {
  label: string;
  date: string;
};

type OrganizationScheduleRecord = {
  id: number;
  organization: string;
  businessRound: number;
  label: string;
  scheduledDate: string;
  completed: boolean;
  updatedByName: string;
  syncStatus: "pending" | "synced" | "failed";
  syncError: string;
  syncAttempts: number;
};

type OrganizationScheduleDraft = {
  id?: number;
  key: string;
  label: string;
  scheduledDate: string;
  completed: boolean;
};

type ScheduleReminderRecord = {
  id: number;
  organization: string;
  businessRound: number;
  label: string;
  scheduledDate: string;
  visibility: "private" | "shared" | "shared-post-award";
  assigneeName: string;
  updatedAt: string;
  updatedByName: string;
  conflict: boolean;
};

function scheduleReminderTiming(dateValue: string, todayValue: string) {
  if (dateValue < todayValue) {
    return { label: "기한 지남", tone: "overdue" } as const;
  }
  if (dateValue === todayValue) {
    return { label: "오늘", tone: "today" } as const;
  }
  const due = Date.parse(`${dateValue}T00:00:00Z`);
  const today = Date.parse(`${todayValue}T00:00:00Z`);
  const days = Math.max(1, Math.round((due - today) / 86_400_000));
  return { label: `D-${days}`, tone: "soon" } as const;
}

function scheduleReminderWasRecentlyUpdated(
  updatedAt: string,
  todayValue: string,
) {
  const updatedDate = timestampDateValue(updatedAt);
  if (!updatedDate || updatedDate > todayValue) {
    return false;
  }
  return daysSinceDate(updatedDate, todayValue) <= 2;
}

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

function isPostAwardProgressScheduleItem(item: ProgressScheduleItem) {
  return !/(?:재연락|연락\s*(?:예정|하기)|상담|영업\s*미팅|미팅|방문|제안|견적)/.test(
    item.label,
  );
}

  function activityImportSignature(
  value: Pick<
    ActivityImportValues,
    | "activityDate"
    | "organization"
    | "businessRound"
    | "activityType"
    | "summary"
  >,
) {
  const normalizeText = (text: string) =>
    text.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
  return [
    value.activityDate,
    normalizeText(value.organization),
    Math.max(1, Number(value.businessRound) || 1),
    normalizeText(value.activityType),
    normalizeText(value.summary),
  ].join("|");
}

function activitySyncSignature(
  value: Pick<
    ActivityImportValues,
    | "activityDate"
    | "organization"
    | "businessRound"
    | "region"
    | "summary"
    | "awardStatus"
    | "awardCompany"
    | "executionType"
    | "consortiumCompany"
    | "awardStage"
  >,
) {
  const normalizeText = (text: string) =>
    text.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
  return [
    value.activityDate,
    normalizeText(value.organization),
    Math.max(1, Number(value.businessRound) || 1),
    normalizeText(value.region),
    normalizeText(value.summary),
    value.awardStatus,
    normalizeText(value.awardCompany),
    value.executionType,
    normalizeText(value.consortiumCompany),
    value.awardStage,
  ].join("|");
}

function awardImportSignature(
  value: Pick<
    ActivityImportValues,
    "activityDate" | "organization" | "businessRound" | "awardCompany"
  >,
) {
  return [
    value.activityDate.slice(0, 7),
    awardCompanyKey(value.organization),
    Math.max(1, Number(value.businessRound) || 1),
    awardCompanyKey(value.awardCompany),
  ].join("|");
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

function mergeActivityDetailFacts(
  ...groups: ActivityDetailFact[][]
): ActivityDetailFact[] {
  const facts = new Map<string, ActivityDetailFact>();
  groups.flat().forEach((fact) => {
    const key = fact.label.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
    if (!key || facts.has(key)) return;
    facts.set(key, fact);
  });
  return [...facts.values()].slice(0, 12);
}

function mergeActivityDetailSections(
  ...groups: ActivityDetailSection[][]
): ActivityDetailSection[] {
  const sections = new Map<string, ActivityDetailSection>();
  groups.flat().forEach((section) => {
    const key = section.title.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
    if (!key) return;
    const previous = sections.get(key);
    sections.set(key, {
      title: previous?.title || section.title,
      items: [
        ...new Set([...(previous?.items ?? []), ...section.items]),
      ].slice(0, 20),
    });
  });
  return [...sections.values()].slice(0, 12);
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
      detailLevel:
        existing.detailLevel === "detailed" || draft.detailLevel === "detailed"
          ? "detailed"
          : existing.detailLevel === "standard" ||
              draft.detailLevel === "standard"
            ? "standard"
            : "compact",
      detailSummary: mergeUniqueText(
        existing.detailSummary,
        draft.detailSummary,
        " ",
      ),
      detailKeyFacts: mergeActivityDetailFacts(
        existing.detailKeyFacts,
        draft.detailKeyFacts,
      ),
      detailSections: mergeActivityDetailSections(
        existing.detailSections,
        draft.detailSections,
      ),
      rawInput: mergeUniqueText(existing.rawInput, draft.rawInput, "\n\n"),
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

function statusClass(status: string) {
  if (status.includes("수주 전환")) return "done";
  if (status.includes("신규") || status.includes("재영업")) return "urgent";
  if (
    status.includes("장기") ||
    status.includes("대기") ||
    status.includes("영업 종료")
  ) return "muted";
  return "active";
}

function isInstitutionAwarded(
  record: Pick<Activity, "awardStatus">,
) {
  return ["위즈업 수주", "협력사 수주"].includes(record.awardStatus);
}

function displaySalesStatus(record: Activity) {
  return normalizeSalesProgress(record.status, record.awardStatus);
}

function isEarlierActivity(candidate: Activity, current: Activity) {
  return (
    candidate.activityDate < current.activityDate ||
    (candidate.activityDate === current.activityDate && candidate.id < current.id)
  );
}

function isCompletedAwardEvidence(record: Activity) {
  if (!completedAwardStages.has(record.awardStage)) return false;
  if (isAwardDecisionEvidence(record)) {
    return true;
  }
  return /수주\s*(?:현황\s*)?등록|설치\s*완료|공사\s*완료|준공|완공/.test(
    `${record.topic} ${record.summary} ${record.notes}`,
  );
}

function isAwardDecisionEvidence(record: Activity) {
  if (
    isAwardManagementSystemRecord(record) ||
    record.activityType === "수주"
  ) {
    return true;
  }
  return /수주\s*(?:현황\s*)?등록|수주\s*관리/.test(
    `${record.sourceChat} ${record.topic} ${record.summary} ${record.notes}`,
  );
}

function postAwardContactStatus(
  record: Activity,
  organizationHistory: Activity[],
) {
  if (
    isAwardManagementSystemRecord(record) ||
    isPartnerRegistrationSystemRecord(record) ||
    isCampaignRegistrationSystemRecord(record)
  ) {
    return "";
  }

  const hasEarlierCompletedAward = organizationHistory.some(
    (candidate) =>
      isEarlierActivity(candidate, record) &&
      isCompletedAwardEvidence(candidate),
  );
  if (!hasEarlierCompletedAward) return "";

  const context =
    `${record.activityType} ${record.topic} ${record.summary} ${record.nextAction} ${record.notes}`;
  if (/A\/?S|에이에스|하자|수리|점검|교육|유지\s*보수/.test(context)) {
    return "사후관리";
  }
  if (
    /미팅|상담|문의|견적|예산|추가|신규|교체|재구매|증설|구매|제안|재계약/.test(
      context,
    )
  ) {
    return "재영업 상담";
  }
  return "재영업 상담";
}

function effectiveSalesProgress(
  record: Activity,
  organizationHistory: Activity[] = [],
) {
  if (record.statusManual) {
    return normalizeSalesProgress(record.status, record.awardStatus);
  }
  return (
    postAwardContactStatus(record, organizationHistory) ||
    normalizeSalesProgress(record.status, record.awardStatus)
  );
}

function priorAwardReference(
  record: Activity,
  organizationHistory: Activity[],
) {
  const prior = organizationHistory
    .filter(
      (candidate) =>
        isEarlierActivity(candidate, record) &&
        isAwardDecisionEvidence(candidate),
    )
    .sort(
      (a, b) =>
        b.activityDate.localeCompare(a.activityDate) || b.id - a.id,
    )[0];
  if (!prior) return "";
  return prior.awardStatus === "타업체 수주"
    ? "과거 타업체 수주"
    : "기존 수주기관";
}

function displayContactMethod(record: Activity) {
  if (record.contactMethod && record.contactMethod !== "기타") {
    return record.contactMethod;
  }
  if (
    ["위즈업 수주", "협력사 수주"].includes(record.awardStatus) &&
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
  const pageSize = scope === "dashboard" ? 2_500 : 500;
  const maximumPages = 1_000;
  const recordsById = new Map<number, Activity>();
  let offset = 0;

  for (let page = 0; page < maximumPages; page += 1) {
    const response = await resilientFetch(
      `/api/records?scope=${scope}&limit=${pageSize}&offset=${offset}`,
      { cache: "no-store", timeoutMs: 15_000 },
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

function normalizeUpdatedActivity(
  payload: Record<string, unknown>,
  previous: Activity,
) {
  const hasJointProjectMetadata =
    Object.prototype.hasOwnProperty.call(payload, "jointProjectId") ||
    Object.prototype.hasOwnProperty.call(payload, "joint_project_id");
  return normalize({
    ...payload,
    ...(hasJointProjectMetadata
      ? {}
      : {
          jointProjectId: previous.jointProjectId ?? null,
          jointProjectName: previous.jointProjectName || "",
          jointProjectSponsor: previous.jointProjectSponsor || "",
          jointProjectRole: previous.jointProjectRole || "",
          jointProjectBudgetGroupId:
            previous.jointProjectBudgetGroupId ?? null,
          jointProjectBudgetType: previous.jointProjectBudgetType || "",
          jointProjectYear: previous.jointProjectYear ?? null,
          jointProjectRound: previous.jointProjectRound ?? null,
          jointProjectMemberBudgetAmount:
            previous.jointProjectMemberBudgetAmount ?? null,
        }),
    createdByName: previous.createdByName,
    createdAt: previous.createdAt,
  });
}

async function requestSession() {
  const response = await resilientFetch("/api/session", {
    cache: "no-store",
    timeoutMs: 12_000,
  });
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

async function requestScheduleReminders() {
  const response = await resilientFetch("/api/schedules?scope=reminders", {
    cache: "no-store",
    timeoutMs: 12_000,
  });
  const payload = (await response.json()) as {
    reminders?: ScheduleReminderRecord[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "내 일정을 불러오지 못했습니다.");
  }
  return Array.isArray(payload.reminders) ? payload.reminders : [];
}

async function requestCompleteScheduleReminder(scheduleId: number) {
  const response = await fetch("/api/schedules?scope=reminders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduleId }),
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "일정을 확인 완료하지 못했습니다.");
  }
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
  proposedQty: 1,
  awardedQty: 0,
  installedQty: 0,
  unit: "대",
  status: "제안",
  notes: "",
};

const emptyEquipmentSettlementDraft: EquipmentSettlementDraft = {
  supplyType: "partner",
  executionType: "직영",
  wizupCommissionRateInput: "",
  sourceRate: null,
  rateEdited: false,
  commissionInputType: "rate",
  consortiumInputValue: "",
};

const directEquipmentSetDefaultUnitPrice = 1_500_000;

function catalogSupplyRate(product: ProductCatalogChoice) {
  return product.supplyType === "direct"
    ? product.marginRate
    : product.commissionRate;
}

function equipmentSupplyRate(item: EquipmentItem) {
  return item.supplyType === "direct" ? item.marginRate : item.commissionRate;
}

function resolvedSettlementRate(
  draft: EquipmentSettlementDraft,
  fallback: number | null,
) {
  if (!draft.rateEdited) return draft.sourceRate ?? fallback;
  const percentage = Number(draft.wizupCommissionRateInput);
  return Number.isFinite(percentage) ? percentage / 100 : null;
}

function equipmentRateInput(rate: number | null) {
  return rate === null ? "" : String(Number((rate * 100).toFixed(2)));
}

function isProcurementProduct(
  product: Pick<
    ProductCatalogChoice,
    "name" | "specification" | "note" | "reference"
  >,
) {
  return hasProcurementSignal(
    product.name,
    product.specification,
    product.note,
    product.reference,
  );
}

async function requestEquipmentProjects(organization: string, businessRound = 1) {
  const response = await fetch(
    `/api/equipment?organization=${encodeURIComponent(organization)}&businessRound=${businessRound}`,
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

async function requestEquipmentQuoteSummaries() {
  const response = await fetch("/api/equipment?summary=1", {
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    summaries?: Record<string, unknown>[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "등록 견적 현황을 불러오지 못했습니다.");
  }
  return (payload.summaries ?? [])
    .map((row): EquipmentQuoteSummary => {
      const rawStatus = String(row.quoteStatus ?? row.quote_status ?? "");
      return {
        organization: String(row.organization ?? "").trim(),
        businessRound: Math.max(
          1,
          Number(row.businessRound ?? row.business_round) || 1,
        ),
        projectCount: Math.max(
          0,
          Number(row.projectCount ?? row.project_count) || 0,
        ),
        itemCount: Math.max(0, Number(row.itemCount ?? row.item_count) || 0),
        contractAmountReference: Math.round(
          Number(
            row.contractAmountReference ?? row.contract_amount_reference,
          ) || 0,
        ),
        quoteStatus: (
          rawStatus === "complete" || rawStatus === "partial"
            ? rawStatus
            : "missing"
        ) as EquipmentQuoteStatus,
        quoteItemCount: Math.max(
          0,
          Number(row.quoteItemCount ?? row.quote_item_count) || 0,
        ),
        quoteMissingAmountItemCount: Math.max(
          0,
          Number(
            row.quoteMissingAmountItemCount ??
              row.quote_missing_amount_item_count,
          ) || 0,
        ),
        quoteConstructionCount: Math.max(
          0,
          Number(
            row.quoteConstructionCount ?? row.quote_construction_count,
          ) || 0,
        ),
      };
    })
    .filter((summary) => Boolean(summary.organization));
}

async function requestProductCatalogChoices() {
  const response = await fetch("/api/product-catalog", { cache: "no-store" });
  const payload = (await response.json()) as {
    products?: Record<string, unknown>[];
    favoriteProductIds?: unknown[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "제품 목록을 불러오지 못했습니다.");
  }
  const products = (payload.products ?? [])
    .map((row): ProductCatalogChoice => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      specification: String(row.specification ?? ""),
      unitPrice:
        row.unitPrice === null || row.unitPrice === undefined
          ? null
          : Number(row.unitPrice),
      supplyType: row.supplyType === "direct" ? "direct" : "partner",
      commissionRate:
        row.commissionRate === null || row.commissionRate === undefined
          ? null
          : Number(row.commissionRate),
      marginRate:
        row.marginRate === null || row.marginRate === undefined
          ? null
          : Number(row.marginRate),
      supplierVendorName: String(row.supplierVendorName ?? ""),
      note: String(row.note ?? ""),
      reference: String(row.reference ?? ""),
    }))
    .filter((product) => product.id && product.name);
  return {
    products,
    favoriteProductIds: (payload.favoriteProductIds ?? []).map(String),
  };
}

async function requestProtectionReviewItems() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("/api/equipment?protection=1", {
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = (await response.json()) as {
      items?: Record<string, unknown>[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(
        payload.error || "영업보호 점검 항목을 불러오지 못했습니다.",
      );
    }
    return (payload.items ?? []).map((row): ProtectionReviewItem => ({
      id: Number(row.id),
      projectId: Number(row.project_id ?? row.projectId),
      organization: String(row.organization ?? ""),
      projectName: String(row.project_name ?? row.projectName ?? ""),
      productName: String(row.product_name ?? row.productName ?? ""),
      specification: String(row.specification ?? ""),
      progressManager: String(row.progress_manager ?? row.progressManager ?? ""),
      protectionStatus:
        String(row.protection_status ?? row.protectionStatus) === "신청 완료"
          ? "신청 완료"
          : "신청 필요",
    }));
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function saveAiEquipmentPreview(preview: AiPreview) {
  const response = await fetch("/api/equipment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "ai-import",
      organization: preview.organization,
      businessRound: preview.businessRound,
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
  businessRound = 1,
  budgets = [],
  onToast,
  refreshVersion = 0,
  onEquipmentChanged,
}: {
  organization: string;
  businessRound?: number;
  budgets?: ActivityBudgetAllocation[];
  onToast: (message: string) => void;
  refreshVersion?: number;
  onEquipmentChanged?: () => void;
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
  const [itemSettlementDraft, setItemSettlementDraft] =
    useState<EquipmentSettlementDraft>({ ...emptyEquipmentSettlementDraft });
  const [itemUnitPriceDraft, setItemUnitPriceDraft] = useState("");
  const [itemPriceStatusDraft, setItemPriceStatusDraft] =
    useState<EquipmentPriceStatus>("금액 미입력");
  const [itemProcurementFeeRateDraft, setItemProcurementFeeRateDraft] =
    useState("");
  const [itemCatalogDraft, setItemCatalogDraft] = useState({
    id: "",
    note: "",
  });
  const [itemEntryMode, setItemEntryMode] = useState<
    "catalog" | "manual" | "construction"
  >("catalog");
  const [catalogProducts, setCatalogProducts] = useState<
    ProductCatalogChoice[]
  >([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogFavoriteProductIds, setCatalogFavoriteProductIds] = useState<
    string[]
  >([]);
  const [catalogFavoritesOnly, setCatalogFavoritesOnly] = useState(false);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<string[]>([]);
  const [catalogSettlementDrafts, setCatalogSettlementDrafts] = useState<
    Record<string, EquipmentSettlementDraft>
  >({});
  const [catalogUnitPriceDrafts, setCatalogUnitPriceDrafts] = useState<
    Record<string, string>
  >({});
  const [catalogQuantityDrafts, setCatalogQuantityDrafts] = useState<
    Record<string, string>
  >({});
  const [constructionProjectId, setConstructionProjectId] = useState<
    number | null
  >(null);
  const [constructionAmountDraft, setConstructionAmountDraft] = useState("");
  const [actualConstructionCostDraft, setActualConstructionCostDraft] =
    useState("");
  const [actualConstructionCostCustomized, setActualConstructionCostCustomized] =
    useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void requestEquipmentProjects(organization, businessRound)
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
  }, [businessRound, organization, refreshVersion]);

  const projects =
    equipmentState.organization === organization
      ? equipmentState.projects
      : [];
  const loading = equipmentState.organization !== organization;

  async function refreshEquipment() {
    const nextProjects = await requestEquipmentProjects(organization, businessRound);
    setEquipmentState({ organization, projects: nextProjects, error: "" });
    onEquipmentChanged?.();
    return nextProjects;
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
    return payload;
  }

  async function loadCatalog() {
    if (catalogProducts.length) return catalogProducts;
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const catalog = await requestProductCatalogChoices();
      setCatalogProducts(catalog.products);
      setCatalogFavoriteProductIds(catalog.favoriteProductIds);
      return catalog.products;
    } catch (error) {
      setCatalogError(
        error instanceof Error ? error.message : "제품 목록을 불러오지 못했습니다.",
      );
      return [];
    } finally {
      setCatalogLoading(false);
    }
  }

  function openNewItem(projectId: number) {
    setEditingItemId(null);
    setItemProjectId(projectId);
    setItemEntryMode("catalog");
    setCatalogSearch("");
    setCatalogFavoritesOnly(false);
    setSelectedCatalogIds([]);
    setCatalogSettlementDrafts({});
    setCatalogUnitPriceDrafts({});
    setCatalogQuantityDrafts({});
    setConstructionProjectId(null);
    setConstructionAmountDraft("");
    setActualConstructionCostDraft("");
    setItemDraft({ ...emptyEquipmentItemDraft });
    setItemSettlementDraft({ ...emptyEquipmentSettlementDraft });
    setItemUnitPriceDraft("");
    setItemPriceStatusDraft("금액 미입력");
    setItemProcurementFeeRateDraft("");
    setItemCatalogDraft({ id: "", note: "" });
    void loadCatalog();
  }

  async function openFirstItem() {
    if (busy) return;
    if (projects[0]) {
      openNewItem(projects[0].id);
      return;
    }
    setBusy(true);
    try {
      await equipmentRequest("POST", {
        kind: "ai-import",
        organization,
        businessRound,
        projectName: "품목 관리",
        budgetType: "",
        items: [],
      });
      const nextProjects = await refreshEquipment();
      if (!nextProjects[0]) {
        throw new Error("품목을 등록할 공간을 만들지 못했습니다.");
      }
      openNewItem(nextProjects[0].id);
    } catch (error) {
      onToast(
        error instanceof Error
          ? error.message
          : "품목 등록을 시작하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openItemEdit(item: EquipmentItem) {
    const products = await loadCatalog();
    const linkedProduct = products.find(
      (product) => product.id === item.catalogItemId,
    );
    setEditingItemId(item.id);
    setItemProjectId(item.projectId);
    setItemEntryMode("manual");
    setCatalogSearch("");
    setCatalogFavoritesOnly(false);
    setItemCatalogDraft({
      id: item.catalogItemId,
      note: item.catalogNote,
    });
    setItemDraft({
      productName: linkedProduct?.name ?? item.productName,
      specification: linkedProduct?.specification ?? item.specification,
      proposedQty: equipmentSettlementQuantity(item),
      awardedQty: item.awardedQty,
      installedQty: item.installedQty,
      unit: item.unit,
      status: item.status,
      notes: item.notes,
    });
    setItemSettlementDraft({
      supplyType: item.supplyType,
      executionType: item.executionType,
      wizupCommissionRateInput: equipmentRateInput(equipmentSupplyRate(item)),
      sourceRate: equipmentSupplyRate(item),
      rateEdited: false,
      commissionInputType: item.commissionInputType,
      consortiumInputValue:
        item.executionType !== "컨소"
          ? ""
          : item.commissionInputType === "amount"
            ? formatMoneyInput(String(item.consortiumPaymentAmount ?? ""))
            : item.consortiumCommissionRate === null
              ? ""
              : String(
                  Number((item.consortiumCommissionRate * 100).toFixed(2)),
                ),
    });
    setItemUnitPriceDraft(
      item.catalogUnitPrice === null
        ? ""
        : formatMoneyInput(String(item.catalogUnitPrice)),
    );
    setItemPriceStatusDraft(item.priceStatus);
    const inferredProcurementFeeRate =
      item.procurementFeeRate ??
      (hasProcurementSignal(
        item.productName,
        item.specification,
        item.catalogNote,
        item.notes,
        linkedProduct?.name,
        linkedProduct?.specification,
        linkedProduct?.note,
        linkedProduct?.reference,
      )
        ? DEFAULT_PROCUREMENT_FEE_RATE
        : null);
    setItemProcurementFeeRateDraft(
      inferredProcurementFeeRate === null
        ? ""
        : String(Number((inferredProcurementFeeRate * 100).toFixed(3))),
    );
  }

  const normalizedCatalogSearch = catalogSearch
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "");
  const catalogFavoriteProductIdSet = new Set(catalogFavoriteProductIds);
  const orderedCatalogProducts = [
    ...catalogProducts.filter((product) =>
      catalogFavoriteProductIdSet.has(product.id),
    ),
    ...catalogProducts.filter(
      (product) => !catalogFavoriteProductIdSet.has(product.id),
    ),
  ];
  const visibleCatalogProducts = orderedCatalogProducts
    .filter((product) => {
      if (
        catalogFavoritesOnly &&
        !catalogFavoriteProductIdSet.has(product.id)
      ) {
        return false;
      }
      if (!normalizedCatalogSearch) return true;
      return [
        product.name,
        product.specification,
        product.note,
        product.reference,
      ]
        .join(" ")
        .normalize("NFKC")
        .toLocaleLowerCase("ko-KR")
        .replace(/\s+/g, "")
        .includes(normalizedCatalogSearch);
    });

  function defaultCatalogSettlement(
    product: ProductCatalogChoice,
  ): EquipmentSettlementDraft {
    return {
      supplyType: product.supplyType,
      executionType: "직영",
      wizupCommissionRateInput: equipmentRateInput(catalogSupplyRate(product)),
      sourceRate: catalogSupplyRate(product),
      rateEdited: false,
      commissionInputType: "rate",
      consortiumInputValue: "",
    };
  }

  function isDirectPriceCatalogProduct(product: ProductCatalogChoice) {
    return product.name.replace(/\s+/g, "") === "교구세트";
  }

  function resolvedCatalogUnitPrice(product: ProductCatalogChoice) {
    if (!isDirectPriceCatalogProduct(product)) return product.unitPrice;
    const draft = catalogUnitPriceDrafts[product.id];
    if (draft === undefined) return directEquipmentSetDefaultUnitPrice;
    if (!draft.replace(/[-,\s]/g, "")) return null;
    return parseSignedMoneyAmount(draft);
  }

  function resolvedCatalogQuantity(productId: string) {
    const parsed = Math.round(Number(catalogQuantityDrafts[productId] ?? "1"));
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(9_999, Math.max(1, parsed));
  }

  function applyCatalogProductToEdit(product: ProductCatalogChoice) {
    setItemDraft((current) => ({
      ...current,
      productName: product.name,
      specification: product.specification,
    }));
    setItemUnitPriceDraft(
      product.unitPrice === null
        ? ""
        : formatMoneyInput(String(product.unitPrice)),
    );
    setItemPriceStatusDraft(
      Number(product.unitPrice ?? 0) > 0 ? "입력 완료" : "금액 미입력",
    );
    setItemProcurementFeeRateDraft(
      isProcurementProduct(product)
        ? String(DEFAULT_PROCUREMENT_FEE_RATE * 100)
        : "",
    );
    setItemSettlementDraft((current) => ({
      ...current,
      supplyType: product.supplyType,
      wizupCommissionRateInput: equipmentRateInput(catalogSupplyRate(product)),
      sourceRate: catalogSupplyRate(product),
      rateEdited: false,
    }));
    setItemCatalogDraft({
      id: product.id,
      note: [product.note, product.reference].filter(Boolean).join(" · "),
    });
    onToast(`${product.name} 제품 정보를 수정 화면에 적용했습니다.`);
  }

  function toggleCatalogProduct(product: ProductCatalogChoice) {
    const checked = selectedCatalogIds.includes(product.id);
    setSelectedCatalogIds((current) =>
      checked
        ? current.filter((id) => id !== product.id)
        : [...current, product.id],
    );
    if (!checked && !catalogSettlementDrafts[product.id]) {
      setCatalogSettlementDrafts((current) => ({
        ...current,
        [product.id]: defaultCatalogSettlement(product),
      }));
    }
    setCatalogQuantityDrafts((current) => {
      if (checked) {
        const next = { ...current };
        delete next[product.id];
        return next;
      }
      if (current[product.id] !== undefined) return current;
      return { ...current, [product.id]: "1" };
    });
    if (isDirectPriceCatalogProduct(product)) {
      setCatalogUnitPriceDrafts((current) => {
        if (checked) {
          const next = { ...current };
          delete next[product.id];
          return next;
        }
        if (current[product.id] !== undefined) return current;
        return {
          ...current,
          [product.id]: formatMoneyInput(
            String(directEquipmentSetDefaultUnitPrice),
          ),
        };
      });
    }
  }

  function updateCatalogSettlement(
    product: ProductCatalogChoice,
    patch: Partial<EquipmentSettlementDraft>,
  ) {
    setCatalogSettlementDrafts((current) => ({
      ...current,
      [product.id]: {
        ...(current[product.id] ?? defaultCatalogSettlement(product)),
        ...patch,
      },
    }));
  }

  async function addCatalogItems() {
    if (!itemProjectId || !selectedCatalogIds.length || busy) return;
    const selected = catalogProducts.filter((product) =>
      selectedCatalogIds.includes(product.id),
    );
    const invalid = selected.find((product) => {
      const settlement =
        catalogSettlementDrafts[product.id] ?? defaultCatalogSettlement(product);
      const quantity = resolvedCatalogQuantity(product.id);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9_999) {
        return true;
      }
      const wizupRateInput = settlement.wizupCommissionRateInput.trim();
      const supplyRate = resolvedSettlementRate(
        settlement,
        catalogSupplyRate(product),
      );
      const wizupRate = Number(supplyRate) * 100;
      if (
        !wizupRateInput ||
        supplyRate === null ||
        !Number.isFinite(wizupRate) ||
        wizupRate < 0 ||
        wizupRate > 100
      ) {
        return true;
      }
      if (settlement.executionType !== "컨소") return false;
      const consortiumValue =
        settlement.commissionInputType === "amount"
          ? parseMoneyAmount(settlement.consortiumInputValue)
          : Number(settlement.consortiumInputValue);
      const unitPrice = resolvedCatalogUnitPrice(product);
      const wizupCommission = (unitPrice ?? 0) * quantity * (wizupRate / 100);
      return !Number.isFinite(consortiumValue) || consortiumValue <= 0 ||
        (settlement.commissionInputType === "rate" &&
          consortiumValue > wizupRate) ||
        (settlement.commissionInputType === "amount" &&
          unitPrice !== null && consortiumValue > wizupCommission);
    });
    if (invalid) {
      onToast(
        catalogSupplyRate(invalid) === null
          ? `${invalid.name}은 제품·견적 관리에서 ${invalid.supplyType === "direct" ? "마진율" : "수수료율"}을 먼저 등록해 주세요.`
          : `${invalid.name}의 컨소 지급값을 확인해 주세요.`,
      );
      return;
    }
    setBusy(true);
    try {
      const result = await equipmentRequest("POST", {
        kind: "catalog-items",
        projectId: itemProjectId,
        items: selected.map((product) => {
          const settlement =
            catalogSettlementDrafts[product.id] ??
            defaultCatalogSettlement(product);
          const supplyRate = resolvedSettlementRate(
            settlement,
            catalogSupplyRate(product),
          );
          return {
            catalogItemId: product.id,
            productName: product.name,
            specification: product.specification,
            proposedQty: resolvedCatalogQuantity(product.id),
            catalogUnitPrice: resolvedCatalogUnitPrice(product),
            catalogNote: [product.note, product.reference]
              .filter(Boolean)
              .join(" · "),
            executionType: settlement.executionType,
            commissionInputType: settlement.commissionInputType,
            supplyType: product.supplyType,
            commissionRate:
              product.supplyType === "partner" ? supplyRate : null,
            marginRate:
              product.supplyType === "direct" ? supplyRate : null,
            procurementFeeRate: isProcurementProduct(product)
              ? DEFAULT_PROCUREMENT_FEE_RATE
              : null,
            consortiumCommissionRate:
              settlement.executionType === "컨소" &&
              settlement.commissionInputType === "rate"
                ? Number(settlement.consortiumInputValue) / 100
                : null,
            consortiumPaymentAmount:
              settlement.executionType === "컨소" &&
              settlement.commissionInputType === "amount"
                ? parseMoneyAmount(settlement.consortiumInputValue)
                : null,
          };
        }),
      });
      await refreshEquipment();
      setItemProjectId(null);
      setSelectedCatalogIds([]);
      setCatalogSettlementDrafts({});
      setCatalogUnitPriceDrafts({});
      setCatalogQuantityDrafts({});
      const added = Number((result as { added?: unknown }).added ?? 0);
      const skipped = Number((result as { skipped?: unknown }).skipped ?? 0);
      onToast(
        skipped
          ? `${added}개 품목을 추가했고, 이미 있는 ${skipped}개는 제외했습니다.`
          : `${added}개 품목을 추가했습니다.`,
      );
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "제품을 추가하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateProtection(item: EquipmentItem) {
    if (busy) return;
    const nextStatus =
      item.protectionStatus === "신청 완료" ? "신청 필요" : "신청 완료";
    setBusy(true);
    try {
      await equipmentRequest("PUT", {
        kind: "protection",
        id: item.id,
        protectionStatus: nextStatus,
      });
      await refreshEquipment();
      onToast(`영업보호를 ${nextStatus}로 변경했습니다.`);
    } catch (error) {
      onToast(
        error instanceof Error
          ? error.message
          : "영업보호 상태를 변경하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    if (!itemProjectId || !itemDraft.productName.trim() || busy) return;
    const editingItem = projects
      .flatMap((project) => project.items)
      .find((item) => item.id === editingItemId);
    const selectedCatalogProduct = catalogProducts.find(
      (product) => product.id === itemCatalogDraft.id,
    );
    const fallbackRate = editingItem
      ? equipmentSupplyRate(editingItem)
      : selectedCatalogProduct
        ? catalogSupplyRate(selectedCatalogProduct)
        : null;
    const wizupRateInput = itemSettlementDraft.wizupCommissionRateInput.trim();
    const supplyRate = resolvedSettlementRate(
      itemSettlementDraft,
      fallbackRate,
    );
    const wizupRate = Number(supplyRate) * 100;
    if (
      !wizupRateInput ||
      supplyRate === null ||
      !Number.isFinite(wizupRate) ||
      wizupRate < 0 ||
      wizupRate > 100
    ) {
      onToast(
        itemSettlementDraft.supplyType === "direct"
          ? "위즈업 직접 공급 마진율을 확인해 주세요."
          : "협력사 수수료율을 확인해 주세요.",
      );
      return;
    }
    const consortiumValue =
      itemSettlementDraft.commissionInputType === "amount"
        ? parseMoneyAmount(itemSettlementDraft.consortiumInputValue)
        : Number(itemSettlementDraft.consortiumInputValue);
    if (
      itemSettlementDraft.executionType === "컨소" &&
      (!Number.isFinite(consortiumValue) || consortiumValue <= 0 ||
        (itemSettlementDraft.commissionInputType === "rate" &&
          consortiumValue > wizupRate))
    ) {
      onToast(
        `컨소 지급률은 ${itemSettlementDraft.supplyType === "direct" ? "마진율" : "수수료율"}보다 클 수 없습니다.`,
      );
      return;
    }
    const unitPrice = parseSignedMoneyAmount(itemUnitPriceDraft);
    const settlementQuantity = equipmentSettlementQuantity(itemDraft);
    if (
      itemSettlementDraft.executionType === "컨소" &&
      itemSettlementDraft.commissionInputType === "amount" &&
      unitPrice > 0 &&
      consortiumValue > unitPrice * settlementQuantity * (wizupRate / 100)
    ) {
      onToast("컨소 지급은 위즈업의 예상 품목수익을 넘을 수 없습니다.");
      return;
    }
    setBusy(true);
    try {
      await equipmentRequest(editingItemId ? "PUT" : "POST", {
        kind: "item",
        id: editingItemId ?? undefined,
        projectId: itemProjectId,
        ...itemDraft,
        catalogItemId: itemCatalogDraft.id,
        catalogUnitPrice: itemUnitPriceDraft.trim() ? unitPrice : null,
        priceStatus: itemUnitPriceDraft.trim()
          ? "입력 완료"
          : itemPriceStatusDraft,
        catalogNote: itemCatalogDraft.note,
        procurementFeeRate: itemProcurementFeeRateDraft
          ? Number(itemProcurementFeeRateDraft) / 100
          : null,
        executionType: itemSettlementDraft.executionType,
        commissionInputType: itemSettlementDraft.commissionInputType,
        supplyType: itemSettlementDraft.supplyType,
        commissionRate:
          itemSettlementDraft.supplyType === "partner" ? supplyRate : null,
        marginRate:
          itemSettlementDraft.supplyType === "direct" ? supplyRate : null,
        consortiumCommissionRate:
          itemSettlementDraft.executionType === "컨소" &&
          itemSettlementDraft.commissionInputType === "rate"
            ? consortiumValue / 100
            : null,
        consortiumPaymentAmount:
          itemSettlementDraft.executionType === "컨소" &&
          itemSettlementDraft.commissionInputType === "amount"
            ? consortiumValue
            : null,
      });
      await refreshEquipment();
      setItemProjectId(null);
      setEditingItemId(null);
      setItemDraft({ ...emptyEquipmentItemDraft });
      setItemSettlementDraft({ ...emptyEquipmentSettlementDraft });
      setItemUnitPriceDraft("");
      setItemPriceStatusDraft("금액 미입력");
      setItemProcurementFeeRateDraft("");
      setItemCatalogDraft({ id: "", note: "" });
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

  function openConstructionEditor(project: EquipmentProject) {
    const constructionAmount =
      project.constructionAmount === null
        ? "0"
        : formatMoneyInput(String(project.constructionAmount));
    const actualConstructionCost =
      project.actualConstructionCost === null
        ? constructionAmount
        : formatMoneyInput(String(project.actualConstructionCost));
    setConstructionProjectId(project.id);
    setConstructionAmountDraft(constructionAmount);
    setActualConstructionCostDraft(actualConstructionCost);
    setActualConstructionCostCustomized(
      project.actualConstructionCost !== null &&
        project.actualConstructionCost !== project.constructionAmount,
    );
  }

  async function saveConstructionCosts(event: FormEvent) {
    event.preventDefault();
    if (!constructionProjectId || busy) return;
    setBusy(true);
    try {
      await equipmentRequest("PUT", {
        kind: "project-costs",
        id: constructionProjectId,
        constructionAmount: constructionAmountDraft
          ? parseSignedMoneyAmount(constructionAmountDraft)
          : null,
        actualConstructionCost: actualConstructionCostDraft
          ? parseSignedMoneyAmount(actualConstructionCostDraft)
          : null,
      });
      await refreshEquipment();
      setConstructionProjectId(null);
      setConstructionAmountDraft("");
      setActualConstructionCostDraft("");
      setActualConstructionCostCustomized(false);
      setItemProjectId(null);
      setItemEntryMode("catalog");
      onToast("공사비를 저장했습니다.");
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "공사비를 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  function closeConstructionEditor() {
    setConstructionProjectId(null);
    setConstructionAmountDraft("");
    setActualConstructionCostDraft("");
    setActualConstructionCostCustomized(false);
    setItemProjectId(null);
    setItemEntryMode("catalog");
  }

  function renderConstructionForm() {
    return (
      <form
        className="equipment-construction-form equipment-construction-form-tab"
        onSubmit={saveConstructionCosts}
      >
        <div>
          <strong>공사비</strong>
          <span>공사에는 컨소 계산을 적용하지 않습니다. 차감 금액은 -로 입력할 수 있습니다.</span>
        </div>
        <label>
          <span>견적 공사비</span>
          <div className="equipment-money-field">
            <input
              inputMode="text"
              value={constructionAmountDraft}
              onChange={(event) => {
                const nextAmount = formatMoneyInput(
                  event.target.value.replace(/(?!^-)[^\d,]/g, ""),
                );
                setConstructionAmountDraft(nextAmount);
                if (!actualConstructionCostCustomized) {
                  setActualConstructionCostDraft(nextAmount);
                }
              }}
              placeholder="0"
            />
            <i>원</i>
          </div>
        </label>
        <label>
          <span>실공사비</span>
          <div className="equipment-money-field">
            <input
              inputMode="text"
              value={actualConstructionCostDraft}
              onChange={(event) => {
                setActualConstructionCostCustomized(true);
                setActualConstructionCostDraft(
                  formatMoneyInput(
                    event.target.value.replace(/(?!^-)[^\d,]/g, ""),
                  ),
                );
              }}
              placeholder="0"
            />
            <i>원</i>
          </div>
        </label>
        <div className="equipment-construction-margin">
          <span>공사 마진</span>
          <strong>
            {(parseSignedMoneyAmount(constructionAmountDraft) -
              parseSignedMoneyAmount(actualConstructionCostDraft)
            ).toLocaleString("ko-KR")}원
          </strong>
        </div>
        <div className="equipment-form-actions">
          <button type="button" onClick={closeConstructionEditor}>취소</button>
          <button type="submit" className="equipment-save" disabled={busy}>
            {busy ? "저장 중…" : "공사비 저장"}
          </button>
        </div>
      </form>
    );
  }

  function closeItemEditor() {
    setItemProjectId(null);
    setEditingItemId(null);
    setItemSettlementDraft({ ...emptyEquipmentSettlementDraft });
    setItemUnitPriceDraft("");
    setItemPriceStatusDraft("금액 미입력");
    setItemProcurementFeeRateDraft("");
    setItemCatalogDraft({ id: "", note: "" });
    setCatalogUnitPriceDrafts({});
    setConstructionProjectId(null);
    setConstructionAmountDraft("");
    setActualConstructionCostDraft("");
    setActualConstructionCostCustomized(false);
  }

  function currentEquipmentDraftFinance() {
    const editingItem = projects
      .flatMap((project) => project.items)
      .find((item) => item.id === editingItemId);
    const selectedCatalogProduct = catalogProducts.find(
      (product) => product.id === itemCatalogDraft.id,
    );
    const supplyRate = resolvedSettlementRate(
      itemSettlementDraft,
      editingItem
        ? equipmentSupplyRate(editingItem)
        : selectedCatalogProduct
          ? catalogSupplyRate(selectedCatalogProduct)
          : null,
    );
    const consortiumInput =
      itemSettlementDraft.commissionInputType === "amount"
        ? parseMoneyAmount(itemSettlementDraft.consortiumInputValue)
        : Number(itemSettlementDraft.consortiumInputValue);
    return calculateEquipmentFinance({
      unitPrice: parseMoneyAmount(itemUnitPriceDraft),
      quantity: equipmentSettlementQuantity(itemDraft),
      executionType: itemSettlementDraft.executionType,
      commissionInputType: itemSettlementDraft.commissionInputType,
      supplyType: itemSettlementDraft.supplyType,
      commissionRate:
        itemSettlementDraft.supplyType === "partner" ? supplyRate : null,
      marginRate:
        itemSettlementDraft.supplyType === "direct" ? supplyRate : null,
      procurementFeeRate: itemProcurementFeeRateDraft
        ? Number(itemProcurementFeeRateDraft) / 100
        : null,
      consortiumCommissionRate:
        itemSettlementDraft.executionType === "컨소" &&
        itemSettlementDraft.commissionInputType === "rate" &&
        Number.isFinite(consortiumInput)
          ? consortiumInput / 100
          : null,
      consortiumPaymentAmount:
        itemSettlementDraft.executionType === "컨소" &&
        itemSettlementDraft.commissionInputType === "amount"
          ? consortiumInput
          : null,
    });
  }

  function renderSettlementCalculation() {
    const finance = currentEquipmentDraftFinance();
    return (
      <div className="equipment-settlement-calculation">
        <span>
          견적 합계 <b>{finance.quotationAmount.toLocaleString("ko-KR")}원</b>
        </span>
        {finance.procurementFee > 0 && (
          <span>
            조달 수수료 <b>{finance.procurementFee.toLocaleString("ko-KR")}원</b>
          </span>
        )}
        <span>
          {itemSettlementDraft.supplyType === "direct"
            ? "직접 공급 예상 마진"
            : "협력사 예상 수수료"}{" "}
          <b>
            {(itemSettlementDraft.supplyType === "direct"
              ? finance.expectedDirectMargin
              : finance.expectedPartnerCommission
            ).toLocaleString("ko-KR")}원
          </b>
        </span>
        <span>
          컨소 지급 <b>{finance.consortiumPayment.toLocaleString("ko-KR")}원</b>
        </span>
        <span>
          마진 <b>{finance.marginAmount.toLocaleString("ko-KR")}원</b>
        </span>
      </div>
    );
  }

  function renderEquipmentItemForm() {

    return (
      <form className="equipment-item-form" onSubmit={saveItem}>
        {editingItemId && (
          <div className="equipment-edit-heading">
            <strong>{itemDraft.productName} 수정</strong>
            <span>이 품목의 금액과 수수료·마진을 바로 수정합니다.</span>
          </div>
        )}
        {editingItemId && (
          <div className="equipment-edit-catalog">
            <div className="equipment-edit-catalog-heading">
              <div>
                <strong>제품 목록에서 변경</strong>
                <span>제품을 선택하면 품목명·규격·단가·공급 구분·비율이 적용됩니다.</span>
              </div>
              <b>{catalogProducts.length.toLocaleString("ko-KR")}개 제품</b>
            </div>
            <input
              className="equipment-edit-catalog-search"
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
              placeholder="제품명, 규격, 모델명 검색"
              aria-label="수정할 제품 검색"
            />
            <button
              type="button"
              className={`equipment-catalog-favorites-filter equipment-edit-catalog-filter ${
                catalogFavoritesOnly ? "active" : ""
              }`.trim()}
              aria-pressed={catalogFavoritesOnly}
              onClick={() => setCatalogFavoritesOnly((current) => !current)}
            >
              ★ 즐겨찾기만 {catalogFavoriteProductIds.length}
            </button>
            {catalogLoading ? (
              <p className="equipment-edit-catalog-message">제품 목록을 불러오고 있습니다…</p>
            ) : catalogError ? (
              <p className="equipment-edit-catalog-message error">{catalogError}</p>
            ) : visibleCatalogProducts.length ? (
              <div className="equipment-edit-catalog-list">
                {visibleCatalogProducts.map((product) => {
                  const selected = itemCatalogDraft.id === product.id;
                  return (
                    <button
                      type="button"
                      className={selected ? "selected" : ""}
                      key={product.id}
                      onClick={() => applyCatalogProductToEdit(product)}
                    >
                      <span>
                        <strong>{product.name}</strong>
                        <small>{product.specification || product.note || "규격 정보 없음"}</small>
                      </span>
                      <b>
                        {product.unitPrice === null
                          ? "단가 미등록"
                          : `${product.unitPrice.toLocaleString("ko-KR")}원`}
                      </b>
                      <em>{selected ? "적용됨" : "선택"}</em>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="equipment-edit-catalog-message">검색 결과가 없습니다.</p>
            )}
          </div>
        )}
        <label className="equipment-product-field">
          <span>품목명 *</span>
          <input
            required
            value={itemDraft.productName}
            onChange={(event) =>
              setItemDraft({ ...itemDraft, productName: event.target.value })
            }
            placeholder="예: 전자칠판 86인치"
          />
        </label>
        <label className="equipment-spec-field">
          <span>규격·모델</span>
          <input
            value={itemDraft.specification}
            onChange={(event) =>
              setItemDraft({ ...itemDraft, specification: event.target.value })
            }
            placeholder="모델명 또는 규격"
          />
        </label>
        <label className="equipment-price-field">
          <span>제품 단가</span>
          <div className="equipment-money-field">
            <input
              inputMode="text"
              value={itemUnitPriceDraft}
              onChange={(event) =>
                setItemUnitPriceDraft(
                  formatMoneyInput(
                    event.target.value.replace(/(?!^-)[^\d,]/g, ""),
                  ),
                )
              }
              placeholder="0"
            />
            <i>원</i>
          </div>
        </label>
        <label className="equipment-price-status-field">
          <span>0원 품목 구분</span>
          <select
            value={itemUnitPriceDraft.trim() ? "입력 완료" : itemPriceStatusDraft}
            disabled={Boolean(itemUnitPriceDraft.trim())}
            onChange={(event) =>
              setItemPriceStatusDraft(event.target.value as EquipmentPriceStatus)
            }
          >
            <option value="금액 미입력">금액 미입력</option>
            <option value="무상 제공">무상 제공</option>
            <option value="계약금액에 포함">계약금액에 포함</option>
            <option value="서비스 품목">서비스 품목</option>
          </select>
          <small>실제 단가가 없는 경우에만 구분해 주세요.</small>
        </label>
        <label className="equipment-quantity-field">
          <span>수량</span>
          <input
            type="number"
            min="1"
            value={itemDraft.proposedQty}
            onChange={(event) =>
              setItemDraft({
                ...itemDraft,
                proposedQty: Math.max(1, Number(event.target.value) || 1),
              })
            }
          />
        </label>
        <label className="equipment-procurement-fee-field">
          <span>조달 수수료율</span>
          <div className="equipment-money-field">
            <input
              inputMode="decimal"
              value={itemProcurementFeeRateDraft}
              onChange={(event) =>
                setItemProcurementFeeRateDraft(
                  event.target.value.replace(/[^\d.]/g, ""),
                )
              }
              placeholder="조달 제품 자동 0.54"
            />
            <i>%</i>
          </div>
          <small>G2B·S2B 제품은 0.54%가 자동 적용됩니다.</small>
        </label>
        <label className="equipment-wizup-commission-field">
          <span>
            {itemSettlementDraft.supplyType === "direct"
              ? "위즈업 직접 공급 마진율"
              : "협력사 수수료율"}
          </span>
          <div className="equipment-money-field">
            <input
              inputMode="decimal"
              min="0"
              max="100"
              step="0.01"
              value={itemSettlementDraft.wizupCommissionRateInput}
              onChange={(event) => {
                const next = event.target.value.replace(",", ".");
                if (!/^\d{0,3}(?:\.\d{0,2})?$/.test(next)) return;
                setItemSettlementDraft({
                  ...itemSettlementDraft,
                  wizupCommissionRateInput: next,
                  rateEdited: true,
                });
              }}
              placeholder="0"
            />
            <i>%</i>
          </div>
          {Boolean(itemCatalogDraft.id) && (
            <small>
              제품 DB의 기본 {itemSettlementDraft.supplyType === "direct" ? "마진율" : "수수료율"}입니다.
              필요하면 0%를 포함해 수정할 수 있습니다.
            </small>
          )}
        </label>
        <label className="equipment-supply-type-field">
          <span>공급 구분</span>
          <select
            value={itemSettlementDraft.supplyType}
            disabled={Boolean(itemCatalogDraft.id)}
            onChange={(event) =>
              setItemSettlementDraft({
                ...itemSettlementDraft,
                supplyType:
                  event.target.value === "direct" ? "direct" : "partner",
              })
            }
          >
            <option value="partner">협력사 공급</option>
            <option value="direct">위즈업 직접 공급</option>
          </select>
          {Boolean(itemCatalogDraft.id) && (
            <small>제품 기준정보의 공급 구분이 적용됩니다.</small>
          )}
        </label>
        <label className="equipment-execution-field">
          <span>사업방식</span>
          <select
            value={itemSettlementDraft.executionType}
            onChange={(event) =>
              setItemSettlementDraft({
                ...itemSettlementDraft,
                executionType: event.target.value === "컨소" ? "컨소" : "직영",
              })
            }
          >
            <option value="직영">직영</option>
            <option value="컨소">컨소</option>
          </select>
        </label>
        {itemSettlementDraft.executionType === "컨소" && (
          <>
            <label className="equipment-commission-type-field">
              <span>컨소 지급방식</span>
              <select
                value={itemSettlementDraft.commissionInputType}
                onChange={(event) =>
                  setItemSettlementDraft({
                    ...itemSettlementDraft,
                    commissionInputType:
                      event.target.value === "amount" ? "amount" : "rate",
                    consortiumInputValue: "",
                  })
                }
              >
                <option value="rate">퍼센트</option>
                <option value="amount">금액</option>
              </select>
            </label>
            <label className="equipment-commission-value-field">
              <span>
                {itemSettlementDraft.commissionInputType === "rate"
                  ? "컨소 지급률"
                  : "컨소 지급"}
              </span>
              <div className="equipment-money-field">
                <input
                  inputMode="decimal"
                  value={itemSettlementDraft.consortiumInputValue}
                  onChange={(event) =>
                    setItemSettlementDraft({
                      ...itemSettlementDraft,
                      consortiumInputValue:
                        itemSettlementDraft.commissionInputType === "amount"
                          ? formatMoneyInput(
                              event.target.value.replace(/[^\d,]/g, ""),
                            )
                          : event.target.value.replace(/[^\d.]/g, ""),
                    })
                  }
                  placeholder="0"
                />
                <i>
                  {itemSettlementDraft.commissionInputType === "rate" ? "%" : "원"}
                </i>
              </div>
            </label>
          </>
        )}
        {renderSettlementCalculation()}
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
          <button type="button" onClick={closeItemEditor}>취소</button>
          <button type="submit" className="equipment-save" disabled={busy}>
            {busy ? "저장 중…" : editingItemId ? "품목 수정" : "품목 추가"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <section className="equipment-section">
      <div className="history-section-heading equipment-section-heading">
        <div>
          <span className="section-kicker">EQUIPMENT MANAGEMENT</span>
          <h3>품목 관리</h3>
          <p>기관에 제안·수주·설치할 품목과 공사비를 관리합니다.</p>
        </div>
      </div>

      {loading ? (
        <div className="equipment-empty">품목을 불러오고 있습니다…</div>
      ) : equipmentState.error ? (
        <div className="equipment-empty error">{equipmentState.error}</div>
      ) : projects.length === 0 ? (
        <div className="equipment-empty">
          <strong>등록된 품목이 없습니다.</strong>
          <p>필요한 품목을 제품 목록에서 선택하거나 직접 입력해 주세요.</p>
          <button type="button" disabled={busy} onClick={() => void openFirstItem()}>
            {busy ? "준비 중…" : "+ 품목 추가"}
          </button>
        </div>
      ) : (
        <div className="equipment-project-list">
          {projects.map((project, projectIndex) => {
            const protectionPendingKinds = project.items.filter(
              (item) => item.protectionStatus === "신청 필요",
            ).length;
            const projectFinance = project.items.reduce(
              (total, item) => {
                const finance = storedEquipmentFinance(item);
                return {
                  totalAmount: total.totalAmount + finance.totalAmount,
                  procurementFee:
                    total.procurementFee + finance.procurementFee,
                  quotationAmount:
                    total.quotationAmount + finance.quotationAmount,
                  expectedPartnerCommission:
                    total.expectedPartnerCommission +
                    finance.expectedPartnerCommission,
                  expectedDirectMargin:
                    total.expectedDirectMargin + finance.expectedDirectMargin,
                  consortiumPayment:
                    total.consortiumPayment + finance.consortiumPayment,
                  marginAmount: total.marginAmount + finance.marginAmount,
                };
              },
              {
                totalAmount: 0,
                procurementFee: 0,
                quotationAmount: 0,
                expectedPartnerCommission: 0,
                expectedDirectMargin: 0,
                consortiumPayment: 0,
                marginAmount: 0,
              },
            );
            const {
              constructionAmount,
              actualConstructionCost,
              constructionMargin,
            } = calculateConstructionFinance(project);
            const projectQuotationAmount =
              projectFinance.quotationAmount + constructionAmount;
            const projectMarginAmount =
              projectFinance.marginAmount + constructionMargin;
            const projectMarginRate = projectQuotationAmount
              ? (projectMarginAmount / projectQuotationAmount) * 100
              : 0;
            const linkedBudget = budgets.find((budget) =>
              (project.budgetGroupId && budget.budgetGroupId === project.budgetGroupId)
              || equipmentBudgetKey(budget.budgetType || budget.budgetOriginalName)
                === equipmentBudgetKey(project.budgetType || project.budgetOriginalName || project.name));
            const linkedBudgetAmount = parseMoneyAmount(
              linkedBudget?.budgetAmountOverride
                || linkedBudget?.budgetInstitutionAmount
                || linkedBudget?.budgetAmount
                || "",
            );
            const remainingBudget = linkedBudgetAmount - projectQuotationAmount;
            return (
              <article className="equipment-project-card" key={project.id}>
                <header>
                  <div className="equipment-project-title">
                    <span className="equipment-budget-order">{projectIndex + 1}번째 예산</span>
                    <div>
                      <h4>{project.budgetType || project.name || "예산 미지정"}</h4>
                      <p>{project.items.length}개 품목 · 공사비 포함 개별 예산 관리</p>
                    </div>
                  </div>
                </header>
                <div className="equipment-project-summary">
                  <span>총예산 <b>{linkedBudgetAmount > 0 ? `${linkedBudgetAmount.toLocaleString("ko-KR")}원` : "금액 미입력"}</b></span>
                  <span>품목·공사비 합계 <b>{projectQuotationAmount.toLocaleString("ko-KR")}원</b></span>
                  <span className={linkedBudgetAmount > 0 && remainingBudget < 0 ? "budget-over" : ""}>남은 예산 <b>{linkedBudgetAmount > 0 ? `${remainingBudget.toLocaleString("ko-KR")}원` : "계산 전"}</b></span>
                  <span className={protectionPendingKinds ? "needs-protection" : ""}>
                    {protectionPendingKinds ? (
                      <>영업보호 <b>{protectionPendingKinds}</b>건 필요</>
                    ) : (
                      "영업보호 확인 완료"
                    )}
                  </span>
                </div>
                {(project.items.length > 0 || constructionAmount !== 0) && (
                  <div className="equipment-finance-summary">
                    <div>
                      <span>총 견적금액</span>
                      <strong>{projectQuotationAmount.toLocaleString("ko-KR")}원</strong>
                    </div>
                    <div>
                      <span>조달 수수료</span>
                      <strong>{projectFinance.procurementFee.toLocaleString("ko-KR")}원</strong>
                    </div>
                    <div>
                      <span>협력사 예상 수수료</span>
                      <strong>{projectFinance.expectedPartnerCommission.toLocaleString("ko-KR")}원</strong>
                    </div>
                    <div>
                      <span>직접 공급 예상 마진</span>
                      <strong>{projectFinance.expectedDirectMargin.toLocaleString("ko-KR")}원</strong>
                    </div>
                    <div>
                      <span>총 컨소 지급</span>
                      <strong>{projectFinance.consortiumPayment.toLocaleString("ko-KR")}원</strong>
                    </div>
                    <div className="margin">
                      <span>총 마진</span>
                      <strong>{projectMarginAmount.toLocaleString("ko-KR")}원</strong>
                      <small>마진율 {projectMarginRate.toFixed(1)}%</small>
                    </div>
                  </div>
                )}

                {constructionProjectId !== project.id &&
                (constructionAmount !== 0 || actualConstructionCost !== 0) ? (
                  <div className="equipment-construction-summary">
                    <span>공사비 <b>{constructionAmount.toLocaleString("ko-KR")}원</b></span>
                    <span>실공사비 <b>{actualConstructionCost.toLocaleString("ko-KR")}원</b></span>
                    <span>공사 마진 <b>{constructionMargin.toLocaleString("ko-KR")}원</b></span>
                  </div>
                ) : null}

                <div className="equipment-item-head">
                  <span>품목·규격</span>
                  <span>영업보호</span>
                  <span />
                </div>
                <div className="equipment-item-list">
                  {project.items.length === 0 && (
                    <p className="equipment-no-items">
                      품목을 추가하면 금액과 마진이 여기에 표시됩니다.
                    </p>
                  )}
                  {project.items.map((item) => {
                    const finance = storedEquipmentFinance(item);
                    return (
                    <Fragment key={item.id}>
                    <div className={`equipment-item-row ${
                      editingItemId === item.id ? "editing" : ""
                    }`}>
                      <div className="equipment-item-name">
                        <strong>{item.productName}</strong>
                        <small className="equipment-item-budget">연결 예산 · {project.budgetType || project.name || "예산 미지정"}</small>
                        {(item.specification ||
                          item.catalogNote ||
                          item.catalogUnitPrice !== null ||
                          item.notes) && (
                          <small>
                            {[
                              item.specification,
                              item.catalogNote,
                              item.catalogUnitPrice === null
                                ? ""
                                : `${item.catalogUnitPrice.toLocaleString("ko-KR")}원`,
                              item.notes,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        )}
                        <div className="equipment-item-settlement">
                          <span>{item.executionType}</span>
                          <span>
                            {item.supplyType === "direct"
                              ? "위즈업 직접 공급"
                              : "협력사 공급"}
                          </span>
                          <span>
                            {equipmentSupplyRate(item) === null
                              ? `${item.supplyType === "direct" ? "마진율" : "수수료율"} 미등록`
                              : `${item.supplyType === "direct" ? "마진율" : "수수료율"} ${equipmentRateInput(equipmentSupplyRate(item))}%`}
                          </span>
                          {item.executionType === "컨소" && (
                            <>
                              <span>
                                {item.commissionInputType === "amount"
                                  ? `금액 입력 ${Number(
                                      item.consortiumPaymentAmount ?? 0,
                                    ).toLocaleString("ko-KR")}원`
                                  : `컨소 지급률 ${Number(
                                      (item.consortiumCommissionRate ?? 0) * 100,
                                    ).toFixed(1)}%`}
                              </span>
                              <span>
                                컨소 지급 {finance.consortiumPayment.toLocaleString("ko-KR")}원
                              </span>
                            </>
                          )}
                          <span>
                            {item.supplyType === "direct"
                              ? `예상 마진 ${finance.expectedDirectMargin.toLocaleString("ko-KR")}원`
                              : `예상 수수료 ${finance.expectedPartnerCommission.toLocaleString("ko-KR")}원`}
                          </span>
                          {finance.procurementFee > 0 && (
                            <span>
                              조달 수수료 {finance.procurementFee.toLocaleString("ko-KR")}원
                            </span>
                          )}
                          <b>마진 {finance.marginAmount.toLocaleString("ko-KR")}원</b>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`equipment-protection ${
                          item.protectionStatus === "신청 완료" ? "complete" : "pending"
                        }`}
                        disabled={busy}
                        onClick={() => void updateProtection(item)}
                      >
                        {item.protectionStatus}
                      </button>
                      <div className="equipment-item-actions">
                        <button
                          type="button"
                          onClick={() => void openItemEdit(item)}
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
                    {editingItemId === item.id && itemProjectId === project.id && (
                      <div className="equipment-entry-panel equipment-entry-panel-inline">
                        {renderEquipmentItemForm()}
                      </div>
                    )}
                    </Fragment>
                    );
                  })}
                </div>

                {itemProjectId === project.id && editingItemId === null ? (
                  <div
                    className="equipment-entry-panel"
                    id={`equipment-item-editor-${project.id}`}
                  >
                    <div className="equipment-entry-budget-context">
                      <span>{projectIndex + 1}번째 예산</span>
                      <strong>{project.budgetType || project.name || "예산 미지정"}</strong>
                      <small>이 영역에서 저장한 품목과 공사비는 이 예산에만 연결됩니다.</small>
                    </div>
                    <>
                      <div className="equipment-entry-tabs">
                        <button
                          type="button"
                          className={itemEntryMode === "catalog" ? "active" : ""}
                          onClick={() => {
                            setItemEntryMode("catalog");
                            setConstructionProjectId(null);
                            setConstructionAmountDraft("");
                            setActualConstructionCostDraft("");
                            void loadCatalog();
                          }}
                        >
                          제품 목록에서 선택
                        </button>
                        <button
                          type="button"
                          className={itemEntryMode === "manual" ? "active" : ""}
                          onClick={() => {
                            setItemEntryMode("manual");
                            setConstructionProjectId(null);
                            setConstructionAmountDraft("");
                            setActualConstructionCostDraft("");
                          }}
                        >
                          직접 입력
                        </button>
                        <button
                          type="button"
                          className={itemEntryMode === "construction" ? "active" : ""}
                          onClick={() => {
                            setItemEntryMode("construction");
                            openConstructionEditor(project);
                          }}
                        >
                          공사비 입력
                        </button>
                      </div>
                    </>
                    {itemEntryMode === "catalog" ? (
                      <div className="equipment-catalog-picker">
                        <div className="equipment-catalog-search">
                          <input
                            value={catalogSearch}
                            onChange={(event) => setCatalogSearch(event.target.value)}
                            placeholder="제품명·업체명·규격·조달번호 검색"
                            autoFocus
                          />
                          <button
                            type="button"
                            className={`equipment-catalog-favorites-filter ${
                              catalogFavoritesOnly ? "active" : ""
                            }`.trim()}
                            aria-pressed={catalogFavoritesOnly}
                            onClick={() =>
                              setCatalogFavoritesOnly((current) => !current)
                            }
                          >
                            ★ 즐겨찾기만 {catalogFavoriteProductIds.length}
                          </button>
                          <span>
                            {selectedCatalogIds.length
                              ? `${selectedCatalogIds.length}개 선택`
                              : `${catalogProducts.length}개 제품`}
                          </span>
                        </div>
                        {catalogLoading ? (
                          <p className="equipment-catalog-message">
                            제품 목록을 불러오고 있습니다…
                          </p>
                        ) : catalogError ? (
                          <p className="equipment-catalog-message error">
                            {catalogError}
                          </p>
                        ) : (
                          <div className="equipment-catalog-results">
                            {visibleCatalogProducts.map((product) => {
                              const checked = selectedCatalogIds.includes(product.id);
                              const settlement =
                                catalogSettlementDrafts[product.id] ??
                                defaultCatalogSettlement(product);
                              const inputAmount =
                                settlement.commissionInputType === "amount"
                                  ? parseMoneyAmount(settlement.consortiumInputValue)
                                  : null;
                              const unitPrice = resolvedCatalogUnitPrice(product);
                              const supplyRate = resolvedSettlementRate(
                                settlement,
                                catalogSupplyRate(product),
                              );
                              const finance = calculateEquipmentFinance({
                                unitPrice,
                                quantity: resolvedCatalogQuantity(product.id),
                                procurementFeeRate: isProcurementProduct(product)
                                  ? DEFAULT_PROCUREMENT_FEE_RATE
                                  : null,
                                executionType: settlement.executionType,
                                commissionInputType: settlement.commissionInputType,
                                supplyType: product.supplyType,
                                commissionRate:
                                  product.supplyType === "partner"
                                    ? supplyRate
                                    : null,
                                marginRate:
                                  product.supplyType === "direct"
                                    ? supplyRate
                                    : null,
                                consortiumCommissionRate:
                                  settlement.commissionInputType === "rate"
                                    ? Number(settlement.consortiumInputValue) / 100
                                    : null,
                                consortiumPaymentAmount: inputAmount,
                              });
                              return (
                                <div
                                  key={product.id}
                                  className={`equipment-catalog-option ${
                                    checked ? "selected" : ""
                                  } ${
                                    catalogFavoriteProductIdSet.has(product.id)
                                      ? "favorite"
                                      : ""
                                  } ${
                                    checked && settlement.executionType === "컨소"
                                      ? "consortium"
                                      : ""
                                  }`.trim()}
                                >
                                  <input
                                    type="checkbox"
                                    aria-label={`${product.name} 선택`}
                                    checked={checked}
                                    onChange={() => toggleCatalogProduct(product)}
                                  />
                                  <span>
                                    <strong>
                                      {catalogFavoriteProductIdSet.has(product.id) && (
                                        <i
                                          className="equipment-catalog-favorite-mark"
                                          aria-label="즐겨찾기"
                                        >
                                          ★
                                        </i>
                                      )}
                                      {product.name}
                                    </strong>
                                    <small>
                                      {[
                                        product.supplyType === "direct"
                                          ? "위즈업 직접 공급"
                                          : product.supplierVendorName || "협력사 공급",
                                        product.specification,
                                        product.note,
                                        product.reference,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ") || "상세 정보 미등록"}
                                    </small>
                                  </span>
                                  {checked && (
                                    <div className="equipment-catalog-settlement">
                                      <label className="equipment-catalog-quantity">
                                        <span>수량</span>
                                        <span className="equipment-catalog-quantity-input">
                                          <input
                                            type="number"
                                            inputMode="numeric"
                                            min={1}
                                            max={9999}
                                            aria-label={`${product.name} 수량`}
                                            value={catalogQuantityDrafts[product.id] ?? "1"}
                                            onChange={(event) =>
                                              setCatalogQuantityDrafts((current) => ({
                                                ...current,
                                                [product.id]: event.target.value
                                                  .replace(/[^\d]/g, "")
                                                  .slice(0, 4),
                                              }))
                                            }
                                            onBlur={() =>
                                              setCatalogQuantityDrafts((current) => ({
                                                ...current,
                                                [product.id]: String(
                                                  resolvedCatalogQuantity(product.id),
                                                ),
                                              }))
                                            }
                                          />
                                          <i>개</i>
                                        </span>
                                      </label>
                                      <label className="equipment-catalog-wizup-rate">
                                        <span>
                                          {product.supplyType === "direct"
                                            ? "위즈업 직접 공급 마진율"
                                            : "협력사 수수료율"}
                                        </span>
                                        <span className="equipment-catalog-wizup-rate-input">
                                          <input
                                            inputMode="decimal"
                                            min="0"
                                            max="100"
                                            step="0.01"
                                            aria-label={`${product.name} ${product.supplyType === "direct" ? "마진율" : "수수료율"}`}
                                            value={settlement.wizupCommissionRateInput}
                                            onChange={(event) => {
                                              const next = event.target.value.replace(",", ".");
                                              if (!/^\d{0,3}(?:\.\d{0,2})?$/.test(next)) return;
                                              updateCatalogSettlement(product, {
                                                wizupCommissionRateInput: next,
                                                rateEdited: true,
                                              });
                                            }}
                                            placeholder="0"
                                          />
                                          <i>%</i>
                                        </span>
                                      </label>
                                      <select
                                        aria-label={`${product.name} 사업방식`}
                                        value={settlement.executionType}
                                        onChange={(event) =>
                                          updateCatalogSettlement(product, {
                                            executionType:
                                              event.target.value === "컨소"
                                                ? "컨소"
                                                : "직영",
                                          })
                                        }
                                      >
                                        <option value="직영">직영</option>
                                        <option value="컨소">컨소</option>
                                      </select>
                                      {settlement.executionType === "컨소" && (
                                        <>
                                          <div className="equipment-catalog-consortium-fields">
                                            <select
                                              aria-label={`${product.name} 컨소 지급방식`}
                                              value={settlement.commissionInputType}
                                              onChange={(event) =>
                                                updateCatalogSettlement(product, {
                                                  commissionInputType:
                                                    event.target.value === "amount"
                                                      ? "amount"
                                                      : "rate",
                                                  consortiumInputValue: "",
                                                })
                                              }
                                            >
                                              <option value="rate">퍼센트</option>
                                              <option value="amount">금액</option>
                                            </select>
                                            <label>
                                              <input
                                                inputMode="decimal"
                                                aria-label={`${product.name} ${
                                                  settlement.commissionInputType === "rate"
                                                    ? "컨소 지급률"
                                                    : "컨소 지급"
                                                }`}
                                                value={settlement.consortiumInputValue}
                                                onChange={(event) =>
                                                  updateCatalogSettlement(product, {
                                                    consortiumInputValue:
                                                      settlement.commissionInputType === "amount"
                                                        ? formatMoneyInput(
                                                            event.target.value.replace(
                                                              /[^\d,]/g,
                                                              "",
                                                            ),
                                                          )
                                                        : event.target.value.replace(
                                                            /[^\d.]/g,
                                                            "",
                                                          ),
                                                  })
                                                }
                                                placeholder={
                                                  settlement.commissionInputType === "rate"
                                                    ? "컨소 지급률"
                                                    : "컨소 지급"
                                                }
                                              />
                                              <span>
                                                {settlement.commissionInputType === "rate"
                                                  ? "%"
                                                  : "원"}
                                              </span>
                                            </label>
                                          </div>
                                          <small className="equipment-settlement-preview">
                                            {finance.procurementFee > 0 && (
                                              <>조달 수수료 {finance.procurementFee.toLocaleString("ko-KR")}원 · </>
                                            )}
                                            {product.supplyType === "direct"
                                              ? `예상 마진 ${finance.expectedDirectMargin.toLocaleString("ko-KR")}원`
                                              : `예상 수수료 ${finance.expectedPartnerCommission.toLocaleString("ko-KR")}원`}
                                            · 컨소 지급 {finance.consortiumPayment.toLocaleString("ko-KR")}원
                                            · 마진 {finance.marginAmount.toLocaleString("ko-KR")}원
                                          </small>
                                        </>
                                      )}
                                    </div>
                                  )}
                                  {checked && isDirectPriceCatalogProduct(product) ? (
                                    <label className="equipment-catalog-price-input">
                                      <input
                                        inputMode="text"
                                        aria-label={`${product.name} 금액`}
                                        value={catalogUnitPriceDrafts[product.id] ?? ""}
                                        onChange={(event) =>
                                          setCatalogUnitPriceDrafts((current) => ({
                                            ...current,
                                            [product.id]: formatMoneyInput(
                                              event.target.value.replace(
                                                /(?!^-)[^\d,]/g,
                                                "",
                                              ),
                                            ),
                                          }))
                                        }
                                        placeholder="금액 직접 입력"
                                      />
                                      <span>원</span>
                                      <small>기본 1,500,000원 · 바로 수정 가능</small>
                                    </label>
                                  ) : (
                                    <b>
                                      {product.unitPrice === null
                                        ? "금액 미등록"
                                        : `${product.unitPrice.toLocaleString("ko-KR")}원`}
                                    </b>
                                  )}
                                </div>
                              );
                            })}
                            {!visibleCatalogProducts.length && (
                              <p className="equipment-catalog-message">
                                검색 결과가 없습니다. 직접 입력을 이용해 주세요.
                              </p>
                            )}
                          </div>
                        )}
                        <div className="equipment-form-actions equipment-catalog-actions">
                          <button
                            type="button"
                            onClick={() => {
                              setItemProjectId(null);
                              setSelectedCatalogIds([]);
                              setCatalogSettlementDrafts({});
                              setCatalogUnitPriceDrafts({});
                              setCatalogQuantityDrafts({});
                            }}
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            className="equipment-save"
                            disabled={busy || selectedCatalogIds.length === 0}
                            onClick={() => void addCatalogItems()}
                          >
                            {busy
                              ? "추가 중…"
                              : `선택한 ${selectedCatalogIds.length}개 품목 추가`}
                          </button>
                        </div>
                      </div>
                    ) : itemEntryMode === "manual" ? (
                  <form className="equipment-item-form" onSubmit={saveItem}>
                    {editingItemId && (
                      <div className="equipment-edit-heading">
                        <strong>{itemDraft.productName} 수정</strong>
                        <span>품목 금액과 컨소 정보를 변경합니다.</span>
                      </div>
                    )}
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
                    <label className="equipment-price-field">
                      <span>제품 단가</span>
                      <div className="equipment-money-field">
                        <input
                          inputMode="text"
                          value={itemUnitPriceDraft}
                          onChange={(event) =>
                            setItemUnitPriceDraft(
                              formatMoneyInput(
                                event.target.value.replace(/(?!^-)[^\d,]/g, ""),
                              ),
                            )
                          }
                          placeholder="0"
                        />
                        <i>원</i>
                      </div>
                    </label>
                    <label className="equipment-price-status-field">
                      <span>0원 품목 구분</span>
                      <select
                        value={itemUnitPriceDraft.trim() ? "입력 완료" : itemPriceStatusDraft}
                        disabled={Boolean(itemUnitPriceDraft.trim())}
                        onChange={(event) =>
                          setItemPriceStatusDraft(
                            event.target.value as EquipmentPriceStatus,
                          )
                        }
                      >
                        <option value="금액 미입력">금액 미입력</option>
                        <option value="무상 제공">무상 제공</option>
                        <option value="계약금액에 포함">계약금액에 포함</option>
                        <option value="서비스 품목">서비스 품목</option>
                      </select>
                      <small>실제 단가가 없는 경우에만 구분해 주세요.</small>
                    </label>
                    <label className="equipment-wizup-commission-field">
                      <span>
                        {itemSettlementDraft.supplyType === "direct"
                          ? "위즈업 직접 공급 마진율"
                          : "협력사 수수료율"}
                      </span>
                      <div className="equipment-money-field">
                        <input
                          inputMode="decimal"
                          min="0"
                          max="100"
                          step="0.01"
                          value={itemSettlementDraft.wizupCommissionRateInput}
                          onChange={(event) => {
                            const next = event.target.value.replace(",", ".");
                            if (!/^\d{0,3}(?:\.\d{0,2})?$/.test(next)) return;
                            setItemSettlementDraft({
                              ...itemSettlementDraft,
                              wizupCommissionRateInput: next,
                              rateEdited: true,
                            });
                          }}
                          placeholder="0"
                        />
                        <i>%</i>
                      </div>
                    </label>
                    <label className="equipment-supply-type-field">
                      <span>공급 구분</span>
                      <select
                        value={itemSettlementDraft.supplyType}
                        onChange={(event) =>
                          setItemSettlementDraft({
                            ...itemSettlementDraft,
                            supplyType:
                              event.target.value === "direct"
                                ? "direct"
                                : "partner",
                          })
                        }
                      >
                        <option value="partner">협력사 공급</option>
                        <option value="direct">위즈업 직접 공급</option>
                      </select>
                    </label>
                    <label className="equipment-procurement-fee-field">
                      <span>조달 수수료율</span>
                      <div className="equipment-money-field">
                        <input
                          inputMode="decimal"
                          value={itemProcurementFeeRateDraft}
                          onChange={(event) =>
                            setItemProcurementFeeRateDraft(
                              event.target.value.replace(/[^\d.]/g, ""),
                            )
                          }
                          placeholder="조달 제품 0.54"
                        />
                        <i>%</i>
                      </div>
                    </label>
                    <label className="equipment-execution-field">
                      <span>사업방식</span>
                      <select
                        value={itemSettlementDraft.executionType}
                        onChange={(event) =>
                          setItemSettlementDraft({
                            ...itemSettlementDraft,
                            executionType:
                              event.target.value === "컨소" ? "컨소" : "직영",
                          })
                        }
                      >
                        <option value="직영">직영</option>
                        <option value="컨소">컨소</option>
                      </select>
                    </label>
                    {itemSettlementDraft.executionType === "컨소" && (
                      <>
                        <label className="equipment-commission-type-field">
                          <span>컨소 지급방식</span>
                          <select
                            value={itemSettlementDraft.commissionInputType}
                            onChange={(event) =>
                              setItemSettlementDraft({
                                ...itemSettlementDraft,
                                commissionInputType:
                                  event.target.value === "amount"
                                    ? "amount"
                                    : "rate",
                                consortiumInputValue: "",
                              })
                            }
                          >
                            <option value="rate">퍼센트</option>
                            <option value="amount">금액</option>
                          </select>
                        </label>
                        <label className="equipment-commission-value-field">
                          <span>
                            {itemSettlementDraft.commissionInputType === "rate"
                              ? "컨소 지급률"
                              : "컨소 지급"}
                          </span>
                          <div className="equipment-money-field">
                            <input
                              inputMode="decimal"
                              value={itemSettlementDraft.consortiumInputValue}
                              onChange={(event) =>
                                setItemSettlementDraft({
                                  ...itemSettlementDraft,
                                  consortiumInputValue:
                                    itemSettlementDraft.commissionInputType === "amount"
                                      ? formatMoneyInput(
                                          event.target.value.replace(/[^\d,]/g, ""),
                                        )
                                      : event.target.value.replace(/[^\d.]/g, ""),
                                })
                              }
                              placeholder="0"
                            />
                            <i>
                              {itemSettlementDraft.commissionInputType === "rate"
                                ? "%"
                                : "원"}
                            </i>
                          </div>
                        </label>
                      </>
                    )}
                    <label className="equipment-quantity-field">
                      <span>수량</span>
                      <input
                        type="number"
                        min="1"
                        value={itemDraft.proposedQty}
                        onChange={(event) =>
                          setItemDraft({
                            ...itemDraft,
                            proposedQty: Math.max(
                              1,
                              Number(event.target.value) || 1,
                            ),
                          })
                        }
                      />
                    </label>
                    {renderSettlementCalculation()}
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
                          setItemSettlementDraft({ ...emptyEquipmentSettlementDraft });
                          setItemUnitPriceDraft("");
                          setItemPriceStatusDraft("금액 미입력");
                          setItemProcurementFeeRateDraft("");
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
                      renderConstructionForm()
                    )}
                  </div>
                ) : editingItemId && itemProjectId === project.id ? null : (
                  <button
                    type="button"
                    className="equipment-add-item"
                    onClick={() => openNewItem(project.id)}
                  >
                    ＋ 품목·공사비 입력
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

function StickyTableWrap({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const dockScrollRef = useRef<HTMLDivElement>(null);
  const headerDockRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [dockGeometry, setDockGeometry] = useState<{
    left: number;
    width: number;
  } | null>(null);
  const [headerDockGeometry, setHeaderDockGeometry] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const shell = shellRef.current;
    const tableScroll = tableScrollRef.current;
    const dockScroll = dockScrollRef.current;
    const headerDock = headerDockRef.current;
    if (!shell || !tableScroll || !dockScroll || !headerDock) return;

    let syncing = false;
    const syncHeaderScroll = () => {
      headerDock.scrollLeft = tableScroll.scrollLeft;
    };
    const refreshHeaderDock = () => {
      const table = tableScroll.querySelector("table");
      const thead = table?.querySelector("thead");
      const isDesktop = window.innerWidth > 760;
      const shouldUseHeaderDock = tableScroll.classList.contains("data-list-table");
      if (!table || !thead || !isDesktop || !shouldUseHeaderDock) {
        headerDock.replaceChildren();
        setHeaderDockGeometry((current) => (current === null ? current : null));
        return;
      }

      const workspace = shell.closest(".data-list-workspace");
      const stickyPanel = shell.closest(
        ".records-panel, .manager-priority-panel",
      ) as HTMLElement | null;
      const stickyHeading = stickyPanel?.querySelector(
        ":scope > .records-heading, :scope > .manager-priority-header",
      ) as HTMLElement | null;
      const stickyToolbar = (workspace?.querySelector(
        ":scope > .filter-row",
      ) ?? stickyPanel?.querySelector(":scope > .manager-toolbar")) as HTMLElement | null;
      const headingHeight = stickyHeading?.offsetHeight ?? 0;
      const toolbarHeight = stickyToolbar?.offsetHeight ?? 0;
      stickyPanel?.style.setProperty(
        "--sticky-heading-height",
        `${headingHeight}px`,
      );
      const stickyTop = 74 + headingHeight + toolbarHeight;
      const tableBounds = tableScroll.getBoundingClientRect();
      const headerBounds = thead.getBoundingClientRect();
      const left = Math.max(0, tableBounds.left);
      const right = Math.min(window.innerWidth, tableBounds.right);
      const shouldFloat =
        headerBounds.top < stickyTop &&
        tableBounds.bottom > stickyTop + headerBounds.height &&
        right > left;

      if (!shouldFloat) {
        headerDock.replaceChildren();
        setHeaderDockGeometry((current) => (current === null ? current : null));
        return;
      }

      const clonedTable = table.cloneNode(false) as HTMLTableElement;
      const clonedHead = thead.cloneNode(true) as HTMLTableSectionElement;
      const sourceHeaders = Array.from(thead.querySelectorAll("th"));
      const clonedHeaders = Array.from(clonedHead.querySelectorAll("th"));
      sourceHeaders.forEach((header, index) => {
        const width = header.getBoundingClientRect().width;
        const clonedHeader = clonedHeaders[index];
        if (!clonedHeader) return;
        clonedHeader.style.width = `${width}px`;
        clonedHeader.style.minWidth = `${width}px`;
        clonedHeader.style.maxWidth = `${width}px`;
      });
      clonedTable.removeAttribute("id");
      clonedTable.setAttribute("aria-hidden", "true");
      clonedTable.style.width = `${table.scrollWidth}px`;
      clonedTable.append(clonedHead);
      headerDock.replaceChildren(clonedTable);
      syncHeaderScroll();

      const next = {
        left,
        top: stickyTop,
        width: right - left,
        height: headerBounds.height,
      };
      setHeaderDockGeometry((current) => {
        if (
          current &&
          Math.abs(current.left - next.left) < 1 &&
          Math.abs(current.top - next.top) < 1 &&
          Math.abs(current.width - next.width) < 1 &&
          Math.abs(current.height - next.height) < 1
        ) {
          return current;
        }
        return next;
      });
    };
    const updateSize = () => {
      const nextScrollWidth = tableScroll.scrollWidth;
      const shellBounds = shell.getBoundingClientRect();
      const viewportBottom = window.innerHeight;
      const left = Math.max(0, shellBounds.left);
      const right = Math.min(window.innerWidth, shellBounds.right);
      const shouldFloat =
        nextScrollWidth > tableScroll.clientWidth + 1 &&
        shellBounds.top < viewportBottom - 16 &&
        shellBounds.bottom > viewportBottom &&
        right > left;

      setScrollWidth(nextScrollWidth);
      setDockGeometry((current) => {
        if (!shouldFloat) return current === null ? current : null;
        const next = { left, width: right - left };
        if (
          current &&
          Math.abs(current.left - next.left) < 1 &&
          Math.abs(current.width - next.width) < 1
        ) {
          return current;
        }
        return next;
      });
      dockScroll.scrollLeft = tableScroll.scrollLeft;
      refreshHeaderDock();
    };
    const syncFromTable = () => {
      if (syncing) return;
      syncing = true;
      dockScroll.scrollLeft = tableScroll.scrollLeft;
      syncHeaderScroll();
      window.requestAnimationFrame(() => {
        syncing = false;
      });
    };
    const syncFromDock = () => {
      if (syncing) return;
      syncing = true;
      tableScroll.scrollLeft = dockScroll.scrollLeft;
      window.requestAnimationFrame(() => {
        syncing = false;
      });
    };

    updateSize();
    tableScroll.addEventListener("scroll", syncFromTable, { passive: true });
    dockScroll.addEventListener("scroll", syncFromDock, { passive: true });
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(tableScroll);
    if (tableScroll.firstElementChild) {
      resizeObserver.observe(tableScroll.firstElementChild);
    }
    const stickyPanel = shell.closest(
      ".records-panel, .manager-priority-panel",
    );
    const stickyHeading = stickyPanel?.querySelector(
      ":scope > .records-heading, :scope > .manager-priority-header",
    );
    const stickyToolbar =
      shell.closest(".data-list-workspace")?.querySelector(":scope > .filter-row") ??
      stickyPanel?.querySelector(":scope > .manager-toolbar");
    if (stickyHeading) resizeObserver.observe(stickyHeading);
    if (stickyToolbar) resizeObserver.observe(stickyToolbar);
    window.addEventListener("resize", updateSize);
    window.addEventListener("scroll", updateSize, { passive: true });
    return () => {
      tableScroll.removeEventListener("scroll", syncFromTable);
      dockScroll.removeEventListener("scroll", syncFromDock);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateSize);
      window.removeEventListener("scroll", updateSize);
      headerDock.replaceChildren();
    };
  }, []);

  return (
    <div ref={shellRef} className="table-scroll-shell">
      <div
        ref={tableScrollRef}
        className={`table-wrap ${className}`.trim()}
      >
        {children}
      </div>
      <div
        ref={dockScrollRef}
        className={`table-scroll-dock ${dockGeometry ? "visible" : ""}`.trim()}
        style={
          dockGeometry
            ? { left: dockGeometry.left, width: dockGeometry.width }
            : undefined
        }
        aria-hidden={!dockGeometry}
      >
        <div style={{ width: scrollWidth }} />
      </div>
      <div
        ref={headerDockRef}
        className={`table-header-dock ${headerDockGeometry ? "visible" : ""}`.trim()}
        style={
          headerDockGeometry
            ? {
                left: headerDockGeometry.left,
                top: headerDockGeometry.top,
                width: headerDockGeometry.width,
                height: headerDockGeometry.height,
              }
            : undefined
        }
        aria-hidden="true"
      />
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
  const [institutionMergePreview, setInstitutionMergePreview] =
    useState<InstitutionMergePreview | null>(null);
  const [institutionMergeTarget, setInstitutionMergeTarget] = useState("");
  const [institutionMergeResolutions, setInstitutionMergeResolutions] =
    useState<Record<string, string>>({});
  const [institutionMergeBusy, setInstitutionMergeBusy] = useState(false);
  const [jointProjectOpen, setJointProjectOpen] = useState(false);
  const [jointProjectSeedCandidates, setJointProjectSeedCandidates] =
    useState<JointProjectCandidate[] | null>(null);
  const [institutionDeleteBusy, setInstitutionDeleteBusy] = useState(false);
  const [institutionBudgetOpen, setInstitutionBudgetOpen] = useState(false);
  const [institutionBudgetType, setInstitutionBudgetType] = useState("");
  const [institutionBudgetAmount, setInstitutionBudgetAmount] = useState("");
  const [institutionBulkBudgetEnabled, setInstitutionBulkBudgetEnabled] =
    useState(false);
  const [institutionBulkManagerEnabled, setInstitutionBulkManagerEnabled] =
    useState(false);
  const [institutionBulkProgressManager, setInstitutionBulkProgressManager] =
    useState("");
  const [institutionBulkContactNameEnabled, setInstitutionBulkContactNameEnabled] =
    useState(false);
  const [institutionBulkContactName, setInstitutionBulkContactName] =
    useState("");
  const [institutionBulkFollowUpEnabled, setInstitutionBulkFollowUpEnabled] =
    useState(false);
  const [institutionBulkFollowUpDate, setInstitutionBulkFollowUpDate] =
    useState("");
  const [institutionBulkNextActionEnabled, setInstitutionBulkNextActionEnabled] =
    useState(false);
  const [institutionBulkNextAction, setInstitutionBulkNextAction] =
    useState("");
  const [institutionBulkAwardEnabled, setInstitutionBulkAwardEnabled] =
    useState(false);
  const [institutionBulkAwardStatus, setInstitutionBulkAwardStatus] =
    useState("미정");
  const [institutionBulkAwardCompany, setInstitutionBulkAwardCompany] =
    useState("");
  const [institutionBudgetBusy, setInstitutionBudgetBusy] = useState(false);
  const [recentlyUpdatedInstitutionIds, setRecentlyUpdatedInstitutionIds] =
    useState<number[]>([]);
  const [selectedAwardIds, setSelectedAwardIds] = useState<number[]>([]);
  const [awardDeleteScope, setAwardDeleteScope] = useState<
    "selected" | "filtered" | null
  >(null);
  const [awardDeleteSafetyChecked, setAwardDeleteSafetyChecked] =
    useState(false);
  const [awardDeleteConfirmation, setAwardDeleteConfirmation] = useState("");
  const [awardDeleteBusy, setAwardDeleteBusy] = useState(false);
  const [awardBulkOpen, setAwardBulkOpen] = useState(false);
  const [awardBulkBusy, setAwardBulkBusy] = useState(false);
  const [awardBulkProgress, setAwardBulkProgress] = useState({
    completed: 0,
    total: 0,
  });
  const [awardBulkDateEnabled, setAwardBulkDateEnabled] = useState(false);
  const [awardBulkActivityDate, setAwardBulkActivityDate] = useState("");
  const [awardBulkAwardEnabled, setAwardBulkAwardEnabled] = useState(false);
  const [awardBulkAwardStatus, setAwardBulkAwardStatus] = useState("협력사 수주");
  const [awardBulkAwardCompany, setAwardBulkAwardCompany] = useState("");
  const [awardBulkExecutionEnabled, setAwardBulkExecutionEnabled] = useState(false);
  const [awardBulkExecutionType, setAwardBulkExecutionType] = useState("직영");
  const [awardBulkConsortiumCompany, setAwardBulkConsortiumCompany] = useState("");
  const [awardBulkManagerEnabled, setAwardBulkManagerEnabled] = useState(false);
  const [awardBulkProgressManager, setAwardBulkProgressManager] = useState("해당 없음");
  const awardBulkLocksManager =
    awardBulkAwardEnabled &&
    awardBulkAwardStatus === "협력사 수주";
  const [awardBulkContactNameEnabled, setAwardBulkContactNameEnabled] =
    useState(false);
  const [awardBulkContactName, setAwardBulkContactName] = useState("");
  const [awardBulkStageEnabled, setAwardBulkStageEnabled] = useState(false);
  const [awardBulkAwardStage, setAwardBulkAwardStage] = useState("협상");
  const [awardChangeHistoryOpen, setAwardChangeHistoryOpen] = useState(false);
  const [awardChangeHistoryLoading, setAwardChangeHistoryLoading] =
    useState(false);
  const [awardChangeHistoryError, setAwardChangeHistoryError] = useState("");
  const [awardChangeHistoryBatches, setAwardChangeHistoryBatches] = useState<
    ActivityChangeBatch[]
  >([]);
  const [awardChangeHistoryHasMore, setAwardChangeHistoryHasMore] =
    useState(false);
  const [awardChangeUndoBusyId, setAwardChangeUndoBusyId] = useState<
    string | null
  >(null);
  const [awardCompletionBusyId, setAwardCompletionBusyId] = useState<number | null>(
    null,
  );
  const [view, setView] = useState<View>("dashboard");
  const [constructionDashboardCounts, setConstructionDashboardCounts] =
    useState<ConstructionDashboardCounts>({
      planned: 0,
      active: 0,
      completed: 0,
    });
  const [accountingInitialTab, setAccountingInitialTab] =
    useState<AccountingWorkspaceTab>("collections");
  const [accountingStatusByBusinessKey, setAccountingStatusByBusinessKey] =
    useState<Record<string, AccountingActivityStatus>>({});
  const [menuOrderEditing, setMenuOrderEditing] = useState(false);
  const [draggingMenu, setDraggingMenu] = useState<MenuDragState | null>(null);
  const menuPointerDragRef = useRef<
    | (MenuDragState & {
        pointerId: number;
        startX: number;
        startY: number;
        active: boolean;
      })
    | null
  >(null);
  const menuPointerTimerRef = useRef<number | null>(null);
  const [workspaceNavOrder, setWorkspaceNavOrder] = useState<View[]>(
    completeWorkspaceMenuOrder(navItems.map((item) => item.id)),
  );
  const [managementNavOrder, setManagementNavOrder] = useState<View[]>([]);
  const [recordsFullyLoaded, setRecordsFullyLoaded] = useState(false);
  const recordsFullyLoadedRef = useRef(false);
  const fullRecordsLoadingRef = useRef(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [typeFilter, setTypeFilter] = useState("전체 유형");
  const [statusFilter, setStatusFilter] = useState("전체 상태");
  const [awardFilter, setAwardFilter] = useState("전체 수주");
  const [awardExecutionFilter, setAwardExecutionFilter] = useState("전체 사업방식");
  const [awardManagerFilter, setAwardManagerFilter] = useState("전체 담당자");
  const [budgetGroupFilter, setBudgetGroupFilter] = useState("all");
  const [awardSort, setAwardSort] = useState("date-desc");
  const [awardPage, setAwardPage] = useState(1);
  const [institutionPage, setInstitutionPage] = useState(1);
  const [managerPage, setManagerPage] = useState(1);
  const [teamRecordPage, setTeamRecordPage] = useState(1);
  const [followupSort, setFollowupSort] = useState("activity-desc");
  const [recordDateScope, setRecordDateScope] = useState<"all" | "recent">(
    "all",
  );
  const [activeAwardsOnly, setActiveAwardsOnly] = useState(false);
  const [followupDueSoonOnly, setFollowupDueSoonOnly] = useState(false);
  const [managerIssueFilter, setManagerIssueFilter] =
    useState<ManagerIssueFilter>("attention");
  const [managerAdminSection, setManagerAdminSection] =
    useState<"alerts" | "budgets">("alerts");
  const [managerSearch, setManagerSearch] = useState("");
  const deferredManagerSearch = useDeferredValue(managerSearch);
  const [teamPeriodDays, setTeamPeriodDays] = useState<TeamPeriod>(30);
  const [scheduleRange, setScheduleRange] = useState<ScheduleRange>(30);
  const [dashboardPastSchedulesOpen, setDashboardPastSchedulesOpen] =
    useState(false);
  const [dashboardActivityScope, setDashboardActivityScope] =
    useState<DashboardActivityScope>("mine");
  const [equipmentRefreshVersion, setEquipmentRefreshVersion] = useState(0);
  const [equipmentQuoteSummaries, setEquipmentQuoteSummaries] = useState<
    EquipmentQuoteSummary[]
  >([]);
  const [
    equipmentQuoteSummariesHydrated,
    setEquipmentQuoteSummariesHydrated,
  ] = useState(false);
  const equipmentQuoteSummariesLoadingRef = useRef(false);
  const [teamMetricFocus, setTeamMetricFocus] =
    useState<TeamMetricFocus>("all");
  const [selectedTeamMember, setSelectedTeamMember] = useState("전체");
  const [teamDetailMode, setTeamDetailMode] =
    useState<TeamDetailMode>("activity");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editReturnOrganization, setEditReturnOrganization] = useState("");
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
  const [activityImportPage, setActivityImportPage] = useState(1);
  const [activityImportMergedCount, setActivityImportMergedCount] = useState(0);
  const [activityImportAwardCompany, setActivityImportAwardCompany] =
    useState("");
  const [budgetReviewCatalog, setBudgetReviewCatalog] = useState<
    BudgetReviewCatalogOption[]
  >([]);
  const activityImportInputRef = useRef<HTMLInputElement | null>(null);
  const [googleSheetOpen, setGoogleSheetOpen] = useState(false);
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");
  const [googleSheetLoading, setGoogleSheetLoading] = useState(false);
  const [googleSheetAnalysis, setGoogleSheetAnalysis] =
    useState<GoogleSheetAnalysis | null>(null);
  const [partnerCompanyManagerOpen, setPartnerCompanyManagerOpen] =
    useState(false);
  const [partnerCompanySearch, setPartnerCompanySearch] = useState("");
  const [awardVendors, setAwardVendors] = useState<PartnerCompany[]>([]);
  const [editingPartnerCompanyId, setEditingPartnerCompanyId] =
    useState<number | null>(null);
  const [partnerCompanySaving, setPartnerCompanySaving] = useState(false);
  const [partnerCompanyDraft, setPartnerCompanyDraft] =
    useState<PartnerCompanyDraft>({
      organization: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      notes: "",
    });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [inheritedFormOrganization, setInheritedFormOrganization] = useState("");
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
  const [memberInviteEmail, setMemberInviteEmail] = useState("");
  const [memberInviteName, setMemberInviteName] = useState("");
  const [memberInviteSaving, setMemberInviteSaving] = useState(false);
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
  const [schoolDirectorySettings, setSchoolDirectorySettings] =
    useState<SchoolDirectorySettingsStatus | null>(null);
  const [schoolDirectoryApiKey, setSchoolDirectoryApiKey] = useState("");
  const [schoolDirectorySettingsBusy, setSchoolDirectorySettingsBusy] =
    useState(false);
  const [schoolDirectorySyncBusy, setSchoolDirectorySyncBusy] = useState(false);
  const [schoolDirectoryConnectionMessage, setSchoolDirectoryConnectionMessage] =
    useState("");
  const [aiDraft, setAiDraft] = useState("");
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([]);
  const [aiPreviews, setAiPreviews] = useState<AiPreview[]>([]);
  const [aiOrganizing, setAiOrganizing] = useState(false);
  const [aiDetailLevelPreference, setAiDetailLevelPreference] = useState<
    "auto" | ActivityDetailLevel
  >("auto");
  const [aiBatchSaving, setAiBatchSaving] = useState(false);
  const [aiError, setAiError] = useState("");
  const [voiceRecordingStatus, setVoiceRecordingStatus] =
    useState<VoiceRecordingStatus>("idle");
  const [voiceElapsedSeconds, setVoiceElapsedSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState("");
  const [aiImageAttachments, setAiImageAttachments] = useState<
    AiImageAttachment[]
  >([]);
  const [aiImageAnalyzing, setAiImageAnalyzing] = useState(false);
  const [aiImageDragActive, setAiImageDragActive] = useState(false);
  const [aiImageError, setAiImageError] = useState("");
  const aiDraftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<number | null>(null);
  const voiceIdleReleaseTimerRef = useRef<number | null>(null);
  const voiceStartedAtRef = useRef(0);
  const aiImageInputRef = useRef<HTMLInputElement | null>(null);
  const aiImagePreviewUrlsRef = useRef<string[]>([]);
  const [detailOrganization, setDetailOrganization] = useState<string | null>(
    null,
  );
  const [selectedActivityDetail, setSelectedActivityDetail] =
    useState<Activity | null>(null);
  const [detailBusinessRound, setDetailBusinessRound] = useState(1);
  const [detailHistoryScope, setDetailHistoryScope] = useState<"round" | "all">("round");
  const [detailInlineField, setDetailInlineField] =
    useState<DetailInlineField | null>(null);
  const [detailInlineDraft, setDetailInlineDraft] =
    useState<FormState | null>(null);
  const [detailInlineSaving, setDetailInlineSaving] = useState(false);
  const [detailSchedules, setDetailSchedules] = useState<
    OrganizationScheduleRecord[]
  >([]);
  const [detailSchedulesLoading, setDetailSchedulesLoading] = useState(false);
  const [detailScheduleEditing, setDetailScheduleEditing] = useState(false);
  const [detailScheduleDrafts, setDetailScheduleDrafts] = useState<
    OrganizationScheduleDraft[]
  >([]);
  const [detailScheduleSaving, setDetailScheduleSaving] = useState(false);
  const [scheduleReminders, setScheduleReminders] = useState<
    ScheduleReminderRecord[]
  >([]);
  const [scheduleRemindersLoading, setScheduleRemindersLoading] =
    useState(false);
  const [scheduleReminderCompletingId, setScheduleReminderCompletingId] =
    useState<number | null>(null);
  const [scheduleReminderRefreshVersion, setScheduleReminderRefreshVersion] =
    useState(0);
  const [selectedOrganizations, setSelectedOrganizations] = useState<string[]>(
    [],
  );
  const [managerAlertAcknowledgements, setManagerAlertAcknowledgements] =
    useState<ManagerAlertAcknowledgement[]>([]);
  const [managerAlertMembers, setManagerAlertMembers] = useState<
    ManagerAlertMemberOption[]
  >([]);
  const [managerAlertMemberId, setManagerAlertMemberId] =
    useState<number | null>(null);
  const [managerAlertsHydrated, setManagerAlertsHydrated] = useState(false);
  const [managerAlertsLoading, setManagerAlertsLoading] = useState(false);
  const managerAlertsLoadingRef = useRef(false);
  const [managerAlertsSaving, setManagerAlertsSaving] = useState(false);
  const [
    activityReviewAcknowledgements,
    setActivityReviewAcknowledgements,
  ] = useState<ActivityReviewAcknowledgement[]>([]);
  const [activityReviewsLoading, setActivityReviewsLoading] = useState(false);
  const activityReviewsLoadingRef = useRef(false);
  const activityReviewsLoadedRef = useRef(false);
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
  const activityReviewAssigneesLoadingRef = useRef(false);
  const activityReviewAssigneesLoadedRef = useRef(false);
  const [activityReviewTransferOpenId, setActivityReviewTransferOpenId] =
    useState<number | null>(null);
  const [activityReviewTransferTargets, setActivityReviewTransferTargets] =
    useState<Record<number, string>>({});
  const [protectionReviewItems, setProtectionReviewItems] = useState<
    ProtectionReviewItem[]
  >([]);
  const [protectionReviewsLoading, setProtectionReviewsLoading] =
    useState(false);
  const protectionReviewsLoadingRef = useRef(false);
  const protectionReviewsLoadedRef = useRef(false);
  const [protectionReviewSavingIds, setProtectionReviewSavingIds] = useState<
    number[]
  >([]);
  const [correctionRequests, setCorrectionRequests] = useState<
    EquipmentCorrectionRequest[]
  >([]);
  const [correctionRequestsLoading, setCorrectionRequestsLoading] =
    useState(false);
  const correctionRequestsLoadingRef = useRef(false);
  const correctionRequestsLoadedRef = useRef(false);
  const [correctionRequestSavingIds, setCorrectionRequestSavingIds] = useState<
    string[]
  >([]);
  const sessionRole = session?.member.role;
  const sessionStatus = session?.member.status;
  const isOwner = session?.member.role === "admin";
  const isPrimaryOwner = Boolean(session?.canViewPresence);
  const isApprovedMember = sessionStatus === "approved";
  const canManageMembers = Boolean(
    session && memberCan(session.member, "members:manage"),
  );
  const canManageActivityHistory = Boolean(
    session?.canManageActivityHistory,
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
  const canManageTrash = Boolean(
    session && memberCan(session.member, "trash:manage"),
  );
  const canManageAccounting = Boolean(
    session && memberCan(session.member, "accounting:manage"),
  );
  const canEditProgressManager = Boolean(
    session?.member.isSales || session?.canViewPresence,
  );
  const canViewAnalytics = Boolean(
    session && memberCan(session.member, "analytics:view"),
  );
  const canManageInventory = Boolean(
    session && memberCan(session.member, "inventory:manage"),
  );
  const canUseVoiceInput = Boolean(
    session && memberCan(session.member, "ai:voice"),
  );
  const canUseImageInput = Boolean(
    session && memberCan(session.member, "ai:images"),
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
        canManageAccounting && {
          id: "accounting" as View,
          label: "수금·채권 관리",
          mark: "₩",
        },
        canViewAnalytics && {
          id: "analytics" as View,
          label: "수주·제품 통계",
          mark: "S",
        },
        canManageInventory && {
          id: "inventory" as View,
          label: "물류·재고 관리",
          mark: "I",
        },
        canManageIntegration && {
          id: "integration" as View,
          label: "API 등록·관리",
          mark: "A",
        },
        (canManageBackup || canManageTrash) && {
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
  const visibleManagementNavItems = presentationMode
    ? managementNavItems.filter(
        (item) => !presentationHiddenViews.has(item.id),
      )
    : managementNavItems;
  const orderedWorkspaceNavItems = orderMenuItems(navItems, workspaceNavOrder);
  const orderedManagementNavItems = orderMenuItems(
    visibleManagementNavItems,
    managementNavOrder,
  );

  useEffect(() => {
    if (!session) return;
    const storageKey = `${menuOrderStoragePrefix}${session.member.id}`;
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "{}") as {
        workspace?: View[];
        management?: View[];
      };
      if (Array.isArray(saved.workspace)) {
        setWorkspaceNavOrder(completeWorkspaceMenuOrder(saved.workspace));
      }
      if (Array.isArray(saved.management)) setManagementNavOrder(saved.management);
    } catch {
      setWorkspaceNavOrder(
        completeWorkspaceMenuOrder(navItems.map((item) => item.id)),
      );
      setManagementNavOrder([]);
    }
    setMenuOrderEditing(false);
  }, [session?.member.id]);

  useEffect(() => {
    function releaseWhenHidden() {
      if (document.visibilityState === "hidden") {
        if (voiceRecorderRef.current?.state === "recording") {
          stopVoiceRecording();
        } else {
          releaseVoiceStream();
        }
      }
    }

    document.addEventListener("visibilitychange", releaseWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", releaseWhenHidden);
      if (voiceRecorderRef.current?.state === "recording") {
        voiceRecorderRef.current.ondataavailable = null;
        voiceRecorderRef.current.onstop = null;
        voiceRecorderRef.current.stop();
      }
      releaseVoiceStream();
      aiImagePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      aiImagePreviewUrlsRef.current = [];
    };
  }, []);

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
    if (activityReviewsLoadingRef.current) return;
    activityReviewsLoadingRef.current = true;
    try {
      setActivityReviewsLoading(true);
      const acknowledgements =
        await requestActivityReviewAcknowledgements();
      setActivityReviewAcknowledgements(acknowledgements);
      activityReviewsLoadedRef.current = true;
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "내 기록 점검 상태를 불러오지 못했습니다.",
      );
    } finally {
      activityReviewsLoadingRef.current = false;
      setActivityReviewsLoading(false);
    }
  }

  async function loadActivityReviewAssignees() {
    if (activityReviewAssigneesLoadingRef.current) return;
    activityReviewAssigneesLoadingRef.current = true;
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
      activityReviewAssigneesLoadedRef.current = true;
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "담당자 목록을 불러오지 못했습니다.",
      );
    } finally {
      activityReviewAssigneesLoadingRef.current = false;
      setActivityReviewAssigneesLoading(false);
    }
  }

  async function loadProtectionReviews() {
    if (protectionReviewsLoadingRef.current) return;
    protectionReviewsLoadingRef.current = true;
    try {
      setProtectionReviewsLoading(true);
      setProtectionReviewItems(await requestProtectionReviewItems());
      protectionReviewsLoadedRef.current = true;
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "영업보호 점검 항목을 불러오지 못했습니다.",
      );
    } finally {
      protectionReviewsLoadingRef.current = false;
      setProtectionReviewsLoading(false);
    }
  }

  async function loadCorrectionRequests() {
    if (correctionRequestsLoadingRef.current) return;
    correctionRequestsLoadingRef.current = true;
    try {
      setCorrectionRequestsLoading(true);
      const response = await fetch("/api/correction-requests", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        tasks?: EquipmentCorrectionRequest[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error || "금액 보완 업무를 불러오지 못했습니다.",
        );
      }
      setCorrectionRequests(payload.tasks ?? []);
      correctionRequestsLoadedRef.current = true;
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "금액 보완 업무를 불러오지 못했습니다.",
      );
    } finally {
      correctionRequestsLoadingRef.current = false;
      setCorrectionRequestsLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const deferredTimers: number[] = [];
    const deferDashboardTask = (delay: number, task: () => void) => {
      deferredTimers.push(window.setTimeout(() => {
        if (active) task();
      }, delay));
    };
    // Approved returning users can load their dashboard rows while the
    // session endpoint confirms permissions. If the parallel request is too
    // early for a first-time user, retry once after the session is known.
    const dashboardRecordsRequest = requestRecords("dashboard")
      .then((records) => ({ records, error: null as unknown }))
      .catch((error: unknown) => ({ records: [] as Activity[], error }));
    void requestSession()
      .then(async (nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setSessionLoading(false);
        if (nextSession.member.status === "approved") {
          // The dashboard only needs the latest institution, award, and
          // schedule rows. Load the complete history lazily when a detailed
          // management view is opened. Keep optional dashboard requests out
          // of this critical path so they do not compete for DB connections.
          const prefetchedRecords = await dashboardRecordsRequest;
          const nextRecords = prefetchedRecords.error
            ? await requestRecords("dashboard")
            : prefetchedRecords.records;
          if (!active) return;
          if (!recordsFullyLoadedRef.current) {
            setRecords(nextRecords);
            recordsFullyLoadedRef.current = false;
            setRecordsFullyLoaded(false);
          }
          deferDashboardTask(250, () => {
            void ensureBudgetReviewCatalog();
            void loadActivityReviewAssignees();
          });
          deferDashboardTask(750, () => {
            void loadEquipmentQuoteSummaries();
            if (memberCan(nextSession.member, "records:manage")) {
              void loadManagerAlerts();
            }
            void loadActivityReviews();
          });
          deferDashboardTask(1_250, () => {
            void loadProtectionReviews();
            void loadCorrectionRequests();
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
          fullRecordsLoadingRef.current = false;
          setLoading(false);
          setSessionLoading(false);
        }
      });
    return () => {
      active = false;
      deferredTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (sessionStatus !== "approved") return;
    const timer = window.setTimeout(() => {
      void fetch("/api/award-vendors", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const payload = await response.json() as {
            vendors?: Array<{
              id?: number;
              companyName?: string;
              contactName?: string;
              contactPhone?: string;
              contactEmail?: string;
              notes?: string;
            }>;
          };
          setAwardVendors(
            (payload.vendors ?? [])
              .map((vendor) => ({
                id: Number(vendor.id),
                organization: String(vendor.companyName ?? "").trim(),
                contactName: String(vendor.contactName ?? "").trim(),
                contactPhone: String(vendor.contactPhone ?? "").trim(),
                contactEmail: String(vendor.contactEmail ?? "").trim(),
                notes: String(vendor.notes ?? "").trim(),
              }))
              .filter(
                (vendor) =>
                  Number.isSafeInteger(vendor.id) &&
                  vendor.id > 0 &&
                  Boolean(vendor.organization),
              ),
          );
        })
        .catch(() => undefined);
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [sessionStatus]);

  useEffect(() => {
    if (sessionStatus !== "approved") return;
    const heartbeat = () => {
      void fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          view: view === "owner-performance" ? "dashboard" : view,
        }),
        cache: "no-store",
        keepalive: true,
      }).catch(() => undefined);
    };
    const firstHeartbeat = window.setTimeout(heartbeat, 2_000);
    const timer = window.setInterval(heartbeat, 15_000);
    return () => {
      window.clearTimeout(firstHeartbeat);
      window.clearInterval(timer);
    };
  }, [sessionStatus, view]);

  useEffect(() => {
    if (sessionStatus !== "approved" || view !== "dashboard") return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setScheduleRemindersLoading(true);
      void requestScheduleReminders()
        .then((reminders) => {
          if (active) setScheduleReminders(reminders);
        })
        .catch((caught: unknown) => {
          if (!active) return;
          setToast(
            caught instanceof Error
              ? caught.message
              : "내 일정을 불러오지 못했습니다.",
          );
        })
        .finally(() => {
          if (active) setScheduleRemindersLoading(false);
        });
    }, 600);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [scheduleReminderRefreshVersion, sessionStatus, view]);

  const completePastScheduleReminder = async (
    reminder: ScheduleReminderRecord,
  ) => {
    if (
      scheduleReminderCompletingId !== null ||
      reminder.scheduledDate >= todayValue
    ) {
      return;
    }
    try {
      setScheduleReminderCompletingId(reminder.id);
      await requestCompleteScheduleReminder(reminder.id);
      setScheduleReminders((current) =>
        current.filter((item) => item.id !== reminder.id),
      );
      setToast("지난 일정을 확인 완료했습니다.");
      void refreshRecordsInBackground();
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "일정을 확인 완료하지 못했습니다.",
      );
    } finally {
      setScheduleReminderCompletingId(null);
    }
  };

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
    if (!recentlyUpdatedInstitutionIds.length) return;
    const timer = window.setTimeout(
      () => setRecentlyUpdatedInstitutionIds([]),
      2400,
    );
    return () => window.clearTimeout(timer);
  }, [recentlyUpdatedInstitutionIds]);

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
      const requestedView =
        state?.whizzupView ||
        (availableViews.has(hashView) ? hashView : "dashboard");
      let nextView = requestedView === "trash" ? "backup" : requestedView;
      if (
        (presentationMode && presentationHiddenViews.has(nextView)) ||
        ((nextView === "organizations" || nextView === "records") &&
          !canManageRecords) ||
        (nextView === "team" && !canManageMembers) ||
        (nextView === "accounting" && !canManageAccounting) ||
        (nextView === "analytics" && !canViewAnalytics) ||
        (nextView === "owner-performance" && !isPrimaryOwner) ||
        (nextView === "inventory" && !canManageInventory) ||
        (nextView === "integration" && !canManageIntegration) ||
        (nextView === "backup" && !canManageBackup && !canManageTrash)
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
        void Promise.all([
          loadManagerAlerts(),
          loadEquipmentQuoteSummaries(),
        ]);
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
          nextView === "dashboard" || nextView === "owner-performance"
            ? baseUrl
            : `${baseUrl}#${nextView}`,
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
    canManageTrash,
    canManageAccounting,
    canViewAnalytics,
    canManageInventory,
    isOwner,
    isPrimaryOwner,
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

  const registeredPartnerRecords = useMemo(() => {
    return [...awardVendors]
      .sort((left, right) =>
        left.organization.localeCompare(right.organization, "ko-KR"),
      );
  }, [awardVendors]);

  const registeredPartnerNames = useMemo(
    () => [
      ...new Set(
        registeredPartnerRecords
          .map((record) => record.organization.trim())
          .filter(Boolean),
      ),
    ],
    [registeredPartnerRecords],
  );

  const partnerAwardCompanyOptions = useMemo(
    () =>
      [...new Set([
        ...registeredPartnerNames,
        ...records
          .filter((record) => record.awardStatus === "협력사 수주")
          .map((record) => record.awardCompany.trim())
          .filter(Boolean),
      ])].sort((left, right) => left.localeCompare(right, "ko-KR")),
    [records, registeredPartnerNames],
  );

  const awardCompanyOptions = useMemo(
    () =>
      [...new Set([
        "위즈업",
        ...registeredPartnerNames,
        ...records.map((record) => record.awardCompany.trim()).filter(Boolean),
      ])].sort((left, right) => left.localeCompare(right, "ko-KR")),
    [records, registeredPartnerNames],
  );

  const filteredPartnerCompanyRecords = useMemo(() => {
    const keyword = partnerCompanySearch.trim().toLocaleLowerCase("ko-KR");
    if (!keyword) return registeredPartnerRecords;
    return registeredPartnerRecords.filter((record) =>
      [
        record.organization,
        record.contactName,
        record.contactPhone,
        record.contactEmail,
        record.notes,
      ].some((value) => value.toLocaleLowerCase("ko-KR").includes(keyword)),
    );
  }, [partnerCompanySearch, registeredPartnerRecords]);

  const latestAwardRecords = useMemo(() => {
    const byBusinessRound = new Map<string, Activity>();
    [...records]
      .sort(
        (a, b) =>
          b.activityDate.localeCompare(a.activityDate) || b.id - a.id,
      )
      .forEach((record) => {
        const organization = record.organization.trim();
        const businessKey = analyticsBusinessRoundKey(
          organization,
          record.businessRound,
        );
        if (
          !institutionAliasKey(organization) ||
          record.awardStatus === "미정" ||
          byBusinessRound.has(businessKey)
        ) {
          return;
        }
        byBusinessRound.set(businessKey, record);
      });
    return [...byBusinessRound.values()];
  }, [records]);
  const awardedBusinessKeys = useMemo(
    () =>
      new Set(
        latestAwardRecords.map((record) =>
          analyticsBusinessRoundKey(
            record.organization,
            record.businessRound,
          ),
        ),
      ),
    [latestAwardRecords],
  );
  const equipmentQuoteSummaryByBusinessKey = useMemo(
    () =>
      new Map(
        equipmentQuoteSummaries.map(
          (summary) =>
            [
              analyticsBusinessRoundKey(
                summary.organization,
                summary.businessRound,
              ),
              summary,
            ] as const,
        ),
      ),
    [equipmentQuoteSummaries],
  );
  const equipmentQuoteSummaryForRecord = (record: Activity) =>
    equipmentQuoteSummaryByBusinessKey.get(
      analyticsBusinessRoundKey(record.organization, record.businessRound),
    );
  const formBudgetQuoteSummary = equipmentQuoteSummaryByBusinessKey.get(
    analyticsBusinessRoundKey(form.organization, form.businessRound),
  );
  const formHasBudgetQuote =
    Boolean(formBudgetQuoteSummary) &&
    formBudgetQuoteSummary?.quoteStatus !== "missing";
  const formBudgetQuoteAmount = formHasBudgetQuote
    ? (formBudgetQuoteSummary?.contractAmountReference ?? 0)
    : null;
  const formBudgetStandardizationExcluded = [
    "협력사 수주",
    "타업체 수주",
  ].includes(form.awardStatus);
  const formIsSelfBudget =
    !formBudgetStandardizationExcluded &&
    normalizeBudgetKind(form.budgetKind) === "self";
  const formUsesQuoteAuto =
    formIsSelfBudget &&
    normalizeBudgetAmountMode(form.budgetAmountMode) === "quote_auto";
  const formUsesManualBudgetAmount =
    !formUsesQuoteAuto ||
    (form.budgetAmountSource === "manual" &&
      hasExplicitBudgetAmount(
        form.budgetAmountOverride || form.budgetAmount,
      ));
  const budgetNamesForRecord = (record: Activity) => {
    const names = summarizeActivityBudgets(record.budgets).names;
    return (
      names.join(" + ") ||
      record.budgetType ||
      record.budgetOriginalName ||
      "미정"
    );
  };
  const hasResolvedStandardBudget = (record: Activity) => {
    if (["협력사 수주", "타업체 수주"].includes(record.awardStatus)) {
      return true;
    }
    const budgets = record.budgets.length > 0 ? record.budgets : [record];
    return budgets.every(
      (budget) =>
        Number(budget.budgetGroupId) > 0 ||
        ["auto", "approved", "matched"].includes(
          String(budget.budgetMatchStatus || ""),
        ),
    );
  };
  const budgetAmountDisplayForRecord = (record: Activity) => {
    if (record.budgets.length > 1) {
      const summary = summarizeActivityBudgets(record.budgets);
      return {
        label:
          summary.totalAmount > 0
            ? `${new Intl.NumberFormat("ko-KR", {
                maximumFractionDigits: 2,
              }).format(summary.totalAmount / 10_000)}만원`
            : "금액 미입력",
        detail:
          summary.missingAmountCount > 0
            ? `금액 미입력 ${summary.missingAmountCount.toLocaleString("ko-KR")}건`
            : "",
        status:
          summary.totalAmount <= 0
            ? "missing"
            : summary.missingAmountCount > 0
              ? "partial"
              : "manual",
      };
    }
    const manualValue =
      record.budgetAmountOverride || record.budgetAmount || "";
    const manualDisplay = formatBudgetDisplay(manualValue);
    const isSelfBudget = normalizeBudgetKind(record.budgetKind) === "self";
    const amountMode = normalizeBudgetAmountMode(record.budgetAmountMode);
    const hasManualOverride =
      hasExplicitBudgetAmount(record.budgetAmountOverride) ||
      (record.budgetAmountSource === "manual" &&
        hasExplicitBudgetAmount(record.budgetAmount));
    if (
      !isSelfBudget ||
      amountMode !== "quote_auto" ||
      hasManualOverride
    ) {
      return {
        label:
          manualDisplay ||
          (hasExplicitBudgetAmount(manualValue) ? manualValue : "금액 미입력"),
        detail: manualDisplay ? "" : "금액 미입력 1건",
        status: manualDisplay ? "manual" : "missing",
      };
    }
    const quoteSummary = equipmentQuoteSummaryForRecord(record);
    const storedQuoteAvailable =
      record.budgetQuoteAmount !== null &&
      record.budgetQuoteAmount !== undefined &&
      Number.isFinite(record.budgetQuoteAmount);
    const quoteAvailable =
      Boolean(quoteSummary && quoteSummary.quoteStatus !== "missing") ||
      storedQuoteAvailable;
    const amount =
      quoteSummary && quoteSummary.quoteStatus !== "missing"
        ? quoteSummary.contractAmountReference
        : storedQuoteAvailable
          ? Number(record.budgetQuoteAmount)
          : null;
    if (!quoteAvailable || amount === null) {
      return {
        label: "품목·견적 미등록",
        detail: "품목·견적 관리에 금액을 등록해 주세요.",
        status: "missing",
      };
    }
    return {
      label: `${new Intl.NumberFormat("ko-KR", {
        maximumFractionDigits: 2,
      }).format(amount / 10_000)}만원`,
      detail:
        quoteSummary?.quoteStatus === "partial"
          ? `품목·견적 자동 합계 · 금액 미입력 ${quoteSummary.quoteMissingAmountItemCount.toLocaleString("ko-KR")}건 확인 필요`
          : "",
      status: quoteSummary?.quoteStatus === "partial" ? "partial" : "auto",
    };
  };
  const compactBudgetDisplayForRecord = (record: Activity) => {
    const summary = summarizeActivityBudgets(record.budgets);
    const fallbackName =
      record.jointProjectBudgetType ||
      record.budgetType ||
      record.budgetOriginalName ||
      "예산 미등록";
    const names = summary.names.length > 0 ? summary.names : [fallbackName];
    const amount = budgetAmountDisplayForRecord(record);
    return {
      name:
        names.length > 1
          ? `${names[0]} 외 ${names.length - 1}개`
          : names[0] === "미정"
            ? "예산 미등록"
            : names[0],
      amount: amount.label,
      detail: amount.detail,
      title: names.join(" + "),
    };
  };
  const activityDetailFactValueForRecord = (
    record: Activity,
    fact: ActivityDetailFact,
  ) => {
    const label = fact.label.replace(/\s+/g, "");
    if (/^(총?예산|예산금액)$/.test(label)) {
      return budgetAmountDisplayForRecord(record).label;
    }
    if (/^(사업명|예산명)$/.test(label)) {
      return budgetNamesForRecord(record);
    }
    if (/^(주요일정|진행일정)$/.test(label) && record.progressSchedule.trim()) {
      return record.progressSchedule;
    }
    return fact.value;
  };
  const activityDetailFactsForRecord = (record: Activity) => {
    const sourceFacts = record.detailKeyFacts.filter(
      (fact) => !/(예산|사업명)/.test(fact.label.replace(/\s+/g, "")),
    );
    const take = (pattern: RegExp) =>
      sourceFacts.filter((fact) => pattern.test(fact.label));
    const attendees = take(/참석|참여/);
    const spaces = take(/실측|공간|장소/);
    const schedules = take(/일정|기한|완료일|개학|정산/);
    const prioritized = new Set([...attendees, ...spaces, ...schedules]);
    const summary = summarizeActivityBudgets(record.budgets);
    const budgetFacts: ActivityDetailFact[] = record.budgets.map(
      (budget, index) => ({
        label: `${budget.budgetType || budget.budgetOriginalName || `${index + 1}번`} 예산`,
        value:
          formatBudgetDisplay(
            budget.budgetAmountOverride ||
              budget.budgetInstitutionAmount ||
              budget.budgetAmount,
          ) || "금액 미입력",
      }),
    );
    const facts: ActivityDetailFact[] = [
      ...attendees,
      ...(record.budgets.length
        ? [
            {
              label: "총예산",
              value:
                summary.totalAmount > 0
                  ? `${summary.totalAmount.toLocaleString("ko-KR")}원`
                  : "금액 미입력",
            },
          ]
        : []),
      ...budgetFacts,
      ...spaces,
      ...schedules,
      ...sourceFacts.filter((fact) => !prioritized.has(fact)),
    ];
    const seen = new Set<string>();
    return facts.filter((fact) => {
      const key = fact.label.replace(/\s+/g, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const activityDetailSectionsForRecord = (record: Activity) => {
    if (!record.budgets.length) return record.detailSections;
    const budgetItems = record.budgets.map((budget) => {
      const name = budget.budgetType || budget.budgetOriginalName || "예산";
      const amount =
        formatBudgetDisplay(
          budget.budgetAmountOverride ||
            budget.budgetInstitutionAmount ||
            budget.budgetAmount,
        ) || "금액 미입력";
      return `${name}: ${amount}`;
    });
    return [
      { title: "예산", items: budgetItems },
      ...record.detailSections.filter(
        (section) => !/예산/.test(section.title.replace(/\s+/g, "")),
      ),
    ];
  };
  const registeredContractDisplay = (record: Activity) => {
    if (record.awardStatus !== "위즈업 수주") {
      return {
        amount: "회계 연계 없음",
        detail: `${record.awardStatus} · 위즈업 계약금액 집계 제외`,
        status: "excluded" as const,
      };
    }
    if (!equipmentQuoteSummariesHydrated) {
      return {
        amount: "견적 확인 중",
        detail: "등록 품목 금액을 불러오고 있습니다.",
        status: "loading" as const,
      };
    }
    const quote = equipmentQuoteSummaryForRecord(record);
    if (!quote || quote.quoteStatus === "missing") {
      return {
        amount: "견적 미등록",
        detail: "품목 관리에서 견적을 등록해 주세요.",
        status: "missing" as const,
      };
    }
    if (quote.quoteStatus === "partial") {
      return {
        amount: "견적 금액 확인 필요",
        detail: `현재 입력 합계 ${quote.contractAmountReference.toLocaleString("ko-KR")}원 · ${quote.quoteMissingAmountItemCount.toLocaleString("ko-KR")}개 품목 확인`,
        status: "partial" as const,
      };
    }
    return {
      amount: `${quote.contractAmountReference.toLocaleString("ko-KR")}원`,
      detail: "",
      status: "complete" as const,
    };
  };
  const accountingStatusForRecord = (record: Activity) =>
    accountingStatusByBusinessKey[
      analyticsBusinessRoundKey(record.organization, record.businessRound)
    ];
  const accountingExceptionForRecord = (record: Activity) => {
    const accounting = accountingStatusForRecord(record);
    if (!accounting || record.awardStatus !== "위즈업 수주") return null;
    if (!accounting.confirmed) {
      return {
        label: "수금 확인 필요",
        title: "회계에서 실제 수금 여부를 확인해 주세요.",
      };
    }
    const status = accounting.accountingStatus.trim();
    if (accounting.receivableBalance > 0) {
      return {
        label:
          status && !/수금\s*완료|완료/.test(status)
            ? status
            : `미수금 ${accounting.receivableBalance.toLocaleString("ko-KR")}원`,
        title: `실 수금 ${accounting.commissionCollectedAmount.toLocaleString("ko-KR")}원 · 미수금 ${accounting.receivableBalance.toLocaleString("ko-KR")}원`,
      };
    }
    return status && !/수금\s*완료|완료/.test(status)
      ? { label: status, title: status }
      : null;
  };

  const recordSearchIndex = useMemo(
    () =>
      new Map(
        records.map((record) => [
          record.id,
          [
            record.organization,
            record.region,
            record.contactMethod,
            record.budgetType,
            record.budgetAmount,
            ...record.budgets.flatMap((budget) => [
              budget.budgetType,
              budget.budgetOriginalName,
              budget.budgetAmount,
            ]),
            record.topic,
            record.summary,
            record.nextAction,
            record.contactName,
            record.contactPhone,
            record.contactEmail,
            record.activityType,
            record.awardStatus,
            record.awardCompany,
            record.executionType,
            record.consortiumCompany,
            record.awardStage,
            record.progressManager,
            record.status,
          ]
            .join(" ")
            .toLocaleLowerCase("ko-KR"),
        ]),
      ),
    [records],
  );

  const filteredBeforeSearch = useMemo(() => {
    if (view === "vendors") return [];
    const sourceRecords = view === "awards" ? latestAwardRecords : records;
    return sourceRecords.filter((record) => {
      if (isPdfCampaignRegistration(record)) return false;
      if (view === "followup" && !record.followUpRequired) return false;
      if (view === "awards" && record.awardStatus === "미정") return false;
      if (
        view === "awards" &&
        !matchesStandardBudgetFilter(
          record,
          budgetGroupFilter,
          budgetReviewCatalog,
        )
      ) {
        return false;
      }
      if (
        view === "awards" &&
        activeAwardsOnly &&
        (
          !["위즈업 수주", "협력사 수주"].includes(record.awardStatus) ||
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
        view === "awards" &&
        statusFilter !== "전체 상태" &&
        normalizeAwardStage(record.awardStage, record.awardStatus) !== statusFilter
      ) {
        return false;
      }
      if (awardFilter !== "전체 수주" && record.awardStatus !== awardFilter) return false;
      if (
        view === "awards" &&
        awardExecutionFilter !== "전체 사업방식" &&
        record.executionType !== awardExecutionFilter
      ) return false;
      if (
        view === "awards" &&
        awardManagerFilter !== "전체 담당자" &&
        (record.progressManager.trim() || "해당 없음") !== awardManagerFilter
      ) return false;
      return true;
    });
  }, [
    records,
    typeFilter,
    statusFilter,
    awardFilter,
    awardExecutionFilter,
    awardManagerFilter,
    budgetGroupFilter,
    budgetReviewCatalog,
    view,
    teamPeriodDays,
    activeAwardsOnly,
    latestAwardRecords,
    registeredSalesNames,
    selectedTeamMember,
  ]);

  const filtered = useMemo(() => {
    const keyword = deferredSearch.trim().toLocaleLowerCase("ko-KR");
    if (!keyword) return filteredBeforeSearch;
    return filteredBeforeSearch.filter(
      (record) => recordSearchIndex.get(record.id)?.includes(keyword) ?? false,
    );
  }, [deferredSearch, filteredBeforeSearch, recordSearchIndex]);

  const displayedRecords = useMemo(() => {
    if (view !== "awards") return filtered;
    return [...filteredBeforeSearch].sort((a, b) => {
      if (awardSort === "date-asc") {
        return (
          a.activityDate.localeCompare(b.activityDate) ||
          a.id - b.id
        );
      }
      if (awardSort === "amount-desc" || awardSort === "amount-asc") {
        const aQuote = equipmentQuoteSummaryByBusinessKey.get(
          analyticsBusinessRoundKey(a.organization, a.businessRound),
        );
        const bQuote = equipmentQuoteSummaryByBusinessKey.get(
          analyticsBusinessRoundKey(b.organization, b.businessRound),
        );
        const aHasAmount = aQuote?.quoteStatus === "complete";
        const bHasAmount = bQuote?.quoteStatus === "complete";
        if (!aHasAmount && bHasAmount) return 1;
        if (aHasAmount && !bHasAmount) return -1;
        const aAmount = aHasAmount
          ? aQuote.contractAmountReference
          : 0;
        const bAmount = bHasAmount
          ? bQuote.contractAmountReference
          : 0;
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
  }, [filtered, filteredBeforeSearch, view, awardSort, equipmentQuoteSummaryByBusinessKey]);

  const awardDisplayGroups = useMemo(() => {
    const keyword = deferredSearch.trim().toLocaleLowerCase("ko-KR");
    return filterJointProjectGroupsByMember(
      groupJointProjectRows(displayedRecords),
      keyword
        ? (record) =>
            recordSearchIndex.get(record.id)?.includes(keyword) ?? false
        : undefined,
    );
  }, [deferredSearch, displayedRecords, recordSearchIndex]);
  const openJointProjectGroupDetail = (
    group: { primary: Activity; matchingMembers: Activity[] },
    preferSearchMatch = false,
  ) => {
    const target = preferSearchMatch
      ? group.matchingMembers.find(
          (member) => member.jointProjectRole !== "sponsor",
        ) ?? group.matchingMembers[0] ?? group.primary
      : group.primary;
    cancelDetailInlineEdit();
    setDetailBusinessRound(target.businessRound);
    setDetailOrganization(target.organization);
  };
  const awardPageCount = Math.max(
    1,
    Math.ceil(awardDisplayGroups.length / AWARD_LIST_PAGE_SIZE),
  );
  const awardPageGroups = useMemo(() => {
    if (view !== "awards") return awardDisplayGroups;
    const offset = (awardPage - 1) * AWARD_LIST_PAGE_SIZE;
    return awardDisplayGroups.slice(offset, offset + AWARD_LIST_PAGE_SIZE);
  }, [awardDisplayGroups, awardPage, view]);
  const awardPageRecords = useMemo(
    () => awardPageGroups.map((group) => group.primary),
    [awardPageGroups],
  );
  const awardPageGroupByPrimaryId = useMemo(
    () => new Map(awardPageGroups.map((group) => [group.primary.id, group] as const)),
    [awardPageGroups],
  );
  const selectedAwardIdSet = useMemo(
    () => new Set(selectedAwardIds),
    [selectedAwardIds],
  );
  const selectedAwardOrganizations = useMemo(
    () => [
      ...new Set(
        selectedAwardIds
          .map((id) => records.find((record) => record.id === id)?.organization)
          .filter((organization): organization is string => Boolean(organization)),
      ),
    ],
    [records, selectedAwardIds],
  );
  const selectedJointProjectCandidates = useMemo<JointProjectCandidate[]>(() => {
    if (jointProjectSeedCandidates) return jointProjectSeedCandidates;
    const selectedIds = view === "awards" ? selectedAwardIds : selectedInstitutionIds;
    return selectedIds
      .map((id) => records.find((record) => record.id === id))
      .filter((record): record is Activity => Boolean(record))
      .map((record) => ({
        organization: record.organization,
        businessRound: record.businessRound,
        activityId: record.id,
        budgetAmount: parseMoneyAmount(record.budgetAmount) || null,
        budgetType: record.budgetType,
        jointProjectId: record.jointProjectId ?? null,
        jointProjectName: record.jointProjectName ?? "",
      }));
  }, [jointProjectSeedCandidates, records, selectedAwardIds, selectedInstitutionIds, view]);
  const jointProjectSponsorOptions = useMemo<JointProjectCandidate[]>(() => {
    const latest = new Map<string, Activity>();
    [...records]
      .sort(
        (left, right) =>
          right.activityDate.localeCompare(left.activityDate) || right.id - left.id,
      )
      .forEach((record) => {
        const key = institutionAliasKey(record.organization);
        if (key && !latest.has(key)) latest.set(key, record);
      });
    return [...latest.values()].map((record) => ({
      organization: record.organization,
      businessRound: Math.max(1, record.businessRound || 1),
      activityId: record.id,
      budgetAmount: parseMoneyAmount(record.budgetAmount) || null,
      budgetType: record.budgetType,
      jointProjectId: record.jointProjectId ?? null,
      jointProjectName: record.jointProjectName ?? "",
    }));
  }, [records]);
  const currentAwardPageIds = jointProjectGroupMemberIds(awardPageGroups);
  const allFilteredAwardIds = jointProjectGroupMemberIds(awardDisplayGroups);
  const currentAwardPageSelected =
    currentAwardPageIds.length > 0 &&
    currentAwardPageIds.every((id) => selectedAwardIdSet.has(id));
  const allFilteredAwardsSelected =
    allFilteredAwardIds.length > 0 &&
    allFilteredAwardIds.every((id) => selectedAwardIdSet.has(id));

  useEffect(() => {
    if (view !== "awards") return;
    setAwardPage(1);
    setSelectedAwardIds([]);
    setAwardBulkOpen(false);
  }, [
    activeAwardsOnly,
    awardExecutionFilter,
    awardFilter,
    awardManagerFilter,
    awardSort,
    budgetGroupFilter,
    statusFilter,
    view,
  ]);

  useEffect(() => {
    if (view !== "awards") return;
    setAwardPage((current) => Math.min(current, awardPageCount));
  }, [awardPageCount, view]);

  const dashboardRecentRecords = useMemo(
    () =>
      [...records]
        .filter((record) => {
          if (
            isPdfCampaignRegistration(record) ||
            isCampaignRegistrationSystemRecord(record)
          ) return false;
          if (isOwner && dashboardActivityScope === "all") return true;
          const sessionDisplayName = session?.member.displayName.trim() ?? "";
          const displayName =
            resolveRegisteredSalesName(
              sessionDisplayName,
              registeredSalesNames,
            ) ?? sessionDisplayName;
          const recordManager =
            resolveRegisteredSalesName(
              record.progressManager,
              registeredSalesNames,
            ) ?? record.progressManager.trim();
          return Boolean(displayName) && recordManager === displayName;
        })
        .sort(
          (a, b) =>
            b.activityDate.localeCompare(a.activityDate) ||
            b.id - a.id,
        )
        .slice(0, 20),
    [
      dashboardActivityScope,
      isOwner,
      records,
      registeredSalesNames,
      session?.member.displayName,
    ],
  );

  const today = new Date();
  const todayValue = toLocalDateValue(today);
  const activityReviewInstitutionStateByBusiness = useMemo(() => {
    const historyByBusiness = new Map<string, Activity[]>();

    records.forEach((record) => {
      if (
        isPdfCampaignRegistration(record) ||
        isCampaignRegistrationSystemRecord(record)
      ) return;
      const organization = record.organization.trim();
      if (!organization) return;
      const businessKey = analyticsBusinessRoundKey(
        organization,
        record.businessRound,
      );
      const history = historyByBusiness.get(businessKey) ?? [];
      history.push(record);
      historyByBusiness.set(businessKey, history);
    });

    return new Map(
      Array.from(historyByBusiness, ([businessKey, history]) => {
        const newestFirst = [...history].sort(
          (left, right) =>
            right.activityDate.localeCompare(left.activityDate) ||
            right.id - left.id,
        );
        return [
          businessKey,
          mergeInstitutionStateSnapshots(newestFirst),
        ] as const;
      }),
    );
  }, [records]);
  const activityReviewInstitutionState = (record: Activity) =>
    activityReviewInstitutionStateByBusiness.get(
      analyticsBusinessRoundKey(record.organization, record.businessRound),
    ) ?? null;
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
    const institutionState = activityReviewInstitutionState(record);
    return Boolean(
      acknowledgement &&
        acknowledgement.issueSignature ===
          activityReviewSignature(record, institutionState) &&
        (!acknowledgement.snoozedUntil ||
          acknowledgement.snoozedUntil >= todayValue),
    );
  };
  const pendingActivityReviewRecords = myRecentReviewRecords.filter(
    (record) =>
      activityReviewFields(
        record,
        activityReviewInstitutionState(record),
      ).length > 0 &&
      !isActivityReviewProcessed(record),
  );
  const pendingActivityReviewGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; organization: string; records: Activity[] }
    >();
    pendingActivityReviewRecords.forEach((record) => {
      const key =
        institutionAliasKey(record.organization) ||
        record.organization.trim().toLocaleLowerCase("ko-KR");
      const current = groups.get(key);
      if (current) {
        current.records.push(record);
      } else {
        groups.set(key, {
          key,
          organization: record.organization,
          records: [record],
        });
      }
    });
    return [...groups.values()].map((group) => ({
      ...group,
      records: group.records.sort(
        (left, right) =>
          right.activityDate.localeCompare(left.activityDate) ||
          right.id - left.id,
      ),
    }));
  }, [pendingActivityReviewRecords]);
  const todayActivityReviewRecords = myRecentReviewRecords.filter(
    (record) => timestampDateValue(record.createdAt) === todayValue,
  );
  const completedTodayActivityReviewCount = todayActivityReviewRecords.filter(
    (record) =>
      activityReviewFields(
        record,
        activityReviewInstitutionState(record),
      ).length === 0 ||
      isActivityReviewProcessed(record),
  ).length;
  const followupAlertEnd = new Date(today);
  followupAlertEnd.setDate(today.getDate() + 2);
  const followupAlertEndValue = toLocalDateValue(followupAlertEnd);

  const recordsByInstitutionKey = useMemo(() => {
    const grouped = new Map<string, Activity[]>();
    records.forEach((record) => {
      const key = institutionAliasKey(record.organization);
      if (!key) return;
      const history = grouped.get(key);
      if (history) history.push(record);
      else grouped.set(key, [record]);
    });
    return grouped;
  }, [records]);

  const latestInstitutionRows = useMemo(() => {
    const latestByOrganization = new Map<string, Activity>();
    records.forEach((record) => {
      if (
        isPartnerRegistrationSystemRecord(record) ||
        isAwardManagementSystemRecord(record) ||
        isPdfCampaignRegistration(record)
      ) return;
      const key = institutionAliasKey(record.organization);
      const current = latestByOrganization.get(key);
      if (
        !current ||
        record.activityDate > current.activityDate ||
        (record.activityDate === current.activityDate && record.id > current.id)
      ) {
        latestByOrganization.set(key, record);
      }
    });
    return [...latestByOrganization.values()];
  }, [records]);
  const preAwardInstitutionRows = useMemo(() => {
    return latestInstitutionRows.flatMap((record) => {
      const businessKey = analyticsBusinessRoundKey(
        record.organization,
        record.businessRound,
      );
      if (awardedBusinessKeys.has(businessKey)) return [];
      return [{ record, salesProgress: "" }];
    });
  }, [awardedBusinessKeys, latestInstitutionRows]);
  const followupRows = useMemo(() => {
    return preAwardInstitutionRows
      .filter(
        ({ record }) =>
          !followupDueSoonOnly ||
          Boolean(
            record.followUpDate &&
              record.followUpDate <= followupAlertEndValue,
          ),
      )
      .filter(
        ({ record }) =>
          awardFilter === "전체 수주" || record.awardStatus === awardFilter,
      )
      .filter(({ record }) =>
        matchesStandardBudgetFilter(
          record,
          budgetGroupFilter,
          budgetReviewCatalog,
        ),
      )
      .map(({ record }) => record)
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
    preAwardInstitutionRows,
    typeFilter,
    statusFilter,
    awardFilter,
    budgetGroupFilter,
    budgetReviewCatalog,
    followupSort,
    followupDueSoonOnly,
    followupAlertEndValue,
  ]);
  const followupDisplayGroups = useMemo(() => {
    const keyword = deferredSearch.trim().toLocaleLowerCase("ko-KR");
    return filterJointProjectGroupsByMember(
      groupJointProjectRows(followupRows),
      keyword
        ? (record) =>
            recordSearchIndex.get(record.id)?.includes(keyword) ?? false
        : undefined,
    );
  }, [deferredSearch, followupRows, recordSearchIndex]);
  const institutionPageCount = Math.max(
    1,
    Math.ceil(followupDisplayGroups.length / DATA_LIST_PAGE_SIZE),
  );
  const institutionPageGroups = useMemo(() => {
    const offset = (institutionPage - 1) * DATA_LIST_PAGE_SIZE;
    return followupDisplayGroups.slice(offset, offset + DATA_LIST_PAGE_SIZE);
  }, [followupDisplayGroups, institutionPage]);
  const institutionPageRows = useMemo(
    () => institutionPageGroups.map((group) => group.primary),
    [institutionPageGroups],
  );
  const institutionPageViewRows = useMemo(
    () =>
      institutionPageGroups.map((group) => {
        const record = group.primary;
        const history =
          recordsByInstitutionKey.get(
            institutionAliasKey(record.organization),
          ) ?? [];
        return {
          record,
          priorAward: priorAwardReference(record, history),
          budgetAmountDisplay: group.projectId
            ? {
                label: `${group.members
                  .filter((member) => member.jointProjectRole !== "sponsor")
                  .reduce(
                    (total, member) =>
                      total + (member.jointProjectMemberBudgetAmount ?? 0),
                    0,
                  )
                  .toLocaleString()}원`,
                detail: `${group.members.filter((member) => member.jointProjectRole !== "sponsor").length}개 설치기관 합계`,
              }
            : budgetAmountDisplayForRecord(record),
          group,
        };
      }),
    [institutionPageGroups, recordsByInstitutionKey],
  );
  const selectedInstitutionIdSet = useMemo(
    () => new Set(selectedInstitutionIds),
    [selectedInstitutionIds],
  );
  const currentInstitutionPageIds = jointProjectGroupMemberIds(institutionPageGroups);
  const allFilteredInstitutionIds = jointProjectGroupMemberIds(followupDisplayGroups);
  const currentInstitutionPageSelected =
    currentInstitutionPageIds.length > 0 &&
    currentInstitutionPageIds.every((id) => selectedInstitutionIdSet.has(id));
  const allFilteredInstitutionsSelected =
    allFilteredInstitutionIds.length > 0 &&
    allFilteredInstitutionIds.every((id) => selectedInstitutionIdSet.has(id));

  useEffect(() => {
    if (view !== "followup") return;
    setInstitutionPage(1);
    setSelectedInstitutionIds([]);
    setInstitutionBudgetOpen(false);
  }, [
    awardFilter,
    budgetGroupFilter,
    followupDueSoonOnly,
    followupSort,
    statusFilter,
    typeFilter,
    view,
  ]);

  useEffect(() => {
    if (view !== "followup") return;
    setInstitutionPage((current) => Math.min(current, institutionPageCount));
  }, [institutionPageCount, view]);
  const selectedInstitutionRecords = useMemo(
    () =>
      selectedInstitutionIds
        .map((id) => records.find((record) => record.id === id))
        .filter((record): record is Activity => Boolean(record)),
    [records, selectedInstitutionIds],
  );
  const selectedInstitutionNames = useMemo(
    () => [
      ...new Set(
        selectedInstitutionRecords
          .map((record) => record.organization.trim())
          .filter(Boolean),
      ),
    ],
    [selectedInstitutionRecords],
  );
  const selectedInstitutionSummary = summarizeInstitutionNames(
    selectedInstitutionNames,
  );
  const selectedBudgetTypeState = sharedFieldValue(
    selectedInstitutionRecords.map((record) => record.budgetType),
    (value) => (isUnregisteredBudgetName(value) ? "" : value.trim()),
  );
  const selectedBudgetAmountState = sharedFieldValue(
    selectedInstitutionRecords.map((record) => record.budgetAmount),
    (value) =>
      isUnregisteredBudgetAmount(value) ? "" : formatMoneyInput(value),
  );
  const detailHistory = useMemo(
    () => {
      const detailOrganizationKey = institutionAliasKey(detailOrganization);
      return detailOrganizationKey
        ? records
            .filter(
              (record) =>
                institutionAliasKey(record.organization) ===
                  detailOrganizationKey &&
                !isPdfCampaignRegistration(record) &&
                !isCampaignRegistrationSystemRecord(record),
            )
            .sort((a, b) => {
              if (a.activityDate !== b.activityDate) {
                return b.activityDate.localeCompare(a.activityDate);
              }
              return b.id - a.id;
            })
        : [];
    },
    [records, detailOrganization],
  );
  const detailBusinessRounds = useMemo(
    () =>
      [...new Set(detailHistory.map((record) => record.businessRound))].sort(
        (left, right) => left - right,
      ),
    [detailHistory],
  );
  const selectedDetailBusinessRound = detailBusinessRounds.includes(
    detailBusinessRound,
  )
    ? detailBusinessRound
    : detailBusinessRounds.at(-1) ?? 1;
  const detailBusinessHistory = useMemo(
    () =>
      detailHistory.filter(
        (record) => record.businessRound === selectedDetailBusinessRound,
      ),
    [detailHistory, selectedDetailBusinessRound],
  );
  const detailVisibleHistory =
    detailHistoryScope === "all" ? detailHistory : detailBusinessHistory;
  const detailLatest = detailBusinessHistory[0] ?? null;
  const detailCampaignRegistration = useMemo(
    () => {
      const detailOrganizationKey = institutionAliasKey(detailOrganization);
      return detailOrganizationKey
        ? records
            .filter(
              (record) =>
                institutionAliasKey(record.organization) ===
                  detailOrganizationKey &&
                (isPdfCampaignRegistration(record) ||
                  isCampaignRegistrationSystemRecord(record)),
            )
            .sort((a, b) => b.id - a.id)[0] ?? null
        : null;
    },
    [records, detailOrganization],
  );
  const detailDisplayRecord = detailLatest ?? detailCampaignRegistration;
  useEffect(() => {
    if (!detailOrganization) {
      return;
    }
    const controller = new AbortController();
    setDetailSchedulesLoading(true);
    void fetch(
      `/api/schedules?organization=${encodeURIComponent(detailOrganization)}&businessRound=${selectedDetailBusinessRound}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          schedules?: OrganizationScheduleRecord[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "일정을 불러오지 못했습니다.");
        }
        const schedules = Array.isArray(payload.schedules)
          ? payload.schedules
          : [];
        setDetailSchedules(schedules);
        setDetailScheduleDrafts(
          schedules.map((schedule) => ({
            id: schedule.id,
            key: `saved-${schedule.id}`,
            label: schedule.label,
            scheduledDate: schedule.scheduledDate,
            completed: schedule.completed,
          })),
        );
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setToast(
          caught instanceof Error
            ? caught.message
            : "일정을 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailSchedulesLoading(false);
      });
    return () => controller.abort();
  }, [detailOrganization, selectedDetailBusinessRound]);

  const beginDetailScheduleEdit = () => {
    setDetailScheduleDrafts(
      detailSchedules.map((schedule) => ({
        id: schedule.id,
        key: `saved-${schedule.id}`,
        label: schedule.label,
        scheduledDate: schedule.scheduledDate,
        completed: schedule.completed,
      })),
    );
    setDetailScheduleEditing(true);
  };

  const cancelDetailScheduleEdit = () => {
    setDetailScheduleDrafts(
      detailSchedules.map((schedule) => ({
        id: schedule.id,
        key: `saved-${schedule.id}`,
        label: schedule.label,
        scheduledDate: schedule.scheduledDate,
        completed: schedule.completed,
      })),
    );
    setDetailScheduleEditing(false);
  };

  const saveDetailSchedules = async () => {
    if (!detailOrganization || detailScheduleSaving) return;
    if (
      detailScheduleDrafts.some(
        (schedule) => !schedule.label.trim() || !schedule.scheduledDate,
      )
    ) {
      setToast("일정 이름과 날짜를 모두 입력해 주세요.");
      return;
    }
    try {
      setDetailScheduleSaving(true);
      const response = await fetch("/api/schedules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: detailOrganization,
          businessRound: selectedDetailBusinessRound,
          schedules: detailScheduleDrafts.map((schedule) => ({
            id: schedule.id,
            label: schedule.label.trim(),
            scheduledDate: schedule.scheduledDate,
            completed: schedule.completed,
          })),
        }),
      });
      const payload = (await response.json()) as {
        schedules?: OrganizationScheduleRecord[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "일정을 저장하지 못했습니다.");
      }
      const schedules = Array.isArray(payload.schedules)
        ? payload.schedules
        : [];
      setDetailSchedules(schedules);
      setDetailScheduleDrafts(
        schedules.map((schedule) => ({
          id: schedule.id,
          key: `saved-${schedule.id}`,
          label: schedule.label,
          scheduledDate: schedule.scheduledDate,
          completed: schedule.completed,
        })),
      );
      setDetailScheduleEditing(false);
      setToast("일정만 저장했습니다. 영업·수주 상태는 변경하지 않았습니다.");
      setScheduleReminderRefreshVersion((current) => current + 1);
      void refreshRecordsInBackground();
    } catch (caught) {
      setToast(
        caught instanceof Error ? caught.message : "일정을 저장하지 못했습니다.",
      );
    } finally {
      setDetailScheduleSaving(false);
    }
  };
  const retryDetailScheduleSync = async (scheduleId: number) => {
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry-google-sync", scheduleId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "동기화를 재시도하지 못했습니다.");
      const refreshed = await fetch(
        `/api/schedules?organization=${encodeURIComponent(detailOrganization || "")}&businessRound=${selectedDetailBusinessRound}`,
        { cache: "no-store" },
      );
      const refreshedPayload = (await refreshed.json()) as { schedules?: OrganizationScheduleRecord[]; error?: string };
      if (!refreshed.ok) throw new Error(refreshedPayload.error || "일정을 다시 불러오지 못했습니다.");
      setDetailSchedules(Array.isArray(refreshedPayload.schedules) ? refreshedPayload.schedules : []);
      setToast("Google Calendar 동기화를 다시 시도했습니다.");
      setScheduleReminderRefreshVersion((current) => current + 1);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "동기화를 재시도하지 못했습니다.");
    }
  };
  const detailJointProjectSponsorContact = useMemo(() => {
    if (
      !detailDisplayRecord?.jointProjectId ||
      detailDisplayRecord.jointProjectRole !== "site"
    ) {
      return null;
    }

    return (
      records
        .filter(
          (record) =>
            record.jointProjectId === detailDisplayRecord.jointProjectId &&
            record.jointProjectRole === "sponsor" &&
            !isPdfCampaignRegistration(record) &&
            !isCampaignRegistrationSystemRecord(record) &&
            [
              record.contactRole,
              record.contactName,
              record.contactPhone,
              record.contactEmail,
            ].some((value) => value.trim()),
        )
        .sort((left, right) => {
          if (left.activityDate !== right.activityDate) {
            return right.activityDate.localeCompare(left.activityDate);
          }
          return right.id - left.id;
        })[0] ?? null
    );
  }, [
    detailDisplayRecord?.jointProjectId,
    detailDisplayRecord?.jointProjectRole,
    records,
  ]);
  const detailShellOrganization =
    detailDisplayRecord?.jointProjectId &&
    detailDisplayRecord.jointProjectSponsor?.trim()
      ? detailDisplayRecord.jointProjectSponsor.trim()
      : detailOrganization;
  const detailRegisteredContract =
    detailDisplayRecord && detailDisplayRecord.awardStatus !== "미정"
      ? registeredContractDisplay(detailDisplayRecord)
      : null;
  const detailBudgetAmountDisplay = detailDisplayRecord
    ? budgetAmountDisplayForRecord(detailDisplayRecord)
    : null;
  const detailCurrentSchedules = [...detailSchedules].sort(
    (left, right) =>
      Number(left.completed) - Number(right.completed) ||
      left.scheduledDate.localeCompare(right.scheduledDate) ||
      left.label.localeCompare(right.label, "ko-KR"),
  );
  const { actionableFollowups, dueSoonFollowups } = useMemo(() => {
    const latestRecords = new Map<string, Activity>();
    records.forEach((record) => {
      const institutionKey = institutionAliasKey(record.organization);
      if (!institutionKey) return;
      const current = latestRecords.get(institutionKey);
      if (
        !current ||
        record.activityDate > current.activityDate ||
        (record.activityDate === current.activityDate && record.id > current.id)
      ) {
        latestRecords.set(institutionKey, record);
      }
    });
    const actionable = [...latestRecords.values()].filter(
      (record) => record.followUpRequired && !record.status.includes("완료"),
    );
    return {
      actionableFollowups: actionable,
      dueSoonFollowups: actionable.filter(
        (record) =>
          record.followUpDate &&
          record.followUpDate <= followupAlertEndValue,
      ),
    };
  }, [followupAlertEndValue, records]);
  const activeAwardOrganizationCount = useMemo(
    () =>
      latestAwardRecords.filter(
        (record) =>
          ["위즈업 수주", "협력사 수주"].includes(record.awardStatus) &&
          !completedAwardStages.has(record.awardStage),
      ).length,
    [latestAwardRecords],
  );
  const dashboardSalesCounts = useMemo(() => {
    const completed = latestInstitutionRows.filter(
      (record) =>
        record.awardStatus !== "미정" ||
        record.status.includes("완료") ||
        record.status.includes("종료"),
    ).length;
    return {
      total: latestInstitutionRows.length,
      active: Math.max(0, latestInstitutionRows.length - completed),
      completed,
    };
  }, [latestInstitutionRows]);
  const dashboardAwardCounts = useMemo(() => {
    const whizzupAwards = latestAwardRecords.filter(
      (record) => record.awardStatus === "위즈업 수주",
    );
    const completed = whizzupAwards.filter((record) =>
      completedAwardStages.has(record.awardStage),
    ).length;
    return {
      total: whizzupAwards.length,
      active: Math.max(0, whizzupAwards.length - completed),
      completed,
    };
  }, [latestAwardRecords]);

  const progressSchedules = useMemo(() => {
    const scheduleMap = new Map<string, ProgressScheduleItem[]>();
    const latestByBusiness = new Map<string, Activity>();
    records.forEach((record) => {
      if (!["위즈업 수주", "협력사 수주"].includes(record.awardStatus)) {
        return;
      }
      const institutionKey = institutionAliasKey(record.organization);
      if (!institutionKey) return;
      const businessKey = `${institutionKey}::${Math.max(
        1,
        record.businessRound || 1,
      )}`;
      const current = latestByBusiness.get(businessKey);
      if (
        !current ||
        record.activityDate > current.activityDate ||
        (record.activityDate === current.activityDate && record.id > current.id)
      ) {
        latestByBusiness.set(businessKey, record);
      }
    });
    latestByBusiness.forEach((record) => {
      if (isBundledOrganization(record.organization)) {
        return;
      }
      const current = parseProgressSchedule(record.progressSchedule)
        .filter(isPostAwardProgressScheduleItem)
        .sort(
          (left, right) =>
            left.date.localeCompare(right.date) ||
            left.label.localeCompare(right.label, "ko-KR"),
        );
      if (current.length) {
        const previous = scheduleMap.get(record.organization) ?? [];
        const unique = new Map(
          [...previous, ...current].map((item) => [
            `${item.date}::${item.label}`,
            item,
          ]),
        );
        scheduleMap.set(
          record.organization,
          [...unique.values()].sort(
            (left, right) =>
              left.date.localeCompare(right.date) ||
              left.label.localeCompare(right.label, "ko-KR"),
          ),
        );
      }
    });
    return [...scheduleMap.entries()]
      .map(([organization, items]) => ({ organization, items }))
      .sort((a, b) => a.items[0].date.localeCompare(b.items[0].date));
  }, [records]);
  const {
    dashboardUpcomingProgressSchedules,
    dashboardUpcomingProgressScheduleCount,
    dashboardPastProgressScheduleCount,
    dashboardVisibleProgressSchedules,
    dashboardVisibleProgressScheduleCount,
    upcomingProgressSchedules,
    upcomingProgressScheduleCount,
  } = useMemo(() => {
    const schedulesWithinRange = (range: ScheduleRange) => {
      const endValue =
        range === "all"
          ? ""
          : (() => {
              const end = new Date(`${todayValue}T00:00:00`);
              end.setDate(end.getDate() + range - 1);
              return toLocalDateValue(end);
            })();
      const filteredRows = progressSchedules
        .map((row) => ({
          ...row,
          items: row.items.filter(
            (item) =>
              item.date >= todayValue &&
              (!endValue || item.date <= endValue),
          ),
        }))
        .filter((row) => row.items.length > 0);
      return sortScheduleRowsByEarliestDate(filteredRows);
    };
    const dashboardUpcoming = schedulesWithinRange(14);
    const dashboardCurrent = schedulesWithinRange("all");
    const dashboardAll = sortScheduleRowsForDashboard(
      progressSchedules,
      todayValue,
    );
    const dashboardVisible = dashboardPastSchedulesOpen
      ? dashboardAll
      : dashboardCurrent;
    const upcoming = schedulesWithinRange(scheduleRange);
    return {
      dashboardUpcomingProgressSchedules: dashboardUpcoming,
      dashboardUpcomingProgressScheduleCount: dashboardUpcoming.reduce(
        (total, row) => total + row.items.length,
        0,
      ),
      dashboardPastProgressScheduleCount: progressSchedules.reduce(
        (total, row) =>
          total + row.items.filter((item) => item.date < todayValue).length,
        0,
      ),
      dashboardVisibleProgressSchedules: dashboardVisible,
      dashboardVisibleProgressScheduleCount: dashboardVisible.reduce(
        (total, row) => total + row.items.length,
        0,
      ),
      upcomingProgressSchedules: upcoming,
      upcomingProgressScheduleCount: upcoming.reduce(
        (total, row) => total + row.items.length,
        0,
      ),
    };
  }, [
    dashboardPastSchedulesOpen,
    progressSchedules,
    scheduleRange,
    todayValue,
  ]);

  const organizations = useMemo<OrganizationHealth[]>(() => {
    const map = new Map<string, Activity[]>();
    records.forEach((record) => {
      if (
        isPdfCampaignRegistration(record) ||
        isCampaignRegistrationSystemRecord(record)
      ) return;
      const institutionKey = institutionAliasKey(record.organization);
      if (!institutionKey) return;
      const current = map.get(institutionKey) ?? [];
      current.push(record);
      map.set(institutionKey, current);
    });
    return [...map.entries()]
      .map(([, history]) => {
        const newestFirst = [...history].sort(
          (left, right) =>
            right.activityDate.localeCompare(left.activityDate) ||
            right.id - left.id,
        );
        const latest = newestFirst[0];
        const latestContact = resolveInstitutionContactSet(
          latest,
          newestFirst,
        );
        const recentRecords = newestFirst.slice(0, 10).map((record) => ({
          record,
          contact: resolveInstitutionContactSet(record, newestFirst),
        }));
        const name = latest.organization.trim();
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
        const effectiveContactName = latestContact.contactName;
        const hasAwardResult = latest.awardStatus !== "미정";
        const authoritativeAwardRecordsByBusiness = new Map<string, Activity>();
        history.forEach((record) => {
          if (
            !["위즈업 수주", "협력사 수주", "타업체 수주"].includes(
              record.awardStatus,
            )
          ) {
            return;
          }
          const businessKey = analyticsBusinessRoundKey(
            record.organization,
            record.businessRound,
          );
          const current =
            authoritativeAwardRecordsByBusiness.get(businessKey);
          if (
            !current ||
            record.activityDate > current.activityDate ||
            (record.activityDate === current.activityDate &&
              record.id > current.id)
          ) {
            authoritativeAwardRecordsByBusiness.set(businessKey, record);
          }
        });
        const quoteIssueStates = equipmentQuoteSummariesHydrated
          ? [...authoritativeAwardRecordsByBusiness.entries()]
              .filter(
                ([, record]) => record.awardStatus === "위즈업 수주",
              )
              .map(([businessKey, record]) => {
                const summary =
                  equipmentQuoteSummaryByBusinessKey.get(businessKey);
                return {
                  businessRound: record.businessRound,
                  status: summary?.quoteStatus ?? "missing",
                  itemCount: summary?.quoteItemCount ?? 0,
                  missingAmountItemCount:
                    summary?.quoteMissingAmountItemCount ?? 0,
                };
              })
              .filter((quote) => quote.status !== "complete")
          : [];
        const hasMissingQuote = quoteIssueStates.some(
          (quote) => quote.status === "missing",
        );
        const hasPartialQuote = quoteIssueStates.some(
          (quote) => quote.status === "partial",
        );
        const missingInfo =
          !hasAwardResult &&
          ((latest.followUpRequired && !latest.followUpDate) ||
            (latest.followUpRequired && !latest.nextAction.trim()) ||
            (contactActivity && !effectiveContactName)) ||
          hasMissingQuote ||
          hasPartialQuote;
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
        if (!hasAwardResult && latest.followUpRequired && !latest.followUpDate) {
          issues.push("재연락 날짜 미지정");
        }
        if (!hasAwardResult && latest.followUpRequired && !latest.nextAction.trim()) {
          issues.push("다음 행동 미입력");
        }
        if (!hasAwardResult && contactActivity && !effectiveContactName) {
          issues.push("기관 담당자 미입력");
        }
        if (hasMissingQuote) {
          issues.push("견적 미등록");
        }
        if (hasPartialQuote) {
          issues.push("견적 금액 확인 필요");
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
          awardStatus: latest.awardStatus,
          followUpRequired: latest.followUpRequired,
          followUpDate: latest.followUpDate,
          nextAction: latest.nextAction,
          progressManager: latest.progressManager,
          contactName: effectiveContactName,
          contactSourceId: Number(latestContact.source?.id ?? 0),
          contactInheritedFields: latestContact.inheritedFields,
          status: latest.status,
          ...(quoteIssueStates.length
            ? {
                quoteIssues: quoteIssueStates
                  .map((quote) => ({
                    businessRound: quote.businessRound,
                    status: quote.status,
                    itemCount: quote.itemCount,
                    missingAmountItemCount:
                      quote.missingAmountItemCount,
                  }))
                  .sort(
                    (left, right) =>
                      left.businessRound - right.businessRound,
                  ),
              }
            : {}),
        });
        return {
          name,
          effectiveContactName,
          latest,
          count: history.length,
          latestContact,
          recentRecords,
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
  }, [
    equipmentQuoteSummariesHydrated,
    equipmentQuoteSummaryByBusinessKey,
    records,
    todayValue,
  ]);

  const managerAlertByOrganization = useMemo(
    () =>
      new Map(
        managerAlertAcknowledgements.map(
          (acknowledgement) =>
            [
              institutionAliasKey(acknowledgement.organization),
              acknowledgement,
            ] as const,
        ),
      ),
    [managerAlertAcknowledgements],
  );

  const isManagerAlertProcessed = (organization: OrganizationHealth) => {
    const acknowledgement = managerAlertByOrganization.get(
      institutionAliasKey(organization.name),
    );
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
    (organization) => {
      const acknowledgement = managerAlertByOrganization.get(
        institutionAliasKey(organization.name),
      );
      return (
        organization.issues.length > 0 &&
        isManagerAlertProcessed(organization) &&
        !acknowledgement?.hiddenAt
      );
    },
  );
  const managerInspectionHydrated =
    recordsFullyLoaded &&
    managerAlertsHydrated &&
    equipmentQuoteSummariesHydrated;

  const managerOrganizations = filterManagerInspectionRows(
    activeManagerOrganizations,
    processedManagerOrganizations,
    managerIssueFilter,
    deferredManagerSearch,
  );
  const managerCounts = managerInspectionCounts(
    activeManagerOrganizations,
    processedManagerOrganizations,
    deferredManagerSearch,
  );
  const managerPageCount = Math.max(
    1,
    Math.ceil(managerOrganizations.length / DATA_LIST_PAGE_SIZE),
  );
  const managerPageOrganizations = useMemo(() => {
    const offset = (managerPage - 1) * DATA_LIST_PAGE_SIZE;
    return managerOrganizations.slice(offset, offset + DATA_LIST_PAGE_SIZE);
  }, [managerOrganizations, managerPage]);
  const selectedOrganizationSet = useMemo(
    () => new Set(selectedOrganizations),
    [selectedOrganizations],
  );
  const currentManagerPageSelected =
    managerPageOrganizations.length > 0 &&
    managerPageOrganizations.every((organization) =>
      selectedOrganizationSet.has(organization.name),
    );
  const allFilteredManagerOrganizationsSelected =
    managerOrganizations.length > 0 &&
    managerOrganizations.every((organization) =>
      selectedOrganizationSet.has(organization.name),
    );

  useEffect(() => {
    if (view !== "organizations") return;
    setManagerPage(1);
    setSelectedOrganizations([]);
  }, [managerIssueFilter, managerSearch, view]);

  useEffect(() => {
    if (view !== "organizations") return;
    setManagerPage((current) => Math.min(current, managerPageCount));
  }, [managerPageCount, view]);

  const teamPeriodRecords = useMemo(() => {
    const periodRecords =
      teamPeriodDays === "all"
        ? records.filter(
            (record) =>
              !isAwardManagementSystemRecord(record) &&
              !isPartnerRegistrationSystemRecord(record),
          )
        : records.filter((record) => {
            if (
              isAwardManagementSystemRecord(record) ||
              isPartnerRegistrationSystemRecord(record)
            ) {
              return false;
            }
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
      const institutionKey = institutionAliasKey(record.organization);
      if (!institutionKey) return;
      const current = latestByOrganization.get(institutionKey);
      if (
        !current ||
        record.activityDate > current.activityDate ||
        (record.activityDate === current.activityDate &&
          record.id > current.id)
      ) {
        latestByOrganization.set(institutionKey, record);
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
            (contactActivity &&
              !effectiveInstitutionContactName(
                record,
                activityReviewInstitutionStateByBusiness,
              ))
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
    activityReviewInstitutionStateByBusiness,
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
          (contactActivity &&
            !effectiveInstitutionContactName(
              record,
              activityReviewInstitutionStateByBusiness,
            ))
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
          !effectiveInstitutionContactName(
            record,
            activityReviewInstitutionStateByBusiness,
          )
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
  }, [
    activityReviewInstitutionStateByBusiness,
    teamPeriodLatestRecords,
    todayValue,
  ]);

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

  const teamConversionRecords = useMemo(
    () =>
      teamPeriodLatestRecords
        .filter((record) => {
          if (record.awardStatus !== "위즈업 수주") return false;
          const manager = resolveRegisteredSalesName(
            record.progressManager,
            registeredSalesNames,
          );
          return (
            selectedTeamMember === "전체" ||
            manager === selectedTeamMember
          );
        })
        .sort(
          (left, right) =>
            right.activityDate.localeCompare(left.activityDate) ||
            right.id - left.id,
        ),
    [
      registeredSalesNames,
      selectedTeamMember,
      teamPeriodLatestRecords,
    ],
  );

  const teamDetailRecords =
    view === "awards"
      ? awardPageRecords
      : view === "records"
      ? teamDetailMode === "attention"
        ? teamAttentionItems.map((item) => item.record)
        : teamDetailMode === "conversion"
          ? teamConversionRecords
          : displayedRecords
      : displayedRecords;
  const teamRecordPageCount = Math.max(
    1,
    Math.ceil(teamDetailRecords.length / DATA_LIST_PAGE_SIZE),
  );
  const pagedTeamDetailRecords = useMemo(() => {
    if (view !== "records") return teamDetailRecords;
    const offset = (teamRecordPage - 1) * DATA_LIST_PAGE_SIZE;
    return teamDetailRecords.slice(offset, offset + DATA_LIST_PAGE_SIZE);
  }, [teamDetailRecords, teamRecordPage, view]);

  useEffect(() => {
    if (view !== "records") return;
    setTeamRecordPage(1);
  }, [
    search,
    selectedTeamMember,
    statusFilter,
    teamDetailMode,
    teamMetricFocus,
    teamPeriodDays,
    typeFilter,
    view,
  ]);

  useEffect(() => {
    if (view !== "records") return;
    setTeamRecordPage((current) => Math.min(current, teamRecordPageCount));
  }, [teamRecordPageCount, view]);

  function toggleCurrentAwardPage() {
    const pageIds = new Set(currentAwardPageIds);
    setSelectedAwardIds((current) =>
      currentAwardPageSelected
        ? current.filter((id) => !pageIds.has(id))
        : [...new Set([...current, ...pageIds])],
    );
  }

  function selectAllFilteredAwards() {
    setSelectedAwardIds(allFilteredAwardIds);
  }

  function clearAwardSelection() {
    setSelectedAwardIds([]);
    setAwardBulkOpen(false);
  }

  async function loadVisibleAccountingStatuses() {
    try {
      const response = await fetch("/api/accounting/entries?scope=visible", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        entries?: AccountingEntry[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "회계 확인 상태를 불러오지 못했습니다.");
      }
      if (payload.entries) {
        const grouped = new Map<string, AccountingActivityStatus>();
        payload.entries.forEach((entry) => {
          const businessKey =
            entry.businessKey ||
            analyticsBusinessRoundKey(
              entry.organization,
              entry.businessRound,
            );
          const current = grouped.get(businessKey) ?? {
            activityId: entry.activityId,
            confirmed: true,
            commissionCollectedAmount: 0,
            receivableBalance: 0,
            accountingStatus: entry.accountingStatus,
          };
          current.confirmed = current.confirmed && entry.confirmed;
          current.commissionCollectedAmount +=
            entry.commissionCollectedAmount;
          current.receivableBalance += entry.receivableBalance;
          current.accountingStatus = entry.accountingStatus;
          grouped.set(businessKey, current);
        });
        setAccountingStatusByBusinessKey(Object.fromEntries(grouped));
        return;
      }
      setAccountingStatusByBusinessKey({});
    } catch {
      setAccountingStatusByBusinessKey({});
    }
  }

  useEffect(() => {
    if (!session || session.member.status !== "approved" || view !== "awards") {
      return;
    }
    void loadVisibleAccountingStatuses();
  }, [
    session?.member.id,
    session?.member.status,
    view,
  ]);

  function toggleCurrentInstitutionPage() {
    const pageIds = new Set(currentInstitutionPageIds);
    setSelectedInstitutionIds((current) =>
      currentInstitutionPageSelected
        ? current.filter((id) => !pageIds.has(id))
        : [...new Set([...current, ...pageIds])],
    );
  }

  function selectAllFilteredInstitutions() {
    setSelectedInstitutionIds(allFilteredInstitutionIds);
  }

  function clearInstitutionSelection() {
    setSelectedInstitutionIds([]);
    setInstitutionBudgetOpen(false);
  }

  function toggleCurrentManagerPage() {
    const pageNames = new Set(
      managerPageOrganizations.map((organization) => organization.name),
    );
    setSelectedOrganizations((current) =>
      currentManagerPageSelected
        ? current.filter((name) => !pageNames.has(name))
        : [...new Set([...current, ...pageNames])],
    );
  }

  function selectAllFilteredManagerOrganizations() {
    setSelectedOrganizations(
      managerOrganizations.map((organization) => organization.name),
    );
  }

  function openNew() {
    setEditingId(null);
    setCreatingAward(false);
    formOrganizationSourceRef.current = "";
    setRecordEntryMode("manual");
    setActivityImportFileName("");
    setActivityImportRows([]);
    setActivityImportError("");
    setActivityImportProgress("");
    setGoogleSheetOpen(false);
    setGoogleSheetAnalysis(null);
    setActivityImportPage(1);
    setActivityImportMergedCount(0);
    setActivityImportAwardCompany("");
    setInheritedFormOrganization("");
    setForm({ ...emptyForm, activityDate: new Date().toISOString().slice(0, 10) });
    setModalOpen(true);
  }

  function openNewForOrganization(record: Activity, businessRound = record.businessRound) {
    setEditingId(null);
    setCreatingAward(false);
    formOrganizationSourceRef.current = "";
    setRecordEntryMode("manual");
    setActivityImportFileName("");
    setActivityImportRows([]);
    setActivityImportError("");
    setActivityImportProgress("");
    setGoogleSheetOpen(false);
    setGoogleSheetAnalysis(null);
    setActivityImportPage(1);
    setActivityImportMergedCount(0);
    setActivityImportAwardCompany("");
    setInheritedFormOrganization(record.organization);
    const inheritedBudgets =
      businessRound === record.businessRound
        ? canonicalBudgetsForBusinessRound(
            records,
            record.organization,
            businessRound,
          )
        : [];
    setForm(formWithActivityBudgets({
      ...emptyForm,
      activityDate: new Date().toISOString().slice(0, 10),
      organization: record.organization,
      region: record.region,
      topic: record.topic,
      progressManager: record.progressManager,
      businessRound,
      status: businessRound > record.businessRound ? "신규 접촉" : "상담 진행",
      awardStatus: businessRound > record.businessRound ? "미정" : record.awardStatus,
      awardCompany: businessRound > record.businessRound ? "" : record.awardCompany,
      awardStage: businessRound > record.businessRound ? "미정" : record.awardStage,
      awardCompletedDate:
        businessRound > record.businessRound ? "" : record.awardCompletedDate,
      progressSchedule: businessRound > record.businessRound ? "" : record.progressSchedule,
    }, inheritedBudgets));
    setModalOpen(true);
  }

  function openNewAward() {
    setEditingId(null);
    setCreatingAward(true);
    formOrganizationSourceRef.current = "";
    setRecordEntryMode("manual");
    setGoogleSheetOpen(false);
    setGoogleSheetAnalysis(null);
    setActivityImportAwardCompany("");
    setInheritedFormOrganization("");
    setForm({
      ...emptyForm,
      activityDate: new Date().toISOString().slice(0, 10),
      activityType: "수주",
      contactMethod: "기타",
      awardStatus: "위즈업 수주",
      awardCompany: "위즈업",
      executionType: "직영",
      awardStage: "설치·공사 진행",
      progressManager: "해당 없음",
      followUpRequired: false,
      sourceChat: "수주 관리 직접 등록",
    });
    setModalOpen(true);
  }

  function openAwardExcelImport() {
    setEditingId(null);
    setCreatingAward(true);
    formOrganizationSourceRef.current = "";
    setRecordEntryMode("excel");
    setActivityImportFileName("");
    setActivityImportRows([]);
    setActivityImportError("");
    setActivityImportProgress("");
    setGoogleSheetOpen(false);
    setGoogleSheetAnalysis(null);
    setActivityImportPage(1);
    setActivityImportMergedCount(0);
    setActivityImportAwardCompany("");
    setInheritedFormOrganization("");
    setModalOpen(true);
  }

  function openAwardGoogleSheetImport() {
    setEditingId(null);
    setCreatingAward(true);
    formOrganizationSourceRef.current = "";
    setRecordEntryMode("excel");
    setActivityImportFileName("");
    setActivityImportRows([]);
    setActivityImportError("");
    setActivityImportProgress("");
    setGoogleSheetOpen(true);
    setGoogleSheetAnalysis(null);
    setActivityImportPage(1);
    setActivityImportMergedCount(0);
    setActivityImportAwardCompany("");
    setInheritedFormOrganization("");
    setModalOpen(true);
  }

  function openEdit(record: Activity, returnToDetail = false) {
    setEditingId(record.id);
    setEditReturnOrganization(returnToDetail ? record.organization : "");
    setCreatingAward(false);
    formOrganizationSourceRef.current = record.organization;
    setRecordEntryMode("manual");
    setGoogleSheetOpen(false);
    setGoogleSheetAnalysis(null);
    setActivityImportAwardCompany("");
    setInheritedFormOrganization("");
    setForm(activityToForm(record));
    setModalOpen(true);
  }

  function returnFromEditToDetail() {
    if (!editReturnOrganization) return;
    setModalOpen(false);
    setDetailBusinessRound(form.businessRound);
    setDetailOrganization(editReturnOrganization);
  }

  function beginDetailInlineEdit(
    field: DetailInlineField,
    record: Activity,
  ) {
    if (field === "progressManager" && activityReviewAssignees.length === 0) {
      void loadActivityReviewAssignees();
    }
    setDetailInlineField(field);
    setDetailInlineDraft(activityToForm(record));
  }

  function cancelDetailInlineEdit() {
    if (detailInlineSaving) return;
    setDetailInlineField(null);
    setDetailInlineDraft(null);
  }

  function updateDetailInlineBudgetSelection(
    selection: BudgetSelection,
    budgetIndex = 0,
  ) {
    setDetailInlineDraft((current) => {
      if (!current) return current;
      const budgets = current.budgets.length
        ? current.budgets.map((budget) => ({ ...budget }))
        : [emptyActivityBudget()];
      const existing = budgets[budgetIndex] ?? emptyActivityBudget();
      const quoteSummary = equipmentQuoteSummaryByBusinessKey.get(
        analyticsBusinessRoundKey(
          current.organization,
          current.businessRound,
        ),
      );
      const quoteAvailable = Boolean(
        quoteSummary && quoteSummary.quoteStatus !== "missing",
      );
      const usesQuoteAuto =
        budgets.length === 1 &&
        budgetIndex === 0 &&
        normalizeBudgetKind(selection.budgetKind) === "self" &&
        normalizeBudgetAmountMode(selection.budgetAmountMode) === "quote_auto";
      const preservesExistingManualAmount =
        hasExplicitBudgetAmount(existing.budgetAmount) &&
        existing.budgetAmountSource !== "auto";
      const defaultAmount =
        selection.defaultBudgetAmount !== null &&
        selection.defaultBudgetAmount !== undefined &&
        selection.defaultBudgetAmount > 0
          ? formatMoneyInput(`${selection.defaultBudgetAmount}원`)
          : "";
      const nextAmount = usesQuoteAuto
        ? preservesExistingManualAmount
          ? existing.budgetAmount
          : quoteAvailable
            ? formatMoneyInput(
                `${quoteSummary?.contractAmountReference ?? 0}원`,
              )
            : ""
        : preservesExistingManualAmount
          ? existing.budgetAmount
          : defaultAmount || existing.budgetAmount;
      budgets[budgetIndex] = {
        ...existing,
        ...selection,
        budgetOriginalName:
          selection.budgetOriginalName ||
          existing.budgetOriginalName ||
          selection.budgetType,
        budgetAmount: nextAmount,
        budgetInstitutionAmount: usesQuoteAuto ? "" : nextAmount,
        budgetAmountMode:
          budgets.length > 1
            ? "manual"
            : selection.budgetAmountMode || existing.budgetAmountMode || "manual",
        budgetQuoteAmount: usesQuoteAuto
          ? quoteSummary?.contractAmountReference ?? null
          : null,
        budgetAmountOverride:
          usesQuoteAuto && preservesExistingManualAmount
            ? existing.budgetAmount
            : "",
        budgetAmountSource: usesQuoteAuto
          ? preservesExistingManualAmount
            ? "manual"
            : quoteAvailable
              ? "auto"
              : "missing"
          : hasExplicitBudgetAmount(nextAmount)
            ? "manual"
            : "missing",
      };
      return formWithActivityBudgets(current, budgets);
    });
  }

  function addDetailInlineBudget() {
    setDetailInlineDraft((current) => {
      if (!current) return current;
      const budgets = current.budgets.length
        ? current.budgets.map((budget) => ({ ...budget }))
        : [emptyActivityBudget()];
      if (budgets.length >= 10) {
        setToast("한 사업에는 예산을 최대 10개까지 연결할 수 있습니다.");
        return current;
      }
      if (
        budgets.length === 1 &&
        normalizeBudgetAmountMode(budgets[0].budgetAmountMode) === "quote_auto"
      ) {
        const quoteSummary = equipmentQuoteSummaryByBusinessKey.get(
          analyticsBusinessRoundKey(
            current.organization,
            current.businessRound,
          ),
        );
        const currentAmount =
          budgets[0].budgetAmount ||
          (quoteSummary && quoteSummary.quoteStatus !== "missing"
            ? formatMoneyInput(`${quoteSummary.contractAmountReference}원`)
            : "");
        budgets[0] = {
          ...budgets[0],
          budgetAmount: currentAmount,
          budgetInstitutionAmount: currentAmount,
          budgetAmountMode: "manual",
          budgetAmountOverride: currentAmount,
          budgetAmountSource: currentAmount ? "manual" : "missing",
        };
      }
      budgets.push({ ...emptyActivityBudget(), budgetAmountMode: "manual" });
      return formWithActivityBudgets(current, budgets);
    });
  }

  function removeDetailInlineBudget(index: number) {
    setDetailInlineDraft((current) => {
      if (!current) return current;
      return formWithActivityBudgets(
        current,
        current.budgets.filter((_, itemIndex) => itemIndex !== index),
      );
    });
  }

  function updateDetailInlineBudgetAmount(index: number, rawAmount: string) {
    setDetailInlineDraft((current) => {
      if (!current) return current;
      const budgets = current.budgets.map((budget) => ({ ...budget }));
      const existing = budgets[index] ?? emptyActivityBudget();
      const budgetAmount = formatMoneyInput(rawAmount);
      const hasBudgetAmount = hasExplicitBudgetAmount(budgetAmount);
      budgets[index] = {
        ...existing,
        budgetAmount,
        budgetInstitutionAmount: budgetAmount,
        budgetAmountMode: "manual",
        budgetAmountOverride:
          normalizeBudgetKind(existing.budgetKind) === "self" && hasBudgetAmount
            ? budgetAmount
            : "",
        budgetAmountSource: hasBudgetAmount ? "manual" : "missing",
      };
      return formWithActivityBudgets(current, budgets);
    });
  }

  async function saveDetailInlineEdit(record: Activity) {
    const draft = detailInlineDraft;
    const field = detailInlineField;
    if (!draft || !field || detailInlineSaving) return;
    const nextAwardStage =
      field === "awardStage"
        ? normalizeAwardStage(draft.awardStage, draft.awardStatus)
        : draft.awardStage;
    if (
      field === "awardStage" &&
      !["위즈업 수주", "협력사 수주"].includes(record.awardStatus)
    ) {
      setToast(
        record.awardStatus === "타업체 수주"
          ? "타업체 수주는 수주 진행단계를 관리하지 않습니다."
          : "수주 전 기록은 수주 전환 후 진행단계를 관리할 수 있습니다.",
      );
      return;
    }
    if (
      field === "awardStage" &&
      isCompletedAwardStage(nextAwardStage) &&
      !isCompletedAwardStage(record.awardStage) &&
      !window.confirm(
        `${record.organization}의 수주 진행 단계를 납품 완료로 변경하시겠습니까?\n완료일이 오늘로 기록되고 재연락 표시와 예정일은 자동으로 해제됩니다.`,
      )
    ) {
      return;
    }
    if (
      field === "awardStage" &&
      isCompletedAwardStage(record.awardStage) &&
      !isCompletedAwardStage(nextAwardStage) &&
      !window.confirm(
        `${record.organization}의 납품 완료 상태를 ${nextAwardStage}(으)로 되돌리시겠습니까?\n납품 완료일은 해제되며 완료 기준 통계에서도 제외됩니다.`,
      )
    ) {
      return;
    }
    if (
      field === "execution" &&
      draft.executionType === "컨소" &&
      !draft.consortiumCompany.trim()
    ) {
      setToast("컨소 업체명을 입력해 주세요.");
      return;
    }
    if (
      field === "progressManager" &&
      draft.progressManager.trim() === record.progressManager.trim()
    ) {
      setDetailInlineField(null);
      setDetailInlineDraft(null);
      setToast("이미 같은 진행 담당자로 저장되어 있습니다.");
      return;
    }
    try {
      setDetailInlineSaving(true);
      let payloadRecord: Record<string, unknown> | undefined;
      if (field === "progressManager") {
        const targetMember = activityReviewAssignees.find(
          (member) => member.displayName === draft.progressManager,
        );
        if (!targetMember) {
          throw new Error("등록된 영업 담당자를 선택해 주세요.");
        }
        const response = await fetch("/api/records/assignee", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            activityId: record.id,
            targetMemberId: targetMember.id,
          }),
        });
        const payload = (await response.json()) as {
          record?: Record<string, unknown>;
          error?: string;
        };
        if (!response.ok || !payload.record) {
          throw new Error(payload.error || "진행 담당자를 변경하지 못했습니다.");
        }
        payloadRecord = payload.record;
      } else {
        const nextContacts =
          field === "contact"
            ? normalizeInstitutionContacts(
                draft.contacts.map((contact, index) =>
                  contact.primary || (!draft.contacts.some((item) => item.primary) && index === 0)
                    ? {
                        ...contact,
                        name: draft.contactName,
                        phone: draft.contactPhone,
                        email: draft.contactEmail,
                        primary: true,
                      }
                    : contact,
                ),
                {
                  role: draft.contactRole,
                  name: draft.contactName,
                  phone: draft.contactPhone,
                  email: draft.contactEmail,
                },
              )
            : draft.contacts;
        const nextForm: FormState = {
          ...draft,
          contacts: nextContacts,
          activityType: simplifiedActivityType(draft.activityType),
          contactMethod: contactMethodForActivityType(draft.activityType),
          statusManual: draft.statusManual,
          budgetInstitutionAmount:
            field === "budget" &&
            normalizeBudgetAmountMode(draft.budgetAmountMode) !== "quote_auto"
              ? draft.budgetAmount
              : draft.budgetInstitutionAmount,
          budgetAmountSource:
            field === "budget" && hasExplicitBudgetAmount(draft.budgetAmount)
              ? draft.budgetAmountSource === "auto"
                ? "auto"
                : "manual"
              : draft.budgetAmountSource,
          awardStage: nextAwardStage,
          awardCompletedDate:
            field === "awardStage"
              ? isCompletedAwardStage(nextAwardStage)
                ? draft.awardCompletedDate || toLocalDateValue(new Date())
                : ""
              : draft.awardCompletedDate,
          followUpRequired:
            field === "awardStage" &&
            isCompletedAwardStage(nextAwardStage)
              ? false
              : draft.followUpRequired,
          followUpDate:
            field === "awardStage" &&
            isCompletedAwardStage(nextAwardStage)
              ? ""
              : draft.followUpDate,
        };
        const synchronizedNextForm =
          field === "budget"
            ? formWithActivityBudgets(nextForm, nextForm.budgets)
            : nextForm;
        const response = await fetch("/api/records", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: record.id,
            ...synchronizedNextForm,
            awardStageManual: field === "awardStage" ? true : undefined,
            syncBusinessRoundBudgets: field === "budget",
          }),
        });
        const payload = (await response.json()) as {
          record?: Record<string, unknown>;
          error?: string;
        };
        if (!response.ok || !payload.record) {
          throw new Error(payload.error || "기관 정보를 수정하지 못했습니다.");
        }
        payloadRecord = payload.record;
      }
      const savedRecord = normalizeUpdatedActivity(payloadRecord, record);
      setRecords((current) => upsertActivity(current, savedRecord));
      if (field === "budget" || Boolean(record.jointProjectId)) {
        void refreshRecordsInBackground();
      }
      setDetailInlineField(null);
      setDetailInlineDraft(null);
      setToast("기관 상세 정보를 수정했습니다.");
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "기관 정보를 수정하지 못했습니다.",
      );
    } finally {
      setDetailInlineSaving(false);
    }
  }

  function updateDetailInlineDraft(updates: Partial<FormState>) {
    setDetailInlineDraft((current) =>
      current ? { ...current, ...updates } : current,
    );
  }

  function applyDetailJointProjectSponsorContact() {
    const source = detailJointProjectSponsorContact;
    const draft = detailInlineDraft;
    if (!source || !draft) return;

    const nextContact = {
      contactRole: source.contactRole.trim() || draft.contactRole,
      contactName: source.contactName.trim() || draft.contactName,
      contactPhone: source.contactPhone.trim() || draft.contactPhone,
      contactEmail: source.contactEmail.trim() || draft.contactEmail,
    };
    const hasConflictingValue = (
      [
        [draft.contactRole, nextContact.contactRole],
        [draft.contactName, nextContact.contactName],
        [draft.contactPhone, nextContact.contactPhone],
        [draft.contactEmail, nextContact.contactEmail],
      ] as const
    ).some(
      ([currentValue, nextValue]) =>
        currentValue.trim() &&
        nextValue.trim() &&
        currentValue.trim() !== nextValue.trim(),
    );

    if (
      hasConflictingValue &&
      !window.confirm(
        "현재 입력된 기관 담당자 정보를 주관기관 담당자 정보로 바꿀까요?\n불러온 뒤 저장을 눌러야 실제 기록에 반영됩니다.",
      )
    ) {
      return;
    }

    updateDetailInlineDraft(nextContact);
    setToast("주관기관 담당자 정보를 불러왔습니다. 저장을 눌러 반영해 주세요.");
  }

  function renderDetailInlineActions(record: Activity) {
    return (
      <div className="history-inline-actions">
        <button
          type="button"
          disabled={detailInlineSaving}
          onClick={(event) => {
            event.stopPropagation();
            cancelDetailInlineEdit();
          }}
        >
          취소
        </button>
        <button
          type="button"
          className="primary"
          disabled={detailInlineSaving}
          onClick={(event) => {
            event.stopPropagation();
            void saveDetailInlineEdit(record);
          }}
        >
          {detailInlineSaving ? "저장 중…" : "저장"}
        </button>
      </div>
    );
  }

  function openPartnerCompanyManager(prefill = "") {
    setPartnerCompanySearch("");
    setEditingPartnerCompanyId(null);
    setPartnerCompanyDraft({
      organization: prefill.trim(),
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      notes: "",
    });
    setPartnerCompanyManagerOpen(true);
  }

  async function savePartnerCompany(event: FormEvent) {
    event.preventDefault();
    const organization = partnerCompanyDraft.organization.trim();
    if (!organization) {
      setToast("등록할 협력사명을 입력해 주세요.");
      return;
    }
    if (
      classifyAwardCompany(organization, registeredPartnerNames) === "ours"
    ) {
      setToast("위즈업은 기본 수주업체이므로 협력사 등록이 필요하지 않습니다.");
      return;
    }
    if (
      classifyAwardCompany(organization, registeredPartnerNames) === "partner" &&
      !registeredPartnerRecords.some(
        (record) =>
          record.id === editingPartnerCompanyId &&
          awardCompanyKey(record.organization) === awardCompanyKey(organization),
      )
    ) {
      setToast("이미 등록된 협력사입니다.");
      return;
    }
    try {
      setPartnerCompanySaving(true);
      const response = await fetch("/api/award-vendors", {
        method: editingPartnerCompanyId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingPartnerCompanyId
            ? { id: editingPartnerCompanyId }
            : {}),
          companyName: organization,
          contactName: partnerCompanyDraft.contactName.trim(),
          contactPhone: partnerCompanyDraft.contactPhone.trim(),
          contactEmail: partnerCompanyDraft.contactEmail.trim(),
          notes: partnerCompanyDraft.notes.trim(),
        }),
      });
      const payload = await response.json() as {
        error?: string;
        vendor?: {
          id?: number;
          companyName?: string;
          contactName?: string;
          contactPhone?: string;
          contactEmail?: string;
          notes?: string;
        };
      };
      if (!response.ok) {
        throw new Error(String(payload.error || "협력사를 등록하지 못했습니다."));
      }
      const vendor: PartnerCompany = {
        id: Number(payload.vendor?.id),
        organization: String(payload.vendor?.companyName ?? organization).trim(),
        contactName: partnerCompanyDraft.contactName.trim(),
        contactPhone: partnerCompanyDraft.contactPhone.trim(),
        contactEmail: partnerCompanyDraft.contactEmail.trim(),
        notes: partnerCompanyDraft.notes.trim(),
      };
      if (Number.isSafeInteger(vendor.id) && vendor.id > 0) {
        setAwardVendors((current) => [
          ...current.filter((item) => item.id !== vendor.id),
          vendor,
        ]);
      }
      setEditingPartnerCompanyId(null);
      setPartnerCompanyDraft({
        organization: "",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        notes: "",
      });
      setToast(
        `${organization} 협력사 정보를 ${
          editingPartnerCompanyId ? "수정" : "등록"
        }했습니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error ? caught.message : "협력사를 등록하지 못했습니다.",
      );
    } finally {
      setPartnerCompanySaving(false);
    }
  }

  async function unregisterPartnerCompany(record: PartnerCompany) {
    if (
      !window.confirm(
        `${record.organization}을(를) 협력사 목록에서 해제할까요? 기존 기록은 보존됩니다.`,
      )
    ) {
      return;
    }
    try {
      setPartnerCompanySaving(true);
      const response = await fetch("/api/award-vendors", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(String(payload.error || "협력사 등록을 해제하지 못했습니다."));
      }
      setAwardVendors((current) =>
        current.filter((item) => item.id !== record.id),
      );
      setToast(`${record.organization}의 협력사 등록을 해제했습니다.`);
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "협력사 등록을 해제하지 못했습니다.",
      );
    } finally {
      setPartnerCompanySaving(false);
    }
  }

  function updateFormOrganization(nextOrganization: string) {
    setInheritedFormOrganization("");
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
        nextAction: compactRepeatedAiText(
          replaceReferences(current.nextAction),
          400,
        ),
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

  function inheritLatestInstitutionDetails(
    organizationValue?: string,
    regionValue?: string,
  ) {
    if (editingId) return;
    const organization = (organizationValue ?? form.organization).trim();
    const region = (regionValue ?? form.region).trim();
    if (!organization) {
      setInheritedFormOrganization("");
      return;
    }

    const resolvedOrganization = resolveUniqueExistingInstitutionName(
      { organization, region },
      records.map((record) => ({
        organization: record.organization,
        region: record.region,
      })),
    );
    if (!resolvedOrganization) {
      setInheritedFormOrganization("");
      return;
    }
    const organizationKey = institutionAliasKey(resolvedOrganization);
    const institutionHistory = records
      .filter(
        (record) =>
          institutionAliasKey(record.organization) === organizationKey,
      )
      .sort(
        (left, right) =>
          right.activityDate.localeCompare(left.activityDate) ||
          right.id - left.id,
      );
    const latestInstitutionRegion =
      institutionHistory.find((record) => record.region.trim())?.region.trim() ??
      "";
    const latest = institutionHistory.find(
      (record) => record.businessRound === form.businessRound,
    );
    if (!latest) {
      if (!region && latestInstitutionRegion) {
        setForm((current) =>
          current.region.trim()
            ? current
            : { ...current, region: latestInstitutionRegion },
        );
      }
      setInheritedFormOrganization("");
      return;
    }

    const inheritedBudgets = canonicalBudgetsForBusinessRound(
      records,
      latest.organization,
      latest.businessRound,
      latest.region,
    );
    setForm((current) =>
      formWithActivityBudgets(inheritInstitutionState(
        current,
        {
          ...latest,
          region: latest.region.trim() || latestInstitutionRegion,
          // 연락처는 최종 사업 차수가 정해진 뒤 서버에서 같은 차수의
          // 이전 기록 한 건을 기준으로만 보완합니다.
          contactRole: "",
          contactName: "",
          contactPhone: "",
          contactEmail: "",
        },
        { inheritFormDefaults: true },
      ), inheritedBudgets),
    );
    setInheritedFormOrganization(latest.organization);
  }

  function updateBudgetSelection(
    selection: BudgetSelection,
    budgetIndex = 0,
  ) {
    setForm((current) => {
      const budgets = current.budgets.length
        ? current.budgets.map((budget) => ({ ...budget }))
        : [emptyActivityBudget()];
      const existing = budgets[budgetIndex] ?? emptyActivityBudget();
      const quoteSummary = equipmentQuoteSummaryByBusinessKey.get(
        analyticsBusinessRoundKey(
          current.organization,
          current.businessRound,
        ),
      );
      const quoteAvailable = Boolean(
        quoteSummary && quoteSummary.quoteStatus !== "missing",
      );
      const quoteAmount =
        quoteSummary && quoteSummary.quoteStatus !== "missing"
          ? quoteSummary.contractAmountReference
        : null;
      const usesQuoteAuto =
        budgets.length === 1 &&
        budgetIndex === 0 &&
        normalizeBudgetKind(selection.budgetKind) === "self" &&
        normalizeBudgetAmountMode(selection.budgetAmountMode) === "quote_auto";
      const preservesExistingManualAmount =
        hasExplicitBudgetAmount(existing.budgetAmount) &&
        existing.budgetAmountSource !== "auto";
      const defaultAmount =
        selection.defaultBudgetAmount !== null &&
        selection.defaultBudgetAmount !== undefined &&
        selection.defaultBudgetAmount > 0
          ? formatMoneyInput(`${selection.defaultBudgetAmount}원`)
          : "";
      const nextAmount = usesQuoteAuto
        ? preservesExistingManualAmount
          ? existing.budgetAmount
          : quoteAvailable
            ? formatMoneyInput(`${quoteAmount}원`)
            : ""
        : preservesExistingManualAmount
          ? existing.budgetAmount
          : defaultAmount || existing.budgetAmount;
      budgets[budgetIndex] = {
        ...existing,
        ...selection,
        budgetOriginalName:
          selection.budgetOriginalName ||
          existing.budgetOriginalName ||
          selection.budgetType,
        budgetAmount: nextAmount,
        budgetInstitutionAmount: usesQuoteAuto
          ? hasExplicitBudgetAmount(
              existing.budgetInstitutionAmount || existing.budgetAmount,
            )
            ? existing.budgetInstitutionAmount || existing.budgetAmount
            : ""
          : nextAmount,
        budgetAmountMode:
          usesQuoteAuto && preservesExistingManualAmount
            ? "manual"
            : budgets.length > 1
              ? "manual"
              : selection.budgetAmountMode || existing.budgetAmountMode || "manual",
        budgetQuoteAmount: usesQuoteAuto ? quoteAmount : null,
        budgetAmountOverride:
          usesQuoteAuto && preservesExistingManualAmount
            ? existing.budgetAmount
            : "",
        budgetAmountSource: usesQuoteAuto
          ? preservesExistingManualAmount
            ? "manual"
            : quoteAvailable
              ? "auto"
              : "missing"
          : nextAmount
            ? "manual"
            : "missing",
      };
      return formWithActivityBudgets(current, budgets);
    });
  }

  function addActivityBudget() {
    setForm((current) => {
      const budgets = current.budgets.length
        ? current.budgets.map((budget) => ({ ...budget }))
        : [emptyActivityBudget()];
      if (budgets.length >= 10) {
        setToast("한 사업에는 예산을 최대 10개까지 연결할 수 있습니다.");
        return current;
      }
      if (
        budgets.length === 1 &&
        normalizeBudgetAmountMode(budgets[0].budgetAmountMode) === "quote_auto"
      ) {
        const currentAmount =
          budgets[0].budgetAmount ||
          (formBudgetQuoteAmount !== null
            ? formatMoneyInput(`${formBudgetQuoteAmount}원`)
            : "");
        budgets[0] = {
          ...budgets[0],
          budgetAmount: currentAmount,
          budgetInstitutionAmount: currentAmount,
          budgetAmountMode: "manual",
          budgetAmountOverride: currentAmount,
          budgetAmountSource: currentAmount ? "manual" : "missing",
        };
      }
      budgets.push({ ...emptyActivityBudget(), budgetAmountMode: "manual" });
      return formWithActivityBudgets(current, budgets);
    });
  }

  function removeActivityBudget(index: number) {
    setForm((current) => {
      const budgets = current.budgets.filter((_, itemIndex) => itemIndex !== index);
      return formWithActivityBudgets(current, budgets);
    });
  }

  function updateActivityBudgetAmount(index: number, rawAmount: string) {
    setForm((current) => {
      const budgets = current.budgets.map((budget) => ({ ...budget }));
      const existing = budgets[index] ?? emptyActivityBudget();
      const budgetAmount = formatMoneyInput(rawAmount);
      const hasBudgetAmount = hasExplicitBudgetAmount(budgetAmount);
      budgets[index] = {
        ...existing,
        budgetAmount,
        budgetInstitutionAmount: budgetAmount,
        budgetAmountMode:
          current.budgets.length > 1 || normalizeBudgetKind(existing.budgetKind) === "self"
            ? hasBudgetAmount
              ? "manual"
              : current.budgets.length > 1
                ? "manual"
                : "quote_auto"
            : existing.budgetAmountMode,
        budgetAmountOverride:
          normalizeBudgetKind(existing.budgetKind) === "self" && hasBudgetAmount
            ? budgetAmount
            : "",
        budgetAmountSource: hasBudgetAmount ? "manual" : "missing",
      };
      return formWithActivityBudgets(current, budgets);
    });
  }

  function switchBudgetAmountToManual() {
    setForm((current) => {
      const initial =
        (hasExplicitBudgetAmount(current.budgetAmount)
          ? current.budgetAmount
          : "") ||
        (formBudgetQuoteAmount !== null
          ? formatMoneyInput(`${formBudgetQuoteAmount}원`)
          : "");
      const budgets = current.budgets.map((budget) => ({ ...budget }));
      budgets[0] = {
        ...(budgets[0] ?? emptyActivityBudget()),
        budgetAmountMode: "manual",
        budgetAmount: initial,
        budgetInstitutionAmount: initial,
        budgetAmountOverride: initial,
        budgetAmountSource: hasExplicitBudgetAmount(initial)
          ? "manual"
          : "missing",
      };
      return formWithActivityBudgets(current, budgets);
    });
  }

  function recalculateBudgetFromQuote() {
    setForm((current) => {
      const budgets = current.budgets.map((budget) => ({ ...budget }));
      budgets[0] = {
        ...(budgets[0] ?? emptyActivityBudget()),
        budgetAmountMode: "quote_auto",
        budgetAmount:
          formBudgetQuoteAmount !== null
            ? formatMoneyInput(`${formBudgetQuoteAmount}원`)
            : "",
        budgetInstitutionAmount: "",
        budgetQuoteAmount: formBudgetQuoteAmount,
        budgetAmountOverride: "",
        budgetAmountSource:
          formBudgetQuoteAmount !== null ? "auto" : "missing",
      };
      return formWithActivityBudgets(current, budgets);
    });
  }

  async function ensureBudgetReviewCatalog() {
    if (budgetReviewCatalog.length) return budgetReviewCatalog;
    try {
      const catalog = await requestBudgetReviewCatalog();
      setBudgetReviewCatalog(catalog);
      return catalog;
    } catch {
      return [];
    }
  }

  function reviewActivityImportRows(
    rows: ActivityImportRow[],
    preserveSelected = false,
    catalog = budgetReviewCatalog,
  ) {
    const existing = new Set(
      records.map((record) =>
        creatingAward
          ? awardImportSignature(record)
          : activityImportSignature(record),
      ),
    );
    const existingByGoogleSource = new Map(
      records
        .filter((record) => record.sourceChat.startsWith("구글 시트 연동|"))
        .map((record) => [record.sourceChat, record]),
    );
    const seen = new Set<string>();
    return rows.map<ReviewedActivityImportRow>((row) => {
      const budgetResolution = resolveBudgetFromCatalog(
        row.values.budgetType,
        catalog,
        ["협력사 수주", "타업체 수주"].includes(row.values.awardStatus),
      );
      const signature = creatingAward
        ? awardImportSignature(row.values)
        : activityImportSignature(row.values);
      const linkedRecord = row.values.sourceChat.startsWith("구글 시트 연동|")
        ? existingByGoogleSource.get(row.values.sourceChat)
        : undefined;
      const unchanged = Boolean(
        linkedRecord &&
          activitySyncSignature(linkedRecord) ===
            activitySyncSignature(row.values),
      );
      const duplicate =
        unchanged ||
        (!linkedRecord && (existing.has(signature) || seen.has(signature)));
      seen.add(signature);
      const sourceWarnings = row.warnings.filter(
        (warning) =>
          warning !== "현재 기록 또는 업로드 파일 안에 같은 내용이 있습니다.",
      );
      const warnings = duplicate
        ? [
            ...sourceWarnings,
            linkedRecord
              ? "이 구글 시트 기관은 이미 최신 내용으로 반영되어 있습니다."
              : "현재 기록 또는 업로드 파일 안에 같은 내용이 있습니다.",
          ]
        : linkedRecord
          ? [
              ...sourceWarnings,
              "기존 구글 시트 연동 기록을 최신 내용으로 갱신합니다.",
            ]
          : sourceWarnings;
      const eligible = creatingAward
        ? Boolean(row.values.organization.trim())
        : row.errors.length === 0;
      const budgetNeedsReview = budgetResolution.matchStatus === "review";
      const reviewedWarnings = budgetNeedsReview
        ? [...warnings, "표준 예산명 후보를 선택해야 저장할 수 있습니다."]
        : warnings;
      const selectedBeforeReview =
        preserveSelected && "selected" in row
          ? Boolean((row as ReviewedActivityImportRow).selected)
          : true;
      return {
        ...row,
        duplicate,
        selected:
          !duplicate &&
          eligible &&
          !budgetNeedsReview &&
          selectedBeforeReview,
        budgetOriginalName: budgetResolution.originalName,
        budgetResolvedName: budgetResolution.canonicalName,
        budgetGroupId: budgetResolution.groupId,
        budgetMatchStatus: budgetResolution.matchStatus,
        budgetMatchMethod: budgetResolution.matchMethod,
        budgetCandidates: budgetResolution.candidates,
        budgetKind: budgetResolution.budgetKind,
        budgetAmountMode: budgetResolution.amountMode,
        warnings: reviewedWarnings,
        existingRecordId: linkedRecord && !unchanged ? linkedRecord.id : undefined,
        syncAction: linkedRecord
          ? unchanged
            ? "unchanged"
            : "update"
          : "create",
      };
    });
  }

  function applyActivityImportAwardCompany(mode: "empty" | "overwrite") {
    const company = activityImportAwardCompany.trim();
    if (!company) {
      setActivityImportError("적용할 수주업체를 입력하거나 선택해 주세요.");
      return;
    }
    const result = applyAwardCompanyToSelectedRows(
      activityImportRows,
      company,
      mode,
    );
    if (!result.changedCount) {
      setActivityImportError(
        mode === "empty"
          ? "선택한 기록 중 수주업체가 비어 있는 행이 없습니다."
          : "선택한 기록에 이미 같은 수주업체가 입력되어 있습니다.",
      );
      return;
    }
    if (
      mode === "overwrite" &&
      result.overwrittenCount > 0 &&
      !window.confirm(
        `이미 수주업체가 입력된 ${result.overwrittenCount}건도 ${company}(으)로 변경할까요?`,
      )
    ) {
      return;
    }
    const consolidated = mergeAwardImportRows(result.rows);
    setActivityImportRows(
      reviewActivityImportRows(consolidated.rows, true),
    );
    setActivityImportMergedCount(
      (current) => current + consolidated.mergedCount,
    );
    setActivityImportPage(1);
    setActivityImportError("");
    setToast(
      `${result.changedCount}건에 수주업체 ${company}을(를) 적용했습니다.`,
    );
  }

  async function handleActivityImportFile(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setActivityImportError("");
    setActivityImportProgress("");
    setGoogleSheetAnalysis(null);
    setActivityImportPage(1);
    if (file.size > 12 * 1024 * 1024) {
      setActivityImportFileName("");
      setActivityImportRows([]);
      setActivityImportError("12MB 이하의 엑셀 또는 CSV 파일을 선택해 주세요.");
      return;
    }
    try {
      const [parsedRows, catalog] = await Promise.all([
        parseActivityImportFile(file, {
          awardMode: creatingAward,
        }),
        ensureBudgetReviewCatalog(),
      ]);
      const consolidated = creatingAward
        ? mergeAwardImportRows(parsedRows)
        : { rows: parsedRows, mergedCount: 0 };
      setActivityImportFileName(file.name);
      setActivityImportMergedCount(consolidated.mergedCount);
      setActivityImportPage(1);
      setActivityImportRows(
        reviewActivityImportRows(consolidated.rows, false, catalog),
      );
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

  async function analyzeGoogleSheet() {
    const url = googleSheetUrl.trim();
    if (!url || googleSheetLoading) {
      setActivityImportError("공유된 구글 시트 링크를 입력해 주세요.");
      return;
    }
    try {
      setGoogleSheetLoading(true);
      setActivityImportError("");
      setActivityImportProgress("구글 시트의 기관과 중복 항목을 분석하는 중입니다.");
      const response = await fetch("/api/google-sheets/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = (await response.json()) as GoogleSheetAnalysis & {
        rows?: ActivityImportRow[];
        error?: string;
      };
      if (!response.ok || !payload.rows) {
        throw new Error(payload.error || "구글 시트를 분석하지 못했습니다.");
      }
      setGoogleSheetAnalysis({
        sheetTitle: payload.sheetTitle,
        spreadsheetId: payload.spreadsheetId,
        gid: payload.gid,
        stats: payload.stats,
      });
      setActivityImportFileName(`구글 시트 · ${payload.sheetTitle}`);
      const consolidated = mergeAwardImportRows(payload.rows);
      const catalog = await ensureBudgetReviewCatalog();
      setActivityImportRows(
        reviewActivityImportRows(consolidated.rows, false, catalog),
      );
      setActivityImportMergedCount(consolidated.mergedCount);
      setActivityImportPage(1);
    } catch (caught) {
      setGoogleSheetAnalysis(null);
      setActivityImportRows([]);
      setActivityImportError(
        caught instanceof Error
          ? caught.message
          : "구글 시트를 분석하지 못했습니다.",
      );
    } finally {
      setGoogleSheetLoading(false);
      setActivityImportProgress("");
    }
  }

  function updateGoogleSheetImportDate(rowNumber: number, activityDate: string) {
    setActivityImportRows((current) =>
      current.map((row) => {
        if (row.rowNumber !== rowNumber) return row;
        const errors = row.errors.filter(
          (message) => !message.includes("계약 일자"),
        );
        if (!activityDate) errors.push("계약 일자를 확인해 주세요.");
        return {
          ...row,
          values: {
            ...row.values,
            activityDate,
            dateConfidence: activityDate ? "확정" : "미확인",
          },
          errors,
          duplicate: false,
          selected: Boolean(activityDate) && errors.length === 0,
        };
      }),
    );
  }

  function updateActivityImportBudget(rowNumber: number, groupId: number) {
    setActivityImportRows((current) =>
      current.map((row) => {
        if (row.rowNumber !== rowNumber) return row;
        const option = budgetReviewCatalog.find((item) => item.id === groupId);
        if (!option) {
          return {
            ...row,
            budgetResolvedName: "",
            budgetGroupId: null,
            budgetMatchStatus: "unclassified",
            budgetMatchMethod: "user-kept-unclassified",
            budgetKind: "",
            budgetAmountMode: "",
            selected:
              !row.duplicate &&
              (creatingAward
                ? Boolean(row.values.organization.trim())
                : row.errors.length === 0),
          };
        }
        return {
          ...row,
          budgetResolvedName: option.canonicalName,
          budgetGroupId: option.id,
          budgetMatchStatus: "auto",
          budgetMatchMethod: "user-confirmed",
          budgetKind: option.budgetKind,
          budgetAmountMode: option.amountMode,
          selected:
            !row.duplicate &&
            (creatingAward
              ? Boolean(row.values.organization.trim())
              : row.errors.length === 0),
        };
      }),
    );
  }

  function selectImportableActivityRows() {
    setActivityImportRows((current) =>
      current.map((row) => ({
        ...row,
        selected:
          !row.duplicate &&
          row.budgetMatchStatus !== "review" &&
          (creatingAward
            ? Boolean(row.values.organization.trim())
            : row.errors.length === 0),
      })),
    );
  }

  function toggleAllActivityImportRows(selected: boolean) {
    setActivityImportRows((current) =>
      current.map((row) => ({
        ...row,
        selected:
          selected &&
          !row.duplicate &&
          row.budgetMatchStatus !== "review" &&
          (creatingAward
            ? Boolean(row.values.organization.trim())
            : row.errors.length === 0),
      })),
    );
  }

  async function saveActivityImportBatch(event: FormEvent) {
    event.preventDefault();
    const selectedRows = activityImportRows.filter(
      (row) =>
        row.selected &&
        !row.duplicate &&
        row.budgetMatchStatus !== "review" &&
        (creatingAward
          ? Boolean(row.values.organization.trim())
          : row.errors.length === 0),
    );
    if (!selectedRows.length || activityImportSaving) {
      setActivityImportError("저장할 기록을 한 건 이상 선택해 주세요.");
      return;
    }
    const savedRows = new Set<number>();
    const failedRows = new Map<number, string>();
    setActivityImportSaving(true);
    setActivityImportError("");
    setActivityImportRows((current) =>
      current.map((row) =>
        selectedRows.some((selected) => selected.rowNumber === row.rowNumber)
          ? { ...row, saveState: "saving", saveError: "" }
          : row,
      ),
    );
    setActivityImportProgress(`0 / ${selectedRows.length}건 저장 중`);
    const institutionDecisions = new Map();
    const registeredPartners = registeredPartnerNames;
    const preparedRows = selectedRows.map((row) => {
      const preparedValues: ActivityImportValues = creatingAward
        ? prepareAwardImportValues(row.values, {
            today: toLocalDateValue(new Date()),
            registeredPartners,
          })
        : row.values;
      const sourceValues: ActivityImportValues =
        creatingAward && row.values.sourceChat.startsWith("구글 시트 연동|")
          ? { ...preparedValues, sourceChat: row.values.sourceChat }
          : preparedValues;
      const importedBudgetAmount = sourceValues.budgetAmount.trim();
      const hasImportedBudgetAmount =
        hasExplicitBudgetAmount(importedBudgetAmount);
      const importedSelfBudget =
        row.budgetKind === "self" &&
        row.budgetAmountMode === "quote_auto";
      const importValues = {
        ...sourceValues,
        budgetType: row.budgetResolvedName || row.budgetOriginalName,
        budgetOriginalName: row.budgetOriginalName,
        budgetGroupId: row.budgetGroupId,
        budgetMatchStatus: row.budgetMatchStatus,
        budgetMatchMethod: row.budgetMatchMethod,
        budgetRequestId: null,
        budgetKind: row.budgetKind,
        budgetAmountMode:
          importedSelfBudget && hasImportedBudgetAmount
            ? "manual"
            : row.budgetAmountMode,
        budgetInstitutionAmount: hasImportedBudgetAmount
          ? sourceValues.budgetAmount
          : "",
        budgetAmountOverride:
          importedSelfBudget && hasImportedBudgetAmount
            ? sourceValues.budgetAmount
            : "",
        budgetQuoteAmount: null,
        budgetAmountSource: hasImportedBudgetAmount ? "manual" : "missing",
      } as ActivityImportValues & Record<string, unknown>;
      return { row, importValues };
    });
    const totalBatches = Math.ceil(
      preparedRows.length / ACTIVITY_IMPORT_BATCH_SIZE,
    );

    for (
      let batchStart = 0;
      batchStart < preparedRows.length;
      batchStart += ACTIVITY_IMPORT_BATCH_SIZE
    ) {
      const batch = preparedRows.slice(
        batchStart,
        batchStart + ACTIVITY_IMPORT_BATCH_SIZE,
      );
      const batchNumber = Math.floor(batchStart / ACTIVITY_IMPORT_BATCH_SIZE) + 1;
      setActivityImportProgress(
        `${batchStart} / ${selectedRows.length}건 · ${batchNumber}/${totalBatches} 묶음 처리 중`,
      );
      try {
        const results = await saveRecordBulkWithRetry(
          batch.map(({ row, importValues }) => ({
            clientKey: String(row.rowNumber),
            method: row.existingRecordId ? "PUT" : "POST",
            body: row.existingRecordId
              ? {
                  id: row.existingRecordId,
                  ...(importValues as unknown as Record<string, unknown>),
                }
                : {
                    ...(importValues as unknown as Record<string, unknown>),
                    skipInstitutionStateLookup: creatingAward,
                  },
          })),
        );
        const resultByKey = new Map(
          results.map((result) => [result.clientKey, result]),
        );

        for (const { row, importValues } of batch) {
          let result = resultByKey.get(String(row.rowNumber));
          if (
            result?.status === 409 &&
            result.payload.needsInstitutionConfirmation
          ) {
            const confirmed = await fetchWithInstitutionConfirmation(
              "/api/records",
              {
                method: row.existingRecordId ? "PUT" : "POST",
                body: row.existingRecordId
                  ? {
                      id: row.existingRecordId,
                      ...(importValues as unknown as Record<string, unknown>),
                    }
                    : {
                        ...(importValues as unknown as Record<string, unknown>),
                        skipInstitutionStateLookup: creatingAward,
                      },
              },
              institutionDecisions,
            );
            result = {
              clientKey: String(row.rowNumber),
              status: confirmed.response.status,
              payload: confirmed.payload,
            };
          }
          if (!result || result.status < 200 || result.status >= 300) {
            failedRows.set(
              row.rowNumber,
              String(
                result?.payload.error ||
                  `${row.rowNumber}행을 저장하지 못했습니다.`,
              ),
            );
            continue;
          }
          const savedId = Number(
            (result.payload.record as Record<string, unknown> | undefined)?.id ??
              row.existingRecordId,
          );
          if (Number.isInteger(savedId) && savedId > 0) {
            const savedActivity = normalize({
              ...importValues,
              ...(result.payload.record ?? {}),
              id: savedId,
              createdByName: identity.displayName,
            });
            setRecords((current) => upsertActivity(current, savedActivity));
          }
          savedRows.add(row.rowNumber);
        }
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : "묶음 저장을 완료하지 못했습니다.";
        batch.forEach(({ row }) => failedRows.set(row.rowNumber, message));
      }
      const processedCount = Math.min(
        batchStart + batch.length,
        preparedRows.length,
      );
      setActivityImportProgress(
        `${batchNumber}/${totalBatches} 묶음 · ${processedCount}/${selectedRows.length}건 저장 중`,
      );
    }

    const remainingRows = activityImportRows
      .filter((row) => !savedRows.has(row.rowNumber))
      .map((row) => {
        const failedMessage = failedRows.get(row.rowNumber);
        return failedMessage
          ? {
              ...row,
              selected: true,
              saveState: "failed" as const,
              saveError: failedMessage,
            }
          : { ...row, saveState: undefined, saveError: "" };
      });
    setActivityImportRows(remainingRows);
    setActivityImportPage(1);
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

  async function registerMemberByEmail(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (memberInviteSaving) return;
    try {
      setMemberInviteSaving(true);
      const response = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: memberInviteEmail,
          displayName: memberInviteName,
        }),
      });
      const payload = (await response.json()) as {
        created?: boolean;
        approvedNow?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "구성원을 등록하지 못했습니다.");
      }
      setMemberInviteEmail("");
      setMemberInviteName("");
      await Promise.all([loadTeam(), loadActivityReviewAssignees()]);
      if (payload.approvedNow) {
        setSession((current) =>
          current
            ? { ...current, approvedCount: current.approvedCount + 1 }
            : current,
        );
      }
      setToast(
        payload.created
          ? "이메일 구성원을 승인 상태로 등록했습니다."
          : payload.approvedNow
            ? "기존 승인 요청을 승인 상태로 전환했습니다."
            : "이미 승인된 이메일의 이름을 갱신했습니다.",
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "구성원을 등록하지 못했습니다.",
      );
    } finally {
      setMemberInviteSaving(false);
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

  async function loadManagerAlerts(targetMemberId?: number | null) {
    if (managerAlertsLoadingRef.current) return;
    managerAlertsLoadingRef.current = true;
    try {
      setManagerAlertsLoading(true);
      const requestedMemberId = targetMemberId ?? managerAlertMemberId;
      const query = requestedMemberId
        ? `?memberId=${encodeURIComponent(String(requestedMemberId))}`
        : "";
      const response = await fetch(`/api/manager-alerts${query}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        acknowledgements?: ManagerAlertAcknowledgement[];
        members?: ManagerAlertMemberOption[];
        selectedMemberId?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error || "처리한 관리자 알림을 불러오지 못했습니다.",
        );
      }
      setManagerAlertAcknowledgements(payload.acknowledgements ?? []);
      setManagerAlertMembers(payload.members ?? []);
      setManagerAlertMemberId(
        Number(payload.selectedMemberId) > 0
          ? Number(payload.selectedMemberId)
          : requestedMemberId ?? null,
      );
      setManagerAlertsHydrated(true);
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "처리한 관리자 알림을 불러오지 못했습니다.",
      );
    } finally {
      managerAlertsLoadingRef.current = false;
      setManagerAlertsLoading(false);
    }
  }

  async function selectManagerAlertMember(memberId: number) {
    if (
      !Number.isInteger(memberId) ||
      memberId < 1 ||
      memberId === managerAlertMemberId
    ) {
      return;
    }
    setManagerAlertMemberId(memberId);
    setManagerAlertAcknowledgements([]);
    setManagerAlertsHydrated(false);
    setSelectedOrganizations([]);
    setManagerPage(1);
    await loadManagerAlerts(memberId);
  }

  async function loadEquipmentQuoteSummaries() {
    if (equipmentQuoteSummariesLoadingRef.current) return;
    equipmentQuoteSummariesLoadingRef.current = true;
    try {
      const summaries = await requestEquipmentQuoteSummaries();
      setEquipmentQuoteSummaries(summaries);
      setEquipmentQuoteSummariesHydrated(true);
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "등록 견적 현황을 불러오지 못했습니다.",
      );
    } finally {
      equipmentQuoteSummariesLoadingRef.current = false;
    }
  }

  async function loadIntegration() {
    try {
      const [openAIResponse, kakaoResponse, schoolDirectoryResponse] =
        await Promise.all([
          fetch("/api/openai-settings", { cache: "no-store" }),
          fetch("/api/map/config", { cache: "no-store" }),
          fetch("/api/school-directory-settings", { cache: "no-store" }),
        ]);
      const openAIPayload =
        (await openAIResponse.json()) as OpenAISettingsStatus & {
          error?: string;
        };
      const kakaoPayload =
        (await kakaoResponse.json()) as KakaoSettingsStatus & {
          error?: string;
        };
      const schoolDirectoryPayload =
        (await schoolDirectoryResponse.json()) as SchoolDirectorySettingsStatus & {
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
      if (!schoolDirectoryResponse.ok) {
        throw new Error(
          schoolDirectoryPayload.error ||
            "나이스 학교정보 API 설정을 불러오지 못했습니다.",
        );
      }
      setOpenAISettings(openAIPayload);
      setOpenAIModel(openAIPayload.model || "gpt-5.4-mini");
      setOpenAIApiKey("");
      setOpenAIConnectionMessage("");
      setKakaoSettings(kakaoPayload);
      setKakaoJavascriptKey("");
      setKakaoConnectionMessage("");
      setSchoolDirectorySettings(schoolDirectoryPayload);
      setSchoolDirectoryApiKey("");
      setSchoolDirectoryConnectionMessage("");
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

  async function manageSchoolDirectorySettings(
    action: "test" | "save" | "revert",
  ) {
    if (action !== "revert" && schoolDirectoryApiKey.trim().length < 8) {
      setSchoolDirectoryConnectionMessage("나이스 인증키를 다시 확인해 주세요.");
      return;
    }
    if (
      action === "revert" &&
      !window.confirm("등록한 키를 지우고 서버의 기존 나이스 키로 되돌릴까요?")
    ) {
      return;
    }
    try {
      setSchoolDirectorySettingsBusy(true);
      setSchoolDirectoryConnectionMessage("");
      const response = await fetch("/api/school-directory-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, apiKey: schoolDirectoryApiKey }),
      });
      const payload = (await response.json()) as {
        keyLast4?: string;
        status?: SchoolDirectorySettingsStatus;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "학교정보 API 설정을 처리하지 못했습니다.");
      }
      if (action === "test") {
        setSchoolDirectoryConnectionMessage(
          `학교정보 연결 확인 완료 · 키 끝 ${payload.keyLast4 || ""}`,
        );
        return;
      }
      if (payload.status) setSchoolDirectorySettings(payload.status);
      setSchoolDirectoryApiKey("");
      setSchoolDirectoryConnectionMessage(
        action === "save"
          ? "나이스 학교정보 키를 저장했습니다."
          : "서버의 기존 나이스 키로 되돌렸습니다.",
      );
      setToast(
        action === "save"
          ? "전국 학교정보 연결을 적용했습니다."
          : "서버의 기존 학교정보 설정을 사용합니다.",
      );
    } catch (caught) {
      setSchoolDirectoryConnectionMessage(
        caught instanceof Error
          ? caught.message
          : "학교정보 API 설정을 처리하지 못했습니다.",
      );
    } finally {
      setSchoolDirectorySettingsBusy(false);
    }
  }

  async function syncSchoolDirectory() {
    try {
      setSchoolDirectorySyncBusy(true);
      setSchoolDirectoryConnectionMessage(
        "전국 학교정보를 내부 학교정보로 최신화하고 있습니다.",
      );
      let page: number | null = 1;
      while (page) {
        const response = await fetch("/api/school-directory/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "directory",
            page,
            pageSize: 500,
          }),
        });
        const payload = (await response.json()) as {
          error?: string;
          nextPage?: number | null;
          processed?: number;
          totalCount?: number;
        };
        if (!response.ok) {
          throw new Error(payload.error || "학교정보 최신화에 실패했습니다.");
        }
        setSchoolDirectoryConnectionMessage(
          `학교정보 ${Number(payload.processed || 0).toLocaleString("ko-KR")} / ${Number(payload.totalCount || 0).toLocaleString("ko-KR")}곳을 확인했습니다.`,
        );
        page = payload.nextPage ?? null;
      }

      let after: string | null = "";
      let linkedCount = 0;
      while (after !== null) {
        const response = await fetch("/api/school-directory/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "links",
            after,
            limit: 100,
          }),
        });
        const payload = (await response.json()) as {
          error?: string;
          nextCursor?: string | null;
          linkedCount?: number;
        };
        if (!response.ok) {
          throw new Error(
            payload.error || "기존 학교 연결을 보완하지 못했습니다.",
          );
        }
        linkedCount = Number(payload.linkedCount || linkedCount);
        setSchoolDirectoryConnectionMessage(
          `기존 학교 ${linkedCount.toLocaleString("ko-KR")}곳의 공식 정보를 연결했습니다.`,
        );
        after = payload.nextCursor ?? null;
      }

      const statusResponse = await fetch("/api/school-directory/sync", {
        cache: "no-store",
      });
      const status = (await statusResponse.json()) as
        | SchoolDirectorySettingsStatus
        | { error?: string };
      if (!statusResponse.ok || !("configured" in status)) {
        throw new Error(
          ("error" in status && status.error) ||
            "학교정보 최신화 결과를 확인하지 못했습니다.",
        );
      }
      setSchoolDirectorySettings(status);
      setSchoolDirectoryConnectionMessage(
        `학교정보 ${Number(status.directoryCount || 0).toLocaleString("ko-KR")}곳, 기존 기관 ${Number(status.linkedCount || 0).toLocaleString("ko-KR")}곳 연결을 완료했습니다.`,
      );
      setToast("학교 대표전화 연결을 최신 상태로 보완했습니다.");
    } catch (caught) {
      setSchoolDirectoryConnectionMessage(
        caught instanceof Error
          ? caught.message
          : "학교정보 최신화에 실패했습니다.",
      );
    } finally {
      setSchoolDirectorySyncBusy(false);
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
    setAwardExecutionFilter("전체 사업방식");
    setAwardManagerFilter("전체 담당자");
    setBudgetGroupFilter("all");
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
      nextView === "dashboard" || nextView === "owner-performance"
        ? baseUrl
        : `${baseUrl}#${nextView}`;
    const sameView =
      view === nextView &&
      recordDateScope === nextRecordDateScope &&
      activeAwardsOnly === nextActiveAwardsOnly &&
      followupDueSoonOnly === nextFollowupDueSoonOnly;
    window.history[
      options.replace || sameView ? "replaceState" : "pushState"
    ](historyState, "", nextUrl);
  }

  async function selectView(
    nextView: View,
    options: { accountingTab?: AccountingWorkspaceTab } = {},
  ) {
    if (nextView === "trash") {
      navigateTo("backup", { replace: true });
      setMobileNav(false);
      return;
    }
    if (
      (presentationMode && presentationHiddenViews.has(nextView)) ||
      ((nextView === "organizations" || nextView === "records") &&
        !canManageRecords) ||
      (nextView === "team" && !canManageMembers) ||
      (nextView === "accounting" && !canManageAccounting) ||
      (nextView === "analytics" && !canViewAnalytics) ||
      (nextView === "owner-performance" && !isPrimaryOwner) ||
      (nextView === "inventory" && !canManageInventory) ||
      (nextView === "integration" && !canManageIntegration) ||
      (nextView === "backup" && !canManageBackup && !canManageTrash)
    ) {
      navigateTo("dashboard", { replace: true });
      setMobileNav(false);
      setToast("이 메뉴를 사용할 권한이 없습니다.");
      return;
    }
    if (nextView === "accounting") {
      setAccountingInitialTab(options.accountingTab ?? "collections");
    }
    if (nextView === "organizations") {
      setManagerIssueFilter("attention");
      setManagerSearch("");
      setManagerAdminSection("alerts");
      setSelectedOrganizations([]);
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
      await Promise.all([
        loadManagerAlerts(),
        loadEquipmentQuoteSummaries(),
      ]);
    }
    if (nextView === "integration" && canManageIntegration) {
      await loadIntegration();
    }
  }

  function persistMenuOrder(workspace: View[], management: View[]) {
    if (!session) return;
    window.localStorage.setItem(
      `${menuOrderStoragePrefix}${session.member.id}`,
      JSON.stringify({ workspace, management }),
    );
  }

  function moveMenuItem(group: MenuGroup, id: View, step: -1 | 1) {
    const items =
      group === "workspace" ? orderedWorkspaceNavItems : orderedManagementNavItems;
    const currentIndex = items.findIndex((item) => item.id === id);
    const nextIndex = currentIndex + step;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= items.length) return;
    const nextOrder = items.map((item) => item.id);
    [nextOrder[currentIndex], nextOrder[nextIndex]] = [
      nextOrder[nextIndex],
      nextOrder[currentIndex],
    ];
    if (group === "workspace") {
      setWorkspaceNavOrder(nextOrder);
      persistMenuOrder(nextOrder, managementNavOrder);
    } else {
      setManagementNavOrder(nextOrder);
      persistMenuOrder(workspaceNavOrder, nextOrder);
    }
  }

  function reorderMenuItem(group: MenuGroup, sourceId: View, targetId: View) {
    if (sourceId === targetId) return;
    const items =
      group === "workspace" ? orderedWorkspaceNavItems : orderedManagementNavItems;
    const nextOrder = items.map((item) => item.id);
    const sourceIndex = nextOrder.indexOf(sourceId);
    const targetIndex = nextOrder.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, sourceId);
    if (group === "workspace") {
      setWorkspaceNavOrder(nextOrder);
      persistMenuOrder(nextOrder, managementNavOrder);
    } else {
      setManagementNavOrder(nextOrder);
      persistMenuOrder(workspaceNavOrder, nextOrder);
    }
  }

  function clearMenuPointerTimer() {
    if (menuPointerTimerRef.current !== null) {
      window.clearTimeout(menuPointerTimerRef.current);
      menuPointerTimerRef.current = null;
    }
  }

  function beginMenuPointerDrag(
    group: MenuGroup,
    id: View,
    pointerId: number,
    pointerType: string,
    startX: number,
    startY: number,
    handle: HTMLButtonElement,
  ) {
    if (!menuOrderEditing || pointerType === "mouse") return;
    clearMenuPointerTimer();
    menuPointerDragRef.current = {
      group,
      id,
      pointerId,
      startX,
      startY,
      active: false,
    };
    menuPointerTimerRef.current = window.setTimeout(() => {
      const pending = menuPointerDragRef.current;
      if (!pending || pending.pointerId !== pointerId) return;
      pending.active = true;
      setDraggingMenu({ group, id });
      handle.setPointerCapture(pointerId);
      menuPointerTimerRef.current = null;
    }, 280);
  }

  function updateMenuPointerDrag(pointerId: number, clientX: number, clientY: number) {
    const current = menuPointerDragRef.current;
    if (!current || current.pointerId !== pointerId) return;
    if (!current.active) {
      if (
        Math.abs(clientX - current.startX) > 8 ||
        Math.abs(clientY - current.startY) > 8
      ) {
        clearMenuPointerTimer();
        menuPointerDragRef.current = null;
      }
      return;
    }
    const target = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>(".nav-sort-row[data-menu-id]");
    const targetId = target?.dataset.menuId as View | undefined;
    if (
      targetId &&
      target?.dataset.menuGroup === current.group &&
      targetId !== current.id
    ) {
      reorderMenuItem(current.group, current.id, targetId);
    }
  }

  function finishMenuPointerDrag(pointerId?: number) {
    if (
      pointerId !== undefined &&
      menuPointerDragRef.current?.pointerId !== pointerId
    ) {
      return;
    }
    clearMenuPointerTimer();
    menuPointerDragRef.current = null;
    setDraggingMenu(null);
  }

  function resetMenuOrder() {
    const workspace = navItems.map((item) => item.id);
    const management = managementNavItems.map((item) => item.id);
    setWorkspaceNavOrder(workspace);
    setManagementNavOrder(management);
    persistMenuOrder(workspace, management);
    setToast("메뉴 순서를 기본값으로 되돌렸습니다.");
  }

  function updatePresentationMode(enabled: boolean) {
    if (!isOwner) return;
    if (enabled) {
      window.sessionStorage.setItem(presentationModeStorageKey, "active");
      if (presentationHiddenViews.has(view)) {
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
        ? "시연 모드를 시작했습니다. 팀 업무 현황과 관리자 영업점검을 숨겼습니다."
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

  function imageAttachmentId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function addAiImageFiles(files: File[]) {
    setAiImageError("");
    if (!canUseImageInput) {
      setAiImageError("사진 분석 권한이 없습니다.");
      return;
    }
    if (aiImageAnalyzing) return;

    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) {
      setAiImageError("이미지 파일만 추가할 수 있습니다.");
      return;
    }
    const validFiles = imageFiles.filter((file) => file.size <= 10 * 1024 * 1024);
    if (validFiles.length !== imageFiles.length) {
      setAiImageError("사진은 한 장당 10MB 이하로 추가해 주세요.");
    }
    const remainingCount = Math.max(0, 5 - aiImageAttachments.length);
    const filesToAdd = validFiles.slice(0, remainingCount);
    if (!filesToAdd.length) {
      setAiImageError("사진은 한 번에 최대 5장까지 분석할 수 있습니다.");
      return;
    }
    if (validFiles.length > remainingCount) {
      setAiImageError("사진은 한 번에 최대 5장까지만 추가했습니다.");
    }

    const nextAttachments = filesToAdd.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      aiImagePreviewUrlsRef.current.push(previewUrl);
      return {
        id: imageAttachmentId(),
        file,
        previewUrl,
      };
    });
    setAiImageAttachments((current) => [...current, ...nextAttachments]);
  }

  function removeAiImageAttachment(id: string) {
    setAiImageAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        aiImagePreviewUrlsRef.current =
          aiImagePreviewUrlsRef.current.filter(
            (url) => url !== target.previewUrl,
          );
      }
      return current.filter((attachment) => attachment.id !== id);
    });
  }

  function clearAiImageAttachments() {
    setAiImageAttachments((current) => {
      current.forEach((attachment) =>
        URL.revokeObjectURL(attachment.previewUrl),
      );
      const clearedUrls = new Set(
        current.map((attachment) => attachment.previewUrl),
      );
      aiImagePreviewUrlsRef.current = aiImagePreviewUrlsRef.current.filter(
        (url) => !clearedUrls.has(url),
      );
      return [];
    });
  }

  function handleAiImagePicker(event: ChangeEvent<HTMLInputElement>) {
    addAiImageFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleAiImagePaste(event: ReactClipboardEvent<HTMLElement>) {
    if (!canUseImageInput) return;
    const pastedImages = Array.from(event.clipboardData.items)
      .filter(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      )
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!pastedImages.length) return;
    event.preventDefault();
    addAiImageFiles(pastedImages);
  }

  function handleAiImageDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!canUseImageInput) return;
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setAiImageDragActive(true);
  }

  function handleAiImageDragLeave(event: ReactDragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }
    setAiImageDragActive(false);
  }

  function handleAiImageDrop(event: ReactDragEvent<HTMLElement>) {
    if (!canUseImageInput) return;
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    setAiImageDragActive(false);
    addAiImageFiles(Array.from(event.dataTransfer.files));
  }

  function loadAiImage(file: File) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("휴대폰에서 선택한 사진을 읽지 못했습니다."));
      };
      image.src = url;
    });
  }

  async function prepareAiImageForUpload(file: File) {
    const directlySupported = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ].includes(file.type);
    if (directlySupported && file.size <= 5 * 1024 * 1024) {
      return file;
    }

    const image = await loadAiImage(file);
    const maximumSide = 2_000;
    const scale = Math.min(
      1,
      maximumSide / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("사진을 분석용으로 준비하지 못했습니다.");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) {
      throw new Error("사진을 분석용으로 변환하지 못했습니다.");
    }
    const baseName = file.name.replace(/\.[^.]+$/, "") || "pasted-image";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  }

  async function analyzeAiImages() {
    if (!canUseImageInput || !aiImageAttachments.length || aiImageAnalyzing) return;
    setAiImageAnalyzing(true);
    setAiImageError("");
    try {
      const requestData = new FormData();
      const preparedFiles = await Promise.all(
        aiImageAttachments.map((attachment) =>
          prepareAiImageForUpload(attachment.file),
        ),
      );
      preparedFiles.forEach((file) => requestData.append("images", file));
      const response = await fetch("/api/ai/images", {
        method: "POST",
        body: requestData,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
        discarded?: boolean;
      };
      if (payload.discarded) return;
      if (!response.ok || !payload.text?.trim()) {
        throw new Error(
          payload.error ||
            "사진에서 영업 기록을 읽지 못했습니다. 다시 시도해 주세요.",
        );
      }
      const analyzedText = payload.text.trim();
      setAiDraft((current) =>
        current.trim()
          ? `${current.trimEnd()}\n${analyzedText}`
          : analyzedText,
      );
      clearAiImageAttachments();
      window.setTimeout(() => aiDraftInputRef.current?.focus(), 0);
    } catch (error) {
      setAiImageError(
        error instanceof Error
          ? error.message
          : "사진을 분석하지 못했습니다.",
      );
    } finally {
      setAiImageAnalyzing(false);
    }
  }

  function clearVoiceTimers() {
    if (voiceTimerRef.current !== null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    if (voiceIdleReleaseTimerRef.current !== null) {
      window.clearTimeout(voiceIdleReleaseTimerRef.current);
      voiceIdleReleaseTimerRef.current = null;
    }
  }

  function releaseVoiceStream() {
    clearVoiceTimers();
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
  }

  function scheduleVoiceStreamRelease() {
    if (voiceIdleReleaseTimerRef.current !== null) {
      window.clearTimeout(voiceIdleReleaseTimerRef.current);
    }
    voiceIdleReleaseTimerRef.current = window.setTimeout(() => {
      releaseVoiceStream();
    }, 3 * 60 * 1000);
  }

  function preferredVoiceMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function voiceFileExtension(mimeType: string) {
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("ogg")) return "ogg";
    return "webm";
  }

  function microphoneErrorMessage(error: unknown) {
    if (!(error instanceof DOMException)) {
      return "마이크를 시작하지 못했습니다. 다시 시도해 주세요.";
    }
    if (error.name === "NotAllowedError") {
      return "마이크 권한이 차단되었습니다. 브라우저 주소창의 권한 설정에서 마이크를 허용해 주세요.";
    }
    if (error.name === "NotFoundError") {
      return "사용할 수 있는 마이크를 찾지 못했습니다.";
    }
    if (error.name === "NotReadableError") {
      return "다른 앱이 마이크를 사용 중입니다. 통화나 녹음 앱을 닫고 다시 시도해 주세요.";
    }
    return "마이크를 시작하지 못했습니다. 다시 시도해 주세요.";
  }

  async function transcribeVoiceRecording(audio: Blob) {
    try {
      if (audio.size < 500) {
        throw new Error("녹음된 음성이 너무 짧습니다. 다시 녹음해 주세요.");
      }
      const requestData = new FormData();
      const extension = voiceFileExtension(audio.type);
      requestData.append(
        "audio",
        audio,
        `whizzup-voice-${Date.now()}.${extension}`,
      );
      const response = await fetch("/api/ai/transcribe", {
        method: "POST",
        body: requestData,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };
      if (!response.ok || !payload.text?.trim()) {
        throw new Error(
          payload.error ||
            "음성을 글자로 바꾸지 못했습니다. 다시 시도해 주세요.",
        );
      }
      const transcript = payload.text.trim();
      setAiDraft((current) =>
        current.trim() ? `${current.trimEnd()}\n${transcript}` : transcript,
      );
      window.setTimeout(() => aiDraftInputRef.current?.focus(), 0);
    } catch (error) {
      setVoiceError(
        error instanceof Error
          ? error.message
          : "음성을 글자로 바꾸지 못했습니다.",
      );
    } finally {
      setVoiceRecordingStatus("idle");
      scheduleVoiceStreamRelease();
    }
  }

  function stopVoiceRecording() {
    const recorder = voiceRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    if (voiceTimerRef.current !== null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    setVoiceRecordingStatus("transcribing");
    recorder.stop();
  }

  async function startVoiceRecording() {
    setVoiceError("");
    if (!canUseVoiceInput) {
      setVoiceError("음성 입력 권한이 없습니다.");
      return;
    }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setVoiceError(
        "현재 브라우저에서는 음성 입력을 지원하지 않습니다. 최신 Chrome 또는 Safari에서 이용해 주세요.",
      );
      return;
    }

    try {
      if (voiceIdleReleaseTimerRef.current !== null) {
        window.clearTimeout(voiceIdleReleaseTimerRef.current);
        voiceIdleReleaseTimerRef.current = null;
      }
      const reusableStream = voiceStreamRef.current;
      const hasLiveTrack = Boolean(
        reusableStream
          ?.getAudioTracks()
          .some((track) => track.readyState === "live"),
      );
      const stream = hasLiveTrack
        ? reusableStream!
        : await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
      voiceStreamRef.current = stream;

      const mimeType = preferredVoiceMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      voiceChunksRef.current = [];
      voiceRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const recording = new Blob(voiceChunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        voiceChunksRef.current = [];
        voiceRecorderRef.current = null;
        if (Date.now() - voiceStartedAtRef.current < 900) {
          setVoiceRecordingStatus("idle");
          scheduleVoiceStreamRelease();
          return;
        }
        void transcribeVoiceRecording(recording);
      };
      recorder.start(500);
      voiceStartedAtRef.current = Date.now();
      setVoiceElapsedSeconds(0);
      setVoiceRecordingStatus("recording");
      voiceTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor(
          (Date.now() - voiceStartedAtRef.current) / 1000,
        );
        setVoiceElapsedSeconds(elapsed);
        if (elapsed >= 5 * 60) {
          stopVoiceRecording();
        }
      }, 1000);
    } catch (error) {
      releaseVoiceStream();
      setVoiceRecordingStatus("idle");
      setVoiceError(microphoneErrorMessage(error));
    }
  }

  async function toggleVoiceRecording() {
    if (!canUseVoiceInput) return;
    if (voiceRecordingStatus === "recording") {
      stopVoiceRecording();
      return;
    }
    if (voiceRecordingStatus === "idle") {
      await startVoiceRecording();
    }
  }

  function formatVoiceElapsed(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  async function startAiRecord() {
    const draft = aiDraft.trim();
    if (
      !draft ||
      aiOrganizing ||
      aiImageAnalyzing ||
      voiceRecordingStatus !== "idle"
    ) {
      return;
    }
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
          detailLevelPreference: aiDetailLevelPreference,
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
        const confirmedDrafts = organizedDrafts.map((item) =>
          normalizeAiDraft(item),
        );
        for (const confirmation of payload.schoolConfirmations ?? []) {
          const preview = confirmedDrafts[confirmation.draftIndex];
          if (!preview || !confirmation.candidates.length) continue;
          const decision = await requestOfficialSchoolDecision(confirmation);
          if (decision.useOriginal) continue;
          confirmedDrafts[confirmation.draftIndex] =
            applyOfficialSchoolDecision(
              preview,
              confirmation,
              decision.organization,
              decision.normalizeExistingAliases,
            );
        }
        const catalog = await ensureBudgetReviewCatalog();
        const resolvedDrafts = confirmedDrafts.map((preview) => {
          const fixedManager = records
            .filter(
              (record) =>
                institutionAliasKey(record.organization) ===
                  institutionAliasKey(preview.organization) &&
                record.businessRound === preview.businessRound &&
                record.progressManagerLocked &&
                record.progressManager !== "해당 없음",
            )
            .sort(
              (left, right) =>
                right.updatedAt.localeCompare(left.updatedAt) ||
                right.id - left.id,
            )[0]?.progressManager;
          const standardBudgetExcluded = ["협력사 수주", "타업체 수주"].includes(
            preview.awardStatus,
          );
          const partnerAward = preview.awardStatus === "협력사 수주";
          const resolved = {
            ...preview,
            ...applyBudgetCatalogResolution(
              preview,
              catalog,
              standardBudgetExcluded,
            ),
            progressManager: partnerAward
              ? "해당 없음"
              : fixedManager || session?.member.displayName || preview.progressManager,
          };
          const inheritedBudgets = canonicalBudgetsForBusinessRound(
            records,
            resolved.organization,
            resolved.businessRound,
            resolved.region,
          );
          return inheritedBudgets.length
            ? formWithActivityBudgets(resolved, inheritedBudgets)
            : formWithActivityBudgets(
                resolved,
                activityBudgetsFromRecord(
                  resolved as unknown as Record<string, unknown>,
                ),
              );
        });
        setAiPreviews(mergeAiDrafts(resolvedDrafts));
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
    const ambiguousBudgetPreview = aiPreviews.find(
      (preview) => preview.budgetMatchStatus === "review",
    );
    if (ambiguousBudgetPreview) {
      setToast(
        `${ambiguousBudgetPreview.organization || "기관"}의 예산명 후보가 여러 개입니다. 개별 확인·수정에서 표준 예산명을 선택해 주세요.`,
      );
      return;
    }
    const invalidDraft = aiPreviews.find(
      (preview) =>
        !preview.organization.trim() ||
        (["협력사 수주", "타업체 수주"].includes(preview.awardStatus) &&
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
            : `${invalidDraft.organization}의 수주업체를 확인해 주세요.`,
      );
      return;
    }

    let remaining = [...aiPreviews];
    let savedCount = 0;
    const equipmentFailedOrganizations: string[] = [];
    const institutionDecisions = new Map();
    const backgroundTasks: Promise<void>[] = [];
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
      setToast(`${savedCount}개 기관 기록을 저장했습니다.`);
      void refreshRecordsInBackground();
      void Promise.allSettled(backgroundTasks).then(() => {
        const failedParts = [
          equipmentFailedOrganizations.length
            ? `사업·품목 ${equipmentFailedOrganizations.length}곳`
            : "",
        ].filter(Boolean);
        setToast(
          failedParts.length
            ? `기록 저장은 완료했습니다. ${failedParts.join(", ")}은 다시 확인해 주세요.`
            : `${savedCount}개 기관 기록을 저장했습니다.`,
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
    if (
      inheritedFormOrganization &&
      institutionAliasKey(form.organization) !==
        institutionAliasKey(inheritedFormOrganization)
    ) {
      setToast("새 사업에서는 기관명을 변경할 수 없습니다. 기관명 수정은 기관 상세에서 진행해 주세요.");
      setForm((current) => ({ ...current, organization: inheritedFormOrganization }));
      return;
    }
    if (["협력사 수주", "타업체 수주"].includes(form.awardStatus) && !form.awardCompany.trim()) {
      setToast("협력사·타업체 수주의 수주업체를 입력해 주세요.");
      return;
    }
    if (form.awardStatus !== "타업체 수주" && form.executionType === "컨소" && !form.consortiumCompany.trim()) {
      setToast("컨소 업체명을 입력해 주세요.");
      return;
    }
    const sourceOrganization = formOrganizationSourceRef.current.trim();
    const institutionNameChanged = Boolean(
      editingId &&
        sourceOrganization &&
        sourceOrganization !== form.organization.trim(),
    );
    if (
      institutionNameChanged &&
      !window.confirm(
        "기관명을 변경하면 이 기관의 모든 과거 기록과 지도·사업 정보가 함께 변경됩니다. 계속하시겠습니까?",
      )
    ) {
      return;
    }
    let resolvedBusinessRound = form.businessRound;
    if (!editingId && form.businessRound === 1) {
      const organizationKey = institutionAliasKey(form.organization);
      const organizationRecords = records.filter(
        (record) =>
          institutionAliasKey(record.organization) === organizationKey &&
          !isPdfCampaignRegistration(record),
      );
      const hasCompletedBusiness = organizationRecords.some(
        (record) =>
          ["위즈업 수주", "협력사 수주"].includes(record.awardStatus) &&
          completedAwardStages.has(record.awardStage),
      );
      const isNewOpportunity = ["신규 접촉", "재영업 상담"].includes(
        normalizeSalesProgress(form.status, form.awardStatus),
      );
      if (hasCompletedBusiness && isNewOpportunity) {
        const nextRound =
          Math.max(1, ...organizationRecords.map((record) => record.businessRound)) + 1;
        if (
          window.confirm(
            `기존에 완료된 수주 사업이 있습니다.\n이번 기록을 ${nextRound}차 신규 사업으로 분리할까요?\n\n확인: 새 사업으로 분리\n취소: 기존 사업에 기록`,
          )
        ) {
          resolvedBusinessRound = nextRound;
        }
      }
    }
    try {
      setSaving(true);
      const formWithBudgetAmount: FormState = formBudgetStandardizationExcluded
        ? {
            ...form,
            budgetOriginalName: form.budgetOriginalName || form.budgetType,
            budgetGroupId: null,
            budgetMatchStatus: "excluded",
            budgetMatchMethod: "award-excluded",
            budgetRequestId: null,
            budgetKind: "",
            budgetAmountMode: "",
            budgetAmountOverride: "",
            budgetQuoteAmount: null,
            budgetAmountSource: hasExplicitBudgetAmount(form.budgetAmount)
              ? "manual"
              : "missing",
          }
        : formUsesQuoteAuto && !formUsesManualBudgetAmount
          ? {
              ...form,
              budgetAmount: formBudgetQuoteAmount !== null
                ? formatMoneyInput(`${formBudgetQuoteAmount}원`)
                : "",
              budgetInstitutionAmount: "",
              budgetQuoteAmount: formBudgetQuoteAmount,
              budgetAmountOverride: "",
              budgetAmountSource:
                formBudgetQuoteAmount !== null ? "auto" : "missing",
            }
          : {
              ...form,
              budgetInstitutionAmount: hasExplicitBudgetAmount(
                form.budgetAmount,
              )
                ? form.budgetAmount
                : "",
              budgetAmountMode: formIsSelfBudget
                ? hasExplicitBudgetAmount(form.budgetAmount)
                  ? "manual"
                  : "quote_auto"
                : form.budgetAmountMode,
              budgetAmountOverride: formIsSelfBudget
                ? hasExplicitBudgetAmount(
                    form.budgetAmountOverride || form.budgetAmount,
                  )
                  ? form.budgetAmountOverride || form.budgetAmount
                  : ""
                : "",
              budgetAmountSource: hasExplicitBudgetAmount(form.budgetAmount)
                ? "manual"
                : "missing",
            };
      const formWithAllBudgets = formWithActivityBudgets(
        formWithBudgetAmount,
        [
          {
            ...(formWithBudgetAmount.budgets[0] ?? emptyActivityBudget()),
            budgetType: formWithBudgetAmount.budgetType,
            budgetAmount: formWithBudgetAmount.budgetAmount,
            budgetOriginalName:
              formWithBudgetAmount.budgetOriginalName ||
              formWithBudgetAmount.budgetType,
            budgetGroupId: formWithBudgetAmount.budgetGroupId ?? null,
            budgetMatchStatus:
              formWithBudgetAmount.budgetMatchStatus || "unclassified",
            budgetMatchMethod: formWithBudgetAmount.budgetMatchMethod || "",
            budgetRequestId: formWithBudgetAmount.budgetRequestId ?? null,
            budgetKind: formWithBudgetAmount.budgetKind || "",
            budgetAmountMode: formWithBudgetAmount.budgetAmountMode || "",
            budgetInstitutionAmount:
              formWithBudgetAmount.budgetInstitutionAmount || "",
            budgetQuoteAmount: formWithBudgetAmount.budgetQuoteAmount ?? null,
            budgetAmountOverride:
              formWithBudgetAmount.budgetAmountOverride || "",
            budgetAmountSource:
              formWithBudgetAmount.budgetAmountSource || "missing",
          },
          ...formWithBudgetAmount.budgets.slice(1),
        ],
      );
      const isAwardManagementRecord =
        creatingAward || form.sourceChat === "수주 관리 직접 등록";
      const normalizedFormBase: FormState = isAwardManagementRecord
        ? {
            ...formWithAllBudgets,
            businessRound: resolvedBusinessRound,
            topic: form.topic.trim() || "수주",
            executionType:
              form.awardStatus === "타업체 수주"
                ? "해당 없음"
                : form.consortiumCompany.trim()
                  ? "컨소"
                  : "직영",
            consortiumCompany:
              form.awardStatus === "타업체 수주"
                ? ""
                : form.consortiumCompany.trim(),
            progressManager: form.progressManager.trim() || "해당 없음",
          }
        : { ...formWithAllBudgets, businessRound: resolvedBusinessRound };
      const normalizedContacts = normalizeInstitutionContacts(
        normalizedFormBase.contacts,
        {
          role: normalizedFormBase.contactRole,
          name: normalizedFormBase.contactName,
          phone: normalizedFormBase.contactPhone,
          email: normalizedFormBase.contactEmail,
        },
      );
      const primaryContact = primaryInstitutionContact(normalizedContacts);
      const normalizedHiddenFields: FormState = {
        ...normalizedFormBase,
        detailKeyFacts: normalizedFormBase.detailKeyFacts
          .map((fact) => ({
            label: fact.label.trim(),
            value: fact.value.trim(),
          }))
          .filter((fact) => fact.label || fact.value)
          .filter((fact) => !isDerivedBudgetDetailFact(fact.label)),
        detailSections: normalizedFormBase.detailSections
          .map((section) => ({
            title: section.title.trim(),
            items: section.items.map((item) => item.trim()).filter(Boolean),
          }))
          .filter((section) => section.title || section.items.length)
          .filter((section) => !isDerivedBudgetDetailSection(section.title)),
        contacts: normalizedContacts,
        contactRole: primaryContact.role,
        contactName: primaryContact.name,
        contactPhone: primaryContact.phone,
        contactEmail: primaryContact.email,
        activityType: simplifiedActivityType(normalizedFormBase.activityType),
        contactMethod: contactMethodForActivityType(
          normalizedFormBase.activityType,
        ),
        temperature: normalizedFormBase.temperature || "중간",
        sourceChat: normalizedFormBase.sourceChat || "직접 입력",
      };
      const normalizedCompletion: FormState =
        isCompletedAwardStage(normalizedHiddenFields.awardStage)
          ? {
              ...normalizedHiddenFields,
              awardCompletedDate:
                normalizedHiddenFields.awardCompletedDate ||
                toLocalDateValue(new Date()),
              followUpRequired: false,
              followUpDate: "",
            }
          : { ...normalizedHiddenFields, awardCompletedDate: "" };
      const normalizedForm: FormState = {
        ...normalizedCompletion,
        status: normalizedCompletion.status || "상담 진행",
      };
      const awardStageManual = true;
      const baselineOrganization = institutionNameChanged
        ? sourceOrganization
        : normalizedForm.organization;
      const baselineBudgets = canonicalBudgetsForBusinessRound(
        records,
        baselineOrganization,
        normalizedForm.businessRound,
        normalizedForm.region,
      );
      const syncBusinessRoundBudgets =
        baselineBudgets.length > 0 &&
        !sameActivityBudgets(baselineBudgets, normalizedForm.budgets);
      const baseRecordPayload = sourceOrganization
        ? {
            ...normalizedForm,
            sourceOrganization,
            awardStageManual,
            syncBusinessRoundBudgets,
          }
        : { ...normalizedForm, awardStageManual, syncBusinessRoundBudgets };
      const lockedRecordPayload = inheritedFormOrganization
        ? { ...baseRecordPayload, lockedOrganization: inheritedFormOrganization }
        : baseRecordPayload;
      const recordPayload = institutionNameChanged
        ? {
            ...lockedRecordPayload,
            confirmInstitutionRename: true,
            standardBudgetOnly: true,
          }
        : { ...lockedRecordPayload, standardBudgetOnly: true };
      const { response, payload } =
        await fetchWithInstitutionConfirmation("/api/records", {
          method: editingId ? "PUT" : "POST",
          body: editingId ? { id: editingId, ...recordPayload } : recordPayload,
        });
      if (!response.ok) {
        throw new Error(String(payload.error || "저장하지 못했습니다."));
      }
      const aiEquipmentPreview = normalizedForm as AiPreview;
      const activityId = Number(payload.record?.id ?? editingId);
      const originalRecord = editingId
        ? records.find((record) => record.id === editingId)
        : null;
      const savedActivity =
        Number.isInteger(activityId) && activityId > 0
          ? normalize({
              ...normalizedForm,
              ...(payload.record ?? {}),
              id: activityId,
              createdByName:
                originalRecord?.createdByName || identity.displayName,
              updatedByName: identity.displayName,
            })
          : null;
      if (savedActivity) {
        setRecords((current) => upsertActivity(current, savedActivity));
      }
      if (syncBusinessRoundBudgets) {
        void refreshRecordsInBackground();
      }
      setModalOpen(false);
      if (editingId && editReturnOrganization) {
        setDetailBusinessRound(normalizedForm.businessRound);
        setDetailOrganization(
          savedActivity?.organization || normalizedForm.organization,
        );
      }
      setToast(
        editingId
          ? "기록을 수정했습니다."
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
          setToast(
            !equipmentSaved
              ? "기록은 저장했습니다. 사업·품목은 기관 상세에서 확인해 주세요."
              : editingId
                ? "기록과 연결 사업을 수정했습니다."
                : aiEquipmentPreview.equipmentItems?.length
                  ? "상세 기록과 제안·수주 품목을 저장했습니다."
                  : "상세 기록을 저장했습니다.",
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
      setToast("기록을 휴지통으로 이동했습니다. 관리자가 30일 안에 복원할 수 있습니다.");
      return true;
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "삭제하지 못했습니다.");
      return false;
    }
  }

  function openAwardDelete(scope: "selected" | "filtered") {
    const count =
      scope === "selected" ? selectedAwardIds.length : displayedRecords.length;
    if (!isOwner) {
      setToast("수주 기록 삭제는 관리자만 사용할 수 있습니다.");
      return;
    }
    if (!count) {
      setToast(
        scope === "selected"
          ? "삭제할 수주 기록을 선택해 주세요."
          : "현재 조건에 삭제할 수주 기록이 없습니다.",
      );
      return;
    }
    if (count > 500) {
      setToast("한 번에 최대 500건까지 삭제할 수 있습니다. 검색 조건을 좁혀 주세요.");
      return;
    }
    setAwardDeleteScope(scope);
    setAwardDeleteSafetyChecked(false);
    setAwardDeleteConfirmation("");
  }

  function closeAwardDelete() {
    if (awardDeleteBusy) return;
    setAwardDeleteScope(null);
    setAwardDeleteSafetyChecked(false);
    setAwardDeleteConfirmation("");
  }

  async function deleteAwardRecords() {
    if (!awardDeleteScope || !isOwner || awardDeleteBusy) return;
    const targetIds =
      awardDeleteScope === "selected"
        ? selectedAwardIds
        : displayedRecords.map((record) => record.id);
    const ids = [...new Set(targetIds)].slice(0, 500);
    if (
      !ids.length ||
      !awardDeleteSafetyChecked ||
      awardDeleteConfirmation.trim() !== "삭제"
    ) {
      setToast("안전 확인 체크 후 ‘삭제’를 정확히 입력해 주세요.");
      return;
    }
    try {
      setAwardDeleteBusy(true);
      const response = await fetch("/api/records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, adminAwardDelete: true }),
      });
      const payload = (await response.json()) as {
        deletedCount?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "수주 기록을 삭제하지 못했습니다.");
      }
      const deletedIds = new Set(ids);
      setRecords((current) =>
        current.filter((record) => !deletedIds.has(record.id)),
      );
      setSelectedAwardIds((current) =>
        current.filter((id) => !deletedIds.has(id)),
      );
      setAwardBulkOpen(false);
      setAwardDeleteScope(null);
      setAwardDeleteSafetyChecked(false);
      setAwardDeleteConfirmation("");
      setToast(
        `수주 기록 ${payload.deletedCount ?? ids.length}건을 휴지통으로 이동했습니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "수주 기록을 삭제하지 못했습니다.",
      );
    } finally {
      setAwardDeleteBusy(false);
    }
  }

  async function removeSelectedInstitutions() {
    const organizations = [
      ...new Set(
        selectedInstitutionIds
          .map((id) => records.find((record) => record.id === id)?.organization)
          .filter((organization): organization is string => Boolean(organization)),
      ),
    ];
    if (!organizations.length || institutionDeleteBusy) {
      setToast("삭제할 기관을 한 곳 이상 선택해 주세요.");
      return;
    }
    const confirmed = window.confirm(
      `선택한 ${organizations.length}개 기관을 삭제할까요?\n\n해당 기관의 활동 기록·일정·지도 위치·사업 품목은 휴지통으로 이동되며, 관리자가 30일 안에 복원할 수 있습니다.`,
    );
    if (!confirmed) return;

    try {
      setInstitutionDeleteBusy(true);
      const response = await fetch("/api/records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizations }),
      });
      const payload = (await response.json()) as {
        deletedCount?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "선택한 기관을 삭제하지 못했습니다.");
      }
      const deletedOrganizations = new Set(organizations);
      setRecords((current) =>
        current.filter(
          (record) => !deletedOrganizations.has(record.organization),
        ),
      );
      if (detailOrganization && deletedOrganizations.has(detailOrganization)) {
        setDetailOrganization(null);
      }
      setSelectedInstitutionIds([]);
      setToast(
        `${organizations.length}개 기관과 연결된 기록 ${payload.deletedCount ?? 0}건을 휴지통으로 이동했습니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "선택한 기관을 삭제하지 못했습니다.",
      );
    } finally {
      setInstitutionDeleteBusy(false);
    }
  }

  async function saveSelectedInstitutionBudgets() {
    if (!selectedInstitutionIds.length || institutionBudgetBusy) return;
    const budgetType = institutionBudgetType.trim();
    const budgetAmount = formatMoneyInput(institutionBudgetAmount);
    const applyFields = [
      institutionBulkBudgetEnabled && "budget",
      institutionBulkManagerEnabled && "progressManager",
      institutionBulkContactNameEnabled && "contactName",
      institutionBulkFollowUpEnabled && "followUpDate",
      institutionBulkNextActionEnabled && "nextAction",
      institutionBulkAwardEnabled && "awardStatus",
    ].filter((field): field is string => Boolean(field));
    if (!applyFields.length) {
      setToast("일괄 변경할 항목을 한 개 이상 선택해 주세요.");
      return;
    }
    if (institutionBulkBudgetEnabled && !budgetType && !budgetAmount) {
      setToast("예산 또는 예산금액을 입력해 주세요.");
      return;
    }
    if (institutionBulkManagerEnabled && !institutionBulkProgressManager) {
      setToast("진행 담당자를 선택해 주세요.");
      return;
    }
    if (institutionBulkContactNameEnabled && !institutionBulkContactName.trim()) {
      setToast("사업 담당자 이름 또는 직책을 입력해 주세요.");
      return;
    }
    if (institutionBulkFollowUpEnabled && !institutionBulkFollowUpDate) {
      setToast("재연락 예정일을 선택해 주세요.");
      return;
    }
    if (institutionBulkNextActionEnabled && !institutionBulkNextAction.trim()) {
      setToast("다음 행동을 입력해 주세요.");
      return;
    }
    if (
      institutionBulkAwardEnabled &&
      ["협력사 수주", "타업체 수주"].includes(institutionBulkAwardStatus) &&
      !institutionBulkAwardCompany.trim()
    ) {
      setToast("협력사·타업체 수주의 수주업체를 입력해 주세요.");
      return;
    }
    const targetLabel = selectedInstitutionSummary;
    const changeLabels = [
      institutionBulkBudgetEnabled &&
        [budgetType && "예산", budgetAmount && "예산금액"]
          .filter(Boolean)
          .join("·"),
      institutionBulkManagerEnabled && "진행 담당자",
      institutionBulkContactNameEnabled && "사업 담당자",
      institutionBulkFollowUpEnabled && "재연락 예정일",
      institutionBulkNextActionEnabled && "다음 행동",
      institutionBulkAwardEnabled && "수주 구분",
    ].filter((label): label is string => Boolean(label));
    if (
      !window.confirm(
        `${targetLabel}\n\n다음 항목을 변경합니다: ${changeLabels.join(
          ", ",
        )}\n체크한 항목의 기존 값은 새 입력값으로 바뀝니다.\n\n계속할까요?`,
      )
    ) {
      return;
    }
    const operationId = window.crypto.randomUUID();
    const operationLabel = [
      `수주 전 ${selectedInstitutionIds.length.toLocaleString()}개 기관 일괄 변경`,
      changeLabels.slice(0, 2).join(" · "),
    ]
      .filter(Boolean)
      .join(" · ");
    try {
      setInstitutionBudgetBusy(true);
      const response = await fetch("/api/records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: selectedInstitutionIds,
          budgetType,
          budgetAmount,
          standardBudgetOnly: true,
          progressManager: institutionBulkProgressManager,
          contactName: institutionBulkContactName.trim(),
          followUpDate: institutionBulkFollowUpDate,
          nextAction: institutionBulkNextAction.trim(),
          status: "상담 진행",
          awardStatus: institutionBulkAwardStatus,
          awardCompany: institutionBulkAwardCompany.trim(),
          applyFields,
          onlyEmpty: false,
          operationId,
          operationScope: "pre_awards",
          operationLabel,
          operationTotal: selectedInstitutionIds.length,
        }),
      });
      const payload = (await response.json()) as {
        updatedIds?: number[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "예산 정보를 일괄 저장하지 못했습니다.");
      }
      const updatedIds = new Set(payload.updatedIds ?? selectedInstitutionIds);
      setRecords((current) =>
        current.map((record) => {
          if (!updatedIds.has(record.id)) return record;
          return {
            ...record,
            budgetType:
              institutionBulkBudgetEnabled && budgetType
                ? budgetType
                : record.budgetType,
            budgetAmount:
              institutionBulkBudgetEnabled && budgetAmount
                ? budgetAmount
                : record.budgetAmount,
            progressManager:
              institutionBulkManagerEnabled
                ? institutionBulkProgressManager
                : record.progressManager,
            contactName:
              institutionBulkContactNameEnabled
                ? institutionBulkContactName.trim()
                : record.contactName,
            followUpRequired:
              institutionBulkFollowUpEnabled
                ? true
                : record.followUpRequired,
            followUpDate:
              institutionBulkFollowUpEnabled
                ? institutionBulkFollowUpDate
                : record.followUpDate,
            nextAction:
              institutionBulkNextActionEnabled
                ? institutionBulkNextAction.trim()
                : record.nextAction,
            status: record.status,
            awardStatus: institutionBulkAwardEnabled
              ? institutionBulkAwardStatus
              : record.awardStatus,
            awardCompany: institutionBulkAwardEnabled
              ? institutionBulkAwardStatus === "위즈업 수주"
                ? "위즈업"
                : ["협력사 수주", "타업체 수주"].includes(institutionBulkAwardStatus)
                  ? institutionBulkAwardCompany.trim()
                  : ""
              : record.awardCompany,
          };
        }),
      );
      setInstitutionBudgetOpen(false);
      setInstitutionBudgetType("");
      setInstitutionBudgetAmount("");
      setInstitutionBulkBudgetEnabled(false);
      setInstitutionBulkProgressManager("");
      setInstitutionBulkContactName("");
      setInstitutionBulkFollowUpDate("");
      setInstitutionBulkNextAction("");
      setInstitutionBulkManagerEnabled(false);
      setInstitutionBulkContactNameEnabled(false);
      setInstitutionBulkFollowUpEnabled(false);
      setInstitutionBulkNextActionEnabled(false);
      setInstitutionBulkAwardEnabled(false);
      setInstitutionBulkAwardStatus("미정");
      setInstitutionBulkAwardCompany("");
      setRecentlyUpdatedInstitutionIds([...updatedIds]);
      setSelectedInstitutionIds([]);
      setToast(
        `${targetLabel}의 ${changeLabels.join("·")}을 수정했습니다. 변경 이력에 저장했습니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "예산 정보를 일괄 저장하지 못했습니다.",
      );
    } finally {
      setInstitutionBudgetBusy(false);
    }
  }

  function toggleInstitutionBulkEditor() {
    if (institutionBudgetOpen) {
      setInstitutionBudgetOpen(false);
      return;
    }
    setInstitutionBudgetType(selectedBudgetTypeState.value);
    setInstitutionBudgetAmount(selectedBudgetAmountState.value);
    setInstitutionBulkBudgetEnabled(false);
    setInstitutionBulkManagerEnabled(false);
    setInstitutionBulkProgressManager("");
    setInstitutionBulkContactNameEnabled(false);
    setInstitutionBulkContactName("");
    setInstitutionBulkFollowUpEnabled(false);
    setInstitutionBulkFollowUpDate("");
    setInstitutionBulkNextActionEnabled(false);
    setInstitutionBulkNextAction("");
    setInstitutionBulkAwardEnabled(false);
    setInstitutionBulkAwardStatus("미정");
    setInstitutionBulkAwardCompany("");
    setInstitutionBudgetOpen(true);
  }

  async function loadAwardChangeHistory(append = false) {
    if (!canManageActivityHistory) return;
    try {
      setAwardChangeHistoryLoading(true);
      setAwardChangeHistoryError("");
      const offset = append ? awardChangeHistoryBatches.length : 0;
      const response = await fetch(
        `/api/activity-changes?scope=all&limit=25&offset=${offset}`,
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "변경 이력을 불러오지 못했습니다.",
        );
      }
      const batches = Array.isArray(payload.batches) ? payload.batches : [];
      const parsedBatches = batches
          .filter(
            (batch): batch is Record<string, unknown> =>
              Boolean(batch) && typeof batch === "object" && "id" in batch,
          )
          .map((batch) => ({
            id: String(batch.id),
            scope:
              batch.scope === "pre_awards"
                ? ("pre_awards" as const)
                : ("awards" as const),
            scopeLabel:
              typeof batch.scopeLabel === "string" && batch.scopeLabel.trim()
                ? batch.scopeLabel
                : batch.scope === "pre_awards"
                  ? "수주 전"
                  : "수주 후",
            label:
              typeof batch.label === "string" && batch.label.trim()
                ? batch.label
                : "수주 정보 일괄 변경",
            actionType:
              typeof batch.actionType === "string" ? batch.actionType : "",
            status: typeof batch.status === "string" ? batch.status : "",
            operationTotal: Math.max(
              0,
              Number(batch.operationTotal ?? batch.itemCount) || 0,
            ),
            itemCount: Math.max(0, Number(batch.itemCount) || 0),
            appliedCount: Math.max(
              0,
              Number(batch.appliedCount ?? batch.itemCount) || 0,
            ),
            changedByName:
              typeof batch.changedByName === "string" &&
              batch.changedByName.trim()
                ? batch.changedByName
                : "담당자 미상",
            createdAt:
              typeof batch.createdAt === "string" ? batch.createdAt : "",
            undoneAt:
              typeof batch.undoneAt === "string" ? batch.undoneAt : "",
            undoable: Boolean(batch.undoable),
            conflictCount: Math.max(0, Number(batch.conflictCount) || 0),
            sampleOrganizations: Array.isArray(batch.sampleOrganizations)
              ? batch.sampleOrganizations
                  .filter(
                    (organization): organization is string =>
                      typeof organization === "string" &&
                      Boolean(organization.trim()),
                  )
                  .slice(0, 5)
              : [],
          }));
      setAwardChangeHistoryBatches((current) => {
        if (!append) return parsedBatches;
        const knownIds = new Set(current.map((batch) => batch.id));
        return [
          ...current,
          ...parsedBatches.filter((batch) => !knownIds.has(batch.id)),
        ];
      });
      setAwardChangeHistoryHasMore(Boolean(payload.hasMore));
    } catch (caught) {
      setAwardChangeHistoryError(
        caught instanceof Error
          ? caught.message
          : "변경 이력을 불러오지 못했습니다.",
      );
    } finally {
      setAwardChangeHistoryLoading(false);
    }
  }

  async function openAwardChangeHistory() {
    if (!canManageActivityHistory) {
      setToast("변경 이력을 관리할 권한이 없습니다.");
      return;
    }
    setAwardChangeHistoryOpen(true);
    await loadAwardChangeHistory(false);
  }

  async function undoAwardChangeBatch(batch: ActivityChangeBatch) {
    if (
      !canManageActivityHistory ||
      !batch.undoable ||
      awardChangeUndoBusyId
    ) {
      return;
    }
    const affectedCount = batch.appliedCount || batch.itemCount;
    if (
      !window.confirm(
        [
          `"${batch.label}" 변경 ${affectedCount.toLocaleString()}건을 이전 값으로 되돌리시겠습니까?`,
          "",
          "변경 후 다시 수정된 항목만 건너뛰고, 같은 기록의 나머지 항목은 복원합니다.",
        ].join("\n"),
      )
    ) {
      return;
    }
    try {
      setAwardChangeUndoBusyId(batch.id);
      const response = await fetch("/api/activity-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo", batchId: batch.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "변경을 되돌리지 못했습니다.",
        );
      }
      const restoredCount = Math.max(0, Number(payload.restoredCount) || 0);
      const partialRestoredCount = Math.max(
        0,
        Number(payload.partialRestoredCount) || 0,
      );
      const conflictCount = Math.max(0, Number(payload.conflictCount) || 0);
      const missingCount = Math.max(0, Number(payload.missingCount) || 0);
      await loadRecords("full");
      await loadAwardChangeHistory(false);
      setToast(
        conflictCount || missingCount || partialRestoredCount
          ? `전체 복원 ${restoredCount.toLocaleString()}건 · 일부 복원 ${partialRestoredCount.toLocaleString()}건 · 충돌 ${conflictCount.toLocaleString()}건 · 삭제/누락 ${missingCount.toLocaleString()}건입니다.`
          : `${restoredCount.toLocaleString()}건을 이전 값으로 되돌렸습니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "변경을 되돌리지 못했습니다.",
      );
    } finally {
      setAwardChangeUndoBusyId(null);
    }
  }

  function resetAwardBulkEditor() {
    setAwardBulkDateEnabled(false);
    setAwardBulkActivityDate("");
    setAwardBulkAwardEnabled(false);
    setAwardBulkAwardStatus("협력사 수주");
    setAwardBulkAwardCompany("");
    setAwardBulkExecutionEnabled(false);
    setAwardBulkExecutionType("직영");
    setAwardBulkConsortiumCompany("");
    setAwardBulkManagerEnabled(false);
    setAwardBulkProgressManager("해당 없음");
    setAwardBulkContactNameEnabled(false);
    setAwardBulkContactName("");
    setAwardBulkStageEnabled(false);
    setAwardBulkAwardStage("협상");
  }

  function toggleAwardBulkEditor() {
    if (awardBulkOpen) {
      setAwardBulkOpen(false);
      return;
    }
    resetAwardBulkEditor();
    setAwardBulkOpen(true);
  }

  async function saveSelectedAwardChanges() {
    if (!selectedAwardIds.length || awardBulkBusy) return;
    const partnerOrOther = ["협력사 수주", "타업체 수주"].includes(
      awardBulkAwardStatus,
    );
    const forcedOther = awardBulkAwardEnabled && awardBulkAwardStatus === "타업체 수주";
    const forcedPartner = awardBulkAwardEnabled && awardBulkAwardStatus === "협력사 수주";
    const applyFields = [
      awardBulkDateEnabled && "activityDate",
      awardBulkAwardEnabled && "awardStatus",
      (awardBulkExecutionEnabled || forcedOther || forcedPartner) && "executionType",
      (awardBulkManagerEnabled || forcedPartner) && "progressManager",
      awardBulkContactNameEnabled && "contactName",
      (awardBulkStageEnabled || forcedOther || forcedPartner) && "awardStage",
    ].filter(Boolean) as string[];
    if (!applyFields.length) {
      setToast("변경할 수주 정보를 한 가지 이상 선택해 주세요.");
      return;
    }
    if (awardBulkDateEnabled && !/^\d{4}-\d{2}-\d{2}$/.test(awardBulkActivityDate)) {
      setToast("변경할 수주 날짜를 선택해 주세요.");
      return;
    }
    if (
      (awardBulkExecutionEnabled || forcedPartner) &&
      awardBulkExecutionType === "컨소" &&
      !awardBulkConsortiumCompany.trim()
    ) {
      setToast("컨소 업체명을 입력해 주세요.");
      return;
    }
    if (awardBulkAwardEnabled && partnerOrOther && !awardBulkAwardCompany.trim()) {
      setToast("협력사·타업체 수주의 수주업체를 입력해 주세요.");
      return;
    }
    if (awardBulkContactNameEnabled && !awardBulkContactName.trim()) {
      setToast("사업 담당자 이름 또는 직책을 입력해 주세요.");
      return;
    }
    if (selectedAwardIds.length > AWARD_BULK_MAX_COUNT) {
      setToast(`한 번에 최대 ${AWARD_BULK_MAX_COUNT.toLocaleString()}건까지 변경할 수 있습니다.`);
      return;
    }
    const selectedAwardIdSetForConfirmation = new Set(selectedAwardIds);
    const whizzupSourceCount = records.filter(
      (record) =>
        selectedAwardIdSetForConfirmation.has(record.id) &&
        record.awardStatus === "위즈업 수주",
    ).length;
    const changesWhizzupToExternal =
      awardBulkAwardEnabled && partnerOrOther && whizzupSourceCount > 0;
    const changeDescriptions = [
      awardBulkDateEnabled && `수주 날짜 → ${awardBulkActivityDate}`,
      awardBulkAwardEnabled &&
        `수주 구분 → ${awardBulkAwardStatus}${
          partnerOrOther ? ` (${awardBulkAwardCompany.trim()})` : ""
        }`,
      (awardBulkExecutionEnabled || forcedOther || forcedPartner) &&
        `사업방식 → ${forcedOther ? "해당 없음" : awardBulkExecutionType}${
          !forcedOther && awardBulkExecutionType === "컨소"
            ? ` (${awardBulkConsortiumCompany.trim()})`
            : ""
        }`,
      (awardBulkManagerEnabled || forcedPartner) &&
        `진행 담당자 → ${
          forcedPartner
            ? "해당 없음"
            : awardBulkProgressManager
        }`,
      awardBulkContactNameEnabled &&
        `사업 담당자 → ${awardBulkContactName.trim()}`,
      (awardBulkStageEnabled || forcedOther || forcedPartner) &&
        `수주 진행 단계 → ${
          forcedOther
            ? "해당 없음"
            : forcedPartner && !awardBulkStageEnabled
              ? "미정"
              : awardBulkAwardStage
        }`,
    ].filter(Boolean) as string[];
    const confirmationLines = [
      `선택한 ${selectedAwardIds.length.toLocaleString()}건에 다음 변경을 적용하시겠습니까?`,
      "",
      ...changeDescriptions.map((description) => `• ${description}`),
    ];
    if (changesWhizzupToExternal) {
      confirmationLines.push(
        "",
        `주의: 선택 기록 중 위즈업 수주 ${whizzupSourceCount.toLocaleString()}건이 협력사·타업체 수주로 변경됩니다.`,
        "해당 기록은 위즈업 수금·채권·회계 및 위즈업 수주 통계 대상에서 제외됩니다.",
        "수주 단계·사업방식도 위 표시값으로 함께 변경됩니다.",
      );
    }
    if (selectedAwardIds.length > 10) {
      confirmationLines.push(
        "",
        "대량 변경입니다. 변경 전 값은 변경 이력에 보관되며, 실행 후에도 변경 묶음 전체를 되돌릴 수 있습니다.",
      );
    }
    if (
      !window.confirm(confirmationLines.join("\n"))
    ) return;
    const operationId = window.crypto.randomUUID();
    const operationLabel = [
      `수주 ${selectedAwardIds.length.toLocaleString()}건 일괄 변경`,
      awardBulkAwardEnabled
        ? `${awardBulkAwardStatus}${
            partnerOrOther ? ` · ${awardBulkAwardCompany.trim()}` : ""
          }`
        : changeDescriptions.slice(0, 2).join(" · "),
    ]
      .filter(Boolean)
      .join(" · ");
    const updatedIds = new Set<number>();
    try {
      setAwardBulkBusy(true);
      setAwardBulkProgress({ completed: 0, total: selectedAwardIds.length });
      const updatePayload = {
          applyFields,
          onlyEmpty: false,
          activityDate: awardBulkActivityDate,
          awardStatus: awardBulkAwardStatus,
          awardCompany: awardBulkAwardCompany.trim(),
          executionType: forcedOther ? "해당 없음" : awardBulkExecutionType,
          consortiumCompany:
            !forcedOther && awardBulkExecutionType === "컨소"
              ? awardBulkConsortiumCompany.trim()
              : "",
          progressManager:
            forcedPartner
              ? "해당 없음"
              : awardBulkProgressManager,
          contactName: awardBulkContactName.trim(),
          awardStage: forcedOther
            ? "해당 없음"
            : forcedPartner && !awardBulkStageEnabled
              ? "미정"
              : awardBulkAwardStage,
          awardCompletedDate:
            awardBulkStageEnabled &&
            isCompletedAwardStage(awardBulkAwardStage)
              ? toLocalDateValue(new Date())
              : "",
      };
      for (
        let offset = 0;
        offset < selectedAwardIds.length;
        offset += AWARD_BULK_BATCH_SIZE
      ) {
        const ids = selectedAwardIds.slice(
          offset,
          offset + AWARD_BULK_BATCH_SIZE,
        );
        let lastError = "수주 정보를 일괄 변경하지 못했습니다.";
        let savedIds: number[] | null = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const response = await fetch("/api/records", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ids,
                ...updatePayload,
                operationId,
                operationScope: "awards",
                operationLabel,
                operationTotal: selectedAwardIds.length,
              }),
            });
            const payload = await response.json();
            if (response.ok) {
              savedIds = payload.updatedIds || ids;
              break;
            }
            lastError = payload.error || lastError;
            if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
              break;
            }
          } catch (caught) {
            lastError = caught instanceof Error ? caught.message : lastError;
          }
          if (attempt < 3) await waitForBulkRetry(attempt * 800);
        }
        if (!savedIds) {
          throw new Error(
            updatedIds.size
              ? `${updatedIds.size.toLocaleString()}건 변경 후 중단되었습니다. ${lastError}`
              : lastError,
          );
        }
        savedIds.forEach((id) => updatedIds.add(Number(id)));
        const savedIdSet = new Set(savedIds.map(Number));
        setSelectedAwardIds((current) =>
          current.filter((id) => !savedIdSet.has(id)),
        );
        setAwardBulkProgress({
          completed: updatedIds.size,
          total: selectedAwardIds.length,
        });
      }
      setRecords((current) =>
        current.map((record) => {
          if (!updatedIds.has(record.id)) return record;
          const nextAwardStage =
            awardBulkStageEnabled || forcedOther || forcedPartner
              ? forcedOther
                ? "해당 없음"
                : forcedPartner && !awardBulkStageEnabled
                  ? "미정"
                  : awardBulkAwardStage
              : record.awardStage;
          return {
            ...record,
            ...(awardBulkDateEnabled
              ? {
                  activityDate: awardBulkActivityDate,
                  dateConfidence: "확정",
                }
              : {}),
            ...(awardBulkAwardEnabled
              ? {
                  awardStatus: awardBulkAwardStatus,
                  awardCompany:
                    awardBulkAwardStatus === "위즈업 수주"
                      ? "위즈업"
                      : partnerOrOther
                        ? awardBulkAwardCompany.trim()
                        : "",
                  status:
                    awardBulkAwardStatus === "타업체 수주"
                      ? "영업 종료"
                      : ["위즈업 수주", "협력사 수주"].includes(awardBulkAwardStatus)
                        ? "수주 전환"
                        : "상담 진행",
                }
              : {}),
            ...(awardBulkExecutionEnabled || forcedOther || forcedPartner
              ? {
                  executionType: forcedOther ? "해당 없음" : awardBulkExecutionType,
                  consortiumCompany:
                    !forcedOther && awardBulkExecutionType === "컨소"
                      ? awardBulkConsortiumCompany.trim()
                      : "",
                }
              : {}),
            ...(awardBulkManagerEnabled || forcedOther || forcedPartner
              ? {
                  progressManager:
                    forcedOther || forcedPartner
                      ? "해당 없음"
                      : awardBulkProgressManager,
                }
              : {}),
            ...(awardBulkContactNameEnabled
              ? { contactName: awardBulkContactName.trim() }
              : {}),
            ...(awardBulkStageEnabled || forcedOther || forcedPartner
              ? {
                  awardStage: nextAwardStage,
                  awardCompletedDate: isCompletedAwardStage(nextAwardStage)
                    ? updatePayload.awardCompletedDate
                    : "",
                }
              : {}),
            ...(isCompletedAwardStage(nextAwardStage)
              ? { followUpRequired: false, followUpDate: "" }
              : {}),
          };
        }),
      );
      setSelectedAwardIds([]);
      setAwardBulkOpen(false);
      resetAwardBulkEditor();
      setAwardChangeHistoryOpen(true);
      await loadAwardChangeHistory(false);
      setToast(
        `${updatedIds.size.toLocaleString()}건의 수주 정보를 변경했습니다. 변경 이력에서 되돌릴 수 있습니다.`,
      );
    } catch (caught) {
      await loadRecords("full");
      if (updatedIds.size) {
        setAwardChangeHistoryOpen(true);
        await loadAwardChangeHistory(false);
      }
      setToast(
        caught instanceof Error
          ? `${caught.message}${
              updatedIds.size
                ? " 변경 이력에서 적용된 기록을 되돌릴 수 있습니다."
                : ""
            }`
          : "수주 정보를 일괄 변경하지 못했습니다.",
      );
    } finally {
      setAwardBulkBusy(false);
      setAwardBulkProgress({ completed: 0, total: 0 });
    }
  }

  async function markAwardAsCompleted(record: Activity) {
    if (
      awardCompletionBusyId !== null ||
      record.awardStatus === "타업체 수주" ||
      isCompletedAwardStage(record.awardStage)
    ) {
      return;
    }
    if (
      !window.confirm(
        `${record.organization}의 수주 진행 단계를 납품 완료로 변경하시겠습니까?\n재연락 표시와 예정일은 자동으로 해제됩니다.`,
      )
    ) {
      return;
    }
    try {
      setAwardCompletionBusyId(record.id);
      const response = await fetch("/api/records", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [record.id],
          applyFields: ["awardStage"],
          onlyEmpty: false,
          awardStage: COMPLETED_AWARD_STAGE,
          awardCompletedDate: toLocalDateValue(new Date()),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "납품 완료 처리하지 못했습니다.");
      }
      setRecords((current) =>
        current.map((item) =>
          item.id === record.id
            ? {
                ...item,
                awardStage: COMPLETED_AWARD_STAGE,
                awardCompletedDate: toLocalDateValue(new Date()),
                followUpRequired: false,
                followUpDate: "",
              }
            : item,
        ),
      );
      setToast(
        `${record.organization}을 납품 완료 처리하고 재연락 표시를 해제했습니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error ? caught.message : "납품 완료 처리하지 못했습니다.",
      );
    } finally {
      setAwardCompletionBusyId(null);
    }
  }

  async function openInstitutionMerge() {
    const selectedIds =
      view === "awards" ? selectedAwardIds : selectedInstitutionIds;
    const invalidSelectedCount =
      view === "awards"
        ? selectedAwardIds.length !== 2
        : selectedInstitutionIds.length !== 2;
    const organizations = [
      ...new Set(
        selectedIds
          .map((id) => records.find((record) => record.id === id)?.organization)
          .filter((organization): organization is string => Boolean(organization)),
      ),
    ];
    if (
      invalidSelectedCount ||
      organizations.length !== 2 ||
      institutionMergeBusy
    ) {
      setToast("합칠 기관을 정확히 두 곳 선택해 주세요.");
      return;
    }
    try {
      setInstitutionMergeBusy(true);
      const response = await fetch("/api/institutions/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizations }),
      });
      const payload = (await response.json()) as {
        preview?: InstitutionMergePreview;
        error?: string;
      };
      if (!response.ok || !payload.preview) {
        throw new Error(payload.error || "기관 병합 정보를 확인하지 못했습니다.");
      }
      setInstitutionMergePreview(payload.preview);
      setInstitutionMergeTarget(
        payload.preview.recommendedTarget ||
          payload.preview.organizations[0]?.organization ||
          "",
      );
      setInstitutionMergeResolutions(
        Object.fromEntries(
          payload.preview.conflicts.map((conflict) => [
            conflict.key,
            conflict.recommendedValue,
          ]),
        ),
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "기관 병합 정보를 확인하지 못했습니다.",
      );
    } finally {
      setInstitutionMergeBusy(false);
    }
  }

  async function mergeSelectedInstitutions() {
    if (
      !institutionMergePreview ||
      !institutionMergeTarget ||
      institutionMergeBusy
    ) {
      return;
    }
    const organizations = institutionMergePreview.organizations.map(
      (item) => item.organization,
    );
    const sourceOrganizations = organizations.filter(
      (organization) => organization !== institutionMergeTarget,
    );
    if (!sourceOrganizations.length) return;
    if (
      !window.confirm(
        `선택한 ${organizations.length}개 기관의 모든 기록을 ${institutionMergeTarget}으로 합칠까요?\n합친 뒤에는 ${institutionMergeTarget} 이름으로 표시됩니다.`,
      )
    ) {
      return;
    }
    try {
      setInstitutionMergeBusy(true);
      const response = await fetch("/api/institutions/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizations,
          targetOrganization: institutionMergeTarget,
          confirm: true,
          resolutions: institutionMergeResolutions,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        result?: { activityCount?: number };
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "선택한 기관을 합치지 못했습니다.");
      }
      await loadRecords("full");
      setSelectedInstitutionIds([]);
      setSelectedAwardIds([]);
      setDetailOrganization(null);
      setInstitutionMergePreview(null);
      setInstitutionMergeTarget("");
      setInstitutionMergeResolutions({});
      setToast(
        `${sourceOrganizations.length}개 기관의 기록을 ${institutionMergeTarget}으로 안전하게 합쳤습니다.`,
      );
    } catch (caught) {
      setToast(
        caught instanceof Error ? caught.message : "선택한 기관을 합치지 못했습니다.",
      );
    } finally {
      setInstitutionMergeBusy(false);
    }
  }

  async function saveMemberAccess(member: TeamMember) {
    if (await updateMember(member, member.status, member.role)) {
      const preset = memberAccessPreset(member);
      setToast(
        preset === "custom"
          ? `${member.displayName} 님의 권한을 직접 설정했습니다.`
          : `${member.displayName} 님을 ${memberAccessPresetLabels[preset]}로 설정했습니다.`,
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
    setAwardExecutionFilter("전체 사업방식");
    setAwardManagerFilter("전체 담당자");
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
    if (!activityReviewsLoadedRef.current) void loadActivityReviews();
    if (!activityReviewAssigneesLoadedRef.current) {
      void loadActivityReviewAssignees();
    }
    if (!protectionReviewsLoadedRef.current) void loadProtectionReviews();
    if (!correctionRequestsLoadedRef.current) void loadCorrectionRequests();
  }

  async function completeCorrectionRequest(
    item: EquipmentCorrectionRequest,
  ) {
    if (correctionRequestSavingIds.includes(item.id)) return;
    setCorrectionRequestSavingIds((current) => [...current, item.id]);
    try {
      const response = await fetch("/api/correction-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "금액 보완 업무를 완료하지 못했습니다.");
      }
      setCorrectionRequests((current) =>
        current.filter((entry) => entry.id !== item.id),
      );
      setToast("금액 보완 업무를 완료 처리했습니다.");
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "금액 보완 업무를 완료하지 못했습니다.",
      );
    } finally {
      setCorrectionRequestSavingIds((current) =>
        current.filter((id) => id !== item.id),
      );
    }
  }

  async function completeProtectionReview(item: ProtectionReviewItem) {
    if (protectionReviewSavingIds.includes(item.id)) return;
    setProtectionReviewSavingIds((current) => [...current, item.id]);
    try {
      const response = await fetch("/api/equipment", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "protection",
          id: item.id,
          protectionStatus: "신청 완료",
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "영업보호 상태를 변경하지 못했습니다.");
      }
      setProtectionReviewItems((current) =>
        current.filter((entry) => entry.id !== item.id),
      );
      setToast("영업보호 신청 완료로 변경했습니다.");
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "영업보호 상태를 변경하지 못했습니다.",
      );
    } finally {
      setProtectionReviewSavingIds((current) =>
        current.filter((id) => id !== item.id),
      );
    }
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

  function updateActivityReviewGroupDraft(
    records: Activity[],
    key: "contactName" | "contactPhone" | "contactEmail",
    value: string,
  ) {
    setActivityReviewDrafts((current) => {
      const next = { ...current };
      records.forEach((record) => {
        const hasField = activityReviewFields(
          record,
          activityReviewInstitutionState(record),
        ).some((field) => field.key === key);
        if (!hasField) return;
        next[record.id] = {
          ...next[record.id],
          [key]: value,
        };
      });
      return next;
    });
  }

  async function transferActivityReview(
    record: Activity,
    directTargetMemberId?: number,
    confirmChange = true,
  ) {
    if (activityReviewSavingIds.includes(record.id)) return;
    const targetMemberId =
      directTargetMemberId ??
      Number(activityReviewTransferTargets[record.id] ?? "");
    const assignee = activityReviewAssignees.find(
      (member) => member.id === targetMemberId,
    );
    if (!assignee) {
      setToast("새 진행 담당자를 선택해 주세요.");
      return;
    }
    if (
      confirmChange &&
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
      const transferredRecord = normalizeUpdatedActivity(
        payload.record,
        record,
      );
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

  async function setProgressManagerLock(record: Activity, locked: boolean) {
    if (!session?.canViewPresence || activityReviewSavingIds.includes(record.id)) {
      return;
    }
    if (
      locked &&
      (!record.progressManager.trim() || record.progressManager === "해당 없음")
    ) {
      setToast("진행 담당자를 먼저 선택해 주세요.");
      return;
    }
    try {
      setActivityReviewSavingIds((current) => [...current, record.id]);
      const response = await fetch("/api/records/assignee", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId: record.id,
          mode: locked ? "fixed" : "automatic",
        }),
      });
      const payload = (await response.json()) as {
        record?: Record<string, unknown>;
        error?: string;
      };
      if (!response.ok || !payload.record) {
        throw new Error(payload.error || "담당자 고정 상태를 변경하지 못했습니다.");
      }
      const savedRecord = normalizeUpdatedActivity(payload.record, record);
      setRecords((current) =>
        current.map((item) =>
          item.id === savedRecord.id
            ? savedRecord
            : item.organization === record.organization &&
                item.businessRound === record.businessRound
              ? { ...item, progressManagerLocked: false }
              : item,
        ),
      );
      setToast(
        locked
          ? "현재 진행 담당자를 이후 AI 기록에도 고정합니다."
          : "다음 AI 기록 작성자부터 진행 담당자로 자동 반영됩니다.",
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "담당자 고정 상태를 변경하지 못했습니다.",
      );
    } finally {
      setActivityReviewSavingIds((current) =>
        current.filter((id) => id !== record.id),
      );
    }
  }

  function renderInlineAssigneePicker(record: Activity) {
    const isSaving = activityReviewSavingIds.includes(record.id);
    const isPartnerAward = record.awardStatus === "협력사 수주";
    if (!canEditProgressManager) {
      return (
        <span className="inline-assignee-static">
          {isPartnerAward ? "해당 없음" : record.progressManager || "미지정"}
        </span>
      );
    }
    return (
      <span
        className="inline-assignee-control"
      >
        <select
          className="inline-assignee-select"
          value=""
          disabled={activityReviewAssigneesLoading || isSaving || isPartnerAward}
          aria-label={`${record.organization} 진행 담당자 변경`}
          title={
            isPartnerAward
              ? "협력사 수주는 진행 담당자가 해당 없음으로 고정됩니다."
              : "클릭해서 진행 담당자 변경"
          }
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            event.stopPropagation();
            const targetMemberId = Number(event.target.value);
            if (targetMemberId) {
              void transferActivityReview(record, targetMemberId, false);
            }
          }}
        >
          <option value="">
            {isPartnerAward
              ? "해당 없음"
              : isSaving
                ? "변경 중…"
                : record.progressManager || "미지정"}
          </option>
          {activityReviewAssignees
            .filter(
              (member) => member.displayName !== record.progressManager,
            )
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
        </select>
      </span>
    );
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

  async function completeActivityReview(record: Activity, announce = true) {
    if (activityReviewSavingIds.includes(record.id)) return false;
    const draft = activityReviewDrafts[record.id] ?? {};
    const nextForm = activityToForm(record);
    const institutionState = activityReviewInstitutionState(record);
    let changed = false;

    activityReviewFields(record, institutionState).forEach((field) => {
      const value = draft[field.key];
      if (value === undefined || !value.trim()) return;
      if (String(nextForm[field.key] ?? "") !== value) {
        nextForm[field.key] = value;
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
          body: JSON.stringify({
            id: record.id,
            ...nextForm,
            standardBudgetOnly: true,
          }),
        });
        const payload = (await response.json()) as {
          record?: Record<string, unknown>;
          error?: string;
        };
        if (!response.ok || !payload.record) {
          throw new Error(payload.error || "보완한 내용을 저장하지 못했습니다.");
        }
        reviewedRecord = normalizeUpdatedActivity(payload.record, record);
        setRecords((current) =>
          current.map((item) =>
            item.id === reviewedRecord.id ? reviewedRecord : item,
          ),
        );
      }

      await saveActivityReviewState(
        reviewedRecord,
        activityReviewSignature(reviewedRecord, institutionState),
        null,
      );
      setActivityReviewDrafts((current) => {
        const next = { ...current };
        delete next[record.id];
        return next;
      });
      if (announce) {
        setToast(
          changed
            ? `${record.organization}의 부족한 정보를 보완하고 점검을 완료했습니다.`
            : `${record.organization} 기록을 현재 정보로 확인 완료했습니다.`,
        );
      }
      return true;
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "내 기록 점검을 완료하지 못했습니다.",
      );
      return false;
    } finally {
      setActivityReviewSavingIds((current) =>
        current.filter((id) => id !== record.id),
      );
    }
  }

  async function snoozeActivityReview(record: Activity, announce = true) {
    if (activityReviewSavingIds.includes(record.id)) return false;
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
        activityReviewSignature(
          record,
          activityReviewInstitutionState(record),
        ),
        toLocalDateValue(tomorrow),
      );
      if (announce) {
        setToast(`${record.organization} 기록은 내일 다시 보여드립니다.`);
      }
      return true;
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "다시 알림을 저장하지 못했습니다.",
      );
      return false;
    } finally {
      setActivityReviewSavingIds((current) =>
        current.filter((id) => id !== record.id),
      );
    }
  }

  async function completeActivityReviewGroup(
    organization: string,
    records: Activity[],
  ) {
    for (const record of records) {
      const completed = await completeActivityReview(record, false);
      if (!completed) return;
    }
    setToast(
      `${organization} 관련 기록 ${records.length}건을 한 번에 점검 완료했습니다.`,
    );
  }

  async function snoozeActivityReviewGroup(
    organization: string,
    records: Activity[],
  ) {
    for (const record of records) {
      const snoozed = await snoozeActivityReview(record, false);
      if (!snoozed) return;
    }
    setToast(
      `${organization} 관련 기록 ${records.length}건은 내일 다시 보여드립니다.`,
    );
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
    if (!managerInspectionHydrated) {
      setToast("처리 이력과 등록 견적 확인이 끝난 뒤 다시 시도해 주세요.");
      return;
    }
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
          memberId: managerAlertMemberId,
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
    if (!managerInspectionHydrated) {
      setToast("처리 이력과 등록 견적 확인이 끝난 뒤 다시 시도해 주세요.");
      return;
    }
    if (!organizationsToRestore.length || managerAlertsSaving) return;
    try {
      setManagerAlertsSaving(true);
      const response = await fetch("/api/manager-alerts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: managerAlertMemberId,
          organizations: organizationsToRestore,
        }),
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

  async function hideManagerAlerts(
    organizationsToHide: string[] = [],
    olderThanDays?: 30,
  ) {
    if (!managerInspectionHydrated) {
      setToast("처리 이력과 등록 견적 확인이 끝난 뒤 다시 시도해 주세요.");
      return;
    }
    const selected = olderThanDays
      ? []
      : processedManagerOrganizations
          .filter((organization) =>
            organizationsToHide.includes(organization.name),
          )
          .map((organization) => organization.name);
    if ((!olderThanDays && !selected.length) || managerAlertsSaving) return;
    const confirmation = olderThanDays
      ? "30일 이상 지난 처리 완료 알림을 목록에서 숨길까요?\n\n원본 영업 기록과 알림 처리 이력은 삭제되지 않습니다."
      : `${selected.length}개 처리 완료 알림을 목록에서 숨길까요?\n\n원본 영업 기록과 알림 처리 이력은 삭제되지 않습니다.`;
    if (!window.confirm(confirmation)) return;
    try {
      setManagerAlertsSaving(true);
      const response = await fetch("/api/manager-alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          olderThanDays
            ? { memberId: managerAlertMemberId, olderThanDays }
            : { memberId: managerAlertMemberId, organizations: selected },
        ),
      });
      const payload = (await response.json()) as {
        acknowledgements?: ManagerAlertAcknowledgement[];
        hiddenCount?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "처리 완료 알림을 정리하지 못했습니다.");
      }
      const hiddenCount = Number(payload.hiddenCount ?? 0);
      setManagerAlertAcknowledgements(payload.acknowledgements ?? []);
      setSelectedOrganizations([]);
      setToast(
        hiddenCount > 0
          ? `${hiddenCount}개 처리 완료 알림을 목록에서 숨겼습니다. 원본 기록과 처리 이력은 유지됩니다.`
          : "정리 기준에 해당하는 처리 완료 알림이 없습니다.",
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : "처리 완료 알림을 정리하지 못했습니다.",
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
      "예산",
      "예산금액",
      "주제",
      "내용",
      "다음 행동",
      "재연락 예정일",
      "수주 결과",
      "수주업체",
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
        budgetNamesForRecord(record),
        budgetAmountDisplayForRecord(record).label,
        record.topic,
        record.summary,
        record.nextAction,
        record.followUpDate,
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
      ? "대시보드"
      : view === "budget-institutions"
        ? "예산별 기관"
        : view === "records"
        ? teamPeriodDays === "all"
          ? "팀 업무 현황"
          : `${teamPeriodLabel} 팀 업무`
        : view === "followup"
          ? "기관별 관리(수주 전)"
          : view === "schedules"
            ? "다가오는 진행 일정"
          : view === "organizations"
            ? "관리자 영업 점검"
            : view === "awards"
              ? activeAwardsOnly
                ? "진행 중 수주"
                : "기관별 관리(수주 후)"
              : view === "vendors"
                ? "협력사 관리"
              : view === "products"
                ? "제품·견적 관리"
              : view === "quotations"
                ? "견적서 관리"
              : view === "installation-schedule"
                ? "시공·납품 일정표"
              : view === "map"
                ? "영업·수주 지도"
              : view === "lounge"
                ? "사내 휴게실"
              : view === "team"
                ? "구성원 관리"
                : view === "backup"
                  ? "데이터 백업·복구"
                : view === "accounting"
                  ? "수금·채권 관리"
                : view === "analytics"
                  ? "수주·제품 통계"
                : view === "owner-performance"
                  ? "경영 요약"
                : view === "inventory"
                  ? "물류·재고 관리"
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
    (row) =>
      row.selected &&
      !row.duplicate &&
      (creatingAward
        ? Boolean(row.values.organization.trim())
        : row.errors.length === 0),
  ).length;
  const activityImportErrorCount = activityImportRows.filter(
    (row) => row.errors.length > 0,
  ).length;
  const activityImportAutoFillCount = activityImportRows.filter(
    (row) => row.errors.length > 0 || row.warnings.length > 0,
  ).length;
  const activityImportDuplicateCount = activityImportRows.filter(
    (row) => row.duplicate,
  ).length;
  const activityImportPageSize = 500;
  const activityImportPageCount = Math.max(
    1,
    Math.ceil(activityImportRows.length / activityImportPageSize),
  );
  const visibleActivityImportRows = activityImportRows.slice(
    (activityImportPage - 1) * activityImportPageSize,
    activityImportPage * activityImportPageSize,
  );
  const selectableActivityImportRows = activityImportRows.filter(
    (row) =>
      !row.duplicate &&
      row.budgetMatchStatus !== "review" &&
      (creatingAward
        ? Boolean(row.values.organization.trim())
        : row.errors.length === 0),
  );
  const allActivityImportRowsSelected =
    selectableActivityImportRows.length > 0 &&
    selectableActivityImportRows.every((row) => row.selected);
  const managerIssueCards: {
    id: ManagerIssueFilter;
    label: string;
    value: number;
    help: string;
  }[] = [
    {
      id: "attention",
      label: "오늘 점검 필요",
      value: managerCounts.attention,
      help: "놓치기 쉬운 기관을 한 번에 확인",
    },
    {
      id: "overdue",
      label: "재연락 지연",
      value: managerCounts.overdue,
      help: "약속한 연락일이 지난 기관",
    },
    {
      id: "stalled",
      label: "14일 이상 정체",
      value: managerCounts.stalled,
      help: "최근 활동이 없는 진행 기관",
    },
    {
      id: "ownerless",
      label: "담당자 미지정",
      value: managerCounts.ownerless,
      help: "진행 담당자가 비어 있는 기관",
    },
    {
      id: "missing",
      label: "정보 보완 필요",
      value: managerCounts.missing,
      help: "다음 행동·날짜·담당자·견적 누락",
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
      <datalist id="partner-award-company-options">
        <option value="위즈업" />
        {partnerAwardCompanyOptions.map((company) => (
          <option key={company} value={company} />
        ))}
      </datalist>
      <datalist id="award-company-options">
        {awardCompanyOptions.map((company) => (
          <option key={company} value={company} />
        ))}
      </datalist>
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-logo" role="img" aria-label="WHIZZUP" />
          <span className="brand-product">SALES HUB</span>
        </div>

        <nav className="main-nav" aria-label="주요 메뉴">
          <div className="menu-order-toolbar">
            <p>WORKSPACE</p>
            <div>
              {menuOrderEditing && (
                <button type="button" onClick={resetMenuOrder}>기본값</button>
              )}
              <button
                type="button"
                className={menuOrderEditing ? "is-editing" : ""}
                aria-pressed={menuOrderEditing}
                onClick={() => {
                  setMenuOrderEditing((current) => !current);
                  if (menuOrderEditing) setToast("메뉴 순서를 저장하고 잠갔습니다.");
                }}
              >
                {menuOrderEditing ? "저장·잠금" : "순서 변경"}
              </button>
            </div>
          </div>
          {orderedWorkspaceNavItems.map((item, index) => (
            <div
              className={`nav-sort-row ${draggingMenu?.group === "workspace" && draggingMenu.id === item.id ? "menu-dragging" : ""}`}
              key={item.id}
              data-menu-group="workspace"
              data-menu-id={item.id}
              onDragEnter={(event) => {
                if (draggingMenu?.group !== "workspace") return;
                event.preventDefault();
                reorderMenuItem("workspace", draggingMenu.id, item.id);
              }}
              onDragOver={(event) => {
                if (draggingMenu?.group === "workspace") event.preventDefault();
              }}
            >
              <button
                className={view === item.id ? "active" : ""}
                onClick={() => void selectView(item.id)}
              >
                <span className="nav-mark">{item.mark}</span>
                <span className="nav-label">{item.label}</span>
              </button>
              {menuOrderEditing && (
                <button
                  type="button"
                  className="nav-drag-handle"
                  draggable
                  aria-label={`${item.label} 순서 이동`}
                  title="끌어서 순서 변경"
                  onClick={(event) => event.preventDefault()}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", item.id);
                    setDraggingMenu({ group: "workspace", id: item.id });
                  }}
                  onDragEnd={() => setDraggingMenu(null)}
                  onPointerDown={(event) =>
                    beginMenuPointerDrag(
                      "workspace",
                      item.id,
                      event.pointerId,
                      event.pointerType,
                      event.clientX,
                      event.clientY,
                      event.currentTarget,
                    )
                  }
                  onPointerMove={(event) => {
                    if (menuPointerDragRef.current?.active) event.preventDefault();
                    updateMenuPointerDrag(
                      event.pointerId,
                      event.clientX,
                      event.clientY,
                    );
                  }}
                  onPointerUp={(event) => finishMenuPointerDrag(event.pointerId)}
                  onPointerCancel={(event) => finishMenuPointerDrag(event.pointerId)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp" && index > 0) {
                      event.preventDefault();
                      moveMenuItem("workspace", item.id, -1);
                    }
                    if (
                      event.key === "ArrowDown" &&
                      index < orderedWorkspaceNavItems.length - 1
                    ) {
                      event.preventDefault();
                      moveMenuItem("workspace", item.id, 1);
                    }
                  }}
                >
                  ⋮⋮
                </button>
              )}
            </div>
          ))}
          {(visibleManagementNavItems.length > 0 || isOwner) && (
            <div className="admin-nav-group">
              <p>
                운영 도구
                <span>{isOwner ? "대표관리자" : "보조관리자"}</span>
              </p>
              {orderedManagementNavItems.map((item, index) => (
                <div
                  className={`nav-sort-row ${draggingMenu?.group === "management" && draggingMenu.id === item.id ? "menu-dragging" : ""}`}
                  key={item.id}
                  data-menu-group="management"
                  data-menu-id={item.id}
                  onDragEnter={(event) => {
                    if (draggingMenu?.group !== "management") return;
                    event.preventDefault();
                    reorderMenuItem("management", draggingMenu.id, item.id);
                  }}
                  onDragOver={(event) => {
                    if (draggingMenu?.group === "management") event.preventDefault();
                  }}
                >
                  <button
                    className={`admin-nav-item ${item.id === "accounting" ? "long-label" : ""} ${view === item.id ? "active" : ""}`}
                    onClick={() => void selectView(item.id)}
                  >
                    <span className="nav-mark">{item.mark}</span>
                    <span className="nav-label">{item.label}</span>
                    {item.id === "team" && session.pendingCount > 0 && (
                      <em>{session.pendingCount}</em>
                    )}
                    {item.id === "organizations" &&
                      managerInspectionHydrated &&
                      managerOrganizations.length > 0 && (
                        <em>{managerOrganizations.length}</em>
                      )}
                    <small>{isOwner ? "대표" : "보조"}</small>
                  </button>
                  {menuOrderEditing && (
                    <button
                      type="button"
                      className="nav-drag-handle"
                      draggable
                      aria-label={`${item.label} 순서 이동`}
                      title="끌어서 순서 변경"
                      onClick={(event) => event.preventDefault()}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", item.id);
                        setDraggingMenu({ group: "management", id: item.id });
                      }}
                      onDragEnd={() => setDraggingMenu(null)}
                      onPointerDown={(event) =>
                        beginMenuPointerDrag(
                          "management",
                          item.id,
                          event.pointerId,
                          event.pointerType,
                          event.clientX,
                          event.clientY,
                          event.currentTarget,
                        )
                      }
                      onPointerMove={(event) => {
                        if (menuPointerDragRef.current?.active) event.preventDefault();
                        updateMenuPointerDrag(
                          event.pointerId,
                          event.clientX,
                          event.clientY,
                        );
                      }}
                      onPointerUp={(event) => finishMenuPointerDrag(event.pointerId)}
                      onPointerCancel={(event) =>
                        finishMenuPointerDrag(event.pointerId)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp" && index > 0) {
                          event.preventDefault();
                          moveMenuItem("management", item.id, -1);
                        }
                        if (
                          event.key === "ArrowDown" &&
                          index < orderedManagementNavItems.length - 1
                        ) {
                          event.preventDefault();
                          moveMenuItem("management", item.id, 1);
                        }
                      }}
                    >
                      ⋮⋮
                    </button>
                  )}
                </div>
              ))}
            </div>
            )}
        </nav>

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
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    void selectView("lounge");
                  }}
                >
                  <strong>♣ 사내 휴게실</strong>
                  <span>몽글이·콩이와 가볍게 홀덤을 즐겨보세요.</span>
                </button>
                {isPrimaryOwner && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void selectView("owner-performance");
                    }}
                  >
                    <strong>경영 요약</strong>
                    <span>담당자별 수주·마진·판매 실적을 확인합니다.</span>
                  </button>
                )}
                {isOwner && (
                  <button
                    type="button"
                    role="menuitem"
                    className={presentationMode ? "presentation-active" : ""}
                    onClick={() => updatePresentationMode(!presentationMode)}
                  >
                    <strong>
                      {presentationMode ? "시연 모드 종료" : "시연 모드 시작"}
                    </strong>
                    <span>
                      {presentationMode
                        ? "숨겼던 두 관리 메뉴를 다시 표시합니다."
                        : "팀 업무 현황과 관리자 영업점검만 숨깁니다."}
                    </span>
                  </button>
                )}
                <a href={signOutPath} role="menuitem">
                  로그아웃
                </a>
              </div>
            )}
          </div>
        </>
      </aside>

      {mobileNav && <button className="nav-scrim" aria-label="메뉴 닫기" onClick={() => setMobileNav(false)} />}

      <section className="workspace">
        <header className={`topbar${view === "dashboard" ? " has-dashboard-status" : ""}`}>
          <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="메뉴 열기">
            ☰
          </button>
          {view === "dashboard" ? (
            <GlobalInstitutionSearch onOpen={(organization, businessRound) => {
              setDetailBusinessRound(businessRound);
              setDetailOrganization(organization);
            }} />
          ) : view !== "map" && view !== "budget-institutions" && view !== "trash" && view !== "accounting" && view !== "analytics" && view !== "owner-performance" && view !== "inventory" && (
            <div className="global-search">
              <span>⌕</span>
              <BufferedInput
                value={view === "organizations" ? managerSearch : search}
                onCommit={(value) =>
                  view === "organizations"
                    ? setManagerSearch(value)
                    : setSearch(value)
                }
                placeholder={
                  view === "organizations"
                    ? "기관명, 진행 담당자, 점검 사유 검색"
                    : view === "products"
                      ? "품명, 규격, 단가, 비고, 수수료율·마진율 검색"
                    : "기관명, 담당자, 주제 검색"
                }
                aria-label="통합 검색"
              />
              <kbd>⌘ K</kbd>
            </div>
          )}
          {view === "dashboard" ? (
            <nav className="dashboard-status-strip" aria-label="업무 현황 바로가기">
              <button
                type="button"
                className="dashboard-status-card sales"
                onClick={() => void selectView("followup")}
              >
                <span>영업 현황</span>
                <small>전체 기관의 최신 영업 기록</small>
                <dl>
                  <div><dt>전체</dt><dd>{dashboardSalesCounts.total}</dd></div>
                  <div><dt>진행</dt><dd>{dashboardSalesCounts.active}</dd></div>
                  <div><dt>완료</dt><dd>{dashboardSalesCounts.completed}</dd></div>
                </dl>
              </button>
              <button
                type="button"
                className="dashboard-status-card awards"
                onClick={() => void selectView("awards")}
              >
                <span>수주·계약 현황</span>
                <small>위즈업 수주·계약만</small>
                <dl>
                  <div><dt>전체</dt><dd>{dashboardAwardCounts.total}</dd></div>
                  <div><dt>진행</dt><dd>{dashboardAwardCounts.active}</dd></div>
                  <div><dt>완료</dt><dd>{dashboardAwardCounts.completed}</dd></div>
                </dl>
              </button>
              <button
                type="button"
                className="dashboard-status-card construction"
                onClick={() => void selectView("installation-schedule")}
              >
                <span>시공·납품 현황</span>
                <small>일정표에 등록된 위즈업 수주</small>
                <dl>
                  <div><dt>예정</dt><dd>{constructionDashboardCounts.planned}</dd></div>
                  <div><dt>진행</dt><dd>{constructionDashboardCounts.active}</dd></div>
                  <div><dt>완료</dt><dd>{constructionDashboardCounts.completed}</dd></div>
                </dl>
              </button>
            </nav>
          ) : null}
          <div className="top-actions">
            <button className="ai-button" onClick={openAiRecorder}>
              <span>●</span> AI로 기록
            </button>
            <button className="primary-button" onClick={openNew}><span>＋</span> 새 기록</button>
          </div>
        </header>

        <div className={`content ${view === "dashboard" || view === "followup" || view === "map" || view === "budget-institutions" || view === "backup" || view === "records" || view === "organizations" || view === "awards" || view === "products" || view === "vendors" || view === "accounting" || view === "analytics" || view === "owner-performance" || view === "inventory" ? "content-wide" : ""}`}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">TM · MEETING MANAGEMENT</p>
              <h1>{title}</h1>
              <p>
                {view === "dashboard"
                  ? "오늘 업무와 개인 일정, 수주 후 설치·납품 일정을 한눈에 확인합니다."
                  : view === "team"
                  ? "가입 승인, 역할·권한, 영업 담당자와 실시간 접속 현황을 관리합니다."
                  : view === "backup"
                    ? "전체 업무 데이터를 안전하게 보관하고, 필요할 때 검증 후 복원합니다."
                  : view === "accounting"
                    ? "위즈업 수주의 입금 예정액을 확인하고, 실제 수금액과 미수금을 관리합니다."
                  : view === "analytics"
                    ? "회계 확인 기준의 월간·연간 수주와 제품 흐름을 확인합니다."
                  : view === "owner-performance"
                    ? "대표관리자 본인만 담당자별 수주·마진·판매 실적을 확인할 수 있습니다."
                  : view === "inventory"
                    ? "보유 장비의 현재 수량과 입고·출고·조정 이력을 한곳에서 관리합니다."
                   : view === "integration"
                     ? "사이트에서 사용할 OpenAI API 키와 모델을 안전하게 등록·교체합니다."
                    : view === "awards"
                      ? activeAwardsOnly
                        ? "납품 완료 전 수주 건만 모아 확인합니다."
                        : "위즈업 수주와 타업체 수주 결과를 함께 관리합니다."
                      : view === "vendors"
                        ? "협력사의 사업자·정산·담당자 정보와 증빙 문서를 한곳에서 관리합니다."
                      : view === "products"
                        ? "표준 견적서의 제품 정보와 단가·수수료율·마진율을 한곳에서 확인합니다."
                      : view === "map"
                        ? "기관 위치와 진행 상태를 확인하고, 방문할 학교를 선택해 영업 동선을 계획합니다."
                      : view === "budget-institutions"
                        ? "선정기관 명단을 예산별로 관리하고, 기존 영업 기록과 안전하게 연결합니다."
                      : view === "lounge"
                        ? "가상 칩으로 가볍게 쉬어가는 승인 구성원 전용 공간입니다."
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

          {view === "vendors" ? (
            <Suspense fallback={<DeferredPageFallback />}>
              <AwardVendorPage />
            </Suspense>
          ) : view === "lounge" ? (
            <Suspense fallback={<DeferredPageFallback />}>
              <HoldemLounge displayName={session.member.displayName} />
            </Suspense>
          ) : view === "dashboard" && (
            <>
              <section
                className={`ai-record-panel ${
                  aiImageDragActive ? "is-image-dragging" : ""
                }`}
                aria-labelledby="ai-record-title"
                onPaste={handleAiImagePaste}
                onDragOver={handleAiImageDragOver}
                onDragLeave={handleAiImageDragLeave}
                onDrop={handleAiImageDrop}
              >
                <div className="ai-record-copy">
                  <span className="ai-orb" aria-hidden="true">●</span>
                  <div>
                    <span className="section-kicker">AI QUICK RECORD</span>
                    <h2 id="ai-record-title">미팅·통화 내용을 편하게 남겨보세요</h2>
                    <p>내용을 편하게 적으면 AI가 기관별 기록·일정·제안 품목을 정리합니다.</p>
                  </div>
                </div>
                <label className="ai-detail-level-control">
                  <span>상세 기록</span>
                  <select
                    value={aiDetailLevelPreference}
                    onChange={(event) =>
                      setAiDetailLevelPreference(
                        event.target.value as "auto" | ActivityDetailLevel,
                      )
                    }
                    disabled={aiOrganizing}
                  >
                    <option value="auto">AI 자동 판단</option>
                    <option value="compact">간단 기록</option>
                    <option value="standard">일반 기록</option>
                    <option value="detailed">상세 기록</option>
                  </select>
                </label>
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
                      const mobileTextEntry =
                        window.innerWidth <= 900 &&
                        window.matchMedia("(pointer: coarse)").matches;
                      if (event.shiftKey || mobileTextEntry) {
                        return;
                      }
                      event.preventDefault();
                      void startAiRecord();
                    }}
                    aria-label="AI에 전달할 기록 내용"
                    disabled={
                      aiOrganizing ||
                      aiImageAnalyzing ||
                      voiceRecordingStatus === "transcribing"
                    }
                  />
                  <div className="ai-record-actions">
                    {canUseVoiceInput && (
                      <button
                        type="button"
                        className={`ai-voice-button ${
                          voiceRecordingStatus === "recording"
                            ? "is-recording"
                            : voiceRecordingStatus === "transcribing"
                              ? "is-transcribing"
                              : ""
                        }`}
                        onClick={() => void toggleVoiceRecording()}
                        disabled={
                          aiOrganizing ||
                          aiImageAnalyzing ||
                          voiceRecordingStatus === "transcribing"
                        }
                        aria-pressed={voiceRecordingStatus === "recording"}
                      >
                        <span aria-hidden="true">
                          {voiceRecordingStatus === "recording" ? "■" : "●"}
                        </span>
                        {voiceRecordingStatus === "recording"
                          ? `녹음 종료 ${formatVoiceElapsed(voiceElapsedSeconds)}`
                          : voiceRecordingStatus === "transcribing"
                            ? "음성 변환 중…"
                            : "음성으로 입력"}
                      </button>
                    )}
                    {canUseImageInput && (
                      <>
                        <button
                          type="button"
                          className="ai-image-button"
                          onClick={() => aiImageInputRef.current?.click()}
                          disabled={
                            aiOrganizing ||
                            aiImageAnalyzing ||
                            voiceRecordingStatus !== "idle" ||
                            aiImageAttachments.length >= 5
                          }
                        >
                          <span aria-hidden="true">▣</span>
                          사진 추가
                        </button>
                        <input
                          ref={aiImageInputRef}
                          className="ai-image-file-input"
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleAiImagePicker}
                          tabIndex={-1}
                        />
                      </>
                    )}
                    <button
                      type="button"
                      className="ai-submit-button"
                      onClick={() => void startAiRecord()}
                      disabled={
                        !aiDraft.trim() ||
                        aiOrganizing ||
                        aiImageAnalyzing ||
                        voiceRecordingStatus !== "idle"
                      }
                    >
                      <span aria-hidden="true">●</span>
                      {aiOrganizing
                        ? "AI 정리 중…"
                        : session?.aiConfigured === false
                          ? "API 연결 필요"
                          : "사이트에서 AI 정리"}
                    </button>
                  </div>
                  {canUseImageInput && aiImageAttachments.length > 0 && (
                    <div className="ai-image-queue">
                      <div className="ai-image-queue-copy">
                        <strong>
                          사진 {aiImageAttachments.length}장 준비됨
                        </strong>
                        <span>
                          내용을 확인한 뒤 입력창에 초안으로만 넣습니다.
                        </span>
                      </div>
                      <div className="ai-image-preview-list">
                        {aiImageAttachments.map((attachment, index) => (
                          <div
                            className="ai-image-preview"
                            key={attachment.id}
                          >
                            <img
                              src={attachment.previewUrl}
                              alt={`분석할 사진 ${index + 1}`}
                            />
                            <button
                              type="button"
                              aria-label={`사진 ${index + 1} 제거`}
                              onClick={() =>
                                removeAiImageAttachment(attachment.id)
                              }
                              disabled={aiImageAnalyzing}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="ai-image-queue-actions">
                        <button
                          type="button"
                          className="ai-image-clear-button"
                          onClick={clearAiImageAttachments}
                          disabled={aiImageAnalyzing}
                        >
                          모두 빼기
                        </button>
                        <button
                          type="button"
                          className="ai-image-analyze-button"
                          onClick={() => void analyzeAiImages()}
                          disabled={aiImageAnalyzing}
                        >
                          {aiImageAnalyzing
                            ? "사진 분석 중…"
                            : `${aiImageAttachments.length}장 분석해서 입력`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <small>
                  PC는 Enter로 AI 정리, Shift+Enter로 줄바꿈합니다. 모바일은
                  Enter로 줄바꿈합니다.
                  {canUseVoiceInput &&
                    " 음성은 버튼을 다시 누르면 글자로 바뀝니다."}
                  {canUseImageInput &&
                    " 사진은 선택·드래그앤드롭·Ctrl+V로 추가할 수 있습니다."}
                  {(canUseVoiceInput || canUseImageInput) &&
                    " 음성과 사진 모두 자동 전송되지 않습니다."}
                </small>
                {session?.aiConfigured === false && (
                  <div className="ai-connection-note">
                    <span>API 연결 준비 중</span>
                    관리자에게 사이트 AI API 연결 상태를 확인해 주세요.
                  </div>
                )}
                {voiceError && (
                  <div className="ai-inline-error">{voiceError}</div>
                )}
                {aiImageError && (
                  <div className="ai-inline-error">{aiImageError}</div>
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
                          </div>
                          <div className="ai-preview-grid">
                            <div><span>날짜</span><strong>{formatDate(aiPreview.activityDate)}</strong></div>
                            <div><span>지역</span><strong>{aiPreview.region || "—"}</strong></div>
                            <div className="ai-budget-match">
                              <span>예산 판정</span>
                              <strong>
                                {aiPreview.budgetOriginalName ||
                                  aiPreview.budgetType ||
                                  "입력 없음"}
                                {aiPreview.budgetOriginalName &&
                                aiPreview.budgetType &&
                                budgetNameKey(aiPreview.budgetOriginalName) !==
                                  budgetNameKey(aiPreview.budgetType)
                                  ? ` → ${aiPreview.budgetType}`
                                  : ""}
                              </strong>
                              <small>
                                {budgetMatchStatusLabel(
                                  aiPreview.budgetMatchStatus ||
                                    "unclassified",
                                )}
                                {aiPreview.budgetMatchMethod
                                  ? ` · ${aiPreview.budgetMatchMethod}`
                                  : ""}
                                {formatBudgetDisplay(aiPreview.budgetAmount)
                                  ? ` · ${formatBudgetDisplay(aiPreview.budgetAmount)}`
                                  : ""}
                              </small>
                              {aiPreview.budgetMatchStatus === "review" && (
                                <small>
                                  후보{" "}
                                  {resolveBudgetFromCatalog(
                                    aiPreview.budgetOriginalName ||
                                      aiPreview.budgetType,
                                    budgetReviewCatalog,
                                  ).candidates.join(", ") || "확인 필요"}
                                </small>
                              )}
                            </div>
                            <div><span>수주</span><strong>{aiPreview.awardStatus || "미정"}</strong></div>
                            <div><span>사업방식</span><strong>{[aiPreview.executionType, aiPreview.consortiumCompany].filter((value) => value && value !== "미정").join(" · ") || "미정"}</strong></div>
                            <div><span>수주 현재 상태</span><strong>{aiPreview.awardStage || "미정"}</strong></div>
                            <div><span>진행 담당자</span><strong>{aiPreview.progressManager || "미정"}</strong></div>
                            <div>
                              <span>기록 수준</span>
                              <strong>
                                {aiPreview.detailLevel === "detailed"
                                  ? "상세"
                                  : aiPreview.detailLevel === "standard"
                                    ? "일반"
                                    : "간단"}
                              </strong>
                            </div>
                          </div>
                          <p className="ai-preview-summary">
                            {aiPreview.summary || "요약 내용이 없습니다. 확인 화면에서 보완해 주세요."}
                          </p>
                          <div className="ai-preview-equipment">
                            <span>
                              품목 관리에 연결
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

              <Suspense fallback={<DeferredPageFallback />}>
                <HomeCalendar
                  key={scheduleReminderRefreshVersion}
                  refreshVersion={scheduleReminderRefreshVersion}
                  records={records}
                  onOpenOrganization={(organization, businessRound) => {
                    setDetailBusinessRound(businessRound);
                    setDetailOrganization(organization);
                  }}
                  onOpenConstructionSchedule={() => navigateTo("installation-schedule")}
                />
              </Suspense>

              <Suspense fallback={<DeferredPageFallback />}>
                <ConstructionSchedulePage
                  embedded
                  records={records}
                  onDashboardCounts={setConstructionDashboardCounts}
                  onOpenOrganization={(organization, businessRound) => {
                    setDetailBusinessRound(businessRound);
                    setDetailOrganization(organization);
                  }}
                />
              </Suspense>

              <section
                className={`my-record-review-card ${
                  pendingActivityReviewGroups.length ||
                  protectionReviewItems.length ||
                  correctionRequests.length
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
                      {pendingActivityReviewGroups.length ||
                      protectionReviewItems.length ||
                      correctionRequests.length
                        ? "기록·품목 금액 보완과 영업보호 신청 업무를 한곳에서 확인합니다."
                        : "내가 진행 담당자인 기록과 품목에 확인할 내용이 없습니다."}
                    </p>
                  </div>
                </div>
                <div className="my-record-review-summary">
                  <span>
                    보완 필요 <b>{pendingActivityReviewGroups.length}</b>곳
                  </span>
                  <span>
                    영업보호 필요 <b>{protectionReviewItems.length}</b>건
                  </span>
                  <span>
                    금액 보완 <b>{correctionRequests.length}</b>건
                  </span>
                </div>
                <button
                  type="button"
                  onClick={openActivityReview}
                  disabled={
                    !activityReviewsLoading &&
                    !protectionReviewsLoading &&
                    !correctionRequestsLoading &&
                    pendingActivityReviewGroups.length +
                      protectionReviewItems.length +
                      correctionRequests.length ===
                      0
                  }
                >
                  {pendingActivityReviewGroups.length ||
                  protectionReviewItems.length ||
                  correctionRequests.length
                      ? "확인할 업무 보기"
                      : activityReviewsLoading ||
                          protectionReviewsLoading ||
                          correctionRequestsLoading
                        ? "확인할 업무 보기"
                        : "점검 완료"}
                </button>
              </section>

              {false && <section className="my-schedule-panel" aria-labelledby="my-schedule-title">
                <div className="my-schedule-heading">
                  <div>
                    <span className="section-kicker">MY SCHEDULE</span>
                    <h2 id="my-schedule-title">내 일정</h2>
                    <p>
                      기한이 지났거나 2일 안에 다가오는 내 재연락 일정입니다. 담당자 본인에게만 보입니다.
                    </p>
                  </div>
                  <strong>{scheduleReminders.length}건</strong>
                </div>
                {scheduleRemindersLoading ? (
                  <div className="my-schedule-empty">내 일정을 확인하는 중입니다.</div>
                ) : scheduleReminders.length > 0 ? (
                  <div className="my-schedule-list">
                    {scheduleReminders.map((reminder) => {
                      const timing = scheduleReminderTiming(
                        reminder.scheduledDate,
                        todayValue,
                      );
                      const recentlyUpdated = scheduleReminderWasRecentlyUpdated(
                        reminder.updatedAt,
                        todayValue,
                      );
                      return (
                        <div className="my-schedule-row" key={reminder.id}>
                          <button
                            type="button"
                            className="my-schedule-open"
                            onClick={() => {
                              setDetailBusinessRound(reminder.businessRound);
                              setDetailOrganization(reminder.organization);
                            }}
                            aria-label={`${reminder.organization} 일정 상세 보기`}
                          >
                            <span className={`my-schedule-timing ${timing.tone}`}>
                              {timing.label}
                            </span>
                            <span className="my-schedule-copy">
                              <strong>{reminder.organization}</strong>
                              <small>{reminder.label}</small>
                              {reminder.conflict && (
                                <em className="my-schedule-conflict">같은 날 일정 겹침</em>
                              )}
                              {recentlyUpdated && reminder.updatedByName ? (
                                <em className="my-schedule-recent">
                                  최근 수정 · {reminder.updatedByName}
                                </em>
                              ) : null}
                            </span>
                            <span className="my-schedule-meta">
                              <b>{formatScheduleDate(reminder.scheduledDate)}</b>
                              <small>
                                {reminder.visibility === "shared-post-award"
                                  ? "수주 후 공유 일정"
                                  : "개인 일정"}
                              </small>
                            </span>
                          </button>
                          {timing.tone === "overdue" ? (
                            <button
                              type="button"
                              className="my-schedule-complete"
                              disabled={scheduleReminderCompletingId !== null}
                              onClick={() =>
                                void completePastScheduleReminder(reminder)
                              }
                            >
                              {scheduleReminderCompletingId === reminder.id
                                ? "처리 중"
                                : "확인 완료"}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="my-schedule-empty">
                    지금 확인할 개인 일정이 없습니다.
                  </div>
                )}
                <p className="my-schedule-note">
                  확인 완료한 지난 일정은 목록에서 사라지고 기록은 안전하게 유지됩니다.
                </p>
              </section>}

              {false && <>
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
                  <p>납품 완료 전 기관</p>
                  <span className="metric-link">목록 보기 →</span>
                </button>
              </section>

              <section className="dashboard-grid schedule-dashboard-grid">
                <article className="panel schedule-panel">
                  <div className="panel-header">
                    <div><span className="section-kicker">PROGRESS CALENDAR</span><h2>진행 일정표</h2></div>
                    <div className="schedule-dashboard-controls">
                      <span className="period-label">
                        {dashboardPastSchedulesOpen ? "전체 일정" : "오늘 이후"} · {dashboardVisibleProgressSchedules.length}개 기관 · {dashboardVisibleProgressScheduleCount}개 일정
                      </span>
                      <button
                        type="button"
                        className={dashboardPastSchedulesOpen ? "active" : ""}
                        onClick={() =>
                          setDashboardPastSchedulesOpen((current) => !current)
                        }
                        aria-expanded={dashboardPastSchedulesOpen}
                      >
                        {dashboardPastSchedulesOpen ? "지난 일정 숨기기" : "지난 일정 보기"}
                        {dashboardPastProgressScheduleCount > 0 && (
                          <b>{dashboardPastProgressScheduleCount}</b>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="schedule-list">
                    <div className="schedule-head" aria-hidden="true">
                      <span>학교·기관</span>
                      <span>진행 일정</span>
                    </div>
                    {dashboardVisibleProgressSchedules.map((row) => (
                      <div className="schedule-row" key={row.organization}>
                        <strong>{row.organization}</strong>
                        <div className="schedule-dates">
                          {row.items.map((item) => (
                            <span
                              className={`schedule-chip${item.date < todayValue ? " schedule-chip-past" : ""}`}
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
                    {!loading && dashboardVisibleProgressSchedules.length === 0 && (
                      <div className="empty-state schedule-empty">
                        {dashboardPastSchedulesOpen
                          ? "등록된 진행 일정이 없습니다."
                          : "오늘 이후 등록된 진행 일정이 없습니다. 과거 일정은 지난 일정 보기에서 확인할 수 있습니다."}
                      </div>
                    )}
                  </div>
                </article>

              </section>
              </>}
            </>
          )}

          {(view === "map" || view === "budget-institutions") && (
            <Suspense fallback={<DeferredPageFallback />}>
              <SalesMapPage
                active
                displayMode={
                  view === "budget-institutions" ? "budget" : "map"
                }
                records={records}
                recordsReady={recordsFullyLoaded}
                isOwner={isOwner}
                canManageCampaigns={canManageMap}
                canEditLocations={sessionStatus === "approved"}
                search={search}
                onSearchChange={setSearch}
                onOpenOrganization={setDetailOrganization}
                onRecordsChanged={loadRecords}
                onOpenMapCampaign={() => {
                  void selectView("map");
                }}
              />
            </Suspense>
          )}

          {view === "map" || view === "budget-institutions" || view === "lounge" ? null : view === "accounting" ? (
            <Suspense fallback={<DeferredPageFallback />}>
              <AccountingPage
                key={accountingInitialTab}
                initialTab={accountingInitialTab}
                onSaved={() => void loadVisibleAccountingStatuses()}
              />
            </Suspense>
          ) : view === "analytics" ? (
            <Suspense fallback={<DeferredPageFallback />}>
              <AnalyticsPage
                canRequestCorrections={canManageRecords}
                onOpenAwards={() => void selectView("awards")}
                onOpenCollectionAnalysis={() => {
                  void selectView("accounting", { accountingTab: "analysis" });
                }}
                onOpenOrganization={(organization, businessRound) => {
                  setDetailBusinessRound(businessRound);
                  setDetailOrganization(organization);
                }}
              />
            </Suspense>
          ) : view === "owner-performance" && isPrimaryOwner ? (
            <Suspense fallback={<DeferredPageFallback />}>
              <OwnerPerformancePage
                onOpenOrganization={(organization, businessRound) => {
                  setDetailBusinessRound(businessRound);
                  setDetailOrganization(organization);
                }}
              />
            </Suspense>
          ) : view === "installation-schedule" ? (
            <Suspense fallback={<DeferredPageFallback />}>
              <ConstructionSchedulePage
                records={records}
                onOpenOrganization={(organization, businessRound) => {
                  setDetailBusinessRound(businessRound);
                  setDetailOrganization(organization);
                }}
              />
            </Suspense>
          ) : view === "inventory" ? (
            <Suspense fallback={<DeferredPageFallback />}>
              <InventoryPage />
            </Suspense>
          ) : view === "products" || view === "quotations" ? (
            <Suspense fallback={<DeferredPageFallback />}>
              <ProductCatalogPage
                search={search}
                onSearchChange={setSearch}
                institutions={[
                  ...new Map(
                    records
                      .filter((record) => record.organization.trim())
                      .map((record) => [
                        `${record.organization}\u001f${record.businessRound}`,
                        {
                          organization: record.organization,
                          businessRound: record.businessRound,
                          budgetType: record.budgetType,
                        },
                      ]),
                  ).values(),
                ].sort((left, right) =>
                  left.organization.localeCompare(right.organization, "ko-KR"),
                )}
              />
            </Suspense>
          ) : view === "schedules" ? (
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
                <form
                  className="member-email-register"
                  onSubmit={(event) => void registerMemberByEmail(event)}
                >
                  <div>
                    <strong>이메일로 구성원 바로 등록</strong>
                    <span>
                      로그인 전에 미리 승인합니다. 등록 후 아래에서 역할·권한을 조정할 수 있습니다.
                    </span>
                  </div>
                  <input
                    type="email"
                    value={memberInviteEmail}
                    onChange={(event) => setMemberInviteEmail(event.target.value)}
                    placeholder="예: teammate@gmail.com"
                    aria-label="등록할 구성원 이메일"
                    required
                  />
                  <input
                    value={memberInviteName}
                    onChange={(event) => setMemberInviteName(event.target.value)}
                    placeholder="이름"
                    aria-label="등록할 구성원 이름"
                    required
                  />
                  <button
                    type="submit"
                    disabled={
                      memberInviteSaving ||
                      !memberInviteEmail.trim() ||
                      !memberInviteName.trim()
                    }
                  >
                    {memberInviteSaving ? "등록 중" : "승인 등록"}
                  </button>
                </form>
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
                                ? (
                                  <>
                                    접속 중
                                    {presenceViewLabel(
                                      memberPresence[member.id]?.currentView || "",
                                    ) && (
                                      <em>
                                        · {presenceViewLabel(
                                          memberPresence[member.id]?.currentView || "",
                                        )}
                                      </em>
                                    )}
                                  </>
                                )
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
                              : memberAccessPresetLabels[
                                  memberAccessPreset(member)
                                ]}
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
                                        ? preset === "custom"
                                          ? {
                                              ...item,
                                              role: "assistant",
                                            }
                                          : {
                                              ...item,
                                              role:
                                                memberAccessPresetDefinitions[preset]
                                                  .role,
                                              permissions: [
                                                ...memberAccessPresetDefinitions[
                                                  preset
                                                ].permissions,
                                                ...item.permissions.filter(
                                                  (permission) =>
                                                    memberAiInputPermissionOptions.some(
                                                      (option) =>
                                                        option.id === permission,
                                                    ),
                                                ),
                                              ],
                                              isSales:
                                                memberAccessPresetDefinitions[preset]
                                                  .isSales,
                                            }
                                        : item,
                                    ),
                                  );
                                }}
                              >
                                <option value="sales">영업 담당자</option>
                                <option value="salesManager">영업 관리자</option>
                                <option value="accounting">회계 담당자</option>
                                <option value="operations">운영 관리자</option>
                                <option value="custom">직접 설정</option>
                              </select>
                            </label>
                            <section className="member-permission-group">
                              <div className="member-permission-heading">
                                <strong>AI 입력 기능</strong>
                                <span>
                                  필요한 직원에게만 음성과 사진 분석을 허용합니다.
                                </span>
                              </div>
                              <div className="member-permission-list">
                                {memberAiInputPermissionOptions.map((option) => (
                                  <label key={option.id}>
                                    <input
                                      type="checkbox"
                                      checked={member.permissions.includes(option.id)}
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
                            </section>
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
                                  {
                                    memberAccessPresetLabels[
                                      memberAccessPreset(member)
                                    ]
                                  }
                                </strong>
                                <span>
                                  {memberAccessPresetDescription(
                                    memberAccessPreset(member),
                                  )}
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
                              역할·기능 권한 저장
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
            <Suspense fallback={<DeferredPageFallback />}>
              <DataBackupPage
                onDataChanged={loadRecords}
                notify={setToast}
                isPrimaryOwner={isOwner}
                canManageBackup={canManageBackup}
                canManageTrash={canManageTrash}
              />
            </Suspense>
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

              <article className="panel openai-settings-card school-directory-settings-card">
                <div className="openai-settings-heading">
                  <div>
                    <span className="section-kicker">NEIS SCHOOL API</span>
                    <h2>전국 학교정보 연결</h2>
                    <p>
                      초·중·고·여고처럼 다르게 입력된 학교명을 나이스 공식
                      학교정보와 대조합니다. 조회 결과는 저장해 반복 호출을 줄입니다.
                    </p>
                  </div>
                  <span
                    className={`openai-connection-status ${
                      schoolDirectorySettings?.configured
                        ? "connected"
                        : "disconnected"
                    }`}
                  >
                    <i />
                    {schoolDirectorySettings?.configured
                      ? "현재 연결됨"
                      : "연결 필요"}
                  </span>
                </div>

                <div className="openai-current-settings kakao-current-settings">
                  <div>
                    <span>사용 중인 설정</span>
                    <strong>
                      {schoolDirectorySettings?.source === "registered"
                        ? "화면에서 등록한 나이스 키"
                        : schoolDirectorySettings?.source === "server"
                          ? "서버에 설정된 기존 나이스 키"
                          : "등록되지 않음"}
                    </strong>
                    <small>
                      {schoolDirectorySettings?.configured
                        ? `키 끝 4자리 · ${schoolDirectorySettings.keyLast4 || "확인 불가"}`
                        : "공식 학교정보 연결 전에도 기존 기관 비교는 작동합니다."}
                    </small>
                  </div>
                  <div>
                    <span>조회 방식</span>
                    <strong>필요할 때만 조회</strong>
                    <small>같은 검색 결과는 30일 동안 재사용합니다.</small>
                  </div>
                </div>

                <div className="openai-registration-form kakao-registration-form">
                  <label>
                    <span>나이스 교육정보 API 인증키</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={schoolDirectoryApiKey}
                      onChange={(event) =>
                        setSchoolDirectoryApiKey(event.target.value)
                      }
                      placeholder="나이스 교육정보 개방 포털 인증키"
                    />
                    <small>
                      키 원문은 다시 표시하지 않으며 공식 학교명 확인에만 사용합니다.
                    </small>
                  </label>
                </div>

                <div className="openai-settings-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={schoolDirectorySettingsBusy}
                    onClick={() => void manageSchoolDirectorySettings("test")}
                  >
                    입력한 키 연결 테스트
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={schoolDirectorySettingsBusy}
                    onClick={() => void manageSchoolDirectorySettings("save")}
                  >
                    학교정보 연결 저장
                  </button>
                  <button
                    type="button"
                    className="outline-danger"
                    disabled={
                      schoolDirectorySettingsBusy ||
                      !schoolDirectorySettings?.serverFallbackConfigured ||
                      schoolDirectorySettings.source === "server"
                    }
                    onClick={() => void manageSchoolDirectorySettings("revert")}
                  >
                    서버 기존 키로 되돌리기
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={
                      schoolDirectorySettingsBusy ||
                      schoolDirectorySyncBusy ||
                      !schoolDirectorySettings?.configured
                    }
                    onClick={() => void syncSchoolDirectory()}
                  >
                    {schoolDirectorySyncBusy
                      ? "학교정보 최신화 중…"
                      : "학교 대표전화 최신화"}
                  </button>
                </div>
                {schoolDirectoryConnectionMessage && (
                  <p className="openai-connection-message" role="status">
                    {schoolDirectoryConnectionMessage}
                  </p>
                )}
                <p className="openai-security-note">
                  인증키와 학교정보 캐시는 전체 DB 백업에 포함하지 않습니다.
                  외부 조회가 지연되어도 영업 기록 저장은 계속할 수 있습니다.
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
              <nav className="manager-admin-tabs" aria-label="관리자 영업 점검 메뉴">
                <button
                  type="button"
                  className={managerAdminSection === "alerts" ? "active" : ""}
                  onClick={() => setManagerAdminSection("alerts")}
                >
                  영업 점검
                </button>
                <button
                  type="button"
                  className={managerAdminSection === "budgets" ? "active" : ""}
                  onClick={() => setManagerAdminSection("budgets")}
                >
                  표준 예산명 관리
                </button>
              </nav>
              {managerAdminSection === "budgets" ? (
                <BudgetNameManager onToast={setToast} />
              ) : (
                <>
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
                      {managerAlertsLoading || !managerInspectionHydrated
                        ? "처리한 알림과 등록 견적을 확인하고 있습니다."
                        : "확인 완료해도 기관과 영업 기록은 유지되며, 오래된 처리 알림만 목록에서 숨길 수 있습니다."}
                    </p>
                  </div>
                  <div className="manager-header-actions">
                    <button
                      type="button"
                      className={managerIssueFilter === "all" ? "active" : ""}
                      onClick={() => selectManagerIssueFilter("all")}
                    >
                      미처리 전체 {managerCounts.all}곳
                    </button>
                    <button
                      type="button"
                      className={
                        managerIssueFilter === "processed" ? "active" : ""
                      }
                      onClick={() => selectManagerIssueFilter("processed")}
                    >
                      처리한 알림 {managerCounts.processed}곳
                    </button>
                    <span className="record-count">{managerOrganizations.length}곳</span>
                  </div>
                </div>
                <div className="manager-toolbar">
                  <div className="manager-view-controls">
                    {canManageRecords && managerAlertMembers.length > 0 && (
                      <label className="manager-member-select">
                        <span>점검 화면</span>
                        <select
                          aria-label="관리자 영업 점검 사용자"
                          value={managerAlertMemberId ?? ""}
                          disabled={managerAlertsLoading}
                          onChange={(event) =>
                            void selectManagerAlertMember(
                              Number(event.target.value),
                            )
                          }
                        >
                          {managerAlertMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="inline-search">
                      <span>⌕</span>
                      <BufferedInput
                        value={managerSearch}
                        onCommit={setManagerSearch}
                        placeholder="기관명, 진행 담당자, 점검 사유 검색"
                      />
                    </div>
                  </div>
                  {canManageRecords && (
                    <div className="manager-selection-actions">
                      <button
                        type="button"
                        onClick={toggleCurrentManagerPage}
                      >
                        {currentManagerPageSelected
                          ? "현재 페이지 선택 해제"
                          : "현재 페이지 전체 선택"}
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
                      {managerIssueFilter === "processed" ? (
                        <>
                          <button
                            type="button"
                            className="manager-alert-hide"
                            disabled={
                              !selectedOrganizations.length ||
                              managerAlertsSaving
                            }
                            onClick={() =>
                              void hideManagerAlerts(selectedOrganizations)
                            }
                          >
                            선택 기록 숨김
                            {selectedOrganizations.length > 0
                              ? ` ${selectedOrganizations.length}`
                              : ""}
                          </button>
                          <button
                            type="button"
                            className="manager-alert-hide"
                            disabled={managerAlertsSaving}
                            onClick={() => void hideManagerAlerts([], 30)}
                          >
                            30일 지난 알림 정리
                          </button>
                        </>
                      ) : (
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
                {canManageRecords && currentManagerPageSelected && (
                  <div className="award-selection-banner" role="status">
                    {allFilteredManagerOrganizationsSelected ? (
                      <>
                        <strong>
                          검색 결과 {managerOrganizations.length.toLocaleString()}곳이 모두 선택되었습니다.
                        </strong>
                        <button type="button" onClick={() => setSelectedOrganizations([])}>
                          선택 해제
                        </button>
                      </>
                    ) : (
                      <>
                        <strong>
                          현재 페이지 {managerPageOrganizations.length.toLocaleString()}곳이 선택되었습니다.
                        </strong>
                        <button type="button" onClick={selectAllFilteredManagerOrganizations}>
                          검색 결과 {managerOrganizations.length.toLocaleString()}곳 전체 선택
                        </button>
                      </>
                    )}
                  </div>
                )}
                <StickyTableWrap className="data-list-table">
                  <table className="manager-inspection-table">
                    <thead>
                      <tr>
                        {canManageRecords && <th className="manager-col-select">선택</th>}
                        <th className="manager-col-priority">우선순위</th>
                        <th className="manager-col-organization">기관</th>
                        <th className="manager-col-manager">진행 담당자</th>
                        <th className="manager-col-contact">최근 접촉</th>
                        <th className="manager-col-situation">현재 상황</th>
                        <th className="manager-col-issues">점검 사유</th>
                        <th className="manager-col-actions"><span className="sr-only">처리</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {managerPageOrganizations.map((organization) => {
                        const record = organization.latest;
                        const processed =
                          managerIssueFilter === "processed";
                        const acknowledgement =
                          managerAlertByOrganization.get(
                            institutionAliasKey(organization.name),
                          );
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
                                  "button, input, label, details, summary",
                                )
                              ) {
                                return;
                              }
                              setDetailOrganization(organization.name);
                            }}
                          >
                            {canManageRecords && (
                              <td className="manager-col-select">
                                <input
                                  type="checkbox"
                                  aria-label={`${organization.name} 선택`}
                                  checked={selectedOrganizationSet.has(organization.name)}
                                  onChange={() => toggleOrganization(organization.name)}
                                />
                              </td>
                            )}
                            <td className="manager-col-priority">
                              <span className={`manager-priority ${priority}`}>
                                {priority === "urgent"
                                  ? "긴급"
                                  : priority === "check"
                                    ? "확인"
                                    : "처리됨"}
                              </span>
                            </td>
                            <td className="manager-col-organization">
                              <strong className="manager-organization-name">
                                {organization.name}
                              </strong>
                              <small>
                                {record.region || "지역 미등록"}
                                {organization.highOpportunity
                                  ? " · 주요 영업 기회"
                                  : ""}
                              </small>
                              {organization.latestContact.contactName && (
                                <small className="manager-contact-preview">
                                  담당자 {organization.latestContact.contactName}
                                  {organization.latestContact.source &&
                                  organization.latestContact.inheritedFields.includes(
                                    "contactName",
                                  )
                                    ? " · 이전 기록에서 가져옴"
                                    : ""}
                                </small>
                              )}
                              <details
                                className="manager-record-history"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <summary>
                                  최근 기록 {organization.count.toLocaleString()}건
                                </summary>
                                <div className="manager-record-history-list">
                                  {organization.recentRecords.map(
                                    ({ record: historyRecord, contact }) => (
                                      <article key={historyRecord.id}>
                                        <header>
                                          <strong>
                                            {formatDate(historyRecord.activityDate)} ·{" "}
                                            {historyRecord.businessRound}차 ·{" "}
                                            {historyRecord.activityType}
                                          </strong>
                                          <span>
                                            진행 담당자{" "}
                                            {historyRecord.progressManager || "미지정"}
                                          </span>
                                        </header>
                                        <p>
                                          {historyRecord.summary ||
                                            historyRecord.topic ||
                                            "내용 요약 미입력"}
                                        </p>
                                        <p>
                                          다음:{" "}
                                          {historyRecord.nextAction ||
                                            "다음 행동 미지정"}
                                        </p>
                                        <div>
                                          <span>
                                            {historyRecord.followUpRequired
                                              ? historyRecord.followUpDate
                                                ? `재연락 ${formatDate(
                                                    historyRecord.followUpDate,
                                                  )}`
                                                : "재연락 날짜 미지정"
                                              : "재연락 완료"}
                                          </span>
                                          <span>
                                            {[contact.contactRole, contact.contactName]
                                              .filter(Boolean)
                                              .join(" · ") || "기관 담당자 미입력"}
                                          </span>
                                          {contact.contactPhone && (
                                            <span>{contact.contactPhone}</span>
                                          )}
                                          {contact.contactEmail && (
                                            <span>{contact.contactEmail}</span>
                                          )}
                                        </div>
                                        {contact.source &&
                                          contact.inheritedFields.length > 0 && (
                                            <small className="manager-contact-source">
                                              이전 기록에서 가져옴 ·{" "}
                                              {formatDate(
                                                String(
                                                  contact.source.activityDate ?? "",
                                                ),
                                              )}{" "}
                                              · {Number(contact.source.businessRound) || 1}
                                              차 사업
                                            </small>
                                          )}
                                      </article>
                                    ),
                                  )}
                                  {organization.count >
                                    organization.recentRecords.length && (
                                    <small className="manager-history-limit">
                                      최신 {organization.recentRecords.length}건을
                                      표시합니다. 전체 이력은 상세에서 확인할 수
                                      있습니다.
                                    </small>
                                  )}
                                </div>
                              </details>
                            </td>
                            <td className="manager-col-manager">
                              {renderInlineAssigneePicker(record)}
                            </td>
                            <td className="manager-col-contact">
                              <strong>{formatDate(record.activityDate)}</strong>
                              <small>
                                {organization.daysSinceActivity === 0
                                  ? "오늘 활동"
                                  : `${organization.daysSinceActivity}일 전`}
                              </small>
                            </td>
                            <td className="manager-col-situation">
                              <strong className="manager-situation-summary">
                                {record.summary || "내용 요약 미입력"}
                              </strong>
                              <small className="manager-situation-next">
                                다음: {record.nextAction || "다음 행동 미지정"}
                              </small>
                              <div className="manager-situation-meta">
                                <span className={`status-pill ${statusClass(record.status)}`}>
                                  {displaySalesStatus(record)}
                                </span>
                                <small>{record.awardStatus}</small>
                                <small>
                                  {record.followUpRequired
                                    ? record.followUpDate
                                      ? `재연락 ${formatDate(record.followUpDate)}`
                                      : "재연락 날짜 미지정"
                                    : "재연락 완료"}
                                </small>
                              </div>
                            </td>
                            <td className="manager-col-issues">
                              <div className="manager-issue-list">
                                {processed && (
                                  <span className="processed">
                                    {acknowledgement?.snoozedUntil
                                      ? `${formatDate(acknowledgement.snoozedUntil)} 다시 알림`
                                      : "알림 확인 완료"}
                                  </span>
                                )}
                                {organization.issues.length > 0 ? (
                                  <>
                                    {organization.issues.slice(0, 2).map((issue) => (
                                      <span key={issue}>{issue}</span>
                                    ))}
                                    {organization.issues.length > 2 && (
                                      <details
                                        className="manager-issue-more"
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        <summary
                                          title={organization.issues.slice(2).join(" · ")}
                                        >
                                          외 {organization.issues.length - 2}건
                                        </summary>
                                        <div className="manager-issue-extra">
                                          {organization.issues.slice(2).map((issue) => (
                                            <span key={issue}>{issue}</span>
                                          ))}
                                        </div>
                                      </details>
                                    )}
                                  </>
                                ) : (
                                  <span className="clear">현재 누락 없음</span>
                                )}
                              </div>
                            </td>
                            <td className="manager-col-actions">
                              <div className="manager-row-actions">
                                {canManageRecords &&
                                  (processed ? (
                                    <>
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
                                      <button
                                        type="button"
                                        className="manager-alert-hide"
                                        disabled={managerAlertsSaving}
                                        onClick={() =>
                                          void hideManagerAlerts([
                                            organization.name,
                                          ])
                                        }
                                      >
                                        기록 숨김
                                      </button>
                                    </>
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
                </StickyTableWrap>
                <DataListPagination
                  page={managerPage}
                  pageCount={managerPageCount}
                  total={managerOrganizations.length}
                  label="관리자 점검 기관 페이지"
                  onPageChange={setManagerPage}
                />
              </section>
                </>
              )}
            </div>
          ) : view === "followup" ? (
            <section className="panel records-panel followup-management">
              <div className="panel-header records-heading">
                <div>
                  <span className="section-kicker">CONTACT MANAGEMENT</span>
                  <h2>
                    {followupDueSoonOnly
                      ? "2일 내 재연락 기관"
                      : "기관별 관리(수주 전) 현황"}
                  </h2>
                </div>
                <div className="records-heading-actions">
                  {canManageActivityHistory && (
                    <button
                      type="button"
                      className="award-history-button"
                      onClick={() => void openAwardChangeHistory()}
                    >
                      변경 이력
                    </button>
                  )}
                  <button
                    type="button"
                    className="institution-budget-button"
                    disabled={selectedInstitutionIds.length === 0}
                    onClick={toggleInstitutionBulkEditor}
                    title="선택한 기관의 담당자·예산·재연락·다음 행동·상태를 한 번에 수정합니다."
                  >
                    {`선택 기관 일괄 수정${
                      selectedInstitutionIds.length > 0
                        ? ` ${selectedInstitutionIds.length}`
                        : ""
                    }`}
                  </button>
                  {selectedInstitutionIds.length > 0 && (
                    <button
                      type="button"
                      className="excel-export-button"
                      onClick={clearInstitutionSelection}
                    >
                      선택 전체 해제
                    </button>
                  )}
                  {canManageRecords && (
                    <button
                      type="button"
                      className="joint-project-button"
                      disabled={selectedJointProjectCandidates.length < 2}
                      onClick={() => setJointProjectOpen(true)}
                      title="기관은 그대로 유지하고 주관기관과 설치기관의 공동사업 관계만 연결합니다."
                    >
                      {`공동사업 연결${
                        selectedJointProjectCandidates.length > 0
                          ? ` ${selectedJointProjectCandidates.length}`
                          : ""
                      }`}
                    </button>
                  )}
                  {canManageRecords && (
                    <button
                      type="button"
                      className="institution-merge-button"
                      disabled={
                        selectedInstitutionNames.length < 2 ||
                        institutionMergeBusy
                      }
                      onClick={() => void openInstitutionMerge()}
                      title="같은 기관이 여러 이름으로 등록됐을 때 선택한 기관을 하나로 합칩니다."
                    >
                      {institutionMergeBusy
                        ? "기관 확인 중…"
                        : `선택 기관 합치기${
                            selectedInstitutionIds.length > 0
                              ? ` ${selectedInstitutionIds.length}`
                              : ""
                          }`}
                    </button>
                  )}
                  {canDeleteRecords && (
                    <button
                      type="button"
                      className="institution-bulk-delete-button"
                      disabled={
                        selectedInstitutionIds.length === 0 ||
                        institutionDeleteBusy
                      }
                      onClick={() => void removeSelectedInstitutions()}
                      title="선택한 기관과 연결된 모든 업무 기록을 삭제합니다."
                    >
                      {institutionDeleteBusy
                        ? "삭제 중…"
                        : `선택 기관 삭제${
                            selectedInstitutionIds.length > 0
                              ? ` ${selectedInstitutionIds.length}`
                              : ""
                          }`}
                    </button>
                  )}
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
                  <span className="record-count">{followupDisplayGroups.length}개 사업</span>
                </div>
                <div className="institution-mobile-header-actions">
                  <span className="record-count">{followupDisplayGroups.length}개 사업</span>
                  {canExportData && (
                    <button
                      type="button"
                      className="institution-mobile-export"
                      onClick={exportInstitutionWorkbook}
                    >
                      엑셀
                    </button>
                  )}
                </div>
              </div>
              {selectedInstitutionIds.length > 0 && (
                <div
                  className="institution-mobile-selection-bar"
                  role="toolbar"
                  aria-label="선택 기관 작업"
                >
                  <div className="institution-mobile-selection-summary">
                    <strong>{selectedInstitutionIds.length}곳 선택</strong>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedInstitutionIds([]);
                        setInstitutionBudgetOpen(false);
                      }}
                    >
                      선택 해제
                    </button>
                  </div>
                  <div className="institution-mobile-selection-actions">
                    <button
                      type="button"
                      className="edit"
                      onClick={toggleInstitutionBulkEditor}
                    >
                      여러 기관 수정
                    </button>
                    {canManageRecords && (
                      <button
                        type="button"
                        className="joint"
                        disabled={selectedJointProjectCandidates.length < 2}
                        onClick={() => setJointProjectOpen(true)}
                      >
                        공동사업 연결
                      </button>
                    )}
                    {canManageRecords && (
                      <button
                        type="button"
                        className="merge"
                        disabled={
                          selectedInstitutionNames.length < 2 ||
                          institutionMergeBusy
                        }
                        onClick={() => void openInstitutionMerge()}
                      >
                        {institutionMergeBusy ? "확인 중…" : "선택 기관 합치기"}
                      </button>
                    )}
                    {canDeleteRecords && (
                      <button
                        type="button"
                        className="delete"
                        disabled={institutionDeleteBusy}
                        onClick={() => void removeSelectedInstitutions()}
                      >
                        {institutionDeleteBusy ? "삭제 중…" : "선택 항목 삭제"}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {institutionBudgetOpen && selectedInstitutionIds.length > 0 && (
                <div className="institution-budget-bulk" role="region" aria-label="선택 기관 일괄 수정">
                  <div className="institution-budget-bulk-heading">
                    <div>
                      <strong>선택한 {selectedInstitutionIds.length}개 기관 일괄 수정</strong>
                      <span>변경할 항목만 체크한 뒤 입력해 주세요. 체크한 항목은 기존 값도 변경됩니다.</span>
                      <div className="institution-bulk-targets" aria-label="수정 대상 기관">
                        <b>수정 대상</b>
                        <div>
                          {selectedInstitutionNames.slice(0, 4).map((name) => (
                            <span key={name}>{name}</span>
                          ))}
                          {selectedInstitutionNames.length > 4 && (
                            <span>외 {selectedInstitutionNames.length - 4}곳</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="기관 일괄 수정 닫기"
                      onClick={() => setInstitutionBudgetOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="institution-bulk-editor-grid">
                    {session?.canViewPresence && (
                      <section className={institutionBulkManagerEnabled ? "enabled" : ""}>
                        <label className="institution-bulk-toggle"><input type="checkbox" checked={institutionBulkManagerEnabled} onChange={(event) => setInstitutionBulkManagerEnabled(event.target.checked)} /><strong>진행 담당자</strong></label>
                        <select disabled={!institutionBulkManagerEnabled} value={institutionBulkProgressManager} onChange={(event) => setInstitutionBulkProgressManager(event.target.value)}>
                          <option value="">담당자 선택</option>
                          {registeredSalesNames.map((name) => <option key={name}>{name}</option>)}
                        </select>
                      </section>
                    )}
                    <section className={institutionBulkContactNameEnabled ? "enabled" : ""}>
                      <label className="institution-bulk-toggle"><input type="checkbox" checked={institutionBulkContactNameEnabled} onChange={(event) => setInstitutionBulkContactNameEnabled(event.target.checked)} /><strong>사업 담당자</strong><small>기관 담당자 이름·직책</small></label>
                      <input disabled={!institutionBulkContactNameEnabled} value={institutionBulkContactName} onChange={(event) => setInstitutionBulkContactName(event.target.value)} placeholder="예: 홍길동 주무관, 정보부장" />
                    </section>
                    <section className={institutionBulkBudgetEnabled ? "enabled" : ""}>
                      <label className="institution-bulk-toggle"><input type="checkbox" checked={institutionBulkBudgetEnabled} onChange={(event) => setInstitutionBulkBudgetEnabled(event.target.checked)} /><strong>예산</strong></label>
                      <div className="institution-bulk-pair">
                        <BudgetNameSelector
                          value={{ budgetType: institutionBudgetType }}
                          disabled={!institutionBulkBudgetEnabled}
                          standardOnly
                          onChange={(selection) =>
                            setInstitutionBudgetType(selection.budgetType)
                          }
                          onToast={setToast}
                        />
                        <input disabled={!institutionBulkBudgetEnabled} inputMode="decimal" value={institutionBudgetAmount} onChange={(event) => setInstitutionBudgetAmount(formatMoneyInput(event.target.value))} placeholder={selectedBudgetAmountState.mixed ? "여러 값 · 새 금액 입력" : "예산금액"} />
                      </div>
                    </section>
                    <section className={institutionBulkFollowUpEnabled ? "enabled" : ""}>
                      <label className="institution-bulk-toggle"><input type="checkbox" checked={institutionBulkFollowUpEnabled} onChange={(event) => setInstitutionBulkFollowUpEnabled(event.target.checked)} /><strong>재연락 예정일</strong></label>
                      <input type="date" disabled={!institutionBulkFollowUpEnabled} value={institutionBulkFollowUpDate} onChange={(event) => setInstitutionBulkFollowUpDate(event.target.value)} />
                    </section>
                    <section className={institutionBulkNextActionEnabled ? "enabled" : ""}>
                      <label className="institution-bulk-toggle"><input type="checkbox" checked={institutionBulkNextActionEnabled} onChange={(event) => setInstitutionBulkNextActionEnabled(event.target.checked)} /><strong>다음 행동</strong></label>
                      <input disabled={!institutionBulkNextActionEnabled} value={institutionBulkNextAction} onChange={(event) => setInstitutionBulkNextAction(event.target.value)} placeholder="예: 담당자 확인 후 제안서 발송" />
                    </section>
                    <section className={institutionBulkAwardEnabled ? "enabled" : ""}>
                      <label className="institution-bulk-toggle"><input type="checkbox" checked={institutionBulkAwardEnabled} onChange={(event) => setInstitutionBulkAwardEnabled(event.target.checked)} /><strong>수주 구분</strong><small>선택 기관 모두 변경</small></label>
                      <div className="institution-bulk-pair">
                        <select disabled={!institutionBulkAwardEnabled} value={institutionBulkAwardStatus} onChange={(event) => { const awardStatus = event.target.value; setInstitutionBulkAwardStatus(awardStatus); if (!["협력사 수주", "타업체 수주"].includes(awardStatus)) setInstitutionBulkAwardCompany(""); }}>
                          <option>미정</option>
                          <option>위즈업 수주</option>
                          <option>협력사 수주</option>
                          <option>타업체 수주</option>
                        </select>
                        <input list={institutionBulkAwardStatus === "협력사 수주" ? "partner-award-company-options" : undefined} disabled={!institutionBulkAwardEnabled || !["협력사 수주", "타업체 수주"].includes(institutionBulkAwardStatus)} value={institutionBulkAwardStatus === "위즈업 수주" ? "위즈업" : institutionBulkAwardCompany} onChange={(event) => setInstitutionBulkAwardCompany(event.target.value)} placeholder="수주업체" />
                      </div>
                    </section>
                  </div>
                  <div className="institution-budget-bulk-fields institution-bulk-footer">
                    <p className="institution-bulk-save-note">
                      체크하지 않은 항목은 그대로 유지됩니다.
                    </p>
                    <button
                      type="button"
                      className="institution-budget-save"
                      disabled={
                        institutionBudgetBusy ||
                        !(
                          institutionBulkBudgetEnabled ||
                          institutionBulkManagerEnabled ||
                          institutionBulkContactNameEnabled ||
                          institutionBulkFollowUpEnabled ||
                          institutionBulkNextActionEnabled ||
                          institutionBulkAwardEnabled
                        )
                      }
                      onClick={() => void saveSelectedInstitutionBudgets()}
                    >
                      {institutionBudgetBusy
                        ? "적용 중…"
                        : `${selectedInstitutionIds.length}개 기관에 적용`}
                    </button>
                  </div>
                </div>
              )}
              <div className="data-list-workspace institution-list-workspace">
              <div className="filter-row">
                <div className="inline-search">
                  <span>⌕</span>
                  <BufferedInput
                    value={search}
                    onCommit={setSearch}
                    placeholder="기관·담당자·메일·지역·예산 검색"
                  />
                </div>
                <select
                  value={budgetGroupFilter}
                  onChange={(event) => setBudgetGroupFilter(event.target.value)}
                  aria-label="표준 예산명 필터"
                >
                  <option value="all">전체 표준 예산</option>
                  {budgetReviewCatalog.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.canonicalName}
                    </option>
                  ))}
                  <option value="unclassified">미분류 예산</option>
                </select>
                <select
                  value={awardFilter}
                  onChange={(event) => setAwardFilter(event.target.value)}
                  aria-label="수주 결과 필터"
                >
                  <option value="전체 수주">전체</option>
                  <option>위즈업 수주</option>
                  <option>협력사 수주</option>
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
                  budgetGroupFilter !== "all" ||
                  awardFilter !== "전체 수주" ||
                  followupSort !== "activity-desc" ||
                  followupDueSoonOnly) && (
                  <button
                    className="reset-filter"
                    onClick={() => {
                      setSearch("");
                      setBudgetGroupFilter("all");
                      setAwardFilter("전체 수주");
                      setFollowupSort("activity-desc");
                      setFollowupDueSoonOnly(false);
                    }}
                  >
                    초기화
                  </button>
                )}
              </div>
              {currentInstitutionPageSelected && (
                <div className="award-selection-banner" role="status">
                  {allFilteredInstitutionsSelected ? (
                    <>
                      <strong>
                        검색 결과 {followupDisplayGroups.length.toLocaleString()}개 사업이 모두 선택되었습니다.
                      </strong>
                      <button type="button" onClick={clearInstitutionSelection}>
                        선택 해제
                      </button>
                    </>
                  ) : (
                    <>
                      <strong>
                        현재 페이지 {institutionPageGroups.length.toLocaleString()}개 사업이 선택되었습니다.
                      </strong>
                      <button type="button" onClick={selectAllFilteredInstitutions}>
                        검색 결과 {followupDisplayGroups.length.toLocaleString()}개 사업 전체 선택
                      </button>
                    </>
                  )}
                </div>
              )}
              <StickyTableWrap className="data-list-table">
                <table className="followup-table">
                  <thead>
                    <tr>
                      <th className="selection-cell">
                        <input
                          className="row-select-checkbox"
                          type="checkbox"
                          aria-label="현재 페이지 기관 전체 선택"
                          checked={currentInstitutionPageSelected}
                          onChange={toggleCurrentInstitutionPage}
                        />
                      </th>
                      <th>순번</th>
                      <th>최종 컨택일</th>
                      <th>지역</th>
                      <th>기관명</th>
                      <th>기관 담당자</th>
                      <th>기관 메일</th>
                      <th>예산 · 금액</th>
                      <th>내용 요약</th>
                      <th>사업방식</th>
                      <th>진행 담당자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {institutionPageViewRows.map(
                      (
                        {
                          record,
                          priorAward,
                          group,
                        },
                        index,
                      ) => (
                      <tr
                        className={`followup-contact-row ${
                          recentlyUpdatedInstitutionIds.includes(record.id)
                            ? "recently-updated"
                            : ""
                        }`.trim()}
                        key={group.key}
                        tabIndex={0}
                        role="button"
                        aria-label={`${group.sponsorOrganization} 상세와 이전 히스토리 보기`}
                        onClick={() =>
                          openJointProjectGroupDetail(
                            group,
                            Boolean(deferredSearch.trim()),
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openJointProjectGroupDetail(
                              group,
                              Boolean(deferredSearch.trim()),
                            );
                          }
                        }}
                      >
                        <td className="selection-cell">
                          <input
                            className="row-select-checkbox"
                            type="checkbox"
                            aria-label={`${group.sponsorOrganization} 공동사업 전체 선택`}
                            checked={group.members.every((member) => selectedInstitutionIdSet.has(member.id))}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() =>
                              setSelectedInstitutionIds((current) => {
                                const memberIds = new Set(group.members.map((member) => member.id));
                                const selected = group.members.every((member) => current.includes(member.id));
                                return selected
                                  ? current.filter((id) => !memberIds.has(id))
                                  : [...new Set([...current, ...memberIds])];
                              })
                            }
                          />
                        </td>
                        <td className="sequence-cell">
                          {(institutionPage - 1) * DATA_LIST_PAGE_SIZE + index + 1}
                        </td>
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
                          <strong className="org-name">{group.sponsorOrganization}</strong>
                          {group.projectId && (
                            <>
                              <span className="joint-project-badge sponsor" title={group.projectName}>
                                공동사업 주관 · {group.members.filter((member) => member.jointProjectRole !== "sponsor").length}곳
                              </span>
                              <JointProjectMemberList
                                members={group.members}
                                matchingMembers={group.matchingMembers}
                                searchActive={Boolean(deferredSearch.trim())}
                                onSelectMember={(member) => {
                                  cancelDetailInlineEdit();
                                  setDetailBusinessRound(member.businessRound);
                                  setDetailOrganization(member.organization);
                                }}
                              />
                            </>
                          )}
                          {priorAward ? (
                            <span className="prior-award-badge">{priorAward}</span>
                          ) : null}
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
                        <td className="budget-summary-cell">
                          <span
                            className="budget-cell budget-summary-name"
                            title={compactBudgetDisplayForRecord(record).title}
                          >
                            {compactBudgetDisplayForRecord(record).name}
                          </span>
                          <strong className="budget-amount">
                            {compactBudgetDisplayForRecord(record).amount}
                          </strong>
                          {record.budgetMatchStatus &&
                            !["auto", "approved", "excluded"].includes(
                              record.budgetMatchStatus,
                            ) && (
                              <small
                                className={`budget-match-badge ${record.budgetMatchStatus}`}
                              >
                                {budgetMatchStatusLabel(
                                  record.budgetMatchStatus,
                                )}
                              </small>
                            )}
                          {compactBudgetDisplayForRecord(record).detail && (
                            <small className="budget-amount-source">
                              {compactBudgetDisplayForRecord(record).detail}
                            </small>
                          )}
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
                          {renderInlineAssigneePicker(record)}
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
                    조건에 맞는 기관이 없습니다.
                  </div>
                )}
              </StickyTableWrap>
              <DataListPagination
                page={institutionPage}
                pageCount={institutionPageCount}
                total={followupDisplayGroups.length}
                label="기관별 관리 페이지"
                onPageChange={setInstitutionPage}
              />
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
                        <div className="team-period-switch">
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
                    <StickyTableWrap className="data-list-table">
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
                                const selectingMember =
                                  selectedTeamMember !== metric.name;
                                setSelectedTeamMember(
                                  selectingMember ? metric.name : "전체",
                                );
                                if (!selectingMember) {
                                  setTeamMetricFocus("all");
                                  setTeamDetailMode("activity");
                                  return;
                                }
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
                                  const selectingMember =
                                    selectedTeamMember !== metric.name;
                                  setSelectedTeamMember(
                                    selectingMember ? metric.name : "전체",
                                  );
                                  if (!selectingMember) {
                                    setTeamMetricFocus("all");
                                    setTeamDetailMode("activity");
                                    return;
                                  }
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
                                <button
                                  type="button"
                                  className="team-conversion-button"
                                  disabled={metric.conversionWonCount === 0}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedTeamMember(metric.name);
                                    setTeamMetricFocus("all");
                                    setTeamDetailMode("conversion");
                                    document
                                      .getElementById("team-detail-panel")
                                      ?.scrollIntoView({
                                        behavior: "smooth",
                                        block: "start",
                                      });
                                  }}
                                  aria-label={
                                    metric.conversionWonCount
                                      ? `${metric.name} 수주 기관 ${metric.conversionWonCount}곳 보기`
                                      : `${metric.name} 수주 기관 없음`
                                  }
                                >
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
                                </button>
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
                    </StickyTableWrap>
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
                        : "기관별 관리(수주 후) 현황"
                      : view === "dashboard"
                        ? isOwner && dashboardActivityScope === "all"
                          ? "전체 최근 활동 이력"
                          : "내 최근 활동 이력"
                        : teamDetailMode === "attention"
                          ? selectedTeamMember !== "전체"
                            ? `${selectedTeamMember} · 확인 필요 업무`
                            : "팀 전체 확인 필요 업무"
                          : teamDetailMode === "conversion"
                            ? selectedTeamMember !== "전체"
                              ? `${selectedTeamMember} · 수주 전환 기관`
                              : "팀 전체 수주 전환 기관"
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
                  {view === "records" && teamDetailMode === "conversion" && (
                    <p className="team-detail-mode-copy">
                      {teamPeriodLabel} 기준 위즈업 수주로 전환된 기관입니다.
                      기관을 누르면 상세 내용과 이전 기록을 확인할 수 있습니다.
                    </p>
                  )}
                </div>
                <div className="records-heading-actions">
                  {view === "dashboard" && isOwner && (
                    <div className="dashboard-activity-scope" aria-label="활동 이력 범위">
                      <button
                        type="button"
                        className={dashboardActivityScope === "mine" ? "active" : ""}
                        onClick={() => setDashboardActivityScope("mine")}
                      >
                        내 활동
                      </button>
                      <button
                        type="button"
                        className={dashboardActivityScope === "all" ? "active" : ""}
                        onClick={() => setDashboardActivityScope("all")}
                      >
                        전체 활동
                      </button>
                    </div>
                  )}
                  {view === "awards" && canManageActivityHistory && (
                    <button
                      type="button"
                      className="award-history-button"
                      onClick={() => void openAwardChangeHistory()}
                    >
                      변경 이력
                    </button>
                  )}
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
                      className="excel-export-button"
                      onClick={openAwardGoogleSheetImport}
                    >
                      수주 일괄 등록
                    </button>
                  )}
                  {view === "awards" && selectedAwardIds.length > 0 && (
                    <button
                      type="button"
                      className="excel-export-button"
                      onClick={toggleAwardBulkEditor}
                    >
                      선택 정보 변경
                    </button>
                  )}
                  {view === "awards" && selectedAwardIds.length > 0 && (
                    <button
                      type="button"
                      className="excel-export-button"
                      onClick={clearAwardSelection}
                    >
                      선택 전체 해제
                    </button>
                  )}
                  {view === "awards" && canManageRecords && (
                    <button
                      type="button"
                      className="joint-project-button"
                      disabled={selectedJointProjectCandidates.length < 2}
                      onClick={() => setJointProjectOpen(true)}
                      title="기관 자료를 이동하지 않고 같은 공동사업 관계로 연결합니다."
                    >
                      {`공동사업 연결${
                        selectedJointProjectCandidates.length > 0
                          ? ` ${selectedJointProjectCandidates.length}`
                          : ""
                      }`}
                    </button>
                  )}
                  {view === "awards" && canManageRecords && (
                    <button
                      type="button"
                      className="institution-merge-button"
                      disabled={
                        selectedAwardOrganizations.length < 2 ||
                        institutionMergeBusy
                      }
                      onClick={() => void openInstitutionMerge()}
                      title="같은 기관이 여러 이름으로 등록됐을 때 선택한 기관을 하나로 합칩니다."
                    >
                      {institutionMergeBusy
                        ? "기관 확인 중…"
                        : `선택 기관 합치기${
                            selectedAwardOrganizations.length > 0
                              ? ` ${selectedAwardOrganizations.length}`
                              : ""
                          }`}
                    </button>
                  )}
                  {view === "awards" && isOwner && selectedAwardIds.length > 0 && (
                    <button
                      type="button"
                      className="award-delete-button"
                      onClick={() => openAwardDelete("selected")}
                    >
                      선택 {selectedAwardIds.length}건 삭제
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
                  {view === "records" && teamDetailMode !== "activity" && (
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
                        : view === "records" && teamDetailMode === "conversion"
                          ? `${teamConversionRecords.length}곳`
                        : `${filtered.length}건`}
                  </span>
                </div>
              </div>
              <div className={view === "dashboard" ? "" : "data-list-workspace"}>
              {view === "awards" && awardBulkOpen && selectedAwardIds.length > 0 && (
                <div className="institution-budget-bulk" role="region" aria-label="선택 수주 일괄 수정">
                  <div className="institution-budget-bulk-heading">
                    <div><strong>선택한 {selectedAwardIds.length}건 수주 정보 변경</strong><span>최대 5,000건까지 500건씩 안전하게 순차 적용됩니다.</span></div>
                    <button type="button" aria-label="수주 일괄 수정 닫기" onClick={() => setAwardBulkOpen(false)}>×</button>
                  </div>
                  <div className="institution-bulk-editor-grid award-bulk-editor-grid">
                    <section className={awardBulkDateEnabled ? "enabled" : ""}>
                      <label className="institution-bulk-toggle">
                        <input
                          type="checkbox"
                          checked={awardBulkDateEnabled}
                          onChange={(event) =>
                            setAwardBulkDateEnabled(event.target.checked)
                          }
                        />
                        <strong>수주 날짜</strong>
                        <small>미선택 시 유지</small>
                      </label>
                      <input
                        type="date"
                        disabled={!awardBulkDateEnabled}
                        value={awardBulkActivityDate}
                        onChange={(event) =>
                          setAwardBulkActivityDate(event.target.value)
                        }
                      />
                    </section>
                    <section className={awardBulkAwardEnabled ? "enabled" : ""}>
                      <label className="institution-bulk-toggle"><input type="checkbox" checked={awardBulkAwardEnabled} onChange={(event) => setAwardBulkAwardEnabled(event.target.checked)} /><strong>수주 구분·수주업체</strong><small>협력사 수주 포함</small></label>
                      <div className="institution-bulk-pair">
                        <select disabled={!awardBulkAwardEnabled} value={awardBulkAwardStatus} onChange={(event) => { const awardStatus = event.target.value; setAwardBulkAwardStatus(awardStatus); if (!["협력사 수주", "타업체 수주"].includes(awardStatus)) setAwardBulkAwardCompany(""); }}><option>미정</option><option>위즈업 수주</option><option>협력사 수주</option><option>타업체 수주</option></select>
                        <input list={awardBulkAwardStatus === "협력사 수주" ? "partner-award-company-options" : undefined} disabled={!awardBulkAwardEnabled || !["협력사 수주", "타업체 수주"].includes(awardBulkAwardStatus)} value={awardBulkAwardStatus === "위즈업 수주" ? "위즈업" : awardBulkAwardCompany} onChange={(event) => setAwardBulkAwardCompany(event.target.value)} placeholder="수주업체" />
                      </div>
                    </section>
                    <section className={awardBulkExecutionEnabled ? "enabled" : ""}>
                      <label className="institution-bulk-toggle"><input type="checkbox" checked={awardBulkExecutionEnabled} onChange={(event) => setAwardBulkExecutionEnabled(event.target.checked)} /><strong>사업방식·컨소 업체</strong><small>선택 기록 모두 변경</small></label>
                      <div className="institution-bulk-pair">
                        <select disabled={!awardBulkExecutionEnabled} value={awardBulkExecutionType} onChange={(event) => setAwardBulkExecutionType(event.target.value)}><option>직영</option><option>컨소</option><option>해당 없음</option></select>
                        <input disabled={!awardBulkExecutionEnabled || awardBulkExecutionType !== "컨소"} value={awardBulkConsortiumCompany} onChange={(event) => setAwardBulkConsortiumCompany(event.target.value)} placeholder={awardBulkExecutionType === "컨소" ? "컨소 업체명" : "컨소 선택 시 입력"} />
                      </div>
                    </section>
                    {session?.canViewPresence && (
                      <section className={awardBulkManagerEnabled || awardBulkLocksManager ? "enabled" : ""}>
                        <label className="institution-bulk-toggle"><input type="checkbox" checked={awardBulkLocksManager || awardBulkManagerEnabled} disabled={awardBulkLocksManager} onChange={(event) => setAwardBulkManagerEnabled(event.target.checked)} /><strong>진행 담당자</strong><small>{awardBulkLocksManager ? "협력사 수주는 해당 없음" : "미선택 시 유지"}</small></label>
                        <select disabled={awardBulkLocksManager || !awardBulkManagerEnabled} value={awardBulkLocksManager ? "해당 없음" : awardBulkProgressManager} onChange={(event) => setAwardBulkProgressManager(event.target.value)}><option value="해당 없음">해당 없음</option>{registeredSalesNames.map((name) => <option key={name} value={name}>{name}</option>)}</select>
                      </section>
                    )}
                    <section className={awardBulkContactNameEnabled ? "enabled" : ""}>
                      <label className="institution-bulk-toggle"><input type="checkbox" checked={awardBulkContactNameEnabled} onChange={(event) => setAwardBulkContactNameEnabled(event.target.checked)} /><strong>사업 담당자</strong><small>기관 담당자 이름·직책</small></label>
                      <input disabled={!awardBulkContactNameEnabled} value={awardBulkContactName} onChange={(event) => setAwardBulkContactName(event.target.value)} placeholder="예: 홍길동 주무관, 정보부장" />
                    </section>
                    <section className={awardBulkStageEnabled ? "enabled" : ""}>
                      <label className="institution-bulk-toggle"><input type="checkbox" checked={awardBulkStageEnabled} onChange={(event) => setAwardBulkStageEnabled(event.target.checked)} /><strong>수주 진행 단계</strong><small>미선택 시 유지</small></label>
                      <select disabled={!awardBulkStageEnabled} value={awardBulkAwardStage} onChange={(event) => setAwardBulkAwardStage(event.target.value)}>{awardStageOptions.map((stage) => <option key={stage}>{stage}</option>)}</select>
                    </section>
                  </div>
                  <div className="institution-budget-bulk-fields institution-bulk-footer award-bulk-footer">
                    <p className="institution-bulk-save-note">체크하지 않은 항목은 기존 값이 그대로 유지됩니다.</p>
                    <div className="award-bulk-footer-actions">
                      <button type="button" className="award-bulk-cancel" onClick={() => setAwardBulkOpen(false)}>취소</button>
                      <button type="button" className="institution-budget-save" disabled={awardBulkBusy} onClick={() => void saveSelectedAwardChanges()}>
                        {awardBulkBusy
                          ? `${awardBulkProgress.completed.toLocaleString()} / ${awardBulkProgress.total.toLocaleString()}건 변경 중…`
                          : "변경 적용"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {view !== "dashboard" &&
                !(view === "records" && teamDetailMode !== "activity") && (
                <div className="filter-row">
                  <div className="inline-search"><span>⌕</span><BufferedInput value={search} onCommit={setSearch} placeholder="목록에서 검색" /></div>
                  {view === "awards" && (
                    <select
                      value={budgetGroupFilter}
                      onChange={(event) =>
                        setBudgetGroupFilter(event.target.value)
                      }
                      aria-label="표준 예산명 필터"
                    >
                      <option value="all">전체 표준 예산</option>
                      {budgetReviewCatalog.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.canonicalName}
                        </option>
                      ))}
                      <option value="unclassified">미분류 예산</option>
                    </select>
                  )}
                  {view === "awards" && (
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="현재 상태 필터">
                      <option value="전체 상태">전체 수주 진행상태</option>
                      {awardStageOptions.map((status) => <option key={status}>{status}</option>)}
                    </select>
                  )}
                  <select value={awardFilter} onChange={(event) => setAwardFilter(event.target.value)} aria-label="수주 결과 필터">
                    <option>전체 수주</option>
                    <option>위즈업 수주</option>
                    <option>협력사 수주</option>
                    <option>타업체 수주</option>
                    <option>미정</option>
                  </select>
                  {view === "awards" && (
                    <>
                      <select value={awardExecutionFilter} onChange={(event) => setAwardExecutionFilter(event.target.value)} aria-label="사업방식 필터">
                        <option>전체 사업방식</option>
                        <option>직영</option>
                        <option>컨소</option>
                        <option>해당 없음</option>
                      </select>
                      <select value={awardManagerFilter} onChange={(event) => setAwardManagerFilter(event.target.value)} aria-label="진행 담당자 필터">
                        <option>전체 담당자</option>
                        <option>해당 없음</option>
                        {registeredSalesNames.map((name) => <option key={name}>{name}</option>)}
                      </select>
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
                    </>
                  )}
                  {(search || (view === "awards" && statusFilter !== "전체 상태") || awardFilter !== "전체 수주" || (view === "awards" && (budgetGroupFilter !== "all" || awardExecutionFilter !== "전체 사업방식" || awardManagerFilter !== "전체 담당자" || awardSort !== "date-desc" || activeAwardsOnly)) || (view === "records" && (teamPeriodDays !== 30 || selectedTeamMember !== "전체" || teamMetricFocus !== "all" || teamDetailMode !== "activity"))) && (
                    <button className="reset-filter" onClick={() => { setSearch(""); setTypeFilter("전체 유형"); setStatusFilter("전체 상태"); setAwardFilter("전체 수주"); setBudgetGroupFilter("all"); setAwardExecutionFilter("전체 사업방식"); setAwardManagerFilter("전체 담당자"); setAwardSort("date-desc"); setRecordDateScope("all"); setTeamPeriodDays(30); setTeamMetricFocus("all"); setSelectedTeamMember("전체"); setTeamDetailMode("activity"); setActiveAwardsOnly(false); }}>초기화</button>
                  )}
                </div>
              )}

              {view === "awards" && currentAwardPageSelected && (
                <div className="award-selection-banner" role="status">
                  {allFilteredAwardsSelected ? (
                    <>
                      <strong>
                        검색 결과 {awardDisplayGroups.length.toLocaleString()}개 사업이 모두 선택되었습니다.
                      </strong>
                      <button type="button" onClick={clearAwardSelection}>
                        선택 해제
                      </button>
                    </>
                  ) : (
                    <>
                      <strong>
                        현재 페이지 {awardPageGroups.length.toLocaleString()}개 사업이 선택되었습니다.
                      </strong>
                      <button type="button" onClick={selectAllFilteredAwards}>
                        검색 결과 {awardDisplayGroups.length.toLocaleString()}개 사업 전체 선택
                      </button>
                    </>
                  )}
                </div>
              )}

              <StickyTableWrap
                className={view === "dashboard" ? "dashboard-table-wrap" : "data-list-table"}
              >
                <table className={view === "awards" ? "awards-table" : view === "records" ? "records-table" : undefined}>
                  <thead>
                    {view === "awards" ? (
                      <tr>
                        <th className="selection-cell">
                          <input
                            className="row-select-checkbox"
                            type="checkbox"
                            aria-label="현재 페이지 수주 전체 선택"
                            checked={currentAwardPageSelected}
                            onChange={toggleCurrentAwardPage}
                          />
                        </th>
                        <th>순번</th>
                        <th>수주일</th>
                        <th>지역</th>
                        <th>기관</th>
                        <th>예산 · 금액</th>
                        <th>계약금액</th>
                        <th>사업방식</th>
                        <th>수주업체</th>
                        <th>컨소 업체</th>
                        <th>수주 진행 상태</th>
                        <th>진행 담당자</th>
                      </tr>
                    ) : view === "records" ? (
                      <tr>
                        <th>순번</th><th>날짜</th><th>기관·파트너</th><th>활동</th>
                        <th>
                          {teamDetailMode === "attention"
                            ? "확인 사유 / 다음 행동"
                            : "내용 요약 / 다음 행동"}
                        </th>
                        {teamDetailMode === "attention" && <th>진행 담당자</th>}
                        <th>상태</th><th>수주</th><th>재연락</th><th><span className="sr-only">관리</span></th>
                      </tr>
                    ) : (
                      <tr><th>날짜</th><th>기관·파트너</th><th>활동</th><th>내용</th><th>진행 담당자</th><th>상태</th><th>수주</th><th>재연락</th><th><span className="sr-only">관리</span></th></tr>
                    )}
                  </thead>
                  <tbody>
                    {(view === "dashboard" ? dashboardRecentRecords : pagedTeamDetailRecords).map((record, index) =>
                      view === "awards" ? (
                        <tr
                          className={`award-record-row ${
                            record.awardStatus === "타업체 수주"
                              ? "other-award-row"
                              : record.awardStatus === "협력사 수주"
                                ? "partner-award-row"
                              : record.awardStatus === "위즈업 수주"
                                ? "our-award-row"
                                : ""
                          }`}
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
                            const group = awardPageGroupByPrimaryId.get(record.id);
                            if (group) {
                              openJointProjectGroupDetail(
                                group,
                                Boolean(deferredSearch.trim()),
                              );
                            } else {
                              setDetailBusinessRound(record.businessRound);
                              setDetailOrganization(record.organization);
                            }
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.target !== event.currentTarget ||
                              (event.key !== "Enter" && event.key !== " ")
                            ) {
                              return;
                            }
                            event.preventDefault();
                            const group = awardPageGroupByPrimaryId.get(record.id);
                            if (group) {
                              openJointProjectGroupDetail(
                                group,
                                Boolean(deferredSearch.trim()),
                              );
                            } else {
                              setDetailBusinessRound(record.businessRound);
                              setDetailOrganization(record.organization);
                            }
                          }}
                        >
                          <td className="selection-cell">
                            <input
                              className="row-select-checkbox"
                              type="checkbox"
                              aria-label={`${awardPageGroupByPrimaryId.get(record.id)?.sponsorOrganization || record.organization} 공동사업 전체 선택`}
                              checked={(awardPageGroupByPrimaryId.get(record.id)?.members || [record]).every((member) => selectedAwardIdSet.has(member.id))}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() =>
                                setSelectedAwardIds((current) => {
                                  const members = awardPageGroupByPrimaryId.get(record.id)?.members || [record];
                                  const memberIds = new Set(members.map((member) => member.id));
                                  const selected = members.every((member) => current.includes(member.id));
                                  return selected
                                    ? current.filter((id) => !memberIds.has(id))
                                    : [...new Set([...current, ...memberIds])];
                                })
                              }
                            />
                          </td>
                          <td className="sequence-cell">
                            {(awardPage - 1) * AWARD_LIST_PAGE_SIZE + index + 1}
                          </td>
                          <td><span className="date-cell">{formatDate(record.activityDate)}</span></td>
                          <td><span className="region-cell">{record.region || "—"}</span></td>
                          <td className="contract-amount-cell">
                            <strong className="org-name">
                              {awardPageGroupByPrimaryId.get(record.id)?.sponsorOrganization || record.organization}
                            </strong>
                            <small>
                              {record.businessRound}차 사업
                            </small>
                            {record.jointProjectId && (
                              <>
                                <span className="joint-project-badge sponsor" title={record.jointProjectName}>
                                  공동사업 주관 · {(awardPageGroupByPrimaryId.get(record.id)?.members || [record]).filter((member) => member.jointProjectRole !== "sponsor").length}곳
                                </span>
                                <JointProjectMemberList
                                  members={awardPageGroupByPrimaryId.get(record.id)?.members || [record]}
                                  matchingMembers={awardPageGroupByPrimaryId.get(record.id)?.matchingMembers || [record]}
                                  searchActive={Boolean(deferredSearch.trim())}
                                  onSelectMember={(member) => {
                                    cancelDetailInlineEdit();
                                    setDetailBusinessRound(member.businessRound);
                                    setDetailOrganization(member.organization);
                                  }}
                                />
                              </>
                            )}
                            {postAwardContactStatus(
                              record,
                              recordsByInstitutionKey.get(
                                institutionAliasKey(record.organization),
                              ) ?? [],
                            ) === "재영업 상담" && (
                              <span className="resale-active-badge">재영업 진행 중</span>
                            )}
                          </td>
                          <td className="budget-summary-cell">
                            <strong
                              className="award-budget-name budget-summary-name"
                              title={compactBudgetDisplayForRecord(record).title}
                            >
                              {compactBudgetDisplayForRecord(record).name}
                            </strong>
                            <span className="budget-amount">
                              {compactBudgetDisplayForRecord(record).amount}
                            </span>
                            <small>
                              {hasResolvedStandardBudget(record)
                                ? "표준 예산"
                                : record.budgetOriginalName &&
                                    record.budgetOriginalName !== record.budgetType
                                  ? `원문 ${record.budgetOriginalName} · 표준 예산 연결 필요`
                                  : "표준 예산 연결 필요"}
                            </small>
                          </td>
                          <td>
                            {(() => {
                              const contract =
                                registeredContractDisplay(record);
                              return (
                                <>
                                  <strong
                                    className={`budget-amount quote-${contract.status}`}
                                  >
                                    {contract.amount}
                                  </strong>
                                  <small>{contract.detail}</small>
                                </>
                              );
                            })()}
                            {accountingExceptionForRecord(record) && (
                              <span
                                className="award-accounting-state pending"
                                title={accountingExceptionForRecord(record)?.title}
                              >
                                {accountingExceptionForRecord(record)?.label}
                              </span>
                            )}
                          </td>
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
                            {record.awardStatus === "타업체 수주" ? (
                              <span className="award-pill other award-result-pill">
                                타업체 수주
                              </span>
                            ) : record.awardStatus === "협력사 수주" ? (
                              <span className="award-pill partner award-result-pill">
                                협력사 수주
                              </span>
                            ) : (
                              <small>{record.awardStatus}</small>
                            )}
                          </td>
                          <td><strong className="award-company">{record.consortiumCompany || "해당 없음"}</strong></td>
                          <td>
                            <div className="award-stage-cell">
                              <span className={`award-stage stage-${normalizeAwardStage(record.awardStage, record.awardStatus).replaceAll(" ", "-")}`}>
                                {normalizeAwardStage(record.awardStage, record.awardStatus)}
                              </span>
                              {["위즈업 수주", "협력사 수주"].includes(
                                record.awardStatus,
                              ) &&
                                !isCompletedAwardStage(record.awardStage) && (
                                  <button
                                    type="button"
                                    className="award-complete-action"
                                    disabled={awardCompletionBusyId !== null}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void markAwardAsCompleted(record);
                                    }}
                                    aria-label={`${record.organization} 수주 진행 단계를 납품 완료로 변경`}
                                  >
                                    {awardCompletionBusyId === record.id
                                      ? "처리 중…"
                                      : "납품 완료"}
                                  </button>
                                )}
                            </div>
                          </td>
                          <td>
                            {renderInlineAssigneePicker(record)}
                          </td>
                        </tr>
                      ) : (
                        <tr
                          key={record.id}
                          className={
                            view === "dashboard"
                              ? "dashboard-activity-row"
                              : view === "records" &&
                                  teamDetailMode !== "activity"
                                ? teamDetailMode === "attention"
                                  ? "team-attention-row"
                                  : "team-conversion-row"
                                : undefined
                          }
                          tabIndex={
                            view === "dashboard" ||
                            (view === "records" &&
                              teamDetailMode !== "activity")
                              ? 0
                              : undefined
                          }
                          aria-label={
                            view === "dashboard" ||
                            (view === "records" &&
                              teamDetailMode !== "activity")
                              ? `${record.organization} 상세와 이전 이력 보기`
                              : undefined
                          }
                          onClick={
                            view === "dashboard" ||
                            (view === "records" &&
                              teamDetailMode !== "activity")
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
                              teamDetailMode !== "activity")
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
                            <td className="sequence-cell">
                              {(teamRecordPage - 1) * DATA_LIST_PAGE_SIZE + index + 1}
                            </td>
                          )}
                          <td><span className="date-cell">{formatDate(record.activityDate)}</span></td>
                          <td><strong className="org-name">{record.organization}</strong></td>
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
                                    : record.summary || "내용 요약 미입력"}
                                </strong>
                                <small className="team-record-next-action">
                                  다음: {record.nextAction || "다음 행동 미지정"}
                                </small>
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
                          <td><span className={`status-pill ${statusClass(record.status)}`}>{displaySalesStatus(record)}</span></td>
                          <td>
                            {record.awardStatus === "미정" ? (
                              <span className="award-pill pending">미정</span>
                            ) : (
                              <>
                                <span className={`award-pill ${record.awardStatus === "위즈업 수주" ? "ours" : record.awardStatus === "협력사 수주" ? "partner" : "other"}`}>{record.awardStatus}</span>
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
                      : view === "records" && teamDetailMode === "conversion"
                        ? teamConversionRecords.length === 0
                      : filtered.length === 0) && (
                    <div className="empty-state large">
                      {view === "dashboard"
                        ? isOwner && dashboardActivityScope === "all"
                          ? "아직 등록된 활동 기록이 없습니다."
                          : "내가 진행 담당자인 활동 기록이 없습니다."
                        : view === "records" &&
                            teamDetailMode === "attention"
                          ? "현재 확인 필요 업무가 없습니다."
                          : view === "records" &&
                              teamDetailMode === "conversion"
                            ? "선택한 기간에 수주로 전환된 기관이 없습니다."
                          : "조건에 맞는 기록이 없습니다."}
                    </div>
                  )}
              </StickyTableWrap>
              {view === "awards" && awardDisplayGroups.length > 0 && (
                <nav className="award-list-pagination" aria-label="수주 목록 페이지">
                  <button
                    type="button"
                    disabled={awardPage === 1}
                    onClick={() => setAwardPage((current) => Math.max(1, current - 1))}
                  >
                    이전
                  </button>
                  <span>
                    {awardPage.toLocaleString()} / {awardPageCount.toLocaleString()} 페이지
                    <small>
                      총 {awardDisplayGroups.length.toLocaleString()}개 사업 · 페이지당 {AWARD_LIST_PAGE_SIZE}개 사업
                    </small>
                  </span>
                  <button
                    type="button"
                    disabled={awardPage === awardPageCount}
                    onClick={() =>
                      setAwardPage((current) => Math.min(awardPageCount, current + 1))
                    }
                  >
                    다음
                  </button>
                </nav>
              )}
              {view === "records" && (
                <DataListPagination
                  page={teamRecordPage}
                  pageCount={teamRecordPageCount}
                  total={teamDetailRecords.length}
                  label="팀 업무 상세 기록 페이지"
                  onPageChange={setTeamRecordPage}
                />
              )}
              </div>
              </section>
            </>
          )}
        </div>
      </section>

      {detailOrganization && detailDisplayRecord && (
        <div
          className="history-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-title"
        >
          <button
            className="history-backdrop"
            aria-label="기관 히스토리 닫기"
            onClick={() => {
              cancelDetailInlineEdit();
              setDetailOrganization(null);
            }}
          />
          <aside className="history-drawer">
            <div className="history-header">
              <div>
                <span className="section-kicker">ORGANIZATION HISTORY</span>
                <h2 id="history-title">{detailShellOrganization}</h2>
                <p>
                  {detailDisplayRecord.region || "지역 미입력"} ·{" "}
                  {detailLatest
                    ? `${detailHistory.length}건의 컨택 기록`
                    : "캠페인 대상 등록 · 아직 컨택 기록 없음"}
                  {detailShellOrganization !== detailOrganization
                    ? ` · 현재 보기 ${detailOrganization}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => {
                  cancelDetailInlineEdit();
                  setDetailOrganization(null);
                }}
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <div className="history-body">
              <div className="business-round-tabs" role="tablist" aria-label="사업 차수 선택">
                {detailBusinessRounds.map((round) => {
                  const latestRoundRecord = detailHistory.find(
                    (record) => record.businessRound === round,
                  );
                  const roundStatus = latestRoundRecord
                    ? latestRoundRecord.awardStatus !== "미정"
                      ? normalizeAwardStage(
                          latestRoundRecord.awardStage,
                          latestRoundRecord.awardStatus,
                        )
                      : effectiveSalesProgress(
                          latestRoundRecord,
                          detailHistory.filter(
                            (record) => record.businessRound === round,
                          ),
                        )
                    : "미정";
                  return (
                    <button
                      key={round}
                      type="button"
                      role="tab"
                      aria-selected={round === selectedDetailBusinessRound}
                      className={
                        round === selectedDetailBusinessRound ? "active" : ""
                      }
                      onClick={() => {
                        cancelDetailInlineEdit();
                        setDetailBusinessRound(round);
                        setDetailHistoryScope("round");
                      }}
                    >
                      <strong>{round}차 사업</strong>
                      <span>{roundStatus}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="business-round-add"
                  onClick={() => {
                    const nextRound =
                      Math.max(1, ...detailBusinessRounds) + 1;
                    setDetailOrganization(null);
                    openNewForOrganization(detailDisplayRecord, nextRound);
                  }}
                >
                  + 새 사업
                </button>
              </div>
              <JointProjectSummary
                projectId={detailDisplayRecord.jointProjectId}
                organization={detailOrganization}
                selectedActivityId={detailDisplayRecord.id}
                onSelectMember={(member) => {
                  cancelDetailInlineEdit();
                  setDetailBusinessRound(member.businessRound);
                  setDetailOrganization(member.organization);
                }}
              />
              {detailLatest && !detailDisplayRecord.jointProjectId && (
                <div className="history-joint-project-action">
                  <div>
                    <strong>주관기관과 설치기관이 다른 사업인가요?</strong>
                    <span>같은 기관이면 연결하지 않아도 됩니다. 다른 기관일 때만 사업 관계를 연결합니다.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setJointProjectSeedCandidates([{
                        organization: detailDisplayRecord.organization,
                        businessRound: selectedDetailBusinessRound,
                        activityId: detailDisplayRecord.id,
                        budgetAmount: parseMoneyAmount(detailDisplayRecord.budgetAmount) || null,
                        budgetType: detailDisplayRecord.budgetType,
                      }]);
                      setJointProjectOpen(true);
                    }}
                  >
                    + 설치기관 연결
                  </button>
                </div>
              )}
              <section className="history-summary-grid" aria-label="기관 최신 정보 요약">
                <div>
                  <span>{detailLatest ? "최종 컨택일" : "캠페인 등록일"}</span>
                  <strong>{formatDate(detailDisplayRecord.activityDate)}</strong>
                </div>
                <div
                  className={`${
                    detailDisplayRecord.jointProjectId
                      ? "history-summary-readonly history-summary-joint-budget"
                      : "history-summary-editable"
                  } history-summary-budget ${detailInlineField === "budget" ? "editing" : ""}`}
                  role={detailDisplayRecord.jointProjectId ? undefined : "button"}
                  tabIndex={detailDisplayRecord.jointProjectId ? undefined : 0}
                  onClick={() => {
                    if (!detailDisplayRecord.jointProjectId) {
                      beginDetailInlineEdit("budget", detailDisplayRecord);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      !detailDisplayRecord.jointProjectId &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      beginDetailInlineEdit("budget", detailDisplayRecord);
                    }
                  }}
                >
                  <span>
                    {detailDisplayRecord.jointProjectId
                      ? "공동사업 예산"
                      : detailRegisteredContract
                        ? "계약금액"
                        : "예산"}
                  </span>
                  {detailDisplayRecord.jointProjectId ? (
                    <>
                      <strong>
                        {detailDisplayRecord.jointProjectName ||
                          "상단 공동사업 예산 참조"}
                      </strong>
                      <small>
                        예산명·기관별 금액·합계는 상단 공동사업 정보가 기준입니다.
                      </small>
                      <small>
                        같은 공동사업의 과거 입력은 원문 이력을 보존하고 공동사업 예산으로 함께 표시합니다. 실제 별도 예산만 새 사업으로 나눕니다.
                      </small>
                    </>
                  ) : detailInlineField === "budget" && detailInlineDraft ? (
                    <div
                      className="history-inline-editor budget multiple"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <section className="activity-budget-editor history-inline-budget-editor">
                        <div className="activity-budget-editor-heading">
                          <div>
                            <strong>연결된 예산</strong>
                            <small>같은 사업 차수의 예산을 모두 관리합니다.</small>
                          </div>
                          <button type="button" onClick={addDetailInlineBudget}>
                            + 예산 추가
                          </button>
                        </div>
                        <div className="activity-budget-rows">
                          {detailInlineDraft.budgets.map((budget, index) => (
                            <div
                              className="activity-budget-row"
                              key={`${index}-${budget.budgetGroupId ?? budget.budgetType}`}
                            >
                              <div className="activity-budget-row-title">
                                <strong>{index + 1}번째 예산</strong>
                                {index === 0 && <span>대표 예산</span>}
                                {detailInlineDraft.budgets.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeDetailInlineBudget(index)}
                                  >
                                    삭제
                                  </button>
                                )}
                              </div>
                              <div className="activity-budget-row-fields">
                                <div className="budget-form-field">
                                  <span>예산명</span>
                                  <BudgetNameSelector
                                    value={budget}
                                    organization={detailInlineDraft.organization}
                                    activityId={detailDisplayRecord.id}
                                    onChange={(selection) =>
                                      updateDetailInlineBudgetSelection(
                                        selection,
                                        index,
                                      )
                                    }
                                    onToast={setToast}
                                    standardOnly
                                  />
                                </div>
                                <div className="budget-form-field budget-amount-field">
                                  <span>예산금액</span>
                                  <input
                                    inputMode="decimal"
                                    value={budget.budgetAmount}
                                    placeholder="예: 5,800만원"
                                    onChange={(event) =>
                                      updateDetailInlineBudgetAmount(
                                        index,
                                        event.target.value,
                                      )
                                    }
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                      {renderDetailInlineActions(detailDisplayRecord)}
                    </div>
                  ) : (
                    <>
                      <strong
                        className={
                          detailRegisteredContract
                            ? `quote-${detailRegisteredContract.status}`
                            : undefined
                        }
                      >
                        {detailRegisteredContract
                          ? detailRegisteredContract.amount
                          : detailDisplayRecord.budgets
                              .map((budget) => budget.budgetType)
                              .filter(Boolean)
                              .join(" + ") || "미정"}
                      </strong>
                      <small>
                        {detailRegisteredContract
                          ? `예산명 ${
                              detailDisplayRecord.budgets
                                .map((budget) => budget.budgetType)
                                .filter(Boolean)
                                .join(" + ") || "미정"
                            } · 예산금액 ${detailBudgetAmountDisplay?.label || "미정"}`
                          : detailBudgetAmountDisplay?.label ||
                            "예산금액 미정"}
                      </small>
                      {detailDisplayRecord.budgets.length > 1 && (
                        <small>
                          복수 예산 {detailDisplayRecord.budgets.length}개 · 최신 기록 수정에서 전체 관리
                        </small>
                      )}
                      {detailDisplayRecord.budgetMatchStatus &&
                        !["auto", "approved", "excluded"].includes(
                          detailDisplayRecord.budgetMatchStatus,
                        ) && (
                          <small
                            className={`budget-match-badge ${detailDisplayRecord.budgetMatchStatus}`}
                          >
                            {budgetMatchStatusLabel(
                              detailDisplayRecord.budgetMatchStatus,
                            )}
                          </small>
                        )}
                      <small>카드를 눌러 수정</small>
                    </>
                  )}
                </div>
                <div
                  className={`history-summary-editable ${detailInlineField === "contact" ? "editing" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    beginDetailInlineEdit("contact", detailDisplayRecord)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      beginDetailInlineEdit("contact", detailDisplayRecord);
                    }
                  }}
                >
                  <span>{detailDisplayRecord.contactRole || "기관 담당자"}</span>
                  {detailInlineField === "contact" && detailInlineDraft ? (
                    <div
                      className="history-inline-editor"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {detailJointProjectSponsorContact && (
                        <div className="history-inline-contact-source">
                          <div>
                            <strong>주관기관 담당자 정보</strong>
                            <small>
                              {detailJointProjectSponsorContact.organization}
                              {detailJointProjectSponsorContact.contactName
                                ? ` · ${detailJointProjectSponsorContact.contactName}`
                                : ""}
                            </small>
                          </div>
                          <button
                            type="button"
                            onClick={applyDetailJointProjectSponsorContact}
                          >
                            주관기관 담당자 정보 불러오기
                          </button>
                        </div>
                      )}
                      <input
                        value={detailInlineDraft.contactName}
                        placeholder="담당자 이름"
                        onChange={(event) =>
                          updateDetailInlineDraft({
                            contactName: event.target.value,
                          })
                        }
                      />
                      <input
                        value={detailInlineDraft.contactPhone}
                        placeholder="연락처"
                        onChange={(event) =>
                          updateDetailInlineDraft({
                            contactPhone: event.target.value,
                          })
                        }
                      />
                      <input
                        type="email"
                        value={detailInlineDraft.contactEmail}
                        placeholder="이메일"
                        onChange={(event) =>
                          updateDetailInlineDraft({
                            contactEmail: event.target.value,
                          })
                        }
                      />
                      {renderDetailInlineActions(detailDisplayRecord)}
                    </div>
                  ) : (
                    <>
                      <strong>{detailDisplayRecord.contactName || "미등록"}</strong>
                      <small>{detailDisplayRecord.contactEmail || "기관 메일 미등록"}</small>
                      <small>카드를 눌러 수정</small>
                    </>
                  )}
                </div>
                <div
                  className={`history-summary-editable ${
                    ["위즈업 수주", "협력사 수주"].includes(
                      detailDisplayRecord.awardStatus,
                    )
                      ? ""
                      : "history-summary-disabled"
                  } ${detailInlineField === "awardStage" ? "editing" : ""}`}
                  role={
                    ["위즈업 수주", "협력사 수주"].includes(
                      detailDisplayRecord.awardStatus,
                    )
                      ? "button"
                      : undefined
                  }
                  tabIndex={
                    ["위즈업 수주", "협력사 수주"].includes(
                      detailDisplayRecord.awardStatus,
                    )
                      ? 0
                      : undefined
                  }
                  onClick={() => {
                    if (
                      ["위즈업 수주", "협력사 수주"].includes(
                        detailDisplayRecord.awardStatus,
                      )
                    ) {
                      beginDetailInlineEdit(
                        "awardStage",
                        detailDisplayRecord,
                      );
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.key === "Enter" || event.key === " ") &&
                      ["위즈업 수주", "협력사 수주"].includes(
                        detailDisplayRecord.awardStatus,
                      )
                    ) {
                      beginDetailInlineEdit(
                        "awardStage",
                        detailDisplayRecord,
                      );
                    }
                  }}
                >
                  <span>수주 진행단계</span>
                  {detailInlineField === "awardStage" &&
                  detailInlineDraft ? (
                    <div
                      className="history-inline-editor"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <select
                        value={normalizeAwardStage(
                          detailInlineDraft.awardStage,
                          detailInlineDraft.awardStatus,
                        )}
                        onChange={(event) =>
                          updateDetailInlineDraft({
                            awardStage: event.target.value,
                          })
                        }
                      >
                        {awardStageOptions.map((stage) => (
                          <option key={stage}>{stage}</option>
                        ))}
                      </select>
                      <small>
                        납품 완료 변경 시 완료일과 재연락 상태도 함께
                        정리됩니다.
                      </small>
                      {renderDetailInlineActions(detailDisplayRecord)}
                    </div>
                  ) : (
                    <>
                      <strong>
                        {detailDisplayRecord.awardStatus === "미정"
                          ? "수주 전"
                          : detailDisplayRecord.awardStatus === "타업체 수주"
                            ? "해당 없음"
                            : normalizeAwardStage(
                                detailDisplayRecord.awardStage,
                                detailDisplayRecord.awardStatus,
                              )}
                      </strong>
                      <small>
                        {["위즈업 수주", "협력사 수주"].includes(
                          detailDisplayRecord.awardStatus,
                        )
                          ? "카드를 눌러 수정"
                          : detailDisplayRecord.awardStatus === "타업체 수주"
                            ? "타업체 진행단계는 관리하지 않습니다."
                            : "수주 전환 후 수정할 수 있습니다."}
                      </small>
                    </>
                  )}
                </div>
                <div
                  className={`history-summary-editable ${detailInlineField === "execution" ? "editing" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    beginDetailInlineEdit("execution", detailDisplayRecord)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      beginDetailInlineEdit("execution", detailDisplayRecord);
                    }
                  }}
                >
                  <span>사업방식</span>
                  {detailInlineField === "execution" && detailInlineDraft ? (
                    <div
                      className="history-inline-editor"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <select
                        value={detailInlineDraft.executionType}
                        onChange={(event) =>
                          updateDetailInlineDraft({
                            executionType: event.target.value,
                            consortiumCompany:
                              event.target.value === "컨소"
                                ? detailInlineDraft.consortiumCompany
                                : "",
                          })
                        }
                      >
                        <option>직영</option>
                        <option>컨소</option>
                      </select>
                      {detailInlineDraft.executionType === "컨소" && (
                        <input
                          value={detailInlineDraft.consortiumCompany}
                          placeholder="컨소 업체명"
                          onChange={(event) =>
                            updateDetailInlineDraft({
                              consortiumCompany: event.target.value,
                            })
                          }
                        />
                      )}
                      {renderDetailInlineActions(detailDisplayRecord)}
                    </div>
                  ) : (
                    <>
                      <strong>{detailDisplayRecord.executionType || "미정"}</strong>
                      <small>
                        {detailDisplayRecord.executionType === "컨소"
                          ? detailDisplayRecord.consortiumCompany ||
                            "컨소 업체 미등록"
                          : "카드를 눌러 수정"}
                      </small>
                    </>
                  )}
                </div>
                <div
                  className={`${canEditProgressManager ? "history-summary-editable" : "history-summary-readonly"} ${detailInlineField === "progressManager" ? "editing" : ""}`}
                  role={canEditProgressManager ? "button" : undefined}
                  tabIndex={canEditProgressManager ? 0 : undefined}
                  onClick={() => {
                    if (canEditProgressManager) {
                      beginDetailInlineEdit(
                        "progressManager",
                        detailDisplayRecord,
                      );
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      canEditProgressManager &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      beginDetailInlineEdit(
                        "progressManager",
                        detailDisplayRecord,
                      );
                    }
                  }}
                >
                  <span>진행 담당자</span>
                  {detailInlineField === "progressManager" &&
                  detailInlineDraft &&
                  canEditProgressManager ? (
                    <div
                      className="history-inline-editor"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <select
                        value={detailInlineDraft.progressManager}
                        onChange={(event) =>
                          updateDetailInlineDraft({
                            progressManager: event.target.value,
                          })
                        }
                      >
                        <option value="">담당자 선택</option>
                        {registeredSalesNames.map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                      {renderDetailInlineActions(detailDisplayRecord)}
                    </div>
                  ) : (
                    <>
                      <strong>{detailDisplayRecord.progressManager || "미등록"}</strong>
                      {session?.canViewPresence &&
                        detailDisplayRecord.awardStatus !== "협력사 수주" && (
                          <button
                            type="button"
                            className={`assignment-mode-switch ${
                              detailDisplayRecord.progressManagerLocked
                                ? "fixed"
                                : "automatic"
                            }`}
                            role="switch"
                            aria-checked={
                              detailDisplayRecord.progressManagerLocked
                            }
                            aria-label="담당자 고정"
                            disabled={activityReviewSavingIds.includes(
                              detailDisplayRecord.id,
                            )}
                            title={
                              detailDisplayRecord.progressManagerLocked
                                ? "눌러서 담당자 고정을 끄고 AI 기록 작성자 자동 배정으로 전환"
                                : "눌러서 현재 진행 담당자를 이후 AI 기록에도 고정"
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              void setProgressManagerLock(
                                detailDisplayRecord,
                                !detailDisplayRecord.progressManagerLocked,
                              );
                            }}
                          >
                            <span className="assignment-mode-switch-label">
                              담당자 고정
                            </span>
                            <span
                              className="assignment-mode-switch-track"
                              aria-hidden="true"
                            >
                              <span className="assignment-mode-switch-thumb" />
                            </span>
                          </button>
                        )}
                    </>
                  )}
                </div>
              </section>

              <section className="organization-current-schedule">
                <div className="history-section-heading">
                  <div>
                    <span className="section-kicker">CURRENT SCHEDULE</span>
                    <h3>일정 관리</h3>
                  </div>
                  <span>
                    {detailCurrentSchedules.filter((item) => !item.completed).length}건 진행
                    {detailCurrentSchedules.some((item) => item.completed)
                      ? ` · ${detailCurrentSchedules.filter((item) => item.completed).length}건 완료`
                      : ""}
                  </span>
                </div>
                {detailScheduleEditing ? (
                  <div className="organization-schedule-editor">
                    {detailScheduleDrafts.map((item, index) => (
                      <div className="organization-schedule-editor-row" key={item.key}>
                        <label className="organization-schedule-complete">
                          <input
                            type="checkbox"
                            checked={item.completed}
                            onChange={(event) =>
                              setDetailScheduleDrafts((current) =>
                                current.map((schedule, itemIndex) =>
                                  itemIndex === index
                                    ? { ...schedule, completed: event.target.checked }
                                    : schedule,
                                ),
                              )
                            }
                          />
                          <span>완료</span>
                        </label>
                        <input
                          type="text"
                          value={item.label}
                          placeholder="예: 설치, 교육, 검수"
                          aria-label={`${index + 1}번째 일정 이름`}
                          onChange={(event) =>
                            setDetailScheduleDrafts((current) =>
                              current.map((schedule, itemIndex) =>
                                itemIndex === index
                                  ? { ...schedule, label: event.target.value }
                                  : schedule,
                              ),
                            )
                          }
                        />
                        <input
                          type="date"
                          value={item.scheduledDate}
                          aria-label={`${index + 1}번째 일정 날짜`}
                          onChange={(event) =>
                            setDetailScheduleDrafts((current) =>
                              current.map((schedule, itemIndex) =>
                                itemIndex === index
                                  ? { ...schedule, scheduledDate: event.target.value }
                                  : schedule,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          className="danger"
                          onClick={() =>
                            setDetailScheduleDrafts((current) =>
                              current.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                    <div className="organization-schedule-editor-actions">
                      <button
                        type="button"
                        onClick={() =>
                          setDetailScheduleDrafts((current) => [
                            ...current,
                            {
                              key: `new-${Date.now()}-${current.length}`,
                              label: "",
                              scheduledDate: todayValue,
                              completed: false,
                            },
                          ])
                        }
                      >
                        + 일정 추가
                      </button>
                      <span />
                      <button type="button" onClick={cancelDetailScheduleEdit}>
                        취소
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={detailScheduleSaving}
                        onClick={() => void saveDetailSchedules()}
                      >
                        {detailScheduleSaving ? "저장 중" : "일정 저장"}
                      </button>
                    </div>
                    <p>
                      일정 완료 여부와 날짜만 저장됩니다. 영업 진행상황이나 수주 진행단계는 자동으로 바뀌지 않습니다.
                    </p>
                  </div>
                ) : detailSchedulesLoading ? (
                  <p className="organization-current-schedule-empty">
                    일정을 불러오는 중입니다.
                  </p>
                ) : detailCurrentSchedules.length > 0 ? (
                  <div className="organization-current-schedule-list">
                    {detailCurrentSchedules.map((item) => (
                      <div
                        key={item.id}
                        className={item.completed ? "completed" : ""}
                      >
                        <time dateTime={item.scheduledDate}>
                          {formatDate(item.scheduledDate)}
                        </time>
                        <strong>{item.label}</strong>
                        <small>
                          {item.completed
                            ? "완료"
                            : item.scheduledDate < todayValue
                              ? "지남"
                              : item.scheduledDate === todayValue
                                ? "오늘"
                                : "예정"}
                        </small>
                        {item.syncStatus === "failed" ? (
                          <button
                            type="button"
                            className="schedule-sync-retry"
                            title={item.syncError}
                            onClick={() => void retryDetailScheduleSync(item.id)}
                          >
                            Google 동기화 실패 · 재시도
                          </button>
                        ) : item.syncStatus === "pending" ? (
                          <small className="schedule-sync-pending">Google 동기화 대기</small>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="organization-current-schedule-empty">
                    등록된 일정이 없습니다.
                  </p>
                )}
                {!detailScheduleEditing && (
                  <button
                    type="button"
                    onClick={beginDetailScheduleEdit}
                  >
                    일정 관리
                  </button>
                )}
              </section>

              <OrganizationEquipmentManager
                organization={detailOrganization}
                businessRound={selectedDetailBusinessRound}
                budgets={detailLatest?.budgets ?? []}
                onToast={setToast}
                refreshVersion={equipmentRefreshVersion}
                onEquipmentChanged={() =>
                  void loadEquipmentQuoteSummaries()
                }
              />

              <Suspense fallback={<DeferredPageFallback />}>
                <QuotationDocuments
                  organization={detailOrganization}
                  businessRound={selectedDetailBusinessRound}
                  onToast={setToast}
                  onEquipmentImported={() => {
                    setEquipmentRefreshVersion((current) => current + 1);
                    void loadEquipmentQuoteSummaries();
                  }}
                />
              </Suspense>

              <section className="history-latest">
                <div className="history-section-heading">
                  <div>
                    <span className="section-kicker">
                      {detailLatest ? "LATEST CONTACT" : "CAMPAIGN REGISTRATION"}
                    </span>
                    <h3>{detailLatest ? "최근 컨택 상세" : "캠페인 등록 정보"}</h3>
                  </div>
                  <div className="history-section-actions">
                    {detailLatest && hasActivityDetail(detailLatest) && (
                      <button
                        type="button"
                        className="history-secondary-action"
                        onClick={() => setSelectedActivityDetail(detailLatest)}
                      >
                        상세 기록 보기
                      </button>
                    )}
                    <button
                      type="button"
                      className="history-primary-action"
                      onClick={() => {
                        setDetailOrganization(null);
                        if (detailLatest) {
                          openEdit(detailLatest, true);
                        } else {
                          openNewForOrganization(detailDisplayRecord);
                        }
                      }}
                    >
                      {detailLatest ? "최신 기록 수정" : "첫 TM·미팅 기록 입력"}
                    </button>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>주제</dt>
                    <dd>{detailDisplayRecord.topic || "입력 없음"}</dd>
                  </div>
                  <div>
                    <dt>내용</dt>
                    <dd>{detailDisplayRecord.summary || "입력 없음"}</dd>
                  </div>
                  <div>
                    <dt>다음 행동</dt>
                    <dd>{detailDisplayRecord.nextAction || "미정"}</dd>
                  </div>
                  <div>
                    <dt>재연락</dt>
                    <dd>
                      {detailDisplayRecord.followUpDate
                        ? formatDate(detailDisplayRecord.followUpDate)
                        : "일정 미정"}
                    </dd>
                  </div>
                  {detailDisplayRecord.notes && (
                    <div>
                      <dt>메모</dt>
                      <dd>{detailDisplayRecord.notes}</dd>
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
                  <div className="history-scope-toggle" role="group" aria-label="히스토리 범위">
                    <button
                      type="button"
                      className={detailHistoryScope === "round" ? "active" : ""}
                      onClick={() => setDetailHistoryScope("round")}
                    >현재 차수 기록</button>
                    <button
                      type="button"
                      className={detailHistoryScope === "all" ? "active" : ""}
                      onClick={() => setDetailHistoryScope("all")}
                    >전체 기록</button>
                    <span>{detailVisibleHistory.length}건</span>
                  </div>
                </div>
                <div className="history-timeline">
                  {detailVisibleHistory.length === 0 && (
                    <div className="empty-state">등록된 컨택 기록이 없습니다.</div>
                  )}
                  {detailVisibleHistory.map((record, index) => {
                    const contactStatus = postAwardContactStatus(
                      record,
                      detailVisibleHistory,
                    );
                    const displayedStatus =
                      contactStatus || displaySalesStatus(record);
                    return (
                    <article className="history-event" key={record.id}>
                      <div className="history-event-date">
                        <b>{formatDate(record.activityDate)}</b>
                        {formatInputTime(record.createdAt) && (
                          <small>{formatInputTime(record.createdAt)}</small>
                        )}
                        <span>{index === 0 ? "최신" : String(index + 1).padStart(2, "0")}</span>
                      </div>
                      <div className="history-event-main">
                        <div className="history-event-toolbar">
                          <div className="history-event-pills">
                            <span className="contact-pill">
                              {displayContactMethod(record)}
                            </span>
                            <span className="type-pill">{record.activityType}</span>
                            <span className={`status-pill ${statusClass(displayedStatus)}`}>
                              {displayedStatus}
                            </span>
                            <span className="business-round-pill">
                              {record.businessRound > 0
                                ? `${record.businessRound}차 사업`
                                : "차수 미지정"}
                            </span>
                          </div>
                          <div className="history-event-actions">
                            {hasActivityDetail(record) && (
                              <button
                                type="button"
                                className="detail"
                                onClick={() => setSelectedActivityDetail(record)}
                              >
                                상세 기록 보기
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setDetailOrganization(null);
                                openEdit(record, true);
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
                        <strong>{record.summary || "상세 내용이 없습니다."}</strong>
                        <small>
                          {record.region || "지역 미입력"} ·{" "}
                          {record.budgets
                            .map((budget) => budget.budgetType)
                            .filter(Boolean)
                            .join(" + ") || "예산 미정"} ·{" "}
                          {budgetAmountDisplayForRecord(record).label}
                        </small>
                        <small className="history-event-editor">
                          작성 {record.createdByName}
                          {record.updatedByName
                            ? ` · 최근 수정 ${record.updatedByName} · ${formatChangeHistoryTime(record.updatedAt)}`
                            : ""}
                        </small>
                      </div>
                    </article>
                    );
                  })}
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}

      {selectedActivityDetail && (
        <div
          className="activity-detail-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="activity-detail-title"
        >
          <button
            type="button"
            className="activity-detail-backdrop"
            aria-label="상세 기록 닫기"
            onClick={() => setSelectedActivityDetail(null)}
          />
          <section className="activity-detail-dialog">
            <header>
              <div>
                <span className="section-kicker">DETAILED ACTIVITY</span>
                <h2 id="activity-detail-title">
                  {selectedActivityDetail.organization}
                </h2>
                <p>
                  {formatDate(selectedActivityDetail.activityDate)} ·{" "}
                  {selectedActivityDetail.activityType} ·{" "}
                  {activityDetailLevelLabel(selectedActivityDetail.detailLevel)}
                </p>
              </div>
              <div className="activity-detail-header-actions">
                <button
                  type="button"
                  className="activity-detail-edit-button"
                  onClick={() => {
                    const record = selectedActivityDetail;
                    setSelectedActivityDetail(null);
                    setDetailOrganization(null);
                    openEdit(record, true);
                  }}
                >
                  상세 기록 수정
                </button>
                <button
                  type="button"
                  className="close-button"
                  onClick={() => setSelectedActivityDetail(null)}
                  aria-label="상세 기록 닫기"
                >
                  ×
                </button>
              </div>
            </header>
            <div className="activity-detail-body">
              <section className="activity-detail-summary">
                <span>핵심 요약</span>
                <p>
                  {selectedActivityDetail.detailSummary ||
                    selectedActivityDetail.summary ||
                    "등록된 요약이 없습니다."}
                </p>
              </section>

              <dl className="activity-detail-facts">
                <div>
                  <dt>활동일</dt>
                  <dd>{formatDate(selectedActivityDetail.activityDate)}</dd>
                </div>
                <div>
                  <dt>담당자</dt>
                  <dd>{selectedActivityDetail.progressManager || "미지정"}</dd>
                </div>
                {activityDetailFactsForRecord(selectedActivityDetail).map((fact) => (
                  <div key={`${fact.label}-${fact.value}`}>
                    <dt>{fact.label}</dt>
                    <dd>
                      {activityDetailFactValueForRecord(
                        selectedActivityDetail,
                        fact,
                      )}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="activity-detail-sections">
                {activityDetailSectionsForRecord(selectedActivityDetail).map((section, index) => (
                  <details
                    key={`${section.title}-${index}`}
                    open={index < 2 || /향후|일정|후속/.test(section.title)}
                  >
                    <summary>
                      <span>{section.title}</span>
                      <small>{section.items.length}개 항목</small>
                    </summary>
                    <ul>
                      {section.items.map((item, itemIndex) => (
                        <li key={`${itemIndex}-${item}`}>{item}</li>
                      ))}
                    </ul>
                  </details>
                ))}
                {activityDetailSectionsForRecord(selectedActivityDetail).length === 0 && (
                  <details open>
                    <summary>
                      <span>기록 내용</span>
                    </summary>
                    <ul>
                      {[
                        selectedActivityDetail.summary,
                        selectedActivityDetail.nextAction
                          ? `다음 행동: ${selectedActivityDetail.nextAction}`
                          : "",
                        selectedActivityDetail.notes,
                      ]
                        .filter(Boolean)
                        .map((item, index) => (
                          <li key={`${index}-${item}`}>{item}</li>
                        ))}
                    </ul>
                  </details>
                )}
              </div>

              {selectedActivityDetail.rawInput && (
                <details className="activity-detail-raw">
                  <summary>원문 입력 보기</summary>
                  <pre>{selectedActivityDetail.rawInput}</pre>
                </details>
              )}
            </div>
          </section>
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
                  내가 진행 담당자인 기록 보완, 품목 금액 확인과 영업보호
                  신청 업무를 함께 보여드립니다.
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
                  확인 필요{" "}
                  {pendingActivityReviewGroups.length +
                    protectionReviewItems.length +
                    correctionRequests.length}
                  건
                </strong>
                <span>
                  금액 보완은 기관 품목을 수정한 뒤 완료 처리하고, 기록은 알고
                  있는 내용만 보완하면 됩니다.
                </span>
              </div>
              {correctionRequests.length > 0 && (
                <section className="protection-review-section correction-request-section">
                  <header>
                    <div>
                      <span className="section-kicker">PRICE CHECK</span>
                      <h3>품목 금액 보완 요청</h3>
                    </div>
                    <b>{correctionRequests.length}건</b>
                  </header>
                  <div className="protection-review-list">
                    {correctionRequests.map((item) => {
                      const isSaving = correctionRequestSavingIds.includes(
                        item.id,
                      );
                      return (
                        <article className="protection-review-item" key={item.id}>
                          <div>
                            <span>
                              {item.organization} · {item.businessRound}차 사업
                            </span>
                            <strong>
                              금액 미입력 {item.itemNames.length}건
                            </strong>
                            <small>{item.itemNames.join(" · ")}</small>
                            <small>
                              요청 {item.requestedByName || "관리자"}
                            </small>
                          </div>
                          <div className="protection-review-actions">
                            <button
                              type="button"
                              className="protection-open-organization"
                              disabled={isSaving}
                              onClick={() => {
                                setActivityReviewOpen(false);
                                setDetailBusinessRound(item.businessRound);
                                setDetailOrganization(item.organization);
                              }}
                            >
                              기관에서 품목 수정
                            </button>
                            <button
                              type="button"
                              className="protection-complete"
                              disabled={isSaving}
                              onClick={() =>
                                void completeCorrectionRequest(item)
                              }
                            >
                              {isSaving ? "처리 중…" : "수정 완료"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
              {protectionReviewItems.length > 0 && (
                <section className="protection-review-section">
                  <header>
                    <div>
                      <span className="section-kicker">SALES PROTECTION</span>
                      <h3>영업보호 신청 필요</h3>
                    </div>
                    <b>{protectionReviewItems.length}건</b>
                  </header>
                  <div className="protection-review-list">
                    {protectionReviewItems.map((item) => {
                      const isSaving = protectionReviewSavingIds.includes(item.id);
                      return (
                        <article className="protection-review-item" key={item.id}>
                          <div>
                            <span>{item.organization} · {item.projectName}</span>
                            <strong>{item.productName}</strong>
                            {item.specification && <small>{item.specification}</small>}
                          </div>
                          <div className="protection-review-actions">
                            <button
                              type="button"
                              className="protection-open-organization"
                              onClick={() => {
                                setActivityReviewOpen(false);
                                setDetailOrganization(item.organization);
                              }}
                            >
                              기관 보기
                            </button>
                            <button
                              type="button"
                              className="protection-complete"
                              disabled={isSaving}
                              onClick={() => void completeProtectionReview(item)}
                            >
                              {isSaving ? "변경 중…" : "신청 완료"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
              {pendingActivityReviewGroups.map((group) => {
                const contactKeys = [
                  "contactName",
                  "contactPhone",
                  "contactEmail",
                ] as const;
                const sharedFields = contactKeys.flatMap((key) => {
                  for (const record of group.records) {
                    const field = activityReviewFields(
                      record,
                      activityReviewInstitutionState(record),
                    ).find((candidate) => candidate.key === key);
                    if (field) return [{ field, record }];
                  }
                  return [];
                });
                const totalIssues = group.records.reduce(
                  (total, record) =>
                    total +
                    activityReviewFields(
                      record,
                      activityReviewInstitutionState(record),
                    ).length,
                  0,
                );
                const hasChanges = group.records.some((record) =>
                  activityReviewFields(
                    record,
                    activityReviewInstitutionState(record),
                  ).some((field) => {
                    const value = activityReviewDrafts[record.id]?.[field.key];
                    return (
                      value !== undefined &&
                      value.trim() !== "" &&
                      value !== String(record[field.key] ?? "")
                    );
                  }),
                );
                const isSaving = group.records.some((record) =>
                  activityReviewSavingIds.includes(record.id),
                );
                return (
                  <article className="record-review-item grouped" key={group.key}>
                    <header>
                      <div>
                        <span>
                          관련 영업 기록 {group.records.length}건 · 최신{" "}
                          {formatDate(group.records[0].activityDate)}
                        </span>
                        <h3>{group.organization}</h3>
                      </div>
                      <div className="record-review-heading-actions">
                        <em>{totalIssues}개 확인 필요</em>
                      </div>
                    </header>

                    {sharedFields.length > 0 && (
                      <section className="record-review-shared-fields">
                        <div>
                          <strong>기관 공통 연락처</strong>
                          <small>
                            한 번 수정하면 이 기관의 확인 대상 기록에 함께
                            반영됩니다.
                          </small>
                        </div>
                        <div className="record-review-fields">
                          {sharedFields.map(({ field, record }) => {
                            const value =
                              activityReviewDrafts[record.id]?.[field.key] ??
                              String(record[field.key] ?? "");
                            return (
                              <label key={field.key}>
                                <span>
                                  <b>{field.label}</b>
                                  <small>{field.reason}</small>
                                </span>
                                <input
                                  type={field.inputType}
                                  value={value}
                                  placeholder={field.placeholder}
                                  onChange={(event) =>
                                    updateActivityReviewGroupDraft(
                                      group.records,
                                      field.key as
                                        | "contactName"
                                        | "contactPhone"
                                        | "contactEmail",
                                      event.target.value,
                                    )
                                  }
                                />
                              </label>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    <div className="record-review-related-list">
                      {group.records.map((record) => {
                        const fields = activityReviewFields(
                          record,
                          activityReviewInstitutionState(record),
                        ).filter(
                          (field) =>
                            !contactKeys.includes(
                              field.key as (typeof contactKeys)[number],
                            ),
                        );
                        const draft = activityReviewDrafts[record.id] ?? {};
                        return (
                          <section
                            className="record-review-related-record"
                            key={record.id}
                          >
                            <header>
                              <div>
                                <strong>
                                  {formatDate(record.activityDate)} ·{" "}
                                  {record.activityType}
                                </strong>
                                <small>
                                  {record.businessRound}차 사업 · 기록 #{record.id}
                                </small>
                              </div>
                              {record.awardStatus !== "협력사 수주" &&
                                renderInlineAssigneePicker(record)}
                            </header>
                            <p className="record-review-context">
                              {record.summary ||
                                record.topic ||
                                "상담 요약이 없어 내용을 확인해 주세요."}
                            </p>
                            {fields.length > 0 && (
                              <div className="record-review-fields">
                                {fields.map((field) => {
                                  const currentValue = String(
                                    record[field.key] ?? "",
                                  );
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
                                      ) : field.key === "budgetType" ? (
                                        <BudgetNameSelector
                                          value={{ budgetType: value }}
                                          standardOnly
                                          onChange={(selection) =>
                                            updateActivityReviewDraft(
                                              record.id,
                                              field.key,
                                              selection.budgetType,
                                            )
                                          }
                                          onToast={setToast}
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
                                            !registeredSalesNames.includes(
                                              value,
                                            ) && (
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
                            )}
                          </section>
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
                          setDetailOrganization(group.organization);
                        }}
                      >
                        기관 전체 기록 보기
                      </button>
                      <button
                        type="button"
                        className="record-review-later"
                        disabled={isSaving}
                        onClick={() =>
                          void snoozeActivityReviewGroup(
                            group.organization,
                            group.records,
                          )
                        }
                      >
                        내일 다시 보기
                      </button>
                      <button
                        type="button"
                        className="record-review-complete"
                        disabled={isSaving}
                        onClick={() =>
                          void completeActivityReviewGroup(
                            group.organization,
                            group.records,
                          )
                        }
                      >
                        {isSaving
                          ? "저장 중…"
                          : hasChanges
                            ? "전체 보완 저장·점검 완료"
                            : "전체 현재 정보로 확인 완료"}
                      </button>
                    </footer>
                  </article>
                );
              })}
              {!activityReviewsLoading &&
                !protectionReviewsLoading &&
                !correctionRequestsLoading &&
                pendingActivityReviewGroups.length === 0 &&
                protectionReviewItems.length === 0 &&
                correctionRequests.length === 0 && (
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

      {awardChangeHistoryOpen && canManageActivityHistory && (
        <div
          className="modal-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="award-change-history-title"
        >
          <button
            className="modal-backdrop"
            aria-label="일괄 변경 이력 창 닫기"
            disabled={awardChangeUndoBusyId !== null}
            onClick={() => setAwardChangeHistoryOpen(false)}
          />
          <aside className="record-modal award-change-history-modal">
            <div className="modal-header">
              <div>
                <span className="section-kicker">CHANGE HISTORY</span>
                <h2 id="award-change-history-title">일괄 변경 이력</h2>
              </div>
              <button
                type="button"
                className="close-button"
                disabled={awardChangeUndoBusyId !== null}
                onClick={() => setAwardChangeHistoryOpen(false)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="award-change-history-body">
              <div className="award-change-history-guide">
                <div>
                  <strong>일괄 변경은 묶음별로 되돌릴 수 있습니다.</strong>
                  <p>
                    수주 전·후 일괄 변경을 함께 기록합니다. 변경 후 다시 수정된
                    항목만 건너뛰고, 같은 기록의 나머지 항목은 이전 값으로
                    복원합니다.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={
                    awardChangeHistoryLoading ||
                    awardChangeUndoBusyId !== null
                  }
                  onClick={() => void loadAwardChangeHistory()}
                >
                  {awardChangeHistoryLoading ? "불러오는 중…" : "새로고침"}
                </button>
              </div>
              {awardChangeHistoryError && (
                <div className="award-change-history-error" role="alert">
                  <span>{awardChangeHistoryError}</span>
                  <button
                    type="button"
                    onClick={() => void loadAwardChangeHistory()}
                  >
                    다시 시도
                  </button>
                </div>
              )}
              <div
                className="award-change-history-list"
                aria-busy={awardChangeHistoryLoading}
              >
                {awardChangeHistoryBatches.map((batch) => {
                  const affectedCount = batch.appliedCount;
                  const isPartial = batch.status === "in_progress";
                  return (
                    <article
                      key={batch.id}
                      className={batch.undoneAt ? "undone" : ""}
                    >
                      <header>
                        <div>
                          <strong>
                            <span className={`change-scope ${batch.scope}`}>
                              {batch.scopeLabel}
                            </span>
                            {batch.label}
                          </strong>
                          <small>
                            {formatChangeHistoryTime(batch.createdAt)} ·{" "}
                            {batch.changedByName}
                          </small>
                        </div>
                        <span
                          className={
                            batch.undoneAt
                              ? "undone"
                              : isPartial
                                ? "partial"
                                : "applied"
                          }
                        >
                          {batch.undoneAt
                            ? "되돌림 완료"
                            : isPartial
                              ? "일부 적용"
                              : "적용됨"}
                        </span>
                      </header>
                      <div className="award-change-history-meta">
                        <span>
                          전체 대상{" "}
                          <b>
                            {(
                              batch.operationTotal || batch.itemCount
                            ).toLocaleString()}
                            건
                          </b>
                        </span>
                        {isPartial && (
                          <span>
                            처리 <b>{batch.itemCount.toLocaleString()}건</b>
                          </span>
                        )}
                        <span>
                          실제 변경 <b>{affectedCount.toLocaleString()}건</b>
                        </span>
                        {batch.conflictCount > 0 && (
                          <span className="conflict">
                            충돌 <b>{batch.conflictCount.toLocaleString()}건</b>
                          </span>
                        )}
                      </div>
                      {batch.sampleOrganizations.length > 0 && (
                        <p className="award-change-history-samples">
                          {batch.sampleOrganizations.join(" · ")}
                          {batch.itemCount >
                            batch.sampleOrganizations.length && " 외"}
                        </p>
                      )}
                      <footer>
                        {batch.undoneAt && (
                          <small>
                            {formatChangeHistoryTime(batch.undoneAt)}에
                            되돌렸습니다.
                          </small>
                        )}
                        <button
                          type="button"
                          disabled={
                            !batch.undoable ||
                            awardChangeUndoBusyId !== null
                          }
                          onClick={() => void undoAwardChangeBatch(batch)}
                        >
                          {awardChangeUndoBusyId === batch.id
                            ? "되돌리는 중…"
                            : batch.undoneAt
                              ? "되돌림 완료"
                              : batch.undoable
                                ? "이 변경 되돌리기"
                                : "되돌릴 수 없음"}
                        </button>
                      </footer>
                    </article>
                  );
                })}
                {!awardChangeHistoryLoading &&
                  !awardChangeHistoryError &&
                  awardChangeHistoryBatches.length === 0 && (
                    <div className="award-change-history-empty">
                      저장된 일괄 변경 이력이 없습니다.
                    </div>
                  )}
                {awardChangeHistoryHasMore && (
                  <button
                    type="button"
                    className="award-change-history-more"
                    disabled={
                      awardChangeHistoryLoading ||
                      awardChangeUndoBusyId !== null
                    }
                    onClick={() => void loadAwardChangeHistory(true)}
                  >
                    {awardChangeHistoryLoading
                      ? "이전 이력 불러오는 중…"
                      : "이전 변경 이력 더 보기"}
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {awardDeleteScope && (
        <div
          className="modal-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="award-delete-title"
        >
          <button
            className="modal-backdrop"
            aria-label="수주 삭제 창 닫기"
            disabled={awardDeleteBusy}
            onClick={closeAwardDelete}
          />
          <aside className="record-modal award-delete-modal">
            <div className="modal-header">
              <div>
                <span className="section-kicker">ADMIN DELETE</span>
                <h2 id="award-delete-title">수주 기록 안전 삭제</h2>
              </div>
              <button
                type="button"
                className="close-button"
                disabled={awardDeleteBusy}
                onClick={closeAwardDelete}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="award-delete-body">
              <div className="award-delete-warning">
                <strong>
                  {awardDeleteScope === "selected"
                    ? `선택한 ${selectedAwardIds.length}건`
                    : `현재 검색·필터 결과 ${displayedRecords.length}건`}
                  을 삭제합니다.
                </strong>
                <p>
                  삭제된 기록은 휴지통으로 이동하며 관리자가 30일 안에 복원할
                  수 있습니다. 기관의 다른 영업 기록은 유지됩니다.
                </p>
              </div>
              <div className="award-delete-preview">
                {(awardDeleteScope === "selected"
                  ? displayedRecords.filter((record) =>
                      selectedAwardIds.includes(record.id),
                    )
                  : displayedRecords
                )
                  .slice(0, 5)
                  .map((record) => (
                    <div key={record.id}>
                      <strong>{record.organization}</strong>
                      <span>
                        {formatDate(record.activityDate)} · {record.awardStage || "미정"}
                      </span>
                    </div>
                  ))}
                {(awardDeleteScope === "selected"
                  ? selectedAwardIds.length
                  : displayedRecords.length) > 5 && (
                  <p>
                    외 {(awardDeleteScope === "selected"
                      ? selectedAwardIds.length
                      : displayedRecords.length) - 5}건
                  </p>
                )}
              </div>
              <label className="award-delete-safety-check">
                <input
                  type="checkbox"
                  checked={awardDeleteSafetyChecked}
                  disabled={awardDeleteBusy}
                  onChange={(event) =>
                    setAwardDeleteSafetyChecked(event.target.checked)
                  }
                />
                <span>
                  삭제 범위와 휴지통 이동 내용을 확인했습니다.
                </span>
              </label>
              <label className="award-delete-confirmation">
                <span>아래에 ‘삭제’를 입력해 주세요.</span>
                <input
                  value={awardDeleteConfirmation}
                  disabled={awardDeleteBusy}
                  onChange={(event) =>
                    setAwardDeleteConfirmation(event.target.value)
                  }
                  placeholder="삭제"
                  autoComplete="off"
                />
              </label>
            </div>
            <footer className="institution-merge-actions award-delete-actions">
              <button
                type="button"
                disabled={awardDeleteBusy}
                onClick={closeAwardDelete}
              >
                취소
              </button>
              <button
                type="button"
                className="danger"
                disabled={
                  awardDeleteBusy ||
                  !awardDeleteSafetyChecked ||
                  awardDeleteConfirmation.trim() !== "삭제"
                }
                onClick={() => void deleteAwardRecords()}
              >
                {awardDeleteBusy ? "휴지통으로 이동 중…" : "확인 후 삭제"}
              </button>
            </footer>
          </aside>
        </div>
      )}

      <JointProjectModal
        open={jointProjectOpen}
        candidates={selectedJointProjectCandidates}
        availableSponsors={jointProjectSponsorOptions}
        budgetGroupId={
          selectedJointProjectCandidates.length
            ? records.find(
                (record) => record.id === selectedJointProjectCandidates[0]?.activityId,
              )?.budgetGroupId ?? null
            : null
        }
        budgetType={
          selectedJointProjectCandidates.find((item) => item.budgetType)
            ?.budgetType ?? ""
        }
        initialProjectYear={
          Number(
            records
              .find(
                (record) =>
                  record.id === selectedJointProjectCandidates[0]?.activityId,
              )
              ?.activityDate.slice(0, 4),
          ) || new Date().getFullYear()
        }
        onClose={() => {
          setJointProjectOpen(false);
          setJointProjectSeedCandidates(null);
        }}
        onSaved={async () => {
          await loadRecords("full");
          setSelectedInstitutionIds([]);
          setSelectedAwardIds([]);
          setJointProjectSeedCandidates(null);
          setToast("공동사업 관계를 연결했습니다. 기관별 원래 기록은 그대로 유지됩니다.");
        }}
      />

      {institutionMergePreview && (
        <div
          className="modal-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="institution-merge-title"
        >
          <button
            className="modal-backdrop"
            aria-label="기관 합치기 창 닫기"
            disabled={institutionMergeBusy}
            onClick={() => {
              setInstitutionMergePreview(null);
              setInstitutionMergeTarget("");
              setInstitutionMergeResolutions({});
            }}
          />
          <aside className="record-modal institution-merge-modal">
            <div className="modal-header">
              <div>
                <span className="section-kicker">INSTITUTION MERGE</span>
                <h2 id="institution-merge-title">두 기관 합치기</h2>
              </div>
              <button
                type="button"
                className="close-button"
                disabled={institutionMergeBusy}
                onClick={() => {
                  setInstitutionMergePreview(null);
                  setInstitutionMergeTarget("");
                  setInstitutionMergeResolutions({});
                }}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="institution-merge-body">
              <div className="institution-merge-guide">
                <strong>최종으로 사용할 기관명을 선택해 주세요.</strong>
                <p>
                  선택한 {institutionMergePreview.organizations.length}개 기관의
                  영업 기록·지도 위치·수주 사업·AI 제안을 한곳으로 모으고,
                  합쳐진 이름은 별칭으로 기억하며, 동명 기관이 있으면 지역
                  정보를 함께 확인합니다.
                </p>
              </div>
              <div className="institution-merge-options">
                {institutionMergePreview.organizations.map((item) => (
                  <label
                    className={
                      institutionMergeTarget === item.organization
                        ? "selected"
                        : ""
                    }
                    key={item.organization}
                  >
                    <input
                      type="radio"
                      name="institution-merge-target"
                      value={item.organization}
                      checked={institutionMergeTarget === item.organization}
                      disabled={institutionMergeBusy}
                      onChange={() => {
                        setInstitutionMergeTarget(item.organization);
                        setInstitutionMergeResolutions((current) =>
                          Object.fromEntries(
                            institutionMergePreview.conflicts.map(
                              (conflict) => [
                                conflict.key,
                                conflict.options.find(
                                  (option) =>
                                    option.organization === item.organization,
                                )?.value ||
                                  current[conflict.key] ||
                                  conflict.recommendedValue,
                              ],
                            ),
                          ),
                        );
                      }}
                    />
                    <span>
                      <b>{item.organization}</b>
                      <small>
                        영업 기록 {item.activityCount}건 · 수주 사업{" "}
                        {item.equipmentProjectCount}건 · AI 제안{" "}
                        {item.recommendationCount}건
                      </small>
                      <small>
                        지도{" "}
                        {item.hasLocation
                          ? item.locationAddress ||
                            item.locationRegion ||
                            "위치 등록"
                          : "없음"}{" "}
                        · 담당 이력 {item.assignmentHistoryCount}건 · 알림{" "}
                        {item.managerAlertCount}건 · 견적 {item.quotationCount}건
                      </small>
                    </span>
                    <em>
                      {institutionMergeTarget === item.organization
                        ? "최종 기관명"
                        : "이 이름으로 선택"}
                    </em>
                  </label>
                ))}
              </div>
              {(institutionMergePreview.autoFilledFields.length > 0 ||
                institutionMergePreview.conflicts.length > 0) && (
                <section className="institution-merge-conflicts">
                  <div className="institution-merge-conflict-heading">
                    <strong>합친 뒤 사용할 정보 확인</strong>
                    <p>
                      한쪽만 입력된 값은 자동으로 채우고, 서로 다른 값만
                      선택받습니다. 과거 영업 기록과 담당자 연락처는 모두
                      보존됩니다.
                    </p>
                  </div>
                  {institutionMergePreview.autoFilledFields.length > 0 && (
                    <div className="institution-merge-autofill">
                      <b>자동 보완</b>
                      <span>
                        {institutionMergePreview.autoFilledFields.join(", ")}
                      </span>
                    </div>
                  )}
                  {institutionMergePreview.conflicts.map((conflict) => (
                    <label
                      className="institution-merge-conflict"
                      key={conflict.key}
                    >
                      <span>
                        <b>{conflict.label}</b>
                        {conflict.businessRound !== null && (
                          <small>{conflict.businessRound}차 사업</small>
                        )}
                      </span>
                      <select
                        value={
                          institutionMergeResolutions[conflict.key] ||
                          conflict.recommendedValue
                        }
                        disabled={institutionMergeBusy}
                        onChange={(event) =>
                          setInstitutionMergeResolutions((current) => ({
                            ...current,
                            [conflict.key]: event.target.value,
                          }))
                        }
                      >
                        {conflict.options.map((option) => (
                          <option value={option.value} key={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </section>
              )}
              {institutionMergeTarget && (
                <div className="institution-merge-result">
                  <span>병합 결과</span>
                  <strong>
                    {institutionMergePreview.organizations
                      .filter(
                        (item) => item.organization !== institutionMergeTarget,
                      )
                      .slice(0, 2)
                      .map((item) => item.organization)
                      .join(", ")}
                    {institutionMergePreview.organizations.length > 3
                      ? ` 외 ${institutionMergePreview.organizations.length - 3}곳`
                      : ""}{" "}
                    → {institutionMergeTarget}
                  </strong>
                  <p>
                    기록은 삭제하지 않고 모두 보존하며, 앞으로 두 이름을 같은
                    기관으로 인식합니다.
                  </p>
                </div>
              )}
            </div>
            <footer className="institution-merge-actions">
              <button
                type="button"
                disabled={institutionMergeBusy}
                onClick={() => {
                  setInstitutionMergePreview(null);
                  setInstitutionMergeTarget("");
                  setInstitutionMergeResolutions({});
                }}
              >
                취소
              </button>
              <button
                type="button"
                className="primary"
                disabled={!institutionMergeTarget || institutionMergeBusy}
                onClick={() => void mergeSelectedInstitutions()}
              >
                {institutionMergeBusy
                  ? "안전하게 합치는 중…"
                  : `${institutionMergePreview.organizations.length}개 기관 합치기`}
              </button>
            </footer>
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
              <div className="modal-header-actions">
                {editingId && (() => {
                  const record = records.find((item) => item.id === editingId);
                  return record && hasActivityDetail(record) ? (
                    <button
                      type="button"
                      className="record-detail-return-button"
                      onClick={() => setSelectedActivityDetail(record)}
                    >
                      상세 기록 보기
                    </button>
                  ) : null;
                })()}
                {editingId && editReturnOrganization && (
                  <button
                    type="button"
                    className="record-detail-return-button secondary"
                    onClick={returnFromEditToDetail}
                  >
                    기관 상세로 돌아가기
                  </button>
                )}
                <button type="button" className="close-button" onClick={() => setModalOpen(false)} aria-label="닫기">×</button>
              </div>
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
                      <h3>
                        {googleSheetOpen
                          ? "구글 시트에서 수주 기관 불러오기"
                          : "엑셀로 새 기록 한 번에 등록"}
                      </h3>
                      <p>
                        {googleSheetOpen
                          ? "공유 링크를 붙여넣으면 기관별로 묶고 중복·날짜 누락을 먼저 확인합니다. 원본 시트는 수정하지 않습니다."
                          : "제공된 양식에 기록을 작성한 뒤 올려주세요. 저장 전에 오류와 중복 가능성을 먼저 확인합니다."}
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
                      onClick={creatingAward ? downloadAwardTemplate : downloadActivityTemplate}
                    >
                      <b aria-hidden="true">↓</b>
                      <span>
                        <strong>{creatingAward ? "수주관리 엑셀 양식 다운로드" : "엑셀 양식 다운로드"}</strong>
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
                        <small>.xlsx 또는 .csv · 최대 5,000건</small>
                      </span>
                    </button>
                    <input
                      ref={activityImportInputRef}
                      type="file"
                      accept=".xlsx,.csv"
                      hidden
                      onChange={(event) => void handleActivityImportFile(event)}
                    />
                    {creatingAward && (
                      <button
                        type="button"
                        className={`activity-google-sheet-select ${googleSheetOpen ? "active" : ""}`}
                        onClick={() => setGoogleSheetOpen((current) => !current)}
                      >
                        <b aria-hidden="true">G</b>
                        <span>
                          <strong>구글 시트 링크 연결</strong>
                          <small>공유 링크 분석 · 기관별 중복 정리</small>
                        </span>
                      </button>
                    )}
                  </section>

                  {creatingAward && googleSheetOpen && (
                    <section className="google-sheet-connect-panel">
                      <div className="google-sheet-connect-copy">
                        <span>GOOGLE SHEETS</span>
                        <strong>링크를 붙여넣고 등록 전 목록을 확인하세요</strong>
                        <small>
                          링크가 있는 모든 사용자가 볼 수 있는 시트만 읽을 수 있습니다.
                        </small>
                      </div>
                      <div className="google-sheet-connect-form">
                        <label>
                          <span className="sr-only">구글 시트 공유 링크</span>
                          <input
                            type="url"
                            value={googleSheetUrl}
                            onChange={(event) => setGoogleSheetUrl(event.target.value)}
                            placeholder="https://docs.google.com/spreadsheets/d/..."
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void analyzeGoogleSheet();
                              }
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={googleSheetLoading || !googleSheetUrl.trim()}
                          onClick={() => void analyzeGoogleSheet()}
                        >
                          {googleSheetLoading ? "분석 중…" : "시트 분석하기"}
                        </button>
                      </div>
                      {googleSheetAnalysis && (
                        <div className="google-sheet-analysis-summary">
                          <span>
                            원본 행 <b>{googleSheetAnalysis.stats.sourceRowCount.toLocaleString("ko-KR")}</b>
                          </span>
                          <span className="ready">
                            기관별 정리 <b>{googleSheetAnalysis.stats.institutionCount.toLocaleString("ko-KR")}</b>
                          </span>
                          <span>
                            중복 제외 <b>{googleSheetAnalysis.stats.duplicateRowCount.toLocaleString("ko-KR")}</b>
                          </span>
                          <span className="warning">
                            날짜 확인 <b>{(googleSheetAnalysis.stats.missingDateCount + googleSheetAnalysis.stats.invalidDateCount).toLocaleString("ko-KR")}</b>
                          </span>
                        </div>
                      )}
                    </section>
                  )}

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
                          {creatingAward
                            ? "중복 제외 전체 선택"
                            : "정상 기록만 다시 선택"}
                        </button>
                      </header>
                      {creatingAward && (
                        <div className="activity-import-company-tool">
                          <div>
                            <span>선택 행 수주업체 일괄 적용</span>
                            <strong>
                              엑셀에 입력된 업체는 유지하고, 빈칸만 안전하게 채울 수 있습니다.
                            </strong>
                          </div>
                          <input
                            list="partner-award-company-options"
                            value={activityImportAwardCompany}
                            onChange={(event) =>
                              setActivityImportAwardCompany(event.target.value)
                            }
                            placeholder="등록 협력사 검색 또는 새 업체명 직접 입력"
                          />
                          <button
                            type="button"
                            className="primary"
                            onClick={() => applyActivityImportAwardCompany("empty")}
                          >
                            빈칸에만 적용
                          </button>
                          <button
                            type="button"
                            onClick={() => applyActivityImportAwardCompany("overwrite")}
                          >
                            선택 행 전체 변경
                          </button>
                          {activityImportAwardCompany.trim() &&
                            classifyAwardCompany(
                              activityImportAwardCompany,
                              registeredPartnerNames,
                            ) === "other" && (
                              <button
                                type="button"
                                className="register-partner"
                                onClick={() =>
                                  openPartnerCompanyManager(
                                    activityImportAwardCompany,
                                  )
                                }
                              >
                                이 업체를 협력사로 등록
                              </button>
                            )}
                        </div>
                      )}
                      <div className="activity-import-counts">
                        <span className="ready">
                          저장 선택 <b>{selectedActivityImportCount}</b>건
                        </span>
                        <span className="error">
                          {creatingAward ? "자동 보완" : "오류"}{" "}
                          <b>
                            {creatingAward
                              ? activityImportAutoFillCount
                              : activityImportErrorCount}
                          </b>
                          건
                        </span>
                        <span className="duplicate">
                          기존 중복 제외 <b>{activityImportDuplicateCount}</b>건
                        </span>
                        {creatingAward && activityImportMergedCount > 0 && (
                          <span className="merged">
                            업로드 중복 합침 <b>{activityImportMergedCount}</b>건
                          </span>
                        )}
                      </div>
                      <p className="activity-import-note">
                        {creatingAward
                          ? "같은 기관·수주연월·수주업체의 기록은 설치물품을 모아 한 건으로 합치고, 기존 중복은 자동 제외합니다. 비어 있는 필수값은 저장 시 안전한 기본값으로 보완합니다."
                          : "중복 의심 기록은 기본적으로 제외됩니다. 꼭 필요한 기록이면 행의 체크박스를 다시 선택할 수 있습니다."}
                      </p>
                      <div className="activity-import-table-wrap">
                        <table
                          className={`activity-import-table ${
                            creatingAward ? "award-import-table" : ""
                          }`}
                        >
                          <thead>
                            <tr>
                              <th>
                                {creatingAward ? (
                                  <input
                                    type="checkbox"
                                    aria-label="등록 가능한 수주 기록 전체 선택"
                                    checked={allActivityImportRowsSelected}
                                    onChange={(event) =>
                                      toggleAllActivityImportRows(
                                        event.target.checked,
                                      )
                                    }
                                  />
                                ) : (
                                  "저장"
                                )}
                              </th>
                              <th>행</th>
                              <th>{creatingAward ? "수주연월" : "활동일자"}</th>
                              {creatingAward && <th>지역</th>}
                              <th>기관명</th>
                              <th>원문 예산</th>
                              <th>표준 예산</th>
                              <th>판정</th>
                              {creatingAward ? (
                                <>
                                  <th>주소</th>
                                  <th>설치물품</th>
                                  <th>예산금액(참고)</th>
                                  <th>수주업체</th>
                                </>
                              ) : (
                                <>
                                  <th>상담 내용</th>
                                </>
                              )}
                              <th>검토 결과</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleActivityImportRows.map((row) => (
                              <tr
                                key={row.rowNumber}
                                className={
                                  row.errors.length
                                    ? "has-error"
                                    : row.duplicate
                                      ? "has-duplicate"
                                      : row.budgetMatchStatus === "review"
                                        ? "has-budget-review"
                                      : ""
                                }
                              >
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={`${row.rowNumber}행 저장 선택`}
                                    checked={row.selected}
                                    disabled={
                                      row.duplicate ||
                                      row.budgetMatchStatus === "review" ||
                                      (creatingAward
                                        ? !row.values.organization.trim()
                                        : row.errors.length > 0)
                                    }
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
                                <td>
                                  {googleSheetAnalysis ? (
                                    <input
                                      className="activity-import-date-input"
                                      type="date"
                                      value={row.values.activityDate}
                                      aria-label={`${row.values.organization} 계약 일자`}
                                      onChange={(event) =>
                                        updateGoogleSheetImportDate(
                                          row.rowNumber,
                                          event.target.value,
                                        )
                                      }
                                    />
                                  ) : (
                                    creatingAward
                                      ? row.values.activityDate.slice(0, 7) || "자동"
                                      : row.values.activityDate || "—"
                                  )}
                                </td>
                                {creatingAward && (
                                  <td>{row.values.region || "—"}</td>
                                )}
                                <td><strong>{row.values.organization || "—"}</strong></td>
                                <td>{row.budgetOriginalName || "입력 없음"}</td>
                                <td>
                                  <strong>
                                    {row.budgetResolvedName ||
                                      (row.budgetMatchStatus === "review"
                                        ? "선택 전"
                                        : "미분류")}
                                  </strong>
                                  {["review", "unclassified"].includes(
                                    row.budgetMatchStatus,
                                  ) && (
                                    <select
                                      className="budget-import-select"
                                      aria-label={`${row.rowNumber}행 표준 예산명 선택`}
                                      value={row.budgetGroupId ?? 0}
                                      onChange={(event) =>
                                        updateActivityImportBudget(
                                          row.rowNumber,
                                          Number(event.target.value),
                                        )
                                      }
                                    >
                                      <option value={0}>미분류로 저장</option>
                                      {budgetReviewCatalog.map((option) => (
                                        <option
                                          key={option.id}
                                          value={option.id}
                                        >
                                          {option.canonicalName}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </td>
                                <td>
                                  <span
                                    className={`budget-match-badge ${row.budgetMatchStatus}`}
                                  >
                                    {budgetMatchStatusLabel(
                                      row.budgetMatchStatus,
                                    )}
                                  </span>
                                  <small className="budget-match-method">
                                    {row.budgetMatchMethod}
                                  </small>
                                  {row.budgetCandidates.length > 0 && (
                                    <small className="budget-match-candidates">
                                      후보 {row.budgetCandidates.join(", ")}
                                    </small>
                                  )}
                                </td>
                                {creatingAward ? (
                                  <>
                                    <td><span>{row.values.address || "—"}</span></td>
                                    <td><span>{row.values.installedProducts || "—"}</span></td>
                                    <td>{row.values.budgetAmount || "—"}</td>
                                    <td>{row.values.awardCompany || "미등록"}</td>
                                  </>
                                ) : (
                                  <>
                                    <td><span>{row.values.summary || "—"}</span></td>
                                  </>
                                )}
                                <td>
                                  {row.syncAction === "update" && (
                                    <span className="activity-import-sync-badge update">
                                      기존 기록 갱신
                                    </span>
                                  )}
                                  {row.syncAction === "unchanged" && (
                                    <span className="activity-import-sync-badge unchanged">
                                      이미 최신
                                    </span>
                                  )}
                                  {row.saveState === "saving" ? (
                                    <small>저장 중입니다.</small>
                                  ) : row.saveState === "failed" ? (
                                    <em>{row.saveError || "저장하지 못했습니다."}</em>
                                  ) : creatingAward && row.duplicate ? (
                                    <em>기존 기록과 중복되어 자동 제외됩니다.</em>
                                  ) : creatingAward && row.values.organization.trim() ? (
                                    <small>
                                      {row.warnings.length
                                        ? row.warnings.join(" ")
                                        : "등록 가능 · 수주업체 자동 분류"}
                                    </small>
                                  ) : row.errors.length > 0 ? (
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
                      {activityImportPageCount > 1 && (
                        <nav
                          className="activity-import-pagination"
                          aria-label="엑셀 미리보기 페이지"
                        >
                          <button
                            type="button"
                            disabled={activityImportPage <= 1}
                            onClick={() =>
                              setActivityImportPage((current) =>
                                Math.max(1, current - 1),
                              )
                            }
                          >
                            이전 500건
                          </button>
                          <span>
                            {activityImportPage} / {activityImportPageCount}페이지
                            · 전체 {activityImportRows.length.toLocaleString()}건
                          </span>
                          <button
                            type="button"
                            disabled={activityImportPage >= activityImportPageCount}
                            onClick={() =>
                              setActivityImportPage((current) =>
                                Math.min(activityImportPageCount, current + 1),
                              )
                            }
                          >
                            다음 500건
                          </button>
                        </nav>
                      )}
                    </section>
                  )}
                </div>
              ) : (
                <>
              <div className="form-section-title"><span>01</span><strong>기본 정보</strong></div>
              <div className="form-grid">
                <label className="span-2">
                  <span>기관·파트너명 *</span>
                  <BufferedInput
                    required
                    value={form.organization}
                    readOnly={Boolean(inheritedFormOrganization)}
                    onCommit={updateFormOrganization}
                    onBlur={(event) => {
                      if (!inheritedFormOrganization) {
                        inheritLatestInstitutionDetails(
                          event.currentTarget.value,
                          form.region,
                        );
                      }
                    }}
                    placeholder="예: 창경초등학교"
                  />
                  {inheritedFormOrganization && (
                    <small className="automatic-field-note">
                      새 사업은 {inheritedFormOrganization}에 추가됩니다. 기관명은 여기서
                      변경할 수 없으며, 같은 사업 차수의 기존 예산과 비어 있는 정보를 불러왔습니다.
                    </small>
                  )}
                </label>
                <label><span>활동 날짜</span><input type="date" value={form.activityDate.length === 10 ? form.activityDate : ""} onChange={(event) => setForm({ ...form, activityDate: event.target.value })} /></label>
                <div className="activity-region-field">
                  <span className="activity-region-label">지역</span>
                  <div className="activity-region-summary">
                    <div>
                      <strong>{form.region.trim() || "자동 확인"}</strong>
                      <small>
                        {form.region.trim()
                          ? "확인된 지역입니다. 필요할 때만 수정하세요."
                          : "저장할 때 기존 기관·지도 주소에서 자동으로 확인합니다."}
                      </small>
                    </div>
                    <details className="activity-region-manual">
                      <summary>{form.region.trim() ? "지역 수정" : "직접 입력"}</summary>
                      <BufferedInput
                        aria-label="지역 직접 입력"
                        value={form.region}
                        onCommit={(region) => {
                          setForm((current) => ({ ...current, region }));
                          inheritLatestInstitutionDetails(form.organization, region);
                        }}
                        placeholder="예: 경기 성남, 충북 청주"
                      />
                    </details>
                  </div>
                </div>
              </div>

              <div className="form-section-title"><span>02</span><strong>상담 내용</strong></div>
              <div className="form-grid">
                <section className="activity-budget-editor span-2">
                  <div className="activity-budget-editor-heading">
                    <div>
                      <strong>이 사업에 사용하는 예산</strong>
                      <small>
                        같은 사업 차수에 예산이 여러 개면 사업을 나누지 않고 예산만 추가합니다.
                      </small>
                    </div>
                    <button type="button" onClick={addActivityBudget}>
                      + 예산 추가
                    </button>
                  </div>
                  <div className="activity-budget-rows">
                    {form.budgets.map((budget, index) => {
                      const isPrimary = index === 0;
                      const usesQuoteAuto =
                        form.budgets.length === 1 &&
                        isPrimary &&
                        normalizeBudgetKind(budget.budgetKind) === "self" &&
                        normalizeBudgetAmountMode(budget.budgetAmountMode) ===
                          "quote_auto";
                      const usesManual =
                        !usesQuoteAuto ||
                        (budget.budgetAmountSource === "manual" &&
                          hasExplicitBudgetAmount(
                            budget.budgetAmountOverride || budget.budgetAmount,
                          ));
                      return (
                        <div className="activity-budget-row" key={`${index}-${budget.budgetGroupId ?? budget.budgetType}`}>
                          <div className="activity-budget-row-title">
                            <strong>{index + 1}번째 예산</strong>
                            {isPrimary && <span>대표 예산</span>}
                            {form.budgets.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeActivityBudget(index)}
                              >
                                삭제
                              </button>
                            )}
                          </div>
                          <div className="activity-budget-row-fields">
                            <div className="budget-form-field">
                              <span>예산명</span>
                              <BudgetNameSelector
                                value={budget}
                                organization={form.organization}
                                activityId={editingId}
                                onChange={(selection) =>
                                  updateBudgetSelection(selection, index)
                                }
                                onToast={setToast}
                                standardOnly
                              />
                            </div>
                            <div className="budget-form-field budget-amount-field">
                              <span>예산금액</span>
                              {usesQuoteAuto && !usesManual ? (
                                <div
                                  className={`budget-auto-amount ${
                                    formBudgetQuoteAmount !== null
                                      ? "ready"
                                      : "missing"
                                  }`}
                                >
                                  <strong>
                                    {formBudgetQuoteAmount !== null
                                      ? `${formBudgetQuoteAmount.toLocaleString("ko-KR")}원`
                                      : "품목·견적 미등록"}
                                  </strong>
                                  <small>
                                    {formBudgetQuoteAmount !== null
                                      ? `등록된 품목·견적 ${formBudgetQuoteSummary?.quoteItemCount ?? 0}건의 합계입니다.`
                                      : "품목·견적 관리에 금액을 등록하면 자동 반영됩니다."}
                                  </small>
                                  <button type="button" onClick={switchBudgetAmountToManual}>
                                    직접 입력으로 전환
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <BufferedInput
                                    inputMode="decimal"
                                    value={budget.budgetAmount}
                                    onCommit={(rawAmount) =>
                                      updateActivityBudgetAmount(index, rawAmount)
                                    }
                                    placeholder="예: 2,480만원"
                                  />
                                  <small>
                                    {form.budgets.length > 1
                                      ? "예산별 사용 금액을 입력하면 통계에서 계약금액을 비율로 나눠 표시합니다."
                                      : normalizeBudgetKind(budget.budgetKind) === "self"
                                        ? "이 예산에 사용할 금액을 입력해 주세요."
                                        : "이 예산에 사용할 금액을 입력해 주세요."}
                                  </small>
                                  {form.budgets.length === 1 &&
                                    normalizeBudgetKind(budget.budgetKind) === "self" && (
                                      <button
                                        type="button"
                                        className="budget-recalculate-button"
                                        onClick={recalculateBudgetFromQuote}
                                      >
                                        품목 합계로 다시 계산
                                      </button>
                                    )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <small className="activity-budget-editor-note">
                    관리자에 등록된 활성 표준 예산명만 선택할 수 있습니다. 복수 예산이어도 계약금액은 한 번만 집계됩니다.
                  </small>
                </section>
                <label className="span-2"><span>내용 요약</span><BufferedTextarea rows={3} value={form.summary} onCommit={(summary) => setForm((current) => ({ ...current, summary }))} placeholder="통화나 미팅에서 논의한 핵심 내용을 입력하세요." /></label>
              </div>

              <div className="form-section-title"><span>03</span><strong>후속 관리</strong></div>
              <div className="form-grid">
                <label className="toggle-label span-2"><input type="checkbox" checked={form.followUpRequired} onChange={(event) => setForm({ ...form, followUpRequired: event.target.checked })} /><span className="toggle" /><span>재연락이 필요한 기록으로 표시</span></label>
                <label><span>재연락 예정일</span><input type="date" disabled={!form.followUpRequired} value={form.followUpDate} onChange={(event) => setForm({ ...form, followUpDate: event.target.value })} /></label>
                <label><span>다음 행동</span><BufferedInput value={form.nextAction} onCommit={(nextAction) => setForm((current) => ({ ...current, nextAction }))} placeholder="예: 견적서 발송 후 전화" /></label>
                <section className="institution-contact-editor span-2">
                  <header>
                    <div>
                      <strong>기관 담당자</strong>
                      <span>담당자가 여러 명이면 사람별로 연락처를 나눠 입력해 주세요.</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          contacts: [
                            ...current.contacts,
                            emptyInstitutionContact(current.contacts.length === 0),
                          ],
                        }))
                      }
                    >
                      + 담당자 추가
                    </button>
                  </header>
                  {form.contacts.map((contact, index) => (
                    <div className="institution-contact-card" key={`contact-${index}`}>
                      <div className="institution-contact-card-heading">
                        <label>
                          <input
                            type="radio"
                            name="primary-institution-contact"
                            checked={contact.primary}
                            onChange={() =>
                              setForm((current) => ({
                                ...current,
                                contacts: current.contacts.map((item, itemIndex) => ({
                                  ...item,
                                  primary: itemIndex === index,
                                })),
                              }))
                            }
                          />
                          주 담당자
                        </label>
                        <button
                          type="button"
                          className="delete"
                          onClick={() =>
                            setForm((current) => {
                              const remaining = current.contacts.filter(
                                (_, itemIndex) => itemIndex !== index,
                              );
                              const contacts = remaining.length
                                ? remaining.map((item, itemIndex) => ({
                                    ...item,
                                    primary:
                                      item.primary ||
                                      (!remaining.some((entry) => entry.primary) &&
                                        itemIndex === 0),
                                  }))
                                : [emptyInstitutionContact(true)];
                              return { ...current, contacts };
                            })
                          }
                        >
                          삭제
                        </button>
                      </div>
                      <label>
                        <span>담당 역할</span>
                        <input
                          value={contact.role}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              contacts: current.contacts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, role: event.target.value }
                                  : item,
                              ),
                            }))
                          }
                          placeholder="예: 교감, 공사 담당자"
                        />
                      </label>
                      <label>
                        <span>이름·직책</span>
                        <input
                          value={contact.name}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              contacts: current.contacts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, name: event.target.value }
                                  : item,
                              ),
                            }))
                          }
                          placeholder="예: 신동빈 선생님"
                        />
                      </label>
                      <label>
                        <span>전화번호</span>
                        <input
                          value={contact.phone}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              contacts: current.contacts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, phone: event.target.value }
                                  : item,
                              ),
                            }))
                          }
                          placeholder="010-0000-0000"
                        />
                      </label>
                      <label>
                        <span>이메일</span>
                        <input
                          type="email"
                          value={contact.email}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              contacts: current.contacts.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, email: event.target.value }
                                  : item,
                              ),
                            }))
                          }
                          placeholder="name@example.com"
                        />
                      </label>
                    </div>
                  ))}
                </section>
                <label className="span-2"><span>추가 메모</span><BufferedTextarea rows={2} value={form.notes} onCommit={(notes) => setForm((current) => ({ ...current, notes }))} /></label>
              </div>

              {(editingId || hasActivityDetailDraft(form)) && (
                <>
                  <div className="form-section-title"><span>04</span><strong>상세 기록</strong></div>
                  <div className="form-grid">
                    <section className="activity-detail-editor span-2">
                      <header>
                        <div>
                          <strong>AI 상세 기록 수정</strong>
                          <small>
                            AI가 정리한 상세 내용도 담당자가 확인하고 바로 고칠 수 있습니다.
                          </small>
                        </div>
                      </header>
                      <label>
                        <span>핵심 요약</span>
                        <textarea
                          rows={5}
                          value={form.detailSummary}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              detailSummary: event.target.value,
                            }))
                          }
                          placeholder="상세 기록에서 가장 먼저 보여줄 핵심 내용을 입력하세요."
                        />
                      </label>

                      <div className="activity-detail-editor-group">
                        <div className="activity-detail-editor-group-heading">
                          <div>
                            <strong>핵심 정보</strong>
                            <small>
                              총예산·예산명은 위 예산 항목에서 자동 반영하고, 나머지 정보만 관리합니다.
                            </small>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                detailKeyFacts: [
                                  ...current.detailKeyFacts,
                                  { label: "", value: "" },
                                ],
                              }))
                            }
                          >
                            + 항목 추가
                          </button>
                        </div>
                        <div className="activity-detail-fact-editor-list">
                          {form.detailKeyFacts.map((fact, index) => ({ fact, index }))
                            .filter(({ fact }) => !isDerivedBudgetDetailFact(fact.label))
                            .map(({ fact, index }) => (
                            <div className="activity-detail-fact-editor" key={`detail-fact-${index}`}>
                              <input
                                value={fact.label}
                                onChange={(event) =>
                                  setForm((current) => ({
                                    ...current,
                                    detailKeyFacts: current.detailKeyFacts.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, label: event.target.value }
                                        : item,
                                    ),
                                  }))
                                }
                                placeholder="항목명"
                                aria-label={`${index + 1}번째 핵심 정보 항목명`}
                              />
                              <textarea
                                rows={2}
                                value={fact.value}
                                onChange={(event) =>
                                  setForm((current) => ({
                                    ...current,
                                    detailKeyFacts: current.detailKeyFacts.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, value: event.target.value }
                                        : item,
                                    ),
                                  }))
                                }
                                placeholder="내용"
                                aria-label={`${index + 1}번째 핵심 정보 내용`}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setForm((current) => ({
                                    ...current,
                                    detailKeyFacts: current.detailKeyFacts.filter(
                                      (_, itemIndex) => itemIndex !== index,
                                    ),
                                  }))
                                }
                              >
                                삭제
                              </button>
                            </div>
                          ))}
                          {form.detailKeyFacts.every((fact) =>
                            isDerivedBudgetDetailFact(fact.label),
                          ) && (
                            <p className="activity-detail-editor-empty">
                              등록된 핵심 정보가 없습니다. 필요한 항목만 추가해 주세요.
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="activity-detail-editor-group">
                        <div className="activity-detail-editor-group-heading">
                          <div>
                            <strong>상세 항목</strong>
                            <small>한 줄에 한 항목씩 입력하면 상세 보기에서 목록으로 표시됩니다.</small>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                detailSections: [
                                  ...current.detailSections,
                                  { title: "", items: [] },
                                ],
                              }))
                            }
                          >
                            + 구역 추가
                          </button>
                        </div>
                        <div className="activity-detail-section-editor-list">
                          {form.detailSections.map((section, index) => ({ section, index }))
                            .filter(({ section }) =>
                              !isDerivedBudgetDetailSection(section.title),
                            )
                            .map(({ section, index }) => (
                            <div className="activity-detail-section-editor" key={`detail-section-${index}`}>
                              <div>
                                <input
                                  value={section.title}
                                  onChange={(event) =>
                                    setForm((current) => ({
                                      ...current,
                                      detailSections: current.detailSections.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, title: event.target.value }
                                          : item,
                                      ),
                                    }))
                                  }
                                  placeholder="예: 구축 방향"
                                  aria-label={`${index + 1}번째 상세 구역 제목`}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setForm((current) => ({
                                      ...current,
                                      detailSections: current.detailSections.filter(
                                        (_, itemIndex) => itemIndex !== index,
                                      ),
                                    }))
                                  }
                                >
                                  삭제
                                </button>
                              </div>
                              <textarea
                                rows={4}
                                value={section.items.join("\n")}
                                onChange={(event) => {
                                  const items = event.target.value.split("\n");
                                  setForm((current) => ({
                                    ...current,
                                    detailSections: current.detailSections.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, items } : item,
                                    ),
                                  }));
                                }}
                                placeholder={"첫 번째 내용\n두 번째 내용"}
                                aria-label={`${index + 1}번째 상세 구역 내용`}
                              />
                            </div>
                          ))}
                          {form.detailSections.every((section) =>
                            isDerivedBudgetDetailSection(section.title),
                          ) && (
                            <p className="activity-detail-editor-empty">
                              등록된 상세 항목이 없습니다. 필요한 구역만 추가해 주세요.
                            </p>
                          )}
                        </div>
                      </div>

                      {form.rawInput && (
                        <details className="activity-detail-editor-raw">
                          <summary>AI 정리 전 원문 보기</summary>
                          <pre>{form.rawInput}</pre>
                        </details>
                      )}
                    </section>
                  </div>
                </>
              )}

              <div className="form-section-title"><span>{editingId || hasActivityDetailDraft(form) ? "05" : "04"}</span><strong>수주 결과</strong></div>
              <div className="form-grid">
                <label>
                  <span>사업방식</span>
                  <select
                    disabled={form.awardStatus === "타업체 수주"}
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
                    <option>해당 없음</option>
                  </select>
                  {form.awardStatus === "타업체 수주" && (
                    <small className="automatic-field-note">
                      타업체 수주 건에는 적용되지 않습니다.
                    </small>
                  )}
                </label>
                <label>
                  <span>컨소 업체명</span>
                  <BufferedInput
                    required={form.executionType === "컨소"}
                    disabled={form.executionType !== "컨소"}
                    value={form.consortiumCompany}
                    onCommit={(consortiumCompany) => setForm((current) => ({
                      ...current,
                      consortiumCompany,
                      executionType: consortiumCompany.trim() ? "컨소" : "직영",
                    }))}
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
                        statusManual: false,
                        status:
                          ["위즈업 수주", "협력사 수주"].includes(awardStatus)
                            ? "수주 전환"
                            : awardStatus === "타업체 수주"
                              ? "영업 종료"
                              : form.status === "수주 후 진행" ||
                                  form.status === "수주 전환" ||
                                  form.status === "영업 종료"
                                ? "상담 진행"
                                : form.status,
                        awardCompany:
                          awardStatus === "위즈업 수주"
                            ? "위즈업"
                            : awardStatus === "미정" ||
                                form.awardCompany === "위즈업"
                              ? ""
                              : form.awardCompany,
                        executionType:
                          awardStatus === "타업체 수주"
                            ? "해당 없음"
                            : form.executionType === "해당 없음"
                              ? "직영"
                              : form.executionType,
                        consortiumCompany:
                          awardStatus === "타업체 수주"
                            ? ""
                            : form.consortiumCompany,
                        awardStage:
                          awardStatus === "위즈업 수주"
                            ? "설치·공사 진행"
                            : awardStatus === "타업체 수주"
                            ? "해당 없음"
                            : form.awardStage === "타업체 수주 종료" ||
                                form.awardStage === "해당 없음"
                              ? "미정"
                              : form.awardStage,
                        progressManager:
                          awardStatus === "협력사 수주"
                            ? "해당 없음"
                            : form.progressManager === "해당 없음"
                              ? ""
                              : form.progressManager,
                      });
                    }}
                  >
                    <option>미정</option>
                    <option>위즈업 수주</option>
                    <option>협력사 수주</option>
                    <option>타업체 수주</option>
                  </select>
                </label>
                <label>
                  <span>수주업체</span>
                  <BufferedInput
                    list={form.awardStatus === "협력사 수주" ? "partner-award-company-options" : undefined}
                    required={["협력사 수주", "타업체 수주"].includes(form.awardStatus)}
                    disabled={!["협력사 수주", "타업체 수주"].includes(form.awardStatus)}
                    value={
                      form.awardStatus === "위즈업 수주"
                        ? "위즈업"
                        : form.awardCompany
                    }
                    onCommit={(awardCompany) =>
                      setForm((current) => ({ ...current, awardCompany }))
                    }
                    placeholder={
                      form.awardStatus === "협력사 수주"
                        ? "협력업체명을 입력하거나 선택"
                        : form.awardStatus === "타업체 수주"
                        ? "수주업체명"
                        : "협력사·타업체 수주 선택 시 입력"
                    }
                  />
                </label>
                <label>
                  <span>수주 진행 단계</span>
                  <select
                    disabled={form.awardStatus === "타업체 수주"}
                    value={
                      form.awardStatus === "타업체 수주"
                        ? "해당 없음"
                        : normalizeAwardStage(form.awardStage, form.awardStatus)
                    }
                    onChange={(event) => {
                      const awardStage = event.target.value;
                      setForm({
                        ...form,
                        awardStage,
                        awardCompletedDate:
                          isCompletedAwardStage(awardStage)
                            ? form.awardCompletedDate ||
                              toLocalDateValue(new Date())
                            : "",
                        followUpRequired:
                          isCompletedAwardStage(awardStage)
                            ? false
                            : form.followUpRequired,
                        followUpDate:
                          isCompletedAwardStage(awardStage) ? "" : form.followUpDate,
                      });
                    }}
                  >
                    {form.awardStatus === "타업체 수주" && (
                      <option>해당 없음</option>
                    )}
                    {awardStageOptions.map((stage) => (
                      <option key={stage}>{stage}</option>
                    ))}
                  </select>
                  {form.awardStatus === "타업체 수주" ? (
                    <small className="automatic-field-note">
                      타업체 수주 결과로 자동 종료됩니다.
                    </small>
                  ) : isCompletedAwardStage(form.awardStage) ? (
                    <small className="automatic-field-note">
                      납품 완료 처리되어 재연락 표시와 예정일이 자동으로 해제됩니다.
                    </small>
                  ) : null}
                </label>
                {isCompletedAwardStage(form.awardStage) && (
                  <label>
                    <span>납품 완료일</span>
                    <input
                      type="date"
                      required
                      value={form.awardCompletedDate}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          awardCompletedDate: event.target.value,
                        })
                      }
                    />
                    <small className="automatic-field-note">
                      통계의 월별 실적은 이 날짜로 한 번만 집계됩니다.
                    </small>
                  </label>
                )}
                <label>
                  <span>진행 담당자</span>
                  {canEditProgressManager ? (
                    <select
                      disabled={form.awardStatus === "협력사 수주"}
                      value={
                        form.awardStatus === "협력사 수주"
                          ? "해당 없음"
                          : form.progressManager
                      }
                      onChange={(event) =>
                        setForm({ ...form, progressManager: event.target.value })
                      }
                    >
                      <option value="">미지정</option>
                      <option value="해당 없음">해당 없음</option>
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
                  ) : (
                    <div className="readonly-form-value">
                      {form.awardStatus === "협력사 수주"
                        ? "해당 없음"
                        : form.progressManager ||
                          session?.member.displayName ||
                          "자동 배정"}
                    </div>
                  )}
                  {form.awardStatus === "협력사 수주" ? (
                    <small className="automatic-field-note">
                      협력사 수주는 진행 담당자가 자동으로 해당 없음 처리됩니다.
                    </small>
                  ) : !registeredSalesNames.length ? (
                    <small className="automatic-field-note">
                      구성원 승인 화면에서 영업 담당자를 먼저 등록해 주세요.
                    </small>
                  ) : null}
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

      {partnerCompanyManagerOpen && (
        <div
          className="modal-layer partner-company-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="partner-company-manager-title"
        >
          <button
            className="modal-backdrop"
            aria-label="협력사 관리 창 닫기"
            disabled={partnerCompanySaving}
            onClick={() => setPartnerCompanyManagerOpen(false)}
          />
          <aside className="record-modal partner-company-modal">
            <div className="modal-header">
              <div>
                <span className="section-kicker">AWARD COMPANY</span>
                <h2 id="partner-company-manager-title">협력사 관리</h2>
              </div>
              <button
                type="button"
                className="close-button"
                disabled={partnerCompanySaving}
                onClick={() => setPartnerCompanyManagerOpen(false)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="partner-company-body">
              <section className="partner-company-guide">
                <strong>자주 함께하는 업체만 협력사로 등록해 주세요.</strong>
                <p>
                  등록된 업체는 엑셀 수주 등록에서 검색할 수 있고 자동으로
                  협력사 수주로 분류됩니다. 등록하지 않은 업체명도 직접 입력할 수
                  있으며 타업체 수주로 저장됩니다.
                </p>
              </section>
              <form
                className="partner-company-form"
                onSubmit={(event) => void savePartnerCompany(event)}
              >
                <div className="partner-company-form-heading">
                  <strong>협력사 추가</strong>
                  <span>업체명만 입력해도 등록할 수 있습니다.</span>
                </div>
                <label className="span-2">
                  <span>업체명 *</span>
                  <input
                    required
                    value={partnerCompanyDraft.organization}
                    onChange={(event) =>
                      setPartnerCompanyDraft((current) => ({
                        ...current,
                        organization: event.target.value,
                      }))
                    }
                    placeholder="예: 에어패스"
                  />
                </label>
                <label>
                  <span>담당자</span>
                  <input
                    value={partnerCompanyDraft.contactName}
                    onChange={(event) =>
                      setPartnerCompanyDraft((current) => ({
                        ...current,
                        contactName: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>연락처</span>
                  <input
                    value={partnerCompanyDraft.contactPhone}
                    onChange={(event) =>
                      setPartnerCompanyDraft((current) => ({
                        ...current,
                        contactPhone: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>메일</span>
                  <input
                    type="email"
                    value={partnerCompanyDraft.contactEmail}
                    onChange={(event) =>
                      setPartnerCompanyDraft((current) => ({
                        ...current,
                        contactEmail: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>참고사항</span>
                  <input
                    value={partnerCompanyDraft.notes}
                    onChange={(event) =>
                      setPartnerCompanyDraft((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                  />
                </label>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={partnerCompanySaving}
                >
                  {partnerCompanySaving
                    ? "저장 중…"
                    : editingPartnerCompanyId
                      ? "협력사 정보 수정"
                      : "협력사 등록"}
                </button>
              </form>
              <section className="partner-company-list-section">
                <header>
                  <div>
                    <strong>등록 협력사</strong>
                    <span>{registeredPartnerRecords.length}곳</span>
                  </div>
                  <input
                    value={partnerCompanySearch}
                    onChange={(event) =>
                      setPartnerCompanySearch(event.target.value)
                    }
                    placeholder="업체명·담당자·연락처 검색"
                  />
                </header>
                <div className="partner-company-list">
                  {filteredPartnerCompanyRecords.map((record) => (
                    <article key={record.organization}>
                      <div>
                        <strong>{record.organization}</strong>
                        <span>
                          {[record.contactName, record.contactPhone, record.contactEmail]
                            .filter(Boolean)
                            .join(" · ") || "담당자 정보 미등록"}
                        </span>
                        {record.notes && <small>{record.notes}</small>}
                      </div>
                      <div className="partner-company-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPartnerCompanyId(record.id);
                            setPartnerCompanyDraft({
                              organization: record.organization,
                              contactName: record.contactName,
                              contactPhone: record.contactPhone,
                              contactEmail: record.contactEmail,
                              notes: record.notes,
                            });
                          }}
                        >
                          정보 수정
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={partnerCompanySaving}
                          onClick={() => void unregisterPartnerCompany(record)}
                        >
                          등록 해제
                        </button>
                      </div>
                    </article>
                  ))}
                  {!filteredPartnerCompanyRecords.length && (
                    <div className="partner-company-empty">
                      {partnerCompanySearch
                        ? "검색 결과가 없습니다."
                        : "아직 등록된 협력사가 없습니다."}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
