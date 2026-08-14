export type CalendarTitleInput = {
  organization: string;
  label: string;
  category: string;
  productSummary?: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scheduleTitleForGoogle(label: string) {
  return label
    .replace(/^(영업|회의|시공|쇼룸|기타|내 일정)\s*[·•-]\s*/u, "")
    .trim();
}

export function removeOriginalGoogleTitleNote(value: string) {
  return value
    .split(/\r?\n/)
    .filter((line) => !/^\s*원본\s+Google\s+제목\s*:/iu.test(line))
    .join("\n")
    .trim();
}

export function googleCalendarTitle(input: CalendarTitleInput) {
  const category = input.category === "general" && /^영업\s*[·•-]\s*/u.test(input.label)
    ? "sales"
    : input.category;
  const scheduleTitle = scheduleTitleForGoogle(input.label);
  const cleanLabel = scheduleTitle
    .replace(new RegExp(`^${escapeRegExp(input.organization)}\\s*[·•-]?\\s*`, "u"), "")
    .trim();
  const summary = category === "construction"
    ? `[시공] ${input.organization} · ${input.productSummary?.trim() || cleanLabel || scheduleTitle}`
    : scheduleTitle || input.organization;
  return { category, cleanLabel, summary };
}
