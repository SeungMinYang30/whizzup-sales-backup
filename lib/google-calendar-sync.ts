import "server-only";

import { getD1 } from "../db";
import {
  deleteGoogleCalendarEvent,
  findGoogleCalendarEventByScheduleId,
  googleCalendarApiConfigured,
  listGoogleCalendarApiEvents,
  type GoogleCalendarApiEvent,
  upsertGoogleCalendarEvent,
} from "./google-calendar-api";
import { ensureOrganizationSchedulesReady } from "./organization-schedules";

type SyncRow = {
  id: number;
  organization: string;
  business_round: number;
  label: string;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  end_date: string;
  category: string;
  details: string;
  assignee_member_id: number | null;
  assignee_name: string;
  google_event_id: string;
  google_event_etag: string;
  google_updated_at: string;
  sync_status: string;
  sync_operation: string;
  sync_error: string;
  sync_attempts: number;
  deleted_at: string;
};

export type CalendarSyncIssue = {
  id: number;
  label: string;
  organization: string;
  operation: "upsert" | "delete";
  error: string;
  attempts: number;
};

export type ReadOnlyGoogleSchedule = {
  id: string;
  organization: string;
  businessRound: number;
  label: string;
  category: "google";
  scheduledDate: string;
  startTime: string;
  endTime: string;
  endDate: string;
  visibility: "shared-post-award";
  assigneeName: string;
  assigneeMemberId: null;
  editable: false;
  externalUrl: string;
  details: string;
  updatedAt: string;
  updatedByName: "Google Calendar";
  conflict: false;
  syncStatus: "readonly";
  syncError: "";
  syncAttempts: 0;
};

function dateInSeoul(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function eventValues(event: GoogleCalendarApiEvent) {
  const allDay = Boolean(event.start?.date);
  const start = allDay
    ? { date: event.start.date || "", time: "" }
    : dateInSeoul(event.start?.dateTime || "");
  const rawEnd = allDay
    ? { date: event.end?.date || start.date, time: "" }
    : dateInSeoul(event.end?.dateTime || event.start?.dateTime || "");
  return {
    scheduledDate: start.date,
    startTime: start.time,
    endTime: rawEnd.time,
    endDate: allDay ? addDays(rawEnd.date, -1) : rawEnd.date,
  };
}

async function pendingRows(ids: number[] | undefined, limit: number) {
  const d1 = getD1();
  if (ids?.length) {
    const valid = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 50);
    if (!valid.length) return [];
    return (await d1.prepare(
      `SELECT * FROM organization_schedules WHERE id IN (${valid.map(() => "?").join(",")})`,
    ).bind(...valid).all<SyncRow>()).results;
  }
  return (await d1.prepare(
    `SELECT * FROM organization_schedules
     WHERE sync_status IN ('pending', 'failed')
     ORDER BY CASE sync_status WHEN 'pending' THEN 0 ELSE 1 END, updated_at ASC, id ASC
     LIMIT ?`,
  ).bind(Math.max(1, Math.min(50, limit))).all<SyncRow>()).results;
}

function writeSchedule(row: SyncRow) {
  return {
    id: Number(row.id),
    organization: row.organization,
    businessRound: Math.max(0, Number(row.business_round) || 0),
    label: row.label,
    scheduledDate: row.scheduled_date,
    startTime: row.start_time || "",
    endTime: row.end_time || "",
    endDate: row.end_date || row.scheduled_date,
    category: row.category || "general",
    details: row.details || "",
    assigneeMemberId: Number(row.assignee_member_id) > 0 ? Number(row.assignee_member_id) : null,
    assigneeName: row.assignee_name || "",
  };
}

export async function flushGoogleCalendarSync(options?: { ids?: number[]; limit?: number }) {
  await ensureOrganizationSchedulesReady();
  const rows = await pendingRows(options?.ids, options?.limit ?? 20);
  if (!rows.length) return;
  const d1 = getD1();
  for (const row of rows) {
    try {
      if (!googleCalendarApiConfigured()) {
        throw new Error("Google Calendar 쓰기 연결 정보가 등록되지 않았습니다.");
      }
      if (row.sync_operation === "delete" || row.deleted_at) {
        await deleteGoogleCalendarEvent(row.google_event_id || "");
        await d1.prepare("DELETE FROM organization_schedules WHERE id = ?").bind(row.id).run();
        continue;
      }
      let eventId = row.google_event_id || "";
      if (!eventId) {
        const existing = await findGoogleCalendarEventByScheduleId(row.id);
        eventId = existing?.id || "";
      }
      const event = await upsertGoogleCalendarEvent(writeSchedule(row), eventId);
      await d1.prepare(
        `UPDATE organization_schedules
         SET google_event_id = ?, google_event_etag = ?, google_updated_at = ?,
             sync_status = 'synced', sync_operation = 'upsert', sync_error = '',
             last_synced_at = CURRENT_TIMESTAMP, updated_at = updated_at
         WHERE id = ?`,
      ).bind(event.id, event.etag || "", event.updated || "", row.id).run();
    } catch (error) {
      await d1.prepare(
        `UPDATE organization_schedules
         SET sync_status = 'failed', sync_error = ?, sync_attempts = sync_attempts + 1
         WHERE id = ?`,
      ).bind(
        (error instanceof Error ? error.message : "Google Calendar 동기화에 실패했습니다.").slice(0, 500),
        row.id,
      ).run();
    }
  }
}

export async function retryGoogleCalendarSync(idValue: unknown) {
  const id = Number(idValue);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("재시도할 일정을 선택해 주세요.");
  await ensureOrganizationSchedulesReady();
  const d1 = getD1();
  const result = await d1.prepare(
    `UPDATE organization_schedules SET sync_status = 'pending', sync_error = '' WHERE id = ?`,
  ).bind(id).run();
  if (!result.meta.changes) throw new Error("재시도할 일정을 찾지 못했습니다.");
  await flushGoogleCalendarSync({ ids: [id] });
}

export async function listCalendarSyncIssues() {
  await ensureOrganizationSchedulesReady();
  const result = await getD1().prepare(
    `SELECT id, label, organization, sync_operation, sync_error, sync_attempts
     FROM organization_schedules
     WHERE sync_status = 'failed'
     ORDER BY updated_at DESC, id DESC
     LIMIT 25`,
  ).all<Record<string, unknown>>();
  return result.results.map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    label: String(row.label || "일정"),
    organization: String(row.organization || ""),
    operation: row.sync_operation === "delete" ? "delete" : "upsert",
    error: String(row.sync_error || "Google Calendar 동기화에 실패했습니다."),
    attempts: Math.max(0, Number(row.sync_attempts) || 0),
  } satisfies CalendarSyncIssue));
}

async function localSiteScheduleIds() {
  const result = await getD1().prepare(
    `SELECT id FROM organization_schedules WHERE TRIM(COALESCE(deleted_at, '')) = ''`,
  ).all<{ id: number }>();
  return new Set(result.results.map((row: { id: number }) => Number(row.id)));
}

export async function reconcileGoogleCalendarRange(start: string, end: string) {
  await ensureOrganizationSchedulesReady();
  const result = await listGoogleCalendarApiEvents(start, end);
  if (!result.connected) return { ...result, readOnlyEvents: [] as ReadOnlyGoogleSchedule[] };
  const d1 = getD1();
  const siteIds = await localSiteScheduleIds();
  const readonly: ReadOnlyGoogleSchedule[] = [];
  const seenReadonly = new Set<string>();
  for (const event of result.events) {
    const properties = event.extendedProperties?.private || {};
    const siteId = Number(properties.whizzupScheduleId);
    const siteOwned = properties.whizzupSource === "site" && Number.isSafeInteger(siteId) && siteId > 0;
    if (siteOwned && siteIds.has(siteId)) {
      const row = await d1.prepare(
        `SELECT category, sync_status, google_updated_at FROM organization_schedules WHERE id = ?`,
      ).bind(siteId).first<{ category: string; sync_status: string; google_updated_at: string }>();
      if (event.status === "cancelled") {
        if (row?.category === "construction") {
          await d1.prepare(
            `UPDATE organization_schedules
             SET google_event_id = '', google_event_etag = '', google_updated_at = '',
                 sync_status = 'pending', sync_operation = 'upsert', sync_error = ''
             WHERE id = ?`,
          ).bind(siteId).run();
        } else {
          await d1.prepare("DELETE FROM organization_schedules WHERE id = ?").bind(siteId).run();
          siteIds.delete(siteId);
        }
        continue;
      }
      if (row?.category === "construction" && event.updated && event.updated > (row.google_updated_at || "")) {
        await d1.prepare(
          `UPDATE organization_schedules
           SET sync_status = 'pending', sync_operation = 'upsert', sync_error = '' WHERE id = ?`,
        ).bind(siteId).run();
        continue;
      }
      if (row?.sync_status === "synced" && event.updated && event.updated > (row.google_updated_at || "")) {
        const values = eventValues(event);
        await d1.prepare(
          `UPDATE organization_schedules
           SET organization = ?, label = ?, scheduled_date = ?, start_time = ?, end_time = ?, end_date = ?,
               google_event_id = ?, google_event_etag = ?, google_updated_at = ?, sync_error = '',
               last_synced_at = CURRENT_TIMESTAMP, updated_by_name = 'Google Calendar', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND category <> 'construction'`,
        ).bind(
          (event.location || properties.whizzupOrganization || "Google Calendar").slice(0, 120),
          (event.summary || "위즈업 일정").slice(0, 120),
          values.scheduledDate,
          values.startTime,
          values.endTime,
          values.endDate,
          event.id,
          event.etag || "",
          event.updated || "",
          siteId,
        ).run();
      }
      continue;
    }
    if (event.status === "cancelled" || !event.start) continue;
    const values = eventValues(event);
    const dedupeKey = `${event.id}\u001f${values.scheduledDate}`;
    if (!values.scheduledDate || seenReadonly.has(dedupeKey)) continue;
    seenReadonly.add(dedupeKey);
    readonly.push({
      id: `google:${dedupeKey}`,
      organization: event.location || event.summary || "Google Calendar",
      businessRound: 0,
      label: event.summary || "위즈업 일정",
      category: "google",
      scheduledDate: values.scheduledDate,
      startTime: values.startTime,
      endTime: values.endTime,
      endDate: values.endDate || values.scheduledDate,
      visibility: "shared-post-award",
      assigneeName: "위즈업 공유일정",
      assigneeMemberId: null,
      editable: false,
      externalUrl: event.htmlLink || "https://calendar.google.com/calendar/u/0/r",
      details: event.description || "",
      updatedAt: event.updated || "",
      updatedByName: "Google Calendar",
      conflict: false,
      syncStatus: "readonly",
      syncError: "",
      syncAttempts: 0,
    });
  }
  return { ...result, readOnlyEvents: readonly };
}
