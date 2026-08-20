import { institutionAliasKey } from "./institution-names.ts";

export type SalesDashboardSummary = {
  total: number;
  active: number;
  completed: number;
};

type SalesSummaryRecord = {
  id?: unknown;
  organization?: unknown;
  award_status?: unknown;
  status?: unknown;
  activity_date?: unknown;
  source_chat?: unknown;
  activity_type?: unknown;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isSystemOnlyRecord(record: SalesSummaryRecord) {
  const sourceChat = clean(record.source_chat);
  const activityType = clean(record.activity_type);
  return (
    sourceChat === "영업지도 PDF 가져오기" ||
    sourceChat === "수주 관리 엑셀 등록" ||
    sourceChat === "수주 관리 직접 등록" ||
    sourceChat.startsWith("구글 시트 연동|") ||
    (sourceChat === "수주업체 관리" &&
      ["협력사 등록", "협력사 등록 해제"].includes(activityType))
  );
}

/**
 * Counts only institutions with an actual sales activity. Institution registry
 * rows are deliberately not part of this input, so loading the master registry
 * cannot change the dashboard figures after the first render.
 */
export function summarizeSalesDashboard(
  source: SalesSummaryRecord[],
): SalesDashboardSummary {
  const latestByInstitution = new Map<string, SalesSummaryRecord>();
  [...source]
    .sort((left, right) => {
      const dateOrder = clean(right.activity_date).localeCompare(
        clean(left.activity_date),
      );
      if (dateOrder) return dateOrder;
      return Number(right.id || 0) - Number(left.id || 0);
    })
    .forEach((record) => {
      if (isSystemOnlyRecord(record)) return;
      const institutionKey = institutionAliasKey(clean(record.organization));
      if (!institutionKey || latestByInstitution.has(institutionKey)) return;
      latestByInstitution.set(institutionKey, record);
    });

  const latest = [...latestByInstitution.values()];
  const completed = latest.filter((record) => {
    const awardStatus = clean(record.award_status) || "미정";
    const status = clean(record.status);
    return (
      awardStatus !== "미정" ||
      status.includes("완료") ||
      status.includes("종료")
    );
  }).length;
  return {
    total: latest.length,
    active: Math.max(0, latest.length - completed),
    completed,
  };
}
