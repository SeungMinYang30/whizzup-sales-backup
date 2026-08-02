export const ACTIVITY_TYPE_OPTIONS = [
  "TM·통화",
  "미팅·방문",
  "문자·메일",
  "기타",
] as const;

export const SALES_PROGRESS_OPTIONS = [
  "신규 접촉",
  "상담 진행",
  "제안·견적",
  "결과 대기",
  "재영업 상담",
  "사후관리",
  "수주 전환",
  "영업 종료",
] as const;

export const AWARD_STAGE_OPTIONS = [
  "미정",
  "협상",
  "계약",
  "일정 조율",
  "설치·공사 진행",
  "검수·교육 진행",
  "납품 완료",
] as const;

export const COMPLETED_AWARD_STAGE = "납품 완료";

export function normalizeActivityType(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (/미팅|방문|대면|실측/.test(normalized)) return "미팅·방문";
  if (/문자|메일|이메일|자료\s*발송|발송/.test(normalized)) return "문자·메일";
  if (/TM|통화|전화|유선/.test(normalized)) return "TM·통화";
  return "기타";
}

export function normalizeAwardStage(
  value: unknown,
  awardStatus?: unknown,
) {
  if (String(awardStatus ?? "").trim() === "타업체 수주") return "해당 없음";
  const normalized = String(value ?? "").trim();
  if (normalized === "품의") return "협상";
  if (normalized === "타업체 수주 종료") return "해당 없음";
  if (normalized === "완공") return COMPLETED_AWARD_STAGE;
  if (normalized === "검수" || normalized === "교육") {
    return "검수·교육 진행";
  }
  return (AWARD_STAGE_OPTIONS as readonly string[]).includes(normalized)
    ? normalized
    : "미정";
}

export function isCompletedAwardStage(value: unknown) {
  return normalizeAwardStage(value) === COMPLETED_AWARD_STAGE;
}

export function normalizeSalesProgress(
  value: unknown,
  awardStatus?: unknown,
) {
  const normalized = String(value ?? "").trim();
  const award = String(awardStatus ?? "").trim();
  if (award === "타업체 수주") return "영업 종료";
  if ((SALES_PROGRESS_OPTIONS as readonly string[]).includes(normalized)) {
    return normalized;
  }
  if (award === "위즈업 수주" || award === "협력사 수주") {
    return "수주 전환";
  }
  if (/견적|제안/.test(normalized)) return "제안·견적";
  if (/결과|확인/.test(normalized)) return "결과 대기";
  if (/재영업/.test(normalized)) return "재영업 상담";
  if (/사후|AS|교육|점검|유지/.test(normalized)) return "사후관리";
  if (/종료|완료/.test(normalized)) return "영업 종료";
  if (/재접촉|신규/.test(normalized)) return "신규 접촉";
  return "상담 진행";
}

export function isActivePreAwardProgress(value: unknown) {
  return [
    "신규 접촉",
    "상담 진행",
    "제안·견적",
    "결과 대기",
    "재영업 상담",
  ].includes(String(value ?? ""));
}
