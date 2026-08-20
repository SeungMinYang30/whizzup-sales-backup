import { after } from "next/server";
import {
  AccessError,
  accessErrorResponse,
  isPrimaryOwner,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  addOrganizationSchedule,
  addConstructionScheduleProject,
  deleteOrganizationSchedule,
  listConstructionScheduleBoard,
  listConstructionStageOptions,
  listScheduleCancellationCandidates,
  listOrganizationSchedules,
  removeConstructionScheduleProject,
  replaceOrganizationSchedules,
  saveConstructionSchedules,
  setConstructionScheduleCandidateHidden,
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
  listReadOnlyGoogleCalendarRange,
  reconcileGoogleCalendarRange,
  retryGoogleCalendarSync,
} from "../../../lib/google-calendar-sync";
import { mergeCalendarSchedules } from "../../../lib/calendar-schedule-merge";

export const dynamic = "force-dynamic";

function scheduleErrorResponse(error: unknown) {
  if (error instanceof AccessError) return accessErrorResponse(error);
  const requestId = crypto.randomUUID();
  console.error("Schedule API request failed", {
    requestId,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  if (error instanceof Error && /일정|기관|담당자|시간|날짜|달력|calendar|google|공사|시공|납품|교육|검수|구글/i.test(error.message)) {
    return Response.json(
      { error: error.message, requestId },
      { status: /google|calendar|구글|캘린더/i.test(error.message) ? 502 : 400 },
    );
  }
  return Response.json(
    { error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", requestId },
    { status: 500 },
  );
}

function queueGoogleCalendarSync(options: { ids?: number[]; limit?: number; source: string }) {
  after(async () => {
    try {
      await flushGoogleCalendarSync({ ids: options.ids, limit: options.limit });
    } catch (error) {
      console.error("Google Calendar background sync failed", {
        source: options.source,
        ids: options.ids,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

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
      const board = await listConstructionScheduleBoard();
      if (await isPrimaryOwner(member)) return Response.json(board);
      const hiddenScopes = new Set(
        board.projects
          .filter((project) => project.hidden)
          .map((project) => `${project.organization}\u001f${project.businessRound}`),
      );
      return Response.json({
        projects: board.projects.filter((project) => !project.hidden),
        schedules: board.schedules.filter(
          (schedule) =>
            !hiddenScopes.has(`${schedule.organization}\u001f${schedule.businessRound}`),
        ),
      });
    }
    if (url.searchParams.get("scope") === "construction-stages") {
      return Response.json({
        stages: await listConstructionStageOptions(
          url.searchParams.get("organization"),
          url.searchParams.get("businessRound"),
        ),
      });
    }
    if (url.searchParams.get("scope") === "calendar") {
      const start = url.searchParams.get("start") ?? "";
      const end = url.searchParams.get("end") ?? "";
      const refreshGoogle = url.searchParams.get("refreshGoogle") !== "0";
      const directSitesStandby = url.hostname.endsWith(".chatgpt.site");
      if (!validCalendarDate(start) || !validCalendarDate(end) || start > end) {
        throw new Error("달력 조회 기간을 확인해 주세요.");
      }
      const span = Math.floor(
        (new Date(`${end}T00:00:00Z`).valueOf() -
          new Date(`${start}T00:00:00Z`).valueOf()) /
          86_400_000,
      );
      if (span > 62) throw new Error("달력은 한 번에 두 달까지만 조회할 수 있습니다.");
      if (!refreshGoogle) {
        const [siteSchedules, syncIssues, standbyGoogle] = await Promise.all([
          listScheduleCalendarForMember(member, start, end),
          listCalendarSyncIssues(),
          directSitesStandby
            ? listReadOnlyGoogleCalendarRange(start, end)
            : Promise.resolve({ configured: false, connected: false, events: [] }),
        ]);
        return Response.json({
          schedules: mergeCalendarSchedules(
            siteSchedules as unknown as Array<Record<string, unknown>>,
            standbyGoogle.events as unknown as Array<Record<string, unknown>>,
          ),
          currentMember: { id: member.id, displayName: member.displayName, role: member.role },
          syncIssues,
          googleCalendarConfigured: standbyGoogle.configured,
          googleCalendarConnected: standbyGoogle.connected,
          googleCalendarWritable: false,
          googleCalendarError:
            standbyGoogle.configured && !standbyGoogle.connected
              ? "Google 캘린더 읽기 전용 피드를 불러오지 못했습니다."
              : "",
          googleRefreshPending: !directSitesStandby,
        });
      }
      try {
        await flushGoogleCalendarSync({ limit: 50 });
      } catch (error) {
        console.error(
          "Google Calendar refresh sync failed",
          error instanceof Error ? error.message : String(error),
        );
      }
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
        googleRefreshPending: false,
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
    return scheduleErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    if (payload.action === "save-construction") {
      const saved = await saveConstructionSchedules({
        organization: payload.organization,
        businessRound: payload.businessRound,
        workSummary: payload.workSummary,
        workSummaryMode: payload.workSummaryMode,
        completed: payload.completed,
        schedules: payload.schedules,
        memberId: member.id,
        memberName: member.displayName,
      });
      if (saved.syncIds.length) {
        const syncIds = [...saved.syncIds];
        after(async () => {
          try {
            for (let index = 0; index < syncIds.length; index += 50) {
              await flushGoogleCalendarSync({ ids: syncIds.slice(index, index + 50) });
            }
          } catch (error) {
            console.error(
              "Construction Google Calendar background sync failed",
              error instanceof Error ? error.message : "Unknown error",
            );
          }
        });
      }
      return Response.json({
        project: saved.project,
        schedules: saved.schedules,
        googleSyncPending: saved.syncIds.length > 0,
      });
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
        content: payload.content,
        details: payload.details,
        completed: payload.completed,
        member,
      });
      queueGoogleCalendarSync({ ids: [schedule.id], source: "update-general-schedule" });
      return Response.json({ schedule, googleSyncPending: true });
    }
    await replaceOrganizationSchedules({
      organization: payload.organization,
      businessRound: payload.businessRound,
      schedules: payload.schedules,
      memberId: member.id,
      memberName: member.displayName,
    });
    queueGoogleCalendarSync({ limit: 50, source: "replace-organization-schedules" });
    return Response.json({
      schedules: await listOrganizationSchedules(payload.organization, payload.businessRound),
    });
  } catch (error) {
    return scheduleErrorResponse(error);
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
    if (payload.action === "preview-schedule-cancellation") {
      return Response.json({
        schedules: await listScheduleCancellationCandidates({
          organizations: payload.organizations,
          scheduledDates: payload.scheduledDates,
        }),
      });
    }
    if (payload.action === "cancel-schedule-candidates") {
      const ids = Array.isArray(payload.scheduleIds)
        ? [...new Set(payload.scheduleIds.map(Number))].filter(
            (id) => Number.isSafeInteger(id) && id > 0,
          ).slice(0, 50)
        : [];
      if (!ids.length) throw new Error("취소할 일정을 확인해 주세요.");
      for (const id of ids) await deleteOrganizationSchedule({ id, member });
      queueGoogleCalendarSync({ ids, source: "cancel-schedule-candidates" });
      return Response.json({ cancelledIds: ids, googleSyncPending: true });
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
        content: payload.content,
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
        content: payload.content,
        details: payload.details,
        memberId: member.id,
        memberName: member.displayName,
      });
      queueGoogleCalendarSync({ limit: 25, source: "add-general-schedule" });
      return Response.json({
        schedules: payload.linked === false
          ? []
          : await listOrganizationSchedules(payload.organization, payload.businessRound),
      });
    }
    if (
      payload.action === "hide-construction-project" ||
      payload.action === "restore-construction-project" ||
      payload.action === "hide-construction-candidate" ||
      payload.action === "restore-construction-candidate"
    ) {
      if (!(await isPrimaryOwner(member))) {
        return Response.json(
          { error: "시공·납품 일정표의 기관 숨김·다시 표시는 기본 운영자만 할 수 있습니다." },
          { status: 403 },
        );
      }
      if (
        payload.action === "hide-construction-candidate" ||
        payload.action === "restore-construction-candidate"
      ) {
        return Response.json(await setConstructionScheduleCandidateHidden({
          organization: payload.organization,
          businessRound: payload.businessRound,
          hidden: payload.action === "hide-construction-candidate",
          memberId: member.id,
          memberName: member.displayName,
        }));
      }
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
    return scheduleErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    if (payload.action === "delete-general-schedule") {
      const deleted = await deleteOrganizationSchedule({ id: payload.scheduleId, member });
      queueGoogleCalendarSync({ ids: [Number(payload.scheduleId)], source: "delete-general-schedule" });
      return Response.json({ ...deleted, googleSyncPending: true });
    }
    if (payload.action === "delete-google-calendar-event") {
      return Response.json(await deleteUnlinkedGoogleCalendarSchedule(payload.googleEventId, member));
    }
    if (payload.action !== "remove-construction-project") {
      throw new Error("삭제할 일정표 기관을 확인해 주세요.");
    }
    if (!(await isPrimaryOwner(member))) {
      return Response.json(
        { error: "시공·납품 일정표의 기관 삭제는 기본 운영자만 할 수 있습니다." },
        { status: 403 },
      );
    }
    const board = await removeConstructionScheduleProject({
      organization: payload.organization,
      businessRound: payload.businessRound,
    });
    queueGoogleCalendarSync({ limit: 50, source: "remove-construction-project" });
    return Response.json(board, { headers: { "X-Google-Sync-Pending": "1" } });
  } catch (error) {
    return scheduleErrorResponse(error);
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
    if (schedule?.id) {
      queueGoogleCalendarSync({ ids: [schedule.id], source: "complete-schedule-reminder" });
    }
    return Response.json({ schedule, googleSyncPending: Boolean(schedule?.id) });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
