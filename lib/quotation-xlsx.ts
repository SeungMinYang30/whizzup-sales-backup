import { zipSync } from "fflate";
import { airpassEquipmentKitOutputLines, airpassEquipmentKitTotal, type AirpassEquipmentKit } from "./airpass-equipment-kit";
import { AIRPASS_COMPANY, AIRPASS_EQUIPMENT_CONTRACT_NOTE } from "./airpass-company";
import { formatQuotationItemNameForOutput } from "./quotation-output-text";

export type QuotationLine = {
  name: string;
  specification: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  complimentary?: boolean;
  note: string;
  procurement?: boolean;
  procurementChannel?: string;
  procurementNumber?: string;
  procurementFeeRate?: number;
  equipmentKit?: boolean;
};

export type QuotationWorkbookInput = {
  customerName: string;
  quoteDate: string;
  projectTitle: string;
  quoteNumber?: string;
  validUntil?: string;
  includeStamp?: boolean;
  discountAmount?: number;
  extraAmount?: number;
  memo?: string;
  logoData?: Uint8Array;
  sealData?: Uint8Array;
  airpassSealData?: Uint8Array;
  extraBlankRows?: number;
  equipmentKit?: AirpassEquipmentKit;
  equipmentKitComplimentary?: boolean;
  lines: QuotationLine[];
};

const xml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&apos;");
const bytes = (value: string) => new TextEncoder().encode(value);
const inline = (ref: string, value: unknown, style = 0) => `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
const numeric = (ref: string, value: number, style = 0) => `<c r="${ref}" s="${style}"><v>${Math.round(value)}</v></c>`;
const formula = (ref: string, expression: string, cached: number, style = 0) => `<c r="${ref}" s="${style}"><f>${xml(expression)}</f><v>${Math.round(cached)}</v></c>`;
const styledBlanks = (row: number, columns: string[], style: number) => columns.map((column) => inline(`${column}${row}`, "", style)).join("");

const SMALL = ["", "십", "백", "천"];
const LARGE = ["", "만", "억", "조"];
const DIGIT = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
function koreanAmount(value: number) {
  let remaining = Math.max(0, Math.round(value));
  if (!remaining) return "금 영원정";
  let result = "";
  let group = 0;
  while (remaining) {
    const part = remaining % 10_000;
    if (part) {
      let block = "";
      for (let position = 3; position >= 0; position -= 1) {
        const digit = Math.floor(part / (10 ** position)) % 10;
        if (!digit) continue;
        if (!(digit === 1 && position > 0)) block += DIGIT[digit];
        block += SMALL[position];
      }
      result = `${block}${LARGE[group]}${result}`;
    }
    remaining = Math.floor(remaining / 10_000);
    group += 1;
  }
  return `금 ${result}원정`;
}

function koreanDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? `${year}년 ${month}월 ${day}일` : value;
}

function isS2B(line: QuotationLine) {
  return /^S\s*2\s*B$/iu.test(String(line.procurementChannel ?? "").trim());
}

function appliesProcurementFee(line: QuotationLine) {
  return line.procurement === true && !isS2B(line);
}

function contractLabel(line: QuotationLine) {
  if (line.note.trim().replace(/\s/g, "") === "공사비") return "공사비";
  if (!line.procurement) return "수의계약";
  return isS2B(line) ? "학교장터" : "조달 계약";
}

function outputNote(line: QuotationLine) {
  if (line.complimentary) return "무상 제공";
  if (line.equipmentKit) return AIRPASS_EQUIPMENT_CONTRACT_NOTE;
  return contractLabel(line);
}

function calculations(input: QuotationWorkbookInput) {
  const itemTotal = input.lines.reduce((sum, line) => sum + (line.complimentary ? 0 : Math.max(0, line.quantity) * Math.max(0, line.unitPrice)), 0);
  const procurementFee = input.lines.reduce((sum, line) => sum + (appliesProcurementFee(line)
    && !line.complimentary ? Math.floor(Math.max(0, line.quantity) * Math.max(0, line.unitPrice) * Math.max(0, line.procurementFeeRate ?? 0.0054) / 10) * 10
    : 0), 0);
  const discount = Math.max(0, input.discountAmount ?? 0);
  const extra = Math.max(0, input.extraAmount ?? 0);
  const adjusted = Math.max(0, itemTotal - discount + extra);
  const supply = Math.round(adjusted / 1.1);
  const vat = adjusted - supply;
  return { itemTotal, procurementFee, discount, extra, adjusted, supply, vat, total: adjusted + procurementFee };
}

function procurementLabel(line: QuotationLine) {
  if (!line.procurement) return "-";
  const channel = line.procurementChannel || "조달";
  return [channel, line.procurementNumber].filter(Boolean).join(" · ") || "조달";
}

function sheetXml(input: QuotationWorkbookInput, hasDrawing: boolean) {
  const calc = calculations(input);
  const firstItemRow = 18;
  const extraBlankRows = Math.min(5, Math.max(0, Math.floor(input.extraBlankRows ?? 0)));
  const itemCount = Math.max(1, input.lines.length) + extraBlankRows;
  const lastItemRow = firstItemRow + itemCount - 1;
  const bottomHeaderRow = lastItemRow + 2;
  const conditionStartRow = bottomHeaderRow + 1;
  const finalSummaryRow = conditionStartRow + 4;
  const summaryEndRow = conditionStartRow + 6;
  const signatureStartRow = summaryEndRow + 2;
  const signatureEndRow = signatureStartRow + 2;
  const validText = input.validUntil ? `${input.validUntil}까지` : "견적일로부터 30일";

  const itemRows = Array.from({ length: itemCount }, (_, index) => {
    const row = firstItemRow + index;
    const line = input.lines[index];
    if (!line) {
      return `<row r="${row}" ht="34" customHeight="1">${inline(`A${row}`, "", 7)}${styledBlanks(row, ["B", "C", "D"], 8)}${inline(`E${row}`, "-", 7)}${styledBlanks(row, ["F", "G"], 7)}${styledBlanks(row, ["H", "I"], 9)}${inline(`J${row}`, "", 7)}</row>`;
    }
    const quantity = Math.max(0, line.quantity);
    const unitPrice = line.complimentary ? 0 : Math.max(0, line.unitPrice);
    const amount = quantity * unitPrice;
    const fee = appliesProcurementFee(line) ? Math.floor(amount * Math.max(0, line.procurementFeeRate ?? 0.0054) / 10) * 10 : 0;
    const specification = line.specification || "-";
    const procurement = procurementLabel(line);
    const outputName = formatQuotationItemNameForOutput(line.name);
    const rowHeight = outputName.includes("\n") || specification.length > 42 || procurement.length > 18 ? 43 : 34;
    return `<row r="${row}" ht="${rowHeight}" customHeight="1">
      ${numeric(`A${row}`, index + 1, 7)}
      ${inline(`B${row}`, outputName, 8)}
      ${inline(`C${row}`, "", 8)}
      ${inline(`D${row}`, specification, 8)}
      ${inline(`E${row}`, procurement, 7)}
      ${numeric(`F${row}`, quantity, 7)}
      ${inline(`G${row}`, line.unit || "대", 7)}
      ${line.complimentary ? inline(`H${row}`, "무상", 9) : numeric(`H${row}`, unitPrice, 9)}
      ${line.complimentary ? inline(`I${row}`, "무상", 9) : formula(`I${row}`, `F${row}*H${row}`, amount, 9)}
      ${inline(`J${row}`, outputNote(line), 7)}
      ${numeric(`K${row}`, fee, 0)}
    </row>`;
  }).join("");

  const conditions = [
    ["견적 유효기간", validText],
    ["납품 및 설치", "발주기관과 일정 협의 후 진행"],
    ["대금 지급", "발주기관의 지급 조건에 따름"],
    ["하자보증", "납품 완료일로부터 1년"],
    ["비고", "표시 단가는 VAT·일반 수수료 포함, 조달수수료는 합계에 별도 반영"],
    ["담당", "위즈업 영업팀"],
    ["안내", input.memo || "본 견적서는 관공서 제출용입니다."],
  ];
  const summary = [
    ["품목금액 (VAT 포함)", calc.itemTotal, `SUM(I${firstItemRow}:I${lastItemRow})`],
    ["조달수수료 (별도)", calc.procurementFee, `SUM(K${firstItemRow}:K${lastItemRow})`],
    ["할인", calc.discount, ""],
    ["추가비용", calc.extra, ""],
    ["최종 합계", calc.total, `I${conditionStartRow}+I${conditionStartRow + 1}-I${conditionStartRow + 2}+I${conditionStartRow + 3}`],
    ["공급가액 (품목금액 기준)", calc.supply, `ROUND((I${conditionStartRow}-I${conditionStartRow + 2}+I${conditionStartRow + 3})/1.1,0)`],
    ["부가가치세 (품목금액 기준)", calc.vat, `I${conditionStartRow}-I${conditionStartRow + 2}+I${conditionStartRow + 3}-I${conditionStartRow + 5}`],
  ] as const;

  const bottomRows = conditions.map((condition, index) => {
    const row = conditionStartRow + index;
    const [label, value, expression] = summary[index];
    const final = label === "최종 합계";
    const amountCell = expression
      ? formula(`I${row}`, expression, value, final ? 17 : 15)
      : numeric(`I${row}`, value, final ? 17 : 15);
    const labelStyle = final ? 16 : 14;
    const amountStyle = final ? 17 : 15;
    return `<row r="${row}" ht="${final ? 29 : 23}" customHeight="1">${inline(`A${row}`, condition[0], 14)}${inline(`B${row}`, "", 14)}${inline(`C${row}`, condition[1], 4)}${styledBlanks(row, ["D", "E", "F"], 4)}${inline(`G${row}`, label, labelStyle)}${inline(`H${row}`, "", labelStyle)}${amountCell}${inline(`J${row}`, "", amountStyle)}</row>`;
  }).join("");

  const merges = [
    "A1:J1", "C2:H3", "F4:G4", "H4:J4", "F5:G5", "H5:J5",
    "A7:E7", "F7:J7",
    ...[8, 9, 10, 11, 12].flatMap((row) => [`A${row}:B${row}`, `C${row}:E${row}`, `F${row}:G${row}`, `H${row}:J${row}`]),
    "A14:C14", "D14:G14", "H14:J14", "B17:C17",
    ...Array.from({ length: itemCount }, (_, index) => firstItemRow + index).map((row) => `B${row}:C${row}`),
    `A${bottomHeaderRow}:F${bottomHeaderRow}`, `G${bottomHeaderRow}:J${bottomHeaderRow}`,
    ...conditions.flatMap((_, index) => {
      const row = conditionStartRow + index;
      return [`A${row}:B${row}`, `C${row}:F${row}`, `G${row}:H${row}`, `I${row}:J${row}`];
    }),
    `A${signatureStartRow}:F${signatureEndRow}`, `G${signatureStartRow}:I${signatureEndRow}`, `J${signatureStartRow}:J${signatureEndRow}`,
  ];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:K${signatureEndRow}"/>
  <sheetViews><sheetView showGridLines="0" zoomScale="85" workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>
    <col min="1" max="1" width="5.5" customWidth="1"/>
    <col min="2" max="2" width="16" customWidth="1"/>
    <col min="3" max="3" width="10" customWidth="1"/>
    <col min="4" max="4" width="21" customWidth="1"/>
    <col min="5" max="5" width="15" customWidth="1"/>
    <col min="6" max="6" width="7" customWidth="1"/>
    <col min="7" max="7" width="7" customWidth="1"/>
    <col min="8" max="8" width="13" customWidth="1"/>
    <col min="9" max="9" width="15" customWidth="1"/>
    <col min="10" max="10" width="13" customWidth="1"/>
    <col min="11" max="11" width="2" hidden="1" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1" ht="5" customHeight="1">${inline("A1", "", 19)}</row>
    <row r="2" ht="22" customHeight="1">${inline("C2", "견  적  서", 1)}</row>
    <row r="3" ht="22" customHeight="1"/>
    <row r="4" ht="22" customHeight="1">${inline("F4", "견적번호", 3)}${inline("G4", "", 3)}${inline("H4", input.quoteNumber || "저장 시 발급", 4)}${styledBlanks(4, ["I", "J"], 4)}</row>
    <row r="5" ht="22" customHeight="1">${inline("F5", "작성일", 3)}${inline("G5", "", 3)}${inline("H5", input.quoteDate, 4)}${styledBlanks(5, ["I", "J"], 4)}</row>
    <row r="7" ht="24" customHeight="1">${inline("A7", "받는 분", 2)}${styledBlanks(7, ["B", "C", "D", "E"], 2)}${inline("F7", "공급자", 2)}${styledBlanks(7, ["G", "H", "I", "J"], 2)}</row>
    <row r="8" ht="23" customHeight="1">${inline("A8", "수신", 3)}${inline("B8", "", 3)}${inline("C8", input.customerName || "미지정", 4)}${styledBlanks(8, ["D", "E"], 4)}${inline("F8", "상호", 3)}${inline("G8", "", 3)}${inline("H8", "주식회사 위즈업", 4)}${styledBlanks(8, ["I", "J"], 4)}</row>
    <row r="9" ht="23" customHeight="1">${inline("A9", "담당자", 3)}${inline("B9", "", 3)}${inline("C9", "담당자 귀하", 4)}${styledBlanks(9, ["D", "E"], 4)}${inline("F9", "사업자번호", 3)}${inline("G9", "", 3)}${inline("H9", "286-86-03454", 4)}${styledBlanks(9, ["I", "J"], 4)}</row>
    <row r="10" ht="23" customHeight="1">${inline("A10", "견적명", 3)}${inline("B10", "", 3)}${inline("C10", input.projectTitle || "제품 공급", 4)}${styledBlanks(10, ["D", "E"], 4)}${inline("F10", "대표자", 3)}${inline("G10", "", 3)}${inline("H10", "박원석", 4)}${styledBlanks(10, ["I", "J"], 4)}</row>
    <row r="11" ht="29" customHeight="1">${inline("A11", "유효기간", 3)}${inline("B11", "", 3)}${inline("C11", validText, 4)}${styledBlanks(11, ["D", "E"], 4)}${inline("F11", "주소", 3)}${inline("G11", "", 3)}${inline("H11", "경기도 하남시 하남대로 947, D동 1208호(풍산동)", 5)}${styledBlanks(11, ["I", "J"], 5)}</row>
    <row r="12" ht="29" customHeight="1">${inline("A12", "납품조건", 3)}${inline("B12", "", 3)}${inline("C12", "발주 후 일정 협의", 4)}${styledBlanks(12, ["D", "E"], 4)}${inline("F12", "업태·종목", 3)}${inline("G12", "", 3)}${inline("H12", "도매 및 소매업 · 정보통신업 / 컴퓨터 및 주변장치 공급", 5)}${styledBlanks(12, ["I", "J"], 5)}</row>
    <row r="14" ht="44" customHeight="1">${inline("A14", "견적금액 (VAT 포함 · 조달수수료 반영)", 10)}${styledBlanks(14, ["B", "C"], 10)}${inline("D14", koreanAmount(calc.total), 11)}${styledBlanks(14, ["E", "F", "G"], 11)}${formula("H14", `I${finalSummaryRow}`, calc.total, 12)}${styledBlanks(14, ["I", "J"], 12)}</row>
    <row r="15" ht="8" customHeight="1"/>
    <row r="17" ht="27" customHeight="1">${inline("A17", "No", 6)}${inline("B17", "품명", 6)}${inline("C17", "", 6)}${inline("D17", "규격", 6)}${inline("E17", "식별번호", 6)}${inline("F17", "수량", 6)}${inline("G17", "단위", 6)}${inline("H17", "단가", 6)}${inline("I17", "금액", 6)}${inline("J17", "비고", 6)}</row>
    ${itemRows}
    <row r="${bottomHeaderRow}" ht="24" customHeight="1">${inline(`A${bottomHeaderRow}`, "견적 조건 및 특이사항", 13)}${styledBlanks(bottomHeaderRow, ["B", "C", "D", "E", "F"], 13)}${inline(`G${bottomHeaderRow}`, "금액 요약", 13)}${styledBlanks(bottomHeaderRow, ["H", "I", "J"], 13)}</row>
    ${bottomRows}
    <row r="${signatureStartRow}" ht="26" customHeight="1">${inline(`A${signatureStartRow}`, `위와 같이 견적합니다.\n\n${koreanDate(input.quoteDate)}`, 18)}${inline(`G${signatureStartRow}`, "주식회사 위즈업\n대표이사  박 원 석", 18)}${inline(`J${signatureStartRow}`, "", 18)}</row>
    <row r="${signatureStartRow + 1}" ht="26" customHeight="1"/>
    <row r="${signatureEndRow}" ht="26" customHeight="1"/>
  </sheetData>
  <mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>
  <printOptions horizontalCentered="1" verticalCentered="0"/>
  <pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/>
  <pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0" horizontalDpi="300" verticalDpi="300"/>
  ${hasDrawing ? '<drawing r:id="rId1"/>' : ""}
</worksheet>`;
}

function equipmentKitSheetXml(input: QuotationWorkbookInput, hasDrawing: boolean) {
  const equipmentKit = input.equipmentKit!;
  const complimentary = input.equipmentKitComplimentary === true;
  const lines = airpassEquipmentKitOutputLines(equipmentKit);
  const firstRow = 17;
  const lineRows = lines.map((line, index) => {
    const row = firstRow + index;
    return `<row r="${row}" ht="31" customHeight="1">
      ${numeric(`A${row}`, index + 1, 7)}
      ${inline(`B${row}`, line.name, 8)}${styledBlanks(row, ["C"], 8)}
      ${numeric(`D${row}`, line.quantity, 7)}
      ${inline(`E${row}`, line.unit, 7)}
      ${complimentary ? inline(`F${row}`, "무상", 9) : numeric(`F${row}`, line.unitPrice, 9)}
      ${complimentary ? inline(`G${row}`, "무상", 9) : numeric(`G${row}`, line.quantity * line.unitPrice, 9)}${inline(`H${row}`, "", 9)}
      ${inline(`I${row}`, complimentary ? "무상 제공" : "", 7)}
    </row>`;
  }).join("");
  const totalRow = firstRow + Math.max(1, lines.length) + 1;
  const noticeRow = totalRow + 2;
  const signatureStartRow = noticeRow + 2;
  const signatureEndRow = signatureStartRow + 2;
  const merges = [
    "A1:I1", "B2:F3", "G2:I2", "H3:I3", "H4:I4",
    "A5:D5", "E5:I5",
    ...[6, 7, 8, 9, 10].flatMap((row) => [`A${row}:B${row}`, `C${row}:D${row}`, `E${row}:F${row}`, `G${row}:I${row}`]),
    "A12:C12", "D12:F12", "G12:I12", "A14:I14", "B16:C16", "G16:H16",
    ...lines.flatMap((_, index) => [`B${firstRow + index}:C${firstRow + index}`, `G${firstRow + index}:H${firstRow + index}`]),
    `A${totalRow}:F${totalRow}`, `G${totalRow}:I${totalRow}`,
    `A${noticeRow}:I${noticeRow}`,
    `A${signatureStartRow}:E${signatureEndRow}`, `F${signatureStartRow}:H${signatureEndRow}`, `I${signatureStartRow}:I${signatureEndRow}`,
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:I${signatureEndRow}"/>
  <sheetViews><sheetView showGridLines="0" zoomScale="85" workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols><col min="1" max="1" width="6" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="17" customWidth="1"/><col min="4" max="5" width="9" customWidth="1"/><col min="6" max="6" width="15" customWidth="1"/><col min="7" max="8" width="14" customWidth="1"/><col min="9" max="9" width="14" customWidth="1"/></cols>
  <sheetData>
    <row r="1" ht="5" customHeight="1">${inline("A1", "", 19)}</row>
    <row r="2" ht="24" customHeight="1">${inline("B2", "교  구  세  부  견  적  서", 1)}</row>
    <row r="3" ht="22" customHeight="1">${inline("G3", "견적번호", 3)}${inline("H3", input.quoteNumber || "저장 시 발급", 4)}${inline("I3", "", 4)}</row>
    <row r="4" ht="22" customHeight="1">${inline("G4", "작성일", 3)}${inline("H4", input.quoteDate, 4)}${inline("I4", "", 4)}</row>
    <row r="5" ht="24" customHeight="1">${inline("A5", "받는 분", 2)}${styledBlanks(5, ["B", "C", "D"], 2)}${inline("E5", "공급자", 2)}${styledBlanks(5, ["F", "G", "H", "I"], 2)}</row>
    <row r="6" ht="23" customHeight="1">${inline("A6", "수신", 3)}${inline("B6", "", 3)}${inline("C6", input.customerName || "미지정", 4)}${inline("D6", "", 4)}${inline("E6", "상호", 3)}${inline("F6", "", 3)}${inline("G6", AIRPASS_COMPANY.name, 4)}${styledBlanks(6, ["H", "I"], 4)}</row>
    <row r="7" ht="23" customHeight="1">${inline("A7", "견적명", 3)}${inline("B7", "", 3)}${inline("C7", input.projectTitle || "제품 공급", 4)}${inline("D7", "", 4)}${inline("E7", "사업자번호", 3)}${inline("F7", "", 3)}${inline("G7", AIRPASS_COMPANY.businessNumber, 4)}${styledBlanks(7, ["H", "I"], 4)}</row>
    <row r="8" ht="23" customHeight="1">${inline("A8", "계약구분", 3)}${inline("B8", "", 3)}${inline("C8", "수의계약", 4)}${inline("D8", "", 4)}${inline("E8", "대표자", 3)}${inline("F8", "", 3)}${inline("G8", AIRPASS_COMPANY.representative, 4)}${styledBlanks(8, ["H", "I"], 4)}</row>
    <row r="9" ht="30" customHeight="1">${inline("A9", "납품조건", 3)}${inline("B9", "", 3)}${inline("C9", "발주 후 일정 협의", 4)}${inline("D9", "", 4)}${inline("E9", "주소", 3)}${inline("F9", "", 3)}${inline("G9", AIRPASS_COMPANY.address, 5)}${styledBlanks(9, ["H", "I"], 5)}</row>
    <row r="10" ht="30" customHeight="1">${inline("A10", "유효기간", 3)}${inline("B10", "", 3)}${inline("C10", input.validUntil ? `${input.validUntil}까지` : "견적일로부터 30일", 4)}${inline("D10", "", 4)}${inline("E10", "업태·종목", 3)}${inline("F10", "", 3)}${inline("G10", `${AIRPASS_COMPANY.businessType} / ${AIRPASS_COMPANY.businessItems}`, 5)}${styledBlanks(10, ["H", "I"], 5)}</row>
    <row r="12" ht="42" customHeight="1">${inline("A12", complimentary ? "제공 조건" : "견적금액 (VAT 포함)", 10)}${styledBlanks(12, ["B", "C"], 10)}${inline("D12", complimentary ? "무상 제공" : koreanAmount(airpassEquipmentKitTotal(equipmentKit)), 11)}${styledBlanks(12, ["E", "F"], 11)}${complimentary ? inline("G12", "무상 제공", 12) : numeric("G12", airpassEquipmentKitTotal(equipmentKit), 12)}${styledBlanks(12, ["H", "I"], 12)}</row>
    <row r="14" ht="27" customHeight="1">${inline("A14", "에어패스 교구 세부내역", 2)}${styledBlanks(14, ["B", "C", "D", "E", "F", "G", "H", "I"], 2)}</row>
    <row r="16" ht="27" customHeight="1">${inline("A16", "No", 6)}${inline("B16", "품명", 6)}${inline("D16", "수량", 6)}${inline("E16", "단위", 6)}${inline("F16", "단가", 6)}${inline("G16", "금액", 6)}${inline("H16", "", 6)}${inline("I16", "비고", 6)}</row>
    ${lineRows || `<row r="${firstRow}" ht="31" customHeight="1">${inline(`A${firstRow}`, "", 7)}${inline(`B${firstRow}`, "출력할 교구 품목이 없습니다.", 8)}${inline(`C${firstRow}`, "", 8)}${styledBlanks(firstRow, ["D", "E", "F", "G", "H", "I"], 7)}</row>`}
    <row r="${totalRow}" ht="34" customHeight="1">${inline(`A${totalRow}`, complimentary ? "제공 금액" : "합계금액 (VAT 포함)", 16)}${styledBlanks(totalRow, ["B", "C", "D", "E", "F"], 16)}${complimentary ? inline(`G${totalRow}`, "무상 제공", 17) : numeric(`G${totalRow}`, airpassEquipmentKitTotal(equipmentKit), 17)}${styledBlanks(totalRow, ["H", "I"], 17)}</row>
    <row r="${noticeRow}" ht="25" customHeight="1">${inline(`A${noticeRow}`, `${AIRPASS_COMPANY.name} · 본 세부견적은 본 견적서와 함께 제출됩니다.`, 18)}</row>
    <row r="${signatureStartRow}" ht="26" customHeight="1">${inline(`A${signatureStartRow}`, `위와 같이 견적합니다.\n\n${koreanDate(input.quoteDate)}`, 18)}${inline(`F${signatureStartRow}`, `${AIRPASS_COMPANY.name}\n대표이사  ${AIRPASS_COMPANY.representative}`, 18)}${inline(`I${signatureStartRow}`, "", 18)}</row>
    <row r="${signatureStartRow + 1}" ht="26" customHeight="1"/><row r="${signatureEndRow}" ht="26" customHeight="1"/>
  </sheetData>
  <mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>
  <printOptions horizontalCentered="1" verticalCentered="0"/>
  <pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.15" footer="0.15"/>
  <pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1" horizontalDpi="300" verticalDpi="300"/>
  ${hasDrawing ? '<drawing r:id="rId1"/>' : ""}
</worksheet>`;
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0&quot;원&quot;;[Red](#,##0)&quot;원&quot;;-"/></numFmts>
  <fonts count="7">
    <font><sz val="9"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="22"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FF26354D"/><sz val="9"/><name val="맑은 고딕"/></font>
    <font><b/><color rgb="FF2254D1"/><sz val="18"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="10"/><name val="맑은 고딕"/></font>
    <font><b/><sz val="12"/><name val="맑은 고딕"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF182842"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF3157E6"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFCCD6E6"/></left><right style="thin"><color rgb="FFCCD6E6"/></right><top style="thin"><color rgb="FFCCD6E6"/></top><bottom style="thin"><color rgb="FFCCD6E6"/></bottom><diagonal/></border>
    <border><left/><right/><top style="medium"><color rgb="FF3157E6"/></top><bottom style="medium"><color rgb="FF3157E6"/></bottom><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFD7E0EC"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="20">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="4" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="4" fillId="4" borderId="3" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function pictureAnchor(id: number, name: string, relationshipId: string, column: number, row: number, width: number, height: number) {
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>${column}</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>38100</xdr:rowOff></xdr:from><xdr:ext cx="${width * 9525}" cy="${height * 9525}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${xml(name)}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
}

function drawingXml(hasLogo: boolean, hasSeal: boolean, signatureStartRow: number) {
  const anchors: string[] = [];
  if (hasLogo) anchors.push(pictureAnchor(2, "WHIZZUP Logo", "rId1", 0, 1, 145, 82));
  if (hasSeal) anchors.push(pictureAnchor(3, "직인", `rId${hasLogo ? 2 : 1}`, 9, signatureStartRow - 1, 72, 72));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join("")}</xdr:wsDr>`;
}

function airpassDrawingXml(signatureStartRow: number) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${pictureAnchor(2, "에어패스 직인", "rId1", 8, signatureStartRow - 1, 72, 72)}</xdr:wsDr>`;
}

export function createQuotationWorkbook(input: QuotationWorkbookInput) {
  const hasLogo = Boolean(input.logoData?.length);
  const hasSeal = Boolean(input.includeStamp && input.sealData?.length);
  const hasDrawing = hasLogo || hasSeal;
  const extraBlankRows = Math.min(5, Math.max(0, Math.floor(input.extraBlankRows ?? 0)));
  const itemCount = Math.max(1, input.lines.length) + extraBlankRows;
  const signatureStartRow = 18 + itemCount - 1 + 2 + 1 + 6 + 2;
  const signatureEndRow = signatureStartRow + 2;
  const now = new Date().toISOString();
  const hasEquipmentKit = Boolean(input.equipmentKit);
  const equipmentKitSignatureStartRow = hasEquipmentKit ? 17 + Math.max(1, airpassEquipmentKitOutputLines(input.equipmentKit).length) + 5 : 0;
  const equipmentKitFooterRow = hasEquipmentKit ? equipmentKitSignatureStartRow + 2 : 0;
  const hasAirpassDrawing = Boolean(hasEquipmentKit && input.airpassSealData?.length);
  const drawingRels = hasDrawing ? `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hasLogo ? '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/>' : ""}${hasSeal ? `<Relationship Id="rId${hasLogo ? 2 : 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/seal.png"/>` : ""}</Relationships>` : "";
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${hasEquipmentKit ? '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' : ""}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hasDrawing ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}${hasAirpassDrawing ? '<Override PartName="/xl/drawings/drawing2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    "_rels/.rels": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    "xl/workbook.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="견적서" sheetId="1" r:id="rId1"/>${hasEquipmentKit ? '<sheet name="교구 세부견적" sheetId="2" r:id="rId2"/>' : ""}</sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'견적서'!$A$1:$J$${signatureEndRow}</definedName>${hasEquipmentKit ? `<definedName name="_xlnm.Print_Area" localSheetId="1">'교구 세부견적'!$A$1:$J$${equipmentKitFooterRow}</definedName>` : ""}</definedNames><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`),
    "xl/_rels/workbook.xml.rels": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${hasEquipmentKit ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' : ""}<Relationship Id="rId${hasEquipmentKit ? 3 : 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": bytes(sheetXml(input, hasDrawing)),
    "xl/styles.xml": bytes(styles),
    "docProps/core.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(input.customerName)} 견적서</dc:title><dc:creator>WHIZZUP</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`),
    "docProps/app.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WHIZZUP Sales Hub</Application></Properties>`),
  };
  if (hasEquipmentKit) files["xl/worksheets/sheet2.xml"] = bytes(equipmentKitSheetXml(input, hasAirpassDrawing));
  if (hasDrawing) {
    files["xl/worksheets/_rels/sheet1.xml.rels"] = bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
    files["xl/drawings/drawing1.xml"] = bytes(drawingXml(hasLogo, hasSeal, signatureStartRow));
    files["xl/drawings/_rels/drawing1.xml.rels"] = bytes(drawingRels);
    if (hasLogo) files["xl/media/logo.png"] = input.logoData!;
    if (hasSeal) files["xl/media/seal.png"] = input.sealData!;
  }
  if (hasAirpassDrawing) {
    files["xl/worksheets/_rels/sheet2.xml.rels"] = bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing2.xml"/></Relationships>`);
    files["xl/drawings/drawing2.xml"] = bytes(airpassDrawingXml(equipmentKitSignatureStartRow));
    files["xl/drawings/_rels/drawing2.xml.rels"] = bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/airpass-seal.png"/></Relationships>`);
    files["xl/media/airpass-seal.png"] = input.airpassSealData!;
  }
  return zipSync(files, { level: 6 });
}
