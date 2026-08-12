import { strFromU8, unzipSync } from "fflate";

export type XlsxPreviewSheet = {
  name: string;
  rows: string[][];
};

export type XlsxPreviewImage = {
  name: string;
  url: string;
};

export type XlsxPreview = {
  sheets: XlsxPreviewSheet[];
  images: XlsxPreviewImage[];
  truncated: boolean;
};

const MAX_SHEETS = 8;
const MAX_ROWS = 120;
const MAX_COLUMNS = 30;
const MAX_IMAGES = 20;

function archivePath(target: string) {
  const parts = (target.replace(/\\/g, "/").replace(/^\/+/, "").startsWith("xl/")
    ? target.replace(/\\/g, "/").replace(/^\/+/, "")
    : `xl/${target.replace(/\\/g, "/").replace(/^\/+/, "")}`).split("/");
  const normalized: string[] = [];
  parts.forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  });
  return normalized.join("/");
}

function columnIndex(reference: string) {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, result - 1);
}

function cleanText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function imageMime(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return "image/jpeg";
}

function bytesToDataUrl(bytes: Uint8Array, mime: string) {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function parseXlsxPreview(buffer: ArrayBuffer): XlsxPreview {
  const files = unzipSync(new Uint8Array(buffer));
  const parser = new DOMParser();
  const sharedStrings: string[] = [];
  const sharedFile = files["xl/sharedStrings.xml"];
  if (sharedFile) {
    const document = parser.parseFromString(strFromU8(sharedFile), "application/xml");
    Array.from(document.getElementsByTagName("si")).forEach((item) => {
      sharedStrings.push(cleanText(Array.from(item.getElementsByTagName("t")).map((node) => node.textContent || "").join("")));
    });
  }

  const relationships = new Map<string, string>();
  const relationshipFile = files["xl/_rels/workbook.xml.rels"];
  if (relationshipFile) {
    const document = parser.parseFromString(strFromU8(relationshipFile), "application/xml");
    Array.from(document.getElementsByTagName("Relationship")).forEach((item) => {
      const id = item.getAttribute("Id") || "";
      const target = item.getAttribute("Target") || "";
      if (id && target && /worksheet$/u.test(item.getAttribute("Type") || "")) relationships.set(id, archivePath(target));
    });
  }

  const entries: Array<{ name: string; path: string }> = [];
  const workbookFile = files["xl/workbook.xml"];
  if (workbookFile) {
    const document = parser.parseFromString(strFromU8(workbookFile), "application/xml");
    Array.from(document.getElementsByTagName("sheet")).forEach((sheet, index) => {
      const id = sheet.getAttribute("r:id")
        || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")
        || "";
      const path = relationships.get(id) || `xl/worksheets/sheet${index + 1}.xml`;
      if (files[path]) entries.push({ name: sheet.getAttribute("name") || `시트 ${index + 1}`, path });
    });
  }
  if (!entries.length) {
    Object.keys(files).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(path)).sort().forEach((path, index) => {
      entries.push({ name: `시트 ${index + 1}`, path });
    });
  }
  if (!entries.length) throw new Error("Excel 시트를 찾지 못했습니다.");

  let truncated = entries.length > MAX_SHEETS;
  const sheets = entries.slice(0, MAX_SHEETS).map((entry) => {
    const document = parser.parseFromString(strFromU8(files[entry.path]), "application/xml");
    if (document.getElementsByTagName("parsererror").length) throw new Error(`${entry.name} 시트를 읽지 못했습니다.`);
    const rows: string[][] = [];
    const rowNodes = Array.from(document.getElementsByTagName("row"));
    if (rowNodes.length > MAX_ROWS) truncated = true;
    rowNodes.slice(0, MAX_ROWS).forEach((row) => {
      const values: string[] = [];
      Array.from(row.getElementsByTagName("c")).forEach((cell) => {
        const index = columnIndex(cell.getAttribute("r") || "A1");
        if (index >= MAX_COLUMNS) {
          truncated = true;
          return;
        }
        const type = cell.getAttribute("t") || "";
        const raw = cell.getElementsByTagName("v")[0]?.textContent || "";
        const inline = Array.from(cell.getElementsByTagName("t")).map((node) => node.textContent || "").join("");
        values[index] = cleanText(type === "s" ? sharedStrings[Number(raw)] || "" : type === "inlineStr" ? inline : raw);
      });
      while (values.length && !values.at(-1)) values.pop();
      if (values.some(Boolean)) rows.push(values);
    });
    return { name: entry.name, rows };
  });

  const mediaPaths = Object.keys(files).filter((path) => /^xl\/media\//u.test(path));
  if (mediaPaths.length > MAX_IMAGES) truncated = true;
  const images = mediaPaths.slice(0, MAX_IMAGES).flatMap((path) => {
    const mime = imageMime(path);
    if (!mime.startsWith("image/")) return [];
    return [{ name: path.split("/").pop() || "Excel 이미지", url: bytesToDataUrl(files[path], mime) }];
  });
  return { sheets, images, truncated };
}
