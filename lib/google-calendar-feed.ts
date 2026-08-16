import "server-only";

export type GoogleCalendarSchedule = {
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
  updatedByName: string;
  conflict: false;
  googleEventId: string;
};

type ParsedDate = {
  date: string;
  time: string;
  allDay: boolean;
};

type CalendarEvent = {
  uid: string;
  summary: string;
  location: string;
  description: string;
  start: ParsedDate;
  end: ParsedDate;
  rrule: string;
  cancelled: boolean;
};

let cachedFeed: { expires: number; text: string } | null = null;

function property(lines: string[], name: string) {
  const prefix = `${name}`.toUpperCase();
  const line = lines.find((item) => {
    const key = item.slice(0, item.indexOf(":") < 0 ? item.length : item.indexOf(":"));
    return key.split(";", 1)[0].toUpperCase() === prefix;
  });
  if (!line) return { value: "", parameters: "" };
  const colon = line.indexOf(":");
  return {
    value: colon >= 0 ? line.slice(colon + 1) : "",
    parameters: (colon >= 0 ? line.slice(0, colon) : line).slice(name.length),
  };
}

function unescapeIcs(value: string) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function datePartsInSeoul(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

function parseCalendarDate(value: string, parameters = ""): ParsedDate | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00", utc] = match;
  const allDay = !hour || /VALUE=DATE(?:;|$)/i.test(parameters);
  if (allDay) return { date: `${year}-${month}-${day}`, time: "", allDay: true };
  if (utc) {
    const seoul = datePartsInSeoul(new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`));
    return { ...seoul, allDay: false };
  }
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}`, allDay: false };
}

function dateFromValue(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function dateValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = dateFromValue(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateValue(date);
}

function addMonths(value: string, months: number) {
  const date = dateFromValue(value);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(originalDay, lastDay));
  return dateValue(date);
}

function daySpan(start: string, end: string) {
  return Math.max(0, Math.round((dateFromValue(end).valueOf() - dateFromValue(start).valueOf()) / 86_400_000));
}

function eventLink(summary: string) {
  return `https://calendar.google.com/calendar/u/0/r/search?q=${encodeURIComponent(summary)}`;
}

export function normalizeGoogleCalendarEventId(value: string) {
  return value.trim().toLowerCase().replace(/@google\.com$/i, "");
}

function scheduleFromEvent(event: CalendarEvent, startDate: string, endDate: string): GoogleCalendarSchedule {
  return {
    id: `google:${event.uid}:${startDate}`,
    organization: event.location || event.summary,
    businessRound: 0,
    label: event.summary,
    category: "google",
    scheduledDate: startDate,
    startTime: event.start.time,
    endTime: event.end.allDay ? "" : event.end.time,
    endDate,
    visibility: "shared-post-award",
    assigneeName: "위즈업 공유일정",
    assigneeMemberId: null,
    editable: false,
    externalUrl: eventLink(event.summary),
    details: event.description,
    updatedAt: "",
    updatedByName: "Google Calendar",
    conflict: false,
    googleEventId: normalizeGoogleCalendarEventId(event.uid),
  };
}

function parseEvents(text: string) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  return [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/g)].flatMap((match) => {
    const lines = match[1].split(/\r?\n/);
    const startProperty = property(lines, "DTSTART");
    const endProperty = property(lines, "DTEND");
    const start = parseCalendarDate(startProperty.value, startProperty.parameters);
    if (!start) return [];
    let end = parseCalendarDate(endProperty.value, endProperty.parameters) || start;
    if (start.allDay && end.allDay && end.date > start.date) end = { ...end, date: addDays(end.date, -1) };
    const summary = unescapeIcs(property(lines, "SUMMARY").value) || "구글 캘린더 일정";
    return [{
      uid: unescapeIcs(property(lines, "UID").value) || `${summary}-${start.date}`,
      summary,
      location: unescapeIcs(property(lines, "LOCATION").value),
      description: unescapeIcs(property(lines, "DESCRIPTION").value),
      start,
      end,
      rrule: property(lines, "RRULE").value,
      cancelled: property(lines, "STATUS").value.toUpperCase() === "CANCELLED",
    } satisfies CalendarEvent];
  });
}

function recurrenceDates(event: CalendarEvent, rangeStart: string, rangeEnd: string) {
  if (!event.rrule) return [event.start.date];
  const rule = Object.fromEntries(event.rrule.split(";").map((part) => {
    const [key, ...rest] = part.split("=");
    return [key.toUpperCase(), rest.join("=")];
  }));
  const frequency = rule.FREQ;
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const count = Math.max(0, Number(rule.COUNT) || 0);
  const until = parseCalendarDate(rule.UNTIL || "")?.date || rangeEnd;
  const hardEnd = until < rangeEnd ? until : rangeEnd;
  const dates: string[] = [];
  let generated = 0;

  if (frequency === "WEEKLY" && rule.BYDAY) {
    const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const wanted = rule.BYDAY.split(",").map((day) => dayMap[day.slice(-2)]).filter((day) => day !== undefined);
    let cursor = event.start.date;
    while (cursor <= hardEnd && generated < 5_000) {
      const elapsed = daySpan(event.start.date, cursor);
      const week = Math.floor(elapsed / 7);
      const weekday = dateFromValue(cursor).getUTCDay();
      if (week % interval === 0 && wanted.includes(weekday)) {
        generated += 1;
        if ((!count || generated <= count) && cursor >= event.start.date && cursor >= rangeStart) dates.push(cursor);
        if (count && generated >= count) break;
      }
      cursor = addDays(cursor, 1);
    }
    return dates;
  }

  let cursor = event.start.date;
  while (cursor <= hardEnd && generated < 5_000) {
    generated += 1;
    if (cursor >= rangeStart) dates.push(cursor);
    if (count && generated >= count) break;
    if (frequency === "DAILY") cursor = addDays(cursor, interval);
    else if (frequency === "WEEKLY") cursor = addDays(cursor, interval * 7);
    else if (frequency === "MONTHLY") cursor = addMonths(cursor, interval);
    else if (frequency === "YEARLY") cursor = addMonths(cursor, interval * 12);
    else break;
  }
  return dates;
}

async function loadFeed() {
  if (cachedFeed && cachedFeed.expires > Date.now()) return cachedFeed.text;
  const url = process.env.WHIZZUP_GOOGLE_CALENDAR_ICS_URL?.trim();
  if (!url) return "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("구글 공유일정을 불러오지 못했습니다.");
    const text = await response.text();
    cachedFeed = { expires: Date.now() + 5 * 60_000, text };
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listGoogleCalendarSchedules(start: string, end: string) {
  const configured = Boolean(process.env.WHIZZUP_GOOGLE_CALENDAR_ICS_URL?.trim());
  if (!configured) return { configured, connected: false, events: [] as GoogleCalendarSchedule[] };
  try {
    const parsed = parseEvents(await loadFeed()).filter((event) => !event.cancelled);
    const events = parsed.flatMap((event) => {
      const duration = daySpan(event.start.date, event.end.date);
      return recurrenceDates(event, addDays(start, -duration), end).flatMap((occurrence) => {
        const occurrenceEnd = addDays(occurrence, duration);
        if (occurrence > end || occurrenceEnd < start) return [];
        return [scheduleFromEvent(event, occurrence, occurrenceEnd)];
      });
    });
    events.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.startTime.localeCompare(b.startTime));
    return { configured, connected: true, events };
  } catch {
    return { configured, connected: false, events: [] as GoogleCalendarSchedule[] };
  }
}
