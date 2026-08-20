function normalizeSpaces(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function detailedRegionName(region: string) {
  const normalized = normalizeSpaces(region);
  if (!normalized || normalized === "지역 미등록") return "";
  return normalized.split(" ").filter(Boolean).at(-1) ?? "";
}

export function normalizeInstitutionSearchName(value: string) {
  const normalized = normalizeSpaces(value);
  const withoutAttachedKindergarten = normalized
    .replace(/\s*병설(?:\s*유치원)?\s*$/u, "")
    .trim();

  return withoutAttachedKindergarten.replace(/초등학교\s*$/u, "초").trim();
}

export function buildOrganizationSearchQuery({
  region,
  organization,
}: {
  region: string;
  organization: string;
}) {
  const original = normalizeSpaces(organization);
  const normalized = normalizeInstitutionSearchName(original) || original;
  const detailRegion = detailedRegionName(region);

  if (!detailRegion || normalized.startsWith(detailRegion)) return normalized;
  return `${detailRegion} ${normalized}`.trim();
}

export function buildOrganizationSearchQueries({
  region,
  organization,
}: {
  region: string;
  organization: string;
}) {
  const original = normalizeSpaces(organization);
  const normalized = normalizeInstitutionSearchName(original) || original;
  const detailRegion = detailedRegionName(region);
  const preferred = buildOrganizationSearchQuery({ region, organization });
  const organizationWithoutRegion =
    detailRegion && normalized.startsWith(detailRegion)
      ? normalized.slice(detailRegion.length).trim()
      : normalized;
  const cityVariant =
    detailRegion && organizationWithoutRegion
      ? `${detailRegion}시 ${organizationWithoutRegion}`
      : "";

  return [preferred, cityVariant, normalized, original].filter(
    (query, index, queries) =>
      query.length >= 2 && queries.indexOf(query) === index,
  );
}

export function compactMapSearchName(value: string, region = "") {
  const compact = normalizeInstitutionSearchName(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
  const detailRegion = detailedRegionName(region)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");

  if (!detailRegion || !compact.startsWith(detailRegion)) return compact;

  const remainder = compact.slice(detailRegion.length);
  return remainder.replace(/^(?:시|군|구)/u, "") || compact;
}
