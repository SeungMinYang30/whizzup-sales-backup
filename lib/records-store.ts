import { getD1, isPostgresDatabase } from "../db";
import type { Member } from "./collaboration";
import { ensureCollaborationReady, isPrimaryOwner } from "./collaboration";
import {
  canonicalInstitutionName,
  findSimilarInstitutionMatches,
  findSimilarInstitutionNames,
  INSTITUTION_ALIASES_SETTING_KEY,
  InstitutionConfirmationRequiredError,
  institutionAliasKey,
  rememberedInstitutionAliasCandidates,
  sameInstitutionRegion,
  type InstitutionMatchContext,
  preferFullInstitutionName,
} from "./institution-names";
import { resolveMappedRegion } from "./map-store";
import {
  backfillHistoricalProgressManagersFromLatestAuthors,
  listRegisteredSalesNames,
  progressManagerForAward,
  repairAutoBackfilledOwnerProgressManagers,
  syncBusinessProgressManagerFromLatestAuthor,
} from "./sales-manager-normalization";
import {
  compactShareSummary,
  replaceOrganizationReferences,
} from "./share-text";
import {
  inheritInstitutionState,
  mergeInstitutionStateSnapshots,
  type InstitutionStateSnapshot,
} from "./institution-state-carryover";
import { serializeInstitutionContacts } from "./institution-contacts";
import {
  COMPLETED_AWARD_STAGE,
  isCompletedAwardStage,
  normalizeActivityType,
  normalizeAwardStage,
  normalizeSalesProgress,
} from "./sales-taxonomy";
import { resolveOfficialSchoolName } from "./school-directory";
import {
  excludedInstitutionCandidates,
  rememberInstitutionDecision,
  type InstitutionRelationshipDecision,
} from "./institution-decisions";
import {
  ensureBudgetNamesReady,
  linkBudgetRequestRecord,
  linkBudgetNameEntity,
  normalizeBudgetNameKey,
  resolveBudgetRecordMetadata,
} from "./budget-names";
import { resolveAwardCompletedDate } from "./award-completion";
import {
  activityBudgetsFromRecord,
  canonicalBusinessRoundBudgets,
  normalizeActivityBudget,
  primaryBudgetFields,
  serializeActivityBudgets,
  type ActivityBudgetAllocation,
} from "./activity-budgets";

const createTableSql = `
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seed_key TEXT UNIQUE,
    activity_date TEXT,
    date_confidence TEXT NOT NULL DEFAULT '확정',
    activity_type TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '외부',
    contact_method TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    budget_type TEXT NOT NULL DEFAULT '',
    budget_amount TEXT NOT NULL DEFAULT '',
    budget_original_name TEXT NOT NULL DEFAULT '',
    budget_group_id INTEGER,
    budget_match_status TEXT NOT NULL DEFAULT 'unclassified',
    budget_match_method TEXT NOT NULL DEFAULT 'legacy',
    budget_request_id TEXT,
    budget_kind TEXT NOT NULL DEFAULT 'unclassified',
    budget_amount_mode TEXT NOT NULL DEFAULT 'manual',
    budget_amount_override TEXT NOT NULL DEFAULT '',
    budgets_json TEXT NOT NULL DEFAULT '[]',
    topic TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    detail_level TEXT NOT NULL DEFAULT 'compact',
    detail_summary TEXT NOT NULL DEFAULT '',
    detail_key_facts_json TEXT NOT NULL DEFAULT '[]',
    detail_sections_json TEXT NOT NULL DEFAULT '[]',
    raw_input TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '상담 진행',
    status_manual INTEGER NOT NULL DEFAULT 0,
    temperature TEXT NOT NULL DEFAULT '중간',
    award_status TEXT NOT NULL DEFAULT '미정',
    award_company TEXT NOT NULL DEFAULT '',
    execution_type TEXT NOT NULL DEFAULT '직영',
    consortium_company TEXT NOT NULL DEFAULT '',
    award_stage TEXT NOT NULL DEFAULT '미정',
    award_completed_date TEXT NOT NULL DEFAULT '',
    progress_manager TEXT NOT NULL DEFAULT '',
    progress_manager_locked INTEGER NOT NULL DEFAULT 0,
    follow_up_required INTEGER NOT NULL DEFAULT 1,
    follow_up_date TEXT,
    next_action TEXT NOT NULL DEFAULT '',
    progress_schedule TEXT NOT NULL DEFAULT '',
    contact_role TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    contacts_json TEXT NOT NULL DEFAULT '[]',
    source_chat TEXT NOT NULL DEFAULT 'ChatGPT 전체 내보내기',
    notes TEXT NOT NULL DEFAULT '',
    updated_by_member_id INTEGER,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

export function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeActivityDetailLevel(value: unknown) {
  return ["compact", "standard", "detailed"].includes(clean(value))
    ? clean(value)
    : "compact";
}

export function serializeActivityDetailFacts(value: unknown) {
  if (!Array.isArray(value)) return "[]";
  return JSON.stringify(
    value
      .slice(0, 12)
      .map((item) => {
        const source =
          item && typeof item === "object"
            ? (item as Record<string, unknown>)
            : {};
        return {
          label: clean(source.label).slice(0, 80),
          value: clean(source.value).slice(0, 500),
        };
      })
      .filter((item) => item.label && item.value),
  );
}

export function serializeActivityDetailSections(value: unknown) {
  if (!Array.isArray(value)) return "[]";
  return JSON.stringify(
    value
      .slice(0, 12)
      .map((item) => {
        const source =
          item && typeof item === "object"
            ? (item as Record<string, unknown>)
            : {};
        return {
          title: clean(source.title).slice(0, 100),
          items: Array.isArray(source.items)
            ? source.items
                .slice(0, 20)
                .map((entry) => clean(entry).slice(0, 1_000))
                .filter(Boolean)
            : [],
        };
      })
      .filter((item) => item.title && item.items.length),
  );
}

export async function resolveActivityBudgetAllocations(
  d1: ReturnType<typeof getD1>,
  payload: Record<string, unknown>,
  awardStatus: unknown,
  fallback: Record<string, unknown> = {},
) {
  const requested = Array.isArray(payload.budgets)
    ? payload.budgets
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item && typeof item === "object"),
        )
        .map(normalizeActivityBudget)
    : activityBudgetsFromRecord({ ...fallback, ...payload });
  const source = requested.length
    ? requested
    : [normalizeActivityBudget({ ...fallback, ...payload })];
  const resolved: ActivityBudgetAllocation[] = [];
  const seen = new Set<string>();
  for (const budget of source.slice(0, 10)) {
    const metadata = await resolveBudgetRecordMetadata(d1, {
      ...budget,
      budgetOriginalName: budget.budgetOriginalName || budget.budgetType,
      awardStatus,
    });
    const next: ActivityBudgetAllocation = {
      budgetType: metadata.storedName,
      budgetAmount: metadata.budgetAmount,
      budgetOriginalName: metadata.budgetOriginalName,
      budgetGroupId: metadata.budgetGroupId,
      budgetMatchStatus: metadata.budgetMatchStatus,
      budgetMatchMethod: metadata.budgetMatchMethod,
      budgetRequestId: metadata.budgetRequestId,
      budgetKind: metadata.budgetKind,
      budgetAmountMode: metadata.budgetAmountMode,
      budgetInstitutionAmount:
        budget.budgetInstitutionAmount || metadata.budgetAmount,
      budgetQuoteAmount: budget.budgetQuoteAmount,
      budgetAmountOverride: metadata.budgetAmountOverride,
      budgetAmountSource:
        budget.budgetAmountSource ||
        (metadata.budgetAmount ? "manual" : "missing"),
    };
    const identity = next.budgetGroupId
      ? `group:${next.budgetGroupId}`
      : `name:${normalizeBudgetNameKey(
          next.budgetOriginalName || next.budgetType,
        )}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    resolved.push(next);
  }
  return resolved;
}

const businessRoundBudgetRetrofitKey =
  "retrofit:business_round_budget_consistency:v1";

type BusinessRoundBudgetRow = Record<string, unknown> & {
  id: number;
  organization: string;
  businessRound: number;
};

function businessRoundBudgetRowsQuery(whereClause = "") {
  return `SELECT id, organization,
                 business_round AS businessRound,
                 activity_date AS activityDate,
                 budget_type AS budgetType,
                 budget_amount AS budgetAmount,
                 budget_original_name AS budgetOriginalName,
                 budget_group_id AS budgetGroupId,
                 budget_match_status AS budgetMatchStatus,
                 budget_match_method AS budgetMatchMethod,
                 budget_request_id AS budgetRequestId,
                 budget_kind AS budgetKind,
                 budget_amount_mode AS budgetAmountMode,
                 budget_amount_override AS budgetAmountOverride,
                 budgets_json AS budgetsJson
          FROM activities
          ${whereClause}
          ORDER BY activity_date DESC, id DESC`;
}

export async function readCanonicalBusinessRoundBudgets(
  d1: ReturnType<typeof getD1>,
  organization: string,
  businessRound: number,
) {
  const rows = await d1
    .prepare(
      businessRoundBudgetRowsQuery(
        "WHERE organization = ? AND business_round = ?",
      ),
    )
    .bind(organization, businessRound)
    .all<BusinessRoundBudgetRow>();
  return canonicalBusinessRoundBudgets(
    (rows.results ?? []) as Record<string, unknown>[],
  );
}

function businessRoundBudgetUpdateStatements(
  d1: ReturnType<typeof getD1>,
  organization: string,
  businessRound: number,
  budgets: ActivityBudgetAllocation[],
) {
  const canonical = budgets.slice(0, 10).map((budget) => ({ ...budget }));
  const primary = primaryBudgetFields(canonical);
  const statements = [
    d1
      .prepare(
        `UPDATE activities
         SET budget_type = ?, budget_amount = ?, budget_original_name = ?,
             budget_group_id = ?, budget_match_status = ?, budget_match_method = ?,
             budget_request_id = ?, budget_kind = ?, budget_amount_mode = ?,
             budget_amount_override = ?, budgets_json = ?
         WHERE organization = ? AND business_round = ?`,
      )
      .bind(
        primary.budgetType,
        primary.budgetAmount,
        primary.budgetOriginalName,
        primary.budgetGroupId,
        primary.budgetMatchStatus,
        primary.budgetMatchMethod,
        primary.budgetRequestId,
        primary.budgetKind,
        primary.budgetAmountMode,
        primary.budgetAmountOverride,
        serializeActivityBudgets(canonical),
        organization,
        businessRound,
      ),
  ];
  const deactivate = d1
    .prepare(
      `UPDATE budget_name_members
       SET active = 0, unlinked_at = CURRENT_TIMESTAMP
       WHERE entity_type = 'activity'
         AND entity_id IN (
           SELECT id FROM activities
           WHERE organization = ? AND business_round = ?
         )
         AND active = 1`,
    )
    .bind(organization, businessRound);
  statements.push(deactivate);
  if (!primary.budgetGroupId) return statements;
  const originalName = primary.budgetOriginalName || primary.budgetType;
  statements.push(
    d1
      .prepare(
        `INSERT INTO budget_name_members
          (group_id, entity_type, entity_id, original_name, alias_key,
           active, linked_at, unlinked_at)
         SELECT ?, 'activity', id, ?, ?, 1, CURRENT_TIMESTAMP, NULL
         FROM activities
         WHERE organization = ? AND business_round = ?
           AND COALESCE(award_status, '미정')
             NOT IN ('협력사 수주', '타업체 수주')
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           group_id = excluded.group_id,
           original_name = excluded.original_name,
           alias_key = excluded.alias_key,
           active = 1,
           linked_at = CURRENT_TIMESTAMP,
           unlinked_at = NULL`,
      )
      .bind(
        primary.budgetGroupId,
        originalName,
        normalizeBudgetNameKey(originalName),
        organization,
        businessRound,
      ),
  );
  return statements;
}

/** 같은 기관·사업 차수의 모든 영업 기록이 같은 예산 묶음을 보도록 맞춥니다. */
export async function synchronizeBusinessRoundBudgets(
  d1: ReturnType<typeof getD1>,
  organization: string,
  businessRound: number,
  budgets: ActivityBudgetAllocation[],
) {
  await d1.batch(
    businessRoundBudgetUpdateStatements(
      d1,
      organization,
      businessRound,
      budgets,
    ),
  );
}

async function retrofitBusinessRoundBudgets(
  d1: ReturnType<typeof getD1>,
) {
  const completed = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(businessRoundBudgetRetrofitKey)
    .first<{ value: string }>();
  if (completed) return;

  const canonicalRounds = `WITH rounds AS (
      SELECT organization, business_round
      FROM activities
      GROUP BY organization, business_round
      HAVING COUNT(*) > 1
    ), ranked AS (
      SELECT
        a.*,
        CASE
          WHEN CASE
            WHEN json_valid(COALESCE(a.budgets_json, ''))
            THEN json_array_length(a.budgets_json)
            ELSE 0
          END > 0
          THEN a.budgets_json
          ELSE json_array(json_object(
            'budgetType', COALESCE(NULLIF(TRIM(a.budget_type), ''), '미분류'),
            'budgetAmount', COALESCE(a.budget_amount, ''),
            'budgetOriginalName', COALESCE(a.budget_original_name, ''),
            'budgetGroupId', a.budget_group_id,
            'budgetMatchStatus', COALESCE(a.budget_match_status, ''),
            'budgetMatchMethod', COALESCE(a.budget_match_method, ''),
            'budgetRequestId', a.budget_request_id,
            'budgetKind', COALESCE(a.budget_kind, ''),
            'budgetAmountMode', COALESCE(a.budget_amount_mode, ''),
            'budgetAmountOverride', COALESCE(a.budget_amount_override, '')
          ))
        END AS canonical_budgets_json,
        ROW_NUMBER() OVER (
          PARTITION BY a.organization, a.business_round
          ORDER BY
            CASE
              WHEN TRIM(COALESCE(a.budget_type, '')) <> ''
                OR CASE
                  WHEN json_valid(COALESCE(a.budgets_json, ''))
                  THEN json_array_length(a.budgets_json)
                  ELSE 0
                END > 0
              THEN 0 ELSE 1
            END,
            CASE
              WHEN CASE
                WHEN json_valid(COALESCE(a.budgets_json, ''))
                THEN json_array_length(a.budgets_json)
                ELSE 0
              END > 1
              THEN 0 ELSE 1
            END,
            a.activity_date DESC,
            a.id DESC
        ) AS budget_rank
      FROM activities a
      INNER JOIN rounds r
        ON r.organization = a.organization
       AND r.business_round = a.business_round
    ), canonical AS (
      SELECT *
      FROM ranked
      WHERE budget_rank = 1
        AND (
          TRIM(COALESCE(budget_type, '')) <> ''
          OR CASE
            WHEN json_valid(COALESCE(budgets_json, ''))
            THEN json_array_length(budgets_json)
            ELSE 0
          END > 0
        )
    )`;

  // 한 번의 원자적 D1 batch로 과거 기록과 표준 예산 연결을 함께 정리합니다.
  await d1.batch([
    d1.prepare(
      `${canonicalRounds}
       UPDATE activities AS target
       SET
         budget_type = (SELECT c.budget_type FROM canonical c
           WHERE c.organization = target.organization
             AND c.business_round = target.business_round),
         budget_amount = (SELECT c.budget_amount FROM canonical c
           WHERE c.organization = target.organization
             AND c.business_round = target.business_round),
         budget_original_name = (SELECT c.budget_original_name FROM canonical c
           WHERE c.organization = target.organization
             AND c.business_round = target.business_round),
         budget_group_id = (SELECT c.budget_group_id FROM canonical c
           WHERE c.organization = target.organization
             AND c.business_round = target.business_round),
         budget_match_status = (SELECT c.budget_match_status FROM canonical c
           WHERE c.organization = target.organization
             AND c.business_round = target.business_round),
         budget_match_method = (SELECT c.budget_match_method FROM canonical c
           WHERE c.organization = target.organization
             AND c.business_round = target.business_round),
         budget_request_id = (SELECT c.budget_request_id FROM canonical c
           WHERE c.organization = target.organization
             AND c.business_round = target.business_round),
         budget_kind = (SELECT c.budget_kind FROM canonical c
           WHERE c.organization = target.organization
             AND c.business_round = target.business_round),
         budget_amount_mode = (SELECT c.budget_amount_mode FROM canonical c
           WHERE c.organization = target.organization
             AND c.business_round = target.business_round),
         budget_amount_override = (SELECT c.budget_amount_override FROM canonical c
           WHERE c.organization = target.organization
             AND c.business_round = target.business_round),
         budgets_json = (SELECT c.canonical_budgets_json FROM canonical c
           WHERE c.organization = target.organization
             AND c.business_round = target.business_round)
       WHERE EXISTS (
         SELECT 1 FROM canonical c
         WHERE c.organization = target.organization
           AND c.business_round = target.business_round
       )`,
    ),
    d1.prepare(
      `UPDATE budget_name_members
       SET active = 0, unlinked_at = CURRENT_TIMESTAMP
       WHERE entity_type = 'activity'
         AND active = 1
         AND entity_id IN (
           SELECT a.id
           FROM activities a
           INNER JOIN (
             SELECT organization, business_round
             FROM activities
             GROUP BY organization, business_round
             HAVING COUNT(*) > 1
           ) rounds
             ON rounds.organization = a.organization
            AND rounds.business_round = a.business_round
         )`,
    ),
    d1.prepare(
      `INSERT INTO budget_name_members
        (group_id, entity_type, entity_id, original_name, alias_key,
         active, linked_at, unlinked_at)
       SELECT
         a.budget_group_id,
         'activity',
         a.id,
         COALESCE(NULLIF(a.budget_original_name, ''), a.budget_type),
         LOWER(REPLACE(REPLACE(REPLACE(REPLACE(
           COALESCE(NULLIF(a.budget_original_name, ''), a.budget_type),
           ' ', ''), '-', ''), '_', ''), '·', '')),
         1,
         CURRENT_TIMESTAMP,
         NULL
       FROM activities a
       INNER JOIN (
         SELECT organization, business_round
         FROM activities
         GROUP BY organization, business_round
         HAVING COUNT(*) > 1
       ) rounds
         ON rounds.organization = a.organization
        AND rounds.business_round = a.business_round
       WHERE a.budget_group_id IS NOT NULL
         AND COALESCE(a.award_status, '미정')
           NOT IN ('협력사 수주', '타업체 수주')
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         group_id = excluded.group_id,
         original_name = excluded.original_name,
         alias_key = excluded.alias_key,
         active = 1,
         linked_at = CURRENT_TIMESTAMP,
         unlinked_at = NULL`,
    ),
    d1
      .prepare(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES (?, ?, NULL, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_by = NULL,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(
        businessRoundBudgetRetrofitKey,
        JSON.stringify({ completed: true, mode: "single-d1-batch" }),
      ),
  ]);
}

async function enrichInstitutionMatchCandidates(
  d1: ReturnType<typeof getD1>,
  candidates: ReturnType<typeof findSimilarInstitutionMatches>,
) {
  return Promise.all(
    candidates.map(async (candidate) => {
      try {
        const details = await d1
          .prepare(
            `WITH target AS (SELECT ? AS organization)
             SELECT
               COALESCE(NULLIF(l.region, ''), NULLIF(a.region, ''), NULLIF(d.region, ''), '') AS region,
               COALESCE(NULLIF(l.road_address, ''), NULLIF(l.address, ''), NULLIF(d.address, ''), '') AS address,
               COALESCE(d.school_code, '') AS school_code,
               COALESCE(NULLIF(d.phone, ''), NULLIF(a.contact_phone, ''), '') AS phone,
               COALESCE(d.name, '') AS official_name
             FROM target t
             LEFT JOIN organization_locations l
               ON l.organization = t.organization
             LEFT JOIN activities a
               ON a.id = (
                 SELECT id
                 FROM activities
                 WHERE organization = t.organization
                 ORDER BY activity_date DESC, id DESC
                 LIMIT 1
               )
             LEFT JOIN organization_school_links sl
               ON sl.organization = t.organization
             LEFT JOIN official_school_directory d
               ON d.school_code = sl.school_code
               OR (sl.school_code IS NULL AND d.name = t.organization)
             LIMIT 1`,
          )
          .bind(candidate.organization)
          .first<{
            region: string;
            address: string;
            school_code: string;
            phone: string;
            official_name: string;
          }>();
        return {
          ...candidate,
          region: clean(details?.region),
          address: clean(details?.address),
          schoolCode: clean(details?.school_code),
          phone: clean(details?.phone),
          officialName: clean(details?.official_name),
        };
      } catch {
        return candidate;
      }
    }),
  );
}

function mergeInstitutionMatchCandidates(
  ...candidateGroups: Array<ReturnType<typeof findSimilarInstitutionMatches>>
) {
  const merged = new Map<
    string,
    ReturnType<typeof findSimilarInstitutionMatches>[number]
  >();
  candidateGroups.flat().forEach((candidate) => {
    const key = institutionAliasKey(candidate.organization);
    if (!key) return;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, candidate);
      return;
    }
    merged.set(key, {
      ...previous,
      score: Math.max(previous.score, candidate.score),
      reasons: [...new Set([...previous.reasons, ...candidate.reasons])],
    });
  });
  return [...merged.values()].sort(
    (left, right) =>
      right.score - left.score ||
      left.organization.localeCompare(right.organization, "ko-KR"),
  );
}

export async function resolveInstitutionName(
  d1: ReturnType<typeof getD1>,
  payload: Record<string, unknown>,
) {
  const requestedInput = canonicalInstitutionName(payload.organization);
  if (!requestedInput) return "";
  if (
    payload.skipOfficialSchoolLookup === true &&
    payload.institutionSeparate === true
  ) {
    return requestedInput;
  }
  const officialSchool =
    payload.skipOfficialSchoolLookup === true
      ? null
      : await resolveOfficialSchoolName(
          requestedInput,
          clean(payload.region),
        );
  const requested = officialSchool?.name
    ? canonicalInstitutionName(officialSchool.name)
    : requestedInput;
  const requestedInstitutionDetails = {
    region: clean(payload.region) || clean(officialSchool?.region),
    address: clean(payload.address) || clean(officialSchool?.address),
    schoolCode: clean(officialSchool?.schoolCode),
    phone: clean(payload.contactPhone) || clean(officialSchool?.phone),
    officialName: clean(officialSchool?.name),
  };

  const organizationRows = await d1
    .prepare(
      `SELECT
         organization, region, contact_name, contact_phone, contact_email,
         progress_manager, topic, summary
       FROM activities
       WHERE organization <> ''
       ORDER BY activity_date DESC, id DESC`,
    )
    .all<{
      organization: string;
      region: string;
      contact_name: string;
      contact_phone: string;
      contact_email: string;
      progress_manager: string;
      topic: string;
      summary: string;
    }>();
  const existing = organizationRows.results
    .map((row) => clean(row.organization))
    .filter(Boolean);
  const existingContexts: InstitutionMatchContext[] =
    organizationRows.results.map((row) => ({
      organization: clean(row.organization),
      region: clean(row.region),
      contactName: clean(row.contact_name),
      contactPhone: clean(row.contact_phone),
      contactEmail: clean(row.contact_email),
      progressManager: clean(row.progress_manager),
      topic: clean(row.topic),
      summary: clean(row.summary),
    }));
  const aliasSetting = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
    .bind(INSTITUTION_ALIASES_SETTING_KEY)
    .first<{ value: string }>();
  const existingKeys = new Set(existing.map((value) => institutionAliasKey(value)));
  const rememberedCandidates = rememberedInstitutionAliasCandidates(
    requestedInput,
    aliasSetting?.value,
  ).filter((candidate) =>
    existingKeys.has(institutionAliasKey(candidate.canonical)),
  );

  if (payload.institutionSeparate === true) {
    const relationship = String(payload.institutionRelationship ?? "");
    if (relationship === "related" && payload.relatedOrganization) {
      await rememberInstitutionDecision(
        d1,
        requested,
        payload.relatedOrganization,
        "related",
      );
    }
    if (relationship === "different") {
      const rejected = Array.isArray(payload.institutionRejectedOrganizations)
        ? payload.institutionRejectedOrganizations
        : payload.relatedOrganization
          ? [payload.relatedOrganization]
          : [];
      await Promise.all(
        rejected.slice(0, 5).map((candidate) =>
          rememberInstitutionDecision(
            d1,
            requested,
            candidate,
            "different" as InstitutionRelationshipDecision,
          ),
        ),
      );
    }
    return requested;
  }

  const confirmed = canonicalInstitutionName(payload.confirmedOrganization);
  if (confirmed) {
    const confirmedKey = institutionAliasKey(confirmed);
    const confirmedAliases = existing.filter(
      (value) => institutionAliasKey(value) === confirmedKey,
    );
    if (!confirmedAliases.length) return requested;
    const requestedContext: InstitutionMatchContext = {
      organization: requested,
      region: clean(payload.region),
      contactName: clean(payload.contactName),
      contactPhone: clean(payload.contactPhone),
      contactEmail: clean(payload.contactEmail),
      progressManager: clean(payload.progressManager),
      topic: clean(payload.topic),
      summary: clean(payload.summary),
    };
    const confirmedContexts = existingContexts.filter(
      (context) => institutionAliasKey(context.organization) === confirmedKey,
    );
    const isExactAlias = confirmedKey === institutionAliasKey(requested);
    const isNameCandidate = findSimilarInstitutionNames(requested, [
      ...confirmedAliases,
    ]).some(
      (organization) => institutionAliasKey(organization) === confirmedKey,
    );
    const isContextualNameCandidate = findSimilarInstitutionMatches(
      requestedContext,
      confirmedContexts,
      Math.max(confirmedContexts.length, 1),
    ).some(
      (candidate) => institutionAliasKey(candidate.organization) === confirmedKey,
    );
    const isRememberedAlias = rememberedCandidates.some(
      (candidate) =>
        institutionAliasKey(candidate.canonical) === confirmedKey,
    );
    if (
      isExactAlias ||
      isNameCandidate ||
      isContextualNameCandidate ||
      isRememberedAlias
    ) {
      return confirmedAliases.length
        ? preferFullInstitutionName(...confirmedAliases)
        : confirmed;
    }
    return requested;
  }

  if (rememberedCandidates.length) {
    const grouped = new Map<
      string,
      { organization: string; regions: Set<string> }
    >();
    rememberedCandidates.forEach((candidate) => {
      const canonicalKey = institutionAliasKey(candidate.canonical);
      const canonicalAliases = existing.filter(
        (value) => institutionAliasKey(value) === canonicalKey,
      );
      const organization = canonicalAliases.length
        ? preferFullInstitutionName(...canonicalAliases)
        : candidate.canonical;
      const entry = grouped.get(canonicalKey) ?? {
        organization,
        regions: new Set<string>(),
      };
      if (candidate.region) entry.regions.add(candidate.region);
      existingContexts
        .filter(
          (context) =>
            institutionAliasKey(context.organization) === canonicalKey &&
            context.region,
        )
        .forEach((context) => entry.regions.add(clean(context.region)));
      grouped.set(canonicalKey, entry);
    });

    const aliasGroups = [...grouped.values()];
    const requestedRegion = clean(payload.region);
    const regionMatches = requestedRegion
      ? aliasGroups.filter((candidate) =>
          [...candidate.regions].some((region) =>
            sameInstitutionRegion(requestedRegion, region),
          ),
        )
      : [];
    const candidatesToConfirm = (
      regionMatches.length ? regionMatches : aliasGroups
    ).map((candidate) => ({
      organization: candidate.organization,
      reasons: [
        "이전에 같은 기관으로 확인됨",
        ...(candidate.regions.size
          ? [`등록 지역: ${[...candidate.regions].join(", ")}`]
          : []),
      ],
      score: 100,
    }));

    if (regionMatches.length === 1) {
      return regionMatches[0]?.organization ?? requested;
    }
    if (
      !requestedRegion &&
      aliasGroups.length === 1
    ) {
      return aliasGroups[0]?.organization ?? requested;
    }
    if (
      requestedRegion &&
      aliasGroups.length === 1 &&
      aliasGroups[0]?.regions.size === 0
    ) {
      return aliasGroups[0]?.organization ?? requested;
    }
    if (
      (!requestedRegion && aliasGroups.length > 1) ||
      regionMatches.length > 1
    ) {
      throw new InstitutionConfirmationRequiredError(
        requestedInput,
        candidatesToConfirm,
      );
    }
  }

  const requestedInputKey = institutionAliasKey(requestedInput);
  const exactInputAliases = existing.filter(
    (value) => institutionAliasKey(value) === requestedInputKey,
  );
  if (exactInputAliases.length) {
    return preferFullInstitutionName(...exactInputAliases);
  }

  const intentionalRename =
    payload.confirmInstitutionRename === true &&
    Boolean(clean(payload.sourceOrganization));
  if (!intentionalRename) {
    const requestedContext: InstitutionMatchContext = {
      organization: requestedInput,
      region: requestedInstitutionDetails.region,
      address: requestedInstitutionDetails.address,
      schoolCode: requestedInstitutionDetails.schoolCode,
      contactName: clean(payload.contactName),
      contactPhone: requestedInstitutionDetails.phone,
      contactEmail: clean(payload.contactEmail),
      progressManager: clean(payload.progressManager),
      topic: clean(payload.topic),
      summary: clean(payload.summary),
    };
    const inputMatches = findSimilarInstitutionMatches(
      requestedContext,
      existingContexts,
      8,
    );
    const officialMatches =
      institutionAliasKey(requested) !== requestedInputKey
        ? findSimilarInstitutionMatches(
            { ...requestedContext, organization: requested },
            existingContexts,
            8,
          )
        : [];
    const officialExactMatches = existing
      .filter(
        (organization) =>
          institutionAliasKey(organization) === institutionAliasKey(requested) &&
          institutionAliasKey(organization) !== requestedInputKey,
      )
      .map((organization) => ({
        organization,
        reasons: ["교육청 공식 학교명과 일치"],
        score: 80,
      }));
    const excludedKeys = await excludedInstitutionCandidates(
      d1,
      requestedInput,
    );
    const candidatesToConfirm = mergeInstitutionMatchCandidates(
      inputMatches,
      officialMatches,
      officialExactMatches,
    )
      .filter(
        (candidate) =>
          !excludedKeys.has(institutionAliasKey(candidate.organization)),
      )
      .slice(0, 5);
    if (candidatesToConfirm.length) {
      throw new InstitutionConfirmationRequiredError(
        requestedInput,
        await enrichInstitutionMatchCandidates(d1, candidatesToConfirm),
        requestedInstitutionDetails,
      );
    }
  }

  const requestedKey = institutionAliasKey(requested);
  const exactAliases = existing.filter(
    (value) => institutionAliasKey(value) === requestedKey,
  );
  const resolvedRequested = exactAliases.length
    ? preferFullInstitutionName(...exactAliases)
    : requested;

  return resolvedRequested;
}

export function serializeProgressSchedule(value: unknown) {
  if (!Array.isArray(value)) return clean(value);
  return value
    .slice(0, 50)
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const entry = item as Record<string, unknown>;
      const label = clean(entry.label) || clean(entry.name) || "진행";
      const date = clean(entry.date);
      return date ? `${label}\t${date}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

type ProgressScheduleEntry = {
  label: string;
  date: string;
};

export function koreaTodayValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function parseProgressScheduleEntries(
  value: string,
): ProgressScheduleEntry[] {
  const currentYear = Number(koreaTodayValue().slice(0, 4));
  const datePattern =
    /(?:(\d{4})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})|(\d{1,2})\s*(?:[./]|월)\s*(\d{1,2}))\s*일?/g;
  const entries: ProgressScheduleEntry[] = [];
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
    if (!entries.some((entry) => entry.label === label && entry.date === date)) {
      entries.push({ label, date });
    }
  }
  return entries.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.label.localeCompare(right.label, "ko-KR"),
  );
}

function progressScheduleLabelKey(label: string) {
  return label
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "")
    .replace(/(?:일정|예정|진행)$/g, "");
}

/** 새 채팅에 같은 일정명이 들어오면 날짜를 교체하고, 다른 일정은 유지합니다. */
export function mergeProgressSchedules(previous: unknown, incoming: unknown) {
  const previousItems = parseProgressScheduleEntries(
    serializeProgressSchedule(previous),
  );
  const incomingItems = parseProgressScheduleEntries(
    serializeProgressSchedule(incoming),
  );
  if (!incomingItems.length) return serializeProgressSchedule(previous);
  const merged = new Map(
    previousItems.map((item) => [progressScheduleLabelKey(item.label), item]),
  );
  incomingItems.forEach((item) =>
    merged.set(progressScheduleLabelKey(item.label), item),
  );
  return [...merged.values()]
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.label.localeCompare(right.label, "ko-KR"),
    )
    .map((item) => `${item.label}\t${item.date}`)
    .join("\n");
}

export function resolveProgressScheduleManagement(
  payload: Record<string, unknown>,
  todayValue = koreaTodayValue(),
) {
  const progressSchedule = serializeProgressSchedule(payload.progressSchedule);
  const requestedStatus = normalizeSalesProgress(clean(payload.status));
  const requestedAwardStatus = clean(payload.awardStatus) || "미정";
  const requestedAwardStage = normalizeAwardStage(
    payload.awardStage,
    requestedAwardStatus,
  );
  const statusManual = payload.statusManual === true;
  const awardStageManual = payload.awardStageManual === true;
  if (!progressSchedule) {
    const status = normalizeSalesProgress(requestedStatus, requestedAwardStatus);
    return {
      progressSchedule,
      status,
      awardStatus: requestedAwardStatus,
      awardStage: requestedAwardStage,
    };
  }

  const entries = parseProgressScheduleEntries(progressSchedule);
  const dueEntries = entries.filter((entry) => entry.date < todayValue);
  const hasCurrentOrFutureSchedule = entries.some(
    (entry) => entry.date >= todayValue,
  );
  const constructionCompleted = dueEntries.some((entry) =>
    /완공|준공|설치\s*완료|시공\s*완료|공사\s*완료|납품\s*완료/.test(
      entry.label,
    ),
  );
  const inspectionCompleted = dueEntries.some((entry) =>
    /검수(?:\s*완료)?/.test(entry.label),
  );
  const trainingCompleted = dueEntries.some((entry) =>
    /교육(?:\s*완료)?/.test(entry.label),
  );
  const inspectionOrTrainingScheduled = entries.some((entry) =>
    /검수|교육/.test(entry.label),
  );
  const explicitlyDelivered = dueEntries.some((entry) =>
    /납품\s*완료|최종\s*완료|사업\s*종료|검수.*교육.*완료|교육.*검수.*완료/.test(
      entry.label,
    ),
  );

  let status = normalizeSalesProgress(requestedStatus, requestedAwardStatus);
  let awardStage = hasCurrentOrFutureSchedule
    ? "일정 조율"
    : "설치·공사 진행";
  if (
    explicitlyDelivered ||
    (constructionCompleted && inspectionCompleted && trainingCompleted)
  ) {
    status = "수주 전환";
    awardStage = COMPLETED_AWARD_STAGE;
  } else if (constructionCompleted || inspectionOrTrainingScheduled) {
    status = "수주 전환";
    awardStage = "검수·교육 진행";
  } else if (entries.length > 0 && !hasCurrentOrFutureSchedule) {
    status = "수주 전환";
  }

  return {
    progressSchedule,
    status:
      statusManual || awardStageManual ? requestedStatus : status,
    awardStatus: requestedAwardStatus,
    awardStage: awardStageManual ? requestedAwardStage : awardStage,
  };
}

export function resolveAward(payload: Record<string, unknown>) {
  const requested = clean(payload.awardStatus);
  const awardStatus = ["미정", "위즈업 수주", "협력사 수주", "타업체 수주"].includes(requested)
    ? requested
    : "미정";
  const requestedCompany = clean(payload.awardCompany);
  if (["협력사 수주", "타업체 수주"].includes(awardStatus) && !requestedCompany) {
    throw new Error("협력사·타업체 수주일 때 수주업체는 필수입니다.");
  }
  return {
    awardStatus,
    awardCompany:
      awardStatus === "위즈업 수주"
        ? "위즈업"
        : ["협력사 수주", "타업체 수주"].includes(awardStatus)
          ? requestedCompany
          : "",
  };
}

export function resolveAwardManagement(payload: Record<string, unknown>) {
  if (clean(payload.awardStatus) === "타업체 수주") {
    return {
      executionType: "해당 없음",
      consortiumCompany: "",
      awardStage: "해당 없음",
    };
  }
  const requestedExecutionType = clean(payload.executionType);
  const executionType =
    requestedExecutionType === "컨소" ? "컨소" : "직영";
  const consortiumCompany = clean(payload.consortiumCompany);
  if (executionType === "컨소" && !consortiumCompany) {
    throw new Error("컨소 사업일 때 업체명은 필수입니다.");
  }
  const awardStage = normalizeAwardStage(payload.awardStage);
  return {
    executionType,
    consortiumCompany: executionType === "컨소" ? consortiumCompany : "",
    awardStage,
  };
}

let recordsReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function initializeRecords() {
  const d1 = getD1();
  await ensureCollaborationReady();
  await d1.batch([
    d1.prepare(createTableSql),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS activities_follow_up_idx ON activities (follow_up_required, follow_up_date)",
    ),
  ]);

  const columnInfo = await d1
    .prepare("PRAGMA table_info(activities)")
    .all<{ name: string }>();
  const existingColumns = new Set(columnInfo.results.map((column) => column.name));
  const upgrades = [];
  if (!existingColumns.has("award_status")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN award_status TEXT NOT NULL DEFAULT '미정'",
      ),
    );
  }
  if (!existingColumns.has("award_company")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN award_company TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  if (!existingColumns.has("execution_type")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN execution_type TEXT NOT NULL DEFAULT '직영'",
      ),
    );
  }
  if (!existingColumns.has("consortium_company")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN consortium_company TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  if (!existingColumns.has("award_stage")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN award_stage TEXT NOT NULL DEFAULT '미정'",
      ),
    );
  }
  if (!existingColumns.has("award_completed_date")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN award_completed_date TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  if (!existingColumns.has("business_round")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN business_round INTEGER NOT NULL DEFAULT 1",
      ),
    );
  }
  if (!existingColumns.has("progress_manager")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN progress_manager TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  if (!existingColumns.has("progress_manager_locked")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN progress_manager_locked INTEGER NOT NULL DEFAULT 0",
      ),
    );
  }
  if (!existingColumns.has("progress_schedule")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN progress_schedule TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  if (!existingColumns.has("contact_method")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN contact_method TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  if (!existingColumns.has("region")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN region TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  if (!existingColumns.has("budget_type")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN budget_type TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  if (!existingColumns.has("budget_amount")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN budget_amount TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  if (!existingColumns.has("contact_role")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN contact_role TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  if (!existingColumns.has("contacts_json")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN contacts_json TEXT NOT NULL DEFAULT '[]'",
      ),
    );
  }
  if (!existingColumns.has("detail_level")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN detail_level TEXT NOT NULL DEFAULT 'compact'",
      ),
    );
  }
  if (!existingColumns.has("detail_summary")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN detail_summary TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  if (!existingColumns.has("detail_key_facts_json")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN detail_key_facts_json TEXT NOT NULL DEFAULT '[]'",
      ),
    );
  }
  if (!existingColumns.has("detail_sections_json")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN detail_sections_json TEXT NOT NULL DEFAULT '[]'",
      ),
    );
  }
  if (!existingColumns.has("raw_input")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN raw_input TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  if (!existingColumns.has("budgets_json")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN budgets_json TEXT NOT NULL DEFAULT '[]'",
      ),
    );
  }
  if (!existingColumns.has("updated_by_member_id")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN updated_by_member_id INTEGER",
      ),
    );
  }
  if (!existingColumns.has("updated_by_name")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN updated_by_name TEXT NOT NULL DEFAULT ''",
      ),
    );
  }
  const addedStatusManual = !existingColumns.has("status_manual");
  if (addedStatusManual) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN status_manual INTEGER NOT NULL DEFAULT 0",
      ),
    );
  }
  if (upgrades.length) await d1.batch(upgrades);
  if (addedStatusManual) {
    await d1.prepare("UPDATE activities SET status_manual = 1").run();
  }
  await d1
    .prepare(
      "UPDATE activities SET execution_type = '직영', consortium_company = '' WHERE execution_type IS NULL OR execution_type = '' OR execution_type = '미정'",
    )
    .run();
  await d1
    .prepare(
      "CREATE INDEX IF NOT EXISTS activities_award_idx ON activities (award_status, organization)",
    )
    .run();
  const retiredAiStorage = await d1
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_recommendations'",
    )
    .first<{ name: string }>();
  if (retiredAiStorage) {
    await d1.prepare("DELETE FROM ai_recommendations").run();
  }
  await ensureBudgetNamesReady();
  if (!isPostgresDatabase()) {
    await retrofitBusinessRoundBudgets(d1);
    await backfillHistoricalProgressManagersFromLatestAuthors(d1);
    await repairAutoBackfilledOwnerProgressManagers(d1);
  }

  return d1;
}

export function ensureRecordsReady() {
  if (!recordsReadyPromise) {
    recordsReadyPromise = initializeRecords().catch((error) => {
      recordsReadyPromise = null;
      throw error;
    });
  }
  return recordsReadyPromise;
}

export async function insertActivity(
  payload: Record<string, unknown>,
  member: Member,
  defaultSource: string,
) {
  const d1 = await ensureRecordsReady();
  const organization = await resolveInstitutionName(d1, payload);
  const sourceOrganization =
    clean(payload.sourceOrganization) || clean(payload.organization);
  const finalizedText = (value: unknown) =>
    replaceOrganizationReferences(value, sourceOrganization, organization);
  const activityType = normalizeActivityType(payload.activityType);
  if (!organization || !activityType) {
    throw new Error("기관명과 활동유형은 필수입니다.");
  }
  const lightweightSystemRecord = payload.skipInstitutionStateLookup === true;
  const requestedBusinessRound = Number(payload.businessRound);
  const businessRound =
    Number.isSafeInteger(requestedBusinessRound) && requestedBusinessRound > 0
      ? Math.min(99, requestedBusinessRound)
      : 1;
  const previousStateRows = lightweightSystemRecord
    ? { results: [] as InstitutionStateSnapshot[] }
    : await d1
        .prepare(
          `SELECT
         id,
         activity_date AS activityDate,
         category,
         region,
         budgets_json AS budgetsJson,
         budget_type AS budgetType,
         budget_amount AS budgetAmount,
         status,
         temperature,
         award_status AS awardStatus,
         award_company AS awardCompany,
         execution_type AS executionType,
         consortium_company AS consortiumCompany,
         award_stage AS awardStage,
         award_completed_date AS awardCompletedDate,
         progress_manager AS progressManager,
         progress_manager_locked AS progressManagerLocked,
         follow_up_required AS followUpRequired,
         follow_up_date AS followUpDate,
         next_action AS nextAction,
         progress_schedule AS progressSchedule,
         contact_role AS contactRole,
         contact_name AS contactName,
         contact_phone AS contactPhone,
         contact_email AS contactEmail
       FROM activities
       WHERE organization = ? AND business_round = ?
       ORDER BY activity_date DESC, id DESC
       LIMIT 50`,
        )
        .bind(organization, businessRound)
        .all<InstitutionStateSnapshot>();
  const previousState = mergeInstitutionStateSnapshots(
    previousStateRows.results ?? [],
  );
  const previousBusinessRoundBudgets = canonicalBusinessRoundBudgets(
    (previousStateRows.results ?? []) as Record<string, unknown>[],
  );
  const previousBudgetsJson = serializeActivityBudgets(
    previousBusinessRoundBudgets,
  );
  const inheritedPayload = inheritInstitutionState(payload, previousState);
  await ensureBudgetNamesReady();
  const requestedProgressSchedule = serializeProgressSchedule(
    payload.progressSchedule,
  );
  if (requestedProgressSchedule && previousState?.progressSchedule) {
    inheritedPayload.progressSchedule = mergeProgressSchedules(
      previousState.progressSchedule,
      requestedProgressSchedule,
    );
  }
  const scheduleManagement =
    resolveProgressScheduleManagement(inheritedPayload);
  const managedPayload = { ...inheritedPayload, ...scheduleManagement };
  const award = resolveAward(managedPayload);
  const awardManagement = resolveAwardManagement(managedPayload);
  const sourceChat = clean(payload.sourceChat) || defaultSource;
  const explicitPayloadBudgets = activityBudgetsFromRecord({
    budgets: payload.budgets,
    budgetType: payload.budgetType,
    budgetAmount: payload.budgetAmount,
    budgetOriginalName: payload.budgetOriginalName,
    budgetGroupId: payload.budgetGroupId,
  });
  const budgetsForInsert =
    previousBusinessRoundBudgets.length &&
    (sourceChat === "사이트 AI 입력" || !explicitPayloadBudgets.length)
      ? previousBusinessRoundBudgets
      : payload.budgets;
  const lockedAssignment = lightweightSystemRecord
    ? null
    : await d1
        .prepare(
          `SELECT progress_manager AS progressManager
           FROM activities
           WHERE organization = ?
             AND business_round = ?
             AND progress_manager_locked = 1
             AND TRIM(COALESCE(progress_manager, '')) NOT IN ('', '해당 없음')
           ORDER BY updated_at DESC, id DESC
           LIMIT 1`,
        )
        .bind(organization, businessRound)
        .first<{ progressManager: string }>();
  const progressManagerLocked = Boolean(clean(lockedAssignment?.progressManager));
  const primaryOwner = await isPrimaryOwner(member);
  const progressManager =
    sourceChat === "사이트 AI 입력" &&
    award.awardStatus !== "협력사 수주"
      ? progressManagerLocked
        ? clean(lockedAssignment?.progressManager)
        : member.displayName
      : primaryOwner
        ? progressManagerLocked
          ? clean(lockedAssignment?.progressManager)
          : member.isSales
            ? member.displayName
            : inheritedPayload.progressManager
        : clean(previousState?.progressManager) ||
          (member.isSales ? member.displayName : "");
  const providedBudgetMetadata =
    payload.resolvedBudgetMetadata &&
    typeof payload.resolvedBudgetMetadata === "object" &&
    clean(
      (payload.resolvedBudgetMetadata as { storedName?: unknown }).storedName,
    )
      ? (payload.resolvedBudgetMetadata as Awaited<
          ReturnType<typeof resolveBudgetRecordMetadata>
        >)
      : null;
  const resolvedBudgets =
    providedBudgetMetadata &&
    !(sourceChat === "사이트 AI 입력" && previousBusinessRoundBudgets.length)
    ? [
        {
          ...normalizeActivityBudget(payload),
          budgetType: providedBudgetMetadata.storedName,
          budgetAmount: providedBudgetMetadata.budgetAmount,
          budgetOriginalName: providedBudgetMetadata.budgetOriginalName,
          budgetGroupId: providedBudgetMetadata.budgetGroupId,
          budgetMatchStatus: providedBudgetMetadata.budgetMatchStatus,
          budgetMatchMethod: providedBudgetMetadata.budgetMatchMethod,
          budgetRequestId: providedBudgetMetadata.budgetRequestId,
          budgetKind: providedBudgetMetadata.budgetKind,
          budgetAmountMode: providedBudgetMetadata.budgetAmountMode,
          budgetAmountOverride: providedBudgetMetadata.budgetAmountOverride,
        },
      ]
    : await resolveActivityBudgetAllocations(
        d1,
        {
          ...inheritedPayload,
          budgetOriginalName:
            payload.budgetOriginalName ?? inheritedPayload.budgetType,
          budgetGroupId: payload.budgetGroupId,
          budgetMatchStatus: payload.budgetMatchStatus,
          budgetMatchMethod: payload.budgetMatchMethod,
          budgetRequestId:
            payload.budgetRequestId ?? payload.budgetNameRequestId,
          budgetKind: payload.budgetKind,
          budgetAmountMode: payload.budgetAmountMode,
          budgetInstitutionAmount:
            payload.budgetInstitutionAmount ?? inheritedPayload.budgetAmount,
          budgetAmountOverride:
            payload.budgetAmountOverride ?? payload.budgetOverrideAmount,
          budgetAmountSource: payload.budgetAmountSource,
          budgets: budgetsForInsert,
        },
        award.awardStatus,
        {
          ...inheritedPayload,
          budgetsJson: previousBudgetsJson,
        },
      );
  const budgetMetadata = resolvedBudgets[0] ??
    (await resolveBudgetRecordMetadata(d1, {
      ...inheritedPayload,
      awardStatus: award.awardStatus,
    }));
  const awardCompletedDate = resolveAwardCompletedDate({
    awardStage: awardManagement.awardStage,
    requestedDate: inheritedPayload.awardCompletedDate,
    previousDate: previousState?.awardCompletedDate,
    fallbackDate: payload.activityDate,
  });
  const registeredSalesNames = lightweightSystemRecord
    ? []
    : await listRegisteredSalesNames(d1);
  const followUpDate = clean(inheritedPayload.followUpDate);
  const followUpRequired =
    !isCompletedAwardStage(awardManagement.awardStage) &&
    inheritedPayload.followUpRequired === true &&
    Boolean(followUpDate);

  const region = lightweightSystemRecord
    ? clean(inheritedPayload.region)
    : await resolveMappedRegion(
        organization,
        clean(inheritedPayload.region),
      );
  const record = await d1
    .prepare(`
      INSERT INTO activities (
        seed_key, activity_date, date_confidence, activity_type, category, contact_method,
        region, organization, business_round, budget_type, budget_amount,
        budget_original_name, budget_group_id, budget_match_status,
        budget_match_method, budget_request_id, budget_kind,
        budget_amount_mode, budget_amount_override, budgets_json,
        topic, summary, detail_level, detail_summary, detail_key_facts_json,
        detail_sections_json, raw_input,
        status, status_manual, temperature, award_status, award_company, execution_type,
        consortium_company, award_stage, award_completed_date, progress_manager,
        progress_manager_locked,
        follow_up_required, follow_up_date, next_action, progress_schedule,
        contact_role, contact_name, contact_phone, contact_email, contacts_json,
        source_chat, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `)
    .bind(
      clean(payload.seedKey) || null,
      clean(payload.activityDate) || null,
      clean(payload.dateConfidence) || "확정",
      activityType,
      clean(inheritedPayload.category),
      clean(payload.contactMethod),
      region,
      organization,
      businessRound,
      budgetMetadata.budgetType,
      budgetMetadata.budgetAmount,
      budgetMetadata.budgetOriginalName,
      budgetMetadata.budgetGroupId,
      budgetMetadata.budgetMatchStatus,
      budgetMetadata.budgetMatchMethod,
      budgetMetadata.budgetRequestId,
      budgetMetadata.budgetKind,
      budgetMetadata.budgetAmountMode,
      budgetMetadata.budgetAmountOverride,
      serializeActivityBudgets(resolvedBudgets),
      clean(finalizedText(payload.topic)),
      compactShareSummary(finalizedText(payload.summary)),
      normalizeActivityDetailLevel(payload.detailLevel),
      clean(finalizedText(payload.detailSummary)).slice(0, 4_000),
      serializeActivityDetailFacts(payload.detailKeyFacts),
      serializeActivityDetailSections(payload.detailSections),
      clean(payload.rawInput).slice(0, 20_000),
      scheduleManagement.status,
      payload.statusManual === true ? 1 : 0,
      clean(inheritedPayload.temperature) || "중간",
      award.awardStatus,
      award.awardCompany,
      awardManagement.executionType,
      awardManagement.consortiumCompany,
      awardManagement.awardStage,
      awardCompletedDate,
      progressManagerForAward(
        award.awardStatus,
        progressManager,
        registeredSalesNames,
      ),
      progressManagerLocked ? 1 : 0,
      followUpRequired ? 1 : 0,
      followUpRequired ? followUpDate : null,
      clean(finalizedText(inheritedPayload.nextAction)),
      finalizedText(scheduleManagement.progressSchedule),
      clean(inheritedPayload.contactRole),
      clean(inheritedPayload.contactName),
      clean(inheritedPayload.contactPhone),
      clean(inheritedPayload.contactEmail),
      serializeInstitutionContacts(inheritedPayload.contacts, {
        role: clean(inheritedPayload.contactRole),
        name: clean(inheritedPayload.contactName),
        phone: clean(inheritedPayload.contactPhone),
        email: clean(inheritedPayload.contactEmail),
      }),
      sourceChat,
      clean(finalizedText(payload.notes)),
    )
    .first<Record<string, unknown>>();

  if (!record) throw new Error("기록을 저장하지 못했습니다.");
  if (payload.skipRelatedWrites !== true) {
    await d1
      .prepare(`
        INSERT OR REPLACE INTO activity_authors (
          activity_id, member_id, created_by_name, created_at
        ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `)
      .bind(Number(record.id), member.id, member.displayName)
      .run();
    await syncBusinessProgressManagerFromLatestAuthor(
      d1,
      organization,
      businessRound,
    );
    await linkBudgetNameEntity(d1, {
      entityType: "activity",
      entityId: Number(record.id),
      groupId: budgetMetadata.budgetGroupId,
      originalName: budgetMetadata.budgetOriginalName,
      aliasKey: normalizeBudgetNameKey(budgetMetadata.budgetOriginalName),
    });
    if (budgetMetadata.budgetRequestId) {
      await linkBudgetRequestRecord(d1, {
        requestId: budgetMetadata.budgetRequestId,
        entityType: "activity",
        entityId: Number(record.id),
        originalName: budgetMetadata.budgetOriginalName,
        organization,
      });
    }
    if (payload.syncBusinessRoundBudgets === true) {
      await synchronizeBusinessRoundBudgets(
        d1,
        organization,
        businessRound,
        resolvedBudgets,
      );
    }
  }
  return {
    ...record,
    created_by_name: member.displayName,
  } as Record<string, unknown> & { created_by_name: string };
}

export async function syncProgressScheduleStatuses() {
  const d1 = await ensureRecordsReady();
  const scheduled = await d1
    .prepare(
      `SELECT
        id, status, status_manual, award_status, award_company, award_stage,
        award_completed_date, progress_schedule
       FROM activities
       WHERE progress_schedule <> ''`,
    )
    .all<{
      id: number;
      status: string;
      status_manual: number;
      award_status: string;
      award_company: string;
      award_stage: string;
      award_completed_date: string;
      progress_schedule: string;
    }>();
  const updates = scheduled.results.flatMap((record) => {
    const managed = resolveProgressScheduleManagement({
      status: record.status,
      statusManual: record.status_manual === 1,
      awardStatus: record.award_status,
      awardStage: record.award_stage,
      progressSchedule: record.progress_schedule,
    });
    const awardCompany =
      managed.awardStatus === "위즈업 수주"
        ? "위즈업"
        : record.award_company;
    const latestDueScheduleDate =
      parseProgressScheduleEntries(record.progress_schedule)
        .filter((entry) => entry.date < koreaTodayValue())
        .at(-1)?.date || koreaTodayValue();
    const awardCompletedDate = resolveAwardCompletedDate({
      awardStage: managed.awardStage,
      previousDate: record.award_completed_date,
      fallbackDate: latestDueScheduleDate,
    });
    if (
      managed.status === record.status &&
      managed.awardStatus === record.award_status &&
      managed.awardStage === record.award_stage &&
      awardCompletedDate === record.award_completed_date &&
      awardCompany === record.award_company
    ) {
      return [];
    }
    return [
      d1
        .prepare(
          `UPDATE activities
           SET status = ?, award_status = ?, award_company = ?, award_stage = ?,
               award_completed_date = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          managed.status,
          managed.awardStatus,
          awardCompany,
          managed.awardStage,
          awardCompletedDate,
          record.id,
        ),
    ];
  });
  if (updates.length) await d1.batch(updates);
  return updates.length;
}
