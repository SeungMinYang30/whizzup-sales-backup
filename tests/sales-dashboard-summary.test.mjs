import assert from "node:assert/strict";
import test from "node:test";

import { summarizeSalesDashboard } from "../lib/sales-dashboard-summary.ts";

const rows = [
  { id: 1, organization: "도수초등학교", award_status: "미정", status: "상담 진행", activity_date: "2026-08-12", source_chat: "사이트 AI 입력", activity_type: "영업 방문" },
  { id: 2, organization: "도수초", award_status: "위즈업 수주", status: "납품 완료", activity_date: "2026-08-15", source_chat: "사이트 AI 입력", activity_type: "수주" },
  { id: 3, organization: "명천 실버복지관", award_status: "미정", status: "상담 진행", activity_date: "2026-08-14", source_chat: "사이트 AI 입력", activity_type: "영업 방문" },
];

test("sales summary counts the latest actual activity per canonical institution", () => {
  assert.deepEqual(summarizeSalesDashboard(rows), { total: 2, active: 1, completed: 1 });
});

test("sales summary is independent from API row arrival order", () => {
  assert.deepEqual(summarizeSalesDashboard(rows), summarizeSalesDashboard([...rows].reverse()));
});

test("system-only registration and award-import rows are excluded", () => {
  const systemRows = [
    { id: 10, organization: "기관 원장", activity_date: "2026-08-15", source_chat: "수주 관리 직접 등록", activity_type: "수주 등록" },
    { id: 11, organization: "협력사 원장", activity_date: "2026-08-15", source_chat: "수주업체 관리", activity_type: "협력사 등록" },
  ];
  assert.deepEqual(summarizeSalesDashboard([...rows, ...systemRows]), { total: 2, active: 1, completed: 1 });
});
