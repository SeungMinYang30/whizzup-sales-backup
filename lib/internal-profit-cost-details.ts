export type InternalProfitCostCategory = "internal-cost" | "support" | "bypass";

export function internalProfitCostCategoryLabel(category: InternalProfitCostCategory) {
  if (category === "support") return "교구 할인·지원";
  if (category === "bypass") return "콘텐츠 대체";
  return "내부 비용";
}
