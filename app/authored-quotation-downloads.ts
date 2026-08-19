import type { AuthoredQuotation } from "../lib/authored-quotations";
import { createQuotationWorkbook } from "../lib/quotation-xlsx";
import { quotationDownloadName } from "../lib/quotation-file-name";

export async function storedQuotationFile(url: string, fallbackMessage: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (response.ok) return response.blob();
  let message = fallbackMessage;
  try {
    const payload = await response.json() as { error?: unknown; message?: unknown };
    message = String(payload.error || payload.message || "").trim() || message;
  } catch {
    // 파일 응답이 JSON이 아니면 호출부의 안전한 기본 안내를 사용합니다.
  }
  throw new Error(message);
}

export async function createAuthoredQuotationWorkbookFile(
  quote: AuthoredQuotation,
  region = "",
) {
  const [logoResponse, sealResponse, airpassSealResponse] = await Promise.all([
    fetch("/whizzup-logo.png"),
    quote.includeStamp ? fetch("/whizzup-seal.png") : Promise.resolve(null),
    quote.items.some((item) => item.equipmentKit) ? fetch("/airpass-seal.png") : Promise.resolve(null),
  ]);
  const logoData = logoResponse.ok ? new Uint8Array(await logoResponse.arrayBuffer()) : undefined;
  const sealData = sealResponse?.ok ? new Uint8Array(await sealResponse.arrayBuffer()) : undefined;
  const airpassSealData = airpassSealResponse?.ok ? new Uint8Array(await airpassSealResponse.arrayBuffer()) : undefined;
  const bytes = createQuotationWorkbook({
    customerName: quote.organization,
    quoteDate: quote.quoteDate,
    projectTitle: quote.projectTitle,
    quoteNumber: quote.quoteNumber,
    validUntil: quote.validUntil,
    includeStamp: quote.includeStamp,
    discountAmount: quote.discountAmount,
    extraAmount: quote.extraAmount,
    memo: quote.memo,
    logoData,
    sealData,
    airpassSealData,
    equipmentKit: quote.items.find((item) => item.equipmentKit)?.equipmentKit,
    equipmentKitComplimentary: Boolean(quote.items.find((item) => item.equipmentKit)?.complimentary),
    lines: quote.items.map((item) => ({
      name: item.name,
      specification: item.specification,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      note: item.note,
      procurement: item.procurement,
      procurementChannel: item.procurementChannel,
      procurementNumber: item.procurementNumber,
      procurementFeeRate: item.procurementFeeRate,
      equipmentKit: Boolean(item.equipmentKit),
      complimentary: Boolean(item.complimentary),
    })),
  });
  const workbookBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new File(
    [workbookBuffer],
    quotationDownloadName({ ...quote, region }, "xlsx"),
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  );
}
