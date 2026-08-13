export type QuotationInternalCostKind = "projector-installation" | "aifit-yoga-mat" | "content-substitution" | "";

export const PROJECTOR_INSTALLATION_COST = 220_000;
export const AIFIT_YOGA_MAT_COST = 300_000;

function normalizedProductName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

export function isYogaMatEligibleAifitProduct(name: string) {
  const value = normalizedProductName(name);
  return value === "아이핏전자칠판형"
    || value === "아이핏전자칠판형aifit"
    || value === "아이핏슬림형"
    || value === "아이핏슬림형aifit";
}

export function quotationInternalCostKind(name: string, specification = ""): QuotationInternalCostKind {
  const value = `${name} ${specification}`.normalize("NFKC").toLocaleLowerCase("ko-KR");
  if (isYogaMatEligibleAifitProduct(name)) return "aifit-yoga-mat";
  if (/콘텐츠|컨텐츠|contents?/iu.test(value)) return "content-substitution";
  if (/빔\s*프로젝터|비디오\s*프로젝터|projector/iu.test(value)) return "projector-installation";
  return "";
}

export function quotationInternalCostDefaults(name: string, specification = "", quantity = 1) {
  const kind = quotationInternalCostKind(name, specification);
  if (kind === "projector-installation") {
    return {
      kind,
      enabled: true,
      amount: PROJECTOR_INSTALLATION_COST,
      quantity: 1,
      unitAmount: PROJECTOR_INSTALLATION_COST,
      autoQuantity: false,
      label: "빔·비디오프로젝터 설치비",
    } as const;
  }
  if (kind === "aifit-yoga-mat") {
    const safeQuantity = Math.max(1, Math.round(Number(quantity) || 1));
    return {
      kind,
      enabled: true,
      amount: AIFIT_YOGA_MAT_COST * safeQuantity,
      quantity: safeQuantity,
      unitAmount: AIFIT_YOGA_MAT_COST,
      autoQuantity: true,
      label: "요가매트 서비스 제공 비용",
    } as const;
  }
  if (kind === "content-substitution") {
    return {
      kind,
      enabled: false,
      amount: 0,
      quantity: 1,
      unitAmount: 0,
      autoQuantity: false,
      label: "콘텐츠 대체 비용",
    } as const;
  }
  return { kind, enabled: false, amount: 0, quantity: 0, unitAmount: 0, autoQuantity: false, label: "" } as const;
}
