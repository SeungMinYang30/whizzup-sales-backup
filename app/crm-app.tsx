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
import type {
  AccountingEntry,
  AccountingWorkspaceTab,
} from "./accounting-page";
import { personDisplayLabel } from "../lib/person-label";
import { canonicalOwnerPerformanceManagerName } from "../lib/owner-performance";
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
  institutionNameWithoutRegionPrefix,
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
import {
  calculateConstructionDashboardCounts,
  type ConstructionDashboardCounts,
} from "../lib/construction-dashboard";

const DataBackupPage = lazy(() => import("./data-backup-page"));
const HoldemLounge = lazy(() => import("./holdem-lounge"));
const ProductCatalogPage = lazy(() => import("./product-catalog-page"));
const QuotationManagementPage = lazy(() => import("./quotation-management-page"));
const OrganizationQuotationHistory = lazy(() => import("./organization-quotation-history"));
const AccountingPage = lazy(() => import("./accounting-page"));
const AnalyticsPage = lazy(() => import("./analytics-page"));
const OwnerPerformancePage = lazy(() => import("./owner-performance-page"));
const InventoryPage = lazy(() => import("./inventory-page"));
const ConstructionSchedulePage = lazy(() => import("./construction-schedule-page"));
const ComplexProjectPage = lazy(() => import("./complex-project-page"));
const ResourceLibraryPage = lazy(() => import("./resource-library-page"));
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
  return record.sourceChat === "ì˜ì—…ì§€ë„ PDF ê°€ì ¸ì˜¤ê¸°";
}

function isCampaignRegistrationSystemRecord(
  record: Pick<Activity, "sourceChat" | "activityType">,
) {
  return (
    record.activityType === "ì‚¬ì—… ëŒ€ìƒ ë“±ë¡" &&
    [
      "ì˜ˆì‚°ë³„ ê¸°ê´€ PDF ê°€ì ¸ì˜¤ê¸°",
      "ì˜ˆì‚°ë³„ ê¸°ê´€ ì—‘ì…€ ê°€ì ¸ì˜¤ê¸°",
      "ì˜ˆì‚°ë³„ ê¸°ê´€ ì§ì ‘ ë“±ë¡",
    ].includes(record.sourceChat)
  );
}

function isAwardManagementSystemRecord(
  record: Pick<Activity, "sourceChat">,
) {
  return (
    record.sourceChat === "ìˆ˜ì£¼ ê´€ë¦¬ ì—‘ì…€ ë“±ë¡" ||
    record.sourceChat === "ìˆ˜ì£¼ ê´€ë¦¬ ì§ì ‘ ë“±ë¡" ||
    record.sourceChat.startsWith("êµ¬ê¸€ ì‹œíŠ¸ ì—°ë™|")
  );
}

function isPartnerRegistrationSystemRecord(
  record: Pick<Activity, "sourceChat" | "activityType">,
) {
  return (
    record.sourceChat === "ìˆ˜ì£¼ì—…ì²´ ê´€ë¦¬" &&
    ["í˜‘ë ¥ì‚¬ ë“±ë¡", "í˜‘ë ¥ì‚¬ ë“±ë¡ í•´ì œ"].includes(record.activityType)
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
  return /(ì´ì˜ˆì‚°|ì˜ˆì‚°ëª…|í™•ë³´ì˜ˆì‚°|ì‚¬ì—…ëª…)/.test(
    label.replace(/\s+/g, ""),
  );
}

function isDerivedBudgetDetailSection(title: string) {
  return /ì˜ˆì‚°/.test(title.replace(/\s+/g, ""));
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
    .replace(/[\s._Â·/\\()[\]{}'"`~!@#$%^&*+=:;?,<>|-]+/g, "")
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
  if (text === "self" || text === "ìì²´ì˜ˆì‚°") return "self";
  if (text === "purpose" || text === "ëª©ì ì˜ˆì‚°") return "purpose";
  return "";
}

function normalizeBudgetAmountMode(value: unknown): BudgetAmountMode {
  const text = String(value ?? "").trim();
  if (
    text === "quote_auto" ||
    text === "ìë™ ê³„ì‚°" ||
    text === "í’ˆëª© í•©ê³„ ìë™ ê³„ì‚°"
  ) {
    return "quote_auto";
  }
  if (text === "manual" || text === "ì§ì ‘ ì…ë ¥" || text === "ìˆ˜ê¸° ì…ë ¥") {
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
  let response: Response | null = null;
  let payload: {
    catalog?: unknown[];
    groups?: unknown[];
    options?: unknown[];
    error?: string;
  } = {};
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      response = await fetch("/api/budget-catalog", { cache: "no-store" });
      const text = await response.text();
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = {
          error: response.ok
            ? "í‘œì¤€ ì˜ˆì‚°ëª… ì‘ë‹µì„ í™•ì¸í•˜ì§€ ëª»í–ˆìŠµë‹ˆë‹¤. ë‹¤ì‹œ ì‹œë„í•´ ì£¼ì„¸ìš”."
            : "í‘œì¤€ ì˜ˆì‚°ëª… ëª©ë¡ì„ ë¶ˆëŸ¬ì˜¤ì§€ ëª»í–ˆìŠµë‹ˆë‹¤.",
        };
      }
      if (response.ok || ![408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
        break;
      Ûµã‹h‘éì¶»§q«^t€€€€€€€€¥ô4(€€€€€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€€€¥ô4(4(€€€€€€€€€€€€€íÙ¥•Ü€ôôô€‰…İ…É‘Ìˆ€˜˜ÕÉÉ•¹Ñİ…É‘A…•M•±•Ñ•€˜˜€ 4(€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…İ…ÉµÍ•±•Ñ¥½¸µ‰…¹¹•ÈˆÉ½±”ô‰ÍÑ…ÑÕÌˆø4(€€€€€€€€€€€€€€€€€í…±±¥±Ñ•É•‘İ…É‘ÍM•±•Ñ•€ü€ 4(€€€€€€€€€€€€€€€€€€€€ğø4(€€€€€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œø4(€€€€€€€€€€€€€€€€€€€€€€€ƒªÊ²$ƒªÊÃªÎğí…İ…É‘¥ÍÁ±…åÉ½ÕÁÌ¹±•¹Ñ ¹Ñ½1½…±•MÑÉ¥¹œ ¥÷ªÂpƒ²
³²^²vĞƒ®ª£®F@ƒ²ƒ¶w®Bc²^#²*×®.#®.¸4(€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÑÉ½¹œø4(€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õí±•…Éİ…É‘M•±•Ñ¥½¹ôø4(€€€€€€€€€€€€€€€€€€€€€€€ƒ²ƒ¶tƒ¶VÓ²‚p4(€€€€€€€€€€€€€€€€€€€€€€ğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€€€€€€€€€€€ğ¼ø4(€€€€€€€€€€€€€€€€€€¤€è€ 4(€€€€€€€€€€€€€€€€€€€€ğø4(€€€€€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œø4(€€€€€€€€€€€€€€€€€€€€€€€ƒ¶b²z°ƒ¶:c²vÓ² í…İ…É‘A…•É½ÕÁÌ¹±•¹Ñ ¹Ñ½1½…±•MÑÉ¥¹œ ¥÷ªÂpƒ²
³²^²vĞƒ²ƒ¶w®Bc²^#²*×®.#®.¸4(€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÑÉ½¹œø4(€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸ÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õíÍ•±•Ñ±±¥±Ñ•É•‘İ…É‘Íôø4(€€€€€€€€€€€€€€€€€€€€€€€ƒªÊ²$ƒªÊÃªÎğí…İ…É‘¥ÍÁ±…åÉ½ÕÁÌ¹±•¹Ñ ¹Ñ½1½…±•MÑÉ¥¹œ ¥÷ªÂpƒ²
³²^ƒ²‚²ÊĞƒ²ƒ¶t4(€€€€€€€€€€€€€€€€€€€€€€ğ½‰ÕÑÑ½¸ø4(€€€€€€€€€€€€€€€€€€€€ğ¼ø4(€€€€€€€€€€€€€€€€€€¥ô4(€€€€€€€€€€€€€€€€ğ½‘¥Øø4(€€€€€€€€€€€€€€¥ô4(4(€€€€€€€€€€€€€€ñMÑ¥­åQ…‰±•]É…À4(€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÙ¥•Ü€ôôô€‰‘…Í¡‰½…Éˆ€ü€‰‘…Í¡‰½…ÉµÑ…‰±”µİÉ…Àˆ€è€‰‘…Ñ„µ±¥ÍĞµÑ…‰±”‰ô4(€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€ñÑ…‰±”±…ÍÍ9…µ”õíÙ¥•Ü€ôôô€‰…İ…É‘Ìˆ€ü€‰…İ…É‘ÌµÑ…‰±”ˆ€èÙ¥•Ü€ôôô€‰É•½É‘Ìˆ€ü€‰É•½É‘ÌµÑ…‰±”ˆ€èÕ¹‘•™¥¹•‘ôø4(€€€€€€€€€€€€€€€€€€ñÑ¡•…ø4(€€€€€€€€€€€€€€€€€€€íÙ¥•Ü€ôôô€‰…İ…É‘Ìˆ€ü€ 4(€€€€€€€€€€€€€€€€€€€€€€ñÑÈø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ ±…ÍÍ9…µ”ô‰Í•±•Ñ¥½¸µ•±°ˆø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕĞ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰É½ÜµÍ•±•Ğµ¡•­‰½àˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰¡•­‰½àˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°ô‹¶b²z°ƒ¶:c²vÓ² ƒ²"c²ğƒ²‚²ÊĞƒ²ƒ¶tˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•­•õíÕÉÉ•¹Ñİ…É‘A…•M•±•Ñ•‘ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹¡…¹”õíÑ½±•ÕÉÉ•¹Ñİ…É‘A…•ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€€€€€€€ğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ û²"s®Ê ğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ û²"c²ó²vğğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ û²²^´ğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ ûªâÃªÒ ğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ û²b#²
Àƒ
Üƒªâ#²V„ğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ ûªÎ²V÷ªâ#²V„ğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ û²
³²^®Â§².tğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ û²"c²ó²^²ÊĞğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ û²î£²0ƒ²^²ÊĞğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ û²"c²ğƒ²¶Z$ƒ²¶pğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ û²¶Z$ƒ®.Ó®.ç²z@ğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€ğ½ÑÈø4(€€€€€€€€€€€€€€€€€€€€¤€èÙ¥•Ü€ôôô€‰É•½É‘Ìˆ€ü€ 4(€€€€€€€€€€€€€€€€€€€€€€ñÑÈø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ û²"s®Ê ğ½Ñ øñÑ û®
ƒ²pğ½Ñ øñÑ ûªâÃªÒ
ß¶23¶*ã® ğ½Ñ øñÑ û¶fs®>dğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ ø4(€€€€€€€€€€€€€€€€€€€€€€€€€íÑ•…µ•Ñ…¥±5½‘”€ôôô€‰…ÑÑ•¹Ñ¥½¸ˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‹¶fW²vàƒ²
³²r€€¼ƒ®.“²v0ƒ¶Z'®>dˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€‹®
Ó²j¤ƒ²jS²Vô€¼ƒ®.“²v0ƒ¶Z'®>d‰ô4(€€€€€€€€€€€€€€€€€€€€€€€€ğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€€íÑ•…µ•Ñ…¥±5½‘”€ôôô€‰…ÑÑ•¹Ñ¥½¸ˆ€˜˜€ñÑ û²¶Z$ƒ®.Ó®.ç²z@ğ½Ñ ùô4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑ û²¶pğ½Ñ øñÑ û²"c²ğğ½Ñ øñÑ û²z³²^Ã®vôğ½Ñ øñÑ øñÍÁ…¸±…ÍÍ9…µ”ô‰ÍÈµ½¹±äˆûªÒ®š°ğ½ÍÁ…¸øğ½Ñ ø4(€€€€€€€€€€€€€€€€€€€€€€ğ½ÑÈø4(€€€€€€€€€€€€€€€€€€€€¤€è€ 4(€€€€€€€€€€€€€€€€€€€€€€ñÑÈøñÑ û®
ƒ²pğ½Ñ øñÑ ûªâÃªÒ
ß¶23¶*ã® ğ½Ñ øñÑ û¶fs®>dğ½Ñ øñÑ û®
Ó²j¤ğ½Ñ øñÑ û²¶Z$ƒ®.Ó®.ç²z@ğ½Ñ øñÑ û²¶pğ½Ñ øñÑ û²"c²ğğ½Ñ øñÑ û²z³²^Ã®vôğ½Ñ øñÑ øñÍÁ…¸±…ÍÍ9…µ”ô‰ÍÈµ½¹±äˆûªÒ®š°ğ½ÍÁ…¸øğ½Ñ øğ½ÑÈø4(€€€€€€€€€€€€€€€€€€€€¥ô4(€€€€€€€€€€€€€€€€€€ğ½Ñ¡•…ø4(€€€€€€€€€€€€€€€€€€ñÑ‰½‘äø4(€€€€€€€€€€€€€€€€€€€ì¡Ù¥•Ü€ôôô€‰‘…Í¡‰½…Éˆ€ü‘…Í¡‰½…É‘I••¹ÑI•½É‘Ì€èÁ…•‘Q•…µ•Ñ…¥±I•½É‘Ì¤¹µ…À ¡É•½É°¥¹‘•à¤€ôø4(€€€€€€€€€€€€€€€€€€€€€Ù¥•Ü€ôôô€‰…İ…É‘Ìˆ€ü€ 4(€€€€€€€€€€€€€€€€€€€€€€€€ñÑÈ4(€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí…İ…ÉµÉ•½ÉµÉ½Ü€‘ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€É•½É¹…İ…É‘MÑ…ÑÕÌ€ôôô€‹¶²^²ÊĞƒ²"c²ğˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‰½Ñ¡•Èµ…İ…ÉµÉ½Üˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€èÉ•½É¹…İ…É‘MÑ…ÑÕÌ€ôôô€‹¶bG®‚—²
°ƒ²"c²ğˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‰Á…ÉÑ¹•Èµ…İ…ÉµÉ½Üˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€èÉ•½É¹…İ…É‘MÑ…ÑÕÌ€ôôô€‹²r²š#²^ƒ²"c²ğˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‰½ÕÈµ…İ…ÉµÉ½Üˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€ˆˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€€€€€€€€€­•äõíÉ•½É¹¥‘ô4(€€€€€€€€€€€€€€€€€€€€€€€€€Ñ…‰%¹‘•àõìÁô4(€€€€€€€€€€€€€€€€€€€€€€€€€É½±”ô‰‰ÕÑÑ½¸ˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°õí€‘íÉ•½É¹½É…¹¥é…Ñ¥½¹ôƒ²²ã²f ƒ²vÓ²‚ƒ¶z#²*“¶ƒ®š°ƒ®ÎÓªâÁô4(€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡•Ù•¹Ğ¤€ôøì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•Ù•¹Ğ¹Ñ…É•Ğ…Ì!Q51±•µ•¹Ğ¤¹±½Í•ÍĞ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€‰‰ÕÑÑ½¸°„°¥¹ÁÕĞ°Í•±•Ğ°Ñ•áÑ…É•„ˆ°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍĞÉ½ÕÀ€ô…İ…É‘A…•É½ÕÁ	åAÉ¥µ…Éå%¹•Ğ¡É•½É¹¥¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡É½ÕÀ¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½Á•¹)½¥¹ÑAÉ½©•ÑÉ½ÕÁ•Ñ…¥° 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É½ÕÀ°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€	½½±•…¸¡‘•™•ÉÉ•‘M•…É ¹ÑÉ¥´ ¤¤°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô•±Í”ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ•Ñ…¥±	ÕÍ¥¹•ÍÍI½Õ¹¡É•½É¹‰ÕÍ¥¹•ÍÍI½Õ¹¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ•Ñ…¥±=É…¹¥é…Ñ¥½¸¡É•½É¹½É…¹¥é…Ñ¥½¸¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€€€€€€€€€½¹-•å½İ¸õì¡•Ù•¹Ğ¤€ôøì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€•Ù•¹Ğ¹Ñ…É•Ğ€„ôô•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğñğ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•Ù•¹Ğ¹­•ä€„ôô€‰¹Ñ•Èˆ€˜˜•Ù•¹Ğ¹­•ä€„ôô€ˆ€ˆ¤4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍĞÉ½ÕÀ€ô…İ…É‘A…•É½ÕÁ	åAÉ¥µ…Éå%¹•Ğ¡É•½É¹¥¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€¥˜€¡É½ÕÀ¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½Á•¹)½¥¹ÑAÉ½©•ÑÉ½ÕÁ•Ñ…¥° 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É½ÕÀ°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€	½½±•…¸¡‘•™•ÉÉ•‘M•…É ¹ÑÉ¥´ ¤¤°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô•±Í”ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ•Ñ…¥±	ÕÍ¥¹•ÍÍI½Õ¹¡É•½É¹‰ÕÍ¥¹•ÍÍI½Õ¹¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ•Ñ…¥±=É…¹¥é…Ñ¥½¸¡É•½É¹½É…¹¥é…Ñ¥½¸¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑ±…ÍÍ9…µ”ô‰Í•±•Ñ¥½¸µ•±°ˆø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕĞ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰É½ÜµÍ•±•Ğµ¡•­‰½àˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰¡•­‰½àˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°õí€‘í…İ…É‘A…•É½ÕÁ	åAÉ¥µ…Éå%¹•Ğ¡É•½É¹¥¤ü¹ÍÁ½¹Í½É=É…¹¥é…Ñ¥½¸ñğÉ•½É¹½É…¹¥é…Ñ¥½¹ôƒªÎ×®>g²
³²^ƒ²‚²ÊĞƒ²ƒ¶uô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¡•­•õì¡…İ…É‘A…•É½ÕÁ	åAÉ¥µ…Éå%¹•Ğ¡É•½É¹¥¤ü¹µ•µ‰•ÉÌñğmÉ•½É‘t¤¹•Ù•Éä ¡µ•µ‰•È¤€ôøÍ•±•Ñ•‘İ…É‘%‘M•Ğ¹¡…Ì¡µ•µ‰•È¹¥¤¥ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì¡•Ù•¹Ğ¤€ôø•Ù•¹Ğ¹ÍÑ½ÁAÉ½Á……Ñ¥½¸ ¥ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì ¤€ôø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•ÑM•±•Ñ•‘İ…É‘%‘Ì ¡ÕÉÉ•¹Ğ¤€ôøì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍĞµ•µ‰•ÉÌ€ô…İ…É‘A…•É½ÕÁ	åAÉ¥µ…Éå%¹•Ğ¡É•½É¹¥¤ü¹µ•µ‰•ÉÌñğmÉ•½É‘tì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍĞµ•µ‰•É%‘Ì€ô¹•ÜM•Ğ¡µ•µ‰•ÉÌ¹µ…À ¡µ•µ‰•È¤€ôøµ•µ‰•È¹¥¤¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍĞÍ•±•Ñ•€ôµ•µ‰•ÉÌ¹•Ù•Éä ¡µ•µ‰•È¤€ôøÕÉÉ•¹Ğ¹¥¹±Õ‘•Ì¡µ•µ‰•È¹¥¤¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸Í•±•Ñ•4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€üÕÉÉ•¹Ğ¹™¥±Ñ•È ¡¥¤€ôø€…µ•µ‰•É%‘Ì¹¡…Ì¡¥¤¤4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€èl¸¸¹¹•ÜM•Ğ¡l¸¸¹ÕÉÉ•¹Ğ°€¸¸¹µ•µ‰•É%‘Ít¥tì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½Ñø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑ±…ÍÍ9…µ”ô‰Í•ÅÕ•¹”µ•±°ˆø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ì¡…İ…É‘A…”€´€Ä¤€¨]I}1%MQ}A}M%i€¬¥¹‘•à€¬€Åô4(€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½Ñø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑøñÍÁ…¸±…ÍÍ9…µ”ô‰‘…Ñ”µ•±°ˆùí™½Éµ…Ñ…Ñ”¡É•½É¹…Ñ¥Ù¥Ñå…Ñ”¥ôğ½ÍÁ…¸øğ½Ñø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑøñÍÁ…¸±…ÍÍ9…µ”ô‰É•¥½¸µ•±°ˆùíÉ•½É¹É•¥½¸ñğ€‹ŠP‰ôğ½ÍÁ…¸øğ½Ñø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑ±…ÍÍ9…µ”ô‰½¹ÑÉ…Ğµ…µ½Õ¹Ğµ•±°ˆø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œ±…ÍÍ9…µ”ô‰½Éœµ¹…µ”ˆø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í…İ…É‘A…•É½ÕÁ	åAÉ¥µ…Éå%¹•Ğ¡É•½É¹¥¤ü¹ÍÁ½¹Í½É=É…¹¥é…Ñ¥½¸ñğÉ•½É¹½É…¹¥é…Ñ¥½¹ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÑÉ½¹œø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍµ…±°ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€íÉ•½É¹‰ÕÍ¥¹•ÍÍI½Õ¹‘÷²Â ƒ²
³²^4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½Íµ…±°ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€íÉ•½É¹©½¥¹ÑAÉ½©•Ñ%€˜˜€ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰©½¥¹ĞµÁÉ½©•Ğµ‰…‘”ÍÁ½¹Í½ÈˆÑ¥Ñ±”õíÉ•½É¹©½¥¹ÑAÉ½©•Ñ9…µ•ôø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒªÎ×®>g²
³²^ƒ²óªÒ ƒ
Üì¡…İ…É‘A…•É½ÕÁ	åAÉ¥µ…Éå%¹•Ğ¡É•½É¹¥¤ü¹µ•µ‰•ÉÌñğmÉ•½É‘t¤¹™¥±Ñ•È ¡µ•µ‰•È¤€ôøµ•µ‰•È¹©½¥¹ÑAÉ½©•ÑI½±”€„ôô€‰ÍÁ½¹Í½Èˆ¤¹±•¹Ñ¡÷ªÎÌ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ)½¥¹ÑAÉ½©•Ñ5•µ‰•É1¥ÍĞ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µ•µ‰•ÉÌõí…İ…É‘A…•É½ÕÁ	åAÉ¥µ…Éå%¹•Ğ¡É•½É¹¥¤ü¹µ•µ‰•ÉÌñğmÉ•½É‘uô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€µ…Ñ¡¥¹5•µ‰•ÉÌõí…İ…É‘A…•É½ÕÁ	åAÉ¥µ…Éå%¹•Ğ¡É•½É¹¥¤ü¹µ…Ñ¡¥¹5•µ‰•ÉÌñğmÉ•½É‘uô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•…É¡Ñ¥Ù”õí	½½±•…¸¡‘•™•ÉÉ•‘M•…É ¹ÑÉ¥´ ¤¥ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹M•±•Ñ5•µ‰•Èõì¡µ•µ‰•È¤€ôøì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€…¹•±•Ñ…¥±%¹±¥¹•‘¥Ğ ¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ•Ñ…¥±	ÕÍ¥¹•ÍÍI½Õ¹¡µ•µ‰•È¹‰ÕÍ¥¹•ÍÍI½Õ¹¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Í•Ñ•Ñ…¥±=É…¹¥é…Ñ¥½¸¡µ•µ‰•È¹½É…¹¥é…Ñ¥½¸¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€õô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¼ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ¼ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€íÁ½ÍÑİ…É‘½¹Ñ…ÑMÑ…ÑÕÌ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•½É°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•½É‘Í	å%¹ÍÑ¥ÑÕÑ¥½¹-•ä¹•Ğ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥¹ÍÑ¥ÑÕÑ¥½¹±¥…Í-•ä¡É•½É¹½É…¹¥é…Ñ¥½¸¤°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤€üümt°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤€ôôô€‹²z³²b²^ƒ²®.Ğˆ€˜˜€ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰É•Í…±”µ…Ñ¥Ù”µ‰…‘”ˆû²z³²b²^ƒ²¶Z$ƒ²’Dğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½Ñø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑ±…ÍÍ9…µ”ô‰‰Õ‘•ĞµÍÕµµ…Éäµ•±°ˆø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…İ…Éµ‰Õ‘•Ğµ¹…µ”‰Õ‘•ĞµÍÕµµ…Éäµ¹…µ”ˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”õí½µÁ…Ñ	Õ‘•Ñ¥ÍÁ±…å½ÉI•½É¡É•½É¤¹Ñ¥Ñ±•ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í½µÁ…Ñ	Õ‘•Ñ¥ÍÁ±…å½ÉI•½É¡É•½É¤¹¹…µ•ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÑÉ½¹œø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰‰Õ‘•Ğµ…µ½Õ¹Ğˆø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í½µÁ…Ñ	Õ‘•Ñ¥ÍÁ±…å½ÉI•½É¡É•½É¤¹…µ½Õ¹Ñô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍµ…±°ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í¡…ÍI•Í½±Ù•‘MÑ…¹‘…É‘	Õ‘•Ğ¡É•½É¤4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‹¶Fs²’ ƒ²b#²
Àˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€èÉ•½É¹‰Õ‘•Ñ=É¥¥¹…±9…µ”€˜˜4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•½É¹‰Õ‘•Ñ=É¥¥¹…±9…µ”€„ôôÉ•½É¹‰Õ‘•ÑQåÁ”4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€üƒ²nC®²à€‘íÉ•½É¹‰Õ‘•Ñ=É¥¥¹…±9…µ•ôƒ
Üƒ¶Fs²’ ƒ²b#²
Àƒ²^ÃªÊÀƒ¶V²jQ€4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€‹¶Fs²’ ƒ²b#²
Àƒ²^ÃªÊÀƒ¶V²jP‰ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½Íµ…±°ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½Ñø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ì  ¤€ôøì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€½¹ÍĞ½¹ÑÉ…Ğ€ôÉ•¥ÍÑ•É•‘½¹ÑÉ…Ñ¥ÍÁ±…ä 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•½É°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€…İ…É‘A…•É½ÕÁ	åAÉ¥µ…Éå%¹•Ğ¡É•½É¹¥¤ü¹µ•µ‰•ÉÌ°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•ÑÕÉ¸€ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí‰Õ‘•Ğµ…µ½Õ¹ĞÅÕ½Ñ”´‘í½¹ÑÉ…Ğ¹ÍÑ…ÑÕÍõô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í½¹ÑÉ…Ğ¹…µ½Õ¹Ñô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÑÉ½¹œø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍµ…±°ùí½¹ÑÉ…Ğ¹‘•Ñ…¥±ôğ½Íµ…±°ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ¼ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤ì4(€€€€€€€€€€€€€€€€€€€€€€€€€€€ô¤ ¥ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€í…½Õ¹Ñ¥¹á•ÁÑ¥½¹½ÉI•½É¡É•½É¤€˜˜€ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…İ…Éµ…½Õ¹Ñ¥¹œµÍÑ…Ñ”Á•¹‘¥¹œˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”õí…½Õ¹Ñ¥¹á•ÁÑ¥½¹½ÉI•½É¡É•½É¤ü¹Ñ¥Ñ±•ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í…½Õ¹Ñ¥¹á•ÁÑ¥½¹½ÉI•½É¡É•½É¤ü¹±…‰•±ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½Ñø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õí•á•ÕÑ¥½¸µÁ¥±°€‘íÉ•½É¹•á•ÕÑ¥½¹QåÁ”€ôôô€‹²î£²0ˆ€ü€‰½¹Í½ÉÑ¥Õ´ˆ€èÉ•½É¹•á•ÕÑ¥½¹QåÁ”€ôôô€‹²²bˆ€ü€‰‘¥É•Ğˆ€è€‰Á•¹‘¥¹œ‰õôø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€íÉ•½É¹•á•ÕÑ¥½¹QåÁ”ñğ€‹®¾ã²‚T‰ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€íÉ•½É¹•á•ÕÑ¥½¹QåÁ”€ôôô€‹²î£²0ˆ€˜˜€ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍµ…±°ùíÉ•½É¹½¹Í½ÉÑ¥Õµ½µÁ…¹äñğ€‹²^²ÊÓ®ªƒ®¾ã²z®‚”‰ôğ½Íµ…±°ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½Ñø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œ±…ÍÍ9…µ”ô‰…İ…Éµ½µÁ…¹äˆùíÉ•½É¹…İ…É‘½µÁ…¹äñğ€‹®¾ã²‚T‰ôğ½ÍÑÉ½¹œø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€íÉ•½É¹…İ…É‘MÑ…ÑÕÌ€ôôô€‹¶²^²ÊĞƒ²"c²ğˆ€ü€ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰…İ…ÉµÁ¥±°½Ñ¡•È…İ…ÉµÉ•ÍÕ±ĞµÁ¥±°ˆø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¶²^²ÊĞƒ²"c²ğ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤€èÉ•½É¹…İ…É‘MÑ…ÑÕÌ€ôôô€‹¶bG®‚—²
°ƒ²"c²ğˆ€ü€ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰…İ…ÉµÁ¥±°Á…ÉÑ¹•È…İ…ÉµÉ•ÍÕ±ĞµÁ¥±°ˆø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ƒ¶bG®‚—²
°ƒ²"c²ğ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤€è€ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍµ…±°ùíÉ•½É¹…İ…É‘MÑ…ÑÕÍôğ½Íµ…±°ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€¥ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½Ñø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑøñÍÑÉ½¹œ±…ÍÍ9…µ”ô‰…İ…Éµ½µÁ…¹äˆùíÉ•½É¹½¹Í½ÉÑ¥Õµ½µÁ…¹äñğ€‹¶VÓ®.äƒ²^²v0‰ôğ½ÍÑÉ½¹œøğ½Ñø4(€€€€€€€€€€€€€€€€€€€€€€€€€€ñÑø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…İ…ÉµÍÑ…”µ•±°ˆø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õí…İ…ÉµÍÑ…”ÍÑ…”´‘í¹½Éµ…±¥é•İ…É‘MÑ…”¡É•½É¹…İ…É‘MÑ…”°É•½É¹…İ…É‘MÑ…ÑÕÌ¤¹É•Á±…•±° ˆ€ˆ°€ˆ´ˆ¥õôø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€í¹½Éµ…±¥é•İ…É‘MÑ…”¡É•½É¹…İ…É‘MÑ…”°É•½É¹…İ…É‘MÑ…ÑÕÌ¥ô4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ğ½ÍÁ…¸ø4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€íl‹²r²š#²^ƒ²"c²ğˆ°€‹¶bG®‚—²
°ƒ²"c²ğ‰t¹¥¹±Õ‘•Ì 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€É•½É¹…İ…É‘MÑ…ÑÕÌ°4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€¤€˜˜4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€…¥Í½µÁ±•Ñ•‘İ…É‘MÑ…”¡É•½É¹…İ…É‘MÑ…”¤€˜˜€ 4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ4(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô