export type QuotationFileNameParts = {
  organization: string;
  businessRound: number;
  quoteNumber: string;
  revisionNumber: number;
};

function safeFileSegment(value: unknown, fallback: string) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/gu, "");
  return (cleaned || fallback).slice(0, 80);
}

export function quotationFileStem(quote: QuotationFileNameParts) {
  const organization = safeFileSegment(quote.organization, "기관 미지정");
  const round = Math.max(1, Number(quote.businessRound) || 1);
  const rootNumber = safeFileSegment(
    String(quote.quoteNumber ?? "").replace(/-수정\d+$/u, ""),
    "견적번호 미발급",
  );
  const revision = Number(quote.revisionNumber) > 0 ? `수정${Number(quote.revisionNumber)}` : "원본";
  return `견적서_${organization}_${round}차_${rootNumber}_${revision}`;
}
