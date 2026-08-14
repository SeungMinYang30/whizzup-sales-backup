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
import {
  CONSTRUCTION_STAGES,
  isValidConstructionStage,
} from "./construction-stages";
import {
  ensureOrganizationSchedulesReady,
  normalizeScheduleSemanticLabel,
  refreshOrganizationScheduleMirror,
  resolveScheduleAssignee,
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
  return row.category === "general" && /^ÏòÅÏóÖ\s*[¬∑‚Ä¢-]\s*/.test(row.label);
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
    const matched = line.match(/^(Îã¥ÎãπÏûê|ÏùºÏ†ï ÎÇ¥Ïö©|ÏãúÍ≥µ Îã®Í≥Ñ|ÏãúÍ≥µÏóÖÏ≤¥|Í≥µÏÇ¨¬∑ÌíàÎ™©|Î©îÎ™®):\s*(.*)$/);
    if (matched) {
      const field = matched[1];
      const content = matched[2].trim();
      memoStarted = field === "Î©îÎ™®";
      if (field === "Îã¥ÎãπÏûê") result.assignee = content;
      else if (field === "ÏùºÏ†ï ÎÇ¥Ïö©") result.content = content;
      else if (field === "ÏãúÍ≥µ Îã®Í≥Ñ") result.constructionStage = content;
      else if (field === "ÏãúÍ≥µÏóÖÏ≤¥") result.vendor = content;
      else if (field === "Í≥µÏÇ¨¬∑ÌíàÎ™©") result.products = content;
      else result.memo = content;
    } else if (memoStarted && line) {
      result.memo = `${result.memo}${result.memo ? "\n" : ""}${line}`;
    }
  }
  for (const key of Object.keys(result) as Array<keyof GoogleStructuredDescription>) {
    if (["[ÏûÖÎ†• ÌïÑÏöî]", "ÎØ∏Ï†ï", "ÎØ∏ÏûÖÎ†•"].includes(result[key])) result[key] = "";
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
             AND a.award_status = 'ÏúÑÏ¶àÏóÖ ÏàòÏ£º'
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
         SELECT GROUP_CONCAT(TRIM(ei.product_name), ' ¬∑ ')
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
    if (isGoogleSharedSchedule(row)) {
      if (row.sync_status !== "local_only") return [];
      return [d1.prepare(
        `UPDATE organization_schedules
         SET sync_status = 'pending', sync_operation = 'upsert', sync_error = ''
         WHERE id = ?`,
      ).bind(row.id)];
    }
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
        throw new Error("Google Calendar Ïì∞Í∏∞ Ïó∞Í≤∞ Ï†ïÎ≥¥Í∞Ä Îì±Î°ùÎêòÏßÄ ÏïäÏïòÏäµÎãàÎã§.");
      }
      if (row.sync_operation === "unlink") {
        // Personal schedules live only inside Whizzup. If they previously came
        // from a shared category, the linked event still belongs to the public
        // general calendar and must be removed there during reclassification.
        await deleteGoogleCalendarEvent(
          row.google_event_id || "",
          row.category === "personal" ? "general" : row.category,
        );
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
        (error instanceof Error ? error.message : "Google Calendar ÎèôÍ∏∞ÌôîÏóê Ïã§Ìå®ÌñàÏäµÎãàÎã§.").slice(0, 500),
        row.id,
      ).run();
    }
  }
}

export async function retryGoogleCalendarSync(idValue: unknown) {
  const id = Number(idValue);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Ïû¨ÏãúÎèÑÌï† ÏùºÏ†ïÏùÑ ÏÑ†ÌÉùÌï¥ Ï£ºÏÑ∏Ïöî.");
  await ensureOrganizationSchedulesReady();
  const d1 = getD1();
  const result = await d1.prepare(
    `UPDATE organization_schedules SET sync_status = 'pending', sync_error = '' WHERE id = ?`,
  ).bind(id).run();
  if (!result.meta.changes) throw new Error("Ïû¨ÏãúÎèÑÌï† ÏùºÏ†ïÏùÑ Ï∞æÏßÄ Î™ªÌñàÏäµÎãàÎã§.");
  await flushGoogleCalendarSync({ ids: [id] });
}

export async function linkGoogleCalendarSchedule(input: {
  googleEventId: unknown;
  organization: unknown;
  businessRound: unknown;
  title: unknown;
  label?: unknown;
ﬂM¥∂âûÀk∫wµÁP∞Äúú§§ÄÙÄúú4(ÄÄÄÄÄÄÅ9ÅÕÂπç}Õ—Ö—’ÃÄÙÄùÕÂπçïêú4(ÄÄÄÄÄÄÅ9ÅQI%4°=1M°ùΩΩù±ï}ïŸïπ—}•ê∞Äúú§§Ä¯Äúú4(ÄÄÄÄÄÄÅ9ÅÕç°ïë’±ïë}ëÖ—îÄÙÄ¸4(ÄÄÄÄÄÄÅ9Å=1M°9U11%°ïπë}ëÖ—î∞Äúú§∞ÅÕç°ïë’±ïë}ëÖ—î§Ä¯ÙÄ˝Ä∞4(ÄÄ§πâ•πê°ïπê∞ÅÕ—Ö…–§πÖ±∞ÒÏÅ•êËÅπ’µâï»ÏÅùΩΩù±ï}ïŸïπ—}•êËÅÕ—…•πúÅÙ¯†§Ï4(ÄÅçΩπÕ–Å…ïÕ—Ω…ï%ëÃËÅπ’µâï…mtÄÙÅmtÏ4(ÄÅçΩπÕ–Å’¡ëÖ—ïÃÄÙÅmtÏ4(ÄÅôΩ»Ä°çΩπÕ–Å…Ω‹ÅΩòÅ…Ω›Ãπ…ïÕ’±—Ã§ÅÏ4(ÄÄÄÅçΩπÕ–ÅÕç°ïë’±ï%êÄÙÅ9’µâï»°…Ω‹π•ê§Ï4(ÄÄÄÅçΩπÕ–ÅµÖ—ç°•πùŸïπ–ÄÙÅÖç—•Ÿï	ÂMç°ïë’±ï%êπùï–°Õç°ïë’±ï%ê§Ï4(ÄÄÄÅ•òÄ°µÖ—ç°•πùŸïπ–§ÅÏ4(ÄÄÄÄÄÅ•òÄ°µÖ—ç°•πùŸïπ–π•êÄÑÙÙÅ…Ω‹πùΩΩù±ï}ïŸïπ—}•ê§ÅÏ4(ÄÄÄÄÄÄÄÅ’¡ëÖ—ïÃπ¡’Õ†°êƒπ¡…ï¡Ö…î†4(ÄÄÄÄÄÄÄÄÄÅÅUAQÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃ4(ÄÄÄÄÄÄÄÄÄÄÅMPÅùΩΩù±ï}ïŸïπ—}•êÄÙÄ¸∞ÅùΩΩù±ï}ïŸïπ—}ï—ÖúÄÙÄ¸∞ÅùΩΩù±ï}’¡ëÖ—ïë}Ö–ÄÙÄ¸∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅÕÂπç}ï……Ω»ÄÙÄúú∞Å±ÖÕ—}ÕÂπçïë}Ö–ÄÙÅUII9Q}Q%5MQ5@4(ÄÄÄÄÄÄÄÄÄÄÅ]!IÅ•êÄÙÄ˝Ä∞4(ÄÄÄÄÄÄÄÄ§πâ•πê†4(ÄÄÄÄÄÄÄÄÄÅµÖ—ç°•πùŸïπ–π•ê∞4(ÄÄÄÄÄÄÄÄÄÅµÖ—ç°•πùŸïπ–πï—ÖúÅÒÄàà∞4(ÄÄÄÄÄÄÄÄÄÅµÖ—ç°•πùŸïπ–π’¡ëÖ—ïêÅÒÄàà∞4(ÄÄÄÄÄÄÄÄÄÅÕç°ïë’±ï%ê∞4(ÄÄÄÄÄÄÄÄ§§Ï4(ÄÄÄÄÄÅÙ4(ÄÄÄÄÄÅçΩπ—•π’îÏ4(ÄÄÄÅÙ4(ÄÄÄÅ•òÄ°Öç—•ŸïŸïπ—%ëÃπ°ÖÃ°…Ω‹πùΩΩù±ï}ïŸïπ—}•ê§§ÅçΩπ—•π’îÏ4(ÄÄÄÅ’¡ëÖ—ïÃπ¡’Õ†°êƒπ¡…ï¡Ö…î†4(ÄÄÄÄÄÅÅUAQÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃ4(ÄÄÄÄÄÄÅMPÅùΩΩù±ï}ïŸïπ—}•êÄÙÄúú∞ÅùΩΩù±ï}ïŸïπ—}ï—ÖúÄÙÄúú∞ÅùΩΩù±ï}’¡ëÖ—ïë}Ö–ÄÙÄúú∞4(ÄÄÄÄÄÄÄÄÄÄÅÕÂπç}Õ—Ö—’ÃÄÙÄù¡ïπë•πúú∞ÅÕÂπç}Ω¡ï…Ö—•Ω∏ÄÙÄù’¡Õï…–ú∞ÅÕÂπç}ï……Ω»ÄÙÄúú4(ÄÄÄÄÄÄÅ]!IÅ•êÄÙÄ˝Ä∞4(ÄÄÄÄ§πâ•πê°Õç°ïë’±ï%ê§§Ï4(ÄÄÄÅ…ïÕ—Ω…ï%ëÃπ¡’Õ†°Õç°ïë’±ï%ê§Ï4(ÄÅÙ4(ÄÅ•òÄ°’¡ëÖ—ïÃπ±ïπù—†§ÅÖ›Ö•–ÅêƒπâÖ—ç†°’¡ëÖ—ïÃ§Ï4(ÄÅ…ï—’…∏Å…ïÕ—Ω…ï%ëÃÏ4)Ù4(4)ï·¡Ω…–ÅÖÕÂπåÅô’πç—•Ω∏Å…ïçΩπç•±ïΩΩù±ïÖ±ïπëÖ…IÖπùî°Õ—Ö…–ËÅÕ—…•πú∞ÅïπêËÅÕ—…•πú§ÅÏ4(ÄÅÖ›Ö•–ÅïπÕ’…ï=…ùÖπ•ÈÖ—•ΩπMç°ïë’±ïÕIïÖë‰†§Ï4(ÄÅçΩπÕ–Åm…ïÕ’±–∞ÅçΩπÕ—…’ç—•ΩπIïÕ’±—tÄÙÅÖ›Ö•–ÅA…Ωµ•ÕîπÖ±∞°l4(ÄÄÄÅ±•Õ—ΩΩù±ïÖ±ïπëÖ…¡•Ÿïπ—Ã°Õ—Ö…–∞Åïπê§∞4(ÄÄÄÅùΩΩù±ïΩπÕ—…’ç—•ΩπÖ±ïπëÖ…¡•Ωπô•ù’…ïê†§4(ÄÄÄÄÄÄ¸Å±•Õ—ΩΩù±ïÖ±ïπëÖ…¡•Ÿïπ—Ã°Õ—Ö…–∞Åïπê∞ÄâçΩπÕ—…’ç—•Ω∏à§4(ÄÄÄÄÄÄËÅA…Ωµ•Õîπ…ïÕΩ±Ÿî°ÏÅçΩπô•ù’…ïêËÅôÖ±Õî∞ÅçΩππïç—ïêËÅôÖ±Õî∞ÅïŸïπ—ÃËÅmtÅÖÃÅΩΩù±ïÖ±ïπëÖ…¡•Ÿïπ—mt∞Åï……Ω»ËÄààÅÙ§∞4(ÄÅt§Ï4(ÄÅçΩπÕ–ÅôΩ…çïëIïô…ïÕ°%ëÃÄÙÅπï‹ÅMï–Òπ’µâï»¯†§Ï4(ÄÅ•òÄ°çΩπÕ—…’ç—•ΩπIïÕ’±–πçΩππïç—ïê§ÅÏ4(ÄÄÄÅçΩπÕ–Å…ïÕ—Ω…ï%ëÃÄÙÅÖ›Ö•–Å…ï¡Ö•…ï±ï—ïëΩπÕ—…’ç—•ΩπÖ±ïπëÖ…Ÿïπ—Ã°Õ—Ö…–∞Åïπê∞ÅçΩπÕ—…’ç—•ΩπIïÕ’±–πïŸïπ—Ã§Ï4(ÄÄÄÅ…ïÕ—Ω…ï%ëÃπôΩ…Öç††°•ê§ÄÙ¯ÅôΩ…çïëIïô…ïÕ°%ëÃπÖëê°•ê§§Ï4(ÄÅÙ4(ÄÅ•òÄ†Ö…ïÕ’±–πçΩππïç—ïê§ÅÏ4(ÄÄÄÅ•òÄ°ôΩ…çïëIïô…ïÕ°%ëÃπÕ•Èî§ÅÖ›Ö•–Åô±’Õ°ΩΩù±ïÖ±ïπëÖ…MÂπå°ÏÅ•ëÃËÅl∏∏πôΩ…çïëIïô…ïÕ°%ëÕtÅÙ§Ï4(ÄÄÄÅ…ï—’…∏ÅÏÄ∏∏π…ïÕ’±–∞Å…ïÖë=π±ÂŸïπ—ÃËÅmtÅÖÃÅIïÖë=π±ÂΩΩù±ïMç°ïë’±ïmtÅÙÏ4(ÄÅÙ4(ÄÅçΩπÕ–ÅêƒÄÙÅùï—ƒ†§Ï4(ÄÅçΩπÕ–ÅÕ•—ï%ëÃÄÙÅÖ›Ö•–Å±ΩçÖ±M•—ïMç°ïë’±ï%ëÃ†§Ï4(ÄÅçΩπÕ–Å…ïÖëΩπ±‰ËÅIïÖë=π±ÂΩΩù±ïMç°ïë’±ïmtÄÙÅmtÏ4(ÄÅçΩπÕ–ÅÕïïπIïÖëΩπ±‰ÄÙÅπï‹ÅMï–ÒÕ—…•πú¯†§Ï4(ÄÅôΩ»Ä°çΩπÕ–ÅïŸïπ–ÅΩòÅ…ïÕ’±–πïŸïπ—Ã§ÅÏ4(ÄÄÄÅçΩπÕ–Å¡…Ω¡ï…—•ïÃÄÙÅïŸïπ–πï·—ïπëïëA…Ω¡ï…—•ïÃ¸π¡…•ŸÖ—îÅÒÅÌÙÏ4(ÄÄÄÅçΩπÕ–ÅÕ•—ï%êÄÙÅ9’µâï»°¡…Ω¡ï…—•ïÃπ›°•ÈÈ’¡Mç°ïë’±ï%ê§Ï4(ÄÄÄÅçΩπÕ–ÅÕ•—ï=›πïêÄÙÅ¡…Ω¡ï…—•ïÃπ›°•ÈÈ’¡MΩ’…çîÄÙÙÙÄâÕ•—îàÄòòÅ9’µâï»π•ÕMÖôï%π—ïùï»°Õ•—ï%ê§ÄòòÅÕ•—ï%êÄ¯Ä¿Ï4(ÄÄÄÅ•òÄ°Õ•—ï=›πïêÄòòÅÕ•—ï%ëÃπ°ÖÃ°Õ•—ï%ê§§ÅÏ(ÄÄÄÄÄÅçΩπÕ–Å…Ω‹ÄÙÅÖ›Ö•–Åêƒπ¡…ï¡Ö…î†(ÄÄÄÄÄÄÄÅÅM1PÅΩ…ùÖπ•ÈÖ—•Ω∏∞Åâ’Õ•πïÕÕ}…Ω’πê∞Å±Öâï∞∞ÅçÖ—ïùΩ…‰∞ÅÕÂπç}Õ—Ö—’Ã∞ÅÕÂπç}Ω¡ï…Ö—•Ω∏∞(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅùΩΩù±ï}ïŸïπ—}•ê∞ÅùΩΩù±ï}’¡ëÖ—ïë}Ö–(ÄÄÄÄÄÄÄÄÅI=4ÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃÅ]!IÅ•êÄÙÄ˝Ä∞(ÄÄÄÄÄÄ§πâ•πê°Õ•—ï%ê§πô•…Õ–ÒÏ(ÄÄÄÄÄÄÄÅΩ…ùÖπ•ÈÖ—•Ω∏ËÅÕ—…•πúÏÅâ’Õ•πïÕÕ}…Ω’πêËÅπ’µâï»ÏÅ±Öâï∞ËÅÕ—…•πúÏÅçÖ—ïùΩ…‰ËÅÕ—…•πúÏÅÕÂπç}Õ—Ö—’ÃËÅÕ—…•πúÏ(ÄÄÄÄÄÄÄÅÕÂπç}Ω¡ï…Ö—•Ω∏ËÅÕ—…•πúÏÅùΩΩù±ï}ïŸïπ—}•êËÅÕ—…•πúÏÅùΩΩù±ï}’¡ëÖ—ïë}Ö–ËÅÕ—…•πúÏ(ÄÄÄÄÄÅÙ¯†§Ï(ÄÄÄÄÄÄººÅÅ¡ï…ÕΩπÖ∞ÅÕç°ïë’±îÅµ’Õ–Å…ïµÖ•∏ÅΩπ±‰Å•∏Å—°îÅÕ•—îÅçÖ±ïπëÖ»∏ÅQ°•ÃÅÖ±Õº(ÄÄÄÄÄÄººÅ…ïµΩŸïÃÅ±ïùÖç‰Å¡’â±•åÅïŸïπ—ÃÅ›°ΩÕîÅ±ΩçÖ∞ÅΩΩù±îÅ±•π¨Å›ÖÃÅÖ±…ïÖë‰(ÄÄÄÄÄÄººÅç±ïÖ…ïêÅâïôΩ…îÅ—°îÅ’π±•π¨Å…ï≈’ïÕ–ÅçΩ’±êÅçΩµ¡±ï—î∏(ÄÄÄÄÄÅ•òÄ°…Ω‹¸πçÖ—ïùΩ…‰ÄÙÙÙÄâ¡ï…ÕΩπÖ∞à§ÅÏ(ÄÄÄÄÄÄÄÅ•òÄ°ïŸïπ–πÕ—Ö—’ÃÄÑÙÙÄâçÖπçï±±ïêà§ÅÏ(ÄÄÄÄÄÄÄÄÄÅÖ›Ö•–Åëï±ï—ïΩΩù±ïÖ±ïπëÖ…Ÿïπ–°ïŸïπ–π•ê∞Äâùïπï…Ö∞à§Ï(ÄÄÄÄÄÄÄÅÙ(ÄÄÄÄÄÄÄÅÖ›Ö•–Åêƒπ¡…ï¡Ö…î†(ÄÄÄÄÄÄÄÄÄÅÅUAQÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃ(ÄÄÄÄÄÄÄÄÄÄÅMPÅùΩΩù±ï}ïŸïπ—}•êÄÙÄúú∞ÅùΩΩù±ï}ïŸïπ—}ï—ÖúÄÙÄúú∞ÅùΩΩù±ï}’¡ëÖ—ïë}Ö–ÄÙÄúú∞(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅÕÂπç}Õ—Ö—’ÃÄÙÄù±ΩçÖ±}Ωπ±‰ú∞ÅÕÂπç}Ω¡ï…Ö—•Ω∏ÄÙÄù’¡Õï…–ú∞ÅÕÂπç}ï……Ω»ÄÙÄúú∞(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ±ÖÕ—}ÕÂπçïë}Ö–ÄÙÅUII9Q}Q%5MQ5@(ÄÄÄÄÄÄÄÄÄÄÅ]!IÅ•êÄÙÄ˝Ä∞(ÄÄÄÄÄÄÄÄ§πâ•πê°Õ•—ï%ê§π…’∏†§Ï(ÄÄÄÄÄÄÄÅçΩπ—•π’îÏ(ÄÄÄÄÄÅÙ(ÄÄÄÄÄÅçΩπÕ–ÅëïÕç…•¡—•Ω∏ÄÙÅïŸïπ–πëïÕç…•¡—•Ω∏ÅÒÄààÏ(ÄÄÄÄÄÅçΩπÕ–Åï·•Õ—•πùM—…’ç—’…ïêÄÙÅùΩΩù±ïM—…’ç—’…ïëïÕç…•¡—•Ω∏°ëïÕç…•¡—•Ω∏§Ï4(ÄÄÄÄÄÅ•òÄ°…Ω‹¸πçÖ—ïùΩ…‰ÄÙÙÙÄâçΩπÕ—…’ç—•Ω∏à§ÅÏ4(ÄÄÄÄÄÄÄÅÖ›Ö•–Åêƒπ¡…ï¡Ö…î†4(ÄÄÄÄÄÄÄÄÄÅÅUAQÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃ4(ÄÄÄÄÄÄÄÄÄÄÅMPÅÖÕÕ•ùπïï}πÖµîÄÙÅM4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ]!8ÅÖÕÕ•ùπïï}µïµâï…}•êÅ%LÅ9U10Å9ÅQI%4°=1M°ÖÕÕ•ùπïï}πÖµî∞Äúú§§ÄÙÄúúÅ9Ä¸Ä¯Äúú4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ9Å9=PÅa%MQLÄ†4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅM1PÄƒÅI=4ÅÖç—•Ÿ•—•ïÃÅÑ4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ]!IÅÑπΩ…ùÖπ•ÈÖ—•Ω∏ÄÙÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃπΩ…ùÖπ•ÈÖ—•Ω∏4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ9ÅÑπâ’Õ•πïÕÕ}…Ω’πêÄÙÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃπâ’Õ•πïÕÕ}…Ω’πê4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ9ÅQI%4°=1M°Ñπ¡…Ωù…ïÕÕ}µÖπÖùï»∞Äúú§§Ä¯Äúú4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ§ÅQ!8Ä¸Å1MÅÖÕÕ•ùπïï}πÖµîÅ9∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅŸïπëΩ…}πÖµîÄÙÅM4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ]!8ÅQI%4°=1M°ŸïπëΩ…}πÖµî∞Äúú§§ÄÙÄúúÅ9Ä¸Ä¯ÄúúÅQ!8Ä¸Å1MÅŸïπëΩ…}πÖµîÅ9∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅëï—Ö•±ÃÄÙÅM4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ]!8ÅQI%4°=1M°ëï—Ö•±Ã∞Äúú§§ÄÙÄúúÅ9Ä¸Ä¯ÄúúÅQ!8Ä¸Å1MÅëï—Ö•±ÃÅ94(ÄÄÄÄÄÄÄÄÄÄÅ]!IÅ•êÄÙÄ˝Ä∞4(ÄÄÄÄÄÄÄÄ§πâ•πê†4(ÄÄÄÄÄÄÄÄÄÅï·•Õ—•πùM—…’ç—’…ïêπÖÕÕ•ùπïî∞4(ÄÄÄÄÄÄÄÄÄÅï·•Õ—•πùM—…’ç—’…ïêπÖÕÕ•ùπïî∞4(ÄÄÄÄÄÄÄÄÄÅï·•Õ—•πùM—…’ç—’…ïêπŸïπëΩ»∞4(ÄÄÄÄÄÄÄÄÄÅï·•Õ—•πùM—…’ç—’…ïêπŸïπëΩ»∞4(ÄÄÄÄÄÄÄÄÄÅï·•Õ—•πùM—…’ç—’…ïêπµïµº∞4(ÄÄÄÄÄÄÄÄÄÅï·•Õ—•πùM—…’ç—’…ïêπµïµº∞4(ÄÄÄÄÄÄÄÄÄÅÕ•—ï%ê∞4(ÄÄÄÄÄÄÄÄ§π…’∏†§Ï4(ÄÄÄÄÄÄÄÅ•òÄ°ï·•Õ—•πùM—…’ç—’…ïêπ¡…Ωë’ç—Ã§ÅÏ4(ÄÄÄÄÄÄÄÄÄÅÖ›Ö•–Åêƒπ¡…ï¡Ö…î†4(ÄÄÄÄÄÄÄÄÄÄÄÅÅUAQÅçΩπÕ—…’ç—•Ωπ}Õç°ïë’±ï}¡…Ω©ïç—Ã4(ÄÄÄÄÄÄÄÄÄÄÄÄÅMPÅ›Ω…≠}Õ’µµÖ…‰ÄÙÄ¸∞Å›Ω…≠}Õ’µµÖ…Â}µΩëîÄÙÄùµÖπ’Ö∞ú∞Å’¡ëÖ—ïë}Ö–ÄÙÅUII9Q}Q%5MQ5@4(ÄÄÄÄÄÄÄÄÄÄÄÄÅ]!IÅΩ…ùÖπ•ÈÖ—•Ω∏ÄÙÄ¸Å9Åâ’Õ•πïÕÕ}…Ω’πêÄÙÄ¸4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ9ÅQI%4°=1M°›Ω…≠}Õ’µµÖ…‰∞Äúú§§ÄÙÄúú4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ9Å9=PÅa%MQLÄ†4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅM1PÄƒÅI=4Åï≈’•¡µïπ—}¡…Ω©ïç—ÃÅï¿4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ)=%8Åï≈’•¡µïπ—}•—ïµÃÅï§Å=8Åï§π¡…Ω©ïç—}•êÄÙÅï¿π•ê4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ]!IÅï¿πΩ…ùÖπ•ÈÖ—•Ω∏ÄÙÅçΩπÕ—…’ç—•Ωπ}Õç°ïë’±ï}¡…Ω©ïç—ÃπΩ…ùÖπ•ÈÖ—•Ω∏4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ9Åï¿πâ’Õ•πïÕÕ}…Ω’πêÄÙÅçΩπÕ—…’ç—•Ωπ}Õç°ïë’±ï}¡…Ω©ïç—Ãπâ’Õ•πïÕÕ}…Ω’πê4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ9ÅQI%4°=1M°ï§π¡…Ωë’ç—}πÖµî∞Äúú§§Ä¯Äúú4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄ•Ä∞4(ÄÄÄÄÄÄÄÄÄÄ§πâ•πê°ï·•Õ—•πùM—…’ç—’…ïêπ¡…Ωë’ç—Ã∞Å…Ω‹πΩ…ùÖπ•ÈÖ—•Ω∏∞Å…Ω‹πâ’Õ•πïÕÕ}…Ω’πê§π…’∏†§Ï4(ÄÄÄÄÄÄÄÅÙ4(ÄÄÄÄÄÅÙ4(ÄÄÄÄÄÅçΩπÕ–Å…ï≈’•…ïëïÕç…•¡—•Ωπ•ï±ëÃÄÙÅ…Ω‹¸πçÖ—ïùΩ…‰ÄÙÙÙÄâçΩπÕ—…’ç—•Ω∏à4(ÄÄÄÄÄÄÄÄ¸ÅlãÆ.”Æ.Á≤z@Ëà∞Äã≤.s™Œ‘ÉÆ.£™ŒËà∞Äã≤.s™Œ◊≤^≤ –Ëà∞Äã™Œ◊≤
≥
ﬂ∂J#Æ™§Ëà∞ÄãÆ¶SÆ™†Ëât4(ÄÄÄÄÄÄÄÄËÅlãÆ.”Æ.Á≤z@Ëà∞Äã≤vÛ≤ÇTÉÆ
”≤j§Ëà∞ÄãÆ¶SÆ™†ËâtÏ4(ÄÄÄÄÄÅçΩπÕ–Åµ•ÕÕ•πù5ÖπÖùïëïÕç…•¡—•Ω∏ÄÙÅ…ï≈’•…ïëïÕç…•¡—•Ωπ•ï±ëÃπÕΩµî†°ô•ï±ê§ÄÙ¯ÄÖëïÕç…•¡—•Ω∏π•πç±’ëïÃ°ô•ï±ê§§Ï4(ÄÄÄÄÄÅ•òÄ°…Ω‹ÄòòÅïŸïπ–πÕ—Ö—’ÃÄÑÙÙÄâçÖπçï±±ïêàÄòòÅµ•ÕÕ•πù5ÖπÖùïëïÕç…•¡—•Ω∏§ÅÏ4(ÄÄÄÄÄÄÄÅÖ›Ö•–Åêƒπ¡…ï¡Ö…î†4(ÄÄÄÄÄÄÄÄÄÅÅUAQÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃ4(ÄÄÄÄÄÄÄÄÄÄÅMPÅÕÂπç}Õ—Ö—’ÃÄÙÄù¡ïπë•πúú∞ÅÕÂπç}Ω¡ï…Ö—•Ω∏ÄÙÄù’¡Õï…–ú∞ÅÕÂπç}ï……Ω»ÄÙÄúú4(ÄÄÄÄÄÄÄÄÄÄÅ]!IÅ•êÄÙÄ˝Ä∞4(ÄÄÄÄÄÄÄÄ§πâ•πê°Õ•—ï%ê§π…’∏†§Ï4(ÄÄÄÄÄÄÄÅôΩ…çïëIïô…ïÕ°%ëÃπÖëê°Õ•—ï%ê§Ï4(ÄÄÄÄÄÄÄÅçΩπ—•π’îÏ4(ÄÄÄÄÄÅÙ4(ÄÄÄÄÄÅ•òÄ°ïŸïπ–πÕ—Ö—’ÃÄÙÙÙÄâçÖπçï±±ïêà§ÅÏ4(ÄÄÄÄÄÄÄÅ•òÄ°…Ω‹¸πçÖ—ïùΩ…‰ÄÙÙÙÄâçΩπÕ—…’ç—•Ω∏à§ÅÏ4(ÄÄÄÄÄÄÄÄÄÅÖ›Ö•–Åêƒπ¡…ï¡Ö…î†4(ÄÄÄÄÄÄÄÄÄÄÄÅÅUAQÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃ4(ÄÄÄÄÄÄÄÄÄÄÄÄÅMPÅùΩΩù±ï}ïŸïπ—}•êÄÙÄúú∞ÅùΩΩù±ï}ïŸïπ—}ï—ÖúÄÙÄúú∞ÅùΩΩù±ï}’¡ëÖ—ïë}Ö–ÄÙÄúú∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅÕÂπç}Õ—Ö—’ÃÄÙÄù¡ïπë•πúú∞ÅÕÂπç}Ω¡ï…Ö—•Ω∏ÄÙÄù’¡Õï…–ú∞ÅÕÂπç}ï……Ω»ÄÙÄúú4(ÄÄÄÄÄÄÄÄÄÄÄÄÅ]!IÅ•êÄÙÄ˝Ä∞4(ÄÄÄÄÄÄÄÄÄÄ§πâ•πê°Õ•—ï%ê§π…’∏†§Ï4(ÄÄÄÄÄÄÄÅÙÅï±ÕîÅÏ4(ÄÄÄÄÄÄÄÄÄÅÖ›Ö•–Åêƒπ¡…ï¡Ö…î†4(ÄÄÄÄÄÄÄÄÄÄÄÅÅUAQÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃ4(ÄÄÄÄÄÄÄÄÄÄÄÄÅMPÅùΩΩù±ï}ïŸïπ—}•êÄÙÄúú∞ÅùΩΩù±ï}ïŸïπ—}ï—ÖúÄÙÄúú∞ÅùΩΩù±ï}’¡ëÖ—ïë}Ö–ÄÙÄúú∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅÕÂπç}Õ—Ö—’ÃÄÙÄù±ΩçÖ±}Ωπ±‰ú∞ÅÕÂπç}Ω¡ï…Ö—•Ω∏ÄÙÄù’¡Õï…–ú∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅÕÂπç}ï……Ω»ÄÙÄùùΩΩù±ï}ïŸïπ—}ëï±ï—ïêú∞Å±ÖÕ—}ÕÂπçïë}Ö–ÄÙÅUII9Q}Q%5MQ5@4(ÄÄÄÄÄÄÄÄÄÄÄÄÅ]!IÅ•êÄÙÄ˝Ä∞4(ÄÄÄÄÄÄÄÄÄÄ§πâ•πê°Õ•—ï%ê§π…’∏†§Ï4(ÄÄÄÄÄÄÄÅÙ4(ÄÄÄÄÄÄÄÅçΩπ—•π’îÏ4(ÄÄÄÄÄÅÙ4(ÄÄÄÄÄÅ•òÄ°…Ω‹¸πçÖ—ïùΩ…‰ÄÙÙÙÄâçΩπÕ—…’ç—•Ω∏àÄòòÅïŸïπ–π’¡ëÖ—ïêÄòòÅïŸïπ–π’¡ëÖ—ïêÄ¯Ä°…Ω‹πùΩΩù±ï}’¡ëÖ—ïë}Ö–ÅÒÄàà§§ÅÏ4(ÄÄÄÄÄÄÄÅÖ›Ö•–Åêƒπ¡…ï¡Ö…î†4(ÄÄÄÄÄÄÄÄÄÅÅUAQÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃ4(ÄÄÄÄÄÄÄÄÄÄÅMPÅÕÂπç}Õ—Ö—’ÃÄÙÄù¡ïπë•πúú∞ÅÕÂπç}Ω¡ï…Ö—•Ω∏ÄÙÄù’¡Õï…–ú∞ÅÕÂπç}ï……Ω»ÄÙÄúúÅ]!IÅ•êÄÙÄ˝Ä∞4(ÄÄÄÄÄÄÄÄ§πâ•πê°Õ•—ï%ê§π…’∏†§Ï4(ÄÄÄÄÄÄÄÅçΩπ—•π’îÏ4(ÄÄÄÄÄÅÙ4(ÄÄÄÄÄÅ•òÄ°…Ω‹¸πÕÂπç}Õ—Ö—’ÃÄÙÙÙÄâÕÂπçïêàÄòòÅïŸïπ–π’¡ëÖ—ïêÄòòÅïŸïπ–π’¡ëÖ—ïêÄ¯Ä°…Ω‹πùΩΩù±ï}’¡ëÖ—ïë}Ö–ÅÒÄàà§§ÅÏ4(ÄÄÄÄÄÄÄÅçΩπÕ–ÅŸÖ±’ïÃÄÙÅïŸïπ—YÖ±’ïÃ°ïŸïπ–§Ï4(ÄÄÄÄÄÄÄÅçΩπÕ–ÅΩ…ùÖπ•ÈÖ—•Ω∏ÄÙÄ°¡…Ω¡ï…—•ïÃπ›°•ÈÈ’¡=…ùÖπ•ÈÖ—•Ω∏ÅÒÅ…Ω‹πΩ…ùÖπ•ÈÖ—•Ω∏§πÕ±•çî†¿∞Äƒ»¿§Ï4(ÄÄÄÄÄÄÄÅçΩπÕ–ÅÕ—…’ç—’…ïêÄÙÅùΩΩù±ïM—…’ç—’…ïëïÕç…•¡—•Ω∏°ïŸïπ–πëïÕç…•¡—•Ω∏ÅÒÄàà§Ï4(ÄÄÄÄÄÄÄÅçΩπÕ–Å¡…ïô•‡ÄÙÅ…Ω‹πçÖ—ïùΩ…‰ÄÙÙÙÄâùïπï…Ö∞àÄ¸Äã≤b≤^à4(ÄÄÄÄÄÄÄÄÄÄËÅ…Ω‹πçÖ—ïùΩ…‰ÄÙÙÙÄâµïï—•πúàÄ¸Äã∂j3≤v`à4(ÄÄÄÄÄÄÄÄÄÄËÅ…Ω‹πçÖ—ïùΩ…‰ÄÙÙÙÄâÕ°Ω›…ΩΩ¥àÄ¸Äã≤ÛÆé‡à4(ÄÄÄÄÄÄÄÄÄÄËÅ…Ω‹πçÖ—ïùΩ…‰ÄÙÙÙÄâΩ—°ï»àÄ¸Äã™‚√∂ à4(ÄÄÄÄÄÄÄÄÄÄËÄààÏ4(ÄÄÄÄÄÄÄÅçΩπÕ–Å—…’Õ—ïëΩπ—ïπ–ÄÙÅÕ—…’ç—’…ïêπçΩπ—ïπ–πÕ±•çî†¿∞Äƒ»¿§Ï4(ÄÄÄÄÄÄÄÅçΩπÕ–Å±Öâï∞ÄÙÅ—…’Õ—ïëΩπ—ïπ–Ä¸Ä†Ö¡…ïô•‡Ä¸Å—…’Õ—ïëΩπ—ïπ–ÄËÅÄëÌ¡…ïô•·ÙÉ
‹ÄëÌ—…’Õ—ïëΩπ—ïπ—ıÄ§ÄËÅ…Ω‹π±Öâï∞Ï4(ÄÄÄÄÄÄÄÅçΩπÕ–Å—…’Õ—ïëÕÕ•ùπïîÄÙÅÕ—…’ç—’…ïêπÖÕÕ•ùπïîπÕ±•çî†¿∞Äƒ»¿§Ï4(ÄÄÄÄÄÄÄÅÖ›Ö•–Åêƒπ¡…ï¡Ö…î†4(ÄÄÄÄÄÄÄÄÄÅÅUAQÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃ4(ÄÄÄÄÄÄÄÄÄÄÅMPÅΩ…ùÖπ•ÈÖ—•Ω∏ÄÙÄ¸∞Å±Öâï∞ÄÙÄ¸∞ÅÕç°ïë’±ïë}ëÖ—îÄÙÄ¸∞ÅÕ—Ö…—}—•µîÄÙÄ¸∞Åïπë}—•µîÄÙÄ¸∞Åïπë}ëÖ—îÄÙÄ¸∞Åëï—Ö•±ÃÄÙÄ¸∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅÖÕÕ•ùπïï}πÖµîÄÙÅMÅ]!8ÅÖÕÕ•ùπïï}µïµâï…}•êÅ%LÅ9U10Å9Ä¸Ä¯ÄúúÅQ!8Ä¸Å1MÅÖÕÕ•ùπïï}πÖµîÅ9∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅùΩΩù±ï}ïŸïπ—}•êÄÙÄ¸∞ÅùΩΩù±ï}ïŸïπ—}ï—ÖúÄÙÄ¸∞ÅùΩΩù±ï}’¡ëÖ—ïë}Ö–ÄÙÄ¸∞ÅÕÂπç}ï……Ω»ÄÙÄúú∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅ±ÖÕ—}ÕÂπçïë}Ö–ÄÙÅUII9Q}Q%5MQ5@∞Å’¡ëÖ—ïë}âÂ}πÖµîÄÙÄùΩΩù±îÅÖ±ïπëÖ»ú∞Å’¡ëÖ—ïë}Ö–ÄÙÅUII9Q}Q%5MQ5@4(ÄÄÄÄÄÄÄÄÄÄÅ]!IÅ•êÄÙÄ¸Å9ÅçÖ—ïùΩ…‰Ä¯ÄùçΩπÕ—…’ç—•Ω∏ùÄ∞4(ÄÄÄÄÄÄÄÄ§πâ•πê†4(ÄÄÄÄÄÄÄÄÄÅΩ…ùÖπ•ÈÖ—•Ω∏∞4(ÄÄÄÄÄÄÄÄÄÅ±Öâï∞πÕ±•çî†¿∞Äƒ»¿§∞4(ÄÄÄÄÄÄÄÄÄÅŸÖ±’ïÃπÕç°ïë’±ïëÖ—î∞4(ÄÄÄÄÄÄÄÄÄÅŸÖ±’ïÃπÕ—Ö…—Q•µî∞4(ÄÄÄÄÄÄÄÄÄÅŸÖ±’ïÃπïπëQ•µî∞4(ÄÄÄÄÄÄÄÄÄÅŸÖ±’ïÃπïπëÖ—î∞4(ÄÄÄÄÄÄÄÄÄÅµïµΩ…ΩµΩΩù±ïïÕç…•¡—•Ω∏°ïŸïπ–πëïÕç…•¡—•Ω∏ÅÒÄàà§∞4(ÄÄÄÄÄÄÄÄÄÅ—…’Õ—ïëÕÕ•ùπïî∞4(ÄÄÄÄÄÄÄÄÄÅ—…’Õ—ïëÕÕ•ùπïî∞4(ÄÄÄÄÄÄÄÄÄÅïŸïπ–π•ê∞4(ÄÄÄÄÄÄÄÄÄÅïŸïπ–πï—ÖúÅÒÄàà∞4(ÄÄÄÄÄÄÄÄÄÅïŸïπ–π’¡ëÖ—ïêÅÒÄàà∞4(ÄÄÄÄÄÄÄÄÄÅÕ•—ï%ê∞4(ÄÄÄÄÄÄÄÄ§π…’∏†§Ï4(ÄÄÄÄÄÅÙ4(ÄÄÄÄÄÅçΩπ—•π’îÏ4(ÄÄÄÅÙ4(ÄÄÄÅ•òÄ°ïŸïπ–πÕ—Ö—’ÃÄÙÙÙÄâçÖπçï±±ïêàÅÒÄÖïŸïπ–πÕ—Ö…–§ÅçΩπ—•π’îÏ4(ÄÄÄÅçΩπÕ–ÅŸÖ±’ïÃÄÙÅïŸïπ—YÖ±’ïÃ°ïŸïπ–§Ï4(ÄÄÄÅ•òÄ°Õ•—ï=›πïêÄòòÄÖÕ•—ï%ëÃπ°ÖÃ°Õ•—ï%ê§ÄòòÅŸÖ±’ïÃπÕç°ïë’±ïëÖ—î§ÅÏ4(ÄÄÄÄÄÅçΩπÕ–ÅΩ…ùÖπ•ÈÖ—•Ω∏ÄÙÄ°¡…Ω¡ï…—•ïÃπ›°•ÈÈ’¡=…ùÖπ•ÈÖ—•Ω∏ÅÒÅÕ’ùùïÕ—ïë=…ùÖπ•ÈÖ—•Ω∏°ïŸïπ–§§π—…•¥†§πÕ±•çî†¿∞Äƒ»¿§Ï4(ÄÄÄÄÄÅçΩπÕ–Åâ’Õ•πïÕÕIΩ’πêÄÙÅ5Ö—†πµÖ‡†¿∞Å9’µâï»°¡…Ω¡ï…—•ïÃπ›°•ÈÈ’¡	’Õ•πïÕÕIΩ’πê§ÅÒÄ¿§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅÕ—…’ç—’…ïêÄÙÅùΩΩù±ïM—…’ç—’…ïëïÕç…•¡—•Ω∏°ïŸïπ–πëïÕç…•¡—•Ω∏ÅÒÄàà§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅïŸïπ—1Öâï∞ÄÙÅÕ—…’ç—’…ïêπçΩπ—ïπ–π—…•¥†§4(ÄÄÄÄÄÄÄÅÒÄ°ïŸïπ–πÕ’µµÖ…‰ÅÒÄàà§π…ï¡±Öçî†ΩyqÃ©qmmyquuÏƒ∞ƒ¡ıquqÃ®Ω‘∞Äàà§π…ï¡±Öçî°Ω…ùÖπ•ÈÖ—•Ω∏∞Äàà§π…ï¡±Öçî†ΩyqÃ©o
ﬂäàÈpµuqÃ®º∞Äàà§π—…•¥†§Ï4(ÄÄÄÄÄÅ•òÄ°Ω…ùÖπ•ÈÖ—•Ω∏ÄòòÅïŸïπ—1Öâï∞§ÅÏ4(ÄÄÄÄÄÄÄÅçΩπÕ–ÅçÖπë•ëÖ—ïÃÄÙÅÖ›Ö•–Åêƒπ¡…ï¡Ö…î†4(ÄÄÄÄÄÄÄÄÄÅÅM1PÅ•ê∞Å±Öâï∞∞ÅÕ—Ö…—}—•µî∞Åïπë}—•µî∞ÅùΩΩù±ï}ïŸïπ—}•ê4(ÄÄÄÄÄÄÄÄÄÄÅI=4ÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃ4(ÄÄÄÄÄÄÄÄÄÄÅ]!IÅ1=]H°QI%4°Ω…ùÖπ•ÈÖ—•Ω∏§§ÄÙÅ1=]H°QI%4†¸§§4(ÄÄÄÄÄÄÄÄÄÄÄÄÅ9Åâ’Õ•πïÕÕ}…Ω’πêÄÙÄ¸4(ÄÄÄÄÄÄÄÄÄÄÄÄÅ9ÅÕç°ïë’±ïë}ëÖ—îÄÙÄ¸4(ÄÄÄÄÄÄÄÄÄÄÄÄÅ9Å=1M°çÖ—ïùΩ…‰∞Äùùïπï…Ö∞ú§Ä¯ÄùçΩπÕ—…’ç—•Ω∏ú4(ÄÄÄÄÄÄÄÄÄÄÄÄÅ9ÅQI%4°=1M°ëï±ï—ïë}Ö–∞Äúú§§ÄÙÄúùÄ∞4(ÄÄÄÄÄÄÄÄ§πâ•πê°Ω…ùÖπ•ÈÖ—•Ω∏∞Åâ’Õ•πïÕÕIΩ’πê∞ÅŸÖ±’ïÃπÕç°ïë’±ïëÖ—î§πÖ±∞ÒÏ4(ÄÄÄÄÄÄÄÄÄÅ•êËÅπ’µâï»ÏÅ±Öâï∞ËÅÕ—…•πúÏÅÕ—Ö…—}—•µîËÅÕ—…•πúÏÅïπë}—•µîËÅÕ—…•πúÏÅùΩΩù±ï}ïŸïπ—}•êËÅÕ—…•πúÏ4(ÄÄÄÄÄÄÄÅÙ¯†§Ï4(ÄÄÄÄÄÄÄÅçΩπÕ–ÅÕïµÖπ—•ç1Öâï∞ÄÙÅπΩ…µÖ±•ÈïMç°ïë’±ïMïµÖπ—•ç1Öâï∞°Ω…ùÖπ•ÈÖ—•Ω∏∞ÅïŸïπ—1Öâï∞§Ï4(ÄÄÄÄÄÄÄÅçΩπÕ–Å…ï¡±Öçïµïπ—ÃÄÙÅçÖπë•ëÖ—ïÃπ…ïÕ’±—Ãπô•±—ï»†°çÖπë•ëÖ—î§ÄÙ¯4(ÄÄÄÄÄÄÄÄÄÅπΩ…µÖ±•ÈïMç°ïë’±ïMïµÖπ—•ç1Öâï∞°Ω…ùÖπ•ÈÖ—•Ω∏∞ÅçÖπë•ëÖ—îπ±Öâï∞§ÄÙÙÙÅÕïµÖπ—•ç1Öâï∞4(ÄÄÄÄÄÄÄÄÄÄÄÄòòÄ°çÖπë•ëÖ—îπÕ—Ö…—}—•µîÅÒÄàà§ÄÙÙÙÅŸÖ±’ïÃπÕ—Ö…—Q•µî4(ÄÄÄÄÄÄÄÄÄÄÄÄòòÄ°çÖπë•ëÖ—îπïπë}—•µîÅÒÄàà§ÄÙÙÙÅŸÖ±’ïÃπïπëQ•µî4(ÄÄÄÄÄÄÄÄÄÄÄÄòòÅ	ΩΩ±ïÖ∏°çÖπë•ëÖ—îπùΩΩù±ï}ïŸïπ—}•ê¸π—…•¥†§§4(ÄÄÄÄÄÄÄÄÄÄÄÄòòÅçÖπë•ëÖ—îπùΩΩù±ï}ïŸïπ—}•êÄÑÙÙÅïŸïπ–π•ê∞4(ÄÄÄÄÄÄÄÄ§Ï4(ÄÄÄÄÄÄÄÅ•òÄ°…ï¡±Öçïµïπ—Ãπ±ïπù—†ÄÙÙÙÄƒ§ÅÏ4(ÄÄÄÄÄÄÄÄÄÅÖ›Ö•–Åëï±ï—ïΩΩù±ïÖ±ïπëÖ…Ÿïπ–°ïŸïπ–π•ê∞Äâùïπï…Ö∞à§Ï4(ÄÄÄÄÄÄÄÄÄÅçΩπ—•π’îÏ4(ÄÄÄÄÄÄÄÅÙ4(ÄÄÄÄÄÅÙ4(ÄÄÄÅÙ4(ÄÄÄÅçΩπÕ–Å±ïùÖçÂM—ÖùîÄÙÅ±ïùÖçÂΩπÕ—…’ç—•ΩπM—Öùî°ïŸïπ–πëïÕç…•¡—•Ω∏ÅÒÄàà§Ï4(ÄÄÄÅ•òÄ°±ïùÖçÂM—ÖùîÄòòÅŸÖ±’ïÃπÕç°ïë’±ïëÖ—î§ÅÏ4(ÄÄÄÄÄÅçΩπÕ–ÅçÖπë•ëÖ—ïÃÄÙÅÖ›Ö•–Åêƒπ¡…ï¡Ö…î†4(ÄÄÄÄÄÄÄÅÅM1PÅ•ê∞ÅùΩΩù±ï}ïŸïπ—}•ê4(ÄÄÄÄÄÄÄÄÅI=4ÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃ4(ÄÄÄÄÄÄÄÄÅ]!IÅçÖ—ïùΩ…‰ÄÙÄùçΩπÕ—…’ç—•Ω∏ú4(ÄÄÄÄÄÄÄÄÄÄÅ9ÅQI%4°=1M°ëï±ï—ïë}Ö–∞Äúú§§ÄÙÄúú4(ÄÄÄÄÄÄÄÄÄÄÅ9Å±Öâï∞ÄÙÄ¸Å9ÅÕç°ïë’±ïë}ëÖ—îÄÙÄ¸4(ÄÄÄÄÄÄÄÄÄÄÅ9Å=1M°9U11%°ïπë}ëÖ—î∞Äúú§∞ÅÕç°ïë’±ïë}ëÖ—î§ÄÙÄ¸4(ÄÄÄÄÄÄÄÄÄÄÅ9Ä°ùΩΩù±ï}ïŸïπ—}•êÄÙÄ¸Å=HÅQI%4°=1M°ùΩΩù±ï}ïŸïπ—}•ê∞Äúú§§ÄÙÄúú§4(ÄÄÄÄÄÄÄÄÅ=IHÅ	dÅMÅ]!8ÅùΩΩù±ï}ïŸïπ—}•êÄÙÄ¸ÅQ!8Ä¿Å1MÄƒÅ9∞Å•êÅMÄ∞4(ÄÄÄÄÄÄ§πâ•πê†4(ÄÄÄÄÄÄÄÅ±ïùÖçÂM—Öùî∞4(ÄÄÄÄÄÄÄÅŸÖ±’ïÃπÕç°ïë’±ïëÖ—î∞4(ÄÄÄÄÄÄÄÅŸÖ±’ïÃπïπëÖ—îÅÒÅŸÖ±’ïÃπÕç°ïë’±ïëÖ—î∞4(ÄÄÄÄÄÄÄÅïŸïπ–π•ê∞4(ÄÄÄÄÄÄÄÅïŸïπ–π•ê∞4(ÄÄÄÄÄÄ§πÖ±∞ÒÏÅ•êËÅπ’µâï»ÏÅùΩΩù±ï}ïŸïπ—}•êËÅÕ—…•πúÅÙ¯†§Ï4(ÄÄÄÄÄÅçΩπÕ–Åï·Öç–ÄÙÅçÖπë•ëÖ—ïÃπ…ïÕ’±—Ãπô•±—ï»†°çÖπë•ëÖ—îËÅÏÅ•êËÅπ’µâï»ÏÅùΩΩù±ï}ïŸïπ—}•êËÅÕ—…•πúÅÙ§ÄÙ¯ÅçÖπë•ëÖ—îπùΩΩù±ï}ïŸïπ—}•êÄÙÙÙÅïŸïπ–π•ê§Ï4(ÄÄÄÄÄÅçΩπÕ–Å’π±•π≠ïêÄÙÅçÖπë•ëÖ—ïÃπ…ïÕ’±—Ãπô•±—ï»†°çÖπë•ëÖ—îËÅÏÅ•êËÅπ’µâï»ÏÅùΩΩù±ï}ïŸïπ—}•êËÅÕ—…•πúÅÙ§ÄÙ¯ÄÖçÖπë•ëÖ—îπùΩΩù±ï}ïŸïπ—}•ê¸π—…•¥†§§Ï4(ÄÄÄÄÄÅçΩπÕ–ÅµÖ—ç°ïêÄÙÅï·Öç–π±ïπù—†ÄÙÙÙÄƒÄ¸Åï·Öç—l¡tÄËÅï·Öç–π±ïπù—†ÄÙÙÙÄ¿ÄòòÅ’π±•π≠ïêπ±ïπù—†ÄÙÙÙÄƒÄ¸Å’π±•π≠ïël¡tÄËÅπ’±∞Ï4(ÄÄÄÄÄÅ•òÄ°µÖ—ç°ïê§ÅÏ4(ÄÄÄÄÄÄÄÅÖ›Ö•–Åêƒπ¡…ï¡Ö…î†4(ÄÄÄÄÄÄÄÄÄÅÅUAQÅΩ…ùÖπ•ÈÖ—•Ωπ}Õç°ïë’±ïÃ4(ÄÄÄÄÄÄÄÄÄÄÅMPÅùΩΩù±ï}ïŸïπ—}•êÄÙÄ¸∞ÅùΩΩù±ï}ïŸïπ—}ï—ÖúÄÙÄ¸∞ÅùΩΩù±ï}’¡ëÖ—ïë}Ö–ÄÙÄ¸∞ÅùΩΩù±ï}Ω…•ù•∏ÄÙÄ¿∞4(ÄÄÄÄÄÄÄÄÄÄÄÄÄÄÅÕÂπç}Õ—Ö—’ÃÄÙÄù¡ïπë•πúú∞ÅÕÂπç}Ω¡ï…Ö—•Ω∏ÄÙÄù’¡Õï…–ú∞ÅÕÂπç}ï……Ω»ÄÙÄúú4(ÄÄÄÄÄÄÄÄÄÄÅ]!IÅ•êÄÙÄ˝Ä∞4(ÄÄÄÄÄÄÄÄ§πâ•πê°ïŸïπ–π•ê∞ÅïŸïπ–πï—ÖúÅÒÄàà∞ÅïŸïπ–π’¡ëÖ—ïêÅÒÄàà∞ÅµÖ—ç°ïêπ•ê§π…’∏†§Ï4(ÄÄÄÄÄÄÄÅôΩ…çïëIïô…ïÕ°%ëÃπÖëê°9’µâï»°µÖ—ç°ïêπ•ê§§Ï4(ÄÄÄÄÄÄÄÅçΩπ—•π’îÏ4(ÄÄÄÄÄÅÙ4(ÄÄÄÅÙ4(ÄÄÄÅçΩπÕ–Åëïë’¡ï-ï‰ÄÙÅÄëÌïŸïπ–π•ëıq‘¿¿≈òëÌŸÖ±’ïÃπÕç°ïë’±ïëÖ—ïıÄÏ4(ÄÄÄÅ•òÄ†ÖŸÖ±’ïÃπÕç°ïë’±ïëÖ—îÅÒÅÕïïπIïÖëΩπ±‰π°ÖÃ°ëïë’¡ï-ï‰§§ÅçΩπ—•π’îÏ4(ÄÄÄÅÕïïπIïÖëΩπ±‰πÖëê°ëïë’¡ï-ï‰§Ï4(ÄÄÄÅ…ïÖëΩπ±‰π¡’Õ†°Ï4(ÄÄÄÄÄÅ•êËÅÅùΩΩù±îËëÌëïë’¡ï-ïÂıÄ∞4(ÄÄÄÄÄÅΩ…ùÖπ•ÈÖ—•Ω∏ËÅÕ’ùùïÕ—ïë=…ùÖπ•ÈÖ—•Ω∏°ïŸïπ–§ÅÒÄâΩΩù±îÅÖ±ïπëÖ»à∞4(ÄÄÄÄÄÅâ’Õ•πïÕÕIΩ’πêËÄ¿∞4(ÄÄÄÄÄÅ±Öâï∞ËÅïŸïπ–πÕ’µµÖ…‰ÅÒÄã≤r≤ö#≤^É≤vÛ≤ÇTà∞4(ÄÄÄÄÄÅçÖ—ïùΩ…‰ËÄâùΩΩù±îà∞4(ÄÄÄÄÄÅÕç°ïë’±ïëÖ—îËÅŸÖ±’ïÃπÕç°ïë’±ïëÖ—î∞4(ÄÄÄÄÄÅÕ—Ö…—Q•µîËÅŸÖ±’ïÃπÕ—Ö…—Q•µî∞4(ÄÄÄÄÄÅïπëQ•µîËÅŸÖ±’ïÃπïπëQ•µî∞4(ÄÄÄÄÄÅïπëÖ—îËÅŸÖ±’ïÃπïπëÖ—îÅÒÅŸÖ±’ïÃπÕç°ïë’±ïëÖ—î∞4(ÄÄÄÄÄÅŸ•Õ•â•±•—‰ËÄâÕ°Ö…ïêµ¡ΩÕ–µÖ›Ö…êà∞4(ÄÄÄÄÄÅÖÕÕ•ùπïï9ÖµîËÄã≤r≤ö#≤^É™Œ◊≤rÉ≤vÛ≤ÇTà∞4(ÄÄÄÄÄÅÖÕÕ•ùπïï5ïµâï…%êËÅπ’±∞∞4(ÄÄÄÄÄÅïë•—Öâ±îËÅôÖ±Õî∞4(ÄÄÄÄÄÅï·—ï…πÖ±U…∞ËÅïŸïπ–π°—µ±1•π¨ÅÒÄâ°——¡ÃËºΩçÖ±ïπëÖ»πùΩΩù±îπçΩ¥ΩçÖ±ïπëÖ»Ω‘º¿Ω»à∞4(ÄÄÄÄÄÅëï—Ö•±ÃËÅïŸïπ–πëïÕç…•¡—•Ω∏ÅÒÄàà∞4(ÄÄÄÄÄÅ’¡ëÖ—ïë–ËÅïŸïπ–π’¡ëÖ—ïêÅÒÄàà∞4(ÄÄÄÄÄÅ’¡ëÖ—ïë	Â9ÖµîËÄâΩΩù±îÅÖ±ïπëÖ»à∞4(ÄÄÄÄÄÅçΩπô±•ç–ËÅôÖ±Õî∞4(ÄÄÄÄÄÅÕÂπçM—Ö—’ÃËÄâ…ïÖëΩπ±‰à∞4(ÄÄÄÄÄÅÕÂπç……Ω»ËÄàà∞4(ÄÄÄÄÄÅÕÂπç——ïµ¡—ÃËÄ¿∞4(ÄÄÄÄÄÅùΩΩù±ïŸïπ—%êËÅïŸïπ–π•ê∞4(ÄÄÄÄÄÅÕ’ùùïÕ—ïëÖ—ïùΩ…‰ËÅùΩΩù±ïM—…’ç—’…ïëïÕç…•¡—•Ω∏°ïŸïπ–πëïÕç…•¡—•Ω∏ÅÒÄàà§πçΩπÕ—…’ç—•ΩπM—ÖùîÄ¸ÄâçΩπÕ—…’ç—•Ω∏àÄËÄâΩ—°ï»à∞4(ÄÄÄÅÙ§Ï4(ÄÅÙ4(ÄÅ•òÄ°ôΩ…çïëIïô…ïÕ°%ëÃπÕ•Èî§ÅÏ4(ÄÄÄÅÖ›Ö•–Åô±’Õ°ΩΩù±ïÖ±ïπëÖ…MÂπå°ÏÅ•ëÃËÅl∏∏πôΩ…çïëIïô…ïÕ°%ëÕtÅÙ§Ï4(ÄÅÙ4(ÄÅ…ï—’…∏ÅÏÄ∏∏π…ïÕ’±–∞Å…ïÖë=π±ÂŸïπ—ÃËÅ…ïÖëΩπ±‰ÅÙÏ4)Ù4