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
  rowHeight?: number;
  summary?: boolean;
};

const CELL_STYLE = {
  title: 1,
  subtitle: 2,
  header: 3,
  body: 4,
  money: 5,
  number: 6,
  label: 7,
  warning: 8,
  bodyAlt: 9,
  moneyAlt: 10,
  numberAlt: 11,
  success: 12,
  attention: 13,
  danger: 14,
  info: 15,
  date: 16,
  dateAlt: 17,
  kpiMoney: 18,
  kpiMoneySuccess: 19,
  kpiNumber: 20,
} as const;

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
  const cleaned = clean(value);
  return cleaned ? { value: cleaned, style } : { value: "미입력", style: CELL_STYLE.warning };
}

function numeric(value: unknown, style = 6): Cell {
  return { value: numberValue(value), style };
}

function formula(value: string, cachedValue: number, style = 5): Cell {
  return { formula: value, value: cachedValue, style };
}

function rowsOrMessage(rows: Cell[][], columnCount: number, message: string) {
  if (rows.length) return rows;
  return [[text(message, 2), ...Array.from({ length: Math.max(0, columnCount - 1) }, () => text("", 2))]];
}

function bandedStyle(style: number, index: number) {
  if (index % 2 === 0) return style;
  if (style === CELL_STYLE.body) return CELL_STYLE.bodyAlt;
  if (style === CELL_STYLE.money) return CELL_STYLE.moneyAlt;
  if (style === CELL_STYLE.number) return CELL_STYLE.numberAlt;
  if (style === CELL_STYLE.date) return CELL_STYLE.dateAlt;
  return style;
}

function statusCell(value: unknown) {
  const cleaned = clean(value);
  if (!cleaned) return text("미입력", CELL_STYLE.warning);
  if (/(완료|승인|확정|정상)/.test(cleaned)) return text(cleaned, CELL_STYLE.success);
  if (/(초과|오류|실패|취소)/.test(cleaned)) return text(cleaned, CELL_STYLE.danger);
  if (/(미정|대기|준비|진행|설치 중|확인|필요)/.test(cleaned)) return text(cleaned, CELL_STYLE.attention);
  return text(cleaned, CELL_STYLE.info);
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
    return `<row r="${rowNumber}" ht="${spec.rowHeight ?? 28}" customHeight="1">${row
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
  <sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="90"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${widths}</cols>
  <sheetData>${titleRow}${subtitleRow}<row r="3"/>${headerRow}${dataRows}</sheetData>
  ${spec.summary ? "" : `<autoFilter ref="A4:${lastColumn}${lastRow}"/>`}
  <mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells>
  <printOptions horizontalCentered="1"/>
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
    const bodyStyle = bandedStyle(CELL_STYLE.body, index);
    const moneyStyle = bandedStyle(CELL_STYLE.money, index);
    const budgetAmount = numberValue(budget.budget_amount);
    const itemAmount = itemAmountByBudget.get(numberValue(budget.equipment_project_id)) ?? 0;
    const constructionAmount = numberValue(budget.construction_amount);
    const executionAmount = itemAmount + constructionAmount;
    return [
      textOrMissing(budget.name, bodyStyle),
      textOrMissing(budget.budget_kind, bodyStyle),
      budget.budget_amount === null || budget.budget_amount === undefined
        ? text("예산 미입력", CELL_STYLE.warning)
        : numeric(budgetAmount, moneyStyle),
      numeric(itemAmount, moneyStyle),
      numeric(constructionAmount, moneyStyle),
      numeric(budget.actual_construction_cost, moneyStyle),
      formula(`D${row}+E${row}`, executionAmount, moneyStyle),
      budget.budget_amount === null || budget.budget_amount === undefined
        ? text("계산 전", CELL_STYLE.warning)
        : formula(`C${row}-G${row}`, budgetAmount - executionAmount, moneyStyle),
      statusCell(budget.status),
    ];
  });
  const items = project.items.map((item, index) => {
    const bodyStyle = bandedStyle(CELL_STYLE.body, index);
    const moneyStyle = bandedStyle(CELL_STYLE.money, index);
    const numberStyle = bandedStyle(CELL_STYLE.number, index);
    const zoneName = zones.get(numberValue(item.zone_id)) || clean(item.delivery_location);
    const unitPrice = item.effective_unit_price === null || item.effective_unit_price === undefined
      ? undefined
      : numberValue(item.effective_unit_price);
    return [
      numeric(index + 1, numberStyle),
      textOrMissing(item.budget_name, bodyStyle),
      textOrMissing(item.item_category, bodyStyle),
      textOrMissing(zoneName, bodyStyle),
      textOrMissing(item.product_name, bodyStyle),
      textOrMissing(item.specification, bodyStyle),
      numeric(item.settlement_quantity, numberStyle),
      textOrMissing(item.unit, bodyStyle),
      unitPrice === undefined ? text("미입력", CELL_STYLE.warning) : numeric(unitPrice, moneyStyle),
      unitPrice === undefined ? text("미입력", CELL_STYLE.warning) : numeric(item.quotation_amount, moneyStyle),
      textOrMissing(item.supplier_display_name || item.supplier_vendor_name, bodyStyle),
      textOrMissing(item.procurement_method, bodyStyle),
      textOrMissing(item.procurement_identifier, bodyStyle),
      statusCell(item.protection_state || item.protection_status),
      statusCell(item.schedule_state),
      text(item.notes, bodyStyle),
    ];
  });
  const selections = project.items.map((item, index) => {
    const bodyStyle = bandedStyle(CELL_STYLE.body, index);
    const numberStyle = bandedStyle(CELL_STYLE.number, index);
    return [
      numeric(index + 1, numberStyle),
      textOrMissing(item.selection_round, bodyStyle),
      textOrMissing(item.product_name, bodyStyle),
      textOrMissing(item.specification, bodyStyle),
      numeric(item.settlement_quantity, numberStyle),
      textOrMissing(item.unit, bodyStyle),
      textOrMissing(item.supplier_display_name || item.supplier_vendor_name, bodyStyle),
      textOrMissing(item.procurement_identifier, bodyStyle),
      statusCell(item.selection_status),
      textOrMissing(item.budget_name, bodyStyle),
    ];
  });
  let deliveryIndex = 0;
  const deliveries = project.items.flatMap((item) => (item.deliveries ?? []).map((delivery) => {
    const rowIndex = deliveryIndex;
    deliveryIndex += 1;
    const bodyStyle = bandedStyle(CELL_STYLE.body, rowIndex);
    const numberStyle = bandedStyle(CELL_STYLE.number, rowIndex);
    const dateStyle = bandedStyle(CELL_STYLE.date, rowIndex);
    return [
      textOrMissing(item.product_name, bodyStyle),
      textOrMissing(item.budget_name, bodyStyle),
      textOrMissing(delivery.kind, bodyStyle),
      numeric(delivery.planned_qty, numberStyle),
      numeric(delivery.completed_qty, numberStyle),
      textOrMissing(delivery.start_date, dateStyle),
      textOrMissing(delivery.end_date || delivery.start_date, dateStyle),
      textOrMissing(delivery.vendor_name, bodyStyle),
      textOrMissing(delivery.location || item.delivery_location, bodyStyle),
      statusCell(delivery.status),
      text(delivery.notes, bodyStyle),
    ];
  }));
  const protections = project.items.map((item, index) => {
    const bodyStyle = bandedStyle(CELL_STYLE.body, index);
    const numberStyle = bandedStyle(CELL_STYLE.number, index);
    const dateStyle = bandedStyle(CELL_STYLE.date, index);
    return [
      numeric(index + 1, numberStyle),
      textOrMissing(item.product_name, bodyStyle),
      textOrMissing(item.supplier_display_name || item.supplier_vendor_name, bodyStyle),
      textOrMissing(item.protection_vendor_name, bodyStyle),
      statusCell(item.protection_state || item.protection_status),
      textOrMissing(item.protection_expires_at, dateStyle),
      statusCell(item.selection_status),
      statusCell(item.schedule_state),
      text(item.notes, bodyStyle),
    ];
  });
  const zonesRows = project.zones.map((zone, index) => {
    const bodyStyle = bandedStyle(CELL_STYLE.body, index);
    const numberStyle = bandedStyle(CELL_STYLE.number, index);
    return [
      numeric(index + 1, numberStyle),
      textOrMissing(zone.name, bodyStyle),
      textOrMissing(zone.building, bodyStyle),
      textOrMissing(zone.floor, bodyStyle),
      textOrMissing(zone.room, bodyStyle),
      numeric(project.items.filter((item) => numberValue(item.zone_id) === numberValue(zone.id)).length, numberStyle),
      text(zone.notes, bodyStyle),
    ];
  });
  const totalBudget = numberValue(project.total_budget);
  const itemTotal = project.items.reduce((sum, item) => sum + numberValue(item.quotation_amount), 0);
  const constructionTotal = project.budgets.reduce((sum, budget) => sum + numberValue(budget.construction_amount), 0);
  const executionTotal = itemTotal + constructionTotal;
  const remainingBudget = totalBudget - executionTotal;
  const summaryRows: Cell[][] = [
    [text("전체예산", CELL_STYLE.label), project.total_budget === null ? text("예산 미입력", CELL_STYLE.warning) : numeric(totalBudget, CELL_STYLE.kpiMoney), text("예산 합계", CELL_STYLE.label), formula(`SUM('예산별 집행'!C5:C${Math.max(5, budgets.length + 4)})`, totalBudget, CELL_STYLE.kpiMoney), text("품목 금액 합계", CELL_STYLE.label), formula(`SUM('공간·품목'!J${itemRowsStart}:J${itemRowsEnd})`, itemTotal, CELL_STYLE.kpiMoney), text("공사비 합계", CELL_STYLE.label), formula(`SUM('예산별 집행'!E5:E${Math.max(5, budgets.length + 4)})`, constructionTotal, CELL_STYLE.kpiMoney)],
    [text("계약·집행금액", CELL_STYLE.label), formula("F5+H5", executionTotal, CELL_STYLE.kpiMoney), text("남은 예산", CELL_STYLE.label), project.total_budget === null ? text("계산 전", CELL_STYLE.warning) : formula("B5-B6", remainingBudget, CELL_STYLE.kpiMoneySuccess), text("등록 품목", CELL_STYLE.label), numeric(project.items.length, CELL_STYLE.kpiNumber), text("등록 공간", CELL_STYLE.label), numeric(project.zones.length, CELL_STYLE.kpiNumber)],
    [text("사업명", CELL_STYLE.label), textOrMissing(project.name), text("진행 담당자", CELL_STYLE.label), textOrMissing(project.manager_name), text("상태", CELL_STYLE.label), statusCell(project.status), text("사업 차수", CELL_STYLE.label), numeric(project.business_round)],
    [text("메모", CELL_STYLE.label), text(project.notes), text("", CELL_STYLE.label), text(""), text("", CELL_STYLE.label), text(""), text("", CELL_STYLE.label), text("")],
  ];
  return [
    { name: "집행계획 총괄", title: `${project.organization} 공간재구조화 사업 집행계획 총괄`, subtitle, headers: ["구분", "금액·내용", "구분", "금액·내용", "구분", "금액·내용", "구분", "금액·내용"], rows: summaryRows, widths: [18, 25, 18, 25, 18, 25, 18, 25], rowHeight: 32, summary: true },
    { name: "예산별 집행", title: `${project.organization} 예산별 집행계획`, subtitle, headers: ["표준 예산명", "예산 구분", "전체예산", "품목 금액", "등록 공사비", "실제 공사비", "품목·공사 합계", "잔액", "상태"], rows: rowsOrMessage(budgets, 9, "기관 상세에 등록된 예산이 없습니다."), widths: [24, 14, 17, 17, 17, 17, 19, 17, 14], rowHeight: 30 },
    { name: "공간·품목", title: `${project.organization} 공간·품목 집행계획`, subtitle, headers: ["NO", "연결 예산", "품목 구분", "공간", "품명", "규격", "수량", "단위", "단가", "계약·집행금액", "업체", "조달 방식", "식별번호", "영업보호", "납품 상태", "메모"], rows: rowsOrMessage(items, 16, "등록된 품목이 없습니다."), widths: [7, 18, 13, 17, 24, 38, 9, 9, 16, 19, 22, 16, 20, 16, 16, 30], rowHeight: 42 },
    { name: "공간 현황", title: `${project.organization} 공간·구역 현황`, subtitle, headers: ["NO", "공간명", "동·건물", "층", "실·교실", "연결 품목 수", "메모"], rows: rowsOrMessage(zonesRows, 7, "등록된 공간·구역이 없습니다."), widths: [7, 24, 18, 12, 18, 14, 36], rowHeight: 30 },
    { name: "물품선정표", title: `${project.organization} 물품선정표`, subtitle, headers: ["NO", "물선위 차수", "품명", "규격", "수량", "단위", "선정 업체", "식별번호", "선정 상태", "연결 예산"], rows: rowsOrMessage(selections, 10, "등록된 품목이 없습니다."), widths: [7, 18, 24, 38, 10, 10, 22, 20, 16, 22], rowHeight: 38 },
    { name: "분할 납품 일정", title: `${project.organization} 분할 납품 일정`, subtitle, headers: ["품명", "연결 예산", "구분", "배정 수량", "완료 수량", "시작일", "종료일", "업체", "위치", "상태", "메모"], rows: rowsOrMessage(deliveries, 11, "등록된 분할 납품 일정이 없습니다."), widths: [24, 22, 12, 12, 12, 14, 14, 22, 22, 14, 32], rowHeight: 32 },
    { name: "영업보호 현황", title: `${project.organization} 영업보호 현황`, subtitle, headers: ["NO", "품명", "공급 업체", "보호 대상 업체", "보호 상태", "만료일", "선정 상태", "납품 상태", "메모"], rows: rowsOrMessage(protections, 9, "등록된 품목이 없습니다."), widths: [7, 26, 22, 22, 16, 14, 16, 16, 32], rowHeight: 34 },
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
  files["xl/workbook.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets>${sheetEntries}</sheets><definedNames>${definedNames}</definedNames><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1"/></workbook>`);
  const relations = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  files["xl/_rels/workbook.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files["xl/styles.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="#,##0&quot;원&quot;;[Red](#,##0)&quot;원&quot;;-"/>
    <numFmt numFmtId="165" formatCode="#,##0;[Red](#,##0);-"/>
    <numFmt numFmtId="166" formatCode="yyyy-mm-dd"/>
  </numFmts>
  <fonts count="11">
    <font><color rgb="FF26354D"/><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="맑은 고딕"/></font>
    <font><color rgb="FF5B6B82"/><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FF26354D"/><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FF1F2D43"/><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FF087A63"/><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FFA15C00"/><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FFC94343"/><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FF3159C9"/><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FF3159C9"/><sz val="12"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FF087A63"/><sz val="12"/><name val="맑은 고딕"/></font>
  </fonts>
  <fills count="15">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F2D43"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FB"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F8"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF3D6"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8F8F4"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF0F0"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEDF2FF"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEF3FF"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8F8F4"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD9E2EF"/></left><right style="thin"><color rgb="FFD9E2EF"/></right><top style="thin"><color rgb="FFD9E2EF"/></top><bottom style="thin"><color rgb="FFD9E2EF"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="21">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="7" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="8" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="9" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="10" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="11" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="8" fillId="12" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="166" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="9" fillId="13" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="10" fillId="14" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="9" fillId="13" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);
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
