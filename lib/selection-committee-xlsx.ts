import { unzipSync, zipSync } from "fflate";
import type { ProductCatalogItem } from "./product-catalog";

export const SELECTION_COMMITTEE_TEMPLATE_PATH =
  "/templates/일산초_물품선정위원회_원본양식.xlsx";

export type SelectionCommitteeLine = {
  productId: string;
  quantity: number;
};

type SelectionEntry = {
  selected: ProductCatalogItem;
  alternatives: ProductCatalogItem[];
  quantity: number;
  total: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function normalize(value: unknown) {
  return String(value ?? "").toLocaleLowerCase("ko-KR").replace(/[^0-9a-zㄱ-힝]/g, "");
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value: string) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function cellExpression(reference: string) {
  return new RegExp(`(<c\\b(?![^>]*\\/>)[^>]*\\br="${reference}"[^>]*>)([\\s\\S]*?)(<\\/c>)`);
}

function removeType(opening: string) {
  return opening.replace(/\s+t="[^"]*"/g, "");
}

function setCell(xml: string, reference: string, value: string | number | null) {
  const expression = cellExpression(reference);
  const match = xml.match(expression);
  if (!match) return xml;
  const opening = removeType(match[1]);
  if (value === null || value === "") {
    return xml.replace(expression, `${opening}${match[3]}`);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return xml.replace(expression, `${opening}<v>${value}</v>${match[3]}`);
  }
  const typedOpening = opening.replace(/>$/, ' t="inlineStr">');
  return xml.replace(
    expression,
    `${typedOpening}<is><t xml:space="preserve">${escapeXml(value)}</t></is>${match[3]}`,
  );
}

function cellValue(xml: string, reference: string, sharedStrings: string[]) {
  const match = xml.match(cellExpression(reference));
  if (!match) return "";
  const opening = match[1];
  const body = match[2];
  const inline = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((entry) => decodeXml(entry[1]))
    .join("");
  if (inline) return inline;
  const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (/\bt="s"/.test(opening)) return sharedStrings[Number(value)] ?? "";
  return decodeXml(value);
}

function sharedStringsFrom(xml: string) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((entry) =>
    [...entry[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((text) => decodeXml(text[1]))
      .join(""),
  );
}

function sheetPaths(files: Record<string, Uint8Array>) {
  const workbook = decoder.decode(files["xl/workbook.xml"]);
  const relations = decoder.decode(files["xl/_rels/workbook.xml.rels"]);
  const targets = new Map(
    [...relations.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/g)]
      .map((entry) => [entry[1], entry[2]]),
  );
  return new Map(
    [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/>/g)]
      .map((entry) => {
        const target = targets.get(entry[2]) ?? "";
        const path = target.startsWith("/")
          ? target.slice(1)
          : `xl/${target.replace(/^\.\//, "")}`;
        return [decodeXml(entry[1]).trim(), path] as const;
      }),
  );
}

function identifier(product: ProductCatalogItem) {
  const value = `${product.reference} ${product.note}`.match(/(?:G2B\s*[:#-]?\s*)?(\d{8,})/i)?.[1];
  return value ?? "";
}

function supplier(product: ProductCatalogItem) {
  return product.supplierVendorName?.trim() ||
    product.note.match(/(?:주식회사|\(\uC8FC\)|㈜)?\s*[가-힣A-Za-z0-9&.]+(?=\s+(?:G2B|S2B|[물품제조업]))/)?.[0]?.trim() ||
    "공급업체 확인 필요";
}

export function prepareSelectionEntries(
  lines: SelectionCommitteeLine[],
  products: ProductCatalogItem[],
) {
  const productById = new Map(products.map((product) => [product.id, product]));
  return lines.flatMap<SelectionEntry>((line) => {
    const selected = productById.get(line.productId);
    if (!selected) return [];
    const quantity = Math.max(1, Math.trunc(Number(line.quantity) || 1));
    const sameName = products.filter(
      (product) => product.id !== selected.id && normalize(product.name) === normalize(selected.name),
    );
    const alternatives = [selected, ...sameName].slice(0, 3);
    return [{
      selected,
      alternatives,
      quantity,
      total: (selected.unitPrice ?? 0) * quantity,
    }];
  });
}

function clearRange(xml: string, columns: string[], start: number, end: number) {
  let next = xml;
  for (let row = start; row <= end; row += 1) {
    for (const column of columns) next = setCell(next, `${column}${row}`, null);
  }
  return next;
}

function fillSelectionSheet(xml: string, entries: SelectionEntry[]) {
  let next = clearRange(xml, ["A", "B", "C", "D", "E", "F", "G", "H"], 5, 63);
  const above = entries.filter((entry) => entry.total >= 20_000_000).slice(0, 22);
  const below = entries.filter((entry) => entry.total < 20_000_000).slice(0, 36);
  const fill = (entry: SelectionEntry, row: number, index: number) => {
    const product = entry.selected;
    next = setCell(next, `A${row}`, index + 1);
    next = setCell(next, `B${row}`, product.name);
    next = setCell(next, `C${row}`, product.specification || product.note);
    next = setCell(next, `D${row}`, entry.quantity);
    next = setCell(next, `E${row}`, supplier(product));
    next = setCell(next, `F${row}`, identifier(product));
    next = setCell(next, `G${row}`, product.unitPrice ?? 0);
    next = setCell(next, `H${row}`, entry.total);
  };
  above.forEach((entry, index) => fill(entry, 5 + index, index));
  below.forEach((entry, index) => fill(entry, 28 + index, index));
  return next;
}

function fillCountSheet(xml: string, entries: SelectionEntry[], start: number, end: number) {
  let next = clearRange(xml, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"], start, end);
  entries.slice(0, end - start + 1).forEach((entry, index) => {
    const row = start + index;
    const product = entry.selected;
    const values: Array<string | number> = [
      index + 1,
      product.name,
      product.specification || product.note,
      entry.quantity,
      product.unitPrice ?? 0,
      entry.total,
      supplier(product),
      identifier(product),
      product.reference || "",
      entry.total >= 20_000_000 ? "2천만원 이상" : "2천만원 미만",
    ];
    ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].forEach((column, columnIndex) => {
      next = setCell(next, `${column}${row}`, values[columnIndex]);
    });
  });
  return next;
}

function fillAggregateSheet(xml: string, entries: SelectionEntry[], sharedStrings: string[]) {
  let next = clearRange(xml, ["A", "B", "C", "D"], 4, 141);
  const starts = Array.from({ length: 138 }, (_, index) => index + 4)
    .filter((row) => cellValue(xml, `E${row}`, sharedStrings).trim() === "업체");
  starts.forEach((row, index) => {
    const entry = entries[index];
    ["F", "M", "T"].forEach((column) => { next = setCell(next, `${column}${row}`, null); });
    if (!entry) return;
    next = setCell(next, `A${row}`, index + 1);
    next = setCell(next, `B${row}`, entry.selected.name);
    next = setCell(next, `C${row}`, entry.selected.specification || entry.selected.note);
    next = setCell(next, `D${row}`, entry.quantity);
    entry.alternatives.forEach((product, alternativeIndex) => {
      const column = ["F", "M", "T"][alternativeIndex];
      if (column) next = setCell(next, `${column}${row}`, supplier(product));
    });
  });
  return next;
}

function valueForLabel(product: ProductCatalogItem, labelValue: string, hideVendor: boolean, quantity: number) {
  const label = normalize(labelValue);
  if (!label || label.includes("이미지") || label.includes("사진")) return "";
  if (label.includes("업체") || label.includes("제조사") || label.includes("회사명") || label.includes("공급업체")) return hideVendor ? "비교업체" : supplier(product);
  if (label.includes("식별번호") || label.includes("g2b")) return identifier(product);
  if (label.includes("금액") || label.includes("가격") || label.includes("단가") || label.includes("조달등록가")) return product.unitPrice ?? 0;
  if (label.includes("수량")) return quantity;
  if (label.includes("모델") || label.includes("규격") || label.includes("사양") || label.includes("구성") || label.includes("분류") || label.includes("세부품명")) return product.specification || product.name;
  if (label.includes("소재지")) return "";
  if (label.includes("특징") || label.includes("특이사항") || label.includes("사후관리") || label.includes("하자보수") || label.includes("인증") || label.includes("콘텐츠")) return product.note || product.reference || product.specification;
  return product.specification || product.note || product.reference;
}

function fillComparisonSheet(xml: string, entries: SelectionEntry[], sharedStrings: string[], hideVendor: boolean) {
  const titleRows = Array.from({ length: 520 }, (_, index) => index + 1)
    .filter((row) => cellValue(xml, `A${row}`, sharedStrings).includes("물품명("));
  let next = xml;
  titleRows.forEach((start, index) => {
    const end = (titleRows[index + 1] ?? 521) - 1;
    const entry = entries[index];
    next = setCell(next, `A${start}`, entry ? `▣  물품명(${index + 1})  :  ${entry.selected.name}` : null);
    for (let row = start + 1; row <= end; row += 1) {
      const label = cellValue(xml, `B${row}`, sharedStrings);
      ["C", "D", "E"].forEach((column, alternativeIndex) => {
        const product = entry?.alternatives[alternativeIndex];
        next = setCell(next, `${column}${row}`, product ? valueForLabel(product, label, hideVendor, entry.quantity) : null);
      });
    }
  });
  return next;
}

export async function createSelectionCommitteeWorkbook(
  lines: SelectionCommitteeLine[],
  products: ProductCatalogItem[],
) {
  const response = await fetch(SELECTION_COMMITTEE_TEMPLATE_PATH, { cache: "force-cache" });
  if (!response.ok) throw new Error("일산초 물품선정 원본 양식을 불러오지 못했습니다.");
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const paths = sheetPaths(files);
  const sharedStrings = files["xl/sharedStrings.xml"]
    ? sharedStringsFrom(decoder.decode(files["xl/sharedStrings.xml"]))
    : [];
  const entries = prepareSelectionEntries(lines, products);
  if (!entries.length) throw new Error("출력할 제품을 선택해 주세요.");
  const aboveCount = entries.filter((entry) => entry.total >= 20_000_000).length;
  const belowCount = entries.length - aboveCount;
  if (aboveCount > 22 || belowCount > 36) {
    throw new Error(
      `일산초 원본 양식의 표시 한도는 2천만 원 이상 22개, 미만 36개입니다. ` +
      `현재 이상 ${aboveCount}개, 미만 ${belowCount}개이므로 두 번에 나누어 출력해 주세요.`,
    );
  }

  const update = (name: string, transform: (xml: string) => string) => {
    const path = paths.get(name);
    if (!path || !files[path]) return;
    files[path] = encoder.encode(transform(decoder.decode(files[path])));
  };
  update("선정표", (xml) => fillSelectionSheet(xml, entries));
  update("물품별 수량 확인_2천만원 이상_기자재", (xml) => fillCountSheet(xml, entries.filter((entry) => entry.total >= 20_000_000), 2, 23));
  update("물품별 수량 확인_2천만원 미만_기자재", (xml) => fillCountSheet(xml, entries.filter((entry) => entry.total < 20_000_000), 2, 37));
  update("집계표", (xml) => fillAggregateSheet(xml, entries, sharedStrings));
  for (const [name] of paths) {
    if (!name.includes("비교표")) continue;
    const source = name.includes("2천만원 이상")
      ? entries.filter((entry) => entry.total >= 20_000_000)
      : entries.filter((entry) => entry.total < 20_000_000);
    update(name, (xml) => fillComparisonSheet(xml, source, sharedStrings, name.includes("업체명X")));
  }
  return zipSync(files, { level: 6 });
}
