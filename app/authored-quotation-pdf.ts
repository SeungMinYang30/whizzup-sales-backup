import type { AuthoredQuotation, AuthoredQuotationItem } from "../lib/authored-quotations";
import { airpassEquipmentKitOutputLines, airpassEquipmentKitTotal } from "../lib/airpass-equipment-kit";
import { fieldInspectionDownloadName, quotationDownloadName, quotationFileStem } from "../lib/quotation-file-name";
import { AIRPASS_COMPANY, AIRPASS_EQUIPMENT_CONTRACT_NOTE } from "../lib/airpass-company";
import { formatQuotationItemNameForOutput } from "../lib/quotation-output-text";
import {
  FIELD_INSPECTION_NOTICE,
  FIELD_SUPPORT_COMPANY,
  fieldInspectionEquipmentLines,
  fieldInspectionProductLines,
  fieldInspectionSupplierText,
  fieldInspectionVisitorName,
} from "../lib/quotation-inspection";

export { quotationFileStem } from "../lib/quotation-file-name";

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const PDF_RENDER_SCALE = 2;
const PDF_WIDTH = 595.28;
const PDF_HEIGHT = 841.89;

type AuthoredQuotationPdfItem = Pick<
  AuthoredQuotationItem,
  "name" | "specification" | "quantity" | "unit" | "unitPrice" | "note" | "contractType" | "procurement" | "procurementChannel" | "procurementNumber" | "procurementFee" | "equipmentKit" | "complimentary"
>;

export type AuthoredQuotationPdfInput = Pick<
  AuthoredQuotation,
  "organization" | "projectTitle" | "quoteDate" | "quoteNumber" | "validUntil" | "includeStamp" | "discountAmount" | "extraAmount" | "memo"
> & { items: AuthoredQuotationPdfItem[] };

const won = new Intl.NumberFormat("ko-KR");

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function splitText(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines = 2) {
  const source = String(value ?? "").trim();
  if (!source) return [""];
  const lines: string[] = [];
  for (const paragraph of source.split(/\r?\n/u)) {
    let line = "";
    for (const character of Array.from(paragraph)) {
      const next = line + character;
      if (!line || context.measureText(next).width <= maxWidth) {
        line = next;
        continue;
      }
      lines.push(line);
      line = character;
      if (lines.length >= maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length >= maxLines) break;
  }
  if (lines.length === maxLines && lines.join("").length < source.replace(/\r?\n/gu, "").length) {
    while (lines[maxLines - 1] && context.measureText(`${lines[maxLines - 1]}…`).width > maxWidth) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1);
    }
    lines[maxLines - 1] += "…";
  }
  return lines;
}

function drawTextLines(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  maxLines = 2,
  lineHeight = 24,
) {
  splitText(context, value, maxWidth, maxLines).forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });
}

function isS2B(item: AuthoredQuotationPdfItem) {
  return item.contractType === "s2b" || /^S\s*2\s*B$/iu.test(item.procurementChannel.trim());
}

function contractLabel(item: AuthoredQuotationPdfItem) {
  if (item.note.trim().replace(/\s/g, "") === "공사비") return "공사비";
  if (!item.procurement) return "수의계약";
  return isS2B(item) ? "학교장터" : "조달 계약";
}

function outputNote(item: AuthoredQuotationPdfItem) {
  if (item.complimentary) return "무상 제공";
  if (item.equipmentKit) return AIRPASS_EQUIPMENT_CONTRACT_NOTE;
  return contractLabel(item);
}

function identifier(item: AuthoredQuotationPdfItem) {
  if (!item.procurement) return "-";
  return [item.procurementChannel || (isS2B(item) ? "S2B" : "G2B"), item.procurementNumber]
    .filter(Boolean)
    .join(" · ");
}

function amounts(quote: AuthoredQuotationPdfInput) {
  const subtotal = quote.items.reduce((sum, item) => sum + (item.complimentary ? 0 : item.quantity * item.unitPrice), 0);
  const procurementFee = quote.items.reduce((sum, item) => sum + (item.complimentary ? 0 : item.procurementFee), 0);
  const adjusted = Math.max(0, subtotal - quote.discountAmount + quote.extraAmount);
  const supply = Math.round(adjusted / 1.1);
  return { subtotal, procurementFee, supply, tax: adjusted - supply, total: adjusted + procurementFee };
}

function measuredItemRowHeight(
  context: CanvasRenderingContext2D,
  item: AuthoredQuotationPdfItem,
) {
  const measurements = [
    [formatQuotationItemNameForOutput(item.name), 188, 3, 15],
    [item.specification, 224, 4, 15],
    [identifier(item), 128, 3, 15],
    [outputNote(item), 65, 3, 15],
  ] as const;
  const lineCounts = measurements.map(([value, width, maxLines, fontSize]) => {
    context.font = `400 ${fontSize}px "Malgun Gothic", "Noto Sans KR", sans-serif`;
    return splitText(context, value, width, maxLines).length;
  });
  const lines = Math.max(1, ...lineCounts);
  return Math.min(132, Math.max(64, 22 + lines * 20));
}

function paginateItems(
  context: CanvasRenderingContext2D,
  items: AuthoredQuotationPdfItem[],
) {
  if (!items.length) return [{ items: [] as AuthoredQuotationPdfItem[], heights: [] as number[], startIndex: 0 }];
  const pages: Array<{ items: AuthoredQuotationPdfItem[]; heights: number[]; startIndex: number }> = [];
  let cursor = 0;
  while (cursor < items.length) {
    const isFirstPage = pages.length === 0;
    // 마지막 페이지는 조건표와 서명·회사명·도장 블록 전체가 들어갈
    // 공간을 먼저 확보합니다. 행 수가 아니라 실제 캔버스 측정 높이로 나눕니다.
    const finalCapacity = isFirstPage ? 600 : 930;
    const continuationCapacity = isFirstPage ? 1_045 : 1_380;
    const remaining = items.slice(cursor);
    const remainingHeights = remaining.map((item) => measuredItemRowHeight(context, item));
    const remainingHeight = remainingHeights.reduce((sum, height) => sum + height, 0);
    const isFinalPage = remainingHeight <= finalCapacity;
    const capacity = isFinalPage ? finalCapacity : continuationCapacity;
    const pageItems: AuthoredQuotationPdfItem[] = [];
    const pageHeights: number[] = [];
    let used = 0;
    for (let index = cursor; index < items.length; index += 1) {
      const height = measuredItemRowHeight(context, items[index]);
      // A continuation page must never consume the final row and accidentally
      // become the signature page without the reserved signature capacity.
      if (!isFinalPage && index === items.length - 1 && pageItems.length) break;
      if (pageItems.length && used + height > capacity) break;
      pageItems.push(items[index]);
      pageHeights.push(height);
      used += height;
    }
    pages.push({ items: pageItems, heights: pageHeights, startIndex: cursor });
    cursor += pageItems.length;
  }
  return pages;
}

async function loadImage(path: string) {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

function drawLogo(context: CanvasRenderingContext2D, logo: ImageBitmap | null, x: number, y: number, width: number) {
  if (!logo) {
    context.fillStyle = "#3154df";
    context.font = '900 28px "Malgun Gothic", sans-serif';
    context.fillText("WHIZZUP", x, y + 34);
    return;
  }
  const height = width * (logo.height / logo.width);
  context.drawImage(logo, x, y, width, height);
}

function drawCell(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { bold?: boolean; align?: CanvasTextAlign; maxLines?: number; fontSize?: number; fitSingleLine?: boolean; minFontSize?: number } = {},
) {
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.fillStyle = "#17233f";
  context.textAlign = options.align ?? "left";
  let fontSize = options.fontSize ?? 17;
  context.font = `${options.bold ? 700 : 400} ${fontSize}px "Malgun Gothic", "Noto Sans KR", sans-serif`;
  if (options.fitSingleLine) {
    const minFontSize = options.minFontSize ?? Math.min(12, fontSize);
    while (fontSize > minFontSize && context.measureText(value).width > Math.max(1, width - 18)) {
      fontSize -= 1;
      context.font = `${options.bold ? 700 : 400} ${fontSize}px "Malgun Gothic", "Noto Sans KR", sans-serif`;
    }
  }
  const textX = options.align === "right" ? x + width - 9 : options.align === "center" ? x + width / 2 : x + 9;
  const lines = options.fitSingleLine ? [value] : splitText(context, value, Math.max(1, width - 18), options.maxLines ?? 2);
  const lineHeight = fontSize + 5;
  const firstY = y + Math.max(fontSize + 7, (height - lines.length * lineHeight) / 2 + fontSize);
  lines.forEach((line, index) => context.fillText(line, textX, firstY + index * lineHeight));
  context.restore();
}

async function canvasJpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.98));
  if (!blob) throw new Error("견적서 PDF 화면을 만들지 못했습니다.");
  return blob;
}

async function renderPages(quote: AuthoredQuotationPdfInput) {
  const [logo, seal, airpassSeal] = await Promise.all([
    loadImage("/whizzup-logo.png"),
    quote.includeStamp ? loadImage("/whizzup-seal.png") : Promise.resolve(null),
    quote.items.some((item) => item.equipmentKit) ? loadImage("/airpass-seal.png") : Promise.resolve(null),
  ]);
  const measurementCanvas = document.createElement("canvas");
  const measurementContext = measurementCanvas.getContext("2d");
  if (!measurementContext) throw new Error("견적서 행 높이를 계산하지 못했습니다.");
  const itemPages = paginateItems(measurementContext, quote.items);
  measurementCanvas.width = 1;
  measurementCanvas.height = 1;
  const pageCount = itemPages.length;
  const total = amounts(quote);
  const pages: Array<{ blob: Blob; width: number; height: number }> = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = PAGE_WIDTH * PDF_RENDER_SCALE;
    canvas.height = PAGE_HEIGHT * PDF_RENDER_SCALE;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("견적서 PDF 화면을 준비하지 못했습니다.");
    context.scale(PDF_RENDER_SCALE, PDF_RENDER_SCALE);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    context.strokeStyle = "#3154df";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(72, 42);
    context.lineTo(1168, 42);
    context.stroke();
    drawLogo(context, logo, 78, 62, 125);
    context.fillStyle = "#17233f";
    context.textAlign = "center";
    context.font = '700 47px "Malgun Gothic", "Noto Sans KR", sans-serif';
    context.fillText(pageIndex === 0 ? "견  적  서" : "견적서 품목 계속", 620, 120);
    context.textAlign = "left";
    context.font = '400 16px "Malgun Gothic", "Noto Sans KR", sans-serif';
    context.fillStyle = "#52617d";
    context.fillText(`견적번호  ${quote.quoteNumber}`, 870, 82);
    context.fillText(`작성일  ${quote.quoteDate}`, 870, 110);
    context.fillText(`${pageIndex + 1} / ${pageCount}`, 1104, 138);

    let tableTop = 205;
    if (pageIndex === 0) {
      const partyTop = 176;
      context.fillStyle = "#17233f";
      context.fillRect(72, partyTop, 1096, 38);
      context.fillStyle = "#fff";
      context.font = '700 17px "Malgun Gothic", sans-serif';
      context.textAlign = "center";
      context.fillText("받는 분", 346, partyTop + 25);
      context.fillText("공급자", 894, partyTop + 25);
      context.textAlign = "left";
      const rows = [
        ["수신", quote.organization, "상호", "주식회사 위즈업"],
        ["담당자", "담당자 귀하", "사업자번호", "286-86-03454"],
        ["견적명", quote.projectTitle || "제품 공급", "대표자", "박원석"],
        ["유효기간", quote.validUntil ? `${quote.validUntil}까지` : "견적일로부터 30일", "주소", "경기도 하남시 하남대로 947, D동 1208호(풍산동)"],
        ["납품조건", "발주 후 일정 협의", "업태·종목", "도매 및 소매업 · 정보통신업 / 컴퓨터 및 주변장치 공급"],
      ];
      rows.forEach((row, index) => {
        const y = partyTop + 38 + index * 43;
        context.fillStyle = "#f1f4fa";
        context.fillRect(72, y, 102, 43);
        context.fillRect(620, y, 112, 43);
        drawCell(context, row[0], 72, y, 102, 43, { bold: true, align: "center", maxLines: 1, fontSize: 15 });
        drawCell(context, row[1], 174, y, 446, 43, { align: "center", maxLines: 2, fontSize: 15 });
        drawCell(context, row[2], 620, y, 112, 43, { bold: true, align: "center", maxLines: 1, fontSize: 15 });
        drawCell(context, row[3], 732, y, 436, 43, { align: "center", maxLines: 2, fontSize: 14 });
        context.strokeStyle = "#cfd8ea";
        context.strokeRect(72, y, 1096, 43);
      });
      const totalY = partyTop + 38 + rows.length * 43 + 20;
      context.fillStyle = "#eaf0ff";
      context.fillRect(72, totalY, 1096, 72);
      context.fillStyle = "#17233f";
      context.font = '700 18px "Malgun Gothic", sans-serif';
      context.fillText("견적금액 (VAT 포함 · 조달수수료 반영)", 92, totalY + 43);
      context.textAlign = "right";
      context.font = '800 34px "Malgun Gothic", sans-serif';
      context.fillStyle = "#2452d6";
      context.fillText(`${won.format(total.total)}원`, 1146, totalY + 47);
      context.textAlign = "left";
      tableTop = totalY + 90;
    }

    const columns = [72, 112, 318, 560, 706, 768, 828, 968, 1085, 1168];
    const headings = ["No", "품명", "규격", "식별번호", "수량", "단위", "단가", "금액", "비고"];
    context.fillStyle = "#eaf0ff";
    context.fillRect(columns[0], tableTop, columns.at(-1)! - columns[0], 48);
    headings.forEach((heading, index) => drawCell(context, heading, columns[index], tableTop, columns[index + 1] - columns[index], 48, { bold: true, align: "center", maxLines: 1, fontSize: 14 }));
    const pageItems = itemPages[pageIndex].items;
    const pageRowHeights = itemPages[pageIndex].heights;
    let rowsHeight = 0;
    pageItems.forEach((item, rowIndex) => {
      const rowHeight = pageRowHeights[rowIndex] ?? 64;
      const y = tableTop + 48 + rowsHeight;
      rowsHeight += rowHeight;
      const itemAmount = item.complimentary ? 0 : item.quantity * item.unitPrice;
      const values = [
        String(itemPages[pageIndex].startIndex + rowIndex + 1), formatQuotationItemNameForOutput(item.name), item.specification,
        identifier(item), String(item.quantity), item.unit, item.complimentary ? "무상" : `${won.format(item.unitPrice)}원`,
        item.complimentary ? "무상" : `${won.format(itemAmount)}원`, outputNote(item),
      ];
      values.forEach((value, index) => drawCell(context, value, columns[index], y, columns[index + 1] - columns[index], rowHeight, {
        align: [0, 4, 5].includes(index) ? "center" : [6, 7].includes(index) ? "right" : "left",
        maxLines: index === 2 ? 4 : 3,
        fontSize: index >= 6 ? 14 : 15,
      }));
      context.strokeStyle = "#cfd8ea";
      context.strokeRect(columns[0], y, columns.at(-1)! - columns[0], rowHeight);
      for (const x of columns.slice(1, -1)) {
        context.beginPath(); context.moveTo(x, y); context.lineTo(x, y + rowHeight); context.stroke();
      }
    });

    const isLastPage = pageIndex === pageCount - 1;
    if (isLastPage) {
      const bottomY = tableTop + 48 + rowsHeight + 22;
      const summary = [
        { label: "품목금액", qualifier: "VAT 포함", value: `${won.format(total.subtotal)}원` },
        { label: "조달수수료", qualifier: "별도", value: `${won.format(total.procurementFee)}원` },
        ...(quote.discountAmount > 0 ? [{ label: "할인", qualifier: "", value: `-${won.format(quote.discountAmount)}원` }] : []),
        ...(quote.extraAmount > 0 ? [{ label: "추가비용", qualifier: "", value: `+${won.format(quote.extraAmount)}원` }] : []),
        { label: "최종 합계", qualifier: "", value: `${won.format(total.total)}원`, total: true },
        { label: "공급가액", qualifier: "품목금액 기준", value: `${won.format(total.supply)}원` },
        { label: "부가가치세", qualifier: "품목금액 기준", value: `${won.format(total.tax)}원` },
      ];
      const summaryRowHeight = 36;
      const bottomHeight = 40 + Math.max(7 * 42, summary.length * summaryRowHeight);
      context.fillStyle = "#17233f";
      context.fillRect(72, bottomY, 1096, 40);
      context.fillStyle = "#fff";
      context.textAlign = "center";
      context.font = '700 17px "Malgun Gothic", sans-serif';
      context.fillText("견적 조건 및 특이사항", 360, bottomY + 27);
      context.fillText("금액 요약", 900, bottomY + 27);
      context.textAlign = "left";
      const conditions = [
        ["견적 유효기간", quote.validUntil ? `${quote.validUntil}까지` : "견적일로부터 30일"],
        ["납품 및 설치", "발주기관과 일정 협의 후 진행"],
        ["대금 지급", "발주기관의 지급 조건에 따름"],
        ["하자보증", "납품 완료일로부터 1년"],
        ["비고", "표시 단가는 VAT·일반 수수료 포함, 조달수수료는 합계에 별도 반영"],
        ["담당", "위즈업 영업팀"],
        ["안내", quote.memo || "본 견적서는 관공서 제출용입니다."],
      ];
      conditions.forEach((entry, index) => {
        const y = bottomY + 40 + index * 42;
        context.fillStyle = "#f1f4fa"; context.fillRect(72, y, 150, 42);
        drawCell(context, entry[0], 72, y, 150, 42, { bold: true, align: "center", maxLines: 1, fontSize: 14 });
        drawCell(context, entry[1], 222, y, 440, 42, { align: "center", maxLines: 2, fontSize: 14 });
      });
      summary.forEach((entry, index) => {
        const y = bottomY + 40 + index * summaryRowHeight;
        context.fillStyle = entry.total ? "#eaf0ff" : "#f1f4fa";
        context.fillRect(684, y, 250, summaryRowHeight);
        if (entry.total) context.fillRect(934, y, 234, summaryRowHeight);
        drawCell(context, entry.label, 684, y, 130, summaryRowHeight, { bold: true, align: "center", maxLines: 1, fontSize: entry.total ? 16 : 14 });
        drawCell(context, entry.qualifier, 814, y, 120, summaryRowHeight, { align: "center", maxLines: 1, fontSize: 12 });
        drawCell(context, entry.value, 934, y, 234, summaryRowHeight, {
          bold: Boolean(entry.total), align: "right", maxLines: 1, fontSize: entry.total ? 20 : 14, fitSingleLine: true, minFontSize: 12,
        });
      });
      const signatureY = bottomY + bottomHeight + 50;
      context.fillStyle = "#17233f";
      context.font = '500 17px "Malgun Gothic", sans-serif';
      context.fillText("위와 같이 견적합니다.", 190, signatureY);
      context.font = '700 17px "Malgun Gothic", sans-serif';
      context.fillText(quote.quoteDate.replace(/-(0?\d+)-(0?\d+)$/u, "년 $1월 $2일"), 215, signatureY + 35);
      context.fillText("주식회사 위즈업", 825, signatureY);
      context.fillText("대표이사   박 원 석", 825, signatureY + 35);
      if (seal) context.drawImage(seal, 1000, signatureY - 38, 112, 112);
    } else {
      context.fillStyle = "#66738d";
      context.font = '500 16px "Malgun Gothic", sans-serif';
      context.fillText("다음 페이지에 품목이 계속됩니다.", 72, 1690);
    }
    pages.push({
      blob: await canvasJpeg(canvas),
      width: PAGE_WIDTH * PDF_RENDER_SCALE,
      height: PAGE_HEIGHT * PDF_RENDER_SCALE,
    });
    canvas.width = 1;
    canvas.height = 1;
  }
  for (const parentItem of quote.items.filter((item) => item.equipmentKit)) {
    const detailLines = airpassEquipmentKitOutputLines(parentItem.equipmentKit);
    const detailItemsPerPage = 16;
    const detailPageCount = Math.max(1, Math.ceil(detailLines.length / detailItemsPerPage));
    for (let detailPageIndex = 0; detailPageIndex < detailPageCount; detailPageIndex += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = PAGE_WIDTH * PDF_RENDER_SCALE;
      canvas.height = PAGE_HEIGHT * PDF_RENDER_SCALE;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("교구 세부견적 PDF 화면을 준비하지 못했습니다.");
      context.scale(PDF_RENDER_SCALE, PDF_RENDER_SCALE);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      context.strokeStyle = "#3154df";
      context.lineWidth = 3;
      context.beginPath(); context.moveTo(72, 42); context.lineTo(1168, 42); context.stroke();
      context.fillStyle = "#17233f";
      context.textAlign = "center";
      context.font = '700 43px "Malgun Gothic", "Noto Sans KR", sans-serif';
      context.fillText("교 구 세 부 견 적 서", 500, 112);
      context.textAlign = "left";
      context.font = '400 16px "Malgun Gothic", "Noto Sans KR", sans-serif';
      context.fillStyle = "#52617d";
      context.fillText(`견적번호  ${quote.quoteNumber}`, 820, 82);
      context.fillText(`작성일  ${quote.quoteDate}`, 820, 110);
      context.fillText(`별첨 ${detailPageIndex + 1} / ${detailPageCount}`, 1030, 140);
      context.fillStyle = "#17233f";
      context.fillRect(72, 170, 1096, 38);
      context.fillStyle = "#fff";
      context.font = '700 17px "Malgun Gothic", sans-serif';
      context.textAlign = "center";
      context.fillText("받는 분", 346, 195);
      context.fillText("공급자", 894, 195);
      context.textAlign = "left";
      const partyRows = [
        ["수신", quote.organization, "상호", AIRPASS_COMPANY.name],
        ["견적명", quote.projectTitle || "제품 공급", "사업자번호", AIRPASS_COMPANY.businessNumber],
        ["계약구분", "수의계약", "대표자", AIRPASS_COMPANY.representative],
        ["납품조건", "발주 후 일정 협의", "", ""],
        ["유효기간", quote.validUntil ? `${quote.validUntil}까지` : "견적일로부터 30일", "", ""],
      ];
      partyRows.forEach((row, index) => {
        const y = 208 + index * 40;
        context.fillStyle = "#f1f4fa";
        context.fillRect(72, y, 102, 40);
        context.fillRect(620, y, 112, 40);
        drawCell(context, row[0], 72, y, 102, 40, { bold: true, align: "center", maxLines: 1, fontSize: 14 });
        drawCell(context, row[1], 174, y, 446, 40, { align: "center", maxLines: 2, fontSize: 14 });
        drawCell(context, row[2], 620, y, 112, 40, { bold: true, align: "center", maxLines: 1, fontSize: 14 });
        drawCell(context, row[3], 732, y, 436, 40, { align: "center", maxLines: 2, fontSize: 13 });
        context.strokeStyle = "#cfd8ea";
        context.strokeRect(72, y, 1096, 40);
      });
      const addressY = 408;
      context.fillStyle = "#f1f4fa";
      context.fillRect(72, addressY, 102, 48);
      drawCell(context, "주소", 72, addressY, 102, 48, { bold: true, align: "center", maxLines: 1, fontSize: 14 });
      drawCell(context, AIRPASS_COMPANY.address, 174, addressY, 994, 48, { align: "left", maxLines: 2, fontSize: 13 });
      context.strokeStyle = "#cfd8ea";
      context.strokeRect(72, addressY, 1096, 48);
      const businessY = addressY + 48;
      context.fillStyle = "#f1f4fa";
      context.fillRect(72, businessY, 102, 48);
      context.fillRect(520, businessY, 102, 48);
      drawCell(context, "업태", 72, businessY, 102, 48, { bold: true, align: "center", maxLines: 1, fontSize: 14 });
      drawCell(context, AIRPASS_COMPANY.businessType, 174, businessY, 346, 48, { align: "center", maxLines: 2, fontSize: 13 });
      drawCell(context, "종목", 520, businessY, 102, 48, { bold: true, align: "center", maxLines: 1, fontSize: 14 });
      drawCell(context, AIRPASS_COMPANY.businessItems, 622, businessY, 546, 48, { align: "left", maxLines: 2, fontSize: 13 });
      context.strokeStyle = "#cfd8ea";
      context.strokeRect(72, businessY, 1096, 48);
      context.beginPath(); context.moveTo(174, addressY); context.lineTo(174, businessY + 48); context.stroke();
      context.beginPath(); context.moveTo(520, businessY); context.lineTo(520, businessY + 48); context.stroke();
      context.beginPath(); context.moveTo(622, businessY); context.lineTo(622, businessY + 48); context.stroke();
      const amountY = 524;
      context.fillStyle = "#eaf0ff";
      context.fillRect(72, amountY, 1096, 60);
      drawCell(context, "견적금액 (VAT 포함)", 72, amountY, 350, 60, { bold: true, align: "center", maxLines: 1, fontSize: 17 });
      drawCell(context, parentItem.complimentary ? "무상 제공" : `${won.format(airpassEquipmentKitTotal(parentItem.equipmentKit))}원`, 422, amountY, 746, 60, { bold: true, align: "right", maxLines: 1, fontSize: 27 });

      const tableTop = 604;
      const columns = [72, 118, 560, 650, 730, 900, 1060, 1168];
      const headings = ["No", "품명", "수량", "단위", "단가", "금액", "비고"];
      context.fillStyle = "#eaf0ff";
      context.fillRect(72, tableTop, 1096, 46);
      headings.forEach((heading, index) => drawCell(context, heading, columns[index], tableTop, columns[index + 1] - columns[index], 46, { bold: true, align: "center", maxLines: 1, fontSize: 14 }));
      const pageLines = detailLines.slice(detailPageIndex * detailItemsPerPage, (detailPageIndex + 1) * detailItemsPerPage);
      const rowHeight = pageLines.length > 13 ? 48 : 54;
      pageLines.forEach((line, rowIndex) => {
        const y = tableTop + 46 + rowIndex * rowHeight;
        const values = [String(detailPageIndex * detailItemsPerPage + rowIndex + 1), line.name, String(line.quantity), line.unit, parentItem.complimentary ? "무상" : `${won.format(line.unitPrice)}원`, parentItem.complimentary ? "무상" : `${won.format(line.quantity * line.unitPrice)}원`, parentItem.complimentary ? "무상 제공" : ""];
        values.forEach((value, index) => drawCell(context, value, columns[index], y, columns[index + 1] - columns[index], rowHeight, {
          align: [0, 2, 3, 6].includes(index) ? "center" : [4, 5].includes(index) ? "right" : "left",
          maxLines: index === 1 ? 2 : 1,
          fontSize: index >= 4 ? 13 : 14,
        }));
        context.strokeStyle = "#cfd8ea";
        context.strokeRect(72, y, 1096, rowHeight);
        for (const x of columns.slice(1, -1)) { context.beginPath(); context.moveTo(x, y); context.lineTo(x, y + rowHeight); context.stroke(); }
      });
      if (detailPageIndex === detailPageCount - 1) {
        const totalY = tableTop + 46 + pageLines.length * rowHeight + 24;
        context.fillStyle = "#eaf0ff"; context.fillRect(72, totalY, 1096, 58);
        drawCell(context, "합계금액 (VAT 포함)", 72, totalY, 760, 58, { bold: true, align: "center", maxLines: 1, fontSize: 18 });
        drawCell(context, parentItem.complimentary ? "무상 제공" : `${won.format(airpassEquipmentKitTotal(parentItem.equipmentKit))}원`, 832, totalY, 336, 58, { bold: true, align: "right", maxLines: 1, fontSize: 23 });
        const signatureY = totalY + 105;
        context.fillStyle = "#17233f";
        context.font = '500 17px "Malgun Gothic", sans-serif';
        context.fillText("위와 같이 견적합니다.", 185, signatureY);
        context.font = '700 17px "Malgun Gothic", sans-serif';
        context.fillText(quote.quoteDate.replace(/-(0?\d+)-(0?\d+)$/u, "년 $1월 $2일"), 205, signatureY + 35);
        context.fillText(AIRPASS_COMPANY.name, 825, signatureY);
        context.fillText(`대표이사   ${AIRPASS_COMPANY.representative}`, 825, signatureY + 35);
        if (airpassSeal) context.drawImage(airpassSeal, 1000, signatureY - 38, 112, 112);
      }
      context.fillStyle = "#6c7890";
      context.font = '500 15px "Malgun Gothic", sans-serif';
      context.fillText(`${AIRPASS_COMPANY.name} · 본 세부견적은 본 견적서와 함께 제출됩니다.`, 72, 1690);
      pages.push({
        blob: await canvasJpeg(canvas),
        width: PAGE_WIDTH * PDF_RENDER_SCALE,
        height: PAGE_HEIGHT * PDF_RENDER_SCALE,
      });
      canvas.width = 1;
      canvas.height = 1;
    }
  }
  logo?.close();
  seal?.close();
  airpassSeal?.close();
  return pages;
}

type PdfCanvasPage = { blob: Blob; width: number; height: number };

function inspectionCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH * PDF_RENDER_SCALE;
  canvas.height = PAGE_HEIGHT * PDF_RENDER_SCALE;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("현장 검수서류 PDF 화면을 준비하지 못했습니다.");
  context.scale(PDF_RENDER_SCALE, PDF_RENDER_SCALE);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  return { canvas, context };
}

async function inspectionCanvasPage(canvas: HTMLCanvasElement): Promise<PdfCanvasPage> {
  const page = { blob: await canvasJpeg(canvas), width: canvas.width, height: canvas.height };
  canvas.width = 1;
  canvas.height = 1;
  return page;
}

function inspectionHeading(
  context: CanvasRenderingContext2D,
  title: string,
  subtitle: string,
  pageLabel: string,
) {
  context.fillStyle = "#17233f";
  context.textAlign = "center";
  context.font = '700 42px "Malgun Gothic", "Noto Sans KR", sans-serif';
  context.fillText(title, PAGE_WIDTH / 2, 96);
  context.fillStyle = "#78859b";
  context.font = '400 16px "Malgun Gothic", "Noto Sans KR", sans-serif';
  context.fillText(subtitle, PAGE_WIDTH / 2, 132);
  context.textAlign = "right";
  context.font = '500 14px "Malgun Gothic", "Noto Sans KR", sans-serif';
  context.fillText(pageLabel, 1168, 1690);
  context.textAlign = "left";
}

function inspectionSection(context: CanvasRenderingContext2D, title: string, y: number) {
  context.fillStyle = "#17233f";
  context.fillRect(72, y, 1096, 48);
  context.fillStyle = "#ffffff";
  context.font = '700 18px "Malgun Gothic", "Noto Sans KR", sans-serif';
  context.fillText(title, 96, y + 31);
}

function inspectionBox(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = "#ffffff",
) {
  context.fillStyle = fill;
  context.fillRect(x, y, width, height);
  context.strokeStyle = "#aebbd1";
  context.lineWidth = 1;
  context.strokeRect(x, y, width, height);
}

function inspectionField(
  context: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { labelWidth?: number; manual?: boolean; maxLines?: number; fontSize?: number } = {},
) {
  const labelWidth = options.labelWidth ?? 158;
  inspectionBox(context, x, y, labelWidth, height, "#edf2fb");
  inspectionBox(context, x + labelWidth, y, width - labelWidth, height, options.manual ? "#fffbeb" : "#ffffff");
  drawCell(context, label, x, y, labelWidth, height, { bold: true, align: "center", maxLines: 2, fontSize: 16 });
  drawCell(context, value, x + labelWidth, y, width - labelWidth, height, {
    align: options.manual ? "center" : "left",
    maxLines: options.maxLines ?? 2,
    fontSize: options.fontSize ?? 16,
  });
}

async function renderFieldInspectionSummaryPage(quote: AuthoredQuotation) {
  const { canvas, context } = inspectionCanvas();
  inspectionHeading(context, "현장 작동·수량 확인서", "제품 작동 상태와 납품·교구 수량을 현장에서 함께 확인합니다.", "검수서류");
  let y = 166;
  inspectionSection(context, "기본정보", y); y += 48;
  inspectionField(context, "기관명", quote.organization, 72, y, 1096, 64); y += 64;
  inspectionField(context, "방문일", "20____.____.____", 72, y, 548, 62, { manual: true });
  inspectionField(context, "견적번호", quote.quoteNumber, 620, y, 548, 62); y += 62;
  inspectionField(context, "사업명", quote.projectTitle || "제품 공급", 72, y, 1096, 68, { maxLines: 3 }); y += 68;
  const suppliers = fieldInspectionSupplierText(quote);
  context.font = '400 15px "Malgun Gothic", "Noto Sans KR", sans-serif';
  const supplierLines = splitText(context, suppliers, 920, 8);
  const supplierHeight = Math.max(68, 28 + supplierLines.length * 21);
  inspectionField(context, "제조·공급사", suppliers, 72, y, 1096, supplierHeight, { maxLines: 8, fontSize: 15 }); y += supplierHeight;
  inspectionField(context, "현장 지원사", FIELD_SUPPORT_COMPANY, 72, y, 548, 64);
  inspectionField(context, "위즈업 방문자", fieldInspectionVisitorName(quote), 620, y, 548, 64, { manual: true }); y += 76;

  inspectionSection(context, "확인결과", y); y += 48;
  const resultRows = [
    ["제품 기본 작동", "□ 정상", "□ 이상"],
    ["견적 제품 수량", "□ 일치", "□ 불일치"],
    ["교구 수량", "□ 일치", "□ 부족"],
  ];
  resultRows.forEach(([label, left, right]) => {
    inspectionBox(context, 72, y, 650, 62, "#ffffff");
    inspectionBox(context, 722, y, 223, 62, "#fffbeb");
    inspectionBox(context, 945, y, 223, 62, "#fffbeb");
    drawCell(context, label, 72, y, 650, 62, { bold: true, fontSize: 16 });
    drawCell(context, left, 722, y, 223, 62, { align: "center", fontSize: 16 });
    drawCell(context, right, 945, y, 223, 62, { align: "center", fontSize: 16 });
    y += 62;
  });
  y += 14;
  inspectionSection(context, "이상·누락 및 요청사항", y); y += 48;
  const memoHeight = Math.max(150, 1_265 - y);
  inspectionBox(context, 72, y, 1096, memoHeight, "#fffbeb");
  context.fillStyle = "#9aa4b4";
  context.font = '400 14px "Malgun Gothic", sans-serif';
  context.fillText("현장에서 확인한 이상, 누락 수량, 추가 요청사항을 작성해 주세요.", 96, y + 30);
  y += memoHeight + 16;
  inspectionSection(context, "확인자 서명", y); y += 48;
  inspectionBox(context, 72, y, 548, 44, "#edf2fb");
  inspectionBox(context, 620, y, 548, 44, "#edf2fb");
  drawCell(context, "기관 담당자", 72, y, 548, 44, { bold: true, align: "center", fontSize: 16 });
  drawCell(context, "위즈업 방문자", 620, y, 548, 44, { bold: true, align: "center", fontSize: 16 });
  y += 44;
  inspectionBox(context, 72, y, 548, 122, "#fffbeb");
  inspectionBox(context, 620, y, 548, 122, "#fffbeb");
  drawCell(context, "성명: ____________________\n\n서명: ____________________", 72, y, 548, 122, { align: "center", maxLines: 4, fontSize: 15 });
  drawCell(context, "성명: ____________________\n\n서명: ____________________", 620, y, 548, 122, { align: "center", maxLines: 4, fontSize: 15 });
  y += 138;
  inspectionBox(context, 72, y, 1096, 62, "#f4f7fc");
  drawCell(context, FIELD_INSPECTION_NOTICE, 86, y, 1068, 62, { align: "center", maxLines: 2, fontSize: 12 });
  return inspectionCanvasPage(canvas);
}

function inspectionRowHeight(
  context: CanvasRenderingContext2D,
  values: string[],
  widths: number[],
) {
  context.font = '400 15px "Malgun Gothic", "Noto Sans KR", sans-serif';
  const lines = values.map((value, index) => splitText(context, value, Math.max(20, widths[index] - 16), 4).length);
  return Math.max(64, 24 + Math.max(...lines) * 20);
}

function paginateInspectionRows<T>(rows: T[], heights: number[], capacity = 1_310) {
  const pages: Array<Array<{ row: T; height: number; index: number }>> = [];
  let current: Array<{ row: T; height: number; index: number }> = [];
  let used = 0;
  rows.forEach((row, index) => {
    const height = heights[index];
    if (current.length && used + height > capacity) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push({ row, height, index });
    used += height;
  });
  if (current.length || !pages.length) pages.push(current);
  return pages;
}

async function renderProductInspectionPages(quote: AuthoredQuotation) {
  const lines = fieldInspectionProductLines(quote);
  const measurement = document.createElement("canvas").getContext("2d");
  if (!measurement) throw new Error("제품 확인 목록의 행 높이를 계산하지 못했습니다.");
  const widths = [48, 188, 228, 76, 70, 86, 160, 178, 62];
  const heights = lines.map((line) => inspectionRowHeight(measurement, ["", line.name, line.specification, "", line.unit, "", "", "", ""], widths));
  const chunks = paginateInspectionRows(lines, heights);
  const pages: PdfCanvasPage[] = [];
  for (let pageIndex = 0; pageIndex < chunks.length; pageIndex += 1) {
    const { canvas, context } = inspectionCanvas();
    inspectionHeading(context, "견적 제품 현장 확인 목록", `${quote.organization} · ${quote.quoteNumber}`, `제품 확인 ${pageIndex + 1} / ${chunks.length}`);
    const columns = [72];
    widths.forEach((width) => columns.push(columns[columns.length - 1] + width));
    const top = 174;
    const headings = ["No", "품명", "규격", "견적", "단위", "현장", "작동 확인", "수량 확인", "비고"];
    context.fillStyle = "#17233f";
    context.fillRect(72, top, 1096, 56);
    headings.forEach((heading, index) => {
      context.fillStyle = "#ffffff";
      context.font = '700 14px "Malgun Gothic", sans-serif';
      context.textAlign = "center";
      context.fillText(heading, columns[index] + widths[index] / 2, top + 35);
    });
    let y = top + 56;
    chunks[pageIndex].forEach(({ row, height, index }) => {
      const values = [String(index + 1), row.name, row.specification, won.format(row.quantity), row.unit, "", "□ 정상  □ 이상", "□ 일치  □ 불일치", ""];
      values.forEach((value, columnIndex) => {
        inspectionBox(context, columns[columnIndex], y, widths[columnIndex], height, [5, 6, 7, 8].includes(columnIndex) ? "#fffbeb" : "#ffffff");
        drawCell(context, value, columns[columnIndex], y, widths[columnIndex], height, {
          align: [0, 3, 4, 5, 6, 7].includes(columnIndex) ? "center" : "left",
          maxLines: columnIndex === 1 || columnIndex === 2 ? 4 : 2,
          fontSize: columnIndex >= 6 ? 13 : 15,
        });
      });
      y += height;
    });
    context.fillStyle = "#78859b";
    context.font = '400 13px "Malgun Gothic", sans-serif';
    context.textAlign = "left";
    context.fillText("※ 최종 저장된 견적의 품목·수량이 자동 입력되며 금액·원가·마진은 표시하지 않습니다.", 72, Math.min(1645, y + 32));
    pages.push(await inspectionCanvasPage(canvas));
  }
  return pages;
}

async function renderEquipmentInspectionPages(quote: AuthoredQuotation) {
  const lines = fieldInspectionEquipmentLines(quote);
  if (!lines.length) return [];
  const measurement = document.createElement("canvas").getContext("2d");
  if (!measurement) throw new Error("교구 확인 목록의 행 높이를 계산하지 못했습니다.");
  const widths = [48, 310, 82, 86, 92, 200, 278];
  const heights = lines.map((line) => inspectionRowHeight(measurement, ["", line.name, line.unit, "", "", "", ""], widths));
  const chunks = paginateInspectionRows(lines, heights);
  const pages: PdfCanvasPage[] = [];
  for (let pageIndex = 0; pageIndex < chunks.length; pageIndex += 1) {
    const { canvas, context } = inspectionCanvas();
    inspectionHeading(context, "교구 현장 수량 확인 목록", `${quote.organization} · ${quote.quoteNumber}`, `교구 확인 ${pageIndex + 1} / ${chunks.length}`);
    const columns = [72];
    widths.forEach((width) => columns.push(columns[columns.length - 1] + width));
    const top = 174;
    const headings = ["No", "교구명", "단위", "견적", "현장", "확인 결과", "비고"];
    context.fillStyle = "#17233f";
    context.fillRect(72, top, 1096, 56);
    headings.forEach((heading, index) => {
      context.fillStyle = "#ffffff";
      context.font = '700 14px "Malgun Gothic", sans-serif';
      context.textAlign = "center";
      context.fillText(heading, columns[index] + widths[index] / 2, top + 35);
    });
    let y = top + 56;
    chunks[pageIndex].forEach(({ row, height, index }) => {
      const values = [String(index + 1), row.name, row.unit, won.format(row.quantity), "", "□ 일치  □ 부족", ""];
      values.forEach((value, columnIndex) => {
        inspectionBox(context, columns[columnIndex], y, widths[columnIndex], height, [4, 5, 6].includes(columnIndex) ? "#fffbeb" : "#ffffff");
        drawCell(context, value, columns[columnIndex], y, widths[columnIndex], height, {
          align: [0, 2, 3, 4, 5].includes(columnIndex) ? "center" : "left",
          maxLines: columnIndex === 1 ? 4 : 2,
          fontSize: columnIndex === 5 ? 13 : 15,
        });
      });
      y += height;
    });
    context.fillStyle = "#78859b";
    context.font = '400 13px "Malgun Gothic", sans-serif';
    context.textAlign = "left";
    context.fillText("※ 교구 세부견적의 교구명·단위·견적수량이 자동 입력됩니다.", 72, Math.min(1645, y + 32));
    pages.push(await inspectionCanvasPage(canvas));
  }
  return pages;
}

async function renderFieldInspectionPages(quote: AuthoredQuotation) {
  const [summary, products, equipment] = await Promise.all([
    renderFieldInspectionSummaryPage(quote),
    renderProductInspectionPages(quote),
    renderEquipmentInspectionPages(quote),
  ]);
  return [summary, ...products, ...equipment];
}

async function jpegPagesToPdf(pages: Array<{ blob: Blob; width: number; height: number }>) {
  const encoder = new TextEncoder();
  const objects: Uint8Array[] = [];
  const pageObjectIds: number[] = [];
  const imageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  let nextId = 3;
  pages.forEach(() => {
    pageObjectIds.push(nextId++);
    imageObjectIds.push(nextId++);
    contentObjectIds.push(nextId++);
  });
  objects[1] = encoder.encode("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = encoder.encode(`<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  for (let index = 0; index < pages.length; index += 1) {
    const imageBytes = new Uint8Array(await pages[index].blob.arrayBuffer());
    const content = encoder.encode(`q ${PDF_WIDTH} 0 0 ${PDF_HEIGHT} 0 0 cm /Im${index + 1} Do Q`);
    objects[pageObjectIds[index]] = encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /XObject << /Im${index + 1} ${imageObjectIds[index]} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`);
    objects[imageObjectIds[index]] = concatBytes([
      encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${pages[index].width} /Height ${pages[index].height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`),
      imageBytes,
      encoder.encode("\nendstream"),
    ]);
    objects[contentObjectIds[index]] = concatBytes([
      encoder.encode(`<< /Length ${content.length} >>\nstream\n`), content, encoder.encode("\nendstream"),
    ]);
  }
  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets = [0];
  let offset = chunks[0].length;
  for (let id = 1; id < objects.length; id += 1) {
    const object = concatBytes([encoder.encode(`${id} 0 obj\n`), objects[id], encoder.encode("\nendobj\n")]);
    offsets[id] = offset;
    chunks.push(object);
    offset += object.length;
  }
  const xrefOffset = offset;
  chunks.push(encoder.encode([
    `xref\n0 ${objects.length}\n`, "0000000000 65535 f \n",
    ...offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  ].join("")));
  return new Blob([concatBytes(chunks)], { type: "application/pdf" });
}

export async function createAuthoredQuotationPdf(quote: AuthoredQuotationPdfInput) {
  const blob = await jpegPagesToPdf(await renderPages(quote));
  return new File([blob], quotationDownloadName(quote, "pdf"), { type: "application/pdf" });
}

export async function createFieldInspectionPdf(quote: AuthoredQuotation, region = "") {
  const [quotationPages, inspectionPages] = await Promise.all([
    renderPages(quote),
    renderFieldInspectionPages(quote),
  ]);
  const blob = await jpegPagesToPdf([...quotationPages, ...inspectionPages]);
  return new File([blob], fieldInspectionDownloadName({ ...quote, region }, "pdf"), { type: "application/pdf" });
}
