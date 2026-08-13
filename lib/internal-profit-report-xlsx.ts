import { zipSync } from "fflate";

export type InternalProfitReportWorkbookInput = {
  organization: string;
  projectTitle: string;
  quoteNumber: string;
  quoteDate: string;
  executionType: "직영" | "컨소";
  consortiumCompany: string;
  total: number;
  earning: number;
  consortium: number;
  internalCost: number;
  margin: number;
  marginRate: number;
  rows: Array<{
    number: number;
    name: string;
    specification: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    complimentary: boolean;
    amount: number;
    baseRate: number;
    baseEarning: number;
    earning: number;
    consortiumRate: number;
    consortium: number;
    internalCostDisplay: number;
    netProfit: number;
    status: string;
  }>;
};

const xml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
const bytes = (value: string) => new TextEncoder().encode(value);
const textCell = (ref: string, value: unknown, style = 0) => `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
const numberCell = (ref: string, value: number, style = 0) => `<c r="${ref}" s="${style}"><v>${Math.round(value)}</v></c>`;
const rateCell = (ref: string, value: number, style = 0) => `<c r="${ref}" s="${style}"><v>${Math.max(0, Math.min(1, value))}</v></c>`;
const formulaCell = (ref: string, expression: string, cached: number, style = 0) => `<c r="${ref}" s="${style}"><f>${xml(expression)}</f><v>${Math.round(cached)}</v></c>`;
const blanks = (row: number, columns: string[], style: number) => columns.map((column) => textCell(`${column}${row}`, "", style)).join("");

function sheetXml(input: InternalProfitReportWorkbookInput) {
  const firstRow = 15;
  const lastRow = firstRow + Math.max(1, input.rows.length) - 1;
  const summaryRow = lastRow + 2;
  const endRow = summaryRow + 4;
  const itemRows = input.rows.length ? input.rows.map((item, index) => {
    const row = firstRow + index;
    const label = item.specification ? `${item.name}\n${item.specification}` : item.name;
    return `<row r="${row}" ht="42" customHeight="1">${numberCell(`A${row}`, item.number, 8)}${textCell(`B${row}`, label, 9)}${numberCell(`C${row}`, item.quantity, 8)}${textCell(`D${row}`, item.unit, 8)}${numberCell(`E${row}`, item.unitPrice, 10)}${item.complimentary ? numberCell(`F${row}`, 0, 10) : formulaCell(`F${row}`, `C${row}*E${row}`, item.amount, 10)}${rateCell(`G${row}`, item.baseRate, 11)}${formulaCell(`H${row}`, `FLOOR(F${row}*G${row},10)`, item.baseEarning, 10)}${numberCell(`I${row}`, item.earning, 10)}${rateCell(`J${row}`, item.consortiumRate, 11)}${numberCell(`K${row}`, item.consortium, 12)}${numberCell(`L${row}`, item.internalCostDisplay, 12)}${formulaCell(`M${row}`, `I${row}-K${row}-L${row}`, item.netProfit, 13)}${textCell(`N${row}`, item.complimentary ? "무상 제공" : item.status, 8)}</row>`;
  }).join("") : `<row r="${firstRow}" ht="36" customHeight="1">${textCell(`A${firstRow}`, "", 8)}${textCell(`B${firstRow}`, "품목이 없습니다.", 9)}${blanks(firstRow, ["C","D","E","F","G","H","I","J","K","L","M","N"], 8)}</row>`;
  const merges = ["A2:N3", "A5:B5", "C5:G5", "H5:I5", "J5:N5", "A6:B6", "C6:G6", "H6:I6", "J6:N6", "A7:B7", "C7:G7", "H7:I7", "J7:N7",
    "A9:B9", "A10:B10", "C9:D9", "C10:D10", "E9:F9", "E10:F10", "G9:H9", "G10:H10", "I9:J9", "I10:J10", "K9:N9", "K10:N10",
    `A${summaryRow}:H${summaryRow}`, `I${summaryRow}:N${summaryRow}`,
    `A${summaryRow + 1}:H${summaryRow + 1}`, `I${summaryRow + 1}:N${summaryRow + 1}`,
    `A${summaryRow + 2}:H${summaryRow + 2}`, `I${summaryRow + 2}:N${summaryRow + 2}`,
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:N${endRow}"/><sheetViews><sheetView showGridLines="0" zoomScale="80" workbookViewId="0"><pane ySplit="14" topLeftCell="A15" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="1" width="6" customWidth="1"/><col min="2" max="2" width="34" customWidth="1"/><col min="3" max="4" width="9" customWidth="1"/><col min="5" max="6" width="18" customWidth="1"/><col min="7" max="7" width="10" customWidth="1"/><col min="8" max="9" width="18" customWidth="1"/><col min="10" max="10" width="10" customWidth="1"/><col min="11" max="12" width="19" customWidth="1"/><col min="13" max="13" width="22" customWidth="1"/><col min="14" max="14" width="14" customWidth="1"/></cols><sheetData>
<row r="1" ht="5" customHeight="1">${textCell("A1", "", 14)}${blanks(1,["B","C","D","E","F","G","H","I","J","K","L","M","N"],14)}</row>
<row r="2" ht="28" customHeight="1">${textCell("A2", "내 부  수 익 표", 1)}</row><row r="3" ht="28" customHeight="1"/>
<row r="5" ht="24" customHeight="1">${textCell("A5","기관",3)}${textCell("C5",input.organization,4)}${textCell("H5","견적번호",3)}${textCell("J5",input.quoteNumber || "저장 전",4)}</row>
<row r="6" ht="24" customHeight="1">${textCell("A6","사업·견적명",3)}${textCell("C6",input.projectTitle || "미입력",4)}${textCell("H6","작성일",3)}${textCell("J6",input.quoteDate,4)}</row>
<row r="7" ht="24" customHeight="1">${textCell("A7","협업 구분",3)}${textCell("C7",input.executionType,4)}${textCell("H7","컨소 업체",3)}${textCell("J7",input.consortiumCompany || "-",4)}</row>
<row r="9" ht="22" customHeight="1">${textCell("A9","견적금액",5)}${textCell("C9","예상 수익",5)}${textCell("E9","컨소 지급",5)}${textCell("G9","내부 원가",5)}${textCell("I9","최종 총이익",5)}${textCell("K9","마진율",5)}</row>
<row r="10" ht="34" customHeight="1">${numberCell("A10",input.total,15)}${numberCell("C10",input.earning,15)}${numberCell("E10",-input.consortium,16)}${numberCell("G10",-input.internalCost,16)}${numberCell("I10",input.margin,17)}${rateCell("K10",input.marginRate,18)}</row>
<row r="12" ht="25" customHeight="1">${textCell("A12","품목별 수익 내역 · 단위: 원",2)}${blanks(12,["B","C","D","E","F","G","H","I","J","K","L","M","N"],2)}</row>
<row r="14" ht="34" customHeight="1">${["No","품목·규격","수량","단위","단가","견적금액","기준률","기준 수익","반영 수익","컨소율","컨소 지급","대체·내부비용","품목 순이익","상태"].map((v,i)=>textCell(`${String.fromCharCode(65+i)}14`,v,7)).join("")}</row>${itemRows}
<row r="${summaryRow}" ht="28" customHeight="1">${textCell(`A${summaryRow}`,"수익 요약",2)}${textCell(`I${summaryRow}`,"금액",2)}</row>
<row r="${summaryRow+1}" ht="28" customHeight="1">${textCell(`A${summaryRow+1}`,"예상 수익 - 컨소 지급 - 내부 원가",6)}${numberCell(`I${summaryRow+1}`,input.margin,17)}</row>
<row r="${summaryRow+2}" ht="28" customHeight="1">${textCell(`A${summaryRow+2}`,"마진율",6)}${rateCell(`I${summaryRow+2}`,input.marginRate,18)}</row>
</sheetData><autoFilter ref="A14:N${lastRow}"/><mergeCells count="${merges.length}">${merges.map((ref)=>`<mergeCell ref="${ref}"/>`).join("")}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.2" right="0.2" top="0.3" bottom="0.3" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0" horizontalDpi="300" verticalDpi="300"/></worksheet>`;
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0&quot;원&quot;;[Red]-#,##0&quot;원&quot;;-"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="6"><font><sz val="9"/><name val="맑은 고딕"/></font><font><b/><sz val="22"/><color rgb="FF182842"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="맑은 고딕"/></font><font><b/><color rgb="FF52617D"/><sz val="9"/><name val="맑은 고딕"/></font><font><b/><color rgb="FF2254D1"/><sz val="14"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFC24B3F"/><sz val="10"/><name val="맑은 고딕"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF182842"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3157E6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF5E8"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCCD6E6"/></left><right style="thin"><color rgb="FFCCD6E6"/></right><top style="thin"><color rgb="FFCCD6E6"/></top><bottom style="thin"><color rgb="FFCCD6E6"/></bottom><diagonal/></border><border><left/><right/><top style="medium"><color rgb="FF3157E6"/></top><bottom style="medium"><color rgb="FF3157E6"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="19"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="4" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="5" fillId="6" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="4" fillId="4" borderId="2" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="0"/><xf numFmtId="164" fontId="4" fillId="4" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="5" fillId="6" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="4" fillId="4" borderId="2" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="165" fontId="4" fillId="4" borderId="2" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function createInternalProfitReportWorkbook(input: InternalProfitReportWorkbookInput) {
  const sheet = sheetXml(input);
  const workbookStyles = styles.replace(
    '#,##0&quot;원&quot;;[Red]-#,##0&quot;원&quot;;-',
    '#,##0;[Red]-#,##0;-',
  );
  const now = new Date().toISOString();
  return zipSync({
    "[Content_Types].xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    "_rels/.rels": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    "xl/workbook.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="내부 수익표" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'내부 수익표'!$A$1:$N$${sheet.match(/<dimension ref="A1:N(\d+)"/)?.[1] ?? 40}</definedName></definedNames><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`),
    "xl/_rels/workbook.xml.rels": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": bytes(sheet), "xl/styles.xml": bytes(workbookStyles),
    "docProps/core.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(input.organization)} 내부 수익표</dc:title><dc:creator>WHIZZUP</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`),
    "docProps/app.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WHIZZUP Sales Hub</Application></Properties>`),
  }, { level: 6 });
}
