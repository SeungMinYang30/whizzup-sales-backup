export type CalendarScheduleLike = Record<string, unknown> & {
  id?: number | string;
  organization?: unknown;
  businessRound?: unknown;
  label?: unknown;
  category?: unknown;
  scheduledDate?: unknown;
  endDate?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  sourceActivityId?: unknown;
  originScheduleId?: unknown;
  googleEventId?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function compact(value: unknown) {
  return text(value).replace(/[\s·•._()\-]/g, "").toLocaleLowerCase("ko-KR");
}

function positiveId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : "";
}

function normalizedDate(value: unknown) {
  const raw = text(value);
  const matched = raw.match(/^\d{4}-\d{2}-\d{2}/);
  return matched?.[0] ?? "";
}

function normalizedTime(value: unknown) {
  const raw = text(value);
  const matched = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!matched) return "";
  return `${matched[1].padStart(2, "0")}:${matched[2]}`;
}

function normalizedRound(value: unknown) {
  const round = Number(value);
  return Number.isSafeInteger(round) && round >= 0 ? String(round) : "0";
}

function normalizedCategory(value: unknown) {
  const category = text(value).toLocaleLowerCase("ko-KR");
  if (category === "general") return "sales";
  return category || "sales";
}

function normalizedSemanticLabel(schedule: CalendarScheduleLike) {
  const organization = compact(schedule.organization);
  const administrativeFreeOrganization = organization.replace(
    /(특별자치도|특별자치시|광역시|특별시|도|시|군|구)/g,
    "",
  );
  const label = text(schedule.label)
    .replace(/^\[[^\]]{1,20}\]\s*/, "")
    .replace(/^(영업|회의|시공|쇼룸|기타|내\s*일정)\s*[·:]\s*/, "");
  return compact(label)
    .replace(organization, "")
    .replace(administrativeFreeOrganization, "");
}

export function normalizeCalendarSchedule(schedule: CalendarScheduleLike) {
  const scheduledDate = normalizedDate(schedule.scheduledDate);
  return {
    institution: compact(schedule.organization),
    businessRound: normalizedRound(schedule.businessRound),
    category: normalizedCategory(schedule.category),
    semanticLabel: normalizedSemanticLabel(schedule),
    scheduledDate,
    endDate: normalizedDate(schedule.endDate) || scheduledDate,
    startTime: normalizedTime(schedule.startTime),
    endTime: normalizedTime(schedule.endTime),
    sourceActivityId: positiveId(schedule.sourceActivityId),
    originScheduleId: positiveId(schedule.originScheduleId),
    googleEventId: text(schedule.googleEventId),
    id: text(schedule.id),
  };
}

function occurrenceKey(schedule: CalendarScheduleLike) {
  const value = normalizeCalendarSchedule(schedule);
  return [
    value.institution,
    value.businessRound,
    value.semanticLabel,
    value.scheduledDate,
    value.endDate,
    value.startTime,
    value.endTime,
  ].join("\u001f");
}

function externalIdentityKey(schedule: CalendarScheduleLike) {
  const value = normalizeCalendarSchedule(schedule);
  if (value.googleEventId) return `google\u001f${value.googleEventId}`;
  if (value.originScheduleId) return `origin\u001f${value.originScheduleId}`;
  return "";
}

function scheduleSortKey(schedule: CalendarScheduleLike) {
  const value = normalizeCalendarSchedule(schedule);
  const priority = value.category === "construction" ? "0" : value.category === "google" ? "2" : "1";
  return [
    value.scheduledDate,
    value.startTime || "00:00",
    priority,
    value.institution,
    value.businessRound,
    value.semanticLabel,
    value.endDate,
    value.id,
  ].join("\u001f");
}

function isConstructionReplacement(
  possibleSales: CalendarScheduleLike,
  construction: CalendarScheduleLike,
) {
  const sales = normalizeCalendarSchedule(possibleSales);
  const work = normalizeCalendarSchedule(construction);
  if (sales.category === "construction" || work.category !== "construction") return false;
  if (!sales.sourceActivityId || sales.sourceActivityId !== work.sourceActivityId) return false;
  if (sales.institution !== work.institution || sales.businessRound !== work.businessRound) return false;
  return sales.semanticLabel === work.semanticLabel
    && sales.scheduledDate === work.scheduledDate
    && sales.endDate === work.endDate
    && sales.startTime === work.startTime
    && sales.endTime === work.endTime;
}

/**
 * Produces the same calendar result regardless of API arrival order.
 *
 * Only a schedule with a shared source/origin identity can replace a sales
 * entry with a construction entry. Institution name and date alone are never
 * enough, because a real sales visit and construction work can occur together.
 */
export function mergeCalendarSchedules<T extends CalendarScheduleLike>(
  ...groups: Array<readonly T[] | null | undefined>
) {
  const ordered = groups.flatMap((group) => group ?? []).sort((left, right) =>
    scheduleSortKey(left).localeCompare(scheduleSortKey(right), "ko-KR"));
  const external = new Map<string, T>();
  const local = new Map<string, T>();

  for (const schedule of ordered) {
    const identity = externalIdentityKey(schedule);
    if (identity) {
      const previous = external.get(identity);
      if (!previous || normalizeCalendarSchedule(schedule).category !== "google") {
        external.set(identity, schedule);
      }
      continue;
    }
    const key = `${normalizedCategory(schedule.category)}\u001f${occurrenceKey(schedule)}`;
    if (!local.has(key)) local.set(key, schedule);
  }

  const candidates = [...local.values(), ...external.values()];
  const construction = candidates.filter(
    (schedule) => normalizeCalendarSchedule(schedule).category === "construction",
  );
  return candidates
    .filter((schedule) => !construction.some((work) => work !== schedule && isConstructionReplacement(schedule, work)))
    .sort((left, right) => scheduleSortKey(left).localeCompare(scheduleSortKey(right), "ko-KR"));
}

