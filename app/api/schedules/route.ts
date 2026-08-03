import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  listOrganizationSchedules,
  replaceOrganizationSchedules,
} from "../../../lib/organization-schedules";
import {
  completeScheduleReminderForMember,
  listScheduleCalendarForMember,
  listScheduleRemindersForMember,
} from "../../../lib/schedule-reminders";

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
      return Response.json({
        schedules: await listScheduleCalendarForMember(member, start, end),
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
