export type QuotationListDateSource = {
  id: number;
  revisionRootId: number;
  revisionNumber: number;
  quoteDate: string;
  initialQuoteDate?: string;
  createdAt: string;
  contentUpdatedAt?: string;
};

const SEOUL_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function storedDate(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return raw;

  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const instant = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/iu.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(instant.getTime())) return raw.match(/^\d{4}-\d{2}-\d{2}/u)?.[0] ?? "";
  return SEOUL_DATE_FORMATTER.format(instant);
}

export function originalQuotationDateByRoot(quotes: QuotationListDateSource[]) {
  const originals = new Map<number, QuotationListDateSource>();
  quotes.forEach((quote) => {
    const rootId = quote.revisionRootId || quote.id;
    const current = originals.get(rootId);
    if (!current || quote.revisionNumber < current.revisionNumber || (quote.revisionNumber === current.revisionNumber && quote.id < current.id)) {
      originals.set(rootId, quote);
    }
  });
  return new Map(Array.from(originals, ([rootId, quote]) => [rootId, quote.initialQuoteDate || quote.quoteDate]));
}

export function quotationListDateLabels(
  quote: QuotationListDateSource,
  originalDates: Map<number, string>,
) {
  const rootId = quote.revisionRootId || quote.id;
  return {
    initialDate: originalDates.get(rootId) || quote.quoteDate,
    modifiedDate: storedDate(quote.contentUpdatedAt || (quote.revisionNumber > 0 ? quote.createdAt : "")) || "",
  };
}
