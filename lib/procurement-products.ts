import type { ProductCatalogItem } from "./product-catalog";

export type ProcurementSearchItem = {
  identity: string;
  name: string;
  specification: string;
  unitPrice: number | null;
  unit: string;
  supplierName: string;
  manufacturerName: string;
  procurementChannel: string;
  procurementNumber: string;
  contractMethod: string;
  contractNumber: string;
  contractStartDate: string;
  contractEndDate: string;
  imageUrl: string;
};

export function procurementProductIdentity(channel: unknown, identifier: unknown) {
  const normalizedChannel = String(channel ?? "G2B").trim().toLocaleUpperCase("ko-KR").replace(/[^A-Z0-9가-힣]/gu, "");
  const normalizedIdentifier = String(identifier ?? "").trim().replace(/[^A-Z0-9]/giu, "").toLocaleUpperCase("ko-KR");
  return normalizedIdentifier ? `${normalizedChannel || "G2B"}:${normalizedIdentifier}` : "";
}

export function procurementCatalogId(channel: unknown, identifier: unknown) {
  const identity = procurementProductIdentity(channel, identifier);
  return identity ? `procurement-${identity.toLocaleLowerCase("ko-KR").replace(/[^a-z0-9가-힣]+/gu, "-")}`.slice(0, 150) : "";
}

export function procurementSearchItemToCatalogProduct(item: ProcurementSearchItem): ProductCatalogItem {
  return {
    id: procurementCatalogId(item.procurementChannel, item.procurementNumber),
    sourceRow: 0,
    name: item.name,
    specification: item.specification,
    unitPrice: item.unitPrice,
    note: "",
    commissionRate: null,
    supplyType: "partner",
    marginRate: null,
    reference: [item.contractMethod, item.contractNumber].filter(Boolean).join(" · "),
    needsReview: false,
    supplierVendorId: null,
    supplierVendorName: "",
    procurementSupplierName: item.supplierName,
    procurementUnit: item.unit,
    procurement: true,
    procurementChannel: item.procurementChannel,
    procurementNumber: item.procurementNumber,
    procurementFeeRate: 0.0054,
  };
}

function text(value: unknown, maxLength = 1_000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function nullableMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

export function mapProcurementSearchItem(value: unknown): ProcurementSearchItem | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const procurementNumber = text(source.prdctIdntNo, 100);
  const name = text(source.prdctIdntNoNm || source.dtilPrdctClsfcNoNm || source.prdctClsfcNoNm, 300);
  if (!procurementNumber || !name) return null;
  const procurementChannel = "G2B";
  return {
    identity: procurementProductIdentity(procurementChannel, procurementNumber),
    name,
    specification: text(source.prdctSpecNm, 1_000),
    unitPrice: nullableMoney(source.cntrctPrceAmt),
    unit: text(source.prdctUnit, 40),
    supplierName: text(source.cntrctCorpNm, 300),
    manufacturerName: text(source.prdctMakrNm, 300),
    procurementChannel,
    procurementNumber,
    contractMethod: text(source.cntrctMthdNm, 160),
    contractNumber: text(source.shopngCntrctNo, 100),
    contractStartDate: text(source.cntrctBgnDate, 20),
    contractEndDate: text(source.cntrctEndDate, 20),
    imageUrl: text(source.prdctImgUrl, 1_000),
  };
}
