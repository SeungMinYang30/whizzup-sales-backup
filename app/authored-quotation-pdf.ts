import type { AuthoredQuotation, AuthoredQuotationItem } from "../lib/authored-quotations";
import { airpassEquipmentKitOutputLines, airpassEquipmentKitTotal } from "../lib/airpass-equipment-kit";
import { quotationFileStem } from "../lib/quotation-file-name";
import { AIRPASS_COMPANY, AIRPASS_EQUIPMENT_CONTRACT_NOTE } from "../lib/airpass-company";
import { formatQuotationItemNameForOutput } from "../lib/quotation-output-text";

export { quotationFileStem } from "../lib/quotation-file-name";

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const PDF_RENDER_SCALE = 2;
const PDF_WIDTH = 595.28;
const PDF_HEIGHT = 841.89;
const ITEMS_PER_PAGE = 6;

type AuthoredQuotationPdfItem = Pick<
  AuthoredQuotationItem,
  "name" | "specification" | "quantity" | "unit" | "unitPrice" | "note" | "contractType" | "procurement" | "procurementChannel" | "procurementNumber" | "procurementFee" | "equipmentKit"
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
  const subtotal = quote.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const procurementFee = quote.items.reduce((sum, item) => sum + item.procurementFee, 0);
  const adjusted = Math.max(0, subtotal - quote.discountAmount + quote.extraAmount);
  const supply = Math.round(adjusted / 1.1);
  return { subtotal, procurementFee, supply, tax: adjusted - supply, total: adjusted + procurementFee };
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
  options: { bold?: boolean; align?: CanvasTextAlign; maxLines?: number; fontSize?: number } = {},
) {
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.fillStyle = "#17233f";
  context.textAlign = options.align ?? "left";
  const fontSize = options.fontSize ?? 17;
  context.font = `${options.bold ? 700 : 400} ${fontSize}px "Malgun Gothic", "Noto Sans KR", sans-serif`;
  const textX = options.align === "right" ? x + width - 9 : options.align === "center" ? x + width / 2 : x + 9;
  const lines = splitText(context, value, Math.max(1, width - 18), options.maxLines ?? 2);
  const lineHeight = fontSize + 5;
  const firstY = y + Math.max(fontSize + 7, (height - lines.length * lineHeight) / 2 + fontSize);
  lines.forEach((line, index) => context.fillText(line, textX, firstY + index * lineHeight));
  context.restore();
}

async function canvasJpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
  if (!blob) throw new Error("견적서 PDF 화면을 만들지 못했습니다.");
  return blob;
}

async function renderPages(quote: AuthoredQuotationPdfInput) {
  const [logo, seal, airpassSeal] = await Promise.all([
    loadImage("/whizzup-logo.png"),
    quote.includeStamp ? loadImage("/whizzup-seal.png") : Promise.resolve(null),
    quote.items.some((item) => item.equipmentKit) ? loadImage("/airpass-seal.png") : Promise.resolve(null),
  ]);
  const pageCount = Math.max(1, Math.ceil(quote.items.length / ITEMS_PER_PAGE));
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
    const rowHeight = pageIndex === 0 ? 94 : 126;
    const pageItems = quote.items.slice(pageIndex * ITEMS_PER_PAGE, (pageIndex + 1) * ITEMS_PER_PAGE);
    pageItems.forEach((item, rowIndex) => {
      const y = tableTop + 48 + rowIndex * rowHeight;
      const values = [
        String(pageIndex * ITEMS_PER_PAGE + rowIndex + 1), formatQuotationItemNameForOutput(item.name), item.specification,
        identifier(item), String(item.quantity), item.unit, `${won.format(item.unitPrice)}원`,
        `${won.format(item.quantity * item.unitPrice)}원`, outputNote(item),
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
      const bottomY = tableTop + 48 + pageItems.length * rowHeight + 22;
      const bottomHeight = 250;
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
        ["안내", quote.memo || "본 견적서는 관공서 제출용입니다."],
      ];
      conditions.forEach((entry, index) => {
        const y = bottomY + 40 + index * 42;
        context.fillStyle = "#f1f4fa"; context.fillRect(72, y, 150, 42);
        drawCell(context, entry[0], 72, y, 150, 42, { bold: true, align: "center", maxLines: 1, fontSize: 14 });
        drawCell(context, entry[1], 222, y, 440, 42, { align: "center", maxLines: 2, fontSize: 14 });
      });
      const summary = [
        ["품목 합계", `${won.format(total.subtotal)}원`],
        ["조달수수료", `${won.format(total.procurementFee)}원`],
        ["할인 / 추가", `${quote.discountAmount ? `-${won.format(quote.discountAmount)}` : "-"} / ${quote.extraAmount ? `+${won.format(quote.extraAmount)}` : "-"}`],
        ["공급가액", `${won.format(total.supply)}원`],
        ["부가가치세", `${won.format(total.tax)}원`],
      ];
      summary.forEach((entry, index) => {
        const y = bottomY + 40 + index * 35;
        context.fillStyle = "#f1f4fa"; context.fillRect(684, y, 176, 35);
        drawCell(context, entry[0], 684, y, 176, 35, { bold: true, align: "center", maxLines: 1, fontSize: 14 });
        drawCell(context, entry[1], 860, y, 308, 35, { align: "right", maxLines: 1, fontSize: 14 });
      });
      context.fillStyle = "#eaf0ff"; context.fillRect(684, bottomY + 215, 484, 45);
      drawCell(context, "최종 합계", 684, bottomY + 215, 176, 45, { bold: true, align: "center", maxLines: 1, fontSize: 17 });
      drawCell(context, `${won.format(total.total)}원`, 860, bottomY + 215, 308, 45, { bold: true, align: "right", maxLines: 1, fontSize: 22 });
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
    const detailItemsPerPage = 10;
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
        ["납품조건", "발주 후 일정 협의", "주소", AIRPASS_COMPANY.address],
        ["유효기간", quote.validUntil ? `${quote.validUntil}까지` : "견적일로부터 30일", "업태·종목", `${AIRPASS_COMPANY.businessType} / ${AIRPASS_COMPANY.businessItems}`],
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
      const amountY = 420;
      context.fillStyle = "#eaf0ff";
      context.fillRect(72, amountY, 1096, 60);
      drawCell(context, "견적금액 (VAT 포함)", 72, amountY, 350, 60, { bold: true, align: "center", maxLines: 1, fontSize: 17 });
      drawCell(context, `${won.format(airpassEquipmentKitTotal(parentItem.equipmentKit))}원`, 422, amountY, 746, 60, { bold: true, align: "right", maxLines: 1, fontSize: 27 });

      const tableTop = 500;
      const columns = [72, 118, 560, 650, 730, 900, 1060, 1168];
      const headings = ["No", "품명", "수량", "단위", "단가", "금액", "비고"];
      context.fillStyle = "#eaf0ff";
      context.fillRect(72, tableTop, 1096, 46);
      headings.forEach((heading, index) => drawCell(context, heading, columns[index], tableTop, columns[index + 1] - columns[index], 46, { bold: true, align: "center", maxLines: 1, fontSize: 14 }));
      const pageLines = detailLines.slice(detailPageIndex * detailItemsPerPage, (detailPageIndex + 1) * detailItemsPerPage);
      const rowHeight = 68;
      pageLines.forEach((line, rowIndex) => {
        const y = tableTop + 46 + rowIndex * rowHeight;
        const values = [String(detailPageIndex * detailItemsPerPage + rowIndex + 1), line.name, String(line.quantity), line.unit, `${won.format(line.unitPrice)}원`, `${won.format(line.quantity * line.unitPrice)}원`, ""];
        values.forEach((value, index) => drawCell(context, value, columns[index], y, columns[index + 1] - columns[index], rowHeight, {
          align: [0, 2, 3, 6].includes(index) ? "center" : [4, 5].includes(index) ? "right" : "left",
          maxLines: index === 1 ? 3 : 1,
          fontSize: index >= 4 ? 14 : 15,
        }));
        context.strokeStyle = "#cfd8ea";
        context.strokeRect(72, y, 1096, rowHeight);
        for (const x of columns.slice(1, -1)) { context.beginPath(); context.moveTo(x, y); context.lineTo(x, y + rowHeight); context.stroke(); }
      });
      if (detailPageIndex === detailPageCount - 1) {
        const totalY = tableTop + 46 + pageLines.length * rowHeight + 24;
        context.fillStyle = "#eaf0ff"; context.fillRect(72, totalY, 1096, 58);
        drawCell(context, "합계금액 (VAT 포함)", 72, totalY, 760, 58, { bold: true, align: "center", maxLines: 1, fontSize: 18 });
        drawCell(context, `${won.format(airpassEquipmentKitTotal(parentItem.equipmentKit))}원`, 832, totalY, 336, 58, { bold: true, align: "right", maxLines: 1, fontSize: 23 });
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
  return new File([blob], `${quotationFileStem(quote)}.pdf`, { type: "application/pdf" });
}
