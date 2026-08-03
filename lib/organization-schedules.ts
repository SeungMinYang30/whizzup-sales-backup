import { getD1 } from "../db";
import { ensureCollaborationReady } from "./collaboration";
import {
  clean,
  ensureRecordsReady,
  parseProgressScheduleEntries,
} from "./records-store";

export type OrganizationSchedule = {
  id: number;
  organization: string;
  businessRound: number;
  label: string;
  scheduledDate: string;
  category: string;
  stage: string;
  endDate: string;
  vendorName: string;
  details: string;
  completed: boolean;
  sourceActivityId: number | null;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationScheduleInput = {
  label: string;
  scheduledDate: string;
  completed?: boolean;
};

export type ConstructionScheduleInput = {
  stage: string;
  scheduledDate: string;
  endDate?: string;
  vendorName?: string;
  details?: string;
  completed?: boolean;
};

export type ConstructionScheduleProject = {
  id: number;
  organization: string;
  businessRound: number;
  workSummary: string;
  completed: boolean;
  updatedAt: string;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS organization_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    label TEXT NOT NULL,
    scheduled_date TEXT NOT NULL,
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS organization_schedules_scope_date_idx
   ON organization_schedules (
     organization, business_round, completed, scheduled_date, id
   )`,
  `CREATE TABLE IF NOT EXISTS construction_schedule_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    work_summary TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_by_name TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization, business_round)
  )`,
];

let schedulesReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function initializeOrganizationSchedules() {
  const d1 = getD1();
  await ensureCollaborationReady();
  await ensureRecordsReady();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
  const columns = await d1.prepare("PRAGMA table_info(organization_schedules)").all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["category", "TEXT NOT NULL DEFAULT 'general'"],
    ["stage", "TEXT NOT NULL DEFAULT ''"],
    ["end_date", "TEXT NOT NULL DEFAULT ''"],
    ["vendor_name", "TEXT NOT NULL DEFAULT ''"],
    ["details", "TEXT NOT NULL DEFAULT ''"],
  ] as const;
  for (const [name, definition] of additions) {
    if (!names.has(name)) {
      await d1.prepare(`ALTER TABLE organization_schedules ADD COLUMN ${name} ${definition}`).run();
    }
  }
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

export function normalizeOrganizationScheduleInputs(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, OrganizationScheduleInput>();
  value.slice(0, 100).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const input = entry as Record<string, unknown>;
    const label = clean(input.label).slice(0, 120);
    const scheduledDate = validDate(input.scheduledDate ?? input.date);
    if (!label || !scheduledDate) return;
    unique.set(`${scheduledDate}\u001f${label.toLocaleLowerCase("ko-KR")}`, {
      label,
      scheduledDate,
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
    businessRound: Math.max(1, Number(row.business_round) || 1),
    label: String(row.label ?? ""),
    scheduledDate: String(row.scheduled_date ?? ""),
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
    createdByName: String(row.created_by_name ?? ""),
    updatedByName: String(row.updated_by_name ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
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
         AND COALESCE(category, 'general') <> 'construction'`,
    )
    .bind(organization, businessRound)
    .first<{ count: number }>();
  if (Number(existing?.count) > 0) return;

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
  if (!latest) return;
  const entries = parseProgressScheduleEntries(latest.progress_schedule);
  if (!entries.length) return;
  await d1.batch(
    entries.map((entry) =>
      d1
        .prepare(
          `INSERT INTO organization_schedules (
             organization, business_round, label, scheduled_date,
             completed, source_activity_id
           ) VALUES (?, ?, ?, ?, 0, ?)`,
        )
        .bind(
          organization,
          businessRound,
          entry.label,
          entry.date,
          Number(latest.id),
        ),
    ),
  );
}

export async function listOrganizationSchedules(
  organizationValue: unknown,
  businessRoundValue: unknown,
) {
  const organization = clean(organizationValue).slice(0, 120);
  const businessRound = Math.max(1, Number(businessRoundValue) || 1);
  if (!organization) return [];
  await importLegacyScheduleIfNeeded(organization, businessRound);
  const d1 = await ensureOrganizationSchedulesReady();
  const result = await d1
    .prepare(
      `SELECT *
       FROM organization_schedules
       WHERE organization = ? AND business_round = ?
         AND COALESCE(category, 'general') <> 'construction'
       ORDER BY completed ASC, scheduled_date ASC, id ASC`,
    )
    .bind(organization, businessRound)
    .all<Record<string, unknown>>();
  return result.results.map(scheduleJson);
}

function normalizeConstructionScheduleInputs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const input = entry as Record<string, unknown>;
    const stage = clean(input.stage ?? input.label).slice(0, 40);
    const scheduledDate = validDate(input.scheduledDate ?? input.startDate);
    const endDate = validDate(input.endDate) || scheduledDate;
    if (!stage || !scheduledDate || endDate < scheduledDate) return [];
    return [{
      stage,
      scheduledDate,
      endDate,
      vendorName: clean(input.vendorName).slice(0, 120),
      details: clean(input.details).slice(0, 500),
      completed: input.completed === true,
    } satisfies ConstructionScheduleInput];
  });
}

export async function listConstructionScheduleBoard() {
  const d1 = await ensureOrganizationSchedulesReady();
  const [projectsResult, schedulesResult] = await Promise.all([
    d1.prepare(
      `SELECT * FROM construction_schedule_projects
       ORDER BY completed ASC, updated_at DESC, organization COLLATE NOCASE ASC`,
    ).all<Record<string, unknown>>(),
    d1.prepare(
      `SELECT * FROM organization_schedules
       WHERE COALESCE(category, 'general') = 'construction'
       ORDER BY scheduled_date ASC, id ASC`,
    ).all<Record<string, unknown>>(),
  ]);
  return {
    projects: projectsResult.results.map((row) => ({
      id: Number(row.id),
      organization: String(row.organization ?? ""),
      businessRound: Math.max(1, Number(row.business_round) || 1),
      workSummary: String(row.work_summary ?? ""),
      completed: Number(row.completed) === 1,
      updatedAt: String(row.updated_at ?? ""),
    } satisfies ConstructionScheduleProject)),
    schedules: schedulesResult.results.map(scheduleJson),
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
  await d1.prepare(
    `INSERT INTO construction_schedule_projects (
       organization, business_round, work_summary, completed,
       created_by, created_by_name, updated_by, updated_by_name
     ) VALUES (?, ?, ?, 0, ?, ?, ?, ?)
     ON CONFLICT(organization, business_round) DO UPDATE SET
       work_summary = CASE WHEN excluded.work_summary <> '' THEN excluded.work_summary ELSE work_summary END,
       completed = 0,
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
  category?: unknown;
  memberId: number;
  memberName: string;
}) {
  const organization = clean(input.organization).slice(0, 120);
  const businessRound = Math.max(1, Number(input.businessRound) || 1);
  const label = clean(input.label).slice(0, 120);
  const scheduledDate = validDate(input.scheduledDate);
  const category = clean(input.category) === "showroom" ? "showroom" : "general";
  if (!organization || !label || !scheduledDate) {
    throw new Error("기관, 일정 제목, 날짜를 확인해 주세요.");
  }
  const d1 = await ensureOrganizationSchedulesReady();
  const existing = await d1.prepare(
    `SELECT id FROM organization_schedules
     WHERE organization = ? AND business_round = ? AND label = ?
       AND scheduled_date = ? AND completed = 0
     LIMIT 1`,
  ).bind(organization, businessRound, label, scheduledDate).first<{ id: number }>();
  if (!existing) {
    await d1.prepare(
      `INSERT INTO organization_schedules (
         organization, business_round, label, scheduled_date, category, completed,
         created_by, created_by_name, updated_by, updated_by_name
       ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    ).bind(
      organization,
      businessRound,
      label,
      scheduledDate,
      category,
      input.memberId,
      input.memberName,
      input.memberId,
      input.memberName,
    ).run();
  }
  const general = await listOrganizationSchedules(organization, businessRound);
  const construction = await d1.prepare(
    `SELECT * FROM organization_schedules
     WHERE organization = ? AND business_round = ? AND category = 'construction'`,
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
  completed?: unknown;
  schedules: unknown;
  memberId: number;
  memberName: string;
}) {
  const organization = clean(input.organization).slice(0, 120);
  const businessRound = Math.max(1, Number(input.businessRound) || 1);
  if (!organization) throw new Error("기관을 확인해 주세요.");
  const schedules = normalizeConstructionScheduleInputs(input.schedules);
  const d1 = await ensureOrganizationSchedulesReady();
  await d1.batch([
    d1.prepare(
      `INSERT INTO construction_schedule_projects (
         organization, business_round, work_summary, completed,
         created_by, created_by_name, updated_by, updated_by_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organization, business_round) DO UPDATE SET
         work_summary = excluded.work_summary,
         completed = excluded.completed,
         updated_by = excluded.updated_by,
         updated_by_name = excluded.updated_by_name,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      organization,
      businessRound,
      clean(input.workSummary).slice(0, 240),
      input.completed === true ? 1 : 0,
      input.memberId,
      input.memberName,
      input.memberId,
      input.memberName,
    ),
    d1.prepare(
      `DELETE FROM organization_schedules
       WHERE organization = ? AND business_round = ? AND category = 'construction'`,
    ).bind(organization, businessRound),
    ...schedules.map((schedule) => d1.prepare(
      `INSERT INTO organization_schedules (
         organization, business_round, label, scheduled_date, category, stage,
         end_date, vendor_name, details, completed,
         created_by, created_by_name, updated_by, updated_by_name
       ) VALUES (?, ?, ?, ?, 'construction', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      organization,
      businessRound,
      schedule.stage,
      schedule.scheduledDate,
      schedule.stage,
      schedule.endDate || schedule.scheduledDate,
      schedule.vendorName || "",
      schedule.details || "",
      schedule.completed ? 1 : 0,
      input.memberId,
      input.memberName,
      input.memberId,
      input.memberName,
    )),
  ]);
  const general = await listOrganizationSchedules(organization, businessRound);
  await mirrorOpenSchedulesToLatestActivity(d1, organization, businessRound, [
    ...general,
    ...schedules.map((schedule) => ({
      label: schedule.stage,
      scheduledDate: schedule.scheduledDate,
      completed: schedule.completed,
    })),
  ]);
  return listConstructionScheduleBoard();
}

async function mirrorOpenSchedulesToLatestActivity(
  d1: Awaited<ReturnType<typeof ensureOrganizationSchedulesReady>>,
  organization: string,
  businessRound: number,
  schedules: OrganizationScheduleInput[],
) {
  const progressSchedule = schedules
    .filter((schedule) => !schedule.completed)
    .map((schedule) => `${schedule.label}\t${schedule.scheduledDate}`)
    .join("\n");
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
  const statements = [
    d1
      .prepare(
        `DELETE FROM organization_schedules
         WHERE organization = ? AND business_round = ?
           AND COALESCE(category, 'general') <> 'construction'`,
      )
      .bind(organization, businessRound),
    ...schedules.map((schedule) =>
      d1
        .prepare(
          `INSERT INTO organization_schedules (
             organization, business_round, label, scheduled_date, category, completed,
             created_by, created_by_name, updated_by, updated_by_name
           ) VALUES (?, ?, ?, ?, 'general', ?, ?, ?, ?, ?)`,
        )
        .bind(
          organization,
          businessRound,
          schedule.label,
          schedule.scheduledDate,
          schedule.completed ? 1 : 0,
          input.memberId,
          input.memberName,
          input.memberId,
          input.memberName,
        ),
    ),
  ];
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
  const current = await listOrganizationSchedules(organization, businessRound);
  const merged = new Map(
    current.map((schedule: OrganizationSchedule) => [
      `${schedule.scheduledDate}\u001f${schedule.label.toLocaleLowerCase("ko-KR")}`,
      {
        label: schedule.label,
        scheduledDate: schedule.scheduledDate,
        completed: schedule.completed,
      },
    ]),
  );
  incoming.forEach((schedule) => {
    const key = `${schedule.date}\u001f${schedule.label.toLocaleLowerCase("ko-KR")}`;
    if (!merged.has(key)) {
      merged.set(key, {
        label: schedule.label,
        scheduledDate: schedule.date,
        completed: false,
      });
    }
  });
  await replaceOrganizationSchedules({
    organization,
    businessRound,
    schedules: [...merged.values()],
    memberId: input.memberId,
    memberName: input.memberName,
  });
}
