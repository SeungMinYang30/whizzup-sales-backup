import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { canonicalInstitutionName } from "../lib/institution-names";

export type ActivityImportValues = {
  activityDate: string;
  dateConfidence: string;
  activityType: string;
  category: string;
  contactMethod: string;
  region: string;
  organization: string;
  budgetType: string;
  budgetAmount: string;
  topic: string;
  summary: string;
  status: string;
  temperature: string;
  awardStatus: string;
  awardCompany: string;
  executionType: string;
  consortiumCompany: string;
  awardStage: string;
  progressManager: string;
  followUpRequired: boolean;
  followUpDate: string;
  nextAction: string;
  progressSchedule: string;
  contactRole: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  sourceChat: string;
  notes: string;
};

export type ActivityImportRow = {
  rowNumber: number;
  values: ActivityImportValues;
  errors: string[];
  warnings: string[];
};

const activityTypes = [
  "TM",
  "TM·통화",
  "영업 대상",
  "학교 미팅",
  "학교 진행 중",
  "기관 미팅",
  "협력사 미팅",
  "방문 미팅",
  "업무 통화",
  "제품 통화",
  "계약 통화",
  "수주",
  "AS 통화",
  "기타",
];
const categories = ["학교", "기관", "협력사", "내부", "기타"];
const contactMethods = ["유선", "방문", "온라인", "진행 공유", "기타"];
const temperatures = ["높음", "중간", "낮음"];
const awardStatuses = ["미정", "위즈업 수주", "타업체 수주"];
const executionTypes = ["직영", "컨소"];
const awardStages = [
  "미정",
  "품의",
  "협상",
  "계약",
  "일정 조율",
  "완공",
  "검수",
  "교육",
];

const columns = [
  ["activityDate", "활동일자", true, "YYYY-MM-DD 형식으로 입력합니다.", "2026-07-18", 14],
  ["organization", "기관명", true, "학교·기관·협력사 이름을 입력합니다.", "제일초등학교", 24],
  ["activityType", "활동 유형", true, "선택값 안내 시트의 활동 유형 중 하나를 입력합니다.", "TM·통화", 16],
  ["summary", "상담 내용", true, "통화·미팅에서 확인한 핵심 내용을 입력합니다.", "전자칠판 교체 계획 확인, 다음 주 제안서 전달", 46],
  ["category", "기관 구분", false, "미입력 시 학교로 저장됩니다.", "학교", 14],
  ["region", "지역", false, "예: 경기 성남, 충북 청주", "경기 성남", 16],
  ["contactMethod", "컨택 유형", false, "미입력 시 유선으로 저장됩니다.", "유선", 14],
  ["topic", "주제", false, "제품, 사업명 또는 논의 주제를 입력합니다.", "전자칠판 교체", 24],
  ["budgetType", "예산 종류", false, "예: 자체예산, 늘봄, 교육청 예산", "자체예산", 18],
  ["budgetAmount", "예산 금액", false, "단위를 포함해도 됩니다.", "2,480만원", 16],
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
  ["awardCompany", "수주 업체명", false, "타업체 수주일 때 반드시 입력합니다.", "", 20],
  ["executionType", "사업방식", false, "미입력 시 직영으로 저장됩니다.", "직영", 14],
  ["consortiumCompany", "컨소 업체명", false, "사업방식이 컨소일 때 반드시 입력합니다.", "", 20],
  ["awardStage", "현재 상태", false, "수주 후 진행 상태를 입력합니다.", "미정", 16],
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

function buildTemplateFiles() {
  const inputRows = [columns.map((column) => column[1])];
  const guideRows = [
    ["항목", "필수 여부", "작성 방법", "입력 예시"],
    ...columns.map((column) => [
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
  const lastColumn = columnName(columns.length - 1);
  const sheet1 = worksheetXml(
    inputRows,
    columns.map((column) => column[5]),
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
  <dc:title>WHIZZUP 새 기록 대량 등록 양식</dc:title><dc:creator>WHIZZUP</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
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

function booleanValue(value: string) {
  const normalized = normalizeHeader(value);
  return ["예", "y", "yes", "true", "1", "필요"].includes(normalized);
}

function mapRows(rows: string[][]): ActivityImportRow[] {
  if (!rows.length) throw new Error("엑셀에 입력된 내용이 없습니다.");
  const headerRow = rows.findIndex((row) => {
    const normalized = row.map((value) => normalizeHeader(String(value)));
    return normalized.includes("기관명") && normalized.includes("활동유형");
  });
  if (headerRow < 0) {
    throw new Error("‘기관명’과 ‘활동 유형’ 열을 찾지 못했습니다.");
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
    indexByKey.set(column[0], findIndex(column[1]));
  });
  const valueAt = (row: string[], key: string) => {
    const index = indexByKey.get(key);
    return index === undefined ? "" : String(row[index] ?? "").trim();
  };
  const mapped = rows
    .slice(headerRow + 1)
    .map((row, index) => {
      const rowNumber = headerRow + index + 2;
      const rawActivityDate = valueAt(row, "activityDate");
      const rawFollowUpDate = valueAt(row, "followUpDate");
      const activityDate = normalizeDate(rawActivityDate);
      const followUpDate = normalizeDate(rawFollowUpDate);
      const values: ActivityImportValues = {
        activityDate,
        dateConfidence: "확정",
        activityType: valueAt(row, "activityType"),
        category: valueAt(row, "category") || "학교",
        contactMethod: valueAt(row, "contactMethod") || "유선",
        region: valueAt(row, "region"),
        organization: canonicalInstitutionName(valueAt(row, "organization")),
        budgetType: valueAt(row, "budgetType"),
        budgetAmount: valueAt(row, "budgetAmount"),
        topic: valueAt(row, "topic"),
        summary: valueAt(row, "summary"),
        status: "진행 중",
        temperature: valueAt(row, "temperature") || "중간",
        awardStatus: valueAt(row, "awardStatus") || "미정",
        awardCompany: valueAt(row, "awardCompany"),
        executionType: valueAt(row, "executionType") || "직영",
        consortiumCompany: valueAt(row, "consortiumCompany"),
        awardStage: valueAt(row, "awardStage") || "미정",
        progressManager: valueAt(row, "progressManager"),
        followUpRequired: booleanValue(valueAt(row, "followUpRequired")),
        followUpDate,
        nextAction: valueAt(row, "nextAction"),
        progressSchedule: valueAt(row, "progressSchedule"),
        contactRole: valueAt(row, "contactRole"),
        contactName: valueAt(row, "contactName"),
        contactPhone: valueAt(row, "contactPhone"),
        contactEmail: valueAt(row, "contactEmail"),
        sourceChat: "엑셀 대량 등록",
        notes: valueAt(row, "notes"),
      };
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!values.activityDate) {
        errors.push(
          rawActivityDate
            ? "활동일자 형식이 올바르지 않습니다."
            : "활동일자가 필요합니다.",
        );
      }
      if (!values.organization) errors.push("기관명이 필요합니다.");
      if (!values.activityType) {
        errors.push("활동 유형이 필요합니다.");
      } else if (!activityTypes.includes(values.activityType)) {
        errors.push("활동 유형을 선택값 안내에 맞춰 입력해 주세요.");
      }
      if (!values.summary) errors.push("상담 내용이 필요합니다.");
      if (!categories.includes(values.category)) {
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
      if (values.awardStatus === "타업체 수주" && !values.awardCompany) {
        errors.push("타업체 수주 업체명이 필요합니다.");
      }
      if (!executionTypes.includes(values.executionType)) {
        errors.push("사업방식을 선택값 안내에 맞춰 입력해 주세요.");
      }
      if (values.executionType === "컨소" && !values.consortiumCompany) {
        errors.push("컨소 업체명이 필요합니다.");
      }
      if (!awardStages.includes(values.awardStage)) {
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
      (row) =>
        row.values.organization ||
        row.values.activityType ||
        row.values.summary ||
        row.values.topic,
    );
  if (!mapped.length) {
    throw new Error("‘기록 입력’ 시트에 작성된 기록이 없습니다.");
  }
  if (mapped.length > 500) {
    throw new Error("한 번에 최대 500건까지 등록할 수 있습니다.");
  }
  return mapped;
}

export async function parseActivityImportFile(file: File) {
  const lowerName = file.name.toLocaleLowerCase();
  if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".csv")) {
    throw new Error("엑셀(.xlsx) 또는 CSV 파일을 선택해 주세요.");
  }
  const rows = lowerName.endsWith(".csv")
    ? parseCsv((await file.text()).replace(/^\uFEFF/, ""))
    : parseXlsx(await file.arrayBuffer());
  return mapRows(rows);
}
