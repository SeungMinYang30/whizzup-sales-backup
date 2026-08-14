import "server-only";
import { googleCalendarTitle, removeOriginalGoogleTitleNote } from "./google-calendar-title";

export type GoogleCalendarApiEvent = {
  id: string;
  etag: string;
  status: string;
  summary: string;
  location: string;
  description: string;
  htmlLink: string;
  updated: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
};

export type GoogleCalendarWriteSchedule = {
  id: number;
  organization: string;
  businessRound: number;
  label: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  endDate: string;
  category: string;
  content: string;
  details: string;
  constructionStage?: string;
  vendorName?: string;
  productSummary?: string;
  assigneeMemberId: number | null;
  assigneeName: string;
};

type ServiceAccount = { client_email?: string; private_key?: string };
type GoogleCalendarConfig = {
  calendarId: string;
  clientEmail: string;
  privateKey: string;
};

let tokenCache: { accessToken: string; expiresAt: number } | null = null;

function base64Url(bytes: Uint8Array | string) {
  const source = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  source.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemBytes(value: string) {
  const normalized = value.replace(/\\n/g, "\n");
  const encoded = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function calendarIdFromIcsUrl(value: string) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const icalIndex = parts.findIndex((part) => part.toLowerCase() === "ical");
    return icalIndex >= 0 && parts[icalIndex + 1]
      ? decodeURIComponent(parts[icalIndex + 1])
      : "";
  } catch {
    return "";
  }
}

export function googleCalendarApiConfigured() {
  return Boolean(readGoogleCalendarConfig());
}

export function googleConstructionCalendarApiConfigured() {
  return Boolean(readGoogleCalendarConfig("construction"));
}

function readGoogleCalendarConfig(category = "general"): GoogleCalendarConfig | null {
  const calendarId = category === "construction"
    ? process.env.WHIZZUP_GOOGLE_CONSTRUCTION_CALENDAR_ID?.trim()
    : process.env.WHIZZUP_GOOGLE_CALENDAR_ID?.trim()
      || calendarIdFromIcsUrl(process.env.WHIZZUP_GOOGLE_CALENDAR_ICS_URL?.trim() || "");
  const raw = process.env.WHIZZUP_GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON?.trim();
  if (!calendarId || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    const clientEmail = parsed.client_email?.trim() || "";
    const privateKey = parsed.private_key?.trim() || "";
    return clientEmail && privateKey ? { calendarId, clientEmail, privateKey } : null;
  } catch {
    return null;
  }
}

async function accessToken(config: GoogleCalendarConfig) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.accessToken;
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: config.clientEmail,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3_600,
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(config.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || "Google Calendar 인증에 실패했습니다.");
  }
  tokenCache = {
    accessToken: result.access_token,
    expiresAt: Date.now() + Math.max(300, Number(result.expires_in) || 3_600) * 1_000,
  };
  return tokenCache.accessToken;
}

async function googleRequest(path: string, init?: RequestInit, category = "general") {
  const config = readGoogleCalendarConfig(category);
  if (!config) throw new Error(category === "construction"
    ? "Google '위즈업 시공' 캘린더 연결 정보가 등록되지 않았습니다."
    : "Google Calendar 쓰기 연결 정보가 등록되지 않았습니다.");
  const token = await accessToken(config);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers || {}),
      },
    },
  );
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({})) as {
    error?: { message?: string };
    [key: string]: unknown;
  };
  if (!response.ok) {
    const message = result.error?.message || "Google Calendar 요청에 실패했습니다.";
    throw new Error(`${message} (Google Calendar ${response.status})`);
  }
  return result;
}

function isMissingGoogleResource(error: unknown) {
  return error instanceof Error
    && /Google Calendar (404|410)|not found|gone|resource has been deleted/i.test(error.message);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function normalizeGoogleCalendarTime(value: unknown) {
  const raw = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR");
  if (!raw) return "";

  const korean = raw.match(/^(오전|오후)\s*(\d{1,2})(?:\s*시)?(?:\s*(\d{1,2})\s*분?)?$/);
  if (korean) {
    let hour = Number(korean[2]);
    const minute = Number(korean[3] || 0);
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return "";
    if (korean[1] === "오전" && hour === 12) hour = 0;
    if (korean[1] === "오후" && hour !== 12) hour += 12;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const numeric = raw.match(/^(\d{1,2})\s*[:시]\s*(\d{1,2})(?:\s*분)?(?::\d{1,2})?$/);
  if (!numeric) return "";
  const hour = Number(numeric[1]);
  const minute = Number(numeric[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function defaultTimedEnd(dateValue: string, timeValue: string) {
  const [hour, minute] = timeValue.split(":").map(Number);
  const total = (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0) + 60;
  return {
    date: total >= 1_440 ? addDays(dateValue, 1) : dateValue,
    time: `${String(Math.floor((total % 1_440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
  };
}

function eventBody(schedule: GoogleCalendarWriteSchedule) {
  const startTime = normalizeGoogleCalendarTime(schedule.startTime);
  const endTime = startTime ? normalizeGoogleCalendarTime(schedule.endTime) : "";
  const allDay = !startTime;
  const endDate = schedule.endDate && schedule.endDate >= schedule.scheduledDate
    ? schedule.endDate
    : schedule.scheduledDate;
  const start = allDay
    ? { date: schedule.scheduledDate }
    : { dateTime: `${schedule.scheduledDate}T${startTime}:00+09:00`, timeZone: "Asia/Seoul" };
  const fallbackEnd = endTime
    ? { date: endDate, time: endTime }
    : defaultTimedEnd(endDate, startTime);
  const end = allDay
    ? { date: addDays(endDate, 1) }
    : { dateTime: `${fallbackEnd.date}T${fallbackEnd.time}:00+09:00`, timeZone: "Asia/Seoul" };
  const title = googleCalendarTitle(schedule);
  const category = title.category;
  const colorId: Record<string, string> = {
    sales: "9",
    meeting: "3",
    construction: "6",
    showroom: "4",
    other: "8",
  };
  const required = (value: string | undefined) => value?.trim() || "-";
  const summary = title.summary;
  const descriptionLines = [
    `담당자: ${required(schedule.assigneeName)}`,
    `내용: ${required(schedule.content)}`,
  ];
  const memo = removeOriginalGoogleTitleNote(schedule.details || "").trim();
  if (memo) descriptionLines.push(`메모: ${memo}`);
  const description = descriptionLines.join("\n");
  return {
    summary,
    location: schedule.organization,
    description,
    start,
    end,
    colorId: colorId[category] || colorId.other,
    extendedProperties: {
      private: {
        whizzupSource: "site",
        whizzupScheduleId: String(schedule.id),
        whizzupCategory: schedule.category,
        whizzupOrganization: schedule.organization,
        whizzupBusinessRound: String(schedule.businessRound),
        whizzupAssigneeMemberId: schedule.assigneeMemberId ? String(schedule.assigneeMemberId) : "",
        whizzupAssigneeName: schedule.assigneeName,
      },
    },
  };
}

export async function upsertGoogleCalendarEvent(
  schedule: GoogleCalendarWriteSchedule,
  googleEventId = "",
) {
  const method = googleEventId ? "PATCH" : "POST";
  const path = googleEventId
    ? `/events/${encodeURIComponent(googleEventId)}?sendUpdates=none`
    : "/events?sendUpdates=none";
  try {
    return await googleRequest(path, {
      method,
      body: JSON.stringify(eventBody(schedule)),
    }, schedule.category) as unknown as GoogleCalendarApiEvent;
  } catch (error) {
    if (!googleEventId || !isMissingGoogleResource(error)) throw error;
    return await googleRequest("/events?sendUpdates=none", {
      method: "POST",
      body: JSON.stringify(eventBody(schedule)),
    }, schedule.category) as unknown as GoogleCalendarApiEvent;
  }
}

export async function findGoogleCalendarEventByScheduleId(scheduleId: number, category = "general") {
  const params = new URLSearchParams({
    privateExtendedProperty: `whizzupScheduleId=${scheduleId}`,
    showDeleted: "true",
    maxResults: "10",
  });
  const result = await googleRequest(`/events?${params}`, undefined, category) as { items?: GoogleCalendarApiEvent[] };
  return (result.items || []).find((event) => event.status !== "cancelled") || null;
}

export async function getGoogleCalendarEvent(googleEventId: string, category = "general") {
  if (!googleEventId) throw new Error("Google 일정을 선택해 주세요.");
  return await googleRequest(`/events/${encodeURIComponent(googleEventId)}`, undefined, category) as unknown as GoogleCalendarApiEvent;
}

export async function deleteGoogleCalendarEvent(googleEventId: string, category = "general") {
  if (!googleEventId) return;
  try {
    await googleRequest(`/events/${encodeURIComponent(googleEventId)}?sendUpdates=none`, { method: "DELETE" }, category);
  } catch (error) {
    if (isMissingGoogleResource(error)) return;
    throw error;
  }
}

export async function listGoogleCalendarApiEvents(start: string, end: string, category = "general") {
  if (!readGoogleCalendarConfig(category)) {
    return { configured: false, connected: false, events: [] as GoogleCalendarApiEvent[], error: "" };
  }
  try {
    const params = new URLSearchParams({
      timeMin: `${start}T00:00:00+09:00`,
      timeMax: `${addDays(end, 1)}T00:00:00+09:00`,
      singleEvents: "true",
      showDeleted: "true",
      maxResults: "2500",
      timeZone: "Asia/Seoul",
    });
    const result = await googleRequest(`/events?${params}`, undefined, category) as { items?: GoogleCalendarApiEvent[] };
    return { configured: true, connected: true, events: Array.isArray(result.items) ? result.items : [], error: "" };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      events: [] as GoogleCalendarApiEvent[],
      error: error instanceof Error ? error.message : category === "construction"
        ? "Google '위즈업 시공' 캘린더 연결에 실패했습니다."
        : "Google Calendar 연결에 실패했습니다.",
    };
  }
}
