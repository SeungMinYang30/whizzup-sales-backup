export type QuotationFileNameInput = {
  organization?: unknown;
  projectTitle?: unknown;
  quoteDate?: unknown;
  quoteNumber?: unknown;
  revisionNumber?: unknown;
};

function safeFilePart(value: unknown, maxLength = 80) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, maxLength);
}

export function quotationFileStem(quote: QuotationFileNameInput) {
  const organization = safeFilePart(quote.organization);
  const projectTitle = safeFilePart(quote.projectTitle);
  const quoteDate = safeFilePart(quote.quoteDate, 20);
  const quoteNumber = safeFilePart(quote.quoteNumber);
  const revisionNumber = Math.max(0, Number(quote.revisionNumber) || 0);
  const descriptiveParts = [organization, projectTitle, quoteDate].filter(Boolean);
  const parts = ["견적서", ...(descriptiveParts.length ? descriptiveParts : [quoteNumber].filter(Boolean))];
  if (revisionNumber > 0) parts.push(`수정${revisionNumber}`);
  return parts.join("_") || "견적서";
}

export function quotationDownloadName(quote: QuotationFileNameInput, extension: "pdf" | "xlsx") {
  return `${quotationFileStem(quote)}.${extension}`;
}
