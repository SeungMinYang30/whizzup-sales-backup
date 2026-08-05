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
  setConstructionScheduleProjectHidden,
  updateOrganizationSchedule,
} from "../../../lib/organization-schedules";
import {
  completeScheduleReminderForMember,
  listScheduleCalendarForMember,
  listScheduleRemindersForMember,
} from "../../../lib/schedule-reminders";
import { listGoogleCalendarSchedules } from "../../../lib/google-calendar-feed";
import {
  flushGoogleCalendarSync,
  deleteUnlinkedGoogleCalendarSchedule,
  linkGoogleCalendarSchedule,
  listCalendarSyncIssues,
  reconcileGoogleCalendarRange,
  retryGoogleCalendarSync,
} from "../../../lib/google-calendar-sync";

export const dynamic = "force-dynamic";

function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function scheduleDedupeKey(schedule: Record<string, unknown>) {
  const text = (value: unknown) => String(value || "").trim().toLocaleLowerCase("ko-KR");
  return [
    text(schedule.organization),
    text(schedule.label),
    text(schedule.scheduledDate),
    text(schedule.endDate || schedule.scheduledDate),
    text(schedule.startTime),
    text(schedule.endTime),
  ].join("\u001f");
}

function mergeCalendarSchedules(
  siteSchedules: Array<Record<string, unknown>>,
  googleSchedules: Array<Record<string, unknown>>,
) {
  const merged = new Map<string, Record<string, unknown>>();
  siteSchedules.forEach((schedule) => merged.set(scheduleDedupeKey(schedule), schedule));
  googleSchedules.forEach((schedule) => {
    const key = scheduleDedupeKey(schedule);
    if (!merged.has(key)) merged.set(key, schedule);
  });
  return [...merged.values()];
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
      await flushGoogleCalendarSync({ limit: 25 });
      const apiGoogle = await reconcileGoogleCalendarRange(start, end);
      const feedGoogle = apiGoogle.configured
        ? { configured: false, connected: false, events: [] }
        : await listGoogleCalendarSchedules(start, end);
      const [siteSchedules, syncIssues] = await Promise.all([
        listScheduleCalendarForMember(member, start, end),
        listCalendarSyncIssues(),
      ]);
      const readOnlyGoogle = apiGoogle.configured ? apiGoogle.readOnlyEvents : feedGoogle.events;
      return Response.json({
        schedules: mergeCalendarSchedules(
          siteSchedules as unknown as Array<Record<string, unknown>>,
          readOnlyGoogle as unknown as Array<Record<string, unknown>>,
        ),
        currentMember: { id: member.id, displayName: member.displayName, role: member.role },
        googleCalendarConfigured: apiGoogle.configured || feedGoogle.configured,
        googleCalendarConnected: apiGoogle.configured ? apiGoogle.connected : feedGoogle.connected,
        googleCalendarWritable: apiGoogle.configured && apiGoogle.connected,
        googleCalendarError: apiGoogle.error || "",
        syncIssues,
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
      const board = await saveConstructionSchedules({
        organization: payload.organization,
        businessRound: payload.businessRound,
        workSummary: payload.workSummary,
        workSummaryMode: payload.workSummaryMode,
        completed: payload.completed,
        schedules: payload.schedules,
        memberId: member.id,
        memberName: member.displayName,
      });
      await flushGoogleCalendarSync({ limit: 50 });
      return Response.json(board);
    }
    if (payload.action === "update-general-schedule") {
      const schedule = await updateOrganizationSchedule({
        id: payload.scheduleId,
        label: payload.label,
        scheduledDate: payload.scheduledDate,
        startTime: payload.startTime,
        endTime: payload.endTime,
        category: payload.category,
        assigneeMemberId: payload.assigneeMemberId,
        assigneeName: payload.assigneeName,
        details: payload.details,
        completed: payload.completed,
        member,
      });
      await flushGoogleCalendarSync({ ids: [schedule.id] });
      return Response.json({ schedule });
    }
    await replaceOrganizationSchedules({
      organization: payload.organization,
      businessRound: payload.businessRound,
      schedules: payload.schedules,
      memberId: member.id,
      memberName: member.displayName,
    });
    await flushGoogleCalendarSync({ limit: 50 });
    return Response.json({
      schedules: await listOrganizationSchedules(payload.organization, payload.businessRound),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    if (payload.action === "retry-google-sync") {
      await retryGoogleCalendarSync(payload.scheduleId);
      return Response.json({ syncIssues: await listCalendarSyncIssues() });
    }
    if (payload.action === "link-google-schedule") {
      const linked = await linkGoogleCalendarSchedule({
        googleEventId: payload.googleEventId,
        organization: payload.organization,
        businessRound: payload.businessRound,
        title: payload.title,
        label: payload.label,
        category: payload.category,
        assigneeMemberId: payload.assigneeMemberId,
        assigneeName: payload.assigneeName,
        details: payload.details,
        completed: payload.completed,
        member,
      });
      return Response.json({ schedule: linked });
    }
    if (payload.action === "add-general-schedule") {
      await addOrganizationSchedule({
        organization: payload.organization,
        businessRound: payload.businessRound,
        label: payload.label,
        scheduledDate: payload.scheduledDate,
        startTime: payload.startTime,
        endTime: payload.endTime,
        category: payload.category,
        linked: payload.linked,
        assigneeMemberId: payload.assigneeMemberId,
        assigneeName: payload.assigneeName,
        details: payload.details,
        memberId: member.id,
        memberName: member.displayName,
      });
      await flushGoogleCalendarSync({ limit: 25 });
      return Response.json({
        schedules: payload.linked === false
          ? []
          : await listOrganizationSchedules(payload.organization, payload.businessRound),
      });
    }
    if (payload.action === "hide-construction-project" || payload.action === "restore-construction-project") {
      return Response.json(await setConstructionScheduleProjectHidden({
        organization: payload.organization,
        businessRound: payload.businessRound,
        hidden: payload.action === "hide-construction-project",
        memberId: member.id,
        memberName: member.displayName,
      }));
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
      const deleted = await deleteOrganizationSchedule({ id: payload.scheduleId, member });
      await flushGoogleCalendarSync({ ids: [Number(payload.scheduleId)] });
      return Response.json(deleted);
    }
    if (payload.action === "delete-google-calendar-event") {
      return Response.json(await deleteUnlinkedGoogleCalendarSchedule(payload.googleEventId, member));
    }
    if (payload.action !== "remove-construction-project") {
      throw new Error("삭제할 일정표 기관을 확인해 주세요.");
    }
    const board = await removeConstructionScheduleProject({
      organization: payload.organization,
      businessRound: payload.businessRound,
    });
    await flushGoogleCalendarSync({ limit: 50 });
    return Response.json(board);
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
    if (schedule?.id) await flushGoogleCalendarSync({ ids: [schedule.id] });
    return Response.json({ schedule });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
