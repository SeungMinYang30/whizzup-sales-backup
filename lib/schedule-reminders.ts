import { getD1 } from "../db";
import type { Member } from "./collaboration";
import {
  ensureOrganizationSchedulesReady,
  markOrganizationScheduleCompleted,
} from "./organization-schedules";
import { clean, koreaTodayValue } from "./records-store";
import {
  canCompleteScheduleReminder,
  canMemberSeeScheduleReminder,
  isSharedPostAwardSchedule,
  isSharedSalesSchedule,
} from "./schedule-reminder-policy";

export type ScheduleReminderVisibility = "private" | "shared" | "shared-post-award";

export type ScheduleReminder = {
  id: number;
  organization: string;
  businessRound: number;
  label: string;
  category: "sales" | "meeting" | "construction" | "showroom" | "other" | "personal";
  scheduledDate: string;
  startTime: string;
  endTime: string;
  endDate: string;
  visibility: ScheduleReminderVisibility;
  assigneeName: string;
  assigneeMemberId: number | null;
  editable: boolean;
  updatedAt: string;
  updatedByName: string;
  conflict: boolean;
  syncStatus: "pending" | "synced" | "failed";
  syncError: string;
  syncAttempts: number;
};

function scheduleReminderFromRow(
  row: ReminderRow,
  member?: Pick<Member, "id" | "role">,
  conflict = false,
): ScheduleReminder {
  const label = String(row.label);
  const storedCategory = clean(row.category);
  const sharedSales = isSharedSalesSchedule({
    category: storedCategory,
    label,
  });
  const category: ScheduleReminder["category"] =
    storedCategory === "construction"
      ? "construction"
      : storedCategory === "meeting"
        ? "meeting"
      : storedCategory === "showroom" || /쇼룸|전시/.test(label)
        ? "showroom"
        : storedCategory === "other"
          ? "other"
        : storedCategory === "personal"
          ? "personal"
        : sharedSales
          ? "sales"
          : /재연락|다시\s*연락|연락\s*예정/.test(label)
            ? "personal"
            : "sales";
  return {
    id: Number(row.id),
    organization: String(row.organization),
    businessRound: Math.max(0, Number(row.business_round) || 0),
    label,
    category,
    scheduledDate: String(row.scheduled_date),
    startTime: String(row.start_time ?? ""),
    endTime: String(row.end_time ?? ""),
    endDate: String(row.end_date || row.scheduled_date),
    visibility: sharedSales
      ? "shared"
      : isSharedPostAwardSchedule({
          awardStatus: row.award_status,
          label: row.label,
        })
        ? "shared-post-award"
        : "private",
    assigneeName: hasAssignedManager(row.assignee_name)
      ? clean(row.assignee_name)
      : hasAssignedManager(row.progress_manager)
        ? clean(row.progress_manager)
      : "",
    assigneeMemberId: Number(row.assignee_member_id) > 0 ? Number(row.assignee_member_id) : null,
    editable: Boolean(member) && (
      member?.role === "admin" || Number(row.created_by) === member?.id
      || Number(row.assignee_member_id) === member?.id
    ),
    updatedAt: String(row.updated_at ?? ""),
    updatedByName: String(row.updated_by_name ?? ""),
    conflict,
    syncStatus: ["synced", "failed"].includes(String(row.sync_status))
      ? String(row.sync_status) as "synced" | "failed"
      : "pending",
    syncError: String(row.sync_error || ""),
    syncAttempts: Math.max(0, Number(row.sync_attempts) || 0),
  };
}

type ReminderRow = {
  id: number;
  organization: string;
  business_round: number;
  label: string;
  category: string;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  end_date: string;
  created_by: number | null;
  created_by_name: string;
  assignee_member_id: number | null;
  assignee_name: string;
  source_author_id: number | null;
  source_author_name: string;
  award_status: string;
  progress_manager: string;
  updated_at: string;
  updated_by_name: string;
  sync_status: string;
  sync_error: string;
  sync_attempts: number;
};

function hasAssignedManager(value: unknown) {
  const manager = clean(value);
  return Boolean(manager) && !["미정", "미지정", "해당 없음"].includes(manager);
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const reminderSelect = `WITH ranked_activities AS (
  SELECT
    a.id,
    a.organization,
    a.business_round,
    a.award_status,
    a.progress_manager,
    ROW_NUMBER() OVER (
      PARTITION BY a.organization, a.business_round
      ORDER BY a.activity_date DESC, a.id DESC
    ) AS row_number
  FROM activities a
  WHERE TRIM(COALESCE(a.organization, '')) <> ''
), latest_activities AS (
  SELECT * FROM ranked_activities WHERE row_number = 1
)
SELECT
  s.id,
  s.organization,
  s.business_round,
  s.label,
  COALESCE(s.category, 'general') AS category,
  s.scheduled_date,
  COALESCE(s.start_time, '') AS start_time,
  COALESCE(s.end_time, '') AS end_time,
  COALESCE(NULLIF(s.end_date, ''), s.scheduled_date) AS end_date,
  s.created_by,
  s.created_by_name,
  s.assignee_member_id,
  COALESCE(s.assignee_name, '') AS assignee_name,
  s.updated_at,
  s.updated_by_name,
  COALESCE(s.sync_status, 'pending') AS sync_status,
  COALESCE(s.sync_error, '') AS sync_error,
  COALESCE(s.sync_attempts, 0) AS sync_attempts,
  source_author.member_id AS source_author_id,
  COALESCE(source_author.created_by_name, '') AS source_author_name,
  COALESCE(latest.award_status, '미정') AS award_status,
  COALESCE(latest.progress_manager, '') AS progress_manager
FROM organization_schedules s
LEFT JOIN latest_activities latest
  ON latest.organization = s.organization
 AND latest.business_round = s.business_round
LEFT JOIN activity_authors source_author
  ON source_author.activity_id = COALESCE(s.source_activity_id, latest.id)`;

export async function listScheduleRemindersForMember(
  member: Pick<Member, "id" | "displayName" | "role">,
  todayValue = koreaTodayValue(),
) {
  await ensureOrganizationSchedulesReady();
  const d1 = getD1();
  const endDate = addDays(todayValue, 2);
  const result = await d1
    .prepare(
      `${reminderSelect}
       WHERE s.completed = 0
         AND TRIM(COALESCE(s.deleted_at, '')) = ''
         AND s.scheduled_date <= ?
       ORDER BY s.scheduled_date ASC, COALESCE(s.start_time, '') ASC, s.id ASC`,
    )
    .bind(endDate)
    .all<ReminderRow>();

  const visible = result.results
    .filter((row: ReminderRow) =>
      /재연락|다시\s*연락|연락\s*예정/.test(clean(row.label)),
    )
    .filter((row: ReminderRow) =>
      canMemberSeeScheduleReminder(
        {
          awardStatus: row.award_status,
          category: row.category,
          label: row.label,
          progressManager: row.assignee_name || row.progress_manager,
          creatorMemberId: row.created_by ?? row.source_author_id,
          creatorName: row.created_by_name || row.source_author_name,
        },
        member,
      ),
    )
    .slice(0, 100);
  const counts = new Map<string, number>();
  visible.forEach((row: ReminderRow) => {
    const assignee = hasAssignedManager(row.assignee_name || row.progress_manager)
      ? clean(row.assignee_name || row.progress_manager)
      : "";
    if (!assignee) return;
    const key = `${row.scheduled_date}\u001f${assignee}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return visible.map((row: ReminderRow) => {
    const assignee = hasAssignedManager(row.assignee_name || row.progress_manager)
      ? clean(row.assignee_name || row.progress_manager)
      : "";
    return scheduleReminderFromRow(
      row,
      member,
      Boolean(assignee) && (counts.get(`${row.scheduled_date}\u001f${assignee}`) ?? 0) > 1,
    );
  });
}

export async function listScheduleCalendarForMember(
  member: Pick<Member, "id" | "displayName" | "role">,
  startDate: string,
  endDate: string,
) {
  await ensureOrganizationSchedulesReady();
  const d1 = getD1();
  const result = await d1
    .prepare(
      `${reminderSelect}
       WHERE s.completed = 0
         AND TRIM(COALESCE(s.deleted_at, '')) = ''
         AND s.scheduled_date <= ?
         AND COALESCE(NULLIF(s.end_date, ''), s.scheduled_date) >= ?
       ORDER BY s.scheduled_date ASC, COALESCE(s.start_time, '') ASC, s.id ASC`,
    )
    .bind(endDate, startDate)
    .all<ReminderRow>();

  return result.results
    .filter((row: ReminderRow) =>
      canMemberSeeScheduleReminder(
        {
          awardStatus: row.award_status,
          category: row.category,
          label: row.label,
          progressManager: row.assignee_name || row.progress_manager,
          creatorMemberId: row.created_by ?? row.source_author_id,
          creatorName: row.created_by_name || row.source_author_name,
        },
        member,
      ),
    )
    .slice(0, 500)
    .map((row: ReminderRow) => scheduleReminderFromRow(row, member));
}

export async function completeScheduleReminderForMember(
  scheduleIdValue: unknown,
  member: Pick<Member, "id" | "displayName" | "role">,
  todayValue = koreaTodayValue(),
) {
  const scheduleId = Number(scheduleIdValue);
  if (!Number.isSafeInteger(scheduleId) || scheduleId <= 0) {
    throw new Error("확인할 일정을 선택해 주세요.");
  }
  const d1 = await ensureOrganizationSchedulesReady();
  const row = await d1
    .prepare(`${reminderSelect} WHERE s.id = ? AND s.completed = 0`)
    .bind(scheduleId)
    .first<ReminderRow>();
  if (!row) throw new Error("이미 확인했거나 찾을 수 없는 일정입니다.");
  if (
    !canCompleteScheduleReminder(
      {
        awardStatus: row.award_status,
        category: row.category,
        label: row.label,
        scheduledDate: row.scheduled_date,
        progressManager: row.assignee_name || row.progress_manager,
        creatorMemberId: row.created_by ?? row.source_author_id,
        creatorName: row.created_by_name || row.source_author_name,
      },
      member,
      todayValue,
    )
  ) {
    throw new Error("지난 본인 일정만 확인 완료할 수 있습니다.");
  }
  return markOrganizationScheduleCompleted({
    id: row.id,
    organization: row.organization,
    businessRound: row.business_round,
    memberId: member.id,
    memberName: member.displayName,
  });
}
