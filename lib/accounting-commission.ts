export type CommissionEntryCalculationInput = {
  executionType: "직영" | "컨소";
  commissionSalesAmount: number;
  commissionCollectedAmount: number;
  directCost: number;
  consortiumSettlementConfirmed: number;
  consortiumPaidAmount: number;
};

function safeAmount(value: unknown) {
  const parsed = Math.round(Number(value ?? 0));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function calculateCommissionEntry(
  input: CommissionEntryCalculationInput,
) {
  const commissionSalesAmount = safeAmount(input.commissionSalesAmount);
  const commissionCollectedAmount = safeAmount(
    input.commissionCollectedAmount,
  );
  const directCost = safeAmount(input.directCost);
  const consortiumSettlementConfirmed =
    input.executionType === "컨소"
      ? safeAmount(input.consortiumSettlementConfirmed)
      : 0;
  const consortiumPaidAmount =
    input.executionType === "컨소" ? safeAmount(input.consortiumPaidAmount) : 0;
  return {
    receivableBalance: Math.max(
      0,
      commissionSalesAmount - commissionCollectedAmount,
    ),
    consortiumPayable: Math.max(
      0,
      consortiumSettlementConfirmed - consortiumPaidAmount,
    ),
    contributionMargin:
      commissionSalesAmount - consortiumSettlementConfirmed - directCost,
  };
}

const knownManufacturers = [
  "투핸즈인터랙티브",
  "메이커스테크놀로지",
  "에스엠메이커스",
  "컴버스테크",
  "하다퓨처스",
  "국제파크골프",
  "가이드삼정",
  "다해씨앤씨",
  "메타에듀시스",
  "마이베네핏",
  "쓰리디뱅크",
  "올댓비젼",
  "아바비젼",
  "에어패스",
  "트리엠",
  "단테크",
  "아이터치",
  "럭스로보",
  "위즈업",
];

function cleanManufacturer(value: string) {
  return value
    .replace(/^(?:주식회사|\(주\)|㈜)\s*/u, "")
    .replace(/\s+(?:디지털서비스몰|혁신장터|나라장터).*$/u, "")
    .trim();
}

export function inferManufacturerName({
  catalogNote,
  specification,
  productName,
}: {
  catalogNote?: unknown;
  specification?: unknown;
  productName?: unknown;
}) {
  const source = `${String(catalogNote ?? "")} ${String(
    specification ?? "",
  )} ${String(productName ?? "")}`.trim();
  const known = knownManufacturers.find((name) => source.includes(name));
  if (known) return known;
  const note = String(catalogNote ?? "").trim();
  const beforeMarketplace = note
    .split(/\b(?:G2B|S2B)\b|디지털서비스몰|혁신장터|물품수의/u)[0]
    .trim();
  const cleaned = cleanManufacturer(beforeMarketplace);
  if (
    cleaned &&
    cleaned.length <= 40 &&
    !/^\d+$/.test(cleaned) &&
    !/^수의계약$/u.test(cleaned)
  ) {
    return cleaned;
  }
  return "제조사 미등록";
}

export function manufacturerKey(name: string) {
  const normalized = name
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "manufacturer-unassigned";
}
