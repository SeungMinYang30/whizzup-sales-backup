import "server-only";

import { getD1 } from "../db";
import {
  deleteGoogleCalendarEvent,
  findGoogleCalendarEventByScheduleId,
  getGoogleCalendarEvent,
  googleCalendarApiConfigured,
  listGoogleCalendarApiEvents,
  type GoogleCalendarApiEvent,
  upsertGoogleCalendarEvent,
} from "./google-calendar-api";
import { CONSTRUCTION_STAGES } from "./construction-stages";
import {
  ensureOrganizationSchedulesReady,
  refreshOrganizationScheduleMirror,
} from "./organization-schedules";

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
  google_origin: number;
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
  operation: "upsert" | "delete" | "unlink";
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
  googleEventId: string;
  suggestedCategory: "sales" | "meeting" | "construction" | "showroom" | "other";
};

const sharedCategories = new Set(["meeting", "construction", "showroom", "other"]);

function isGoogleSharedSchedule(row: Pick<SyncRow, "category" | "label">) {
  if (sharedCategories.has(row.category)) return true;
  return row.category === "general" && /^영업\s*[·•-]\s*/.test(row.label);
}

function suggestedCategory(summary: string): ReadOnlyGoogleSchedule["suggestedCategory"] {
  if (/목공|도장|바닥|시스템|검수|철거|교육|설치|납품|시공|공사/.test(summary)) return "construction";
  if (/쇼룸|전시/.test(summary)) return "showroom";
  if (/회의|미팅/.test(summary)) return "meeting";
  if (/영업|방문|재연락|상담|제안|견적/.test(summary)) return "sales";
  return "other";
}

function suggestedOrganization(event: GoogleCalendarApiEvent) {
  if (event.location?.trim()) return event.location.trim().slice(0, 120);
  return (event.summary || "")
    .replace(/^\[(영업|회의|시공|쇼룸|기타)\]\s*/, "")
    .replace(/\s*[·|]\s*.+$/, "")
    .replace(/\s+(방문|재연락|상담|미팅|회의|설치|납품|시공|목공|도장|바닥|시스템|검수|쇼룸)\s*$/, "")
    .trim()
    .slice(0, 120);
}

function linkedTitle(summary: string, organization: string) {
  const withoutCategory = summary.replace(/^\[(영업|회의|시공|쇼룸|기타)\]\s*/, "").trim();
  const prefix = `${organization} · `;
  return (withoutCategory.startsWith(prefix) ? withoutCategory.slice(prefix.length) : withoutCategory)
    .trim()
    .slice(0, 120) || "일정";
}

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

async function applyGoogleSharingPolicy() {
  const d1 = getD1();
  const result = await d1.prepare(
    `SELECT id, category, label, google_event_id, sync_status, sync_operation
     FROM organization_schedules
     WHERE TRIM(COALESCE(deleted_at, '')) = ''
       AND category IN ('personal', 'general')`,
  ).all<Pick<SyncRow, "id" | "category" | "label" | "google_event_id" | "sync_status" | "sync_operation">>();
  const updates = result.results.flatMap((row: Pick<SyncRow, "id" | "category" | "label" | "google_event_id" | "sync_status" | "sync_operation">) => {
    if (isGoogleSharedSchedule(row)) return [];
    const hasGoogleEvent = Boolean(row.google_event_id?.trim());
    const targetStatus = hasGoogleEvent ? "pending" : "local_only";
    const targetOperation = hasGoogleEvent ? "unlink" : "upsert";
    if (row.sync_status === targetStatus && row.sync_operation === targetOperation) return [];
    return [d1.prepare(
      `UPDATE organization_schedules
       SET sync_status = ?, sync_operation = ?, sync_error = ''
       WHERE id = ?`,
    ).bind(targetStatus, targetOperation, row.id)];
  });
  if (updates.length) await d1.batch(updates);
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
  await applyGoogleSharingPolicy();
  const rows = await pendingRows(options?.ids, options?.limit ?? 20);
  if (!rows.length) return;
  const d1 = getD1();
  for (const row of rows) {
    try {
      if (!googleCalendarApiConfigured()) {
        throw new Error("Google Calendar 쓰기 연결 정보가 등록되지 않았습니다.");
      }
      if (row.sync_operation === "unlink") {
        await deleteGoogleCalendarEvent(row.google_event_id || "");
        await d1.prepare(
          `UPDATE organization_schedules
           SET google_event_id = '', google_event_etag = '', google_updated_at = '',
               sync_status = 'local_only', sync_operation = 'upsert', sync_error = '',
               last_synced_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).bind(row.id).run();
        continue;
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

export async function linkGoogleCalendarSchedule(input: {
  googleEventId: unknown;
  organization: unknown;
  businessRound: unknown;
  title: unknown;
  category: unknown;
  assigneeMemberId: unknown;
  assigneeName: unknown;
  member: { id: number; displayName: string };
}) {
  await ensureOrganizationSchedulesReady();
  const text = (value: unknown) => String(value || "").trim();
  const googleEventId = text(input.googleEventId).slice(0, 1024);
  const organization = text(input.organization).slice(0, 120);
  const businessRound = Math.max(1, Number(input.businessRound) || 1);
  const category = text(input.category);
  if (!googleEventId || !organization || !["sales", "meeting", "construction", "showroom", "other"].includes(category)) {
    throw new Error("Google 일정의 기관과 분류를 확인해 주세요.");
  }
  const d1 = getD1();
  const institution = await d1.prepare(
    `SELECT id FROM activities WHERE organization = ? AND business_round = ? LIMIT 1`,
  ).bind(organization, businessRound).first<{ id: number }>();
  if (!institution) throw new Error("연결할 기관을 먼저 선택하거나 등록해 주세요.");
  const event = await getGoogleCalendarEvent(googleEventId);
  if (event.status === "cancelled") throw new Error("이미 삭제된 Google 일정입니다.");
  const values = eventValues(event);
  let title = text(input.title).slice(0, 120) || linkedTitle(event.summary || "", organization);
  const storedCategory = category === "sales" ? "general" : category;
  if (category === "construction") {
    if (!(CONSTRUCTION_STAGES as readonly string[]).includes(title)) {
      throw new Error("시공 일정은 철거·목공·도장·바닥·시스템·검수·교육 단계 중 하나를 선택해 주세요.");
    }
    const project = await d1.prepare(
      `SELECT id FROM construction_schedule_projects
       WHERE organization = ? AND business_round = ? AND TRIM(COALESCE(hidden_at, '')) = '' LIMIT 1`,
    ).bind(organization, businessRound).first<{ id: number }>();
    if (!project) throw new Error("시공·납품 일정표에 해당 기관을 먼저 추가해 주세요.");
  }
  const categoryLabel = category === "sales" ? "영업" : category === "meeting" ? "회의"
    : category === "showroom" ? "쇼룸" : category === "other" ? "기타" : "";
  if (categoryLabel) title = `${categoryLabel} · ${title.replace(/^(영업|회의|쇼룸|기타)\s*[·•-]\s*/, "")}`;
  const assigneeMemberId = Number(input.assigneeMemberId);
  const assigneeName = text(input.assigneeName).slice(0, 120) || input.member.displayName;
  try {
    const inserted = await d1.prepare(
      `INSERT INTO organization_schedules (
         organization, business_round, label, scheduled_date, start_time, end_time, end_date,
         category, stage, completed, created_by, created_by_name, updated_by, updated_by_name,
         assignee_member_id, assignee_name, google_event_id, google_event_etag, google_updated_at,
         google_origin, sync_status, sync_operation
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', 'upsert')
       RETURNING id`,
    ).bind(
      organization,
      businessRound,
      title,
      values.scheduledDate,
      values.startTime,
      values.endTime,
      values.endDate || values.scheduledDate,
      storedCategory,
      category === "construction" ? title : "",
      input.member.id,
      input.member.displayName,
      input.member.id,
      input.member.displayName,
      Number.isSafeInteger(assigneeMemberId) && assigneeMemberId > 0 ? assigneeMemberId : null,
      assigneeName,
      googleEventId,
      event.etag || "",
      event.updated || "",
    ).first<{ id: number }>();
    if (!inserted?.id) throw new Error("Google 일정을 연결하지 못했습니다.");
    await flushGoogleCalendarSync({ ids: [Number(inserted.id)] });
    await refreshOrganizationScheduleMirror(organization, businessRound);
    return { id: Number(inserted.id) };
  } catch (error) {
    if (error instanceof Error && /unique|constraint/i.test(error.message)) {
      throw new Error("다른 사용자가 이미 이 Google 일정을 연결했습니다.");
    }
    throw error;
  }
}

export async function deleteUnlinkedGoogleCalendarSchedule(
  googleEventIdValue: unknown,
  member: { role: string },
) {
  await ensureOrganizationSchedulesReady();
  if (member.role !== "admin") throw new Error("Google 원본 일정은 관리자만 삭제할 수 있습니다.");
  const googleEventId = String(googleEventIdValue || "").trim().slice(0, 1024);
  if (!googleEventId) throw new Error("삭제할 Google 일정을 선택해 주세요.");
  const linked = await getD1().prepare(
    `SELECT id FROM organization_schedules
     WHERE google_event_id = ? AND TRIM(COALESCE(deleted_at, '')) = '' LIMIT 1`,
  ).bind(googleEventId).first<{ id: number }>();
  if (linked) throw new Error("연결된 일정은 일반 일정 삭제 기능을 사용해 주세요.");
  await deleteGoogleCalendarEvent(googleEventId);
  return { googleEventId };
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
    operation: ["delete", "unlink"].includes(String(row.sync_operation))
      ? String(row.sync_operation) as "delete" | "unlink"
      : "upsert",
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
        `SELECT organization, label, category, sync_status, sync_operation, google_updated_at
         FROM organization_schedules WHERE id = ?`,
      ).bind(siteId).first<{
        organization: string; label: string; category: string; sync_status: string;
        sync_operation: string; google_updated_at: string;
      }>();
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
        const organization = (properties.whizzupOrganization || row.organization || event.location || "Google Calendar").slice(0, 120);
        const title = linkedTitle(event.summary || row.label || "일정", organization);
        const prefix = row.category === "general" ? "영업"
          : row.category === "meeting" ? "회의"
          : row.category === "showroom" ? "쇼룸"
          : row.category === "other" ? "기타"
          : "";
        const label = row.category === "construction" || !prefix ? title : `${prefix} · ${title}`;
        await d1.prepare(
          `UPDATE organization_schedules
           SET organization = ?, label = ?, scheduled_date = ?, start_time = ?, end_time = ?, end_date = ?,
               google_event_id = ?, google_event_etag = ?, google_updated_at = ?, sync_error = '',
               last_synced_at = CURRENT_TIMESTAMP, updated_by_name = 'Google Calendar', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND category <> 'construction'`,
        ).bind(
          organization,
          label.slice(0, 120),
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
      organization: suggestedOrganization(event) || "Google Calendar",
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
      googleEventId: event.id,
      suggestedCategory: suggestedCategory(event.summary || ""),
    });
  }
  return { ...result, readOnlyEvents: readonly };
}
