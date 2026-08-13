import type { ConsortiumSettlementWorkbookInput } from "../lib/consortium-settlement-xlsx";
import { formatQuotationItemNameForOutput } from "../lib/quotation-output-text";

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const RENDER_SCALE = 2;
const PDF_WIDTH = 595.28;
const PDF_HEIGHT = 841.89;
const won = new Intl.NumberFormat("ko-KR");

type PdfRow = {
  kind: "section" | "header" | "item" | "cost" | "adjustment" | "summary";
  values: string[];
  amount?: number;
  tone?: "addition" | "deduction";
};

function concatBytes(chunks: Uint8Array[]) {
  const size = chunks.reduce((sum, item) => sum + item.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, "_") || "미지정";
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function fitText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  const text = String(value ?? "");
  if (context.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}

function cell(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  value: string,
  options: { fill?: string; color?: string; align?: CanvasTextAlign; bold?: boolean; size?: number } = {},
) {
  context.fillStyle = options.fill ?? "#ffffff";
  context.fillRect(x, y, width, height);
  context.strokeStyle = "#cbd6e7";
  context.lineWidth = 1;
  context.strokeRect(x, y, width, height);
  context.fillStyle = options.color ?? "#263751";
  context.font = `${options.bold ? 800 : 500} ${options.size ?? 15}px "Malgun Gothic", sans-serif`;
  context.textAlign = options.align ?? "left";
  context.textBaseline = "middle";
  const padding = 10;
  const tx = options.align === "right" ? x + width - padding : options.align === "center" ? x + width / 2 : x + padding;
  const lines = String(value ?? "").split(/\r?\n/u).slice(0, 2);
  const lineHeight = (options.size ?? 15) + 4;
  const firstY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => context.fillText(fitText(context, line, width - padding * 2), tx, firstY + index * lineHeight));
}

function sectionRow(context: CanvasRenderingContext2D, y: number, title: string) {
  cell(context, 72, y, 1096, 38, title, { fill: "#182842", color: "#ffffff", bold: true, size: 16 });
  return y + 38;
}

function buildRows(input: ConsortiumSettlementWorkbookInput): PdfRow[] {
  const rows: PdfRow[] = [
    { kind: "section", values: ["품목별 기본 정산"] },
    { kind: "header", values: ["No", "품목", "계약 구분", "정산 기준금액", "지급률", "기본 정산액"] },
    ...input.items.map((item, index) => ({
      kind: "item" as const,
      values: [String(index + 1), formatQuotationItemNameForOutput(item.name), item.contractLabel, `${won.format(item.lineAmount)}원`, `${(item.consortiumRate * 100).toFixed(1)}%`, `${won.format(item.grossPayment)}원`],
    })),
    { kind: "section", values: ["별도 비용 처리 내역"] },
    { kind: "header", values: ["No", "비용 항목", "수량", "단가", "합계", "비용 처리 방식"] },
    ...(input.costs.length ? input.costs.map((cost, index) => ({
      kind: "cost" as const,
      values: [String(index + 1), cost.label, String(Math.max(1, Math.round(cost.quantity ?? 1))), `${won.format(cost.unitAmount ?? cost.amount)}원`, `${won.format(cost.amount)}원`, cost.bearer === "consortium" ? "정산서 반영" : "위즈업 별도 처리"],
    })) : [{ kind: "cost" as const, values: ["", "별도 비용 없음", "-", "-", "-", "-"] }]),
  ];
  if (input.adjustments?.length) {
    rows.push(
      { kind: "section", values: ["정산 조정 내역"] },
      { kind: "header", values: ["No", "구분", "항목", "사유·비고", "", "금액"] },
      ...input.adjustments.map((adjustment, index) => ({
        kind: "adjustment" as const,
        values: [String(index + 1), adjustment.type === "addition" ? "추가 지급" : "정산 차감", adjustment.label, adjustment.note ?? "", "", `${won.format(adjustment.amount)}원`],
        tone: adjustment.type,
      })),
    );
  }
  return rows;
}

function drawHeader(
  context: CanvasRenderingContext2D,
  input: ConsortiumSettlementWorkbookInput,
  logo: HTMLImageElement | null,
  page: number,
  pages: number,
) {
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.strokeStyle = "#3157e6";
  context.lineWidth = 3;
  context.beginPath(); context.moveTo(72, 44); context.lineTo(1168, 44); context.stroke();
  if (logo && page === 1) context.drawImage(logo, 78, 62, 118, 67);
  context.fillStyle = "#182842";
  context.font = '800 34px "Malgun Gothic", sans-serif';
  context.textAlign = "center";
  context.fillText("정  산  서", PAGE_WIDTH / 2, 105);
  context.font = '600 13px "Malgun Gothic", sans-serif';
  context.fillStyle = "#73809a";
  context.textAlign = "right";
  context.fillText(`${page} / ${pages}`, 1168, 102);
  if (page > 1) return 145;

  const y = 154;
  const labels = [
    ["기관", input.organization, "컨소 업체", input.consortiumCompany || "미입력"],
    ["사업·견적명", input.projectTitle || `${input.businessRound}차 사업`, "견적번호", input.quoteNumber || "저장 전"],
    ["사업 차수", `${input.businessRound}차`, "작성일", input.quoteDate],
  ];
  labels.forEach((row, index) => {
    const top = y + index * 38;
    cell(context, 72, top, 130, 38, row[0], { fill: "#f4f7fc", color: "#52617d", align: "center", bold: true, size: 13 });
    cell(context, 202, top, 420, 38, row[1], { size: 14 });
    cell(context, 622, top, 130, 38, row[2], { fill: "#f4f7fc", color: "#52617d", align: "center", bold: true, size: 13 });
    cell(context, 752, top, 416, 38, row[3], { size: 14 });
  });
  return y + labels.length * 38 + 24;
}

function drawRows(context: CanvasRenderingContext2D, rows: PdfRow[], startY: number) {
  let y = startY;
  const widths = [58, 320, 165, 205, 145, 203];
  for (const row of rows) {
    if (row.kind === "section") { y = sectionRow(context, y + 8, row.values[0]); continue; }
    const height = row.kind === "header" ? 36 : row.kind === "item" && row.values[1].includes("\n") ? 52 : 39;
    let x = 72;
    row.values.forEach((value, index) => {
      const header = row.kind === "header";
      const amountColumn = index >= 3 || index === 5;
      cell(context, x, y, widths[index], height, value, {
        fill: header ? "#eaf1ff" : row.tone === "deduction" && index === 5 ? "#fff5e8" : "#ffffff",
        color: header ? "#435579" : row.tone === "deduction" && index === 5 ? "#c24b3f" : "#263751",
        bold: header || index === 5,
        align: header || index === 0 || index === 2 ? "center" : amountColumn ? "right" : "left",
        size: header ? 13 : 14,
      });
      x += widths[index];
    });
    y += height;
  }
  return y;
}

function drawSummary(
  context: CanvasRenderingContext2D,
  input: ConsortiumSettlementWorkbookInput,
  y: number,
  seal: HTMLImageElement | null,
) {
  const gross = input.items.reduce((sum, item) => sum + item.grossPayment, 0);
  const cost = input.costs.reduce((sum, item) => sum + item.consortiumDeduction, 0);
  const additions = (input.adjustments ?? []).reduce((sum, item) => sum + (item.type === "addition" ? item.amount : 0), 0);
  const deductions = (input.adjustments ?? []).reduce((sum, item) => sum + (item.type === "deduction" ? item.amount : 0), 0);
  const finalPayment = Math.max(0, gross - cost - deductions + additions);
  const supply = Math.round(finalPayment / 1.1);
  const vat = finalPayment - supply;
  y = sectionRow(context, y + 14, "금액 요약");
  const summary = [
    ["기본 정산액", gross],
    ["정산 반영 비용", -cost],
    ["정산 조정", additions - deductions],
    ["공급가액", supply],
    ["부가가치세", vat],
  ] as const;
  summary.forEach(([label, value]) => {
    cell(context, 72, y, 725, 34, label, { fill: "#f4f7fc", color: "#52617d", bold: true, size: 13 });
    cell(context, 797, y, 371, 34, `${value < 0 ? "-" : ""}${won.format(Math.abs(value))}원`, { align: "right", color: value < 0 ? "#c24b3f" : "#263751", bold: true, size: 14 });
    y += 34;
  });
  cell(context, 72, y, 725, 48, "최종 지급 예정액 (VAT 포함)", { fill: "#eaf1ff", color: "#182842", bold: true, size: 18 });
  cell(context, 797, y, 371, 48, `${won.format(finalPayment)}원`, { fill: "#eaf1ff", color: "#2254d1", align: "right", bold: true, size: 24 });
  y += 74;
  context.fillStyle = "#182842";
  context.font = '700 16px "Malgun Gothic", sans-serif';
  context.textAlign = "left";
  context.fillText("위와 같이 정산합니다.", 110, y + 20);
  context.font = '600 14px "Malgun Gothic", sans-serif';
  context.fillText(input.quoteDate, 145, y + 58);
  context.textAlign = "center";
  context.font = '800 17px "Malgun Gothic", sans-serif';
  context.fillText("주식회사 위즈업", 880, y + 18);
  context.fillText("대표이사  박 원 석", 880, y + 48);
  if (seal) context.drawImage(seal, 1025, y - 8, 82, 82);
}

async function canvasJpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
  if (!blob) throw new Error("정산서 PDF 화면을 만들지 못했습니다.");
  return blob;
}

async function jpegPagesToPdf(pages: Array<{ blob: Blob; width: number; height: number }>) {
  const encoder = new TextEncoder();
  const objects: Uint8Array[] = [new Uint8Array()];
  const pageObjectIds: number[] = [];
  const imageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    pageObjectIds.push(3 + index * 3);
    imageObjectIds.push(4 + index * 3);
    contentObjectIds.push(5 + index * 3);
  }
  const maxId = 2 + pages.length * 3;
  for (let id = 1; id <= maxId; id += 1) objects[id] = new Uint8Array();
  objects[1] = encoder.encode("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = encoder.encode(`<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  for (let index = 0; index < pages.length; index += 1) {
    const imageBytes = new Uint8Array(await pages[index].blob.arrayBuffer());
    const content = encoder.encode(`q ${PDF_WIDTH} 0 0 ${PDF_HEIGHT} 0 0 cm /Im${index + 1} Do Q`);
    objects[pageObjectIds[index]] = encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /XObject << /Im${index + 1} ${imageObjectIds[index]} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`);
    objects[imageObjectIds[index]] = concatBytes([encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${pages[index].width} /Height ${pages[index].height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`), imageBytes, encoder.encode("\nendstream")]);
    objects[contentObjectIds[index]] = concatBytes([encoder.encode(`<< /Length ${content.length} >>\nstream\n`), content, encoder.encode("\nendstream")]);
  }
  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n")];
  const offsets = [0];
  let offset = chunks[0].length;
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = offset;
    const chunk = concatBytes([encoder.encode(`${id} 0 obj\n`), objects[id], encoder.encode("\nendobj\n")]);
    chunks.push(chunk); offset += chunk.length;
  }
  const xrefOffset = offset;
  chunks.push(encoder.encode([`xref\n0 ${objects.length}\n`, "0000000000 65535 f \n", ...offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n \n`), `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`].join("")));
  return new Blob([concatBytes(chunks)], { type: "application/pdf" });
}

export async function createConsortiumSettlementPdf(input: ConsortiumSettlementWorkbookInput) {
  const [logo, seal] = await Promise.all([
    loadImage("/whizzup-logo.png"),
    input.includeStamp ? loadImage("/whizzup-seal.png") : Promise.resolve(null),
  ]);
  const rows = buildRows(input);
  const chunks: PdfRow[][] = [];
  for (let index = 0; index < rows.length; index += 22) chunks.push(rows.slice(index, index + 22));
  if (!chunks.length) chunks.push([]);
  const pages: Array<{ blob: Blob; width: number; height: number }> = [];
  for (let pageIndex = 0; pageIndex < chunks.length; pageIndex += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = PAGE_WIDTH * RENDER_SCALE;
    canvas.height = PAGE_HEIGHT * RENDER_SCALE;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("정산서 PDF 화면을 준비하지 못했습니다.");
    context.scale(RENDER_SCALE, RENDER_SCALE);
    const startY = drawHeader(context, input, logo, pageIndex + 1, chunks.length);
    const endY = drawRows(context, chunks[pageIndex], startY);
    if (pageIndex === chunks.length - 1) drawSummary(context, input, endY, seal);
    pages.push({ blob: await canvasJpeg(canvas), width: canvas.width, height: canvas.height });
    canvas.width = 1; canvas.height = 1;
  }
  const blob = await jpegPagesToPdf(pages);
  return new File([blob], `${safeFileName(input.organization)}_${input.quoteNumber || "견적"}_정산서.pdf`, { type: "application/pdf" });
}
