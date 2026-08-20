import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { canonicalInstitutionName } from "../lib/institution-names";
import { regionFromAddress } from "../lib/region-from-address";
import {
  constructionStageTone,
  type ConstructionDayMeta,
} from "../lib/construction-calendar";
import {
  AWARD_STAGE_OPTIONS,
  COMPLETED_AWARD_STAGE,
  normalizeAwardStage,
} from "../lib/sales-taxonomy";
import {
  type ActivityImportRow,
  type ActivityImportValues,
} from "./activity-award-utils";

export {
  applyAwardCompanyToSelectedRows,
  awardCompanyKey,
  classifyAwardCompany,
  mergeAwardImportRows,
  prepareAwardImportValues,
  type ActivityImportRow,
  type ActivityImportValues,
  type AwardCompanyRelation,
} from "./activity-award-utils";

const activityTypes = [
  "TM·통화",
  "미팅·방문",
  "문자·메일",
  "기타",
];
const categories = ["학교", "기관", "협력사", "내부", "기타"];
const contactMethods = ["유선", "방문", "온라인", "진행 공유", "기타"];
const temperatures = ["높음", "중간", "낮음"];
const awardStatuses = ["미정", "위즈업 수주", "협력사 수주", "타업체 수주"];
const executionTypes = ["직영", "컨소", "해당 없음"];
const awardStages = [...AWARD_STAGE_OPTIONS];

const columns = [
  ["activityDate", "활동일자", true, "YYYY-MM-DD 형식으로 입력합니다.", "2026-07-18", 14],
  ["organization", "기관명", true, "학교·기관·협력사 이름을 입력합니다.", "제일초등학교", 24],
  ["businessRound", "사업 차수", false, "같은 기관의 신규 사업은 2, 3처럼 구분합니다. 미입력 시 1차입니다.", "1", 12],
  ["activityType", "활동 유형", true, "선택값 안내 시트의 활동 유형 중 하나를 입력합니다.", "TM·통화", 16],
  ["summary", "상담 내용", true, "통화·미팅에서 확인한 핵심 내용을 입력합니다.", "전자칠판 교체 계획 확인, 다음 주 제안서 전달", 46],
  ["category", "기관 구분(선택)", false, "기존 파일 호환용 선택 항목입니다. 비워도 됩니다.", "", 14],
  ["region", "지역", false, "예: 경기 성남, 충북 청주", "경기 성남", 16],
  ["contactMethod", "컨택 유형", false, "미입력 시 유선으로 저장됩니다.", "유선", 14],
  ["topic", "주제", false, "제품, 사업명 또는 논의 주제를 입력합니다.", "전자칠판 교체", 24],
  ["budgetType", "예산", false, "예: 자체예산, 늘봄, 교육청 예산", "자체예산", 18],
  ["budgetAmount", "예산금액", false, "단위를 포함해도 됩니다.", "2,480만원", 16],
  ["temperature", "관심도", false, "미입력 시 중간으로 저장됩니다.", "중간", 12],
  ["followUpRequired", "재연락 여부", false, "예/아니오로 입력합니다. 미입력 시 아니오입니다.", "예", 14],
  ["followUpDate", "재연락 예정일", false, "YYYY-MM-DD 형식으로 입력합니다.", "2026-07-25", 16],
  ["nextAction", "다음 행동", false, "예: 제안서 발송 후 전화", "제안서 발송", 24],
  ["progressSchedule", "진행 일정", false, "여러 일정은 줄바꿈으로 구분합니다. 예: 목공 2026-07-25", "목공 2026-07-25", 28],
  ["contactRole", "담당 역할", false, "공사 담당자, 회계 담당자처럼 기관 인물의 역할을 입력합니다.", "공사 담당자", 18],
  ["contactName", "기관 담당자", false, "이름 또는 직책을 입력합니다.", "김선생 / 정보부장", 20],
  ["contactPhone", "기관 전화번호", false, "전화번호를 입력합니다.", "031-000-0000", 18],
  ["contactEmail", "기관 메일", false, "이메일 주소를 입력합니다.", "name@example.com", 24],
  ["notes", "추가 메모", false, "추가로 남길 내용을 입력합니다.", "교장 선생님 보고 예정", 30],
  ["awardStatus", "수주 구분", false, "미입력 시 미정으로 저장됩니다.", "미정", 16],
  ["awardCompany", "수주업체", false, "위즈업·협력사·타업체명을 입력합니다. 모르면 비워 둘 수 있습니다.", "", 20],
  ["executionType", "사업방식", false, "미입력 시 직영으로 저장됩니다.", "직영", 14],
  ["consortiumCompany", "컨소 업체명", false, "사업방식이 컨소일 때 반드시 입력합니다.", "", 20],
  ["awardStage", "현재 상태", false, "수주 후 진행 상태를 입력합니다.", "미정", 16],
  ["awardCompletedDate", "납품 완료일", false, "현재 상태가 납품 완료일 때 YYYY-MM-DD로 입력합니다.", "", 16],
  ["progressManager", "진행 담당자", false, "수주 후 진행을 맡는 담당자 이름을 입력합니다.", "", 18],
] as const;

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function inlineCell(reference: string, value: string, style = 0) {
  return `<c r="${reference}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function worksheetXml(
  rows: string[][],
  widths: number[],
  options: { filter?: string; freeze?: boolean } = {},
) {
  const rowXml = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="25" customHeight="1"' : ""}>${row
          .map((value, columnIndex) =>
            inlineCell(
              `${columnName(columnIndex)}${rowIndex + 1}`,
              value,
              rowIndex === 0 ? 1 : 0,
            ),
          )
          .join("")}</row>`,
    )
    .join("");
  const cols = widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${
    options.freeze
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : ""
  }
  <cols>${cols}</cols>
  <sheetData>${rowXml}</sheetData>
  ${options.filter ? `<autoFilter ref="${options.filter}"/>` : ""}
</worksheet>`;
}

function buildTemplateFiles(
  templateColumns: readonly (readonly [string, string, boolean, string, string, number])[] = columns,
  templateTitle = "WHIZZUP 새 기록 대량 등록 양식",
) {
  const inputRows = [templateColumns.map((column) => column[1])];
  const guideRows = [
    ["항목", "필수 여부", "작성 방법", "입력 예시"],
    ...templateColumns.map((column) => [
      column[1],
      column[2] ? "필수" : "선택",
      column[3],
      column[4],
    ]),
  ];
  const choiceRows = [
    ["항목", "입력 가능한 값"],
    ["활동 유형", activityTypes.join(", ")],
    ["기관 구분", categories.join(", ")],
    ["컨택 유형", contactMethods.join(", ")],
    ["관심도", temperatures.join(", ")],
    ["재연락 여부", "예, 아니오"],
    ["수주 구분", awardStatuses.join(", ")],
    ["사업방식", executionTypes.join(", ")],
    ["현재 상태", awardStages.join(", ")],
  ];
  const lastColumn = columnName(templateColumns.length - 1);
  const sheet1 = worksheetXml(
    inputRows,
    templateColumns.map((column) => column[5]),
    { filter: `A1:${lastColumn}1`, freeze: true },
  );
  const sheet2 = worksheetXml(guideRows, [20, 12, 58, 34], {
    filter: "A1:D1",
    freeze: true,
  });
  const sheet3 = worksheetXml(choiceRows, [20, 120], {
    filter: "A1:B1",
    freeze: true,
  });
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="기록 입력" sheetId="1" r:id="rId1"/>
    <sheet name="작성 안내" sheetId="2" r:id="rId2"/>
    <sheet name="선택값 안내" sheetId="3" r:id="rId3"/>
  </sheets>
</workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="맑은 고딕"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3738F5"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const now = new Date().toISOString();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(templateTitle)}</dc:title><dc:creator>WHIZZUP</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
</cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WHIZZUP Sales Hub</Application></Properties>`;
  return {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "docProps/core.xml": strToU8(core),
    "docProps/app.xml": strToU8(app),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
    "xl/styles.xml": strToU8(styles),
    "xl/worksheets/sheet1.xml": strToU8(sheet1),
    "xl/worksheets/sheet2.xml": strToU8(sheet2),
    "xl/worksheets/sheet3.xml": strToU8(sheet3),
  };
}

export function downloadActivityTemplate() {
  const data = zipSync(buildTemplateFiles(), { level: 6 });
  const buffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "WHIZZUP_새기록_대량등록_양식.xlsx";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadAwardTemplate() {
  downloadRowsXlsx({
    filename: "WHIZZUP_설치완료_수주일괄등록_양식.xlsx",
    sheetName: "설치 완료 수주",
    headers: [
      "설치연월일",
      "기관명",
      "사업 차수",
      "주소",
      "설치 장비",
      "수주업체",
    ],
    rows: [
      [
        "2026-07-15",
        "[예시—삭제 후 입력] 서울한빛초등학교",
        "1",
        "서울특별시 종로구 세종대로 1",
        "가상현실스포츠실 1식, 전자칠판 1대",
        "주식회사 위즈업",
      ],
      [
        "2026-06",
        "[예시—삭제 후 입력] 부산꿈나무센터",
        "1",
        "부산광역시 해운대구 센텀로 1",
        "키오스크 2대",
        "에어패스",
      ],
      [
        "2025-12-20",
        "[예시—삭제 후 입력] 김포모담초중학교",
        "2",
        "경기도 김포시 운양로 158",
        "3X비전센서 1대, 빔프로젝터 1대",
        "주식회사 위즈업",
      ],
    ],
    widths: [16, 34, 12, 42, 44, 24],
  });
}

export type WorkbookExportOptions = {
  filename: string;
  sheetName: string;
  headers: string[];
  rows: Array<Array<string | number | boolean | null | undefined>>;
  widths?: number[];
};

function safeSheetName(value: string) {
  return value.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "목록";
}

function downloadWorkbookBlob(
  files: Record<string, Uint8Array>,
  filename: string,
) {
  const data = zipSync(files, { level: 6 });
  const buffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.toLowerCase().endsWith(".xlsx")
    ? filename
    : `${filename}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadRowsXlsx(options: WorkbookExportOptions) {
  const normalizedRows = options.rows.map((row) =>
    options.headers.map((_, index) => String(row[index] ?? "")),
  );
  const allRows = [options.headers, ...normalizedRows];
  const widths =
    options.widths ??
    options.headers.map((header, index) => {
      const longest = Math.max(
        header.length,
        ...normalizedRows.map((row) => row[index]?.length ?? 0),
      );
      return Math.max(12, Math.min(48, longest * 1.55 + 2));
    });
  const lastColumn = columnName(Math.max(0, options.headers.length - 1));
  const sheet = worksheetXml(allRows, widths, {
    filter: `A1:${lastColumn}${Math.max(1, allRows.length)}`,
    freeze: true,
  });
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(safeSheetName(options.sheetName))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="맑은 고딕"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3738F5"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const now = new Date().toISOString();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(options.sheetName)}</dc:title><dc:creator>WHIZZUP</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
</cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WHIZZUP Sales Hub</Application></Properties>`;
  downloadWorkbookBlob(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rootRels),
      "docProps/core.xml": strToU8(core),
      "docProps/app.xml": strToU8(app),
      "xl/workbook.xml": strToU8(workbook),
      "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
      "xl/styles.xml": strToU8(styles),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    },
    options.filename,
  );
}

export type ConstructionTimelineExportOptions = {
  filename: string;
  startDate: string;
  endDate: string;
  headers: string[];
  rows: string[][];
  widths: number[];
  fixedColumnCount: number;
  days: ConstructionDayMeta[];
  filterSummary?: string;
};

function constructionStageStyle(value: string, fallback: number, isToday: boolean) {
  if (!value.trim()) return fallback;
  const tone = constructionStageTone(value);
  if (tone < 0) return isToday ? 29 : 15;
  return (isToday ? 24 : 10) + tone;
}

export function downloadConstructionTimelineXlsx(
  options: ConstructionTimelineExportOptions,
) {
  const lastColumnIndex = Math.max(0, options.headers.length - 1);
  const lastColumn = columnName(lastColumnIndex);
  const title = `시공·납품 일정표  ${options.startDate} ~ ${options.endDate}${options.filterSummary ? `  |  ${options.filterSummary}` : ""}`;
  const headerCells = options.headers
    .map((value, columnIndex) => {
      if (columnIndex < options.fixedColumnCount) {
        return inlineCell(`${columnName(columnIndex)}2`, value, 2);
      }
      const day = options.days[columnIndex - options.fixedColumnCount];
      const annotations = [day?.holidayName, day?.isToday ? "오늘" : ""].filter(Boolean);
      const label = `${day?.label ?? value}${annotations.length ? `\n${annotations.join(" · ")}` : ""}`;
      const isHolidayLike = Boolean(day?.isHoliday || day?.isSunday || day?.isSaturday);
      const style = day?.isToday
        ? isHolidayLike ? 7 : 6
        : day?.isHoliday || day?.isSunday
          ? 5
          : day?.isSaturday
            ? 4
            : 3;
      return inlineCell(`${columnName(columnIndex)}2`, label, style);
    })
    .join("");
  const dataRows = options.rows
    .map((row, rowIndex) => {
      const cells = options.headers
        .map((_, columnIndex) => {
          const value = String(row[columnIndex] ?? "");
          let style = rowIndex % 2 === 0 ? 8 : 9;
          if (columnIndex >= options.fixedColumnCount) {
            const day = options.days[columnIndex - options.fixedColumnCount];
            const isHolidayLike = Boolean(day?.isHoliday || day?.isSunday || day?.isSaturday);
            const blankStyle = day?.isToday
              ? isHolidayLike ? 23 : 22
              : day?.isHoliday || day?.isSunday
                ? rowIndex % 2 === 0 ? 20 : 21
                : day?.isSaturday
                  ? rowIndex % 2 === 0 ? 18 : 19
                  : rowIndex % 2 === 0 ? 16 : 17;
            style = constructionStageStyle(value, blankStyle, Boolean(day?.isToday));
          }
          return inlineCell(
            `${columnName(columnIndex)}${rowIndex + 3}`,
            value,
            style,
          );
        })
        .join("");
      return `<row r="${rowIndex + 3}" ht="38" customHeight="1">${cells}</row>`;
    })
    .join("");
  const columns = options.widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="${options.fixedColumnCount}" ySplit="2" topLeftCell="${columnName(options.fixedColumnCount)}3" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
  <cols>${columns}</cols>
  <sheetData>
    <row r="1" ht="34" customHeight="1">${inlineCell("A1", title, 1)}</row>
    <row r="2" ht="42" customHeight="1">${headerCells}</row>
    ${dataRows}
  </sheetData>
  <autoFilter ref="A2:${lastColumn}${Math.max(2, options.rows.length + 2)}"/>
  <mergeCells count="1"><mergeCell ref="A1:${lastColumn}1"/></mergeCells>
  <printOptions horizontalCentered="1"/>
  <pageMargins left="0.2" right="0.2" top="0.35" bottom="0.35" header="0.15" footer="0.15"/>
  <pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="시공 납품 일정" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="6"><font><color rgb="FF26354D"/><sz val="10"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="15"/><name val="맑은 고딕"/></font><font><b/><color rgb="FF26354D"/><sz val="10"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFC94343"/><sz val="9"/><name val="맑은 고딕"/></font><font><b/><color rgb="FF087A63"/><sz val="10"/><name val="맑은 고딕"/></font></fonts>
  <fills count="16"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2D43"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF8F2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF0F0"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F8F4"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FB"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5F6C8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE4AB"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFD9DF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E7FF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9F3EB"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDF2FF"/></patternFill></fill></fills>
  <borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9E2EF"/></left><right style="thin"><color rgb="FFD9E2EF"/></right><top style="thin"><color rgb="FFD9E2EF"/></top><bottom style="thin"><color rgb="FFD9E2EF"/></bottom><diagonal/></border><border><left style="medium"><color rgb="FF17A887"/></left><right style="medium"><color rgb="FF17A887"/></right><top style="thin"><color rgb="FF17A887"/></top><bottom style="thin"><color rgb="FF17A887"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="30">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="7" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="6" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="10" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="11" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="12" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="13" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="14" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="15" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="7" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="10" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="11" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="12" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="13" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="14" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="15" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const now = new Date().toISOString();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>시공·납품 일정표</dc:title><dc:creator>WHIZZUP</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WHIZZUP Sales Hub</Application></Properties>`;
  downloadWorkbookBlob(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rootRels),
      "docProps/core.xml": strToU8(core),
      "docProps/app.xml": strToU8(app),
      "xl/workbook.xml": strToU8(workbook),
      "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
      "xl/styles.xml": strToU8(styles),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    },
    options.filename,
  );
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseXlsx(buffer: ArrayBuffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const sheetPath =
    Object.keys(files).find((path) => path === "xl/worksheets/sheet1.xml") ??
    Object.keys(files).find((path) =>
      /^xl\/worksheets\/sheet\d+\.xml$/.test(path),
    );
  if (!sheetPath) throw new Error("엑셀의 ‘기록 입력’ 시트를 찾지 못했습니다.");
  const parser = new DOMParser();
  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    const sharedDocument = parser.parseFromString(
      strFromU8(files["xl/sharedStrings.xml"]),
      "application/xml",
    );
    Array.from(sharedDocument.getElementsByTagName("si")).forEach((item) => {
      shared.push(
        Array.from(item.getElementsByTagName("t"))
          .map((text) => text.textContent ?? "")
          .join(""),
      );
    });
  }
  const sheetDocument = parser.parseFromString(
    strFromU8(files[sheetPath]),
    "application/xml",
  );
  return Array.from(sheetDocument.getElementsByTagName("row")).map((row) => {
    const cells: string[] = [];
    Array.from(row.getElementsByTagName("c")).forEach((cell) => {
      const reference = cell.getAttribute("r") ?? "A1";
      const letters = reference.match(/[A-Z]+/)?.[0] ?? "A";
      let column = 0;
      for (const letter of letters) {
        column = column * 26 + letter.charCodeAt(0) - 64;
      }
      const type = cell.getAttribute("t");
      const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      const value =
        type === "s"
          ? shared[Number(raw)] ?? ""
          : type === "inlineStr"
            ? Array.from(cell.getElementsByTagName("t"))
                .map((text) => text.textContent ?? "")
                .join("")
            : raw;
      cells[column - 1] = value;
    });
    return cells;
  });
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function normalizeDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (serial >= 20_000 && serial <= 80_000) {
      return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
  }
  const matched = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (!matched) return "";
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return "";
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeAwardMonth(value: string, yearValue = "", monthValue = "") {
  const combined = value.trim() ||
    (yearValue.trim() && monthValue.trim()
      ? `${yearValue.trim()}-${monthValue.trim()}`
      : yearValue.trim());
  if (!combined) return "";
  const exactDate = normalizeDate(combined);
  if (exactDate) return exactDate;
  const normalized = combined
    .replace(/년/g, "-")
    .replace(/월/g, "")
    .replace(/[./]/g, "-")
    .replace(/\s+/g, "")
    .replace(/-+/g, "-")
    .replace(/-$/, "");
  const matched = normalized.match(/^(\d{4})-(\d{1,2})$/);
  if (matched) {
    const month = Number(matched[2]);
    if (month >= 1 && month <= 12) {
      return `${matched[1]}-${String(month).padStart(2, "0")}-01`;
    }
  }
  if (/^\d{4}$/.test(normalized)) return `${normalized}-01-01`;
  return "";
}

function booleanValue(value: string) {
  const normalized = normalizeHeader(value);
  return ["예", "y", "yes", "true", "1", "필요"].includes(normalized);
}

function mapRows(rows: string[][], awardMode = false): ActivityImportRow[] {
  if (!rows.length) throw new Error("엑셀에 입력된 내용이 없습니다.");
  const organizationHeaders = new Set(
    ["기관명", "학교명", "기관", "학교", "시설명", "거래처명", "납품처"].map(
      normalizeHeader,
    ),
  );
  const activityTypeHeaders = new Set(
    ["활동 유형", "활동유형", "활동 구분", "활동구분"].map(normalizeHeader),
  );
  const headerRow = rows.findIndex((row) => {
    const normalized = row.map((value) => normalizeHeader(String(value)));
    return (
      normalized.some((header) => organizationHeaders.has(header)) &&
      (awardMode ||
        normalized.some((header) => activityTypeHeaders.has(header)))
    );
  });
  if (headerRow < 0) {
    throw new Error(
      awardMode
        ? "‘기관명’ 열을 찾지 못했습니다. 새 수주관리 양식을 사용해 주세요."
        : "‘기관명’과 ‘활동 유형’ 열을 찾지 못했습니다.",
    );
  }
  const indexes = new Map(
    rows[headerRow].map((header, index) => [
      normalizeHeader(String(header)),
      index,
    ]),
  );
  const findIndex = (...names: string[]) =>
    names
      .map(normalizeHeader)
      .map((name) => indexes.get(name))
      .find((index): index is number => index !== undefined);
  const indexByKey = new Map<string, number | undefined>();
  columns.forEach((column) => {
    indexByKey.set(
      column[0],
      column[0] === "budgetType"
        ? findIndex("예산", "예산명", "예산 종류", "budget_type")
        : column[0] === "budgetAmount"
          ? findIndex("예산금액", "예산 금액", "budget_amount")
          : column[0] === "awardCompany"
            ? findIndex("수주업체", "수주 업체", "실제 진행 주체", "award_company")
            : findIndex(column[1]),
    );
  });
  if (awardMode) {
    indexByKey.set(
      "activityDate",
      findIndex(
        "설치연월일",
        "설치 연월일",
        "설치일자",
        "설치일",
        "납품일자",
        "납품일",
        "수주연월",
        "수주 연월",
        "수주년월",
        "수주일자",
        "활동일자",
      ),
    );
    indexByKey.set("region", findIndex("지역", "권역", "소재지"));
    indexByKey.set(
      "organization",
      findIndex("기관명", "학교명", "기관", "학교", "시설명", "거래처명", "납품처"),
    );
    indexByKey.set(
      "businessRound",
      findIndex("사업 차수", "사업차수", "차수", "수주 차수"),
    );
    indexByKey.set(
      "address",
      findIndex(
        "주소",
        "기관주소",
        "학교주소",
        "도로명주소",
        "지번주소",
        "소재지주소",
      ),
    );
    indexByKey.set(
      "installedProducts",
      findIndex(
        "설치 장비",
        "설치장비",
        "설치물품",
        "설치 물품",
        "설치품목",
        "설치 품목",
        "설치제품",
        "납품품목",
        "장비",
        "제품",
        "품목",
      ),
    );
    indexByKey.set("budgetType", findIndex("예산", "예산명", "사업명"));
    indexByKey.set(
      "budgetAmount",
      findIndex(
        "예산금액(참고)",
        "예산금액",
        "예산 금액",
        "수주금액",
        "수주 금액",
        "금액",
      ),
    );
    indexByKey.set(
      "awardCompany",
      findIndex(
        "수주업체",
        "수주 업체",
        "수주업체명",
        "납품업체",
        "공급업체",
        "진행업체",
        "협력사",
        "업체명",
        "계약업체",
      ),
    );
    indexByKey.set(
      "awardCompletedDate",
      findIndex("납품 완료일", "납품완료일", "설치 완료일", "설치완료일"),
    );
    indexByKey.set("awardYear", findIndex("수주연도", "수주년도", "연도", "년도"));
    indexByKey.set("awardMonth", findIndex("수주월", "월"));
  }
  const valueAt = (row: string[], key: string) => {
    const index = indexByKey.get(key);
    return index === undefined ? "" : String(row[index] ?? "").trim();
  };
  const mapped = rows
    .slice(headerRow + 1)
    .map((row, index): ActivityImportRow | null => {
      const rowNumber = headerRow + index + 2;
      if (/^\[?예시(?:—|-|:|\s)/.test(valueAt(row, "organization"))) {
        return null;
      }
      const rawActivityDate = valueAt(row, "activityDate");
      const rawFollowUpDate = valueAt(row, "followUpDate");
      const activityDate = awardMode
        ? normalizeAwardMonth(
            rawActivityDate,
            valueAt(row, "awardYear"),
            valueAt(row, "awardMonth"),
          )
        : normalizeDate(rawActivityDate);
      const followUpDate = normalizeDate(rawFollowUpDate);
      const rawBusinessRound = valueAt(row, "businessRound");
      const parsedBusinessRound = Number(rawBusinessRound || 1);
      const awardCompletedDate = normalizeDate(
        valueAt(row, "awardCompletedDate"),
      );
      const organization = canonicalInstitutionName(valueAt(row, "organization"));
      const installedProducts = valueAt(row, "installedProducts");
      const address = valueAt(row, "address");
      const values: ActivityImportValues = {
        activityDate,
        dateConfidence:
          awardMode && activityDate.endsWith("-01") ? "연월 확인" : "확정",
        activityType: awardMode ? "수주" : valueAt(row, "activityType"),
        category: valueAt(row, "category"),
        contactMethod: awardMode
          ? "기타"
          : valueAt(row, "contactMethod") || "유선",
        region: valueAt(row, "region") || regionFromAddress(address),
        organization,
        businessRound:
          Number.isSafeInteger(parsedBusinessRound) &&
          parsedBusinessRound >= 1 &&
          parsedBusinessRound <= 99
            ? parsedBusinessRound
            : 1,
        budgetType: valueAt(row, "budgetType"),
        budgetAmount: valueAt(row, "budgetAmount"),
        topic: awardMode ? installedProducts || "수주" : valueAt(row, "topic"),
        summary: awardMode
          ? installedProducts
            ? `${installedProducts} 수주 등록`
            : `${organization || "기관"} 수주현황 등록`
          : valueAt(row, "summary"),
        status: "상담 진행",
        temperature: valueAt(row, "temperature") || "중간",
        awardStatus: valueAt(row, "awardStatus") || "미정",
        awardCompany: valueAt(row, "awardCompany"),
        executionType: valueAt(row, "executionType") || "직영",
        consortiumCompany: valueAt(row, "consortiumCompany"),
        awardStage: valueAt(row, "awardStage") || "미정",
        awardCompletedDate,
        progressManager: valueAt(row, "progressManager"),
        followUpRequired: booleanValue(valueAt(row, "followUpRequired")),
        followUpDate,
        nextAction: valueAt(row, "nextAction"),
        progressSchedule: valueAt(row, "progressSchedule"),
        contactRole: valueAt(row, "contactRole"),
        contactName: valueAt(row, "contactName"),
        contactPhone: valueAt(row, "contactPhone"),
        contactEmail: valueAt(row, "contactEmail"),
        sourceChat: awardMode ? "수주 관리 엑셀 등록" : "엑셀 대량 등록",
        notes: awardMode && address
          ? `주소: ${address}`
          : valueAt(row, "notes"),
        address,
        installedProducts,
      };
      if (values.awardStatus === "타업체 수주") {
        values.executionType = "해당 없음";
        values.consortiumCompany = "";
        values.awardStage = "해당 없음";
      } else {
        if (values.executionType === "해당 없음") values.executionType = "직영";
        values.awardStage =
          values.awardStage === "해당 없음"
            ? "미정"
            : normalizeAwardStage(values.awardStage, values.awardStatus);
      }
      values.awardCompletedDate =
        values.awardStage === COMPLETED_AWARD_STAGE
          ? values.awardCompletedDate || values.activityDate
          : "";
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!values.activityDate && !awardMode) {
        errors.push(
          rawActivityDate
            ? "활동일자 형식이 올바르지 않습니다."
            : "활동일자가 필요합니다.",
        );
      }
      if (!values.organization) errors.push("기관명이 필요합니다.");
      if (
        rawBusinessRound &&
        (!Number.isSafeInteger(parsedBusinessRound) ||
          parsedBusinessRound < 1 ||
          parsedBusinessRound > 99)
      ) {
        errors.push("사업 차수는 1~99 사이의 정수여야 합니다.");
      }
      if (!values.activityType) {
        errors.push("활동 유형이 필요합니다.");
      } else if (!awardMode && !activityTypes.includes(values.activityType)) {
        errors.push("활동 유형을 선택값 안내에 맞춰 입력해 주세요.");
      }
      if (!values.summary) errors.push("상담 내용이 필요합니다.");
      if (awardMode && !activityDate) {
        warnings.push("수주연월이 없어 저장일 기준으로 자동 보완합니다.");
      }
      if (awardMode && !installedProducts) {
        warnings.push("설치물품이 비어 있습니다.");
      }
      if (awardMode && address && !values.region) {
        warnings.push("주소에서 지역을 판별하지 못했습니다. 미리보기에서 지역을 확인해 주세요.");
      }
      if (awardMode && !address) {
        warnings.push("주소가 없어 지도 위치는 기관명으로 확인합니다.");
      }
      if (awardMode && !values.awardCompany) {
        warnings.push("수주업체가 없어 수주 구분을 미정으로 저장합니다.");
      }
      if (values.category && !categories.includes(values.category)) {
        errors.push("기관 구분을 선택값 안내에 맞춰 입력해 주세요.");
      }
      if (!contactMethods.includes(values.contactMethod)) {
        errors.push("컨택 유형을 선택값 안내에 맞춰 입력해 주세요.");
      }
      if (!temperatures.includes(values.temperature)) {
        errors.push("관심도를 선택값 안내에 맞춰 입력해 주세요.");
      }
      if (!awardStatuses.includes(values.awardStatus)) {
        errors.push("수주 구분을 선택값 안내에 맞춰 입력해 주세요.");
      }
      if (["협력사 수주", "타업체 수주"].includes(values.awardStatus) && !values.awardCompany) {
        warnings.push("수주업체가 비어 있어 미리보기에서 확인해야 합니다.");
      }
      if (!executionTypes.includes(values.executionType)) {
        errors.push("사업방식을 선택값 안내에 맞춰 입력해 주세요.");
      }
      if (values.executionType === "컨소" && !values.consortiumCompany) {
        errors.push("컨소 업체명이 필요합니다.");
      }
      if (!(awardStages as readonly string[]).includes(values.awardStage)) {
        errors.push("현재 상태를 선택값 안내에 맞춰 입력해 주세요.");
      }
      if (rawFollowUpDate && !followUpDate) {
        errors.push("재연락 예정일 형식이 올바르지 않습니다.");
      }
      if (followUpDate && !values.followUpRequired) {
        values.followUpRequired = true;
        warnings.push("재연락 예정일이 있어 재연락 필요로 자동 표시합니다.");
      }
      if (
        values.contactEmail &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contactEmail)
      ) {
        errors.push("기관 메일 형식이 올바르지 않습니다.");
      }
      return { rowNumber, values, errors, warnings };
    })
    .filter(
      (row): row is ActivityImportRow =>
        Boolean(
          row &&
            (row.values.organization ||
              row.values.activityType ||
              row.values.summary ||
              row.values.topic),
        ),
    );
  if (!mapped.length) {
    throw new Error("‘기록 입력’ 시트에 작성된 기록이 없습니다.");
  }
  if (mapped.length > 5_000) {
    throw new Error("한 번에 최대 5,000건까지 등록할 수 있습니다.");
  }
  return mapped;
}

export async function parseActivityImportFile(
  file: File,
  options: { awardMode?: boolean } = {},
) {
  const lowerName = file.name.toLocaleLowerCase();
  if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".csv")) {
    throw new Error("엑셀(.xlsx) 또는 CSV 파일을 선택해 주세요.");
  }
  const rows = lowerName.endsWith(".csv")
    ? parseCsv((await file.text()).replace(/^\uFEFF/, ""))
    : parseXlsx(await file.arrayBuffer());
  return mapRows(rows, Boolean(options.awardMode));
}
