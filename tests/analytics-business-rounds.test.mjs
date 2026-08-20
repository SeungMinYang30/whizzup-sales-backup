import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./typescript-resolver.mjs", import.meta.url));

const {
  analyticsBusinessRoundKey,
  completedWhizzupAwardRows,
  groupAnalyticsAwardRows,
  upcomingWhizzupAwardRows,
} = await import("../lib/analytics-business-rounds.ts");
const {
  normalizeAwardCompletedDate,
  resolveAwardCompletedDate,
} = await import("../lib/award-completion.ts");

test("같은 기관의 같은 사업 차수는 여러 활동이 있어도 수주 한 건으로 집계한다", () => {
  const grouped = groupAnalyticsAwardRows([
    {
      activity_id: 1,
      activity_date: "2026-05-17",
      organization: "성남초등학교 병설유치원",
      business_round: 1,
      award_stage: "납품 완료",
      award_completed_date: "2026-07-22",
      entry_count: 1,
      commission_collected_amount: 3_000_000,
    },
    {
      activity_id: 2,
      activity_date: "2026-07-22",
      organization: "성남초등학교 병설유치원",
      business_round: 1,
      award_stage: "납품 완료",
      award_completed_date: "2026-07-22",
      entry_count: 0,
      commission_collected_amount: 0,
    },
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].activity_id, 2);
  assert.equal(grouped[0].activity_date, "2026-07-22");
  assert.deepEqual(grouped[0].grouped_activity_ids, [2, 1]);
  assert.equal(grouped[0].commission_collected_amount, 3_000_000);
});

test("과거 완료일이 없는 자료는 같은 차수의 가장 최근 완료 활동일을 사용한다", () => {
  const [grouped] = groupAnalyticsAwardRows([
    {
      activity_id: 10,
      activity_date: "2026-05-17",
      organization: "기관 A",
      business_round: 1,
      award_stage: "납품 완료",
    },
    {
      activity_id: 11,
      activity_date: "2026-07-22",
      organization: "기관 A",
      business_round: 1,
      award_stage: "납품 완료",
    },
  ]);

  assert.equal(grouped.activity_date, "2026-07-22");
});

test("같은 기관이라도 사업 차수가 다르면 별도 수주로 집계한다", () => {
  const grouped = groupAnalyticsAwardRows([
    {
      activity_id: 20,
      activity_date: "2026-07-01",
      organization: "기관 B",
      business_round: 1,
      award_stage: "납품 완료",
    },
    {
      activity_id: 21,
      activity_date: "2027-02-01",
      organization: "기관 B",
      business_round: 2,
      award_stage: "납품 완료",
    },
  ]);

  assert.equal(grouped.length, 2);
  assert.notEqual(
    analyticsBusinessRoundKey("기관 B", 1),
    analyticsBusinessRoundKey("기관 B", 2),
  );
});

test("최신 활동과 회계 전표가 다른 기록에 있어도 한 사업의 회계 상태를 보존한다", () => {
  const [grouped] = groupAnalyticsAwardRows([
    {
      activity_id: 30,
      activity_date: "2026-05-17",
      organization: "기관 C",
      business_round: 1,
      award_stage: "납품 완료",
      settlement_id: 7,
      manufacturer_commission_received: 1_500_000,
      commission_receivable: 500_000,
    },
    {
      activity_id: 31,
      activity_date: "2026-07-22",
      organization: "기관 C",
      business_round: 1,
      award_stage: "납품 완료",
      settlement_id: null,
      manufacturer_commission_received: 0,
      commission_receivable: 0,
    },
  ]);

  assert.equal(grouped.activity_id, 31);
  assert.equal(grouped.settlement_id, 7);
  assert.equal(grouped.manufacturer_commission_received, 1_500_000);
  assert.equal(grouped.commission_receivable, 500_000);
});

test("납품 완료일은 완료 상태에서만 유효한 날짜로 보존한다", () => {
  assert.equal(normalizeAwardCompletedDate("2026-07-22T09:00"), "2026-07-22");
  assert.equal(normalizeAwardCompletedDate("2026/07/22"), "");
  assert.equal(
    resolveAwardCompletedDate({
      awardStage: "납품 완료",
      previousDate: "2026-07-22",
      fallbackDate: "2026-07-25",
    }),
    "2026-07-22",
  );
  assert.equal(
    resolveAwardCompletedDate({
      awardStage: "설치·공사 진행",
      requestedDate: "2026-07-22",
    }),
    "",
  );
});

test("과거 위즈업 수주 뒤 최신 협력사 수주가 있으면 회계 대상에서 제외한다", () => {
  const rows = [
    {
      activity_id: 40,
      activity_date: "2026-07-01",
      organization: "개군초등학교",
      business_round: 1,
      award_status: "위즈업 수주",
      award_stage: "납품 완료",
    },
    {
      activity_id: 41,
      activity_date: "2026-07-20",
      organization: "개군초",
      business_round: 1,
      award_status: "협력사 수주",
      award_stage: "납품 완료",
    },
  ];

  assert.deepEqual(completedWhizzupAwardRows(rows), []);
  assert.deepEqual(upcomingWhizzupAwardRows(rows), []);
});

test("사용자가 최신 활동을 미정으로 저장하면 과거 위즈업 수주는 회계 대상에서 제외한다", () => {
  const rows = [
    {
      activity_id: 45,
      activity_date: "2026-08-13",
      organization: "웨스포어린이집",
      business_round: 1,
      award_status: "위즈업 수주",
      award_stage: "납품 완료",
    },
    {
      activity_id: 46,
      activity_date: "2026-08-20",
      organization: "웨스포어린이집",
      business_round: 1,
      award_status: "미정",
      award_status_explicit: 1,
      award_stage: "미정",
    },
  ];

  assert.deepEqual(completedWhizzupAwardRows(rows), []);
  assert.deepEqual(upcomingWhizzupAwardRows(rows), []);
});

test("과거 협력사 수주 뒤 최신 위즈업 납품 완료면 회계 대상에 포함한다", () => {
  const rows = [
    {
      activity_id: 50,
      activity_date: "2026-07-01",
      organization: "기관 D",
      business_round: 1,
      award_status: "협력사 수주",
      award_stage: "납품 완료",
    },
    {
      activity_id: 51,
      activity_date: "2026-07-20",
      organization: "기관 D",
      business_round: 1,
      award_status: "위즈업 수주",
      award_stage: "납품 완료",
    },
  ];

  const [completed] = completedWhizzupAwardRows(rows);
  assert.equal(completed.activity_id, 51);
  assert.deepEqual(completed.grouped_activity_ids, [51]);
  assert.deepEqual(upcomingWhizzupAwardRows(rows), []);
});

test("과거 협력사 수주의 회계값은 최신 위즈업 수주에 승계하지 않는다", () => {
  const rows = [
    {
      activity_id: 52,
      activity_date: "2026-07-01",
      organization: "기관 D-2",
      business_round: 1,
      award_status: "협력사 수주",
      award_stage: "납품 완료",
      award_completed_date: "2026-07-03",
      settlement_id: 99,
      manufacturer_commission_received: 4_000_000,
    },
    {
      activity_id: 53,
      activity_date: "2026-07-20",
      organization: "기관 D-2",
      business_round: 1,
      award_status: "위즈업 수주",
      award_stage: "납품 완료",
      settlement_id: null,
      manufacturer_commission_received: 0,
    },
  ];

  const [completed] = completedWhizzupAwardRows(rows);
  assert.equal(completed.activity_id, 53);
  assert.equal(completed.activity_date, "2026-07-20");
  assert.deepEqual(completed.grouped_activity_ids, [53]);
  assert.equal(completed.settlement_id, null);
  assert.equal(completed.manufacturer_commission_received, 0);
});

test("위즈업 수주 사이에 협력사 수주가 있으면 과거 위즈업 회계값을 최신 수주에 승계하지 않는다", () => {
  const rows = [
    {
      activity_id: 54,
      activity_date: "2026-07-01",
      organization: "기관 D-3",
      business_round: 1,
      award_status: "위즈업 수주",
      award_stage: "납품 완료",
      settlement_id: 100,
      manufacturer_commission_received: 5_000_000,
    },
    {
      activity_id: 55,
      activity_date: "2026-07-10",
      organization: "기관 D-3",
      business_round: 1,
      award_status: "협력사 수주",
      award_stage: "납품 완료",
    },
    {
      activity_id: 56,
      activity_date: "2026-07-20",
      organization: "기관 D-3",
      business_round: 1,
      award_status: "위즈업 수주",
      award_stage: "납품 완료",
      settlement_id: null,
      manufacturer_commission_received: 0,
    },
  ];

  const [completed] = completedWhizzupAwardRows(rows);
  assert.equal(completed.activity_id, 56);
  assert.deepEqual(completed.grouped_activity_ids, [56]);
  assert.equal(completed.settlement_id, null);
  assert.equal(completed.manufacturer_commission_received, 0);
});

test("최신 미정 활동은 직전 수주 결정을 덮어쓰지 않는다", () => {
  const rows = [
    {
      activity_id: 60,
      activity_date: "2026-07-01",
      organization: "기관 E",
      business_round: 1,
      award_status: "위즈업 수주",
      award_stage: "설치·공사 진행",
    },
    {
      activity_id: 61,
      activity_date: "2026-07-20",
      organization: "기관 E",
      business_round: 1,
      award_status: "미정",
      award_stage: "미정",
    },
  ];

  const [upcoming] = upcomingWhizzupAwardRows(rows);
  assert.equal(upcoming.activity_id, 60);
  assert.deepEqual(completedWhizzupAwardRows(rows), []);
});

test("과거 납품 완료 뒤 다시 진행 중인 최신 위즈업 수주는 최신 활동일로 입금 예정에 표시한다", () => {
  const rows = [
    {
      activity_id: 70,
      activity_date: "2026-06-01",
      award_completed_date: "2026-06-05",
      organization: "기관 F",
      business_round: 1,
      award_status: "위즈업 수주",
      award_stage: "납품 완료",
    },
    {
      activity_id: 71,
      activity_date: "2026-07-28",
      organization: "기관 F",
      business_round: 1,
      award_status: "위즈업 수주",
      award_stage: "설치·공사 진행",
    },
  ];

  const [upcoming] = upcomingWhizzupAwardRows(rows);
  assert.equal(upcoming.activity_id, 71);
  assert.equal(upcoming.activity_date, "2026-07-28");
  assert.deepEqual(completedWhizzupAwardRows(rows), []);
});
