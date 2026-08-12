export type ExecutionTrendMetric = "amount" | "margin" | "count";

export type ExecutionTrendAward = {
  activityDate: string;
  executionType: "직영" | "컨소";
  confirmed: boolean;
  confirmedAmount: number;
  netRevenue: number;
};

export type ExecutionTrendMonth = {
  month: string;
  direct: number;
  consortium: number;
  total: number;
};

function metricValue(
  row: ExecutionTrendAward,
  metric: ExecutionTrendMetric,
) {
  if (metric === "count") return 1;
  if (metric === "margin") return Number(row.netRevenue) || 0;
  return Number(row.confirmedAmount) || 0;
}

export function buildExecutionTrend(
  rows: ExecutionTrendAward[],
  year: string,
  metric: ExecutionTrendMetric,
) {
  const months: ExecutionTrendMonth[] = Array.from(
    { length: 12 },
    (_, index) => ({
      month: String(index + 1).padStart(2, "0"),
      direct: 0,
      consortium: 0,
      total: 0,
    }),
  );

  rows
    .filter((row) => row.confirmed)
    .filter((row) => row.activityDate.startsWith(`${year}-`))
    .forEach((row) => {
      const monthIndex = Number(row.activityDate.slice(5, 7)) - 1;
      if (monthIndex < 0 || monthIndex > 11) return;
      const value = metricValue(row, metric);
      if (row.executionType === "컨소") months[monthIndex].consortium += value;
      else months[monthIndex].direct += value;
      months[monthIndex].total += value;
    });

  const totals = months.reduce(
    (current, month) => ({
      direct: current.direct + month.direct,
      consortium: current.consortium + month.consortium,
      total: current.total + month.total,
    }),
    { direct: 0, consortium: 0, total: 0 },
  );
  const ratioBase = Math.abs(totals.direct) + Math.abs(totals.consortium);

  return {
    months,
    totals,
    directRatio: ratioBase > 0 ? Math.abs(totals.direct) / ratioBase : 0,
    consortiumRatio:
      ratioBase > 0 ? Math.abs(totals.consortium) / ratioBase : 0,
  };
}
