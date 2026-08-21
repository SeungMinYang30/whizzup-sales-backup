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
  classificationNumber: string;
  classificationName: string;
  detailClassificationNumber: string;
  detailClassificationName: string;
  registrationDate: string;
  saleStatus: string;
  sourceLabel: string;
  sourceUrl: string;
};

export type ProcurementSearchMapOptions = {
  contractMethod?: string;
  sourceLabel?: string;
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

function procurementSaleStatus(source: Record<string, unknown>, contractEndDate: string) {
  if (text(source.regtCncelYn, 10).toLocaleUpperCase("ko-KR") === "Y") return "등록 취소";
  const end = contractEndDate.replace(/[^0-9]/g, "").slice(0, 8);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  if (end && end < today) return "계약 종료";
  return contractEndDate ? "계약 유효" : "등록 상품";
}

function procurementSourceUrl(classificationNumber: string, procurementNumber: string) {
  const params = new URLSearchParams();
  if (classificationNumber) params.set("goodsClsfcNo", classificationNumber);
  params.set("goodsIdntfcNo", procurementNumber);
  return `https://goods.g2b.go.kr/search/productSearchView.do?${params.toString()}`;
}

export function mapProcurementSearchItem(value: unknown, options: ProcurementSearchMapOptions = {}): ProcurementSearchItem | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const procurementNumber = text(source.prdctIdntNo, 100);
  const catalogueName = text(source.prdctIdntNoNm || source.prdctNm, 300);
  const rawSpecification = text(source.prdctSpecNm, 1_000);
  const name = catalogueName || rawSpecification || text(source.dtilPrdctClsfcNoNm || source.prdctClsfcNoNm, 300);
  if (!procurementNumber || !name) return null;
  const procurementChannel = "G2B";
  const contractEndDate = text(source.cntrctEndDate, 20);
  const classificationNumber = text(source.prdctClsfcNo, 100);
  const classificationSummary = [text(source.dtilPrdctClsfcNoNm, 300), text(source.prdctClsfcNoNm, 300)]
    .filter((entry, index, entries) => entry && entries.indexOf(entry) === index)
    .join(" · ");
  return {
    identity: procurementProductIdentity(procurementChannel, procurementNumber),
    name,
    specification: catalogueName ? rawSpecification : classificationSummary,
    unitPrice: nullableMoney(source.cntrctPrceAmt),
    unit: text(source.prdctUnit, 40),
    supplierName: text(source.cntrctCorpNm, 300),
    manufacturerName: text(source.prdctMakrNm, 300),
    procurementChannel,
    procurementNumber,
    contractMethod: text(source.cntrctMthdNm || options.contractMethod, 160),
    contractNumber: text(source.shopngCntrctNo, 100),
    contractStartDate: text(source.cntrctBgnDate, 20),
    contractEndDate,
    imageUrl: text(source.prdctImgUrl, 1_000),
    classificationNumber,
    classificationName: text(source.prdctClsfcNoNm, 300),
    detailClassificationNumber: text(source.dtilPrdctClsfcNo, 100),
    detailClassificationName: text(source.dtilPrdctClsfcNoNm, 300),
    registrationDate: text(source.rgstDt || source.regDt, 30),
    saleStatus: procurementSaleStatus(source, contractEndDate),
    sourceLabel: text(options.sourceLabel || "나라장터 종합쇼핑몰", 100),
    sourceUrl: procurementSourceUrl(classificationNumber, procurementNumber),
  };
}
