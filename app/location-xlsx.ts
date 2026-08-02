import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type LocationImportRow = {
  organization: string;
  searchTerms: string;
  address: string;
  latitude: string;
  longitude: string;
  note: string;
};

const headers = ["기관명", "검색 명칭", "주소", "비고"];

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

function workbookFiles(rows: LocationImportRow[]) {
  const headerCells = headers
    .map((header, index) => inlineCell(`${columnName(index)}1`, header, 1))
    .join("");
  const dataRows = rows
    .map((row, rowIndex) => {
      const values = [
        row.organization,
        row.searchTerms,
        row.address,
        row.note,
      ];
      const cells = values
        .map((value, columnIndex) =>
          inlineCell(`${columnName(columnIndex)}${rowIndex + 2}`, value),
        )
        .join("");
      return `<row r="${rowIndex + 2}">${cells}</row>`;
    })
    .join("");
  const lastRow = Math.max(1, rows.length + 1);
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="28" customWidth="1"/>
    <col min="2" max="2" width="48" customWidth="1"/>
    <col min="3" max="3" width="52" customWidth="1"/>
    <col min="4" max="4" width="30" customWidth="1"/>
  </cols>
  <sheetData><row r="1" ht="24" customHeight="1">${headerCells}</row>${dataRows}</sheetData>
  <autoFilter ref="A1:D${lastRow}"/>
</worksheet>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="위치 일괄 편집" sheetId="1" r:id="rId1"/></sheets>
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
  return {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
    "xl/styles.xml": strToU8(styles),
    "xl/worksheets/sheet1.xml": strToU8(worksheet),
  };
}

export function downloadLocationWorkbook(rows: LocationImportRow[]) {
  const data = zipSync(workbookFiles(rows), { level: 6 });
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
  anchor.download = `WHIZZUP_미매칭_위치_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
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
    const document = parser.parseFromString(
      strFromU8(files["xl/sharedStrings.xml"]),
      "application/xml",
    );
    Array.from(document.getElementsByTagName("si")).forEach((item) => {
      shared.push(
        Array.from(item.getElementsByTagName("t"))
          .map((text) => text.textContent ?? "")
          .join(""),
      );
    });
  }
  const document = parser.parseFromString(
    strFromU8(files[sheetPath]),
    "application/xml",
  );
  return Array.from(document.getElementsByTagName("row")).map((row) => {
    const cells: string[] = [];
    Array.from(row.getElementsByTagName("c")).forEach((cell) => {
      const letters = (cell.getAttribute("r") ?? "A1").match(/[A-Z]+/)?.[0] ?? "A";
      let column = 0;
      for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
      const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      const type = cell.getAttribute("t");
      cells[column - 1] =
        type === "s"
          ? shared[Number(raw)] ?? ""
          : type === "inlineStr"
            ? Array.from(cell.getElementsByTagName("t"))
                .map((text) => text.textContent ?? "")
                .join("")
            : raw;
    });
    return cells;
  });
}

function normalizedHeader(value: string) {
  return value.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function mapRows(rows: string[][]) {
  const headerRow = rows.findIndex((row) =>
    row.some((value) => normalizedHeader(String(value)) === "기관명"),
  );
  if (headerRow < 0) throw new Error("첫 행에서 ‘기관명’ 열을 찾지 못했습니다.");
  const indexes = new Map(
    rows[headerRow].map((header, index) => [normalizedHeader(String(header)), index]),
  );
  const find = (...names: string[]) =>
    names
      .map(normalizedHeader)
      .map((name) => indexes.get(name))
      .find((index): index is number => index !== undefined);
  const organizationIndex = find("기관명", "학교명");
  if (organizationIndex === undefined) throw new Error("기관명 열은 반드시 필요합니다.");
  const searchIndex = find("검색 명칭", "검색명칭", "검색어", "별칭");
  const addressIndex = find("주소", "도로명주소", "지번주소");
  const latitudeIndex = find("위도", "latitude", "lat");
  const longitudeIndex = find("경도", "longitude", "lng", "lon");
  const noteIndex = find("비고", "메모");
  const valueAt = (row: string[], index: number | undefined) =>
    index === undefined ? "" : String(row[index] ?? "").trim();
  const mapped = rows
    .slice(headerRow + 1)
    .map((row) => ({
      organization: valueAt(row, organizationIndex),
      searchTerms: valueAt(row, searchIndex),
      address: valueAt(row, addressIndex),
      latitude: valueAt(row, latitudeIndex),
      longitude: valueAt(row, longitudeIndex),
      note: valueAt(row, noteIndex),
    }))
    .filter((row) => row.organization);
  if (!mapped.length) throw new Error("기관명이 입력된 행이 없습니다.");
  return [...new Map(mapped.map((row) => [row.organization, row])).values()];
}

export async function parseLocationFile(file: File) {
  const rows = file.name.toLocaleLowerCase().endsWith(".csv")
    ? parseCsv((await file.text()).replace(/^\uFEFF/, ""))
    : parseXlsx(await file.arrayBuffer());
  return mapRows(rows);
}
