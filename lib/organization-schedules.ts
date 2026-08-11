import { getD1, isPostgresDatabase } from "../db";
import { ensureEquipmentReady } from "./equipment-store";
import {
  CONSTRUCTION_STAGES,
  isConstructionStage,
  isValidConstructionStage,
} from "./construction-stages";
import {
  clean,
  parseProgressScheduleEntries,
  serializeProgressSchedule,
} from "./records-store";

export type OrganizationSchedule = {
  id: number;
  organization: string;
  businessRound: number;
  label: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  category: string;
  stage: string;
  endDate: string;
  vendorName: string;
  details: string;
  completed: boolean;
  sourceActivityId: number | null;
  assigneeMemberId: number | null;
  assigneeName: string;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
  googleEventId: string;
  googleOrigin: boolean;
  syncStatus: "pending" | "synced" | "failed" | "local_only";
  syncOperation: "upsert" | "delete" | "unlink" | "move-construction";
  syncError: string;
  syncAttempts: number;
  lastSyncedAt: string;
};

export type OrganizationScheduleInput = {
  id?: number;
  label: string;
  scheduledDate: string;
  startTime?: string;
  endTime?: string;
  completed?: boolean;
};

export type ConstructionScheduleInput = {
  id?: number;
  stage: string;
  scheduledDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  vendorName?: string;
  details?: string;
  completed?: boolean;
};

export type ConstructionScheduleProject = {
  id: number;
  organization: string;
  businessRound: number;
  workSummary: string;
  workSummaryMode: "auto" | "manual";
  sourceProductNames: string[];
  completed: boolean;
  hidden: boolean;
  updatedAt: string;
};

export type ConstructionScheduleSaveResult = {
  project: ConstructionScheduleProject;
  schedules: OrganizationSchedule[];
  syncIds: number[];
};

export type ConstructionDashboardCounts = {
  planned: number;
  active: number;
  completed: number;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS organization_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    label TEXT NOT NULL,
    scheduled_date TEXT NOT NULL,
    start_time TEXT NOT NULL DEFAULT '',
    end_time TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'general',
    stage TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    vendor_name TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    source_activity_id INTEGER,
    created_by INTEGER,
    created_by_name TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_by_name TEXT NOT NULL DEFAULT '',
    assignee_member_id INTEGER,
    assignee_name TEXT NOT NULL DEFAULT '',
    google_event_id TEXT NOT NULL DEFAULT '',
    google_event_etag TEXT NOT NULL DEFAULT '',
    google_origin INTEGER NOT NULL DEFAULT 0,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    sync_operation TEXT NOT NULL DEFAULT 'upsert',
    sync_error TEXT NOT NULL DEFAULT '',
    sync_attempts INTEGER NOT NULL DEFAULT 0,
    last_synced_at TEXT NOT NULL DEFAULT '',
    google_updated_at TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS organization_schedules_scope_date_idx
   ON organization_schedules (
     organization, business_round, completed, scheduled_date, id
   )`,
  `CREATE TABLE IF NOT EXISTS organization_schedule_import_state (
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization, business_round)
  )`,
  `CREATE TABLE IF NOT EXISTS construction_schedule_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    work_summary TEXT NOT NULL DEFAULT '',
    work_summary_mode TEXT NOT NULL DEFAULT 'auto',
    completed INTEGER NOT NULL DEFAULT 0,
    hidden_at TEXT NOT NULL DEFAULT '',
    created_by INTEGER,
    created_by_name TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization, business_round)
  )`,
];

const activeLocalScheduleIdentityIndex = "organization_schedules_active_local_identity_idx";
const activeLocalScheduleSemanticIdentityIndex = "organization_schedules_active_local_semantic_identity_idx";

function compactScheduleOrganizationSql(column: string) {
  return `REPLACE(LOWER(TRIM(${column})), ' ', '')`;
}

function administrativeFreeScheduleOrganizationSql(column: string) {
  return ["특별자치도", "특별자치시", "광역시", "특별시", "도", "시", "군", "구"]
    .reduce((expression, suffix) => `REPLACE(${expression}, '${suffix}', '')`, compactScheduleOrganizationSql(column));
}

function semanticScheduleLabelSql(organizationColumn: string, labelColumn: string) {
  const compactOrganization = compactScheduleOrganizationSql(organizationColumn);
  const administrativeFreeOrganization = administrativeFreeScheduleOrganizationSql(organizationColumn);
  const labelWithoutCategoryPrefix = `CASE
    WHEN INSTR(TRIM(${labelColumn}), ']') BETWEEN 1 AND 12
      THEN SUBSTR(TRIM(${labelColumn}), INSTR(TRIM(${labelColumn}), ']') + 1)
    ELSE TRIM(${labelColumn})
  END`;
  const compactLabel = `REPLACE(LOWER(${labelWithoutCategoryPrefix}), ' ', '')`;
  return `REPLACE(REPLACE(${compactLabel}, ${compactOrganization}, ''), ${administrativeFreeOrganization}, '')`;
}

const duplicateSemanticLabel = semanticScheduleLabelSql("duplicate.organization", "duplicate.label");
const keeperSemanticLabel = semanticScheduleLabelSql("keeper.organization", "keeper.label");

const removeDuplicateLocalSchedulesSql = `
  DELETE FROM organization_schedules
  WHERE id IN (
    SELECT duplicate.id
    FROM organization_schedules duplicate
    WHERE COALESCE(duplicate.category, 'general') <> 'construction'
      AND TRIM(COALESCE(duplicate.deleted_at, '')) = ''
      AND TRIM(COALESCE(duplicate.google_event_id, '')) = ''
      AND EXISTS (
        SELECT 1
        FROM organization_schedules keeper
        WHERE LOWER(TRIM(keeper.organization)) = LOWER(TRIM(duplicate.organization))
          AND keeper.business_round = duplicate.business_round
          AND LOWER(TRIM(keeper.label)) = LOWER(TRIM(duplicate.label))
          AND keeper.scheduled_date = duplicate.scheduled_date
          AND LOWER(TRIM(COALESCE(keeper.category, 'general'))) = LOWER(TRIM(COALESCE(duplicate.category, 'general')))
          AND COALESCE(keeper.category, 'general') <> 'construction'
          AND TRIM(COALESCE(keeper.deleted_at, '')) = ''
          AND (
            TRIM(COALESCE(keeper.google_event_id, '')) <> ''
            OR (
              TRIM(COALESCE(keeper.google_event_id, '')) = ''
              AND keeper.id < duplicate.id
            )
          )
      )
  )`;

const createActiveLocalScheduleIdentityIndexSql = `
  CREATE UNIQUE INDEX IF NOT EXISTS ${activeLocalScheduleIdentityIndex}
  ON organization_schedules (
    LOWER(TRIM(organization)),
    business_round,
    LOWER(TRIM(label)),
    scheduled_date,
    LOWER(TRIM(COALESCE(category, 'general')))
  )
  WHERE COALESCE(category, 'general') <> 'construction'
    AND TRIM(COALESCE(deleted_at, '')) = ''
    AND TRIM(COALESCE(google_event_id, '')) = ''`;

const removeSemanticallyDuplicateLocalSchedulesSql = `
  DELETE FROM organization_schedules
  WHERE id IN (
    SELECT duplicate.id
    FROM organization_schedules duplicate
    WHERE COALESCE(duplicate.category, 'general') <> 'construction'
      AND TRIM(COALESCE(duplicate.deleted_at, '')) = ''
      AND TRIM(COALESCE(duplicate.google_event_id, '')) = ''
      AND EXISTS (
        SELECT 1
        FROM organization_schedules keeper
        WHERE LOWER(TRIM(keeper.organization)) = LOWER(TRIM(duplicate.organization))
          AND keeper.business_round = duplicate.business_round
          AND ${keeperSemanticLabel} = ${duplicateSemanticLabel}
          AND keeper.scheduled_date = duplicate.scheduled_date
          AND LOWER(TRIM(COALESCE(keeper.category, 'general'))) = LOWER(TRIM(COALESCE(duplicate.category, 'general')))
          AND COALESCE(keeper.category, 'general') <> 'construction'
          AND TRIM(COALESCE(keeper.deleted_at, '')) = ''
          AND (
            TRIM(COALESCE(keeper.google_event_id, '')) <> ''
            OR (
              TRIM(COALESCE(keeper.google_event_id, '')) = ''
              AND keeper.id < duplicate.id
            )
          )
      )
  )`;

const createActiveLocalScheduleSemanticIdentityIndexSql = `
  CREATE UNIQUE INDEX IF NOT EXISTS ${activeLocalScheduleSemanticIdentityIndex}
  ON organization_schedules (
    LOWER(TRIM(organization)),
    business_round,
    ${semanticScheduleLabelSql("organization", "label")},
    scheduled_date,
    LOWER(TRIM(COALESCE(category, 'general')))
  )
  WHERE COALESCE(category, 'general') <> 'construction'
    AND TRIM(COALESCE(deleted_at, '')) = ''
    AND TRIM(COALESCE(google_event_id, '')) = ''`;

let schedulesReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function initializeOrganizationSchedules() {
  const d1 = getD1();
  if (isPostgresDatabase()) {
    // The shared Vercel schema migration owns these tables and columns. A
    // lightweight read both triggers that migration and avoids repeating DDL
    // from every cold dashboard function.
    await d1.prepare("SELECT 1").all();
    return d1;
  }
  // 일정 조회는 HOME 첫 화면에서 여러 API와 동시에 실행됩니다. 여기서
  // 활동 전체의 데이터 보정까지 기다리면 일정 조회 하나가 D1 쓰기 잠금을
  // 오래 잡아 다른 초기 화면 요청도 함께 멈춥니다. 일정 테이블은 독립
  // 테이블이므로 필요한 스키마만 준비하고 즉시 읽을 수 있게 합니다.
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
  const columns = await d1.prepare("PRAGMA table_info(organization_schedules)").all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["start_time", "TEXT NOT NULL DEFAULT ''"],
    ["end_time", "TEXT NOT NULL DEFAULT ''"],
    ["category", "TEXT NOT NULL DEFAULT 'general'"],
    ["stage", "TEXT NOT NULL DEFAULT ''"],
    ["end_date", "TEXT NOT NULL DEFAULT ''"],
    ["vendor_name", "TEXT NOT NULL DEFAULT ''"],
    ["details", "TEXT NOT NULL DEFAULT ''"],
    ["assignee_member_id", "INTEGER"],
    ["assignee_name", "TEXT NOT NULL DEFAULT ''"],
    ["google_event_id", "TEXT NOT NULL DEFAULT ''"],
    ["google_event_etag", "TEXT NOT NULL DEFAULT ''"],
    ["google_origin", "INTEGER NOT NULL DEFAULT 0"],
    ["sync_status", "TEXT NOT NULL DEFAULT 'pending'"],
    ["sync_operation", "TEXT NOT NULL DEFAULT 'upsert'"],
    ["sync_error", "TEXT NOT NULL DEFAULT ''"],
    ["sync_attempts", "INTEGER NOT NULL DEFAULT 0"],
    ["last_synced_at", "TEXT NOT NULL DEFAULT ''"],
    ["google_updated_at", "TEXT NOT NULL DEFAULT ''"],
    ["deleted_at", "TEXT NOT NULL DEFAULT ''"],
  ] as const;
  for (const [name, definition] of additions) {
    if (!names.has(name)) {
      await d1.prepare(`ALTER TABLE organization_schedules ADD COLUMN ${name} ${definition}`).run();
    }
  }
  const identityIndex = await d1.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1",
  ).bind(activeLocalScheduleIdentityIndex).first<{ name: string }>();
  if (!identityIndex) {
    // Keep the original/Google-linked row, remove only redundant local rows, then
    // let SQLite prevent concurrent requests from recreating the same schedule.
    await d1.prepare(removeDuplicateLocalSchedulesSql).run();
    await d1.prepare(createActiveLocalScheduleIdentityIndexSql).run();
  }
  const semanticIdentityIndex = await d1.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1",
  ).bind(activeLocalScheduleSemanticIdentityIndex).first<{ name: string }>();
  if (!semanticIdentityIndex) {
    // Treat minor institution-name variations inside generated titles as the
    // same schedule (for example 광주/광주시) while preserving distinct work.
    await d1.prepare(removeSemanticallyDuplicateLocalSchedulesSql).run();
    await d1.prepare(createActiveLocalScheduleSemanticIdentityIndexSql).run();
  }
  await d1.batch([
    d1.prepare(
      `CREATE INDEX IF NOT EXISTS organization_schedules_sync_idx
       ON organization_schedules (sync_status, sync_operation, updated_at, id)`,
    ),
    d1.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS organization_schedules_google_event_idx
       ON organization_schedules (google_event_id) WHERE google_event_id <> ''`,
    ),
  ]);
  const projectColumns = await d1.prepare("PRAGMA table_info(construction_schedule_projects)").all<{ name: string }>();
  if (!projectColumns.results.some((column) => column.name === "work_summary_mode")) {
    await d1.prepare("ALTER TABLE construction_schedule_projects ADD COLUMN work_summary_mode TEXT NOT NULL DEFAULT 'auto'").run();
  }
  if (!projectColumns.results.some((column) => column.name === "hidden_at")) {
    await d1.prepare("ALTER TABLE construction_schedule_projects ADD COLUMN hidden_at TEXT NOT NULL DEFAULT ''").run();
  }
  const duplicateLegacyScheduleIds = `
    SELECT legacy.id
    FROM organization_schedules legacy
    WHERE COALESCE(legacy.category, 'general') <> 'construction'
      AND legacy.source_activity_id IS NOT NULL
      AND TRIM(COALESCE(legacy.deleted_at, '')) = ''
      AND EXISTS (
        SELECT 1 FROM organization_schedules construction
        WHERE construction.organization = legacy.organization
          AND construction.business_round = legacy.business_round
          AND construction.category = 'construction'
          AND construction.source_activity_id = legacy.source_activity_id
          AND construction.stage = legacy.label
          AND construction.scheduled_date = legacy.scheduled_date
          AND COALESCE(construction.start_time, '') = COALESCE(legacy.start_time, '')
          AND COALESCE(construction.end_time, '') = COALESCE(legacy.end_time, '')
          AND TRIM(COALESCE(construction.deleted_at, '')) = ''
      )`;
  await d1.batch([
    d1.prepare(
      `INSERT OR IGNORE INTO organization_schedule_import_state (organization, business_round)
       SELECT DISTINCT organization, business_round
       FROM organization_schedules
       WHERE category = 'construction'`,
    ),
    d1.prepare(
      `UPDATE organization_schedules
       SET deleted_at = CURRENT_TIMESTAMP, sync_status = 'pending', sync_operation = 'delete',
           sync_error = '', updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${duplicateLegacyScheduleIds})
         AND TRIM(COALESCE(google_event_id, '')) <> ''`,
    ),
    d1.prepare(
      `DELETE FROM organization_schedules
       WHERE id IN (${duplicateLegacyScheduleIds})
         AND TRIM(COALESCE(google_event_id, '')) = ''`,
    ),
  ]);
  return d1;
}

export function ensureOrganizationSchedulesReady() {
  if (!schedulesReadyPromise) {
    schedulesReadyPromise = initializeOrganizationSchedules().catch((error) => {
      schedulesReadyPromise = null;
      throw error;
    });
  }
  return schedulesReadyPromise;
}

function validDate(value: unknown) {
  const date = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date
    ? ""
    : date;
}

function validTime(value: unknown) {
  const time = clean(value);
  if (!time) return "";
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59 || minute % 10 !== 0) return "";
  return `${match[1]}:${match[2]}`;
}

function normalizeScheduleLabel(value: unknown) {
  return clean(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function normalizeScheduleSemanticLabel(organization: unknown, label: unknown) {
  const compactOrganization = normalizeScheduleLabel(organization)
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "");
  const administrativeFreeOrganization = compactOrganization
    .replace(/특별자치도|특별자치시|광역시|특별시|도|시|군|구/g, "");
  let compactLabel = normalizeScheduleLabel(label)
    .toLocaleLowerCase("ko-KR")
    .replace(/^\s*\[[^\]]{1,10}\]\s*/u, "")
    .replace(/\s+/g, "");
  if (compactOrganization) compactLabel = compactLabel.replaceAll(compactOrganization, "");
  if (administrativeFreeOrganization) {
    compactLabel = compactLabel.replaceAll(administrativeFreeOrganization, "");
  }
  return compactLabel;
}

function scheduleNaturalKey(scheduledDate: unknown, label: unknown, category: unknown = "general") {
  return [
    clean(scheduledDate),
    normalizeScheduleLabel(label).toLocaleLowerCase("ko-KR"),
    normalizeScheduleCategory(category),
  ].join("\u001f");
}

function normalizeScheduleCategory(value: unknown) {
  const category = clean(value);
  return ["general", "meeting", "showroom", "other", "personal"].includes(category)
    ? category
    : "general";
}

export function normalizeOrganizationScheduleInputs(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, OrganizationScheduleInput>();
  value.slice(0, 100).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const input = entry as Record<string, unknown>;
    const label = normalizeScheduleLabel(input.label);
    const scheduledDate = validDate(input.scheduledDate ?? input.date);
    const startTime = validTime(input.startTime);
    const endTime = startTime ? validTime(input.endTime) : "";
    if (!label || !scheduledDate) return;
    unique.set(scheduleNaturalKey(scheduledDate, label), {
      id: Number.isSafeInteger(Number(input.id)) && Number(input.id) > 0 ? Number(input.id) : undefined,
      label,
      scheduledDate,
      startTime,
      endTime,
      completed: input.completed === true,
    });
  });
  return [...unique.values()].sort(
    (left, right) =>
      left.scheduledDate.localeCompare(right.scheduledDate) ||
      left.label.localeCompare(right.label, "ko-KR"),
  );
}

function scheduleJson(row: Record<string, unknown>): OrganizationSchedule {
  return {
    id: Number(row.id),
    organization: String(row.organization ?? ""),
    businessRound: Math.max(0, Number(row.business_round) || 0),
    label: String(row.label ?? ""),
    scheduledDate: String(row.scheduled_date ?? ""),
    startTime: String(row.start_time ?? ""),
    endTime: String(row.end_time ?? ""),
    category: String(row.category ?? "general"),
    stage: String(row.stage ?? ""),
    endDate: String(row.end_date ?? row.scheduled_date ?? ""),
    vendorName: String(row.vendor_name ?? ""),
    details: String(row.details ?? ""),
    completed: Number(row.completed) === 1,
    sourceActivityId:
      Number.isSafeInteger(Number(row.source_activity_id)) &&
      Number(row.source_activity_id) > 0
        ? Number(row.source_activity_id)
        : null,
    assigneeMemberId:
      Number.isSafeInteger(Number(row.assignee_member_id)) && Number(row.assignee_member_id) > 0
        ? Number(row.assignee_member_id)
        : null,
    assigneeName: String(row.assignee_name ?? ""),
    createdByName: String(row.created_by_name ?? ""),
    updatedByName: String(row.updated_by_name ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    googleEventId: String(row.google_event_id ?? ""),
    googleOrigin: Number(row.google_origin) === 1,
    syncStatus: ["synced", "failed", "local_only"].includes(String(row.sync_status))
      ? String(row.sync_status) as "synced" | "failed" | "local_only"
      : "pending",
    syncOperation: ["delete", "unlink", "move-construction"].includes(String(row.sync_operation))
      ? String(row.sync_operation) as "delete" | "unlink" | "move-construction"
      : "upsert",
    syncError: String(row.sync_error ?? ""),
    syncAttempts: Math.max(0, Number(row.sync_attempts) || 0),
    lastSyncedAt: String(row.last_synced_at ?? ""),
  };
}

function constructionProjectJson(
  row: Record<string, unknown>,
  sourceProductNames: string[],
): ConstructionScheduleProject {
  const mode = row.work_summary_mode === "manual" ? "manual" : "auto";
  return {
    id: Number(row.id),
    organization: String(row.organization ?? ""),
    businessRound: Math.max(1, Number(row.business_round) || 1),
    workSummary: mode === "auto" && sourceProductNames.length
      ? sourceProductNames.join(" · ")
      : String(row.work_summary ?? ""),
    workSummaryMode: mode,
    sourceProductNames,
    completed: Number(row.completed) === 1,
    hidden: clean(row.hidden_at) !== "",
    updatedAt: String(row.updated_at ?? ""),
  };
}

async function isWhizzupAwardScope(
  d1: Awaited<ReturnType<typeof ensureOrganizationSchedulesReady>>,
  organization: string,
  businessRound: number,
) {
  const latest = await d1.prepare(
    `SELECT award_status
     FROM activities
     WHERE organization = ? AND business_round = ?
     ORDER BY activity_date DESC, id DESC
     LIMIT 1`,
  ).bind(organization, businessRound).first<{ award_status: string }>();
  return clean(latest?.award_status) === "위즈업 수주";
}

async function requireWhizzupAwardScope(
  d1: Awaited<ReturnType<typeof ensureOrganizationSchedulesReady>>,
  organization: string,
  businessRound: number,
) {
  if (!(await isWhizzupAwardScope(d1, organization, businessRound))) {
    throw new Error("시공 일정표에는 위즈업 수주 기관만 추가할 수 있습니다.");
  }
}

async function importLegacyScheduleIfNeeded(
  organization: string,
  businessRound: number,
) {
  const d1 = await ensureOrganizationSchedulesReady();
  const existing = await d1
    .prepare(
      `SELECT COUNT(*) AS count
       FROM organization_schedules
       WHERE organization = ? AND business_round = ?
         AND TRIM(COALESCE(deleted_at, '')) = ''
         AND COALESCE(category, 'general') <> 'construction'`,
    )
    .bind(organization, businessRound)
    .first<{ count: number }>();
  if (Number(existing?.count) > 0) {
    // Existing rows may have been imported before import-state tracking was
    // introduced. Record that fact now so deleting the final row cannot make
    // an older activities.progress_schedule look like new data again.
    await d1.prepare(
      `INSERT OR IGNORE INTO organization_schedule_import_state (
         organization, business_round
       ) VALUES (?, ?)`,
    ).bind(organization, businessRound).run();
    return;
  }

  const imported = await d1.prepare(
    `SELECT 1 AS imported
     FROM organization_schedule_import_state
     WHERE organization = ? AND business_round = ?
     LIMIT 1`,
  ).bind(organization, businessRound).first<{ imported: number }>();
  if (imported) return;

  const latest = await d1
    .prepare(
      `SELECT id, progress_schedule
       FROM activities
       WHERE organization = ? AND business_round = ?
         AND TRIM(COALESCE(progress_schedule, '')) <> ''
       ORDER BY activity_date DESC, id DESC
       LIMIT 1`,
    )
    .bind(organization, businessRound)
    .first<{ id: number; progress_schedule: string }>();
  const entries = normalizeOrganizationScheduleInputs(
    latest ? parseProgressScheduleEntries(latest.progress_schedule).map((entry) => ({
      label: entry.label,
      scheduledDate: entry.date,
      startTime: entry.startTime,
      endTime: entry.endTime,
    })) : [],
  );
  const sourceActivityId = latest ? Number(latest.id) : null;
  await d1.batch([
    ...entries.map((entry) =>
      d1
        .prepare(
          `INSERT OR IGNORE INTO organization_schedules (
             organization, business_round, label, scheduled_date, start_time, end_time,
             completed, source_activity_id
           )
           SELECT ?, ?, ?, ?, ?, ?, 0, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM organization_schedules
             WHERE LOWER(TRIM(organization)) = LOWER(TRIM(?))
               AND business_round = ?
               AND ${semanticScheduleLabelSql("organization", "label")} = ?
               AND scheduled_date = ?
               AND LOWER(TRIM(COALESCE(category, 'general'))) = 'general'
               AND TRIM(COALESCE(deleted_at, '')) = ''
           )`,
        )
        .bind(
          organization,
          businessRound,
           normalizeScheduleSemanticLabel(organization, entry.label),
           entry.scheduledDate,
           entry.startTime || "",
           entry.endTime || "",
           sourceActivityId,
           organization,
           businessRound,
           entry.label,
           entry.scheduledDate,
        ),
    ),
    d1.prepare(
      `INSERT OR IGNORE INTO organization_schedule_import_state (
         organization, business_round
       ) VALUES (?, ?)`,
    ).bind(organization, businessRound),
  ]);
}

export async function listOrganizationSchedules(
  organizationValue: unknown,
  businessRoundValue: unknown,
) {
  const organization = clean(organizationValue).slice(0, 120);
  const businessRound = Math.max(1, Number(businessRoundValue) || 1);
  if (!organization) return [];
  await importLegacyScheduleIfNeeded(organization, businessRound);
  return listStoredOrganizationSchedules(organization, businessRound);
}

export async function listConstructionStageOptions() {
  const d1 = await ensureOrganizationSchedulesReady();
  const result = await d1.prepare(
    `SELECT DISTINCT TRIM(COALESCE(NULLIF(stage, ''), label)) AS stage
     FROM organization_schedules
     WHERE category = 'construction'
       AND TRIM(COALESCE(deleted_at, '')) = ''
       AND TRIM(COALESCE(NULLIF(stage, ''), label)) <> ''
     ORDER BY stage COLLATE NOCASE ASC
     LIMIT 100`,
  ).all<{ stage: string }>();
  return [...new Set([
    ...CONSTRUCTION_STAGES,
    ...result.results.map((row) => clean(row.stage).slice(0, 40)).filter(Boolean),
  ])];
}

async function listStoredOrganizationSchedules(
  organization: string,
  businessRound: number,
) {
  const d1 = await ensureOrganizationSchedulesReady();
  const result = await d1
    .prepare(
      `SELECT *
       FROM organization_schedules
       WHERE organization = ? AND business_round = ?
         AND TRIM(COALESCE(deleted_at, '')) = ''
         AND COALESCE(category, 'general') <> 'construction'
       ORDER BY completed ASC, scheduled_date ASC, id ASC`,
    )
    .bind(organization, businessRound)
    .all<Record<string, unknown>>();
  return result.results.map(scheduleJson);
}

function normalizeConstructionScheduleInputs(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, ConstructionScheduleInput>();
  value.slice(0, 200).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const input = entry as Record<string, unknown>;
    const stage = clean(input.stage ?? input.label).slice(0, 40);
    const scheduledDate = validDate(input.scheduledDate ?? input.startDate);
    const endDate = validDate(input.endDate) || scheduledDate;
    const startTime = validTime(input.startTime);
    const endTime = startTime ? validTime(input.endTime) : "";
    if (
      !isValidConstructionStage(stage) ||
      !scheduledDate ||
      endDate < scheduledDate ||
      (startTime && endTime && endDate === scheduledDate && endTime <= startTime)
    ) return;
    const normalized = {
      id: Math.max(0, Number(input.id) || 0) || undefined,
      stage,
      scheduledDate,
      endDate,
      startTime,
      endTime,
      vendorName: clean(input.vendorName).slice(0, 120),
      details: clean(input.details).slice(0, 500),
      completed: input.completed === true,
    } satisfies ConstructionScheduleInput;
    unique.set(
      `${stage}\u001f${scheduledDate}\u001f${endDate}\u001f${startTime}\u001f${endTime}`,
      normalized,
    );
  });
  return [...unique.values()];
}

export async function listConstructionScheduleBoard() {
  const d1 = await ensureOrganizationSchedulesReady();
  // Vercel has already reconciled these tables in the shared Postgres schema.
  // Running the full equipment retrofit from a read-only dashboard request can
  // keep the schedule board waiting behind unrelated migration work.
  if (!isPostgresDatabase()) await ensureEquipmentReady();
  // GET 요청에서 대량 DELETE를 실행하지 않습니다. 최신 수주 상태를 한 번
  // 읽어 화면에서 필터링하면 D1 쓰기 잠금 없이 동일한 결과를 얻습니다.
  const [projectsResult, schedulesResult, productResult, latestAwardsResult] = await Promise.all([
    d1.prepare(
      `SELECT * FROM construction_schedule_projects
       ORDER BY completed ASC, updated_at DESC, organization COLLATE NOCASE ASC`,
    ).all<Record<string, unknown>>(),
    d1.prepare(
       `SELECT * FROM organization_schedules
       WHERE COALESCE(category, 'general') = 'construction'
         AND TRIM(COALESCE(deleted_at, '')) = ''
       ORDER BY scheduled_date ASC, id ASC`,
    ).all<Record<string, unknown>>(),
    d1.prepare(
      `SELECT p.organization, p.business_round, i.product_name, i.sort_order, i.id
       FROM equipment_projects p
       JOIN equipment_items i ON i.project_id = p.id
       WHERE TRIM(COALESCE(i.product_name, '')) <> ''
       ORDER BY p.organization COLLATE NOCASE ASC, p.business_round ASC,
                 p.updated_at DESC, i.sort_order ASC, i.id ASC`,
    ).all<Record<string, unknown>>(),
    d1.prepare(
      `SELECT organization, business_round, award_status
       FROM (
         SELECT organization, business_round, award_status,
                ROW_NUMBER() OVER (
                  PARTITION BY organization, business_round
                  ORDER BY activity_date DESC, id DESC
                ) AS row_number
         FROM activities
       )
       WHERE row_number = 1`,
    ).all<Record<string, unknown>>(),
  ]);
  const whizzupScopes = new Set(
    latestAwardsResult.results
      .filter((row) => clean(row.award_status) === "위즈업 수주")
      .map((row) => `${String(row.organization ?? "")}\u001f${Math.max(1, Number(row.business_round) || 1)}`),
  );
  const productNamesByScope = new Map<string, string[]>();
  productResult.results.forEach((row) => {
    const key = `${String(row.organization ?? "")}\u001f${Math.max(1, Number(row.business_round) || 1)}`;
    const name = clean(row.product_name);
    const current = productNamesByScope.get(key) ?? [];
    if (name && !current.includes(name)) productNamesByScope.set(key, [...current, name]);
  });
  return {
    projects: projectsResult.results.filter((row) =>
      whizzupScopes.has(`${String(row.organization ?? "")}\u001f${Math.max(1, Number(row.business_round) || 1)}`),
    ).map((row) => {
      const organization = String(row.organization ?? "");
      const businessRound = Math.max(1, Number(row.business_round) || 1);
      const sourceProductNames = productNamesByScope.get(`${organization}\u001f${businessRound}`) ?? [];
      return constructionProjectJson(row, sourceProductNames);
    }),
    schedules: schedulesResult.results.filter((row) =>
      whizzupScopes.has(`${String(row.organization ?? "")}\u001f${Math.max(1, Number(row.business_round) || 1)}`),
    ).map(scheduleJson),
  };
}

export async function addConstructionScheduleProject(input: {
  organization: unknown;
  businessRound: unknown;
  workSummary?: unknown;
  memberId: number;
  memberName: string;
}) {
  const organization = clean(input.organization).slice(0, 120);
  const businessRound = Math.max(1, Number(input.businessRound) || 1);
  if (!organization) throw new Error("추가할 기관을 선택해 주세요.");
  const d1 = await ensureOrganizationSchedulesReady();
  await requireWhizzupAwardScope(d1, organization, businessRound);
  await d1.prepare(
    `INSERT INTO construction_schedule_projects (
       organization, business_round, work_summary, completed,
       created_by, created_by_name, updated_by, updated_by_name
     ) VALUES (?, ?, ?, 0, ?, ?, ?, ?)
     ON CONFLICT(organization, business_round) DO UPDATE SET
       work_summary = CASE WHEN excluded.work_summary <> '' THEN excluded.work_summary ELSE work_summary END,
       completed = 0,
       hidden_at = '',
       updated_by = excluded.updated_by,
       updated_by_name = excluded.updated_by_name,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    organization,
    businessRound,
    clean(input.workSummary).slice(0, 240),
    input.memberId,
    input.memberName,
    input.memberId,
    input.memberName,
  ).run();
  return listConstructionScheduleBoard();
}

export async function addOrganizationSchedule(input: {
  organization: unknown;
  businessRound: unknown;
  label: unknown;
  scheduledDate: unknown;
  startTime?: unknown;
  endTime?: unknown;
  category?: unknown;
  linked?: unknown;
  assigneeMemberId?: unknown;
  assigneeName?: unknown;
  details?: unknown;
  memberId: number;
  memberName: string;
}) {
  const organization = clean(input.organization).slice(0, 120);
  const linked = input.linked !== false;
  const businessRound = linked ? Math.max(1, Number(input.businessRound) || 1) : 0;
  const label = normalizeScheduleLabel(input.label);
  const scheduledDate = validDate(input.scheduledDate);
  const category = normalizeScheduleCategory(input.category);
  const rawStartTime = clean(input.startTime);
  const rawEndTime = clean(input.endTime);
  const startTime = validTime(rawStartTime);
  const endTime = validTime(rawEndTime);
  const assigneeMemberId = Number(input.assigneeMemberId);
  const assigneeName = clean(input.assigneeName).slice(0, 120) || input.memberName;
  const details = clean(input.details).slice(0, 500);
  if (!organization || !label || !scheduledDate) {
    throw new Error("기관, 일정 제목, 날짜를 확인해 주세요.");
  }
  if ((rawStartTime && !startTime) || (rawEndTime && !endTime)) {
    throw new Error("시간은 10분 단위로 입력해 주세요.");
  }
  if (endTime && !startTime) throw new Error("종료 시간보다 시작 시간을 먼저 입력해 주세요.");
  if (startTime && endTime && endTime < startTime) throw new Error("종료 시간은 시작 시간 이후여야 합니다.");
  const semanticLabel = normalizeScheduleSemanticLabel(organization, label);
  const d1 = await ensureOrganizationSchedulesReady();
  await d1.prepare(
      `INSERT OR IGNORE INTO organization_schedules (
         organization, business_round, label, scheduled_date, start_time, end_time, category, details, completed,
         created_by, created_by_name, updated_by, updated_by_name,
         assignee_member_id, assignee_name, sync_status
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM organization_schedules
          WHERE LOWER(TRIM(organization)) = LOWER(TRIM(?))
            AND business_round = ?
            AND ${semanticScheduleLabelSql("organization", "label")} = ?
            AND scheduled_date = ?
            AND LOWER(TRIM(COALESCE(category, 'general'))) = LOWER(TRIM(?))
            AND TRIM(COALESCE(deleted_at, '')) = ''
        )`,
    ).bind(
      organization,
      businessRound,
      label,
      scheduledDate,
      startTime,
      endTime,
      category,
      details,
      input.memberId,
      input.memberName,
      input.memberId,
      input.memberName,
      Number.isSafeInteger(assigneeMemberId) && assigneeMemberId > 0 ? assigneeMemberId : null,
      assigneeName,
      category === "personal" ? "local_only" : "pending",
      organization,
      businessRound,
      semanticLabel,
      scheduledDate,
      category,
    ).run();
  if (!linked) return [];
  const general = await listOrganizationSchedules(organization, businessRound);
  const construction = await d1.prepare(
    `SELECT * FROM organization_schedules
     WHERE organization = ? AND business_round = ? AND category = 'construction'
       AND TRIM(COALESCE(deleted_at, '')) = ''`,
  ).bind(organization, businessRound).all<Record<string, unknown>>();
  await mirrorOpenSchedulesToLatestActivity(d1, organization, businessRound, [
    ...general,
    ...construction.results.map(scheduleJson),
  ]);
  return listOrganizationSchedules(organization, businessRound);
}

export async function saveConstructionSchedules(input: {
  organization: unknown;
  businessRound: unknown;
  workSummary?: unknown;
  workSummaryMode?: unknown;
  completed?: unknown;
  schedules: unknown;
  memberId: number;
  memberName: string;
}): Promise<ConstructionScheduleSaveResult> {
  const organization = clean(input.organization).slice(0, 120);
  const businessRound = Math.max(1, Number(input.businessRound) || 1);
  if (!organization) throw new Error("기관을 확인해 주세요.");
  const schedules = normalizeConstructionScheduleInputs(input.schedules);
  const d1 = await ensureOrganizationSchedulesReady();
  await requireWhizzupAwardScope(d1, organization, businessRound);
  const projectCompleted = input.completed === true;
  const existingSchedules = await d1.prepare(
    `SELECT * FROM organization_schedules
     WHERE organization = ? AND business_round = ? AND category = 'construction'
       AND TRIM(COALESCE(deleted_at, '')) = ''
     ORDER BY id ASC`,
  ).bind(organization, businessRound).all<Record<string, unknown>>();
  const existingByKey = new Map<string, Record<string, unknown>[]>();
  const existingById = new Map<number, Record<string, unknown>>();
  existingSchedules.results.forEach((row) => {
    existingById.set(Number(row.id), row);
    const key = `${String(row.stage || row.label)}\u001f${String(row.scheduled_date)}\u001f${String(row.end_date || row.scheduled_date)}\u001f${String(row.start_time || "")}\u001f${String(row.end_time || "")}`;
    existingByKey.set(key, [...(existingByKey.get(key) || []), row]);
  });
  const retainedIds = new Set<number>();
  const scheduleStatements = schedules.map((schedule) => {
    const key = `${schedule.stage}\u001f${schedule.scheduledDate}\u001f${schedule.endDate || schedule.scheduledDate}\u001f${schedule.startTime || ""}\u001f${schedule.endTime || ""}`;
    let existing = schedule.id ? existingById.get(schedule.id) : undefined;
    if (existing && retainedIds.has(Number(existing.id))) existing = undefined;
    while (!existing) {
      const candidate = existingByKey.get(key)?.shift();
      if (!candidate || !retainedIds.has(Number(candidate.id))) {
        existing = candidate;
        break;
      }
    }
    if (existing) {
      const id = Number(existing.id);
      retainedIds.add(id);
      return d1.prepare(
        `UPDATE organization_schedules
         SET label = ?, scheduled_date = ?, start_time = ?, end_time = ?, stage = ?, end_date = ?, vendor_name = ?, details = ?, completed = ?,
             sync_status = 'pending', sync_operation = 'upsert', sync_error = '', deleted_at = '',
             updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).bind(
         schedule.stage,
         schedule.scheduledDate,
         schedule.startTime || "",
         schedule.endTime || "",
         schedule.stage,
        schedule.endDate || schedule.scheduledDate,
        schedule.vendorName || "",
        schedule.details || "",
        schedule.completed || projectCompleted ? 1 : 0,
        input.memberId,
        input.memberName,
        id,
      );
    }
    return d1.prepare(
      `INSERT INTO organization_schedules (
         organization, business_round, label, scheduled_date, start_time, end_time, category, stage,
         end_date, vendor_name, details, completed,
         created_by, created_by_name, updated_by, updated_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, 'construction', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      organization,
      businessRound,
      schedule.stage,
      schedule.scheduledDate,
      schedule.startTime || "",
      schedule.endTime || "",
      schedule.stage,
      schedule.endDate || schedule.scheduledDate,
      schedule.vendorName || "",
      schedule.details || "",
      schedule.completed || projectCompleted ? 1 : 0,
      input.memberId,
      input.memberName,
      input.memberId,
      input.memberName,
    );
  });
  const removedStatements = existingSchedules.results
    .filter((row) => !retainedIds.has(Number(row.id)))
    .map((row) => clean(row.google_event_id)
      ? d1.prepare(
          `UPDATE organization_schedules
           SET deleted_at = CURRENT_TIMESTAMP, sync_status = 'pending', sync_operation = 'delete',
               sync_error = '', updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).bind(input.memberId, input.memberName, Number(row.id))
      : d1.prepare("DELETE FROM organization_schedules WHERE id = ?").bind(Number(row.id)));
  await d1.batch([
    d1.prepare(
      `INSERT INTO construction_schedule_projects (
         organization, business_round, work_summary, work_summary_mode, completed,
         created_by, created_by_name, updated_by, updated_by_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organization, business_round) DO UPDATE SET
         work_summary = excluded.work_summary,
         work_summary_mode = excluded.work_summary_mode,
         completed = excluded.completed,
         updated_by = excluded.updated_by,
         updated_by_name = excluded.updated_by_name,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      organization,
      businessRound,
      clean(input.workSummary).slice(0, 240),
      input.workSummaryMode === "manual" ? "manual" : "auto",
      projectCompleted ? 1 : 0,
      input.memberId,
      input.memberName,
      input.memberId,
      input.memberName,
    ),
    ...scheduleStatements,
    ...removedStatements,
  ]);
  const hasInspection = schedules.some((schedule) => schedule.stage === "검수");
  const hasConstructionWork = schedules.some((schedule) => isValidConstructionStage(schedule.stage));
  if (hasInspection && projectCompleted) {
    await d1.prepare(
      `UPDATE activities
       SET award_stage = '납품 완료', updated_at = CURRENT_TIMESTAMP
       WHERE id = (
         SELECT id FROM activities
         WHERE organization = ? AND business_round = ? AND award_status = '위즈업 수주'
         ORDER BY activity_date DESC, id DESC LIMIT 1
       ) AND COALESCE(award_stage_manual, 0) = 0`,
    ).bind(organization, businessRound).run();
  } else if (hasConstructionWork) {
    await d1.prepare(
      `UPDATE activities
       SET award_stage = CASE WHEN award_stage = '납품 완료' THEN award_stage ELSE '설치·공사 진행' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = (
         SELECT id FROM activities
         WHERE organization = ? AND business_round = ? AND award_status = '위즈업 수주'
         ORDER BY activity_date DESC, id DESC LIMIT 1
       ) AND COALESCE(award_stage_manual, 0) = 0`,
    ).bind(organization, businessRound).run();
  }
  const general = await listOrganizationSchedules(organization, businessRound);
  await mirrorOpenSchedulesToLatestActivity(d1, organization, businessRound, [
    ...general,
      ...schedules.map((schedule) => ({
        label: schedule.stage,
        scheduledDate: schedule.scheduledDate,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        completed: schedule.completed || projectCompleted,
      })),
  ]);
  const [projectRow, scheduleRows, productRows] = await Promise.all([
    d1.prepare(
      `SELECT * FROM construction_schedule_projects
       WHERE organization = ? AND business_round = ?
       LIMIT 1`,
    ).bind(organization, businessRound).first<Record<string, unknown>>(),
    d1.prepare(
      `SELECT * FROM organization_schedules
       WHERE organization = ? AND business_round = ? AND category = 'construction'
       ORDER BY scheduled_date ASC, id ASC`,
    ).bind(organization, businessRound).all<Record<string, unknown>>(),
    d1.prepare(
      `SELECT i.product_name, i.sort_order, i.id
       FROM equipment_projects p
       JOIN equipment_items i ON i.project_id = p.id
       WHERE p.organization = ? AND p.business_round = ?
         AND TRIM(COALESCE(i.product_name, '')) <> ''
       ORDER BY p.updated_at DESC, i.sort_order ASC, i.id ASC`,
    ).bind(organization, businessRound).all<Record<string, unknown>>(),
  ]);
  if (!projectRow) throw new Error("저장한 시공 일정표 기관을 찾지 못했습니다.");
  const sourceProductNames = [...new Set(
    productRows.results.map((row) => clean(row.product_name)).filter(Boolean),
  )];
  return {
    project: constructionProjectJson(projectRow, sourceProductNames),
    schedules: scheduleRows.results
      .filter((row) => clean(row.deleted_at) === "")
      .map(scheduleJson),
    syncIds: scheduleRows.results
      .filter((row) => ["pending", "failed"].includes(clean(row.sync_status)))
      .map((row) => Number(row.id))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  };
}

export async function removeConstructionScheduleProject(input: {
  organization: unknown;
  businessRound: unknown;
}) {
  const organization = clean(input.organization).slice(0, 120);
  const businessRound = Math.max(1, Number(input.businessRound) || 1);
  if (!organization) throw new Error("일정표에서 뺄 기관을 확인해 주세요.");
  const d1 = await ensureOrganizationSchedulesReady();
  const generalResult = await d1.prepare(
    `SELECT * FROM organization_schedules
     WHERE organization = ? AND business_round = ?
       AND COALESCE(category, 'general') <> 'construction'
       AND TRIM(COALESCE(deleted_at, '')) = ''
     ORDER BY completed ASC, scheduled_date ASC, id ASC`,
  ).bind(organization, businessRound).all<Record<string, unknown>>();
  await d1.batch([
    d1.prepare(
      `UPDATE organization_schedules
       SET deleted_at = CURRENT_TIMESTAMP, sync_status = 'pending', sync_operation = 'delete',
           sync_error = '', updated_at = CURRENT_TIMESTAMP
       WHERE organization = ? AND business_round = ? AND category = 'construction'
         AND TRIM(COALESCE(google_event_id, '')) <> ''`,
    ).bind(organization, businessRound),
    d1.prepare(
      `DELETE FROM organization_schedules
       WHERE organization = ? AND business_round = ? AND category = 'construction'
         AND TRIM(COALESCE(google_event_id, '')) = ''`,
    ).bind(organization, businessRound),
    d1.prepare(
      `DELETE FROM construction_schedule_projects
       WHERE organization = ? AND business_round = ?`,
    ).bind(organization, businessRound),
  ]);
  await mirrorOpenSchedulesToLatestActivity(
    d1,
    organization,
    businessRound,
    generalResult.results.map(scheduleJson),
  );
  return listConstructionScheduleBoard();
}

export async function setConstructionScheduleProjectHidden(input: {
  organization: unknown;
  businessRound: unknown;
  hidden: boolean;
  memberId: number;
  memberName: string;
}) {
  const organization = clean(input.organization).slice(0, 120);
  const businessRound = Math.max(1, Number(input.businessRound) || 1);
  if (!organization) throw new Error("일정표 기관을 확인해 주세요.");
  const d1 = await ensureOrganizationSchedulesReady();
  const result = await d1.prepare(
    `UPDATE construction_schedule_projects
     SET hidden_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE '' END,
         updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP
     WHERE organization = ? AND business_round = ?`,
  ).bind(
    input.hidden ? 1 : 0,
    input.memberId,
    input.memberName,
    organization,
    businessRound,
  ).run();
  if (!result.meta.changes) throw new Error("일정표 기관을 찾지 못했습니다.");
  return listConstructionScheduleBoard();
}

async function mirrorOpenSchedulesToLatestActivity(
  d1: Awaited<ReturnType<typeof ensureOrganizationSchedulesReady>>,
  organization: string,
  businessRound: number,
  schedules: OrganizationScheduleInput[],
) {
  const progressSchedule = serializeProgressSchedule(
    schedules
      .filter((schedule) => !schedule.completed)
      .map((schedule) => ({
        label: schedule.label,
        date: schedule.scheduledDate,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      })),
  );
  await d1
    .prepare(
      `UPDATE activities
       SET progress_schedule = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = (
         SELECT id FROM activities
         WHERE organization = ? AND business_round = ?
         ORDER BY activity_date DESC, id DESC
         LIMIT 1
       )`,
    )
    .bind(progressSchedule, organization, businessRound)
    .run();
}

export async function refreshOrganizationScheduleMirror(
  organizationValue: unknown,
  businessRoundValue: unknown,
) {
  const organization = clean(organizationValue).slice(0, 120);
  const businessRound = Math.max(1, Number(businessRoundValue) || 1);
  if (!organization) return;
  const d1 = await ensureOrganizationSchedulesReady();
  const result = await d1.prepare(
    `SELECT * FROM organization_schedules
     WHERE organization = ? AND business_round = ?
       AND TRIM(COALESCE(deleted_at, '')) = ''
     ORDER BY scheduled_date ASC, id ASC`,
  ).bind(organization, businessRound).all<Record<string, unknown>>();
  await mirrorOpenSchedulesToLatestActivity(
    d1,
    organization,
    businessRound,
    result.results.map(scheduleJson),
  );
}

export async function replaceOrganizationSchedules(input: {
  organization: unknown;
  businessRound: unknown;
  schedules: unknown;
  memberId: number;
  memberName: string;
}) {
  const organization = clean(input.organization).slice(0, 120);
  const businessRound = Math.max(1, Number(input.businessRound) || 1);
  if (!organization) throw new Error("기관을 확인해 주세요.");
  const schedules = normalizeOrganizationScheduleInputs(input.schedules);
  const d1 = await ensureOrganizationSchedulesReady();
  const existingResult = await d1.prepare(
    `SELECT * FROM organization_schedules
     WHERE organization = ? AND business_round = ?
       AND COALESCE(category, 'general') <> 'construction'
       AND TRIM(COALESCE(deleted_at, '')) = ''
     ORDER BY id ASC`,
  ).bind(organization, businessRound).all<Record<string, unknown>>();
  const byId = new Map(existingResult.results.map((row) => [Number(row.id), row]));
  const byNaturalKey = new Map(existingResult.results.map((row) => [
    scheduleNaturalKey(
      row.scheduled_date,
      normalizeScheduleSemanticLabel(organization, row.label),
    ),
    row,
  ]));
  const retained = new Set<number>();
  const statements = schedules.map((schedule) => {
    const existing = (schedule.id ? byId.get(schedule.id) : undefined)
      || byNaturalKey.get(scheduleNaturalKey(
        schedule.scheduledDate,
        normalizeScheduleSemanticLabel(organization, schedule.label),
      ));
    if (existing) {
      const id = Number(existing.id);
      retained.add(id);
      return d1.prepare(
        `UPDATE organization_schedules
         SET label = ?, scheduled_date = ?, start_time = ?, end_time = ?, end_date = ?, completed = ?,
             sync_status = 'pending', sync_operation = 'upsert', sync_error = '',
             updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).bind(
         schedule.label,
         schedule.scheduledDate,
         schedule.startTime || "",
         schedule.endTime || "",
         schedule.scheduledDate,
        schedule.completed ? 1 : 0,
        input.memberId,
        input.memberName,
        id,
      );
    }
    return d1.prepare(
      `INSERT OR IGNORE INTO organization_schedules (
         organization, business_round, label, scheduled_date, start_time, end_time, category, completed,
         created_by, created_by_name, updated_by, updated_by_name
       ) VALUES (?, ?, ?, ?, ?, ?, 'general', ?, ?, ?, ?, ?)`,
    ).bind(
      organization,
      businessRound,
      schedule.label,
      schedule.scheduledDate,
      schedule.startTime || "",
      schedule.endTime || "",
      schedule.completed ? 1 : 0,
      input.memberId,
      input.memberName,
      input.memberId,
      input.memberName,
    );
  });
  existingResult.results.filter((row) => !retained.has(Number(row.id))).forEach((row) => {
    statements.push(clean(row.google_event_id)
      ? d1.prepare(
          `UPDATE organization_schedules
           SET deleted_at = CURRENT_TIMESTAMP, sync_status = 'pending', sync_operation = 'delete',
               sync_error = '', updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).bind(input.memberId, input.memberName, Number(row.id))
      : d1.prepare("DELETE FROM organization_schedules WHERE id = ?").bind(Number(row.id)));
  });
  await d1.batch(statements);
  await mirrorOpenSchedulesToLatestActivity(
    d1,
    organization,
    businessRound,
    schedules,
  );
  return listOrganizationSchedules(organization, businessRound);
}

export async function markOrganizationScheduleCompleted(input: {
  id: number;
  organization: string;
  businessRound: number;
  memberId: number;
  memberName: string;
}) {
  const d1 = await ensureOrganizationSchedulesReady();
  const result = await d1
    .prepare(
      `UPDATE organization_schedules
       SET completed = 1,
           sync_status = 'pending',
           sync_operation = 'upsert',
           sync_error = '',
           updated_by = ?,
           updated_by_name = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND organization = ?
         AND business_round = ?
         AND completed = 0`,
    )
    .bind(
      input.memberId,
      clean(input.memberName).slice(0, 120),
      input.id,
      input.organization,
      input.businessRound,
    )
    .run();
  if (Number(result.meta.changes) !== 1) {
    throw new Error("이미 확인했거나 찾을 수 없는 일정입니다.");
  }
  const schedules = await listOrganizationSchedules(
    input.organization,
    input.businessRound,
  );
  await mirrorOpenSchedulesToLatestActivity(
    d1,
    input.organization,
    input.businessRound,
    schedules,
  );
  return schedules.find((schedule) => schedule.id === input.id) ?? null;
}

type ScheduleActor = {
  id: number;
  displayName: string;
  role: "admin" | "assistant" | "member";
};

async function requireEditableSchedule(idValue: unknown, member: ScheduleActor) {
  const id = Number(idValue);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("수정할 일정을 선택해 주세요.");
  const d1 = await ensureOrganizationSchedulesReady();
  const row = await d1.prepare(
    `SELECT * FROM organization_schedules
     WHERE id = ? AND TRIM(COALESCE(deleted_at, '')) = '' LIMIT 1`,
  ).bind(id).first<Record<string, unknown>>();
  if (!row) throw new Error("일정을 찾을 수 없습니다.");
  if (String(row.category ?? "general") === "construction") {
    throw new Error("시공 일정은 시공·납품 일정표에서 수정해 주세요.");
  }
  const permitted = member.role === "admin"
    || Number(row.created_by) === member.id
    || Number(row.assignee_member_id) === member.id;
  if (!permitted) throw new Error("작성자, 담당자 또는 관리자만 이 일정을 수정할 수 있습니다.");
  return { d1, row, id };
}

export async function updateOrganizationSchedule(input: {
  id: unknown;
  label: unknown;
  scheduledDate: unknown;
  startTime?: unknown;
  endTime?: unknown;
  category?: unknown;
  assigneeMemberId?: unknown;
  assigneeName?: unknown;
  details?: unknown;
  completed?: unknown;
  member: ScheduleActor;
}) {
  const { d1, row, id } = await requireEditableSchedule(input.id, input.member);
  const label = normalizeScheduleLabel(input.label);
  const scheduledDate = validDate(input.scheduledDate);
  if (!label || !scheduledDate) throw new Error("일정 제목과 날짜를 확인해 주세요.");
  const requestedCategory = clean(input.category);
  const category = requestedCategory === "construction"
    ? "construction"
    : normalizeScheduleCategory(requestedCategory);
  const rawStartTime = clean(input.startTime);
  const rawEndTime = clean(input.endTime);
  const startTime = validTime(rawStartTime);
  const endTime = validTime(rawEndTime);
  if ((rawStartTime && !startTime) || (rawEndTime && !endTime)) {
    throw new Error("시간은 10분 단위로 입력해 주세요.");
  }
  if (endTime && !startTime) throw new Error("종료 시간보다 시작 시간을 먼저 입력해 주세요.");
  if (startTime && endTime && endTime < startTime) throw new Error("종료 시간은 시작 시간 이후여야 합니다.");
  const assigneeMemberId = Number(input.assigneeMemberId);
  const assigneeName = clean(input.assigneeName).slice(0, 120) || input.member.displayName;
  const details = clean(input.details).slice(0, 500);
  if (category === "construction") {
    if (!isValidConstructionStage(label)) {
      throw new Error("시공 공정명을 40자 이내로 입력해 주세요.");
    }
    const organization = String(row.organization ?? "");
    const businessRound = Math.max(0, Number(row.business_round) || 0);
    if (!organization || businessRound <= 0) throw new Error("시공 일정은 연결된 기관이 필요합니다.");
    const project = await d1.prepare(
      `SELECT id FROM construction_schedule_projects
       WHERE organization = ? AND business_round = ? AND TRIM(COALESCE(hidden_at, '')) = '' LIMIT 1`,
    ).bind(organization, businessRound).first<{ id: number }>();
    if (!project) throw new Error("시공·납품 일정표에 해당 기관을 먼저 추가해 주세요.");
  }
  const duplicate = await d1.prepare(
    `SELECT id FROM organization_schedules
     WHERE id <> ?
       AND LOWER(TRIM(organization)) = LOWER(TRIM(?))
       AND business_round = ?
       AND ${semanticScheduleLabelSql("organization", "label")} = ?
       AND scheduled_date = ?
       AND LOWER(TRIM(COALESCE(category, 'general'))) = LOWER(TRIM(?))
       AND TRIM(COALESCE(deleted_at, '')) = ''
     LIMIT 1`,
  ).bind(
    id,
    String(row.organization ?? ""),
    Math.max(0, Number(row.business_round) || 0),
    normalizeScheduleSemanticLabel(String(row.organization ?? ""), label),
    scheduledDate,
    category,
  ).first<{ id: number }>();
  if (duplicate) throw new Error("같은 기관·날짜·제목의 일정이 이미 등록되어 있습니다.");
  await d1.prepare(
    `UPDATE organization_schedules
     SET label = ?, scheduled_date = ?, start_time = ?, end_time = ?, end_date = ?, category = ?, stage = ?, details = ?, completed = ?,
         assignee_member_id = ?, assignee_name = ?,
         sync_status = CASE
           WHEN ? = 'personal' AND TRIM(COALESCE(google_event_id, '')) <> '' THEN 'pending'
           WHEN ? = 'personal' THEN 'local_only'
           ELSE 'pending'
         END,
         sync_operation = CASE
           WHEN ? = 'personal' AND TRIM(COALESCE(google_event_id, '')) <> '' THEN 'unlink'
           WHEN ? = 'construction' AND TRIM(COALESCE(google_event_id, '')) <> '' THEN 'move-construction'
           ELSE 'upsert'
         END,
         sync_error = '',
         updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).bind(
    label,
    scheduledDate,
    startTime,
    endTime,
    scheduledDate,
    category,
    category === "construction" ? label : "",
    details,
    input.completed === true ? 1 : 0,
    Number.isSafeInteger(assigneeMemberId) && assigneeMemberId > 0 ? assigneeMemberId : null,
    assigneeName,
    category,
    category,
    category,
    category,
    input.member.id,
    input.member.displayName,
    id,
  ).run();
  const organization = String(row.organization ?? "");
  const businessRound = Math.max(0, Number(row.business_round) || 0);
  if (businessRound > 0) {
    await mirrorOpenSchedulesToLatestActivity(
      d1,
      organization,
      businessRound,
      await listStoredOrganizationSchedules(organization, businessRound),
    );
  }
  return scheduleJson({ ...row, id, label, scheduled_date: scheduledDate, start_time: startTime,
    end_time: endTime, end_date: scheduledDate,
    category, stage: category === "construction" ? label : "", details, completed: input.completed === true ? 1 : 0,
    assignee_member_id: Number.isSafeInteger(assigneeMemberId) && assigneeMemberId > 0 ? assigneeMemberId : null,
    assignee_name: assigneeName, updated_by_name: input.member.displayName });
}

export async function deleteOrganizationSchedule(input: { id: unknown; member: ScheduleActor }) {
  const { d1, row, id } = await requireEditableSchedule(input.id, input.member);
  if (clean(row.google_event_id)) {
    await d1.prepare(
      `UPDATE organization_schedules
       SET deleted_at = CURRENT_TIMESTAMP, sync_status = 'pending', sync_operation = 'delete',
           sync_error = '', updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(input.member.id, input.member.displayName, id).run();
  } else {
    await d1.prepare(`DELETE FROM organization_schedules WHERE id = ?`).bind(id).run();
  }
  const organization = String(row.organization ?? "");
  const businessRound = Math.max(0, Number(row.business_round) || 0);
  if (businessRound > 0) {
    await mirrorOpenSchedulesToLatestActivity(
      d1,
      organization,
      businessRound,
      await listStoredOrganizationSchedules(organization, businessRound),
    );
  }
  return { id };
}

export async function mergeActivityProgressSchedule(input: {
  activityId: number;
  organization: unknown;
  businessRound: unknown;
  progressSchedule: unknown;
  memberId: number;
  memberName: string;
}) {
  const organization = clean(input.organization).slice(0, 120);
  const businessRound = Math.max(1, Number(input.businessRound) || 1);
  const incoming = parseProgressScheduleEntries(clean(input.progressSchedule));
  if (!organization || !incoming.length) return;
  const d1 = await ensureOrganizationSchedulesReady();
  await d1.prepare(
    `INSERT OR IGNORE INTO organization_schedule_import_state (
       organization, business_round
     ) VALUES (?, ?)`,
  ).bind(organization, businessRound).run();
  const whizzupScope = await isWhizzupAwardScope(d1, organization, businessRound);
  const constructionIncoming = whizzupScope
    ? incoming.filter((schedule) => isConstructionStage(schedule.label))
    : [];
  const generalIncoming = incoming.filter(
    (schedule) => !whizzupScope || !isConstructionStage(schedule.label),
  );
  const current = await listStoredOrganizationSchedules(organization, businessRound);
  const merged = new Map(
    current.filter((schedule) => schedule.category !== "construction").map((schedule: OrganizationSchedule) => [
      scheduleNaturalKey(schedule.scheduledDate, schedule.label),
      {
        label: schedule.label,
        scheduledDate: schedule.scheduledDate,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        completed: schedule.completed,
      },
    ]),
  );
  generalIncoming.forEach((schedule) => {
    const key = scheduleNaturalKey(schedule.date, schedule.label);
    merged.set(key, {
      label: schedule.label,
      scheduledDate: schedule.date,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      completed: false,
    });
  });
  if (generalIncoming.length) {
    await replaceOrganizationSchedules({
      organization,
      businessRound,
      schedules: [...merged.values()],
      memberId: input.memberId,
      memberName: input.memberName,
    });
  }

  if (constructionIncoming.length) {
    await d1.prepare(
      `INSERT INTO construction_schedule_projects (
         organization, business_round, work_summary, work_summary_mode, completed,
         created_by, created_by_name, updated_by, updated_by_name
       ) VALUES (?, ?, '', 'auto', 0, ?, ?, ?, ?)
       ON CONFLICT(organization, business_round) DO UPDATE SET
         hidden_at = '', completed = 0,
         updated_by = excluded.updated_by,
         updated_by_name = excluded.updated_by_name,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      organization,
      businessRound,
      input.memberId,
      input.memberName,
      input.memberId,
      input.memberName,
    ).run();

    await d1.batch(constructionIncoming.map((schedule) => d1.prepare(
       `INSERT INTO organization_schedules (
          organization, business_round, label, scheduled_date, start_time, end_time, category, stage,
          end_date, completed, source_activity_id,
          created_by, created_by_name, updated_by, updated_by_name
        )
        SELECT ?, ?, ?, ?, ?, ?, 'construction', ?, ?, 0, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM organization_schedules
          WHERE organization = ? AND business_round = ? AND category = 'construction'
            AND stage = ? AND scheduled_date = ?
            AND COALESCE(NULLIF(end_date, ''), scheduled_date) = ?
            AND COALESCE(start_time, '') = ? AND COALESCE(end_time, '') = ?
        )`,
    ).bind(
      organization,
      businessRound,
       schedule.label,
       schedule.date,
       schedule.startTime,
       schedule.endTime,
       schedule.label,
      schedule.date,
      input.activityId,
      input.memberId,
      input.memberName,
      input.memberId,
      input.memberName,
      organization,
      businessRound,
      schedule.label,
      schedule.date,
       schedule.date,
       schedule.startTime,
       schedule.endTime,
     )));

    const duplicateGeneralWhere = `
      organization = ? AND business_round = ?
      AND COALESCE(category, 'general') <> 'construction'
      AND source_activity_id = ?
      AND EXISTS (
        SELECT 1 FROM organization_schedules construction
        WHERE construction.organization = organization_schedules.organization
          AND construction.business_round = organization_schedules.business_round
          AND construction.category = 'construction'
          AND construction.source_activity_id = ?
          AND construction.stage = organization_schedules.label
          AND construction.scheduled_date = organization_schedules.scheduled_date
          AND COALESCE(construction.start_time, '') = COALESCE(organization_schedules.start_time, '')
          AND COALESCE(construction.end_time, '') = COALESCE(organization_schedules.end_time, '')
          AND TRIM(COALESCE(construction.deleted_at, '')) = ''
      )`;
    await d1.batch([
      d1.prepare(
        `UPDATE organization_schedules
         SET deleted_at = CURRENT_TIMESTAMP, sync_status = 'pending', sync_operation = 'delete',
             sync_error = '', updated_by = ?, updated_by_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE ${duplicateGeneralWhere} AND TRIM(COALESCE(google_event_id, '')) <> ''`,
      ).bind(
        input.memberId,
        input.memberName,
        organization,
        businessRound,
        input.activityId,
        input.activityId,
      ),
      d1.prepare(
        `DELETE FROM organization_schedules
         WHERE ${duplicateGeneralWhere} AND TRIM(COALESCE(google_event_id, '')) = ''`,
      ).bind(
        organization,
        businessRound,
        input.activityId,
        input.activityId,
      ),
    ]);

    await d1.prepare(
      `UPDATE activities
       SET award_stage = CASE
         WHEN award_stage = '납품 완료' THEN award_stage
         ELSE '설치·공사 진행'
       END, updated_at = CURRENT_TIMESTAMP
       WHERE id = (
         SELECT id FROM activities
         WHERE organization = ? AND business_round = ? AND award_status = '위즈업 수주'
         ORDER BY activity_date DESC, id DESC LIMIT 1
       ) AND COALESCE(award_stage_manual, 0) = 0`,
    ).bind(organization, businessRound).run();

    const openSchedules = await d1.prepare(
      `SELECT * FROM organization_schedules
       WHERE organization = ? AND business_round = ?
         AND TRIM(COALESCE(deleted_at, '')) = ''
       ORDER BY scheduled_date ASC, id ASC`,
    ).bind(organization, businessRound).all<Record<string, unknown>>();
    await mirrorOpenSchedulesToLatestActivity(
      d1,
      organization,
      businessRound,
      openSchedules.results.map(scheduleJson),
    );
  }
}
