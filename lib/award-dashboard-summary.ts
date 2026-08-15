import { institutionAliasKey } from "./institution-names";
import { isCompletedAwardStage } from "./sales-taxonomy";

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
  award_stage?: unknown;
  activity_date?: unknown;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Produces the dashboard count from the complete award history rather than the
 * compact dashboard record scope. The latest non-pending result per canonical
 * institution and business round wins, matching the post-award list.
 */
export function summarizeWhizzupAwards(
  source: AwardSummaryRecord[],
): AwardDashboardSummary {
  const latestByBusiness = new Map<string, AwardSummaryRecord>();
  [...source]
    .sort((left, right) => {
      const dateOrder = clean(right.activity_date).localeCompare(
        clean(left.activity_date),
      );
      if (dateOrder) return dateOrder;
      return Number(right.id || 0) - Number(left.id || 0);
    })
    .forEach((record) => {
      const organizationKey = institutionAliasKey(clean(record.organization));
      const awardStatus = clean(record.award_status) || "미정";
      const businessRound = Math.max(1, Number(record.business_round) || 1);
      const businessKey = `${organizationKey}::${businessRound}`;
      if (
        !organizationKey ||
        awardStatus === "미정" ||
        latestByBusiness.has(businessKey)
      ) {
        return;
      }
      latestByBusiness.set(businessKey, record);
    });

  const whizzupAwards = [...latestByBusiness.values()].filter(
    (record) => clean(record.award_status) === "위즈업 수주",
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
