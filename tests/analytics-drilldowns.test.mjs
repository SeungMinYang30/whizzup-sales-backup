import assert from "node:assert/strict";
import test from "node:test";
import { groupAnalyticsProductsByBusiness } from "../lib/analytics-drilldowns.ts";

test("vendor delivery items are grouped once per institution business round", () => {
  const rows = [
    {
      businessKey: "보성장애인복지관\u001f1",
      activityDate: "2026-07-23",
      productName: "가상스포츠시스템",
    },
    {
      businessKey: "보성장애인복지관\u001f1",
      activityDate: "2026-07-23",
      productName: "3X비전센서",
    },
    {
      businessKey: "보성장애인복지관\u001f1",
      activityDate: "2026-07-23",
      productName: "교구 세트",
    },
    {
      businessKey: "사천 스포츠클럽\u001f1",
      activityDate: "2026-06-23",
      productName: "아이핏 전자칠판형",
    },
  ];

  const grouped = groupAnalyticsProductsByBusiness(rows);

  assert.equal(grouped.length, 2);
  assert.deepEqual(
    grouped.map((group) => [group.businessKey, group.rows.length]),
    [
      ["보성장애인복지관\u001f1", 3],
      ["사천 스포츠클럽\u001f1", 1],
    ],
  );
});
