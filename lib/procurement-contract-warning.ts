export const PROCUREMENT_CONTRACT_WARNING_THRESHOLD = 100_000_000;

export type ProcurementContractWarningItem = {
  contractType?: string;
  procurement?: boolean;
  procurementChannel?: string;
  supplierVendorId?: number | null;
  supplierVendorName?: string;
  quantity: number;
  unitPrice: number;
};

export type ProcurementContractWarning = {
  key: string;
  vendorName: string;
  totalAmount: number;
  itemCount: number;
  unspecified: boolean;
};

function isG2bContract(item: ProcurementContractWarningItem) {
  if (item.contractType) return item.contractType === "g2b";
  return item.procurement === true && !/^S\s*2\s*B$/iu.test(String(item.procurementChannel ?? "").trim());
}

export function procurementContractWarnings(items: ProcurementContractWarningItem[]) {
  const groups = new Map<string, ProcurementContractWarning>();
  for (const item of items) {
    if (!isG2bContract(item)) continue;
    const supplierVendorId = Number(item.supplierVendorId);
    const supplierVendorName = String(item.supplierVendorName ?? "").trim();
    const unspecified = !(Number.isSafeInteger(supplierVendorId) && supplierVendorId > 0) && !supplierVendorName;
    const key = unspecified
      ? "supplier:unspecified"
      : Number.isSafeInteger(supplierVendorId) && supplierVendorId > 0
        ? `supplier:${supplierVendorId}`
        : `supplier-name:${supplierVendorName.normalize("NFKC").toLocaleLowerCase("ko-KR")}`;
    const current = groups.get(key) ?? {
      key,
      vendorName: unspecified ? "공급처 미지정" : supplierVendorName || `공급처 #${supplierVendorId}`,
      totalAmount: 0,
      itemCount: 0,
      unspecified,
    };
    current.totalAmount += Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unitPrice) || 0);
    current.itemCount += 1;
    groups.set(key, current);
  }
  return Array.from(groups.values())
    .filter((group) => group.unspecified || group.totalAmount >= PROCUREMENT_CONTRACT_WARNING_THRESHOLD)
    .sort((left, right) => Number(right.unspecified) - Number(left.unspecified) || right.totalAmount - left.totalAmount);
}
