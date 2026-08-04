import "server-only";

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
  details: string;
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

function readGoogleCalendarConfig(): GoogleCalendarConfig | null {
  const calendarId = process.env.WHIZZUP_GOOGLE_CALENDAR_ID?.trim()
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

async function googleRequest(path: string, init?: RequestInit) {
  const config = readGoogleCalendarConfig();
  if (!config) throw new Error("Google Calendar 쓰기 연결 정보가 등록되지 않았습니다.");
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
  if (!response.ok) throw new Error(result.error?.message || `Google Calendar 요청에 실패했습니다. (${response.status})`);
  return result;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  const allDay = !schedule.startTime;
  const endDate = schedule.endDate && schedule.endDate >= schedule.scheduledDate
    ? schedule.endDate
    : schedule.scheduledDate;
  const start = allDay
    ? { date: schedule.scheduledDate }
    : { dateTime: `${schedule.scheduledDate}T${schedule.startTime}:00+09:00`, timeZone: "Asia/Seoul" };
  const fallbackEnd = schedule.endTime
    ? { date: endDate, time: schedule.endTime }
    : defaultTimedEnd(endDate, schedule.startTime);
  const end = allDay
    ? { date: addDays(endDate, 1) }
    : { dateTime: `${fallbackEnd.date}T${fallbackEnd.time}:00+09:00`, timeZone: "Asia/Seoul" };
  const category = schedule.category === "general" && /^영업\s*[·•-]\s*/.test(schedule.label)
    ? "sales"
    : schedule.category;
  const categoryLabel: Record<string, string> = {
    sales: "영업",
    meeting: "회의",
    construction: "시공",
    showroom: "쇼룸",
    other: "기타",
  };
  const colorId: Record<string, string> = {
    sales: "9",
    meeting: "3",
    construction: "6",
    showroom: "4",
    other: "8",
  };
  const cleanLabel = schedule.label
    .replace(/^(영업|회의|시공|쇼룸|기타)\s*[·•-]\s*/, "")
    .trim() || "일정";
  const summary = `[${categoryLabel[category] || "기타"}] ${schedule.organization} · ${cleanLabel}`;
  const description = [
    `담당자: ${schedule.assigneeName.trim() || "미정"}`,
    `일정 내용: ${cleanLabel}`,
    schedule.details.trim(),
  ].filter(Boolean).join("\n");
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
  return await googleRequest(path, {
    method,
    body: JSON.stringify(eventBody(schedule)),
  }) as unknown as GoogleCalendarApiEvent;
}

export async function findGoogleCalendarEventByScheduleId(scheduleId: number) {
  const params = new URLSearchParams({
    privateExtendedProperty: `whizzupScheduleId=${scheduleId}`,
    showDeleted: "true",
    maxResults: "10",
  });
  const result = await googleRequest(`/events?${params}`) as { items?: GoogleCalendarApiEvent[] };
  return (result.items || []).find((event) => event.status !== "cancelled") || null;
}

export async function getGoogleCalendarEvent(googleEventId: string) {
  if (!googleEventId) throw new Error("Google 일정을 선택해 주세요.");
  return await googleRequest(`/events/${encodeURIComponent(googleEventId)}`) as unknown as GoogleCalendarApiEvent;
}

export async function deleteGoogleCalendarEvent(googleEventId: string) {
  if (!googleEventId) return;
  try {
    await googleRequest(`/events/${encodeURIComponent(googleEventId)}?sendUpdates=none`, { method: "DELETE" });
  } catch (error) {
    if (error instanceof Error && /410|404|not found|gone/i.test(error.message)) return;
    throw error;
  }
}

export async function listGoogleCalendarApiEvents(start: string, end: string) {
  if (!readGoogleCalendarConfig()) {
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
    const result = await googleRequest(`/events?${params}`) as { items?: GoogleCalendarApiEvent[] };
    return { configured: true, connected: true, events: Array.isArray(result.items) ? result.items : [], error: "" };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      events: [] as GoogleCalendarApiEvent[],
      error: error instanceof Error ? error.message : "Google Calendar 연결에 실패했습니다.",
    };
  }
}
