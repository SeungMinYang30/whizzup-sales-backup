function compactImportedEquipmentName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(
      /설치\s*완료|시공\s*완료|납품\s*완료|설치|시공|납품|교체|철거|작업|예정|완료|공사/g,
      "",
    )
    .replace(/[^0-9a-z가-힣]/g, "");
}

export type ImportedEquipmentItem = {
  productName: string;
  quantity: number;
  unit: string;
};

export function parseImportedEquipmentItems(value: unknown) {
  const grouped = new Map<string, ImportedEquipmentItem>();
  String(value ?? "")
    .normalize("NFKC")
    .split(/[\n,;]+/)
    .map((item) => item.replace(/^[•·\-]\s*/, "").trim())
    .filter(Boolean)
    .forEach((item) => {
      const quantityMatch = item.match(
        /^(.+?)\s*(?:[xX×*]\s*)?(\d+)\s*(대|개|식|세트|조|권|면|본|㎡|m2)?$/u,
      );
      const productName = (quantityMatch?.[1] ?? item).trim();
      const quantity = Math.max(1, Number(quantityMatch?.[2]) || 1);
      const unit = (quantityMatch?.[3] || "대").replace(/^m2$/i, "㎡");
      const key = compactImportedEquipmentName(productName);
      if (!key) return;
      const current = grouped.get(key);
      if (current) {
        current.quantity += quantity;
        return;
      }
      grouped.set(key, { productName, quantity, unit });
    });
  return [...grouped.values()];
}
