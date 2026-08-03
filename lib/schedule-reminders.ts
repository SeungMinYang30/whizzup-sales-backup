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
} from "./schedule-reminder-policy";

export type ScheduleReminderVisibility = "private" | "shared-post-award";

export type ScheduleReminder = {
  id: number;
  organization: string;
  businessRound: number;
  label: string;
  scheduledDate: string;
  visibility: ScheduleReminderVisibility;
  assigneeName: string;
};

function scheduleReminderFromRow(row: ReminderRow): ScheduleReminder {
  return {
    id: Number(row.id),
    organization: String(row.organization),
    businessRound: Math.max(1, Number(row.business_round) || 1),
    label: String(row.label),
    scheduledDate: String(row.scheduled_date),
    visibility: isSharedPostAwardSchedule({
      awardStatus: row.award_status,
      label: row.label,
    })
      ? "shared-post-award"
      : "private",
    assigneeName: hasAssignedManager(row.progress_manager)
      ? clean(row.progress_manager)
      : "",
  };
}

type ReminderRow = {
  id: number;
  organization: string;
  business_round: number;
  label: string;
  scheduled_date: string;
  created_by: number | null;
  created_by_name: string;
  source_author_id: number | null;
  source_author_name: string;
  award_status: string;
  progress_manager: string;
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
  s.scheduled_date,
  s.created_by,
  s.created_by_name,
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
         AND s.scheduled_date <= ?
       ORDER BY s.scheduled_date ASC, s.id ASC`,
    )
    .bind(endDate)
    .all<ReminderRow>();

  return result.results
    .filter((row) =>
      canMemberSeeScheduleReminder(
        {
          awardStatus: row.award_status,
          label: row.label,
          progressManager: row.progress_manager,
          creatorMemberId: row.created_by ?? row.source_author_id,
          creatorName: row.created_by_name || row.source_author_name,
        },
        member,
      ),
    )
    .slice(0, 100)
    .map(scheduleReminderFromRow);
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
         AND s.scheduled_date BETWEEN ? AND ?
       ORDER BY s.scheduled_date ASC, s.id ASC`,
    )
    .bind(startDate, endDate)
    .all<ReminderRow>();

  return result.results
    .filter((row) =>
      canMemberSeeScheduleReminder(
        {
          awardStatus: row.award_status,
          label: row.label,
          progressManager: row.progress_manager,
          creatorMemberId: row.created_by ?? row.source_author_id,
          creatorName: row.created_by_name || row.source_author_name,
        },
        member,
      ),
    )
    .slice(0, 500)
    .map(scheduleReminderFromRow);
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
        label: row.label,
        scheduledDate: row.scheduled_date,
        progressManager: row.progress_manager,
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
