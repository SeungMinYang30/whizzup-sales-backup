export type QuotationFileNameInput = {
  region?: unknown;
  organization?: unknown;
  businessRound?: unknown;
  projectTitle?: unknown;
  quoteDate?: unknown;
  quoteNumber?: unknown;
  revisionNumber?: unknown;
};

export const QUOTATION_LIBRARY_FOLDER = "기관자료 보기_견적서";

function safeFilePart(value: unknown, maxLength = 80) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, maxLength);
}

function safeRegion(value: unknown) {
  return safeFilePart(value, 40)
    .replace(/[·,/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function extensionOf(value: unknown, fallback: "pdf" | "xlsx" = "xlsx") {
  const match = safeFilePart(value, 240).match(/\.([a-z0-9]{1,10})$/iu);
  return (match?.[1] || fallback).toLocaleLowerCase("en-US");
}

function stemOf(value: unknown) {
  const name = safeFilePart(value, 120);
  return name.replace(/\.[a-z0-9]{1,10}$/iu, "") || "원본";
}

function withExtension(stem: string, extension: string) {
  const suffix = `.${extension}`;
  const maxStemLength = Math.max(1, 240 - suffix.length);
  return `${stem.slice(0, maxStemLength).replace(/[. ]+$/g, "")}${suffix}`;
}

export function quotationIdentityStem(quote: QuotationFileNameInput) {
  const region = safeRegion(quote.region);
  const organization = safeFilePart(quote.organization, 70) || "기관미지정";
  const projectTitle = safeFilePart(quote.projectTitle, 70) || "사업미지정";
  const businessRound = Math.max(1, Number(quote.businessRound) || 1);
  const quoteNumber = safeFilePart(quote.quoteNumber, 70)
    || safeFilePart(quote.quoteDate, 20)
    || "견적번호미지정";
  const prefix = region ? `[${region}] ` : "";
  return `${prefix}${organization}_${projectTitle}_${businessRound}차_${quoteNumber}`;
}

export function quotationGeneratedFileName(
  quote: QuotationFileNameInput,
  extension: "pdf" | "xlsx",
) {
  const order = extension === "xlsx" ? "02" : "03";
  return withExtension(`${quotationIdentityStem(quote)}_${order}_위즈업견적`, extension);
}

export function quotationSourceFileName(
  quote: QuotationFileNameInput,
  originalName: unknown,
) {
  const normalizedOriginal = safeFilePart(originalName, 240);
  const marker = "_01_외부원본_";
  const markerIndex = normalizedOriginal.lastIndexOf(marker);
  const sourcePart = markerIndex >= 0
    ? normalizedOriginal.slice(markerIndex + marker.length)
    : normalizedOriginal;
  const extension = extensionOf(sourcePart);
  const originalStem = stemOf(sourcePart);
  return withExtension(`${quotationIdentityStem(quote)}_01_외부원본_${originalStem}`, extension);
}

// 기존 호출부 호환용입니다. 새 저장·다운로드는 파일 종류별 함수를 사용합니다.
export function quotationFileStem(quote: QuotationFileNameInput) {
  return quotationIdentityStem(quote);
}

export function quotationDownloadName(
  quote: QuotationFileNameInput,
  extension: "pdf" | "xlsx",
) {
  return quotationGeneratedFileName(quote, extension);
}
