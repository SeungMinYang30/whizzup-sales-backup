import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { canonicalInstitutionName } from "../lib/institution-names";

export type CampaignImportRow = {
  clientId?: string;
  organization: string;
  address: string;
  phone: string;
  contactName: string;
  region: string;
  notes: string;
  assignedMemberName: string;
  schoolLevel: string;
  supplyItems: string;
  budgetAmount: string;
  reviewNote: string;
  existingOrganizations: string[];
  confirmedOrganization: string;
  businessMatchMode: "auto" | "link-current" | "new" | "list-only";
  linkedActivityId?: number | null;
  updateLinkedBudget?: boolean;
};

const headers = [
  "기관명",
  "주소",
  "전화번호",
  "기관 담당자",
  "지역",
  "메모",
  "영업 담당자",
  "학교급·기관 구분",
  "지원·공급 내용",
  "기관별 예산",
];

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

function buildTemplateFiles() {
  const headerCells = headers
    .map((header, index) => inlineCell(`${columnName(index)}1`, header, 1))
    .join("");
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="24" customWidth="1"/>
    <col min="2" max="2" width="42" customWidth="1"/>
    <col min="3" max="4" width="18" customWidth="1"/>
    <col min="5" max="5" width="14" customWidth="1"/>
    <col min="6" max="6" width="34" customWidth="1"/>
    <col min="7" max="7" width="18" customWidth="1"/>
    <col min="8" max="8" width="18" customWidth="1"/>
    <col min="9" max="9" width="28" customWidth="1"/>
    <col min="10" max="10" width="18" customWidth="1"/>
  </cols>
  <sheetData><row r="1" ht="24" customHeight="1">${headerCells}</row></sheetData>
  <autoFilter ref="A1:J1"/>
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
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="영업대상 입력" sheetId="1" r:id="rId1"/></sheets>
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
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const now = new Date().toISOString();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>WHIZZUP 영업지도 등록 양식</dc:title><dc:creator>WHIZZUP</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
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
    "xl/worksheets/sheet1.xml": strToU8(worksheet),
  };
}

export function downloadCampaignTemplate() {
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
  anchor.download = "WHIZZUP_영업지도_등록양식.xlsx";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseXlsx(buffer: ArrayBuffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const sheetPath =
    Object.keys(files).find((path) => path === "xl/worksheets/sheet1.xml") ??
    Object.keys(files).find((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path));
  if (!sheetPath) throw new Error("엑셀의 첫 번째 시트를 찾지 못했습니다.");
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

function mapRows(rows: string[][]) {
  if (!rows.length) throw new Error("엑셀에 입력된 내용이 없습니다.");
  const organizationHeaders = new Set([
    "기관명",
    "학교명",
    "시설명",
    "선정기관",
    "대상기관",
  ].map(normalizeHeader));
  const headerRow = rows.findIndex((row) =>
    row.some((value) => organizationHeaders.has(normalizeHeader(String(value)))),
  );
  if (headerRow < 0) {
    throw new Error("첫 행에서 ‘기관명’ 열을 찾지 못했습니다.");
  }
  const indexes = new Map<string, number>();
  for (let index = 0; index < rows[headerRow].length; index += 1) {
    const header = rows[headerRow][index];
    if (header === undefined || header === null) continue;
    const normalized = normalizeHeader(String(header));
    if (normalized && !indexes.has(normalized)) {
      indexes.set(normalized, index);
    }
  }
  const findIndex = (...names: string[]) =>
    names.map(normalizeHeader).map((name) => indexes.get(name)).find(
      (index): index is number => index !== undefined,
    );
  const organizationIndex = findIndex(
    "기관명",
    "학교명",
    "시설명",
    "선정기관",
    "대상기관",
  );
  if (organizationIndex === undefined) {
    throw new Error("기관명 열은 반드시 필요합니다.");
  }
  const addressIndex = findIndex("주소", "도로명주소", "지번주소");
  const phoneIndex = findIndex("전화번호", "전화", "기관전화");
  const contactNameIndex = findIndex("기관 담당자", "기관담당자", "담당자");
  const regionIndex = findIndex("지역", "소재지");
  const provinceIndex = findIndex("시도", "광역시도", "광역자치단체");
  const municipalityIndex = findIndex(
    "시군구",
    "시·군·구",
    "시군",
    "기초자치단체",
  );
  const notesIndex = findIndex("메모", "비고", "참고사항");
  const assigneeIndex = findIndex("영업 담당자", "영업담당자", "담당 영업");
  const schoolLevelIndex = findIndex(
    "학교급·기관 구분",
    "학교급",
    "기관구분",
    "시설구분",
    "분류",
  );
  const supplyItemsIndex = findIndex(
    "지원·공급 내용",
    "지원내용",
    "공급내용",
    "선정유형",
    "구축형태",
    "지원품목",
  );
  const budgetAmountIndex = findIndex(
    "기관별 예산",
    "기관별예산",
    "예산액",
    "지원금액",
    "금액",
  );
  const valueAt = (row: string[], index: number | undefined) =>
    index === undefined ? "" : String(row[index] ?? "").trim();
  let previousProvince = "";
  let previousMunicipality = "";
  const mapped = rows
    .slice(headerRow + 1)
    .map((row) => {
      const province = valueAt(row, provinceIndex) || previousProvince;
      const municipality =
        valueAt(row, municipalityIndex) || previousMunicipality;
      if (valueAt(row, provinceIndex)) previousProvince = province;
      if (valueAt(row, municipalityIndex)) {
        previousMunicipality = municipality;
      }
      const explicitRegion = valueAt(row, regionIndex);
      return {
        organization: canonicalInstitutionName(
          valueAt(row, organizationIndex),
        ),
        address: valueAt(row, addressIndex),
        phone: valueAt(row, phoneIndex),
        contactName: valueAt(row, contactNameIndex),
        region:
          explicitRegion ||
          [province, municipality].filter(Boolean).join(" ").trim(),
        notes: valueAt(row, notesIndex),
        assignedMemberName: valueAt(row, assigneeIndex),
        schoolLevel: valueAt(row, schoolLevelIndex),
        supplyItems: valueAt(row, supplyItemsIndex),
        budgetAmount: valueAt(row, budgetAmountIndex),
        reviewNote: "",
        existingOrganizations: [],
        confirmedOrganization: "",
        businessMatchMode: "auto" as const,
      };
    })
    .filter((row) => row.organization);
  const deduplicated = [
    ...new Map(
      mapped.map((row) => [
        row.organization.replace(/\s+/g, "").toLocaleLowerCase("ko-KR"),
        row,
      ]),
    ).values(),
  ];
  if (!deduplicated.length) {
    throw new Error("기관명이 입력된 행이 없습니다.");
  }
  return deduplicated;
}

export async function parseCampaignFile(file: File) {
  const lowerName = file.name.toLocaleLowerCase();
  const rows = lowerName.endsWith(".csv")
    ? parseCsv((await file.text()).replace(/^\uFEFF/, ""))
    : parseXlsx(await file.arrayBuffer());
  return mapRows(rows);
}
