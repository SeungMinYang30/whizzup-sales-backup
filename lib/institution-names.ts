export type InstitutionConfirmationPayload = {
  error: string;
  needsInstitutionConfirmation: true;
  requestedOrganization: string;
  requestedInstitutionDetails: InstitutionComparisonDetails;
  suggestedOrganizations: string[];
  suggestedInstitutionMatches: InstitutionMatchCandidate[];
};

export type InstitutionComparisonDetails = {
  region?: string;
  address?: string;
  schoolCode?: string;
  phone?: string;
  officialName?: string;
};

export type InstitutionMatchContext = {
  organization: string;
  region?: string;
  address?: string;
  schoolCode?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  progressManager?: string;
  topic?: string;
  summary?: string;
};

export type InstitutionMatchCandidate = {
  organization: string;
  reasons: string[];
  score: number;
  region?: string;
  address?: string;
  schoolCode?: string;
  phone?: string;
  officialName?: string;
};

export class InstitutionConfirmationRequiredError extends Error {
  requestedOrganization: string;
  requestedInstitutionDetails: InstitutionComparisonDetails;
  suggestedOrganizations: string[];
  suggestedInstitutionMatches: InstitutionMatchCandidate[];

  constructor(
    requestedOrganization: string,
    suggestedInstitutionMatches: InstitutionMatchCandidate[],
    requestedInstitutionDetails: InstitutionComparisonDetails = {},
  ) {
    super(
      `${requestedOrganization}과 비슷한 기존 기관이 있습니다. 같은 기관인지 확인해 주세요.`,
    );
    this.name = "InstitutionConfirmationRequiredError";
    this.requestedOrganization = requestedOrganization;
    this.requestedInstitutionDetails = requestedInstitutionDetails;
    this.suggestedInstitutionMatches = suggestedInstitutionMatches;
    this.suggestedOrganizations = suggestedInstitutionMatches.map(
      (candidate) => candidate.organization,
    );
  }
}

function tidyInstitutionName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function fullSchoolName(
  value: string,
  shortSuffix: string,
  fullSuffix: string,
) {
  const match = value.match(
    new RegExp(`^(.+?)\\s*(?:${fullSuffix}|${shortSuffix})$`),
  );
  const base = match?.[1]?.trim();
  return base ? `${base}${fullSuffix}` : "";
}

/**
 * 확실히 같은 기관이라고 볼 수 있는 축약, 띄어쓰기, 병설 표기만 자동으로
 * 정규화한다. 서로 다른 기관일 수 있는 철자 차이는 이 함수에서 합치지 않는다.
 */
export function canonicalInstitutionName(value: unknown) {
  const name = tidyInstitutionName(value)
    .replace(/\s*[·ㆍ]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return "";

  const annex = name.match(
    /^(.+?)\s*(?:초등학교|초교|초)\s*(?:병설(?:\s*유치원)?|병유|유치원)$/,
  );
  if (annex?.[1]?.trim()) {
    return `${annex[1].trim()}초등학교 병설유치원`;
  }

  const girlsHigh = name.match(/^(.+?)\s*(?:여자고등학교|여고)$/);
  if (girlsHigh?.[1]?.trim()) {
    return `${girlsHigh[1].trim()}여자고등학교`;
  }

  const boysHigh = name.match(/^(.+?)\s*(?:남자고등학교|남고)$/);
  if (boysHigh?.[1]?.trim()) {
    return `${boysHigh[1].trim()}남자고등학교`;
  }

  const girlsMiddle = name.match(/^(.+?)\s*(?:여자중학교|여중)$/);
  if (girlsMiddle?.[1]?.trim()) {
    return `${girlsMiddle[1].trim()}여자중학교`;
  }

  const boysMiddle = name.match(/^(.+?)\s*(?:남자중학교|남중)$/);
  if (boysMiddle?.[1]?.trim()) {
    return `${boysMiddle[1].trim()}남자중학교`;
  }

  const elementaryMiddle = name.match(
    /^(.+?)\s*(?:초중학교|초중|초등학교중학교)$/,
  );
  if (elementaryMiddle?.[1]?.trim()) {
    return `${elementaryMiddle[1].trim()}초중학교`;
  }

  const middleHigh = name.match(/^(.+?)\s*(?:중고등학교|중고)$/);
  if (middleHigh?.[1]?.trim()) {
    return `${middleHigh[1].trim()}중고등학교`;
  }

  if (/(?:외고|과고|예고|체고|공고|상고|여상)$/.test(name.replace(/\s+/g, ""))) {
    return name;
  }

  return (
    fullSchoolName(name, "초(?:교)?", "초등학교") ||
    fullSchoolName(name, "중(?:교)?", "중학교") ||
    fullSchoolName(name, "고(?:교)?", "고등학교") ||
    name
  );
}

/** 나이스 공식 학교명 검색에 사용할 안전한 확장 후보를 만든다. */
export function officialSchoolSearchTerms(value: unknown) {
  const original = tidyInstitutionName(value).replace(/\s+/g, "").trim();
  const canonical = canonicalInstitutionName(value).replace(/\s+/g, "");
  const terms = new Set<string>([canonical]);
  const expansions: Array<[RegExp, string]> = [
    [/^(.+)외고$/, "$1외국어고등학교"],
    [/^(.+)과고$/, "$1과학고등학교"],
    [/^(.+)예고$/, "$1예술고등학교"],
    [/^(.+)체고$/, "$1체육고등학교"],
    [/^(.+)공고$/, "$1공업고등학교"],
    [/^(.+)상고$/, "$1상업고등학교"],
    [/^(.+)여상$/, "$1여자상업고등학교"],
  ];
  expansions.forEach(([pattern, replacement]) => {
    if (pattern.test(original)) terms.add(original.replace(pattern, replacement));
  });
  return [...terms].filter(Boolean).slice(0, 3);
}

export function institutionAliasKey(value: unknown) {
  return canonicalInstitutionName(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

export const INSTITUTION_ALIASES_SETTING_KEY = "institution_aliases";

export type InstitutionAliasCandidate = {
  canonical: string;
  region: string;
};

function parseInstitutionAliases(value: unknown) {
  try {
    const parsed =
      typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {} as Record<string, InstitutionAliasCandidate[]>;
    }
    const aliases: Record<string, InstitutionAliasCandidate[]> = {};
    Object.entries(parsed)
      .slice(0, 500)
      .forEach(([alias, rawCandidates]) => {
        const aliasKey = institutionAliasKey(alias);
        if (!aliasKey) return;
        const values = Array.isArray(rawCandidates)
          ? rawCandidates
          : [rawCandidates];
        const candidates = values
          .map((rawCandidate) => {
            if (typeof rawCandidate === "string") {
              return {
                canonical: canonicalInstitutionName(rawCandidate),
                region: "",
              };
            }
            if (
              !rawCandidate ||
              typeof rawCandidate !== "object" ||
              Array.isArray(rawCandidate)
            ) {
              return null;
            }
            const candidate = rawCandidate as Record<string, unknown>;
            return {
              canonical: canonicalInstitutionName(
                candidate.canonical ?? candidate.organization,
              ),
              region: tidyInstitutionName(candidate.region),
            };
          })
          .filter(
            (candidate): candidate is InstitutionAliasCandidate =>
              Boolean(candidate?.canonical),
          )
          .filter(
            (candidate, index, all) =>
              all.findIndex(
                (entry) =>
                  institutionAliasKey(entry.canonical) ===
                    institutionAliasKey(candidate.canonical) &&
                  comparableText(entry.region) === comparableText(candidate.region),
              ) === index,
          )
          .slice(0, 10);
        if (candidates.length) aliases[aliasKey] = candidates;
      });
    return aliases;
  } catch {
    return {} as Record<string, InstitutionAliasCandidate[]>;
  }
}

function serializeInstitutionAliases(
  aliases: Record<string, InstitutionAliasCandidate[]>,
) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(aliases)
        .filter(([, candidates]) => candidates.length)
        .slice(0, 500)
        .map(([alias, candidates]) => [
          alias,
          candidates.length === 1 && !candidates[0]?.region
            ? candidates[0]?.canonical
            : candidates.slice(0, 10),
        ]),
    ),
  );
}

export function rememberedInstitutionAliasCandidates(
  requestedValue: unknown,
  settingValue: unknown,
) {
  const requestedKey = institutionAliasKey(requestedValue);
  if (!requestedKey) return [] as InstitutionAliasCandidate[];
  return (parseInstitutionAliases(settingValue)[requestedKey] ?? []).map(
    (candidate) => ({ ...candidate }),
  );
}

export function rememberedInstitutionAlias(
  requestedValue: unknown,
  settingValue: unknown,
) {
  const candidates = rememberedInstitutionAliasCandidates(
    requestedValue,
    settingValue,
  );
  const canonicalNames = [
    ...new Map(
      candidates.map((candidate) => [
        institutionAliasKey(candidate.canonical),
        candidate.canonical,
      ]),
    ).values(),
  ];
  return canonicalNames.length === 1 ? canonicalNames[0] ?? "" : "";
}

/**
 * 기관명 변경·승인 별칭 이후에도 연결 테이블이 같은 기관을 가리키도록
 * 저장하는 공통 식별키입니다. 별칭이 여러 기관을 가리키는 경우에는
 * 잘못 합치지 않고 입력 기관 자체의 정규화 키를 유지합니다.
 */
export function institutionIdentityKey(
  value: unknown,
  aliasSettingValue: unknown = "",
) {
  const remembered = rememberedInstitutionAlias(value, aliasSettingValue);
  return institutionAliasKey(remembered || value);
}

export function updateInstitutionAliasSetting(
  settingValue: unknown,
  aliasValue: unknown,
  canonicalValue: unknown,
  regionValue: unknown = "",
) {
  const aliases = parseInstitutionAliases(settingValue);
  const aliasKey = institutionAliasKey(aliasValue);
  const canonical = canonicalInstitutionName(canonicalValue);
  if (!aliasKey || !canonical || aliasKey === institutionAliasKey(canonical)) {
    return serializeInstitutionAliases(aliases);
  }
  const canonicalKey = institutionAliasKey(canonical);
  const region = tidyInstitutionName(regionValue);

  Object.values(aliases).forEach((candidates) => {
    candidates.forEach((candidate) => {
      if (institutionAliasKey(candidate.canonical) === aliasKey) {
        candidate.canonical = canonical;
      }
    });
  });

  const candidates = aliases[aliasKey] ?? [];
  const alreadyStored = candidates.some(
    (candidate) =>
      institutionAliasKey(candidate.canonical) === canonicalKey &&
      (!region ||
        !candidate.region ||
        sameOrContained(candidate.region, region)),
  );
  if (!alreadyStored) {
    candidates.push({ canonical, region });
  } else if (region) {
    const unscoped = candidates.find(
      (candidate) =>
        institutionAliasKey(candidate.canonical) === canonicalKey &&
        !candidate.region,
    );
    if (unscoped) unscoped.region = region;
  }
  aliases[aliasKey] = candidates
    .filter(
      (candidate, index, all) =>
        all.findIndex(
          (entry) =>
            institutionAliasKey(entry.canonical) ===
              institutionAliasKey(candidate.canonical) &&
            comparableText(entry.region) === comparableText(candidate.region),
        ) === index,
    )
    .slice(0, 10);
  return serializeInstitutionAliases(aliases);
}

export function preferFullInstitutionName(...values: string[]) {
  const normalized = values
    .map((value) => canonicalInstitutionName(value))
    .filter(Boolean);
  return (
    normalized.sort(
      (a, b) =>
        b.length - a.length || a.localeCompare(b, "ko-KR"),
    )[0] ?? ""
  );
}

type InstitutionKind =
  | "annex-kindergarten"
  | "elementary"
  | "elementary-middle"
  | "girls-middle"
  | "boys-middle"
  | "middle"
  | "middle-high"
  | "girls-high"
  | "boys-high"
  | "high"
  | "other";

const SAFE_FACILITY_SUFFIXES = [
  "노인종합복지관",
  "장애인종합복지관",
  "실버복지관",
  "종합복지관",
  "노인복지관",
  "장애인복지관",
  "사회복지관",
  "체육센터",
  "문화센터",
  "복지센터",
  "스포츠클럽",
  "어린이집",
  "유치원",
  "복지관",
] as const;

function institutionFacilityType(value: string) {
  const key = institutionAliasKey(value);
  return (
    SAFE_FACILITY_SUFFIXES.find((suffix) =>
      key.endsWith(institutionAliasKey(suffix)),
    ) ?? ""
  );
}

function institutionKind(value: string): InstitutionKind {
  if (value.endsWith("초등학교 병설유치원")) return "annex-kindergarten";
  if (value.endsWith("초중학교")) return "elementary-middle";
  if (value.endsWith("초등학교")) return "elementary";
  if (value.endsWith("여자중학교")) return "girls-middle";
  if (value.endsWith("남자중학교")) return "boys-middle";
  if (value.endsWith("중고등학교")) return "middle-high";
  if (value.endsWith("중학교")) return "middle";
  if (value.endsWith("여자고등학교")) return "girls-high";
  if (value.endsWith("남자고등학교")) return "boys-high";
  if (value.endsWith("고등학교")) return "high";
  return "other";
}

function compatibleSchoolKinds(left: InstitutionKind, right: InstitutionKind) {
  if (left === right && left !== "other") return true;
  const pair = new Set([left, right]);
  return (
    (pair.has("elementary") && pair.has("elementary-middle")) ||
    (pair.has("middle") && pair.has("elementary-middle")) ||
    (pair.has("middle") && pair.has("middle-high")) ||
    (pair.has("high") && pair.has("middle-high"))
  );
}

function institutionBaseKey(value: string) {
  return institutionAliasKey(value).replace(
    /초등학교병설유치원$|여자고등학교$|남자고등학교$|여자중학교$|남자중학교$|초중학교$|중고등학교$|초등학교$|중학교$|고등학교$/,
    "",
  );
}

function comparableText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sameOrContained(left: unknown, right: unknown) {
  const normalizeRegion = (value: unknown) =>
    comparableText(value).replace(
      /(?:특별자치도|특별자치시|광역시|특별시|자치시|자치도|시|군|구|도)$/,
      "",
    );
  const leftKey = normalizeRegion(left);
  const rightKey = normalizeRegion(right);
  return Boolean(
    leftKey &&
      rightKey &&
      Math.min(leftKey.length, rightKey.length) >= 2 &&
      (leftKey === rightKey ||
        leftKey.includes(rightKey) ||
        rightKey.includes(leftKey)),
  );
}

export function sameInstitutionRegion(left: unknown, right: unknown) {
  return sameOrContained(left, right);
}

function institutionCoreWithoutRegion(
  organization: unknown,
  region: unknown,
) {
  let key = institutionAliasKey(organization);
  const regionTokens = String(region ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .split(/[^0-9a-z가-힣]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .flatMap((token) => {
      const base = token.replace(
        /(?:특별자치도|특별자치시|광역시|특별시|자치시|자치도|시|군|구|도)$/,
        "",
      );
      return base.length >= 2 ? [token, base] : [token];
    })
    .sort((left, right) => right.length - left.length);

  regionTokens.forEach((token) => {
    key = key.replace(
      new RegExp(`^${escapeRegExp(token)}(?:특별자치도|특별자치시|광역시|특별시|시|군|구|도)?`),
      "",
    );
  });
  return key;
}

function institutionBaseWithoutRegion(
  organization: unknown,
  region: unknown,
) {
  return institutionCoreWithoutRegion(organization, region).replace(
    /초등학교병설유치원$|여자고등학교$|남자고등학교$|여자중학교$|남자중학교$|초중학교$|중고등학교$|초등학교$|중학교$|고등학교$/,
    "",
  );
}

/** 같은 지역에서 지역명 표기만 다른 동일 기관인지 판별한다. */
export function isSameRegionInstitution(
  left: InstitutionMatchContext,
  right: InstitutionMatchContext,
) {
  if (!sameOrContained(left.region, right.region)) return false;
  const leftKind = institutionKind(canonicalInstitutionName(left.organization));
  const rightKind = institutionKind(canonicalInstitutionName(right.organization));
  if (leftKind === "other" || rightKind === "other") {
    const leftCore = institutionCoreWithoutRegion(
      left.organization,
      left.region,
    );
    const rightCore = institutionCoreWithoutRegion(
      right.organization,
      right.region,
    );
    return Boolean(
      leftCore &&
        rightCore &&
        Math.min(leftCore.length, rightCore.length) >= 4 &&
        leftCore === rightCore,
    );
  }

  const leftCore = institutionBaseWithoutRegion(
    left.organization,
    left.region,
  );
  const rightCore = institutionBaseWithoutRegion(
    right.organization,
    right.region,
  );
  return Boolean(
    leftCore &&
      rightCore &&
      Math.min(leftCore.length, rightCore.length) >= 2 &&
      compatibleSchoolKinds(leftKind, rightKind) &&
      leftCore === rightCore,
  );
}

/**
 * 저장 전 입력 화면에서 이미 확인된 기관의 정보를 미리 보여줄 때 사용한다.
 *
 * 이름이 정확히 같거나 지역과 기관 핵심명이 모두 같은 경우만 후보로 삼고,
 * 서로 다른 기관 후보가 하나라도 함께 잡히면 자동 선택하지 않는다. 따라서
 * 유사 기관 확인 절차를 우회하지 않으면서도 "모담초중학교 / 경기 김포"처럼
 * 지역명만 생략된 단일 후보는 기존 기록을 안전하게 미리 불러올 수 있다.
 */
export function resolveUniqueExistingInstitutionName(
  requestedContext: InstitutionMatchContext,
  existingContexts: InstitutionMatchContext[],
) {
  const requestedKey = institutionAliasKey(requestedContext.organization);
  if (!requestedKey) return "";

  const exactNames = existingContexts
    .filter(
      (context) =>
        institutionAliasKey(context.organization) === requestedKey,
    )
    .map((context) => canonicalInstitutionName(context.organization))
    .filter(Boolean);
  if (exactNames.length) return preferFullInstitutionName(...exactNames);

  const regionalGroups = new Map<string, string[]>();
  existingContexts.forEach((context) => {
    if (!isSameRegionInstitution(requestedContext, context)) return;
    const canonical = canonicalInstitutionName(context.organization);
    const key = institutionAliasKey(canonical);
    if (!key || !canonical) return;
    regionalGroups.set(key, [...(regionalGroups.get(key) ?? []), canonical]);
  });
  if (regionalGroups.size !== 1) return "";
  return preferFullInstitutionName(
    ...([...regionalGroups.values()][0] ?? []),
  );
}

function meaningfulTokens(value: unknown) {
  return new Set(
    String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("ko-KR")
      .split(/[^0-9a-z가-힣]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  );
}

function similarDescription(left: unknown, right: unknown) {
  const leftKey = comparableText(left);
  const rightKey = comparableText(right);
  if (!leftKey || !rightKey) return false;
  if (
    Math.min(leftKey.length, rightKey.length) >= 12 &&
    (leftKey.includes(rightKey) || rightKey.includes(leftKey))
  ) {
    return true;
  }
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  if (leftTokens.size < 2 || rightTokens.size < 2) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap >= 2 && overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.5;
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

/**
 * 오타일 가능성은 높지만 자동 병합하기에는 위험한 기관 후보를 찾는다.
 * 이 결과는 저장 전 사용자 확인에만 사용한다.
 */
export function findSimilarInstitutionNames(
  requestedValue: unknown,
  existingValues: string[],
  limit = 3,
) {
  const requested = canonicalInstitutionName(requestedValue);
  const requestedKey = institutionAliasKey(requested);
  if (!requestedKey) return [];

  const exact = existingValues.some(
    (value) => institutionAliasKey(value) === requestedKey,
  );
  if (exact) return [];

  const requestedKind = institutionKind(requested);
  const requestedBase = institutionBaseKey(requested);
  const candidates = existingValues
    .map((value) => canonicalInstitutionName(value))
    .filter(Boolean)
    .filter(
      (value, index, values) =>
        values.indexOf(value) === index &&
        institutionAliasKey(value) !== requestedKey,
    )
    .map((value) => {
      const candidateKind = institutionKind(value);
      const sameKind =
        requestedKind !== "other" &&
        candidateKind !== "other" &&
        candidateKind === requestedKind;
      const candidateBase = institutionBaseKey(value);
      const baseDistance = editDistance(requestedBase, candidateBase);
      const fullDistance = editDistance(
        requestedKey,
        institutionAliasKey(value),
      );
      const longestBase = Math.max(requestedBase.length, candidateBase.length);
      const schoolAndAnnexPair =
        (requestedKind === "annex-kindergarten" &&
          candidateKind === "elementary") ||
        (requestedKind === "elementary" &&
          candidateKind === "annex-kindergarten");
      const compatibleSchoolLevel = compatibleSchoolKinds(
        requestedKind,
        candidateKind,
      );
      const similarBase =
        longestBase >= 2 &&
        (baseDistance === 0 ||
          (longestBase >= 3 && baseDistance <= 1) ||
          (longestBase >= 6 && baseDistance / longestBase <= 0.18));
      const relatedSchoolBase =
        schoolAndAnnexPair &&
        Math.min(requestedBase.length, candidateBase.length) >= 2 &&
        (similarBase ||
          ((requestedBase.endsWith(candidateBase) ||
            candidateBase.endsWith(requestedBase)) &&
            Math.abs(requestedBase.length - candidateBase.length) <= 4));
      const shortenedSchoolBase =
        compatibleSchoolLevel &&
        Math.min(requestedBase.length, candidateBase.length) >= 2 &&
        (similarBase ||
          ((requestedBase.endsWith(candidateBase) ||
            candidateBase.endsWith(requestedBase)) &&
            Math.abs(requestedBase.length - candidateBase.length) <= 4));
      const likelySuffixTypo =
        requestedKind === candidateKind &&
        Math.min(requestedBase.length, candidateBase.length) >= 3 &&
        fullDistance <= 1 &&
        Math.max(requestedKey.length, institutionAliasKey(value).length) >= 6;
      return {
        value,
        score: baseDistance * 10 + fullDistance,
        match:
          (sameKind && similarBase) ||
          relatedSchoolBase ||
          shortenedSchoolBase ||
          likelySuffixTypo,
      };
    })
    .filter((candidate) => candidate.match)
    .sort(
      (a, b) =>
        a.score - b.score || a.value.localeCompare(b.value, "ko-KR"),
    )
    .slice(0, limit)
    .map((candidate) => candidate.value);

  return candidates;
}

/**
 * 기관명에 실제 동일성 근거가 있는 경우에만 지역, 기관 담당자,
 * 진행 담당자와 상담 내용을 보조 근거로 더해 기존 기관 후보를 찾는다.
 * 지역·담당자·상담 내용만 같고 기관명이 다른 경우에는 후보로 제안하지 않는다.
 */
export function findSimilarInstitutionMatches(
  requestedContext: InstitutionMatchContext,
  existingContexts: InstitutionMatchContext[],
  limit = 3,
) {
  const requested = canonicalInstitutionName(requestedContext.organization);
  const requestedKey = institutionAliasKey(requested);
  const requestedKind = institutionKind(requested);
  const requestedBase = institutionBaseKey(requested);
  const requestedFacilityType = institutionFacilityType(requested);
  if (!requestedKey) return [];

  const grouped = new Map<string, InstitutionMatchCandidate>();
  existingContexts.forEach((context) => {
    const organization = canonicalInstitutionName(context.organization);
    const organizationKey = institutionAliasKey(organization);
    if (!organizationKey || organizationKey === requestedKey) return;

    const candidateKind = institutionKind(organization);
    const candidateBase = institutionBaseKey(organization);
    const candidateFacilityType = institutionFacilityType(organization);
    const sameKind =
      requestedKind !== "other" &&
      candidateKind !== "other" &&
      requestedKind === candidateKind;
    const schoolAndAnnexPair =
      (requestedKind === "annex-kindergarten" &&
        candidateKind === "elementary") ||
      (requestedKind === "elementary" &&
          candidateKind === "annex-kindergarten");
    const compatibleSchoolLevel = compatibleSchoolKinds(
      requestedKind,
      candidateKind,
    );
    const baseDistance = editDistance(requestedBase, candidateBase);
    const longestBase = Math.max(requestedBase.length, candidateBase.length);
    const regionPrefixDifference =
      sameKind &&
      Math.min(requestedBase.length, candidateBase.length) >= 2 &&
      (requestedBase.endsWith(candidateBase) ||
        candidateBase.endsWith(requestedBase)) &&
      Math.abs(requestedBase.length - candidateBase.length) <= 4;
    const similarName =
      sameKind &&
      longestBase >= 2 &&
      (baseDistance === 0 ||
          (longestBase >= 3 && baseDistance <= 1) ||
          (longestBase >= 6 && baseDistance / longestBase <= 0.18));
    const relatedSchoolAndAnnex =
      schoolAndAnnexPair &&
      Math.min(requestedBase.length, candidateBase.length) >= 2 &&
      (baseDistance === 0 ||
        (longestBase >= 3 && baseDistance <= 1) ||
        ((requestedBase.endsWith(candidateBase) ||
          candidateBase.endsWith(requestedBase)) &&
          Math.abs(requestedBase.length - candidateBase.length) <= 4));
    const comparisonRegion = context.region || requestedContext.region;
    const requestedRegionalBase = institutionBaseWithoutRegion(
      requested,
      comparisonRegion,
    );
    const candidateRegionalBase = institutionBaseWithoutRegion(
      organization,
      comparisonRegion,
    );
    const schoolLevelAbbreviation =
      compatibleSchoolLevel &&
      Math.min(requestedRegionalBase.length, candidateRegionalBase.length) >= 2 &&
      (requestedRegionalBase === candidateRegionalBase ||
        ((requestedRegionalBase.endsWith(candidateRegionalBase) ||
          candidateRegionalBase.endsWith(requestedRegionalBase)) &&
          Math.abs(
            requestedRegionalBase.length - candidateRegionalBase.length,
          ) <= 4));
    const sameRegionInstitution = isSameRegionInstitution(
      requestedContext,
      context,
    );
    const sameRegion =
      Boolean(requestedContext.region && context.region) &&
      sameOrContained(requestedContext.region, context.region);
    const sameFacilityType =
      Boolean(requestedFacilityType) &&
      requestedFacilityType === candidateFacilityType;
    const sameAddress =
      Boolean(requestedContext.address && context.address) &&
      comparableText(requestedContext.address) ===
        comparableText(context.address);
    const sameSchoolCode =
      Boolean(requestedContext.schoolCode && context.schoolCode) &&
      comparableText(requestedContext.schoolCode) ===
        comparableText(context.schoolCode);
    const hasSupportingContext =
      Boolean(
        requestedContext.contactPhone &&
          context.contactPhone &&
          comparableText(requestedContext.contactPhone) ===
            comparableText(context.contactPhone),
      ) ||
      Boolean(
        requestedContext.contactEmail &&
          context.contactEmail &&
          comparableText(requestedContext.contactEmail) ===
            comparableText(context.contactEmail),
      ) ||
      sameAddress ||
      sameSchoolCode;
    const facilityTypeCandidate =
      sameFacilityType && sameRegion && hasSupportingContext;

    let score = 0;
    const reasons: string[] = [];
    if (regionPrefixDifference) {
      score += 4;
      reasons.push("기관명이 지역명 포함 여부만 다름");
    } else if (similarName) {
      score += 3;
      reasons.push("기관명이 비슷함");
    }
    if (relatedSchoolAndAnnex) {
      score += 5;
      reasons.push("초등학교와 병설유치원 관계");
    }
    if (schoolLevelAbbreviation) {
      score += 7;
      reasons.push("지역명 또는 학교 명칭이 생략된 축약명");
    }
    if (facilityTypeCandidate) {
      score += 2;
      reasons.push("기관 유형이 같음");
    }
    if (sameRegionInstitution) {
      score += 8;
      reasons.push("지역과 기관 핵심명이 같음");
    } else if (sameRegion) {
      score += 3;
      reasons.push("지역이 같음");
    }
    if (
      requestedContext.contactPhone &&
      context.contactPhone &&
      comparableText(requestedContext.contactPhone) ===
        comparableText(context.contactPhone)
    ) {
      score += 5;
      reasons.push("기관 담당자 전화번호가 같음");
    }
    if (
      requestedContext.contactEmail &&
      context.contactEmail &&
      comparableText(requestedContext.contactEmail) ===
        comparableText(context.contactEmail)
    ) {
      score += 5;
      reasons.push("기관 담당자 이메일이 같음");
    }
    if (sameAddress) {
      score += 8;
      reasons.push("주소가 같음");
    }
    if (sameSchoolCode) {
      score += 10;
      reasons.push("학교 코드가 같음");
    }

    const hasNameEvidence =
      regionPrefixDifference ||
      similarName ||
      relatedSchoolAndAnnex ||
      schoolLevelAbbreviation ||
      sameRegionInstitution;
    if (score < 5 || !hasNameEvidence) return;

    const previous = grouped.get(organizationKey);
    if (!previous || score > previous.score) {
      grouped.set(organizationKey, { organization, reasons, score });
    }
  });

  return [...grouped.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.organization.localeCompare(right.organization, "ko-KR"),
    )
    .slice(0, limit);
}

export function institutionConfirmationResponse(error: unknown) {
  if (!(error instanceof InstitutionConfirmationRequiredError)) return null;
  return Response.json(
    {
      error: error.message,
      needsInstitutionConfirmation: true,
      requestedOrganization: error.requestedOrganization,
      requestedInstitutionDetails: error.requestedInstitutionDetails,
      suggestedOrganizations: error.suggestedOrganizations,
      suggestedInstitutionMatches: error.suggestedInstitutionMatches,
    } satisfies InstitutionConfirmationPayload,
    { status: 409 },
  );
}
