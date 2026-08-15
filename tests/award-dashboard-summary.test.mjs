import assert from "node:assert/strict";
import test from "node:test";

import { summarizeWhizzupAwards } from "../lib/award-dashboard-summary.ts";

const rows = [
  {
    id: 1,
    organization: "도수초등학교",
    business_round: 1,
    award_status: "위즈업 수주",
    award_stage: "협상",
    activity_date: "2026-08-12",
  },
  {
    id: 2,
    organization: "도수초등학교",
    business_round: 1,
    award_status: "위즈업 수주",
    award_stage: "납품 완료",
    activity_date: "2026-08-15",
  },
  {
    id: 3,
    organization: "명천 실버복지관",
    business_round: 1,
    award_status: "위즈업 수주",
    award_stage: "계약",
    activity_date: "2026-08-14",
  },
  {
    id: 4,
    organization: "협력기관",
    business_round: 1,
    award_status: "협력사 수주",
    award_stage: "납품 완료",
    activity_date: "2026-08-14",
  },
];

test("dashboard award summary is based on the latest full business history", () => {
  assert.deepEqual(summarizeWhizzupAwards(rows), {
    total: 2,
    active: 1,
    completed: 1,
  });
});

test("award summary is independent from API row arrival order", () => {
  assert.deepEqual(
    summarizeWhizzupAwards(rows),
    summarizeWhizzupAwards([...rows].reverse()),
  );
});

test("latest non-pending business result controls the whizzup count", () => {
  const changed = [
    ...rows,
    {
      id: 5,
      organization: "명천 실버복지관",
      business_round: 1,
      award_status: "타업체 수주",
      award_stage: "해당 없음",
      activity_date: "2026-08-16",
    },
  ];
  assert.deepEqual(summarizeWhizzupAwards(changed), {
    total: 1,
    active: 0,
    completed: 1,
  });
});
