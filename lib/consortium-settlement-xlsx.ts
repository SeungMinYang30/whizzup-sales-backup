import { zipSync } from "fflate";
import type { InternalCostBearer } from "./consortium-settlement";
import { formatQuotationItemNameForOutput } from "./quotation-output-text";

export type ConsortiumSettlementWorkbookInput = {
  organization: string;
  businessRound: number;
  projectTitle: string;
  quoteDate: string;
  quoteNumber?: string;
  consortiumCompany: string;
  includeStamp?: boolean;
  logoData?: Uint8Array;
  sealData?: Uint8Array;
  items: Array<{
    name: string;
    contractLabel: string;
    lineAmount: number;
    consortiumRate: number;
    grossPayment: number;
  }>;
  costs: Array<{
    label: string;
    amount: number;
    bearer: InternalCostBearer;
    consortiumDeduction: number;
    quantity?: number;
    unitAmount?: number;
  }>;
  adjustments?: Array<{
    id?: string;
    type: "addition" | "deduction";
    label: string;
    amount: number;
    note?: string;
  }>;
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
const rate = (ref: string, value: number, style = 0) => `<c r="${ref}" s="${style}"><v>${Math.max(0, Math.min(1, value))}</v></c>`;
const formula = (ref: string, expression: string, cached: number, style = 0) => `<c r="${ref}" s="${style}"><f>${xml(expression)}</f><v>${Math.round(cached)}</v></c>`;
const styledBlanks = (row: number, columns: string[], style: number) => columns.map((column) => inline(`${column}${row}`, "", style)).join("");

function koreanDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? `${year}년 ${month}월 ${day}일` : value;
}

function koreanAmount(value: number) {
  return `금 ${Math.max(0, Math.round(value)).toLocaleString("ko-KR")}원정`;
}

function settlementSignRow(input: ConsortiumSettlementWorkbookInput) {
  const firstItemRow = 15;
  const itemCount = Math.max(1, input.items.length);
  const lastItemRow = firstItemRow + itemCount - 1;
  const costTitleRow = lastItemRow + 2;
  const firstCostRow = costTitleRow + 2;
  const costCount = Math.max(1, input.costs.length);
  const lastCostRow = firstCostRow + costCount - 1;
  const adjustmentCount = input.adjustments?.length ?? 0;
  const summaryRow = adjustmentCount > 0 ? lastCostRow + adjustmentCount + 4 : lastCostRow + 2;
  return summaryRow + 7;
}

function settlementSheet(input: ConsortiumSettlementWorkbookInput, hasDrawing: boolean) {
  const firstItemRow = 15;
  const itemCount = Math.max(1, input.items.length);
  const lastItemRow = firstItemRow + itemCount - 1;
  const costTitleRow = lastItemRow + 2;
  const firstCostRow = costTitleRow + 2;
  const costCount = Math.max(1, input.costs.length);
  const lastCostRow = firstCostRow + costCount - 1;
  const adjustments = input.adjustments ?? [];
  const adjustmentTitleRow = adjustments.length ? lastCostRow + 2 : 0;
  const firstAdjustmentRow = adjustments.length ? adjustmentTitleRow + 2 : 0;
  const lastAdjustmentRow = adjustments.length ? firstAdjustmentRow + adjustments.length - 1 : 0;
  const summaryRow = adjustments.length ? lastAdjustmentRow + 2 : lastCostRow + 2;
  const signRow = settlementSignRow(input);
  const gross = input.items.reduce((sum, item) => sum + item.grossPayment, 0);
  const consortiumCost = input.costs.reduce((sum, cost) => sum + cost.consortiumDeduction, 0);
  const adjustmentAdditions = adjustments.reduce((sum, item) => sum + (item.type === "addition" ? item.amount : 0), 0);
  const adjustmentDeductions = adjustments.reduce((sum, item) => sum + (item.type === "deduction" ? item.amount : 0), 0);
  const finalPayment = gross - consortiumCost - adjustmentDeductions + adjustmentAdditions;
  const supply = Math.round(finalPayment / 1.1);
  const vat = finalPayment - supply;

  const itemRows = input.items.length ? input.items.map((item, index) => {
    const row = firstItemRow + index;
    const outputName = formatQuotationItemNameForOutput(item.name);
    return `<row r="${row}" ht="${outputName.includes("\n") ? 42 : 31}" customHeight="1">${numeric(`A${row}`, index + 1, 7)}${inline(`B${row}`, outputName, 8)}${inline(`C${row}`, item.contractLabel, 7)}${numeric(`D${row}`, item.lineAmount, 9)}${rate(`E${row}`, item.consortiumRate, 10)}${formula(`F${row}`, `FLOOR(D${row}*E${row},10)`, item.grossPayment, 9)}${inline(`G${row}`, "", 8)}</row>`;
  }).join("") : `<row r="${firstItemRow}" ht="31" customHeight="1">${inline(`A${firstItemRow}`, "", 7)}${inline(`B${firstItemRow}`, "정산 대상 품목이 없습니다.", 8)}${inline(`C${firstItemRow}`, "", 7)}${numeric(`D${firstItemRow}`, 0, 9)}${rate(`E${firstItemRow}`, 0, 10)}${numeric(`F${firstItemRow}`, 0, 9)}${inline(`G${firstItemRow}`, "", 8)}</row>`;

  const costRows = input.costs.length ? input.costs.map((cost, index) => {
    const row = firstCostRow + index;
    const treatment = cost.bearer === "consortium" ? "정산서 반영" : "위즈업 별도 처리";
    const quantity = Math.max(1, Math.round(cost.quantity ?? 1));
    const unitAmount = Math.max(0, Math.round(cost.unitAmount ?? cost.amount));
    return `<row r="${row}" ht="29" customHeight="1">${numeric(`A${row}`, index + 1, 7)}${inline(`B${row}`, cost.label, 8)}${numeric(`C${row}`, quantity, 7)}${numeric(`D${row}`, unitAmount, 9)}${numeric(`E${row}`, cost.amount, 9)}${inline(`F${row}`, treatment, 7)}${inline(`G${row}`, cost.bearer === "consortium" ? "지급액 차감" : "정산 미반영", 8)}</row>`;
  }).join("") : `<row r="${firstCostRow}" ht="29" customHeight="1">${inline(`A${firstCostRow}`, "", 7)}${inline(`B${firstCostRow}`, "별도 비용 없음", 8)}${numeric(`C${firstCostRow}`, 0, 7)}${numeric(`D${firstCostRow}`, 0, 9)}${numeric(`E${firstCostRow}`, 0, 9)}${inline(`F${firstCostRow}`, "-", 7)}${inline(`G${firstCostRow}`, "", 8)}</row>`;

  const adjustmentRows = adjustments.map((adjustment, index) => {
    const row = firstAdjustmentRow + index;
    return `<row r="${row}" ht="29" customHeight="1">${numeric(`A${row}`, index + 1, 7)}${inline(`B${row}`, adjustment.type === "addition" ? "추가 지급" : "정산 차감", 7)}${inline(`C${row}`, adjustment.label, 8)}${styledBlanks(row, ["D"], 8)}${inline(`E${row}`, adjustment.note ?? "", 8)}${styledBlanks(row, ["F"], 8)}${numeric(`G${row}`, adjustment.amount, adjustment.type === "deduction" ? 11 : 9)}</row>`;
  }).join("");

  const merges = [
    "C2:E3", "D4:E4", "F4:G4", "D5:E5", "F5:G5",
    "A7:C7", "D7:G7",
    "B8:C8", "E8:G8", "B9:C9", "E9:G9", "B10:C10", "E10:G10",
    "A12:B12", "C12:E12", "F12:G12",
    `A${costTitleRow}:G${costTitleRow}`,
    ...(adjustments.length ? [
      `A${adjustmentTitleRow}:G${adjustmentTitleRow}`,
      ...Array.from({ length: adjustments.length }, (_, index) => [
        `C${firstAdjustmentRow + index}:D${firstAdjustmentRow + index}`,
        `E${firstAdjustmentRow + index}:F${firstAdjustmentRow + index}`,
      ]).flat(),
    ] : []),
    `A${summaryRow}:D${summaryRow}`, `E${summaryRow}:G${summaryRow}`,
    ...Array.from({ length: 5 }, (_, index) => [`B${summaryRow + 1 + index}:D${summaryRow + 1 + index}`, `F${summaryRow + 1 + index}:G${summaryRow + 1 + index}`]).flat(),
    `A${signRow}:C${signRow + 2}`, `D${signRow}:G${signRow + 2}`,
  ];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:G${signRow + 2}"/><sheetViews><sheetView showGridLines="0" zoomScale="90" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="1" width="13" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="13" customWidth="1"/><col min="4" max="4" width="17" customWidth="1"/><col min="5" max="5" width="17" customWidth="1"/><col min="6" max="6" width="20" customWidth="1"/><col min="7" max="7" width="18" customWidth="1"/></cols><sheetData>
<row r="1" ht="4" customHeight="1">${inline("A1", "", 15)}${styledBlanks(1, ["B", "C", "D", "E", "F", "G"], 15)}</row>
<row r="2" ht="25" customHeight="1">${inline("C2", "정  산  서", 1)}</row><row r="3" ht="25" customHeight="1"/>
<row r="4" ht="22" customHeight="1">${inline("D4", "견적번호", 3)}${inline("E4", "", 3)}${inline("F4", input.quoteNumber || "저장 전", 4)}${inline("G4", "", 4)}</row>
<row r="5" ht="22" customHeight="1">${inline("D5", "작성일", 3)}${inline("E5", "", 3)}${inline("F5", input.quoteDate, 4)}${inline("G5", "", 4)}</row>
<row r="7" ht="26" customHeight="1">${inline("A7", "정산 대상", 2)}${styledBlanks(7, ["B", "C"], 2)}${inline("D7", "정산 정보", 2)}${styledBlanks(7, ["E", "F", "G"], 2)}</row>
<row r="8" ht="23" customHeight="1">${inline("A8", "기관", 3)}${inline("B8", input.organization, 4)}${inline("C8", "", 4)}${inline("D8", "컨소 업체", 3)}${inline("E8", input.consortiumCompany || "미입력", 4)}${styledBlanks(8, ["F", "G"], 4)}</row>
<row r="9" ht="23" customHeight="1">${inline("A9", "사업·견적명", 3)}${inline("B9", input.projectTitle || `${input.businessRound}차 사업`, 4)}${inline("C9", "", 4)}${inline("D9", "비용 처리", 3)}${inline("E9", "정산서 반영 / 위즈업 별도 처리", 4)}${styledBlanks(9, ["F", "G"], 4)}</row>
<row r="10" ht="23" customHeight="1">${inline("A10", "사업 차수", 3)}${inline("B10", `${input.businessRound}차`, 4)}${inline("C10", "", 4)}${inline("D10", "정산 기준", 3)}${inline("E10", "견적 기준 지급 예정액", 4)}${styledBlanks(10, ["F", "G"], 4)}</row>
<row r="12" ht="40" customHeight="1">${inline("A12", "최종 지급 예정액 (VAT 포함)", 16)}${inline("B12", "", 16)}${inline("C12", koreanAmount(finalPayment), 16)}${styledBlanks(12, ["D", "E"], 16)}${formula("F12", `SUM(F${firstItemRow}:F${lastItemRow})-SUMIF(F${firstCostRow}:F${lastCostRow},"정산서 반영",E${firstCostRow}:E${lastCostRow})${adjustments.length ? `-SUMIF(B${firstAdjustmentRow}:B${lastAdjustmentRow},"정산 차감",G${firstAdjustmentRow}:G${lastAdjustmentRow})+SUMIF(B${firstAdjustmentRow}:B${lastAdjustmentRow},"추가 지급",G${firstAdjustmentRow}:G${lastAdjustmentRow})` : ""}`, finalPayment, 17)}${inline("G12", "", 17)}</row>
<row r="14" ht="29" customHeight="1">${inline("A14", "No", 6)}${inline("B14", "품목", 6)}${inline("C14", "계약 구분", 6)}${inline("D14", "정산 기준금액\n(VAT 포함)", 6)}${inline("E14", "컨소 지급률", 6)}${inline("F14", "기본 정산액", 6)}${inline("G14", "비고", 6)}</row>
${itemRows}<row r="${costTitleRow}" ht="27" customHeight="1">${inline(`A${costTitleRow}`, "별도 비용 처리 내역", 2)}${styledBlanks(costTitleRow, ["B", "C", "D", "E", "F", "G"], 2)}</row>
<row r="${firstCostRow - 1}" ht="27" customHeight="1">${inline(`A${firstCostRow - 1}`, "No", 6)}${inline(`B${firstCostRow - 1}`, "비용 항목", 6)}${inline(`C${firstCostRow - 1}`, "수량", 6)}${inline(`D${firstCostRow - 1}`, "단가", 6)}${inline(`E${firstCostRow - 1}`, "합계", 6)}${inline(`F${firstCostRow - 1}`, "비용 처리 방식", 6)}${inline(`G${firstCostRow - 1}`, "반영 결과", 6)}</row>${costRows}
${adjustments.length ? `<row r="${adjustmentTitleRow}" ht="27" customHeight="1">${inline(`A${adjustmentTitleRow}`, "정산 조정 내역", 2)}${styledBlanks(adjustmentTitleRow, ["B", "C", "D", "E", "F", "G"], 2)}</row><row r="${firstAdjustmentRow - 1}" ht="27" customHeight="1">${inline(`A${firstAdjustmentRow - 1}`, "No", 6)}${inline(`B${firstAdjustmentRow - 1}`, "구분", 6)}${inline(`C${firstAdjustmentRow - 1}`, "항목", 6)}${inline(`D${firstAdjustmentRow - 1}`, "", 6)}${inline(`E${firstAdjustmentRow - 1}`, "사유·비고", 6)}${inline(`F${firstAdjustmentRow - 1}`, "", 6)}${inline(`G${firstAdjustmentRow - 1}`, "금액", 6)}</row>${adjustmentRows}` : ""}
<row r="${summaryRow}" ht="26" customHeight="1">${inline(`A${summaryRow}`, "정산 조건 및 안내", 2)}${styledBlanks(summaryRow, ["B", "C", "D"], 2)}${inline(`E${summaryRow}`, "금액 요약", 2)}${styledBlanks(summaryRow, ["F", "G"], 2)}</row>
<row r="${summaryRow + 1}" ht="23" customHeight="1">${inline(`A${summaryRow + 1}`, "정산 기준", 3)}${inline(`B${summaryRow + 1}`, "견적 기준 지급 예정액", 4)}${styledBlanks(summaryRow + 1, ["C", "D"], 4)}${inline(`E${summaryRow + 1}`, "기본 정산액", 3)}${formula(`F${summaryRow + 1}`, `SUM(F${firstItemRow}:F${lastItemRow})`, gross, 9)}${inline(`G${summaryRow + 1}`, "", 9)}</row>
<row r="${summaryRow + 2}" ht="23" customHeight="1">${inline(`A${summaryRow + 2}`, "비용 처리", 3)}${inline(`B${summaryRow + 2}`, "정산서 반영 비용과 조정 내역 포함", 4)}${styledBlanks(summaryRow + 2, ["C", "D"], 4)}${inline(`E${summaryRow + 2}`, "비용·조정 순차감", 3)}${formula(`F${summaryRow + 2}`, `SUMIF(F${firstCostRow}:F${lastCostRow},"정산서 반영",E${firstCostRow}:E${lastCostRow})${adjustments.length ? `+SUMIF(B${firstAdjustmentRow}:B${lastAdjustmentRow},"정산 차감",G${firstAdjustmentRow}:G${lastAdjustmentRow})-SUMIF(B${firstAdjustmentRow}:B${lastAdjustmentRow},"추가 지급",G${firstAdjustmentRow}:G${lastAdjustmentRow})` : ""}`, consortiumCost + adjustmentDeductions - adjustmentAdditions, 11)}${inline(`G${summaryRow + 2}`, "", 11)}</row>
<row r="${summaryRow + 3}" ht="23" customHeight="1">${inline(`A${summaryRow + 3}`, "지급 조건", 3)}${inline(`B${summaryRow + 3}`, "상호 협의 후 확정", 4)}${styledBlanks(summaryRow + 3, ["C", "D"], 4)}${inline(`E${summaryRow + 3}`, "공급가액", 3)}${formula(`F${summaryRow + 3}`, `ROUND(F${summaryRow + 5}/1.1,0)`, supply, 9)}${inline(`G${summaryRow + 3}`, "", 9)}</row>
<row r="${summaryRow + 4}" ht="23" customHeight="1">${inline(`A${summaryRow + 4}`, "세금계산서", 3)}${inline(`B${summaryRow + 4}`, "지급 조건 확인 후 발행", 4)}${styledBlanks(summaryRow + 4, ["C", "D"], 4)}${inline(`E${summaryRow + 4}`, "부가가치세", 3)}${formula(`F${summaryRow + 4}`, `F${summaryRow + 5}-F${summaryRow + 3}`, vat, 9)}${inline(`G${summaryRow + 4}`, "", 9)}</row>
<row r="${summaryRow + 5}" ht="31" customHeight="1">${inline(`A${summaryRow + 5}`, "안내", 3)}${inline(`B${summaryRow + 5}`, "실제 지급일은 상호 확인 후 확정합니다.", 4)}${styledBlanks(summaryRow + 5, ["C", "D"], 4)}${inline(`E${summaryRow + 5}`, "최종 지급 예정액", 16)}${formula(`F${summaryRow + 5}`, `F${summaryRow + 1}-F${summaryRow + 2}`, finalPayment, 17)}${inline(`G${summaryRow + 5}`, "", 17)}</row>
<row r="${signRow}" ht="28" customHeight="1">${inline(`A${signRow}`, `위와 같이 정산합니다.\n\n${koreanDate(input.quoteDate)}`, 19)}${inline(`D${signRow}`, "주식회사 위즈업\n대표이사  박 원 석", 19)}</row><row r="${signRow + 1}" ht="28" customHeight="1"/><row r="${signRow + 2}" ht="28" customHeight="1"/>
</sheetData><mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0" horizontalDpi="300" verticalDpi="300"/>${hasDrawing ? '<drawing r:id="rId1"/>' : ""}</worksheet>`;
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0&quot;원&quot;;[Red](#,##0)&quot;원&quot;;-"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="7"><font><sz val="9"/><name val="맑은 고딕"/></font><font><b/><sz val="22"/><color rgb="FF182842"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="맑은 고딕"/></font><font><b/><color rgb="FF52617D"/><sz val="9"/><name val="맑은 고딕"/></font><font><b/><color rgb="FF2254D1"/><sz val="18"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFC24B3F"/><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF182842"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3157E6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF5E8"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCCD6E6"/></left><right style="thin"><color rgb="FFCCD6E6"/></right><top style="thin"><color rgb="FFCCD6E6"/></top><bottom style="thin"><color rgb="FFCCD6E6"/></bottom><diagonal/></border><border><left/><right/><top style="medium"><color rgb="FF3157E6"/></top><bottom style="medium"><color rgb="FF3157E6"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="20"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="5" fillId="6" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="6" fillId="4" borderId="2" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="164" fontId="4" fillId="4" borderId="2" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="5" fillId="6" borderId="2" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="0"/><xf numFmtId="0" fontId="6" fillId="4" borderId="2" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="164" fontId="4" fillId="4" borderId="2" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="6" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function pictureAnchor(id: number, name: string, relationshipId: string, column: number, row: number, width: number, height: number) {
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>${column}</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>38100</xdr:rowOff></xdr:from><xdr:ext cx="${width * 9525}" cy="${height * 9525}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${xml(name)}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
}

function drawingXml(hasLogo: boolean, hasSeal: boolean, signRow: number) {
  const anchors: string[] = [];
  if (hasLogo) anchors.push(pictureAnchor(2, "WHIZZUP Logo", "rId1", 0, 1, 120, 72));
  if (hasSeal) anchors.push(pictureAnchor(3, "직인", `rId${hasLogo ? 2 : 1}`, 6, signRow - 1, 68, 68));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join("")}</xdr:wsDr>`;
}

export function createConsortiumSettlementWorkbook(input: ConsortiumSettlementWorkbookInput) {
  const now = new Date().toISOString();
  const hasLogo = Boolean(input.logoData?.length);
  const hasSeal = Boolean(input.includeStamp && input.sealData?.length);
  const hasDrawing = hasLogo || hasSeal;
  const signRow = settlementSignRow(input);
  const sheet = settlementSheet(input, hasDrawing);
  const drawingRels = hasDrawing ? `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hasLogo ? '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/>' : ""}${hasSeal ? `<Relationship Id="rId${hasLogo ? 2 : 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/seal.png"/>` : ""}</Relationships>` : "";
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hasDrawing ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    "_rels/.rels": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    "xl/workbook.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="22000" windowHeight="12000"/></bookViews><sheets><sheet name="정산서" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'정산서'!$A$1:$G$${sheet.match(/<dimension ref="A1:G(\d+)"/)?.[1] ?? 40}</definedName></definedNames><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`),
    "xl/_rels/workbook.xml.rels": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": bytes(sheet),
    "xl/styles.xml": bytes(styles),
    "docProps/core.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(input.organization)} 정산서</dc:title><dc:creator>WHIZZUP</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`),
    "docProps/app.xml": bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>WHIZZUP Sales Hub</Application></Properties>`),
  };
  if (hasDrawing) {
    files["xl/worksheets/_rels/sheet1.xml.rels"] = bytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
    files["xl/drawings/drawing1.xml"] = bytes(drawingXml(hasLogo, hasSeal, signRow));
    files["xl/drawings/_rels/drawing1.xml.rels"] = bytes(drawingRels);
    if (hasLogo) files["xl/media/logo.png"] = input.logoData!;
    if (hasSeal) files["xl/media/seal.png"] = input.sealData!;
  }
  return zipSync(files, { level: 6 });
}
