export type ProductSupplyType = "partner" | "direct";

// Airpass teaching-aid kits are supplied under the Airpass agreement. They are
// not Whizzup direct-supply products even when the sales contract is private.
const PARTNER_ONLY_PRODUCT_IDS = new Set(["quote-23"]);

function compactProductName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s·ㆍ._()\-]/gu, "")
    .toLocaleLowerCase("ko-KR");
}

export function isPartnerOnlyProduct(input: {
  catalogItemId?: unknown;
  productName?: unknown;
}) {
  const catalogItemId = String(input.catalogItemId ?? "").trim();
  if (PARTNER_ONLY_PRODUCT_IDS.has(catalogItemId)) return true;

  const productName = compactProductName(input.productName);
  return productName.includes("교구세트");
}

export function normalizeProductSupplyType(input: {
  catalogItemId?: unknown;
  productName?: unknown;
  supplyType?: unknown;
}): ProductSupplyType {
  if (isPartnerOnlyProduct(input)) return "partner";
  return input.supplyType === "direct" ? "direct" : "partner";
}
