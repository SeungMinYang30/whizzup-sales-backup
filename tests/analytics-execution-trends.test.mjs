import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
    directAmount: 100,
    consortiumAmount: 300,
    directCount: 1,
    consortiumCount: 1,
  });
  assert.deepEqual(result.months[1], {
    month: "02",
    direct: 200,
    consortium: 0,
    total: 200,
    directAmount: 200,
    consortiumAmount: 0,
    directCount: 1,
    consortiumCount: 0,
  });
  assert.deepEqual(result.totals, { direct: 300, consortium: 300, total: 600 });
  assert.equal(result.directRatio, 0.5);
  assert.equal(result.consortiumRatio, 0.5);
  assert.equal(result.totalCount, 3);
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

test("analytics execution panel shows the donut and a single large composition chart", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/analytics-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /className="analytics-execution-donut"/);
  assert.doesNotMatch(page, /className="analytics-execution-line-panel"/);
  assert.doesNotMatch(page, /viewBox="0 0 1200 220"/);
  assert.match(page, /className="analytics-execution-bar-panel primary"/);
  assert.match(styles, /\.analytics-execution-chart\.grouped\s*\{[^}]*height:\s*286px/s);
});

test("analytics uses the final quotation consortium setting for legacy activity rows", async () => {
  const route = await readFile(
    new URL("../app/api/accounting/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    route,
    /finalQuotation\?\.executionType === "컨소" \|\| award\.executionType === "컨소"/,
  );
  assert.match(route, /return \{\s*\.\.\.award,\s*executionType,/s);
});
