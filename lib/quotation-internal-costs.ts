export type QuotationInternalCostKind = "projector-installation" | "aifit-yoga-mat" | "";

export const PROJECTOR_INSTALLATION_COST = 220_000;
export const AIFIT_YOGA_MAT_COST = 300_000;

export function quotationInternalCostKind(name: string, specification = ""): QuotationInternalCostKind {
  const value = `${name} ${specification}`.normalize("NFKC").toLocaleLowerCase("ko-KR");
  if (/아이\s*핏|a\s*i\s*fit/iu.test(value)) return "aifit-yoga-mat";
  if (/빔\s*프로젝터|비디오\s*프로젝터|projector/iu.test(value)) return "projector-installation";
  return "";
}

export function quotationInternalCostDefaults(name: string, specification = "") {
  const kind = quotationInternalCostKind(name, specification);
  if (kind === "projector-installation") {
    return { kind, enabled: true, amount: PROJECTOR_INSTALLATION_COST, label: "빔프로젝터 설치비" } as const;
  }
  if (kind === "aifit-yoga-mat") {
    return { kind, enabled: false, amount: AIFIT_YOGA_MAT_COST, label: "요가매트 서비스 제공" } as const;
  }
  return { kind, enabled: false, amount: 0, label: "" } as const;
}
