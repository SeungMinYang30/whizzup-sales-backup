import { zipSync } from "fflate";

export type QuotationLine = {
  name: string;
  specification: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  note: string;
};

export type QuotationWorkbookInput = {
  customerName: string;
  quoteDate: string;
  projectTitle: string;
  lines: QuotationLine[];
};

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const encodeXml = (value: string) => new TextEncoder().encode(value);

function inlineCell(ref: string, value: unknown, style = 0) {
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numberCell(ref: string, value: number, style = 0) {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

const SMALL_UNITS = ["", "십", "백", "천"];
const LARGE_UNITS = ["", "만", "억", "조"];
const DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];

function readFourDigits(value: number) {
  let result = "";
  for (let position = 3; position >= 0; position -= 1) {
    const divisor = 10 ** position;
    const digit = Math.floor(value / divisor) % 10;
    if (!digit) continue;
    if (!(digit === 1 && position > 0)) result += DIGITS[digit];
    result += SMALL_UNITS[position];
  }
  return result;
}

function amountInKorean(value: number) {
  const amount = Math.max(0, Math.round(value));
  if (!amount) return "금 영원정";
  let remaining = amount;
  let group = 0;
  let result = "";
  while (remaining > 0) {
    const part = remaining % 10000;
    if (part) result = `${readFourDigits(part)}${LARGE_UNITS[group]}${result}`;
    remaining = Math.floor(remaining / 10000);
    group += 1;
  }
  return `금 ${result}원정`;
}

function buildSheet(input: QuotationWorkbookInput) {
  const startRow = 9;
  const lineCount = Math.max(input.lines.length, 8);
  const totalRow = startRow + lineCount;
  const noteRow = totalRow + 2;
  const total = input.lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice,
    0,
  );
  const itemRows = Array.from({ length: lineCount }, (_, index) => {
    const row = startRow + index;
    const line = input.lines[index];
    if (!line) {
      return `<row r="${row}" ht="30" customHeight="1">${Array.from(
        { length: 8 },
        (_, column) => inlineCell(`${String.fromCharCode(65 + column)}${row}`, "", 7),
      ).join("")}</row>`;
    }
    return `<row r="${row}" ht="30" customHeight="1">
      ${numberCell(`A${row}`, index + 1, 8)}
      ${inlineCell(`B${row}`, line.name, 7)}
      ${inlineCell(`C${row}`, line.specification, 7)}
      ${numberCell(`D${row}`, line.quantity, 8)}
      ${inlineCell(`E${row}`, line.unit || "식", 8)}
      ${numberCell(`F${row}`, line.unitPrice, 9)}
      ${numberCell(`G${row}`, line.quantity * line.unitPrice, 9)}
      ${inlineCell(`H${row}`, line.note, 7)}
    </row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:H${noteRow + 2}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>
    <col min="1" max="1" width="7" customWidth="1"/>
    <col min="2" max="2" width="27" customWidth="1"/>
    <col min="3" max="3" width="44" customWidth="1"/>
    <col min="4" max="4" width="9" customWidth="1"/>
    <col min="5" max="5" width="9" customWidth="1"/>
    <col min="6" max="7" width="17" customWidth="1"/>
    <col min="8" max="8" width="24" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1" ht="44" customHeight="1">${inlineCell("A1", "견 적 서", 1)}</row>
    <row r="3" ht="26" customHeight="1">
      ${inlineCell("A3", "견적일", 3)}${inlineCell("B3", input.quoteDate, 4)}
      ${inlineCell("F3", "공급자", 3)}${inlineCell("G3", "(주)위즈업", 4)}
    </row>
    <row r="4" ht="26" customHeight="1">
      ${inlineCell("A4", "수신", 3)}${inlineCell("B4", `${input.customerName} 귀중`, 4)}
      ${inlineCell("F4", "구분", 3)}${inlineCell("G4", "견적서", 4)}
    </row>
    <row r="5" ht="26" customHeight="1">
      ${inlineCell("A5", "사업명", 3)}${inlineCell("B5", input.projectTitle || "제품 공급", 4)}
    </row>
    <row r="7" ht="28" customHeight="1">${inlineCell("A7", amountInKorean(total), 5)}</row>
    <row r="8" ht="32" customHeight="1">
      ${inlineCell("A8", "순번", 6)}${inlineCell("B8", "품명", 6)}${inlineCell("C8", "규격", 6)}
      ${inlineCell("D8", "수량", 6)}${inlineCell("E8", "단위", 6)}${inlineCell("F8", "단가", 6)}
      ${inlineCell("G8", "금액", 6)}${inlineCell("H8", "비고", 6)}
    </row>
    ${itemRows}
    <row r="${totalRow}" ht="34" customHeight="1">
      ${inlineCell(`A${totalRow}`, "합계", 10)}${numberCell(`F${totalRow}`, total, 11)}
    </row>
    <row r="${noteRow}" ht="26" customHeight="1">${inlineCell(`A${noteRow}`, "※ 위 금액은 부가가치세가 포함된 금액입니다.", 12)}</row>
  </sheetData>
  <mergeCells count="10">
    <mergeCell ref="A1:H1"/><mergeCell ref="B3:E3"/><mergeCell ref="G3:H3"/>
    <mergeCell ref="B4:E4"/><mergeCell ref="G4:H4"/><mergeCell ref="B5:H5"/>
    <mergeCell ref="A7:H7"/><mergeCell ref="A${totalRow}:E${totalRow}"/>
    <mergeCell ref="F${totalRow}:H${totalRow}"/><mergeCell ref="A${noteRow}:H${noteRow}"/>
  </mergeCells>
  <pageMargins left="0.3" right="0.3" top="0.45" bottom="0.45" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="1" paperSize="9"/>
</worksheet>`;
}

export function createQuotationWorkbook(input: QuotationWorkbookInput) {
  const now = new Date().toISOString();
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`),
    "_rels/.rels": encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`),
    "xl/workbook.xml": encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="견적서" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/worksheets/sheet1.xml": encodeXml(buildSheet(input)),
    "xl/styles.xml": encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,#0&quot;원&quot;"/></numFmts>
  <fonts count="4">
    <font><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="24"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="11"/><name val="맑은 고딕"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF263A73"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF0FF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB8C3DA"/></left><right style="thin"><color rgb="FFB8C3DA"/></right><top style="thin"><color rgb="FFB8C3DA"/></top><bottom style="thin"><color rgb="FFB8C3DA"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="13">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`),
    "docProps/core.xml": encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(input.customerName)} 견적서</dc:title><dc:creator>WHIZZUP</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`),
    "docProps/app.xml": encodeXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WHIZZUP Sales Hub</Application></Properties>`),
  };
  return zipSync(files, { level: 6 });
}
