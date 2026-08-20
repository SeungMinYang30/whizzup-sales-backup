type CatalogSupplier = {
  id: string;
  name: string;
  specification: string;
  supplyType: "partner" | "direct";
  supplierVendorId?: number | null;
  supplierVendorName?: string;
  procurementNumber?: string;
};

type QuotationSupplierItem = {
  productId: string;
  name: string;
  specification: string;
  procurementNumber: string;
  supplyType: "partner" | "direct";
  supplierVendorId?: number | null;
  supplierVendorName?: string;
};

function normalizedText(value: string) {
  return value.normalize("NFKC").replace(/\s/g, "").toLocaleLowerCase("ko-KR");
}

function procurementDigits(value: string) {
  const groups = value.match(/\d{6,}/g) ?? [];
  return groups.at(-1) ?? "";
}

function uniqueMatch<T>(rows: T[]) {
  return rows.length === 1 ? rows[0] : undefined;
}

export function findCatalogSupplier<T extends CatalogSupplier>(
  item: Pick<QuotationSupplierItem, "productId" | "name" | "specification" | "procurementNumber">,
  products: T[],
) {
  const byId = item.productId
    ? products.find((product) => product.id === item.productId)
    : undefined;
  if (byId) return byId;

  const itemProcurementNumber = procurementDigits(item.procurementNumber);
  if (itemProcurementNumber) {
    const byProcurementNumber = uniqueMatch(products.filter(
      (product) => procurementDigits(product.procurementNumber ?? "") === itemProcurementNumber,
    ));
    if (byProcurementNumber) return byProcurementNumber;
  }

  const name = normalizedText(item.name);
  const specification = normalizedText(item.specification);
  if (!name || !specification) return undefined;
  return uniqueMatch(products.filter(
    (product) => normalizedText(product.name) === name
      && normalizedText(product.specification) === specification,
  ));
}

export function applyCatalogSuppliers<
  TItem extends QuotationSupplierItem,
  TProduct extends CatalogSupplier,
>(items: TItem[], products: TProduct[]) {
  return items.map((item) => {
    const product = findCatalogSupplier(item, products);
    if (!product) return item;
    if (product.supplyType === "direct") {
      return {
        ...item,
        supplyType: "direct" as const,
        supplierVendorId: null,
        supplierVendorName: "",
      };
    }
    return {
      ...item,
      supplyType: "partner" as const,
      supplierVendorId: product.supplierVendorId ?? null,
      supplierVendorName: product.supplierVendorName?.trim() ?? "",
    };
  });
}
