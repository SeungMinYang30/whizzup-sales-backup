"use client";

import type { AuthoredQuotation } from "../lib/authored-quotations";
import { createFieldInspectionWorkbook } from "../lib/quotation-xlsx";
import { fieldInspectionDownloadName } from "../lib/quotation-file-name";
import { createFieldInspectionPdf } from "./authored-quotation-pdf";

export async function createFieldInspectionWorkbookFile(quote: AuthoredQuotation, region = "") {
  const [logoResponse, sealResponse, airpassSealResponse] = await Promise.all([
    fetch("/whizzup-logo.png"),
    quote.includeStamp ? fetch("/whizzup-seal.png") : Promise.resolve(null),
    quote.items.some((item) => item.equipmentKit) ? fetch("/airpass-seal.png") : Promise.resolve(null),
  ]);
  const logoData = logoResponse.ok ? new Uint8Array(await logoResponse.arrayBuffer()) : undefined;
  const sealData = sealResponse?.ok ? new Uint8Array(await sealResponse.arrayBuffer()) : undefined;
  const airpassSealData = airpassSealResponse?.ok ? new Uint8Array(await airpassSealResponse.arrayBuffer()) : undefined;
  const equipmentItem = quote.items.find((item) => item.equipmentKit);
  const bytes = createFieldInspectionWorkbook({
    customerName: quote.organization,
    quoteDate: quote.quoteDate,
    projectTitle: quote.projectTitle,
    quoteNumber: quote.quoteNumber,
    validUntil: quote.validUntil,
    includeStamp: quote.includeStamp,
    discountAmount: quote.discountAmount,
    extraAmount: quote.extraAmount,
    memo: quote.memo,
    visitorName: quote.updatedByName,
    logoData,
    sealData,
    airpassSealData,
    equipmentKit: equipmentItem?.equipmentKit,
    equipmentKitComplimentary: Boolean(equipmentItem?.complimentary),
    lines: quote.items.map((item) => ({
      productId: item.productId,
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
      equipmentKitData: item.equipmentKit,
      complimentary: Boolean(item.complimentary),
      supplyType: item.supplyType,
      supplierVendorName: item.supplierVendorName,
    })),
  });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([buffer], fieldInspectionDownloadName({ ...quote, region }, "xlsx"), {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function createFieldInspectionPdfFile(quote: AuthoredQuotation, region = "") {
  return createFieldInspectionPdf(quote, region);
}
