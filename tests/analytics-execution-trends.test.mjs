import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionTrend } from "../lib/analytics-execution-trends.ts";

const rows = [
  {
    activityDate: "2026-01-10",
    executionType: "직영",
    progressManager: "양승민 이사",
    confirmed: true,
    confirmedAmount: 100,
    netRevenue: 30,
  },
  {
    activityDate: "2026-01-20",
    executionType: "컨소",
    progressManager: "양승민 이사",
    confirmed: true,
    confirmedAmount: 300,
    netRevenue: 60,
  },
  {
    activityDate: "2026-02-05",
    executionType: "직영",
    progressManager: "김동훈 과장",
    confirmed: true,
    confirmedAmount: 200,
    netRevenue: 40,
  },
  {
    activityDate: "2025-12-05",
    executionType: "직영",
    progressManager: "양승민 이사",
    confirmed: true,
    confirmedAmount: 999,
    netRevenue: 999,
  },
  {
    activityDate: "2026-03-05",
    executionType: "직영",
    progressManager: "양승민 이사",
    confirmed: false,
    confirmedAmount: 999,
    netRevenue: 999,
  },
];

test("buildExecutionTrend groups confirmed awards by month and execution type", () => {
  const result = buildExecutionTrend(rows, "2026", "amount");
  assert.deepEqual(result.months[0], {
    month: "01",
    direct: 100,
    consortium: 300,
    total: 400,
  });
  assert.deepEqual(result.months[1], {
    month: "02",
    direct: 200,
    consortium: 0,
    total: 200,
  });
  assert.deepEqual(result.totals, { direct: 300, consortium: 300, total: 600 });
  assert.equal(result.directRatio, 0.5);
  assert.equal(result.consortiumRatio, 0.5);
});

test("buildExecutionTrend applies the selected metric", () => {
  const result = buildExecutionTrend(rows, "2026", "margin");
  assert.deepEqual(result.totals, { direct: 70, consortium: 60, total: 130 });
  assert.equal(result.months[1].total, 40);
});

test("buildExecutionTrend counts orders without including unconfirmed rows", () => {
  const result = buildExecutionTrend(rows, "2026", "count");
  assert.deepEqual(result.totals, { direct: 2, consortium: 1, total: 3 });
});
