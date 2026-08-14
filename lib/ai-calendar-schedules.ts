export type AiCalendarSchedule = {
  organization: string;
  region: string;
  label: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  details: string;
  assigneeName: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function scheduleInstitutionKey(value: unknown) {
  return clean(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function oneHourAfter(value: string) {
  if (!TIME_PATTERN.test(value)) return "";
  const [hour, minute] = value.split(":").map(Number);
  return `${String((hour + 1) % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeAiCalendarSchedules(
  values: unknown,
): AiCalendarSchedule[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const normalized: AiCalendarSchedule[] = [];

  for (const rawValue of values.slice(0, 50)) {
    if (!rawValue || typeof rawValue !== "object") continue;
    const raw = rawValue as Record<string, unknown>;
    const organization = clean(raw.organization);
    const scheduledDate = clean(raw.scheduledDate);
    const label = clean(raw.label);
    const startTime = clean(raw.startTime);
    const suppliedEndTime = clean(raw.endTime);
    if (
      !organization ||
      !label ||
      !DATE_PATTERN.test(scheduledDate) ||
      (startTime && !TIME_PATTERN.test(startTime)) ||
      (suppliedEndTime && !TIME_PATTERN.test(suppliedEndTime))
    ) {
      continue;
    }

    const endTime = suppliedEndTime || oneHourAfter(startTime);
    const dedupeKey = [
      scheduleInstitutionKey(organization),
      scheduledDate,
      startTime,
      label.toLocaleLowerCase("ko-KR"),
    ].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    normalized.push({
      organization,
      region: clean(raw.region),
      label,
      scheduledDate,
      startTime,
      endTime,
      details: clean(raw.details),
      assigneeName: clean(raw.assigneeName),
    });
  }

  return normalized;
}
