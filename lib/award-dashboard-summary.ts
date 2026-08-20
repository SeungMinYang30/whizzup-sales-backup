import { isCompletedAwardStage } from "./sales-taxonomy";
import {
  awardStatusForRecord,
  latestAwardRecords,
} from "./award-state";

export type AwardDashboardSummary = {
  total: number;
  active: number;
  completed: number;
};

type AwardSummaryRecord = {
  id?: unknown;
  organization?: unknown;
  business_round?: unknown;
  award_status?: unknown;
  award_status_explicit?: unknown;
  award_stage?: unknown;
  activity_date?: unknown;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function summarizeWhizzupAwards(
  source: AwardSummaryRecord[],
): AwardDashboardSummary {
  const whizzupAwards = latestAwardRecords(source).filter(
    (record) => awardStatusForRecord(record) === "위즈업 수주",
  );
  const completed = whizzupAwards.filter((record) =>
    isCompletedAwardStage(clean(record.award_stage)),
  ).length;
  return {
    total: whizzupAwards.length,
    active: Math.max(0, whizzupAwards.length - completed),
    completed,
  };
}
