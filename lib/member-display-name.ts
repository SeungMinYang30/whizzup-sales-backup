export const MEMBER_JOB_TITLE_SUGGESTIONS = [
  "대표",
  "이사",
  "본부장",
  "부장",
  "차장",
  "과장",
  "대리",
  "주임",
  "사원",
] as const;

function compact(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeMemberJobTitle(value: unknown) {
  const title = compact(value);
  return title === "대표" || title === "대표님" ? "대표님" : title;
}

export function buildMemberDisplayName(name: unknown, jobTitle: unknown) {
  return [compact(name), normalizeMemberJobTitle(jobTitle)].filter(Boolean).join(" ");
}
