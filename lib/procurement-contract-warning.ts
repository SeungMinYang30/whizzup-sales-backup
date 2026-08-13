export const PROCUREMENT_CONTRACT_WARNING_THRESHOLD = 100_000_000;
export const DIRECT_PURCHASE_WARNING_THRESHOLD = 22_000_000;

export type ProcurementContractWarningItem = {
  contractType?: string;
  procurement?: boolean;
  procurementChannel?: string;
  supplierVendorId?: number | null;
  supplierVendorName?: string;
  productId?: string;
  quantity: number;
  unitPrice: number;
  complimentary?: boolean;
};

export type ProcurementContractWarning = {
  key: string;
  vendorName: string;
  totalAmount: number;
  itemCount: number;
  unspecified: boolean;
  channelGroup: "general" | "digital-service";
  channelLabel: string;
};

export type DirectPurchaseLimitWarning = {
  totalAmount: number;
  itemCount: number;
  threshold: number;
};

function normalizedChannel(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function procurementChannelGroup(item: ProcurementContractWarningItem) {
  return normalizedChannel(item.procurementChannel).includes("디지털서비스몰")
    ? { channelGroup: "digital-service" as const, channelLabel: "디지털서비스몰" }
    : { channelGroup: "general" as const, channelLabel: "일반 조달" };
}

function isG2bContract(item: ProcurementContractWarningItem) {
  if (item.contractType) return item.contractType === "g2b";
  return item.procurement === true && !/^S\s*2\s*B$/iu.test(String(item.procurementChannel ?? "").trim());
}

export function procurementContractWarnings(items: ProcurementContractWarningItem[]) {
  const groups = new Map<string, ProcurementContractWarning>();
  for (const item of items) {
    if (item.complimentary) continue;
    if (!isG2bContract(item)) continue;
    const { channelGroup, channelLabel } = procurementChannelGroup(item);
    const supplierVendorId = Number(item.supplierVendorId);
    const supplierVendorName = String(item.supplierVendorName ?? "").trim();
    const unspecified = !(Number.isSafeInteger(supplierVendorId) && supplierVendorId > 0) && !supplierVendorName;
    const supplierKey = unspecified
      ? "supplier:unspecified"
      : Number.isSafeInteger(supplierVendorId) && supplierVendorId > 0
        ? `supplier:${supplierVendorId}`
        : `supplier-name:${supplierVendorName.normalize("NFKC").toLocaleLowerCase("ko-KR")}`;
    const key = `${supplierKey}:channel:${channelGroup}`;
    const current = groups.get(key) ?? {
      key,
      vendorName: unspecified ? "공급처 미지정" : supplierVendorName || `공급처 #${supplierVendorId}`,
      totalAmount: 0,
      itemCount: 0,
      unspecified,
      channelGroup,
      channelLabel,
    };
    current.totalAmount += Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unitPrice) || 0);
    current.itemCount += 1;
    groups.set(key, current);
  }
  return Array.from(groups.values())
    .filter((group) => group.unspecified || group.totalAmount >= PROCUREMENT_CONTRACT_WARNING_THRESHOLD)
    .sort((left, right) => Number(right.unspecified) - Number(left.unspecified) || right.totalAmount - left.totalAmount);
}

function isConstructionItem(item: ProcurementContractWarningItem) {
  return item.productId === "__construction_cost__";
}

function isDirectPurchaseItem(item: ProcurementContractWarningItem) {
  if (item.complimentary) return false;
  if (isConstructionItem(item)) return false;
  if (item.contractType === "direct" || item.contractType === "s2b") return true;
  if (item.contractType === "g2b") return false;
  if (item.procurement !== true) return true;
  return /^s\s*2\s*b$/iu.test(String(item.procurementChannel ?? "").trim());
}

export function directPurchaseLimitWarning(items: ProcurementContractWarningItem[]): DirectPurchaseLimitWarning | null {
  const eligible = items.filter(isDirectPurchaseItem);
  const totalAmount = eligible.reduce(
    (sum, item) => sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unitPrice) || 0),
    0,
  );
  return totalAmount > DIRECT_PURCHASE_WARNING_THRESHOLD
    ? { totalAmount, itemCount: eligible.length, threshold: DIRECT_PURCHASE_WARNING_THRESHOLD }
    : null;
}
