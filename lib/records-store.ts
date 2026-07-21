import { getD1 } from "../db";
import type { Member } from "./collaboration";
import { ensureCollaborationReady } from "./collaboration";
import {
  canonicalInstitutionName,
  findSimilarInstitutionMatches,
  findSimilarInstitutionNames,
  INSTITUTION_ALIASES_SETTING_KEY,
  institutionAliasKey,
  isSameRegionInstitution,
  rememberedInstitutionAlias,
  type InstitutionMatchCandidate,
  type InstitutionMatchContext,
  InstitutionConfirmationRequiredError,
  preferFullInstitutionName,
} from "./institution-names";
import { resolveMappedRegion } from "./map-store";
import {
  canonicalProgressManagerName,
  listRegisteredSalesNames,
} from "./sales-manager-normalization";
import {
  compactShareSummary,
  replaceOrganizationReferences,
} from "./share-text";
import { resolveOfficialSchoolName } from "./school-directory";
import {
  excludedInstitutionCandidates,
  rememberInstitutionDecision,
  type InstitutionRelationshipDecision,
} from "./institution-decisions";

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
    budget_type TEXT NOT NULL DEFAULT '',
    budget_amount TEXT NOT NULL DEFAULT '',
    topic TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '진행 중',
    temperature TEXT NOT NULL DEFAULT '중간',
    award_status TEXT NOT NULL DEFAULT '미정',
    award_company TEXT NOT NULL DEFAULT '',
    execution_type TEXT NOT NULL DEFAULT '직영',
    consortium_company TEXT NOT NULL DEFAULT '',
    award_stage TEXT NOT NULL DEFAULT '미정',
    progress_manager TEXT NOT NULL DEFAULT '',
    follow_up_required INTEGER NOT NULL DEFAULT 1,
    follow_up_date TEXT,
    next_action TEXT NOT NULL DEFAULT '',
    progress_schedule TEXT NOT NULL DEFAULT '',
    contact_role TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    source_chat TEXT NOT NULL DEFAULT 'ChatGPT 전체 내보내기',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

export function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function resolveInstitutionName(
  d1: ReturnType<typeof getD1>,
  payload: Record<string, unknown>,
) {
  const requestedInput = canonicalInstitutionName(payload.organization);
  if (!requestedInput) return "";
  const officialSchool = await resolveOfficialSchoolName(
    requestedInput,
    clean(payload.region),
  );
  const requested = officialSchool?.name
    ? canonicalInstitutionName(officialSchool.name)
    : requestedInput;

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
    if (isExactAlias || isNameCandidate || isContextualNameCandidate) {
      return confirmedAliases.length
        ? preferFullInstitutionName(...confirmedAliases)
        : confirmed;
    }
    return requested;
  }

  const excludedCandidateKeys =
    payload.institutionSeparate !== true
      ? await excludedInstitutionCandidates(d1, requested)
      : new Set<string>();

  if (payload.institutionSeparate !== true) {
    const aliasSetting = await d1
      .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
      .bind(INSTITUTION_ALIASES_SETTING_KEY)
      .first<{ value: string }>();
    const remembered = rememberedInstitutionAlias(
      requested,
      aliasSetting?.value,
    );
    if (remembered) {
      const rememberedKey = institutionAliasKey(remembered);
      const rememberedOrganizations = existing.filter(
        (organization) =>
          institutionAliasKey(organization) === rememberedKey,
      );
      if (rememberedOrganizations.length) {
        return preferFullInstitutionName(...rememberedOrganizations);
      }
    }
  }

  const requestedKey = institutionAliasKey(requested);
  const exactAliases = existing.filter(
    (value) => institutionAliasKey(value) === requestedKey,
  );
  const resolvedRequested = exactAliases.length
    ? preferFullInstitutionName(...exactAliases)
    : requested;

  if (payload.institutionSeparate !== true) {
    const contextualCandidates = findSimilarInstitutionMatches(
      {
        organization: requested,
        region: clean(payload.region),
        contactName: clean(payload.contactName),
        contactPhone: clean(payload.contactPhone),
        contactEmail: clean(payload.contactEmail),
        progressManager: clean(payload.progressManager),
        topic: clean(payload.topic),
        summary: clean(payload.summary),
      },
      existingContexts,
    );
    const nameCandidates: InstitutionMatchCandidate[] =
      findSimilarInstitutionNames(requested, existing).map((organization) => ({
        organization,
        reasons: ["기관명이 비슷함"],
        score: 3,
      }));
    const candidateMap = new Map<string, InstitutionMatchCandidate>();
    [...contextualCandidates, ...nameCandidates].forEach((candidate) => {
      const key = institutionAliasKey(candidate.organization);
      const previous = candidateMap.get(key);
      if (!previous) {
        candidateMap.set(key, candidate);
        return;
      }
      candidateMap.set(key, {
        organization:
          candidate.score > previous.score
            ? candidate.organization
            : previous.organization,
        reasons: [...new Set([...previous.reasons, ...candidate.reasons])],
        score: Math.max(previous.score, candidate.score),
      });
    });
    const candidates = [...candidateMap.values()]
      .filter(
        (candidate) =>
          !excludedCandidateKeys.has(institutionAliasKey(candidate.organization)),
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.organization.localeCompare(right.organization, "ko-KR"),
      )
      .slice(0, 3);
    if (candidates.length) {
      throw new InstitutionConfirmationRequiredError(requested, candidates);
    }
  }
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

export function resolveProgressScheduleManagement(
  payload: Record<string, unknown>,
  todayValue = koreaTodayValue(),
) {
  const progressSchedule = serializeProgressSchedule(payload.progressSchedule);
  const requestedStatus = clean(payload.status) || "진행 중";
  const requestedAwardStatus = clean(payload.awardStatus) || "미정";
  const requestedAwardStage = clean(payload.awardStage) || "미정";
  if (!progressSchedule) {
    return {
      progressSchedule,
      status: requestedStatus,
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
  const latestDueLabel = dueEntries.at(-1)?.label ?? "";

  let status = "진행 중";
  let awardStage = "일정 조율";
  if (constructionCompleted && inspectionCompleted && trainingCompleted) {
    status = "완료";
    awardStage = "완공";
  } else if (entries.length > 0 && !hasCurrentOrFutureSchedule) {
    status = "결과 확인";
    if (/검수/.test(latestDueLabel)) awardStage = "검수";
    if (/교육/.test(latestDueLabel)) awardStage = "교육";
  }

  return {
    progressSchedule,
    status,
    awardStatus:
      requestedAwardStatus === "미정" ? "위즈업 수주" : requestedAwardStatus,
    awardStage,
  };
}

export function resolveAward(payload: Record<string, unknown>) {
  const requested = clean(payload.awardStatus);
  const awardStatus = ["미정", "위즈업 수주", "타업체 수주"].includes(requested)
    ? requested
    : "미정";
  const requestedCompany = clean(payload.awardCompany);
  if (awardStatus === "타업체 수주" && !requestedCompany) {
    throw new Error("타업체 수주일 때 수주 업체명은 필수입니다.");
  }
  return {
    awardStatus,
    awardCompany:
      awardStatus === "위즈업 수주"
        ? "위즈업"
        : awardStatus === "타업체 수주"
          ? requestedCompany
          : "",
  };
}

export function resolveAwardManagement(payload: Record<string, unknown>) {
  const requestedExecutionType = clean(payload.executionType);
  const executionType =
    requestedExecutionType === "컨소" ? "컨소" : "직영";
  const consortiumCompany = clean(payload.consortiumCompany);
  if (executionType === "컨소" && !consortiumCompany) {
    throw new Error("컨소 사업일 때 업체명은 필수입니다.");
  }
  const requestedAwardStage = clean(payload.awardStage);
  const awardStage = [
    "미정",
    "품의",
    "협상",
    "계약",
    "일정 조율",
    "완공",
    "검수",
    "교육",
  ].includes(requestedAwardStage)
    ? requestedAwardStage
    : "미정";
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
  if (!existingColumns.has("progress_manager")) {
    upgrades.push(
      d1.prepare(
        "ALTER TABLE activities ADD COLUMN progress_manager TEXT NOT NULL DEFAULT ''",
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
  if (upgrades.length) await d1.batch(upgrades);
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

  return d1;
}

export function ensureRecordsReady() {
  return Promise.resolve(getD1());
}

export async function insertActivity(
  payload: Record<string, unknown>,
  member: Member,
  defaultSource: string,
): Promise<Record<string, unknown> & { created_by_name: string }> {
  const d1 = await ensureRecordsReady();
  const organization = await resolveInstitutionName(d1, payload);
  const sourceOrganization =
    clean(payload.sourceOrganization) || clean(payload.organization);
  const finalizedText = (value: unknown) =>
    replaceOrganizationReferences(value, sourceOrganization, organization);
  const activityType = clean(payload.activityType);
  if (!organization || !activityType) {
    throw new Error("기관명과 활동유형은 필수입니다.");
  }
  const scheduleManagement = resolveProgressScheduleManagement(payload);
  const managedPayload = { ...payload, ...scheduleManagement };
  const award = resolveAward(managedPayload);
  const awardManagement = resolveAwardManagement(managedPayload);
  const registeredSalesNames = await listRegisteredSalesNames(d1);

  const region = await resolveMappedRegion(
    organization,
    clean(payload.region),
  );
  const record = await d1.transaction(async (transaction) => {
    const saved = await transaction
      .prepare(`
        INSERT INTO activities (
          activity_date, date_confidence, activity_type, category, contact_method,
          region, organization, budget_type, budget_amount, topic, summary,
          status, temperature, award_status, award_company, execution_type,
          consortium_company, award_stage, progress_manager,
          follow_up_required, follow_up_date, next_action, progress_schedule,
          contact_role, contact_name, contact_phone, contact_email, source_chat, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `)
      .bind(
        clean(payload.activityDate) || null,
        clean(payload.dateConfidence) || "확정",
        activityType,
        clean(payload.category) || "기타",
        clean(payload.contactMethod),
        region,
        organization,
        clean(payload.budgetType),
        clean(payload.budgetAmount),
        clean(finalizedText(payload.topic)),
        compactShareSummary(finalizedText(payload.summary)),
        scheduleManagement.status,
        clean(payload.temperature) || "중간",
        award.awardStatus,
        award.awardCompany,
        awardManagement.executionType,
        awardManagement.consortiumCompany,
        awardManagement.awardStage,
        canonicalProgressManagerName(
          payload.progressManager,
          registeredSalesNames,
        ),
        payload.followUpRequired === false ? 0 : 1,
        clean(payload.followUpDate) || null,
        clean(finalizedText(payload.nextAction)),
        finalizedText(scheduleManagement.progressSchedule),
        clean(payload.contactRole),
        clean(payload.contactName),
        clean(payload.contactPhone),
        clean(payload.contactEmail),
        clean(payload.sourceChat) || defaultSource,
        clean(finalizedText(payload.notes)),
      )
      .first<Record<string, unknown>>();

    if (!saved) throw new Error("기록을 저장하지 못했습니다.");
    await transaction
      .prepare(`
        INSERT INTO activity_authors (
          activity_id, member_id, created_by_name, created_at
        ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(activity_id) DO UPDATE SET
          member_id = EXCLUDED.member_id,
          created_by_name = EXCLUDED.created_by_name,
          created_at = EXCLUDED.created_at
      `)
      .bind(Number(saved.id), member.id, member.displayName)
      .run();
    return saved;
  });
  return {
    ...(record as Record<string, unknown>),
    created_by_name: member.displayName,
  };
}

export async function syncProgressScheduleStatuses() {
  const d1 = await ensureRecordsReady();
  const scheduled = await d1
    .prepare(
      `SELECT
        id, status, award_status, award_company, award_stage, progress_schedule
       FROM activities
       WHERE progress_schedule <> ''`,
    )
    .all<{
      id: number;
      status: string;
      award_status: string;
      award_company: string;
      award_stage: string;
      progress_schedule: string;
    }>();
  const updates = scheduled.results.flatMap((record) => {
    const managed = resolveProgressScheduleManagement({
      status: record.status,
      awardStatus: record.award_status,
      awardStage: record.award_stage,
      progressSchedule: record.progress_schedule,
    });
    const awardCompany =
      managed.awardStatus === "위즈업 수주"
        ? "위즈업"
        : record.award_company;
    if (
      managed.status === record.status &&
      managed.awardStatus === record.award_status &&
      managed.awardStage === record.award_stage &&
      awardCompany === record.award_company
    ) {
      return [];
    }
    return [
      d1
        .prepare(
          `UPDATE activities
           SET status = ?, award_status = ?, award_company = ?, award_stage = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          managed.status,
          managed.awardStatus,
          awardCompany,
          managed.awardStage,
          record.id,
        ),
    ];
  });
  if (updates.length) await d1.batch(updates);
  return updates.length;
}
