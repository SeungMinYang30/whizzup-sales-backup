import "server-only";

export type GoogleCalendarSchedule = {
  id: string;
  organization: string;
  businessRound: number;
  label: string;
  category: "google";
  scheduledDate: string;
  endDate: string;
  visibility: "shared-post-award";
  assigneeName: string;
  assigneeMemberId: null;
  editable: false;
  updatedAt: string;
  updatedByName: string;
  conflict: false;
};

let cached: { expires: number; events: GoogleCalendarSchedule[] } | null = null;

function valueOf(lines: string[], name: string) {
  const line = lines.find((item) => item.split(":", 1)[0].split(";", 1)[0] === name);
  return line ? line.slice(line.indexOf(":") + 1) : "";
}

function unescapeIcs(value: string) {
  return value.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function dateOnly(value: string) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function previousDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function loadEvents() {
  if (cached && cached.expires > Date.now()) return cached.events;
  const url = process.env.WHIZZUP_GOOGLE_CALENDAR_ICS_URL?.trim();
  if (!url) return [];
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("구글 공유일정을 불러오지 못했습니다.");
  const text = (await response.text()).replace(/\r?\n[ \t]/g, "");
  const events = [...text.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/g)].flatMap((match) => {
    const lines = match[1].split(/\r?\n/);
    const start = dateOnly(valueOf(lines, "DTSTART"));
    if (!start) return [];
    const rawEnd = dateOnly(valueOf(lines, "DTEND"));
    const allDay = lines.some((line) => line.startsWith("DTSTART;VALUE=DATE"));
    const end = rawEnd ? (allDay && rawEnd > start ? previousDay(rawEnd) : rawEnd) : start;
    const summary = unescapeIcs(valueOf(lines, "SUMMARY")) || "구글 캘린더 일정";
    const location = unescapeIcs(valueOf(lines, "LOCATION"));
    const uid = unescapeIcs(valueOf(lines, "UID")) || `${summary}-${start}`;
    return [{
      id: `google:${uid}:${start}`,
      organization: location || summary,
      businessRound: 0,
      label: summary,
      category: "google" as const,
      scheduledDate: start,
      endDate: end || start,
      visibility: "shared-post-award" as const,
      assigneeName: "위즈업 공유일정",
      assigneeMemberId: null,
      editable: false as const,
      updatedAt: "",
      updatedByName: "Google Calendar",
      conflict: false as const,
    }];
  });
  cached = { expires: Date.now() + 5 * 60_000, events };
  return events;
}

export async function listGoogleCalendarSchedules(start: string, end: string) {
  const configured = Boolean(process.env.WHIZZUP_GOOGLE_CALENDAR_ICS_URL?.trim());
  if (!configured) return { configured, connected: false, events: [] as GoogleCalendarSchedule[] };
  try {
    const events = (await loadEvents()).filter((item) => item.scheduledDate <= end && item.endDate >= start);
    return { configured, connected: true, events };
  } catch {
    return { configured, connected: false, events: [] as GoogleCalendarSchedule[] };
  }
}
