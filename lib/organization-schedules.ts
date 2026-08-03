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

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS organization_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    label TEXT NOT NULL,
    scheduled_date TEXT NOT NULL,
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
];

let schedulesReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function initializeOrganizationSchedules() {
  const d1 = getD1();
  await ensureCollaborationReady();
  await ensureRecordsReady();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
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
       WHERE organization = ? AND business_round = ?`,
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
       ORDER BY completed ASC, scheduled_date ASC, id ASC`,
    )
    .bind(organization, businessRound)
    .all<Record<string, unknown>>();
  return result.results.map(scheduleJson);
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
         WHERE organization = ? AND business_round = ?`,
      )
      .bind(organization, businessRound),
    ...schedules.map((schedule) =>
      d1
        .prepare(
          `INSERT INTO organization_schedules (
             organization, business_round, label, scheduled_date, completed,
             created_by, created_by_name, updated_by, updated_by_name
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
