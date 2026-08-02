export const DEFAULT_PROCUREMENT_FEE_RATE = 0.0054;

const PROCUREMENT_MARKER_SOURCE = [
  String.raw`G\s*2\s*B`,
  String.raw`S\s*2\s*B`,
  "나라장터",
  String.raw`조달(?:청|번호|식별번호|제품)?`,
  "물품식별번호",
  "디지털서비스몰",
  "혁신장터",
].join("|");

function normalizedProcurementText(values: unknown[]) {
  return values
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).normalize("NFKC"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasProcurementSignal(...values: unknown[]) {
  const text = normalizedProcurementText(values);
  return new RegExp(`(?:${PROCUREMENT_MARKER_SOURCE})`, "iu").test(text);
}

export function procurementNumbersFromText(...values: unknown[]) {
  const text = normalizedProcurementText(values);
  const matcher = new RegExp(
    `(?:${PROCUREMENT_MARKER_SOURCE})[^0-9]{0,40}([0-9][0-9\\s-]{4,}[0-9])`,
    "giu",
  );
  const numbers = Array.from(text.matchAll(matcher), (match) =>
    String(match[1] ?? "").replace(/\D/g, ""),
  ).filter((value) => value.length >= 6);
  return [...new Set(numbers)];
}

export function resolveProcurementFeeRate(
  requestedRate: unknown,
  ...evidence: unknown[]
) {
  if (
    requestedRate !== null &&
    requestedRate !== undefined &&
    requestedRate !== ""
  ) {
    const rate = Number(requestedRate);
    if (Number.isFinite(rate) && rate >= 0) return Math.min(1, rate);
  }
  return hasProcurementSignal(...evidence)
    ? DEFAULT_PROCUREMENT_FEE_RATE
    : null;
}
