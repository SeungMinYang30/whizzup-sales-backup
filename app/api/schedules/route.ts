import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  addOrganizationSchedule,
  addConstructionScheduleProject,
  deleteOrganizationSchedule,
  listConstructionScheduleBoard,
  listOrganizationSchedules,
  removeConstructionScheduleProject,
  replaceOrganizationSchedules,
  saveConstructionSchedules,
  updateOrganizationSchedule,
} from "../../../lib/organization-schedules";
import {
  completeScheduleReminderForMember,
  listScheduleCalendarForMember,
  listScheduleRemindersForMember,
} from "../../../lib/schedule-reminders";
import { listGoogleCalendarSchedules } from "../../../lib/google-calendar-feed";

export const dynamic = "force-dynamic";

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  try {
    const member = await requireApprovedMember();
    const url = new URL(request.url);
    if (url.searchParams.get("scope") === "construction-board") {
      return Response.json(await listConstructionScheduleBoard());
    }
    if (url.searchParams.get("scope") === "calendar") {
      const start = url.searchParams.get("start") ?? "";
      const end = url.searchParams.get("end") ?? "";
      if (!validCalendarDate(start) || !validCalendarDate(end) || start > end) {
        throw new Error("달력 조회 기간을 확인해 주세요.");
      }
      const span = Math.floor(
        (new Date(`${end}T00:00:00Z`).valueOf() -
          new Date(`${start}T00:00:00Z`).valueOf()) /
          86_400_000,
      );
      if (span > 62) throw new Error("달력은 한 번에 두 달까지만 조회할 수 있습니다.");
      const [siteSchedules, google] = await Promise.all([
        listScheduleCalendarForMember(member, start, end),
        listGoogleCalendarSchedules(start, end),
      ]);
      return Response.json({
        schedules: [...siteSchedules, ...google.events],
        currentMember: { id: member.id, displayName: member.displayName, role: member.role },
        googleCalendarConfigured: google.configured,
        googleCalendarConnected: google.connected,
      });
    }
    if (url.searchParams.get("scope") === "reminders") {
      return Response.json({
        reminders: await listScheduleRemindersForMember(member),
      });
    }
    const organization = url.searchParams.get("organization") ?? "";
    const businessRound = url.searchParams.get("businessRound") ?? "1";
    return Response.json({
      schedules: await listOrganizationSchedules(organization, businessRound),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    if (payload.action === "save-construction") {
      return Response.json(await saveConstructionSchedules({
        organization: payload.organization,
        businessRound: payload.businessRound,
        workSummary: payload.workSummary,
        workSummaryMode: payload.workSummaryMode,
        completed: payload.completed,
        schedules: payload.schedules,
        memberId: member.id,
        memberName: member.displayName,
      }));
    }
    if (payload.action === "update-general-schedule") {
      return Response.json({ schedule: await updateOrganizationSchedule({
        id: payload.scheduleId,
        label: payload.label,
        scheduledDate: payload.scheduledDate,
        category: payload.category,
        assigneeMemberId: payload.assigneeMemberId,
        assigneeName: payload.assigneeName,
        completed: payload.completed,
        member,
      }) });
    }
    const schedules = await replaceOrganizationSchedules({
      organization: payload.organization,
      businessRound: payload.businessRound,
      schedules: payload.schedules,
      memberId: member.id,
      memberName: member.displayName,
    });
    return Response.json({ schedules });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    if (payload.action === "add-general-schedule") {
      return Response.json({ schedules: await addOrganizationSchedule({
        organization: payload.organization,
        businessRound: payload.businessRound,
        label: payload.label,
        scheduledDate: payload.scheduledDate,
        category: payload.category,
        linked: payload.linked,
        assigneeMemberId: payload.assigneeMemberId,
        assigneeName: payload.assigneeName,
        memberId: member.id,
        memberName: member.displayName,
      }) });
    }
    if (payload.action !== "add-construction-project") {
      throw new Error("추가할 일정 정보를 확인해 주세요.");
    }
    return Response.json(await addConstructionScheduleProject({
      organization: payload.organization,
      businessRound: payload.businessRound,
      workSummary: payload.workSummary,
      memberId: member.id,
      memberName: member.displayName,
    }));
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    if (payload.action === "delete-general-schedule") {
      return Response.json(await deleteOrganizationSchedule({ id: payload.scheduleId, member }));
    }
    if (payload.action !== "remove-construction-project") {
      throw new Error("삭제할 일정표 기관을 확인해 주세요.");
    }
    return Response.json(await removeConstructionScheduleProject({
      organization: payload.organization,
      businessRound: payload.businessRound,
    }));
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const schedule = await completeScheduleReminderForMember(
      payload.scheduleId,
      member,
    );
    return Response.json({ schedule });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
