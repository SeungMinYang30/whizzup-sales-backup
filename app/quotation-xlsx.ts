import { strFromU8, unzipSync } from "fflate";
import {
  hasProcurementSignal,
  procurementNumbersFromText,
} from "../lib/procurement-product";

export type ParsedQuotationXlsxItem = {
  id: string;
  productName: string;
  specification: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  procurementNumber: string;
  isProcurement: boolean;
  confidence: string;
  reviewNote: string;
};

export type ParsedQuotationXlsx = {
  sourceName: string;
  quoteDate: string;
  quoteAmount: number;
  items: ParsedQuotationXlsxItem[];
  pdf: File;
  pages: File[];
};

type SheetCell = {
  value: string;
  formula: string;
};

function columnNumber(reference: string) {
  const letters = reference.match(/[A-Z]+/)?.[0] ?? "A";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value: unknown) {
  const source = String(value ?? "").replace(/[,원%\s]/g, "");
  const parsed = Number(source);
  return Number.isFinite(parsed) ? parsed : 0;
}

function excelDate(value: string) {
  const serial = Number(value);
  if (Number.isFinite(serial) && serial >= 20_000 && serial <= 80_000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }
  const matched = value.match(/(20\d{2})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})/);
  return matched
    ? `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}`
    : "";
}

function parseFirstWorksheet(buffer: ArrayBuffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const sheetPath =
    Object.keys(files).find((path) => path === "xl/worksheets/sheet1.xml") ??
    Object.keys(files).find((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path));
  if (!sheetPath) throw new Error("견적 엑셀의 첫 번째 시트를 찾지 못했습니다.");
  const parser = new DOMParser();
  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    const sharedDocument = parser.parseFromString(
      strFromU8(files["xl/sharedStrings.xml"]),
      "application/xml",
    );
    for (const item of Array.from(sharedDocument.getElementsByTagName("si"))) {
      shared.push(
        Array.from(item.getElementsByTagName("t"))
          .map((text) => text.textContent ?? "")
          .join(""),
      );
    }
  }
  const document = parser.parseFromString(
    strFromU8(files[sheetPath]),
    "application/xml",
  );
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error("견적 엑셀 시트를 읽지 못했습니다.");
  }
  const rows = new Map<number, Map<number, SheetCell>>();
  for (const row of Array.from(document.getElementsByTagName("row"))) {
    const rowNumber = Number(row.getAttribute("r")) || rows.size + 1;
    const values = new Map<number, SheetCell>();
    for (const cell of Array.from(row.getElementsByTagName("c"))) {
      const reference = cell.getAttribute("r") ?? "A1";
      const type = cell.getAttribute("t");
      const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      const formula = cell.getElementsByTagName("f")[0]?.textContent ?? "";
      const value =
        type === "s"
          ? shared[Number(raw)] ?? ""
          : type === "inlineStr"
            ? Array.from(cell.getElementsByTagName("t"))
                .map((text) => text.textContent ?? "")
                .join("")
            : raw;
      values.set(columnNumber(reference), {
        value: normalizeText(value),
        formula,
      });
    }
    rows.set(rowNumber, values);
  }
  return rows;
}

function cellValue(
  rows: Map<number, Map<number, SheetCell>>,
  row: number,
  column: number,
) {
  return rows.get(row)?.get(column)?.value ?? "";
}

function rowText(rows: Map<number, Map<number, SheetCell>>, row: number) {
  return Array.from(rows.get(row)?.values() ?? [])
    .map((cell) => cell.value)
    .filter(Boolean)
    .join(" ");
}

function extractQuotation(
  rows: Map<number, Map<number, SheetCell>>,
  sourceName: string,
) {
  const allText = Array.from(rows.keys())
    .slice(0, 30)
    .map((row) => rowText(rows, row))
    .join(" ");
  if (!/견적|품명|규격|단가|금액/.test(allText)) {
    throw new Error(
      "현재 지원하는 위즈업 견적 양식으로 확인되지 않습니다. PDF로 저장해 첨부해 주세요.",
    );
  }

  let quoteDate = "";
  for (let row = 1; row <= 12 && !quoteDate; row += 1) {
    for (const column of [2, 3, 4, 5, 6, 7, 8, 9]) {
      quoteDate = excelDate(cellValue(rows, row, column));
      if (quoteDate) break;
    }
  }

  const items: ParsedQuotationXlsxItem[] = [];
  for (let row = 12; row <= 105; row += 1) {
    const productCell = normalizeText(cellValue(rows, row, 4));
    const specification = normalizeText(cellValue(rows, row, 10));
    const quantity = Math.max(0, Math.round(parseNumber(cellValue(rows, row, 17))));
    const unit = normalizeText(cellValue(rows, row, 20) || cellValue(rows, row, 21));
    const unitPrice = Math.round(parseNumber(cellValue(rows, row, 23)));
    const amount = Math.round(parseNumber(cellValue(rows, row, 29)));
    const note = normalizeText(
      [
        cellValue(rows, row, 35),
        cellValue(rows, row, 36),
        cellValue(rows, row, 37),
        cellValue(rows, row, 38),
        cellValue(rows, row, 39),
        cellValue(rows, row, 40),
        cellValue(rows, row, 41),
      ].join(" "),
    );
    const text = normalizeText([productCell, specification, note].join(" "));
    if (
      !quantity ||
      (!unitPrice && !amount) ||
      /합계|소계|수수료|공급가|부가세|마진|이익/.test(text)
    ) {
      continue;
    }
    // 선택된 하위 품목은 제품명 칸이 비어 있어도 규격 칸에 실제 품목명이
    // 들어갑니다. 앞 행의 제품명을 물려받으면 서로 다른 품목이 합쳐지므로
    // 현재 행의 값만 사용합니다.
    const productName = productCell || specification;
    if (!productName) continue;
    const procurementNumber = procurementNumbersFromText(text)[0] ?? "";
    items.push({
      id: `xlsx-${row}`,
      productName,
      specification:
        specification && specification !== productName ? specification : "",
      quantity,
      unit: unit || "개",
      unitPrice: unitPrice || Math.round(amount / quantity),
      amount: amount || unitPrice * quantity,
      procurementNumber,
      isProcurement:
        hasProcurementSignal(text) || procurementNumber.length >= 6,
      confidence: productCell ? "높음" : "검토 필요",
      reviewNote: productCell
        ? ""
        : "품명 칸이 비어 규격을 품목명으로 사용했습니다. 한 번만 확인해 주세요.",
    });
  }
  if (!items.length) {
    throw new Error(
      "견적 품목 행을 찾지 못했습니다. 현재 위즈업 견적 양식인지 확인해 주세요.",
    );
  }
  const calculatedAmount = items.reduce((sum, item) => sum + item.amount, 0);
  let quoteAmount = 0;
  for (let row = 90; row <= 110; row += 1) {
    if (/총계|합계|견적금액|총 금액/.test(rowText(rows, row))) {
      quoteAmount = Math.max(
        quoteAmount,
        ...[29, 30, 31, 32].map((column) =>
          Math.round(parseNumber(cellValue(rows, row, column))),
        ),
      );
    }
  }
  quoteAmount = quoteAmount || calculatedAmount;
  return { sourceName, quoteDate, quoteAmount, items };
}

function money(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function splitText(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  maxLines = 2,
) {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/…$/, "")}…`;
  }
  return lines;
}

async function canvasJpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  if (!blob) throw new Error("견적서 미리보기를 만들지 못했습니다.");
  return blob;
}

async function renderSanitizedPages(
  organization: string,
  quoteDate: string,
  quoteAmount: number,
  items: ParsedQuotationXlsxItem[],
) {
  const perPage = 15;
  const pageCount = Math.max(1, Math.ceil(items.length / perPage));
  const pages: Array<{ blob: Blob; width: number; height: number }> = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = 1240;
    canvas.height = 1754;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("견적서 화면을 준비하지 못했습니다.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#17233f";
    context.font = '700 52px "Noto Sans KR", "Malgun Gothic", sans-serif';
    context.fillText("견  적  서", 78, 100);
    context.font = '700 22px "Noto Sans KR", "Malgun Gothic", sans-serif';
    context.fillStyle = "#3154df";
    context.fillText("WHIZZUP", 1010, 78);
    context.font = '400 18px "Noto Sans KR", "Malgun Gothic", sans-serif';
    context.fillStyle = "#60708f";
    context.fillText(`기관명  ${organization}`, 80, 154);
    context.fillText(`견적일  ${quoteDate || "미입력"}`, 760, 154);
    context.fillText(`페이지  ${pageIndex + 1} / ${pageCount}`, 1010, 154);

    const top = 205;
    const columns = [80, 455, 770, 875, 980, 1160];
    context.fillStyle = "#eef2ff";
    context.fillRect(72, top, 1096, 54);
    context.fillStyle = "#233252";
    context.font = '700 17px "Noto Sans KR", "Malgun Gothic", sans-serif';
    ["품목명", "규격·모델", "수량", "단위", "단가", "금액"].forEach(
      (label, index) => context.fillText(label, columns[index], top + 34),
    );
    const pageItems = items.slice(pageIndex * perPage, (pageIndex + 1) * perPage);
    const rowHeight = 86;
    context.font = '400 16px "Noto Sans KR", "Malgun Gothic", sans-serif';
    pageItems.forEach((item, index) => {
      const y = top + 54 + index * rowHeight;
      context.strokeStyle = "#dce3f1";
      context.beginPath();
      context.moveTo(72, y + rowHeight);
      context.lineTo(1168, y + rowHeight);
      context.stroke();
      context.fillStyle = "#17233f";
      splitText(context, item.productName, 350).forEach((line, lineIndex) =>
        context.fillText(line, columns[0], y + 29 + lineIndex * 22),
      );
      context.fillStyle = "#52617d";
      splitText(context, item.specification || "—", 290).forEach(
        (line, lineIndex) =>
          context.fillText(line, columns[1], y + 29 + lineIndex * 22),
      );
      context.fillStyle = "#17233f";
      context.fillText(String(item.quantity), columns[2], y + 39);
      context.fillText(item.unit, columns[3], y + 39);
      context.textAlign = "right";
      context.fillText(money(item.unitPrice), 1080, y + 39);
      context.fillText(money(item.amount), 1160, y + 39);
      context.textAlign = "left";
    });
    const footerY = top + 54 + pageItems.length * rowHeight + 55;
    if (pageIndex === pageCount - 1) {
      context.strokeStyle = "#3154df";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(760, footerY - 25);
      context.lineTo(1168, footerY - 25);
      context.stroke();
      context.fillStyle = "#17233f";
      context.font = '700 25px "Noto Sans KR", "Malgun Gothic", sans-serif';
      context.fillText("총 견적금액", 780, footerY + 20);
      context.textAlign = "right";
      context.fillText(money(quoteAmount), 1160, footerY + 20);
      context.textAlign = "left";
    }
    context.fillStyle = "#7b879d";
    context.font = '400 15px "Noto Sans KR", "Malgun Gothic", sans-serif';
    context.fillText(
      "내부 마진·수수료 메모를 제외한 기관 공유용 견적서입니다.",
      78,
      1695,
    );
    pages.push({
      blob: await canvasJpeg(canvas),
      width: canvas.width,
      height: canvas.height,
    });
    canvas.width = 1;
    canvas.height = 1;
  }
  return pages;
}

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

async function jpegPagesToPdf(
  pages: Array<{ blob: Blob; width: number; height: number }>,
) {
  const encoder = new TextEncoder();
  const objects: Uint8Array[] = [];
  const pageObjectIds: number[] = [];
  const imageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  let nextId = 3;
  for (let index = 0; index < pages.length; index += 1) {
    pageObjectIds.push(nextId++);
    imageObjectIds.push(nextId++);
    contentObjectIds.push(nextId++);
  }
  const pageSize = { width: 595.28, height: 841.89 };
  objects[1] = encoder.encode(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects[2] = encoder.encode(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds
      .map((id) => `${id} 0 R`)
      .join(" ")}] >>`,
  );
  for (let index = 0; index < pages.length; index += 1) {
    const imageBytes = new Uint8Array(await pages[index].blob.arrayBuffer());
    const content = encoder.encode(
      `q ${pageSize.width} 0 0 ${pageSize.height} 0 0 cm /Im${index + 1} Do Q`,
    );
    objects[pageObjectIds[index]] = encoder.encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize.width} ${pageSize.height}] /Resources << /XObject << /Im${index + 1} ${imageObjectIds[index]} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`,
    );
    objects[imageObjectIds[index]] = concatBytes([
      encoder.encode(
        `<< /Type /XObject /Subtype /Image /Width ${pages[index].width} /Height ${pages[index].height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
      ),
      imageBytes,
      encoder.encode("\nendstream"),
    ]);
    objects[contentObjectIds[index]] = concatBytes([
      encoder.encode(`<< /Length ${content.length} >>\nstream\n`),
      content,
      encoder.encode("\nendstream"),
    ]);
  }
  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets = [0];
  let offset = chunks[0].length;
  for (let id = 1; id < objects.length; id += 1) {
    const object = concatBytes([
      encoder.encode(`${id} 0 obj\n`),
      objects[id],
      encoder.encode("\nendobj\n"),
    ]);
    offsets[id] = offset;
    chunks.push(object);
    offset += object.length;
  }
  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objects.length}\n`,
    "0000000000 65535 f \n",
    ...offsets
      .slice(1)
      .map((value) => `${String(value).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  ].join("");
  chunks.push(encoder.encode(xref));
  const pdfBytes = concatBytes(chunks);
  const pdfBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([pdfBuffer], { type: "application/pdf" });
}

export async function parseQuotationXlsx(
  file: File,
  organization: string,
): Promise<ParsedQuotationXlsx> {
  if (!file.name.toLocaleLowerCase().endsWith(".xlsx")) {
    throw new Error("견적 엑셀은 .xlsx 파일만 지원합니다.");
  }
  const rows = parseFirstWorksheet(await file.arrayBuffer());
  const extracted = extractQuotation(rows, file.name);
  const pageData = await renderSanitizedPages(
    organization,
    extracted.quoteDate,
    extracted.quoteAmount,
    extracted.items,
  );
  const pdfBlob = await jpegPagesToPdf(pageData);
  const safeBase = file.name
    .replace(/\.xlsx$/i, "")
    .replace(/(?:내부|마진|원가|수수료)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return {
    ...extracted,
    pdf: new File([pdfBlob], `${safeBase || "견적서"}_기관공유용.pdf`, {
      type: "application/pdf",
    }),
    pages: pageData.map(
      (page, index) =>
        new File(
          [page.blob],
          `page-${String(index + 1).padStart(3, "0")}.jpg`,
          { type: "image/jpeg" },
        ),
    ),
  };
}
