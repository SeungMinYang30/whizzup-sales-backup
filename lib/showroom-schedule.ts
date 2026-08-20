export type DetectedShowroomSchedule = {
  label: string;
  date: string;
  startTime: string;
  endTime: string;
};

const showroomKeywordPattern = /(?:시연|데모|체험)/;
const koreanDatePattern = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
const koreanTimePattern = /(오전|오후)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/;
const clockTimePattern = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;

export function isShowroomScheduleLabel(value: unknown) {
  return showroomKeywordPattern.test(String(value ?? "").trim());
}

function validDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function plusOneHour(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour >= 23) return "";
  return `${String(hour + 1).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractTime(text: string) {
  const korean = text.match(koreanTimePattern);
  if (korean) {
    let hour = Number(korean[2]);
    const minute = Number(korean[3] || 0);
    if (hour < 1 || hour > 12 || minute > 59) return { startTime: "", endTime: "" };
    if (korean[1] === "오전" && hour === 12) hour = 0;
    if (korean[1] === "오후" && hour < 12) hour += 12;
    const startTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return { startTime, endTime: plusOneHour(startTime) };
  }
  const clock = text.match(clockTimePattern);
  if (!clock) return { startTime: "", endTime: "" };
  const startTime = `${String(Number(clock[1])).padStart(2, "0")}:${clock[2]}`;
  return { startTime, endTime: plusOneHour(startTime) };
}

function showroomLabel(text: string) {
  const cleaned = text
    .replace(koreanDatePattern, " ")
    .replace(koreanTimePattern, " ")
    .replace(clockTimePattern, " ")
    .replace(/(?:예정되어\s*있습니다|예정입니다|진행됩니다|진행합니다|일정입니다)/g, " ")
    .replace(/^[\s,;:|/\-]*(?:(?:에는?|부터|에서)\s+)?/u, "")
    .replace(/[\s,;:|/\-]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  const matched = cleaned.match(/([가-힣A-Za-z0-9][가-힣A-Za-z0-9 .()_\-]{0,50}?)\s*(시연|데모|체험)/);
  if (!matched) return cleaned.match(showroomKeywordPattern)?.[0] || "시연";
  const subject = matched[1]
    .replace(/^(?:안녕하세요|차후\s*일정\s*말씀드립니다)\s*/u, "")
    .replace(/(?:에는?|에서|의)\s*$/u, "")
    .trim();
  return `${subject ? `${subject} ` : ""}${matched[2]}`.slice(0, 120);
}

export function extractShowroomSchedulesFromText(
  value: unknown,
  today: string,
): DetectedShowroomSchedule[] {
  const text = String(value ?? "").trim();
  const currentYear = Number(today.slice(0, 4));
  if (!text || !Number.isInteger(currentYear) || !isShowroomScheduleLabel(text)) return [];

  const unique = new Map<string, DetectedShowroomSchedule>();
  text.split(/(?<=[.!?。])\s+|\r?\n/).forEach((part) => {
    if (!isShowroomScheduleLabel(part)) return;
    const dateMatch = part.match(koreanDatePattern);
    if (!dateMatch) return;
    const year = Number(dateMatch[1] || currentYear);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    if (!validDate(year, month, day)) return;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const label = showroomLabel(part);
    const { startTime, endTime } = extractTime(part);
    unique.set(`${date}\u001f${label.toLocaleLowerCase("ko-KR")}`, {
      label,
      date,
      startTime,
      endTime,
    });
  });
  return [...unique.values()];
}
