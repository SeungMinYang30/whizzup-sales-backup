import {
  canonicalInstitutionName,
  institutionAliasKey,
  preferFullInstitutionName,
} from "./institution-names";

const MAX_SOURCE_ROWS = 10_000;
const MAX_GROUPS = 3_000;

type SheetSourceRow = {
  rowNumber: number;
  region: string;
  organization: string;
  activityDate: string;
  rawDate: string;
  summary: string;
  groupKey: string;
};

export function cleanGoogleSheetValue(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value: unknown) {
  return cleanGoogleSheetValue(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

export function parseGoogleSheetCsv(source: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function normalizeDate(value: unknown) {
  const text = cleanGoogleSheetValue(value);
  const matched = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (!matched) return "";
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseGoogleSpreadsheetSource(value: unknown) {
  const text = cleanGoogleSheetValue(value);
  const matched = text.match(
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/.*)?$/,
  );
  if (!matched) throw new Error("구글 스프레드시트 공유 링크를 입력해 주세요.");
  const parsed = new URL(text);
  const hashParameters = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const rawGid = parsed.searchParams.get("gid") || hashParameters.get("gid") || "";
  return {
    spreadsheetId: matched[1],
    gid: /^\d+$/.test(rawGid) ? rawGid : "",
  };
}

function regionTokens(region: string) {
  return region
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/(?:특별자치도|특별자치시|광역시|특별시|도|시|군|구)$/g, ""))
    .map((token) => institutionAliasKey(token))
    .filter((token) => token.length >= 2)
    .sort((left, right) => right.length - left.length);
}

function sheetInstitutionKey(organization: string, region: string) {
  let key = institutionAliasKey(organization);
  for (const token of regionTokens(region)) {
    if (key.startsWith(token) && key.length - token.length >= 4) {
      key = key.slice(token.length);
      break;
    }
  }
  return `${institutionAliasKey(region)}|${key}`;
}

function findHeaderRow(rows: string[][]) {
  const organizationNames = new Set(["학교명", "기관명", "학교", "기관", "기관파트너명", "거래처"]);
  const regionNames = new Set(["지역", "시도", "권역", "지원청지역"]);
  const dateNames = new Set(["계약일자", "계약일", "수주일자", "수주일", "설치일자", "설치일", "날짜"]);
  const summaryNames = new Set(["판매내용", "판매내역", "계약내용", "설치내용", "품목", "제품", "사업내용", "내용"]);
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 100); rowIndex += 1) {
    const normalized = rows[rowIndex].map(normalizeHeader);
    const find = (names: Set<string>) => normalized.findIndex((header) => names.has(header));
    const organizationIndex = find(organizationNames);
    const regionIndex = find(regionNames);
    const dateIndex = find(dateNames);
    const summaryIndex = find(summaryNames);
    if (
      organizationIndex >= 0 &&
      [regionIndex, dateIndex, summaryIndex].filter((index) => index >= 0).length >= 1
    ) return { rowIndex, organizationIndex, regionIndex, dateIndex, summaryIndex };
  }
  throw new Error(
    "학교명 또는 기관명이 있는 제목 행을 찾지 못했습니다. 제목에 지역·학교명·계약 일자·판매내용을 사용해 주세요.",
  );
}

function isSchool(value: string) {
  return /학교|유치원|교육지원청|교육청/.test(value);
}

export function buildGoogleSheetImportRows(
  rows: string[][],
  source: { spreadsheetId: string; gid: string },
) {
  const header = findHeaderRow(rows);
  const sourceRows: SheetSourceRow[] = [];
  let previousOrganization = "";
  let previousRegion = "";
  let inheritedOrganizationCount = 0;
  let missingOrganizationCount = 0;
  let missingDateCount = 0;
  let invalidDateCount = 0;
  let missingRegionCount = 0;
  let blankStreak = 0;
  const at = (row: string[], index: number) =>
    index < 0 ? "" : cleanGoogleSheetValue(row[index]);

  for (
    let sourceIndex = header.rowIndex + 1;
    sourceIndex < rows.length && sourceRows.length < MAX_SOURCE_ROWS;
    sourceIndex += 1
  ) {
    const row = rows[sourceIndex];
    let region = at(row, header.regionIndex);
    let organization = at(row, header.organizationIndex);
    const rawDate = at(row, header.dateIndex);
    const summary = at(row, header.summaryIndex);
    if (!region && !organization && !rawDate && !summary) {
      blankStreak += 1;
      if (blankStreak >= 2) {
        previousOrganization = "";
        previousRegion = "";
      }
      continue;
    }
    blankStreak = 0;
    if (!organization && previousOrganization && (rawDate || summary)) {
      organization = previousOrganization;
      inheritedOrganizationCount += 1;
    }
    if (!organization) {
      missingOrganizationCount += 1;
      continue;
    }
    organization = canonicalInstitutionName(
      organization.replace(/\s*\((?:국|공립|사립)\)\s*$/u, ""),
    );
    if (!region && previousRegion) region = previousRegion;
    if (!region) missingRegionCount += 1;
    previousOrganization = organization;
    previousRegion = region || previousRegion;
    const activityDate = normalizeDate(rawDate);
    if (!rawDate) missingDateCount += 1;
    else if (!activityDate) invalidDateCount += 1;
    sourceRows.push({
      rowNumber: sourceIndex + 1,
      region,
      organization,
      activityDate,
      rawDate,
      summary,
      groupKey: sheetInstitutionKey(organization, region),
    });
  }

  const grouped = new Map<string, SheetSourceRow[]>();
  sourceRows.forEach((row) => grouped.set(row.groupKey, [...(grouped.get(row.groupKey) ?? []), row]));
  if (grouped.size > MAX_GROUPS) {
    throw new Error(`기관이 ${MAX_GROUPS.toLocaleString("ko-KR")}개를 넘어 한 번에 분석할 수 없습니다.`);
  }

  let duplicateRowCount = 0;
  const importRows = [...grouped.entries()].map(([groupKey, groupRows], index) => {
    const organization = preferFullInstitutionName(...groupRows.map((row) => row.organization));
    const region = groupRows
      .map((row) => row.region)
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)[0] ?? "";
    const seen = new Set<string>();
    const uniqueRows = groupRows.filter((row) => {
      const signature = `${row.activityDate}|${normalizeHeader(row.summary)}`;
      if (seen.has(signature)) {
        duplicateRowCount += 1;
        return false;
      }
      seen.add(signature);
      return true;
    });
    const validDates = uniqueRows.map((row) => row.activityDate).filter(Boolean).sort();
    const latestDate = validDates.at(-1) ?? "";
    const missingDates = uniqueRows.filter((row) => !row.activityDate).length;
    const rawNames = [...new Set(groupRows.map((row) => row.organization))];
    const historyLines = uniqueRows
      .filter((row) => row.activityDate || row.summary)
      .map((row) => {
        const dateLabel = row.activityDate || `날짜 미확인${row.rawDate ? `(${row.rawDate})` : ""}`;
        return `[${dateLabel}] ${row.summary || "계약·설치 내용 미입력"}`;
      });
    const summary = historyLines.length
      ? `계약·설치 이력 ${historyLines.length}건\n${historyLines.join("\n")}`.slice(0, 3800)
      : "구글 시트에서 확인한 계약·설치 기관입니다.";
    const warnings: string[] = [];
    const errors: string[] = [];
    if (groupRows.length > 1) warnings.push(`원본 ${groupRows.length}행을 기관 1건으로 묶었습니다.`);
    if (rawNames.length > 1) warnings.push(`기관명 표기 ${rawNames.length}개를 통합했습니다.`);
    if (missingDates > 0) warnings.push(`날짜 미확인 이력 ${missingDates}건이 포함되어 있습니다.`);
    if (!latestDate) errors.push("계약 일자를 확인해 주세요.");
    if (!region) warnings.push("지역을 확인해 주세요.");
    return {
      rowNumber: groupRows[0]?.rowNumber ?? index + header.rowIndex + 2,
      values: {
        activityDate: latestDate,
        dateConfidence: latestDate ? "확정" : "미확인",
        activityType: "수주",
        category: isSchool(organization) ? "학교" : "기관",
        contactMethod: "기타",
        region,
        organization,
        budgetType: "VR스포츠실 계약·설치",
        budgetAmount: "",
        topic: "계약·설치 이력",
        summary,
        status: "영업 종료",
        temperature: "높음",
        awardStatus: "미정",
        awardCompany: "",
        executionType: "직영",
        consortiumCompany: "",
        awardStage: "미정",
        progressManager: "해당 없음",
        followUpRequired: false,
        followUpDate: "",
        nextAction: "설치·계약 이력 확인",
        progressSchedule: "",
        contactRole: "",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        sourceChat: `구글 시트 연동|${source.spreadsheetId}|${source.gid || "default"}|${groupKey}`,
        notes: `구글 시트 원본 ${groupRows.map((row) => row.rowNumber).join(", ")}행`,
      },
      errors,
      warnings,
    };
  });

  return {
    headerRow: header.rowIndex + 1,
    sourceRows,
    importRows,
    inheritedOrganizationCount,
    missingOrganizationCount,
    missingDateCount,
    invalidDateCount,
    missingRegionCount,
    duplicateRowCount,
  };
}
