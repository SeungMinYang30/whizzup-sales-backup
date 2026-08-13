import { zipSync } from "fflate";

export type InternalProfitReportWorkbookInput = {
  compactView?: boolean;
  logoData?: Uint8Array;
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
    internalCost: number;
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
const formulaRateCell = (ref: string, expression: string, cached: number, style = 0) => `<c r="${ref}" s="${style}"><f>${xml(expression)}</f><v>${Math.max(0, Math.min(1, cached))}</v></c>`;
const blanks = (row: number, columns: string[], style: number) => columns.map((column) => textCell(`${column}${row}`, "", style)).join("");
const itemCell = (ref: string, name: string, specification: string, style = 9) => `<c r="${ref}" t="inlineStr" s="${style}"><is><r><rPr><b/><sz val="9"/><rFont val="맑은 고딕"/></rPr><t xml:space="preserve">${xml(name)}</t></r>${specification ? `<r><rPr><sz val="8"/><color rgb="FF52617D"/><rFont val="맑은 고딕"/></rPr><t xml:space="preserve">\n${xml(specification)}</t></r>` : ""}</is></c>`;

function sheetXml(input: InternalProfitReportWorkbookInput, hasDrawing: boolean) {
  const firstRow = 13;
  const lastRow = firstRow + Math.max(1, input.rows.length) - 1;
  const summaryRow = lastRow + 2;
  const noteRow = summaryRow + 2;
  const endRow = noteRow;
  const itemRows = input.rows.length ? input.rows.map((item, index) => {
    const row = firstRow + index;
    const label = item.specification ? `${item.name}\n${item.specification}` : item.name;
    const height = label.length > 56 ? 45 : 36;
    const effectiveRate = item.amount > 0 ? item.earning / item.amount : 0;
    return `<row r="${row}" ht="${height}" customHeight="1">${numberCell(`A${row}`, item.number, 8)}${itemCell(`B${row}`,item.name,item.specification,9)}${blanks(row,["C","D","E","F"],9)}${item.complimentary ? numberCell(`G${row}`,0,10) : formulaCell(`G${row}`,`M${row}*N${row}`,item.amount,10)}${textCell(`H${row}`,"",10)}${formulaCell(`I${row}`,`FLOOR(G${row}*O${row},10)`,item.earning,10)}${textCell(`J${row}`,"",10)}${formulaCell(`K${row}`,`I${row}-Q${row}-R${row}`,item.netProfit,13)}${textCell(`L${row}`,"",13)}${numberCell(`M${row}`,item.quantity,0)}${numberCell(`N${row}`,item.unitPrice,0)}${rateCell(`O${row}`,effectiveRate,0)}${numberCell(`Q${row}`,item.consortium,0)}${numberCell(`R${row}`,item.internalCost,0)}</row>`;
  }).join("") : `<row r="${firstRow}" ht="36" customHeight="1">${textCell(`A${firstRow}`,"",8)}${textCell(`B${firstRow}`,"품목이 없습니다.",9)}${blanks(firstRow,["C","D","E","F"],9)}${blanks(firstRow,["G","H","I","J"],10)}${blanks(firstRow,["K","L"],13)}</row>`;
  const pageCount = Math.max(1,Math.ceil(Math.max(1,input.rows.length)/10));
  const mergePairs = ["A9:B9","A10:B10","C9:D9","C10:D10","E9:F9","E10:F10","G9:H9","G10:H10","I9:J9","I10:J10","K9:L9","K10:L10"];
  const itemMerges = Array.from({length:Math.max(1,input.rows.length)},(_,index)=>firstRow+index).flatMap((row)=>[`B${row}:F${row}`,`G${row}:H${row}`,`I${row}:J${row}`,`K${row}:L${row}`]);
  const merges = ["C2:J3","A5:B5","C5:F5","G5:H5","I5:L5","A6:B6","C6:F6","G6:H6","I6:L6","A7:B7","C7:F7","G7:H7","I7:L7",...mergePairs,"A12:L12",...itemMerges,`A${summaryRow}:H${summaryRow}`,`I${summaryRow}:L${summaryRow}`,`A${noteRow}:L${noteRow}`];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:R${endRow}"/><sheetViews><sheetView view="pageLayout" showGridLines="0" showRowColHeaders="0" zoomScale="95" workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="1" width="5.5" customWidth="1"/><col min="2" max="2" width="11.5" customWidth="1"/><col min="3" max="12" width="8.5" customWidth="1"/><col min="13" max="16384" width="2" hidden="1" customWidth="1"/></cols><sheetData>
<row r="1" ht="4" customHeight="1">${textCell("A1","",14)}${blanks(1,["B","C","D","E","F","G","H","I","J","K","L"],14)}</row>
<row r="2" ht="27" customHeight="1">${textCell("C2","내 부  수 익 표",1)}${textCell("L2",`1 / ${pageCount}`,3)}</row><row r="3" ht="27" customHeight="1"/>
<row r="5" ht="22" customHeight="1">${textCell("A5","기관",3)}${textCell("B5","",3)}${textCell("C5",input.organization,4)}${blanks(5,["D","E","F"],4)}${textCell("G5","견적번호",3)}${textCell("H5","",3)}${textCell("I5",input.quoteNumber || "저장 전",4)}${blanks(5,["J","K","L"],4)}${numberCell("M5",input.total,0)}</row>
<row r="6" ht="22" customHeight="1">${textCell("A6","사업·견적명",3)}${textCell("B6","",3)}${textCell("C6",input.projectTitle || "미입력",4)}${blanks(6,["D","E","F"],4)}${textCell("G6","작성일",3)}${textCell("H6","",3)}${textCell("I6",input.quoteDate,4)}${blanks(6,["J","K","L"],4)}${numberCell("M6",input.earning,0)}</row>
<row r="7" ht="22" customHeight="1">${textCell("A7","협업 구분",3)}${textCell("B7","",3)}${textCell("C7",input.executionType,4)}${blanks(7,["D","E","F"],4)}${textCell("G7","컨소 업체",3)}${textCell("H7","",3)}${textCell("I7",input.consortiumCompany || "-",4)}${blanks(7,["J","K","L"],4)}${numberCell("M7",input.consortium,0)}</row>
<row r="8" ht="10" customHeight="1">${numberCell("M8",input.internalCost,0)}</row>
<row r="9" ht="20" customHeight="1">${textCell("A9","견적금액",5)}${textCell("B9","",5)}${textCell("C9","예상 수익",5)}${textCell("D9","",5)}${textCell("E9","컨소 지급",5)}${textCell("F9","",5)}${textCell("G9","내부 원가",5)}${textCell("H9","",5)}${textCell("I9","최종 총이익",5)}${textCell("J9","",5)}${textCell("K9","마진율",5)}${textCell("L9","",5)}</row>
<row r="10" ht="32" customHeight="1">${formulaCell("A10","M5",input.total,15)}${textCell("B10","",15)}${formulaCell("C10","M6",input.earning,15)}${textCell("D10","",15)}${formulaCell("E10","-M7",-input.consortium,16)}${textCell("F10","",16)}${formulaCell("G10","-M8",-input.internalCost,16)}${textCell("H10","",16)}${formulaCell("I10","C10+E10+G10",input.margin,17)}${textCell("J10","",17)}${formulaRateCell("K10",`IFERROR(I10/SUM(G${firstRow}:G${lastRow}),0)`,input.marginRate,18)}${textCell("L10","",18)}</row>
<row r="12" ht="24" customHeight="1">${textCell("A12","품목별 수익 내역",2)}${blanks(12,["B","C","D","E","F","G","H","I","J","K","L"],2)}</row>${itemRows}
<row r="${summaryRow}" ht="31" customHeight="1">${textCell(`A${summaryRow}`,"컨소·내부 비용을 반영한 최종 예상 수익",6)}${blanks(summaryRow,["B","C","D","E","F","G","H"],6)}${formulaCell(`I${summaryRow}`,"I10",input.margin,19)}${blanks(summaryRow,["J","K","L"],19)}</row>
<row r="${noteRow}" ht="22" customHeight="1">${textCell(`A${noteRow}`,"본 자료는 내부 수익 검토용이며 외부 견적서에는 포함되지 않습니다.",6)}${blanks(noteRow,["B","C","D","E","F","G","H","I","J","K","L"],6)}</row>
</sheetData><mergeCells count="${merges.length}">${merges.map((ref)=>`<mergeCell ref="${ref}"/>`).join("")}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.3" bottom="0.3" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1" horizontalDpi="300" verticalDpi="300"/>${hasDrawing?'<drawing r:id="rId1"/>':""}</worksheet>`;
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0&quot;원&quot;;[Red]-#,##0&quot;원&quot;;-"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="7"><font><sz val="9"/><name val="맑은 고딕"/></font><font><b/><sz val="22"/><color rgb="FF182842"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="맑은 고딕"/></font><font><b/><color rgb="FF52617D"/><sz val="9"/><name val="맑은 고딕"/></font><font><b/><color rgb="FF2254D1"/><sz val="11"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFC24B3F"/><sz val="10"/><name val="맑은 고딕"/></font><font><b/><color rgb="FF2254D1"/><sz val="14"/><name val="맑은 고딕"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF182842"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3157E6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF5E8"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCCD6E6"/></left><right style="thin"><color rgb="FFCCD6E6"/></right><top style="thin"><color rgb="FFCCD6E6"/></top><bottom style="thin"><color rgb="FFCCD6E6"/></bottom><diagonal/></border><border><left/><right/><top style="medium"><color rgb="FF3157E6"/></top><bottom style="medium"><color rgb="FF3157E6"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="20"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="4" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf><xf numFmtId="164" fontId="5" fillId="6" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf><xf numFmtId="164" fontId="4" fillId="4" borderId="2" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="0"/><xf numFmtId="164" fontId="4" fillId="4" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf><xf numFmtId="164" fontId="5" fillId="6" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf><xf numFmtId="164" fontId="4" fillId="4" borderId="2" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf><xf numFmtId="165" fontId="4" fillId="4" borderId="2" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf><xf numFmtId="164" fontId="6" fillId="4" borderId="2" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center" shrinkToFit="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function pictureAnchor(id: number, relationshipId: string) {
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from><xdr:ext cx="857250" cy="476250"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="WHIZZUP Logo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
}

function drawingXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${pictureAnchor(2,"rId1")}</xdr:wsDr>`;
}

export function createInternalProfitReportWorkbook(input: InternalProfitReportWorkbookInput) {
  const hasLogo = Boolean(input.logoData?.length);
  const sheet = sheetXml(input, hasLogo);
  const endRow = sheet.match(/<dimension ref="A1:R(\d+)"/)?.[1] ?? "40";
  const workbookStyles = styles.replaceAll('borderId="2"', 'borderId="1"');
  const now = new Date().toISOString();
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hasLogo?'<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>':""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    "_rels/.rels": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    "xl/workbook.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="18000" windowHeight="12000"/></bookViews><sheets><sheet name="내부 수익표" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'내부 수익표'!$A$1:$L$${endRow}</definedName></definedNames><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`),
    "xl/_rels/workbook.xml.rels": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": bytes(sheet), "xl/styles.xml": bytes(workbookStyles),
    "docProps/core.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(input.organization)} 내부 수익표</dc:title><dc:creator>WHIZZUP</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`),
    "docProps/app.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WHIZZUP Sales Hub</Application></Properties>`),
  };
  if (hasLogo) {
    files["xl/worksheets/_rels/sheet1.xml.rels"] = bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
    files["xl/drawings/drawing1.xml"] = bytes(drawingXml());
    files["xl/drawings/_rels/drawing1.xml.rels"] = bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>`);
    files["xl/media/logo.png"] = input.logoData!;
  }
  return zipSync(files, { level: 6 });
}
