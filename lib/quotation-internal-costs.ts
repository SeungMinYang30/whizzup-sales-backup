export type QuotationInternalCostKind = "projector-installation" | "aifit-yoga-mat" | "content-substitution" | "";

export const PROJECTOR_INSTALLATION_COST = 220_000;
export const AIFIT_YOGA_MAT_COST = 300_000;
export const CONTENT_SUBSTITUTION_DEFAULT_EARNING_RATE = 0.5;

type ContentSubstitutionRateInput = {
  earningRate?: number;
  internalCostBaseEarningRate?: number;
};

function safeRate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
}

/** 콘텐츠 대체비용을 켜기 전의 실제 수수료율을 복구합니다. */
export function contentSubstitutionBaseEarningRate(item: ContentSubstitutionRateInput) {
  if (Number.isFinite(Number(item.internalCostBaseEarningRate))) {
    return safeRate(item.internalCostBaseEarningRate);
  }
  const currentRate = safeRate(item.earningRate);
  // 구버전에서 사용자가 바이패스를 표현하려고 100%로 저장한 콘텐츠는 기존 기본 50%로 복구합니다.
  return currentRate >= 0.999999 ? CONTENT_SUBSTITUTION_DEFAULT_EARNING_RATE : currentRate;
}

/**
 * 콘텐츠 판매금액 중 대체비용으로 쓰지 않은 잔액에 원래 수수료율만 적용합니다.
 * 대체비용이 판매금액보다 크면 음수 마진을 그대로 보존합니다.
 */
export function contentSubstitutionMargin(lineAmount: number, replacementCost: number, baseRate: number) {
  const raw = (Math.max(0, Number(lineAmount) || 0) - Math.max(0, Number(replacementCost) || 0)) * safeRate(baseRate);
  return Math.trunc(raw / 10) * 10;
}

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
