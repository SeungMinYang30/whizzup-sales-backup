export type CalendarTitleInput = {
  organization: string;
  label: string;
  category: string;
  productSummary?: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function googleCalendarTitle(input: CalendarTitleInput) {
  const category = input.category === "general" && /^영업\s*[·•-]\s*/u.test(input.label)
    ? "sales"
    : input.category;
  const cleanLabel = input.label
    .replace(/^(영업|회의|시공|쇼룸|기타)\s*[·•-]\s*/u, "")
    .replace(new RegExp(`^${escapeRegExp(input.organization)}\\s*[·•-]?\\s*`, "u"), "")
    .trim();
  const summary = category === "sales"
    ? `[영업] ${input.organization} 방문`
    : category === "meeting"
      ? `[회의] ${input.organization} 회의`
      : category === "construction"
        ? `[시공] ${input.organization} · ${input.productSummary?.trim() || cleanLabel}`
        : category === "showroom"
          ? `[쇼룸] ${input.organization} 방문`
          : `[기타] ${input.organization} · ${cleanLabel}`;
  return { category, cleanLabel, summary };
}
