import { strToU8, zipSync } from "fflate";

type DataRow = Record<string, unknown>;

export type ComplexProjectWorkbookData = DataRow & {
  id: number;
  organization: string;
  business_round: number;
  name: string;
  status: string;
  total_budget: number | null;
  manager_name: string;
  notes: string;
  budgets: DataRow[];
  zones: DataRow[];
  items: Array<DataRow & { deliveries?: DataRow[] }>;
};

type Cell = {
  value?: string | number;
  formula?: string;
  style?: number;
};

type SheetSpec = {
  name: string;
  title: string;
  subtitle: string;
  headers: string[];
  rows: Cell[][];
  widths: number[];
};

const clean = (value: unknown) => String(value ?? "").trim();
const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const missing = (value: unknown) => clean(value) || "미입력";

function escapeXml(value: unknown) {
  return String(value ?? "")
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

function text(value: unknown, style = 4): Cell {
  return { value: clean(value), style };
}

function textOrMissing(value: unknown, style = 4): Cell {
  return { value: missing(value), style };
}

function numeric(value: unknown, style = 6): Cell {
  return { value: numberValue(value), style };
}

function money(value: unknown): Cell {
  return { value: numberValue(value), style: 5 };
}

function formula(value: string, style = 5): Cell {
  return { formula: value, value: 0, style };
}

function cellXml(cell: Cell | undefined, reference: string) {
  if (!cell || (cell.value === undefined && !cell.formula)) return "";
  const style = cell.style ? ` s="${cell.style}"` : "";
  if (cell.formula) {
    return `<c r="${reference}"${style}><f>${escapeXml(cell.formula)}</f><v>${Number(cell.value) || 0}</v></c>`;
  }
  if (typeof cell.value === "number") {
    return `<c r="${reference}"${style}><v>${Number.isFinite(cell.value) ? cell.value : 0}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
}

function worksheetXml(spec: SheetSpec) {
  const columnCount = spec.headers.length;
  const lastColumn = columnName(columnCount - 1);
  const titleRow = `<row r="1" ht="30" customHeight="1">${cellXml({ value: spec.title, style: 1 }, "A1")}</row>`;
  const subtitleRow = `<row r="2" ht="22" customHeight="1">${cellXml({ value: spec.subtitle, style: 2 }, "A2")}</row>`;
  const headerRow = `<row r="4" ht="27" customHeight="1">${spec.headers
    .map((header, index) => cellXml({ value: header, style: 3 }, `${columnName(index)}4`))
    .join("")}</row>`;
  const dataRows = spec.rows.map((row, index) => {
    const rowNumber = index + 5;
    return `<row r="${rowNumber}" ht="24" customHeight="1">${row
      .map((cell, columnIndex) => cellXml(cell, `${columnName(columnIndex)}${rowNumber}`))
      .join("")}</row>`;
  }).join("");
  const widths = spec.widths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
  ).join("");
  const lastRow = Math.max(5, spec.rows.length + 4);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${widths}</cols>
  <sheetData>${titleRow}${subtitleRow}<row r="3"/>${headerRow}${dataRows}</sheetData>
  <mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells>
  <autoFilter ref="A4:${lastColumn}${lastRow}"/>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`;
}

function buildSheets(project: ComplexProjectWorkbookData): SheetSpec[] {
  const zones = new Map(project.zones.map((zone) => [numberValue(zone.id), clean(zone.name)]));
  const itemRowsStart = 5;
  const itemRowsEnd = Math.max(itemRowsStart, itemRowsStart + project.items.length - 1);
  const subtitle = `${project.organization} · ${Math.max(1, numberValue(project.business_round))}차 · 진행 담당자 ${missing(project.manager_name)} · 상태 ${missing(project.status)}`;
  const itemAmountByBudget = new Map<number, number>();
  project.items.forEach((item) => {
    const projectId = numberValue(item.project_id);
    itemAmountByBudget.set(projectId, (itemAmountByBudget.get(projectId) ?? 0) + numberValue(item.item_amount));
  });
  const budgets = project.budgets.map((budget, index) => {
    const row = index + 5;
    return [
      textOrMissing(budget.name),
      textOrMissing(budget.budget_kind),
      money(budget.allocated_amount),
      money(itemAmountByBudget.get(numberValue(budget.equipment_project_id)) ?? 0),
      money(budget.construction_amount),
      money(budget.actual_construction_cost),
      formula(`D${row}+E${row}`),
      formula(`C${row}-G${row}`),
      textOrMissing(budget.status),
    ];
  });
  const items = project.items.map((item, index) => {
    const row = index + itemRowsStart;
    const zoneName = zones.get(numberValue(item.zone_id)) || clean(item.delivery_location);
    const unitPrice = item.effective_unit_price === null || item.effective_unit_price === undefined
      ? undefined
      : numberValue(item.effective_unit_price);
    return [
      numeric(index + 1, 6),
      textOrMissing(item.budget_name),
      textOrMissing(item.item_category),
      textOrMissing(zoneName),
      textOrMissing(item.product_name),
      textOrMissing(item.specification),
      numeric(item.settlement_quantity),
      textOrMissing(item.unit),
      unitPrice === undefined ? text("미입력", 8) : money(unitPrice),
      unitPrice === undefined ? text("미입력", 8) : formula(`G${row}*I${row}`),
      textOrMissing(item.supplier_display_name || item.supplier_vendor_name),
      textOrMissing(item.procurement_method),
      textOrMissing(item.procurement_identifier),
      textOrMissing(item.protection_state || item.protection_status),
      textOrMissing(item.schedule_state),
      text(item.notes),
    ];
  });
  const selections = project.items.map((item, index) => [
    numeric(index + 1),
    textOrMissing(item.selection_round),
    textOrMissing(item.product_name),
    textOrMissing(item.specification),
    numeric(item.settlement_quantity),
    textOrMissing(item.unit),
    textOrMissing(item.supplier_display_name || item.supplier_vendor_name),
    textOrMissing(item.procurement_identifier),
    textOrMissing(item.selection_status),
    textOrMissing(item.budget_name),
  ]);
  const deliveries = project.items.flatMap((item) => (item.deliveries ?? []).map((delivery) => [
    textOrMissing(item.product_name),
    textOrMissing(item.budget_name),
    textOrMissing(delivery.kind),
    numeric(delivery.planned_qty),
    numeric(delivery.completed_qty),
    textOrMissing(delivery.start_date),
    textOrMissing(delivery.end_date || delivery.start_date),
    textOrMissing(delivery.vendor_name),
    textOrMissing(delivery.location || item.delivery_location),
    textOrMissing(delivery.status),
    text(delivery.notes),
  ]));
  const protections = project.items.map((item, index) => [
    numeric(index + 1),
    textOrMissing(item.product_name),
    textOrMissing(item.supplier_display_name || item.supplier_vendor_name),
    textOrMissing(item.protection_vendor_name),
    textOrMissing(item.protection_state || item.protection_status),
    textOrMissing(item.protection_expires_at),
    textOrMissing(item.selection_status),
    textOrMissing(item.schedule_state),
    text(item.notes),
  ]);
  const zonesRows = project.zones.map((zone, index) => [
    numeric(index + 1),
    textOrMissing(zone.name),
    textOrMissing(zone.building),
    textOrMissing(zone.floor),
    textOrMissing(zone.room),
    numeric(project.items.filter((item) => numberValue(item.zone_id) === numberValue(zone.id)).length),
    text(zone.notes),
  ]);
  const summaryRows: Cell[][] = [
    [text("총 관리예산", 7), money(project.total_budget), text("예산 배정 합계", 7), formula(`SUM('예산별 집행'!C5:C${Math.max(5, budgets.length + 4)})`), text("품목 금액 합계", 7), formula(`SUM('공간·품목'!J${itemRowsStart}:J${itemRowsEnd})`), text("공사비 합계", 7), formula(`SUM('예산별 집행'!E5:E${Math.max(5, budgets.length + 4)})`)],
    [text("품목·공사비 합계", 7), formula("F5+H5"), text("관리예산 잔액", 7), formula("B5-B6"), text("등록 품목", 7), numeric(project.items.length), text("등록 공간", 7), numeric(project.zones.length)],
    [text("사업명", 7), textOrMissing(project.name), text("진행 담당자", 7), textOrMissing(project.manager_name), text("상태", 7), textOrMissing(project.status), text("사업 차수", 7), numeric(project.business_round)],
    [text("메모", 7), text(project.notes), text("", 7), text(""), text("", 7), text(""), text("", 7), text("")],
  ];
  return [
    { name: "집행계획 총괄", title: `${project.organization} 공간재구조화 사업 집행계획 총괄`, subtitle, headers: ["구분", "금액·내용", "구분", "금액·내용", "구분", "금액·내용", "구분", "금액·내용"], rows: summaryRows, widths: [18, 24, 18, 24, 18, 24, 18, 24] },
    { name: "예산별 집행", title: `${project.organization} 예산별 집행계획`, subtitle, headers: ["표준 예산명", "예산 구분", "배정액", "품목 금액", "등록 공사비", "실제 공사비", "품목·공사 합계", "잔액", "상태"], rows: budgets, widths: [24, 14, 16, 16, 16, 16, 18, 16, 14] },
    { name: "공간·품목", title: `${project.organization} 공간·품목 집행계획`, subtitle, headers: ["NO", "연결 예산", "품목 구분", "공간", "품명", "규격", "수량", "단위", "단가", "합계", "업체", "조달 방식", "식별번호", "영업보호", "납품 상태", "메모"], rows: items, widths: [7, 20, 14, 18, 24, 36, 10, 10, 16, 18, 22, 16, 20, 16, 16, 30] },
    { name: "공간 현황", title: `${project.organization} 공간·구역 현황`, subtitle, headers: ["NO", "공간명", "동·건물", "층", "실·교실", "연결 품목 수", "메모"], rows: zonesRows, widths: [7, 24, 18, 12, 18, 14, 36] },
    { name: "물품선정표", title: `${project.organization} 물품선정표`, subtitle, headers: ["NO", "물선위 차수", "품명", "규격", "수량", "단위", "선정 업체", "식별번호", "선정 상태", "연결 예산"], rows: selections, widths: [7, 18, 24, 38, 10, 10, 22, 20, 16, 22] },
    { name: "분할 납품 일정", title: `${project.organization} 분할 납품 일정`, subtitle, headers: ["품명", "연결 예산", "구분", "배정 수량", "완료 수량", "시작일", "종료일", "업체", "위치", "상태", "메모"], rows: deliveries, widths: [24, 22, 12, 12, 12, 14, 14, 22, 22, 14, 32] },
    { name: "영업보호 현황", title: `${project.organization} 영업보호 현황`, subtitle, headers: ["NO", "품명", "공급 업체", "보호 대상 업체", "보호 상태", "만료일", "선정 상태", "납품 상태", "메모"], rows: protections, widths: [7, 26, 22, 22, 16, 14, 16, 16, 32] },
  ];
}

export function buildComplexProjectWorkbook(project: ComplexProjectWorkbookData) {
  const sheets = buildSheets(project);
  const files: Record<string, Uint8Array> = {};
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  files["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  const sheetEntries = sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const definedNames = sheets.map((sheet, index) => {
    const lastColumn = columnName(sheet.headers.length - 1);
    const lastRow = Math.max(5, sheet.rows.length + 4);
    return `<definedName name="_xlnm.Print_Area" localSheetId="${index}">'${escapeXml(sheet.name)}'!$A$1:$${lastColumn}$${lastRow}</definedName>`;
  }).join("");
  files["xl/workbook.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><fileVersion appName="xl"/><workbookPr/><bookViews><workbookView/></bookViews><sheets>${sheetEntries}</sheets><definedNames>${definedNames}</definedNames><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1"/></workbook>`);
  const relations = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  files["xl/_rels/workbook.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files["xl/styles.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,#0\"원\";[Red]-#,#0\"원\""/><numFmt numFmtId="165" formatCode="#,#0"/></numFmts><fonts count="4"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="맑은 고딕"/></font><font><color rgb="FF4A5568"/><sz val="10"/><name val="맑은 고딕"/></font><font><b/><color rgb="FF1F2937"/><sz val="10"/><name val="맑은 고딕"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF27336F"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE4D6"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB8BEC8"/></left><right style="thin"><color rgb="FFB8BEC8"/></right><top style="thin"><color rgb="FFB8BEC8"/></top><bottom style="thin"><color rgb="FFB8BEC8"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="5" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  const safeStylesXml = new TextDecoder().decode(files["xl/styles.xml"])
    .replace('formatCode="#,#0"원";[Red]-#,#0"원""', 'formatCode="#,##0&quot;원&quot;;[Red]-#,##0&quot;원&quot;"')
    .replace('formatCode="#,#0"', 'formatCode="#,##0"');
  files["xl/styles.xml"] = strToU8(safeStylesXml);
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet)); });
  const now = new Date().toISOString();
  files["docProps/core.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(project.organization)} 공간재구조화 사업 관리대장</dc:title><dc:creator>WHIZZUP</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`);
  files["docProps/app.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WHIZZUP</Application><TitlesOfParts><vt:vector xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes" size="${sheets.length}" baseType="lpstr">${sheets.map((sheet) => `<vt:lpstr>${escapeXml(sheet.name)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts></Properties>`);
  return zipSync(files, { level: 6 });
}

export function downloadComplexProjectWorkbook(project: ComplexProjectWorkbookData) {
  const bytes = buildComplexProjectWorkbook(project);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeOrganization = project.organization.replace(/[\\/:*?"<>|]/g, "_");
  anchor.href = url;
  anchor.download = `${safeOrganization}_공간재구조화_사업관리대장.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
