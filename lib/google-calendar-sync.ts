import "server-only";

import { getD1 } from "../db";
import {
  deleteGoogleCalendarEvent,
  findGoogleCalendarEventByScheduleId,
  getGoogleCalendarEvent,
  googleConstructionCalendarApiConfigured,
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
  vendor_name: string;
  project_work_summary: string;
  product_names: string;
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

function suggestedOrganization(event: GoogleCalendarApiEvent) {
  return event.location?.trim().slice(0, 120) || "";
}

type GoogleStructuredDescription = {
  assignee: string;
  content: string;
  constructionStage: string;
  vendor: string;
  products: string;
  memo: string;
};

function googleStructuredDescription(value: string): GoogleStructuredDescription {
  const result: GoogleStructuredDescription = {
    assignee: "", content: "", constructionStage: "", vendor: "", products: "", memo: "",
  };
  let memoStarted = false;
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    const matched = line.match(/^(담당자|일정 내용|시공 단계|시공업체|공사·품목|메모):\s*(.*)$/);
    if (matched) {
      const field = matched[1];
      const content = matched[2].trim();
      memoStarted = field === "메모";
      if (field === "담당자") result.assignee = content;
      else if (field === "일정 내용") result.content = content;
      else if (field === "시공 단계") result.constructionStage = content;
      else if (field === "시공업체") result.vendor = content;
      else if (field === "공사·품목") result.products = content;
      else result.memo = content;
    } else if (memoStarted && line) {
      result.memo = `${result.memo}${result.memo ? "\n" : ""}${line}`;
    }
  }
  for (const key of Object.keys(result) as Array<keyof GoogleStructuredDescription>) {
    if (["[입력 필요]", "미정", "미입력"].includes(result[key])) result[key] = "";
    result[key] = result[key].slice(0, 500);
  }
  return result;
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

function memoFromGoogleDescription(value: string) {
  return googleStructuredDescription(value).memo;
}

async function pendingRows(ids: number[] | undefined, limit: number) {
  const d1 = getD1();
  const selection = `SELECT
       os.id, os.organization, os.business_round, os.label, os.scheduled_date,
       os.start_time, os.end_time, os.end_date, os.category, os.details,
       os.vendor_name, os.assignee_member_id,
       COALESCE(
         NULLIF(TRIM(os.assignee_name), ''),
         CASE WHEN os.category = 'construction' THEN (
           SELECT NULLIF(TRIM(a.progress_manager), '')
           FROM activities a
           WHERE a.organization = os.organization
             AND a.business_round = os.business_round
             AND a.award_status = '위즈업 수주'
           ORDER BY a.activity_date DESC, a.id DESC
           LIMIT 1
         ) ELSE '' END,
         ''
       ) AS assignee_name,
       COALESCE((
         SELECT NULLIF(TRIM(csp.work_summary), '')
         FROM construction_schedule_projects csp
         WHERE csp.organization = os.organization
           AND csp.business_round = os.business_round
         LIMIT 1
       ), '') AS project_work_summary,
       COALESCE((
         SELECT GROUP_CONCAT(TRIM(ei.product_name), ' · ')
         FROM equipment_projects ep
         JOIN equipment_items ei ON ei.project_id = ep.id
         WHERE ep.organization = os.organization
           AND ep.business_round = os.business_round
           AND TRIM(COALESCE(ei.product_name, '')) <> ''
       ), '') AS product_names,
       os.google_event_id, os.google_event_etag, os.google_origin,
       os.google_updated_at, os.sync_status, os.sync_operation, os.sync_error,
       os.sync_attempts, os.deleted_at
     FROM organization_schedules os`;
  if (ids?.length) {
    const valid = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 50);
    if (!valid.length) return [];
    return (await d1.prepare(
      `${selection} WHERE os.id IN (${valid.map(() => "?").join(",")})`,
    ).bind(...valid).all<SyncRow>()).results;
  }
  return (await d1.prepare(
    `${selection}
     WHERE os.sync_status IN ('pending', 'failed')
     ORDER BY CASE os.sync_status WHEN 'pending' THEN 0 ELSE 1 END, os.updated_at ASC, os.id ASC
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
    details: row.details.trim(),
    constructionStage: row.category === "construction" ? row.label.trim() : "",
    vendorName: row.category === "construction" ? row.vendor_name.trim() : "",
    productSummary: row.category === "construction"
      ? row.project_work_summary.trim() || row.product_names.trim()
      : "",
    assigneeMemberId: Number(row.assignee_member_id) > 0 ? Number(row.assignee_member_id) : null,
    assigneeName: row.assignee_name || "",
  };
}

function legacyConstructionStage(description: string) {
  const stage = googleStructuredDescription(description).constructionStage;
  return (CONSTRUCTION_STAGES as readonly string[]).includes(stage) ? stage : "";
}

export async function flushGoogleCalendarSync(options?: { ids?: number[]; limit?: number }) {
  await ensureOrganizationSchedulesReady();
  await applyGoogleSharingPolicy();
  const d1 = getD1();
  const constructionMigrationKey = "google:construction_calendar_split:v2";
  const constructionMigration = await d1.prepare(
    "SELECT value FROM app_settings WHERE key = ?",
  ).bind(constructionMigrationKey).first<{ value: string }>();
  if (!constructionMigration && googleConstructionCalendarApiConfigured()) {
    await d1.batch([
      d1.prepare(
        `UPDATE organization_schedules
         SET sync_status = 'pending',
             sync_operation = CASE
               WHEN TRIM(COALESCE(google_event_id, '')) <> '' THEN 'move-construction'
               ELSE 'upsert'
             END,
             sync_error = ''
         WHERE category = 'construction'
           AND TRIM(COALESCE(deleted_at, '')) = ''`,
      ),
      d1.prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, 'prepared', CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(constructionMigrationKey),
    ]);
  }
  const rows = await pendingRows(options?.ids, options?.limit ?? 20);
  if (!rows.length) return;
  for (const row of rows) {
    try {
      if (!googleCalendarApiConfigured()) {
        throw new Error("Google Calendar 쓰기 연결 정보가 등록되지 않았습니다.");
      }
      if (row.sync_operation === "unlink") {
        await deleteGoogleCalendarEvent(row.google_event_id || "", row.category);
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
        await deleteGoogleCalendarEvent(row.google_event_id || "", row.category);
        await d1.prepare("DELETE FROM organization_schedules WHERE id = ?").bind(row.id).run();
        continue;
      }
      let eventId = row.google_event_id || "";
      const sourceEventId = row.sync_operation === "move-construction" ? eventId : "";
      if (sourceEventId) eventId = "";
      if (!eventId) {
        const existing = await findGoogleCalendarEventByScheduleId(row.id, row.category);
        eventId = existing?.id || "";
      }
      const event = await upsertGoogleCalendarEvent(writeSchedule(row), eventId);
      if (sourceEventId) {
        await deleteGoogleCalendarEvent(sourceEventId, "general");
      }
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
  label?: unknown;
  completed?: unknown;
  category: unknown;
  assigneeMemberId: unknown;
  assigneeName: unknown;
  details?: unknown;
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
  const event = await getGoogleCalendarEvent(googleEventId, "general");
  if (event.status === "cancelled") throw new Error("이미 삭제된 Google 일정입니다.");
  const values = eventValues(event);
  const structured = googleStructuredDescription(event.description || "");
  let title = text(input.title).slice(0, 120)
    || text(input.label).slice(0, 120)
    || text(event.summary).slice(0, 120)
    || (category === "construction" ? structured.constructionStage : structured.content).slice(0, 120);
  if (!title) throw new Error("일정 내용을 직접 입력해 주세요.");
  const storedCategory = category === "sales" ? "general" : category;
  let constructionProject: { id: number; work_summary: string } | null = null;
  if (category === "construction") {
    if (!googleConstructionCalendarApiConfigured()) {
      throw new Error("Google '위즈업 시공' 캘린더를 먼저 연결해 주세요.");
    }
    if (!(CONSTRUCTION_STAGES as readonly string[]).includes(title)) {
      throw new Error("시공 일정은 철거·목공·도장·바닥·시스템·검수·교육 단계 중 하나를 선택해 주세요.");
    }
    constructionProject = await d1.prepare(
      `SELECT id, work_summary FROM construction_schedule_projects
       WHERE organization = ? AND business_round = ? AND TRIM(COALESCE(hidden_at, '')) = '' LIMIT 1`,
    ).bind(organization, businessRound).first<{ id: number; work_summary: string }>();
    if (!constructionProject) throw new Error("시공·납품 일정표에 해당 기관을 먼저 추가해 주세요.");
  }
  const categoryLabel = category === "sales" ? "영업" : category === "meeting" ? "회의"
    : category === "showroom" ? "쇼룸" : category === "other" ? "기타" : "";
  if (categoryLabel) title = `${categoryLabel} · ${title.replace(/^(영업|회의|쇼룸|기타)\s*[·•-]\s*/, "")}`;
  const assigneeMemberId = Number(input.assigneeMemberId);
  const assigneeName = text(input.assigneeName).slice(0, 120) || input.member.displayName;
  const details = typeof input.details === "string"
    ? input.details.trim().slice(0, 500)
    : memoFromGoogleDescription(event.description || "");
  const completed = input.completed === true
    || input.completed === 1
    || input.completed === "1"
    || input.completed === "true";
  try {
    const inserted = await d1.prepare(
      `INSERT INTO organization_schedules (
         organization, business_round, label, scheduled_date, start_time, end_time, end_date,
         category, stage, details, vendor_name, completed, created_by, created_by_name, updated_by, updated_by_name,
         assignee_member_id, assignee_name, google_event_id, google_event_etag, google_updated_at,
         google_origin, sync_status, sync_operation
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', 'upsert')
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
      details,
      category === "construction" ? structured.vendor : "",
      completed ? 1 : 0,
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
    if (category === "construction") {
      await deleteGoogleCalendarEvent(googleEventId, "general");
      await d1.prepare(
        `UPDATE organization_schedules
         SET google_event_id = '', google_event_etag = '', google_updated_at = '',
             sync_status = 'pending', sync_operation = 'upsert', sync_error = ''
         WHERE id = ?`,
      ).bind(Number(inserted.id)).run();
    }
    if (constructionProject && !constructionProject.work_summary?.trim() && structured.products) {
      await d1.prepare(
        `UPDATE construction_schedule_projects
         SET work_summary = ?, work_summary_mode = 'manual', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND TRIM(COALESCE(work_summary, '')) = ''`,
      ).bind(structured.products, constructionProject.id).run();
    }
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

async function repairDeletedConstructionCalendarEvents(
  start: string,
  end: string,
  events: GoogleCalendarApiEvent[],
) {
  const d1 = getD1();
  const activeByScheduleId = new Map<number, GoogleCalendarApiEvent>();
  const activeEventIds = new Set<string>();
  for (const event of events) {
    if (event.status === "cancelled") continue;
    if (event.id) activeEventIds.add(event.id);
    const properties = event.extendedProperties?.private || {};
    const scheduleId = Number(properties.whizzupScheduleId);
    if (
      properties.whizzupSource === "site"
      && Number.isSafeInteger(scheduleId)
      && scheduleId > 0
      && !activeByScheduleId.has(scheduleId)
    ) {
      activeByScheduleId.set(scheduleId, event);
    }
  }
  const rows = await d1.prepare(
    `SELECT id, google_event_id
     FROM organization_schedules
     WHERE category = 'construction'
       AND TRIM(COALESCE(deleted_at, '')) = ''
       AND sync_status = 'synced'
       AND TRIM(COALESCE(google_event_id, '')) <> ''
       AND scheduled_date <= ?
       AND COALESCE(NULLIF(end_date, ''), scheduled_date) >= ?`,
  ).bind(end, start).all<{ id: number; google_event_id: string }>();
  const restoreIds: number[] = [];
  const updates = [];
  for (const row of rows.results) {
    const scheduleId = Number(row.id);
    const matchingEvent = activeByScheduleId.get(scheduleId);
    if (matchingEvent) {
      if (matchingEvent.id !== row.google_event_id) {
        updates.push(d1.prepare(
          `UPDATE organization_schedules
           SET google_event_id = ?, google_event_etag = ?, google_updated_at = ?,
               sync_error = '', last_synced_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).bind(
          matchingEvent.id,
          matchingEvent.etag || "",
          matchingEvent.updated || "",
          scheduleId,
        ));
      }
      continue;
    }
    if (activeEventIds.has(row.google_event_id)) continue;
    updates.push(d1.prepare(
      `UPDATE organization_schedules
       SET google_event_id = '', google_event_etag = '', google_updated_at = '',
           sync_status = 'pending', sync_operation = 'upsert', sync_error = ''
       WHERE id = ?`,
    ).bind(scheduleId));
    restoreIds.push(scheduleId);
  }
  if (updates.length) await d1.batch(updates);
  return restoreIds;
}

export async function reconcileGoogleCalendarRange(start: string, end: string) {
  await ensureOrganizationSchedulesReady();
  const [result, constructionResult] = await Promise.all([
    listGoogleCalendarApiEvents(start, end),
    googleConstructionCalendarApiConfigured()
      ? listGoogleCalendarApiEvents(start, end, "construction")
      : Promise.resolve({ configured: false, connected: false, events: [] as GoogleCalendarApiEvent[], error: "" }),
  ]);
  const forcedRefreshIds = new Set<number>();
  if (constructionResult.connected) {
    const restoreIds = await repairDeletedConstructionCalendarEvents(start, end, constructionResult.events);
    restoreIds.forEach((id) => forcedRefreshIds.add(id));
  }
  if (!result.connected) {
    if (forcedRefreshIds.size) await flushGoogleCalendarSync({ ids: [...forcedRefreshIds] });
    return { ...result, readOnlyEvents: [] as ReadOnlyGoogleSchedule[] };
  }
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
        `SELECT organization, business_round, label, category, sync_status, sync_operation, google_updated_at
         FROM organization_schedules WHERE id = ?`,
      ).bind(siteId).first<{
        organization: string; business_round: number; label: string; category: string; sync_status: string;
        sync_operation: string; google_updated_at: string;
      }>();
      const description = event.description || "";
      const existingStructured = googleStructuredDescription(description);
      if (row?.category === "construction") {
        await d1.prepare(
          `UPDATE organization_schedules
           SET assignee_name = CASE
                 WHEN TRIM(COALESCE(assignee_name, '')) = '' AND ? <> ''
                  AND NOT EXISTS (
                    SELECT 1 FROM activities a
                    WHERE a.organization = organization_schedules.organization
                      AND a.business_round = organization_schedules.business_round
                      AND TRIM(COALESCE(a.progress_manager, '')) <> ''
                  ) THEN ? ELSE assignee_name END,
               vendor_name = CASE
                 WHEN TRIM(COALESCE(vendor_name, '')) = '' AND ? <> '' THEN ? ELSE vendor_name END,
               details = CASE
                 WHEN TRIM(COALESCE(details, '')) = '' AND ? <> '' THEN ? ELSE details END
           WHERE id = ?`,
        ).bind(
          existingStructured.assignee,
          existingStructured.assignee,
          existingStructured.vendor,
          existingStructured.vendor,
          existingStructured.memo,
          existingStructured.memo,
          siteId,
        ).run();
        if (existingStructured.products) {
          await d1.prepare(
            `UPDATE construction_schedule_projects
             SET work_summary = ?, work_summary_mode = 'manual', updated_at = CURRENT_TIMESTAMP
             WHERE organization = ? AND business_round = ?
               AND TRIM(COALESCE(work_summary, '')) = ''
               AND NOT EXISTS (
                 SELECT 1 FROM equipment_projects ep
                 JOIN equipment_items ei ON ei.project_id = ep.id
                 WHERE ep.organization = construction_schedule_projects.organization
                   AND ep.business_round = construction_schedule_projects.business_round
                   AND TRIM(COALESCE(ei.product_name, '')) <> ''
               )`,
          ).bind(existingStructured.products, row.organization, row.business_round).run();
        }
      }
      const requiredDescriptionFields = row?.category === "construction"
        ? ["담당자:", "시공 단계:", "시공업체:", "공사·품목:", "메모:"]
        : ["담당자:", "일정 내용:", "메모:"];
      const missingManagedDescription = requiredDescriptionFields.some((field) => !description.includes(field));
      if (row && event.status !== "cancelled" && missingManagedDescription) {
        await d1.prepare(
          `UPDATE organization_schedules
           SET sync_status = 'pending', sync_operation = 'upsert', sync_error = ''
           WHERE id = ?`,
        ).bind(siteId).run();
        forcedRefreshIds.add(siteId);
        continue;
      }
      if (event.status === "cancelled") {
        if (row?.category === "construction") {
          await d1.prepare(
            `UPDATE organization_schedules
             SET google_event_id = '', google_event_etag = '', google_updated_at = '',
                 sync_status = 'pending', sync_operation = 'upsert', sync_error = ''
             WHERE id = ?`,
          ).bind(siteId).run();
        } else {
          await d1.prepare(
            `UPDATE organization_schedules
             SET google_event_id = '', google_event_etag = '', google_updated_at = '',
                 sync_status = 'local_only', sync_operation = 'upsert',
                 sync_error = 'google_event_deleted', last_synced_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          ).bind(siteId).run();
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
        const organization = (properties.whizzupOrganization || row.organization).slice(0, 120);
        const structured = googleStructuredDescription(event.description || "");
        const prefix = row.category === "general" ? "영업"
          : row.category === "meeting" ? "회의"
          : row.category === "showroom" ? "쇼룸"
          : row.category === "other" ? "기타"
          : "";
        const trustedContent = structured.content.slice(0, 120);
        const label = trustedContent ? (!prefix ? trustedContent : `${prefix} · ${trustedContent}`) : row.label;
        const trustedAssignee = structured.assignee.slice(0, 120);
        await d1.prepare(
          `UPDATE organization_schedules
           SET organization = ?, label = ?, scheduled_date = ?, start_time = ?, end_time = ?, end_date = ?, details = ?,
               assignee_name = CASE WHEN ? <> '' THEN ? ELSE assignee_name END,
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
          memoFromGoogleDescription(event.description || ""),
          trustedAssignee,
          trustedAssignee,
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
    const legacyStage = legacyConstructionStage(event.description || "");
    if (legacyStage && values.scheduledDate) {
      const candidates = await d1.prepare(
        `SELECT id, google_event_id
         FROM organization_schedules
         WHERE category = 'construction'
           AND TRIM(COALESCE(deleted_at, '')) = ''
           AND label = ? AND scheduled_date = ?
           AND COALESCE(NULLIF(end_date, ''), scheduled_date) = ?
           AND (google_event_id = ? OR TRIM(COALESCE(google_event_id, '')) = '')
         ORDER BY CASE WHEN google_event_id = ? THEN 0 ELSE 1 END, id ASC`,
      ).bind(
        legacyStage,
        values.scheduledDate,
        values.endDate || values.scheduledDate,
        event.id,
        event.id,
      ).all<{ id: number; google_event_id: string }>();
      const exact = candidates.results.filter((candidate: { id: number; google_event_id: string }) => candidate.google_event_id === event.id);
      const unlinked = candidates.results.filter((candidate: { id: number; google_event_id: string }) => !candidate.google_event_id?.trim());
      const matched = exact.length === 1 ? exact[0] : exact.length === 0 && unlinked.length === 1 ? unlinked[0] : null;
      if (matched) {
        await d1.prepare(
          `UPDATE organization_schedules
           SET google_event_id = ?, google_event_etag = ?, google_updated_at = ?, google_origin = 0,
               sync_status = 'pending', sync_operation = 'upsert', sync_error = ''
           WHERE id = ?`,
        ).bind(event.id, event.etag || "", event.updated || "", matched.id).run();
        forcedRefreshIds.add(Number(matched.id));
        continue;
      }
    }
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
      suggestedCategory: googleStructuredDescription(event.description || "").constructionStage ? "construction" : "other",
    });
  }
  if (forcedRefreshIds.size) {
    await flushGoogleCalendarSync({ ids: [...forcedRefreshIds] });
  }
  return { ...result, readOnlyEvents: readonly };
}
