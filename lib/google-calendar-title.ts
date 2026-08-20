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
    .filter((line) => !/^\s*원본(?:\s+Google)?\s+제목\s*:/iu.test(line))
    .join("\n")
    .trim();
}

export function compactGoogleCalendarOrganization(value: string) {
  const organization = value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)\s+/u, "")
    .trim();
  const school = organization.match(/^(.*?)(초등학교|중학교|고등학교)$/u);
  if (!school) return organization;
  const prefix = school[1]
    .replace(/(^|\s)([가-힣]+?)(?:시|군|구)(?=\s)/gu, "$1$2")
    .trim();
  const suffix = school[2] === "초등학교" ? "초" : school[2] === "중학교" ? "중" : "고";
  return `${prefix}${suffix}`;
}

export function googleCalendarTitle(input: CalendarTitleInput) {
  const category = input.category === "general" && /^영업\s*[·•-]\s*/u.test(input.label)
    ? "sales"
    : input.category;
  const scheduleTitle = scheduleTitleForGoogle(input.label);
  const compactOrganization = compactGoogleCalendarOrganization(input.organization) || input.organization.trim();
  const withoutFullOrganization = scheduleTitle
    .replace(new RegExp(`^${escapeRegExp(input.organization)}\\s*[·•-]?\\s*`, "u"), "")
    .trim();
  const cleanLabel = withoutFullOrganization
    .replace(new RegExp(`^${escapeRegExp(compactOrganization)}\\s*[·•-]?\\s*`, "u"), "")
    .trim();
  const constructionStage = cleanLabel || scheduleTitle || "시공";
  const workTitle = category === "construction" ? constructionStage : cleanLabel || scheduleTitle;
  const summary = compactOrganization
    ? `[${compactOrganization}]${workTitle ? ` ${workTitle}` : ""}`
    : workTitle;
  return { category, cleanLabel, summary };
}
