import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateCounterpartyCollections,
  automaticCollectionStatus,
  sumReceiptsForPeriod,
  summarizeAwardCollection,
} from "../lib/collection-analytics.ts";

const receipt = (id, amount, collectionDate) => ({
  id,
  amount,
  collectionDate,
});

test("한 수주의 분할 입금은 모두 누적하고 당기는 실제 입금일로만 집계한다", () => {
  const entry = {
    id: 1,
    businessRound: 1,
    activityDate: "2025-12-20",
    organization: "테스트초등학교",
    expectedCommission: 10_000,
    receipts: [
      receipt(1, 3_000, "2026-01-05"),
      receipt(2, 4_000, "2026-02-10"),
    ],
  };
  const summary = summarizeAwardCollection(entry, "2026-02");
  assert.equal(summary.cumulativeCollected, 7_000);
  assert.equal(summary.periodCollected, 4_000);
  assert.equal(summary.outstandingExpected, 3_000);
  assert.equal(summary.status, "일부 수금");
});

test("입금 행이 중복 전달돼도 receipt id 기준으로 한 번만 합산한다", () => {
  const rows = [
    receipt(7, 5_000, "2026-03-01"),
    receipt(7, 5_000, "2026-03-01"),
  ];
  assert.equal(sumReceiptsForPeriod(rows, "2026-03"), 5_000);
});

test("미수·일부 수금·완료·초과 수금·기준금액 미확정을 자동 판정한다", () => {
  assert.equal(automaticCollectionStatus(10_000, 0), "미수");
  assert.equal(automaticCollectionStatus(10_000, 1), "일부 수금");
  assert.equal(automaticCollectionStatus(10_000, 10_000), "수금 완료");
  assert.equal(automaticCollectionStatus(10_000, 12_000), "수금 완료");
  assert.equal(automaticCollectionStatus(0, 0), "기준금액 미확정");
  assert.equal(automaticCollectionStatus(0, 3_000), "기준금액 미확정");
});

test("기관 별칭과 여러 수주 차수는 거래처 한 곳으로 합산하고 상세는 분리한다", () => {
  const rows = aggregateCounterpartyCollections(
    [
      {
        id: 11,
        businessKey: "성남초등학교병설유치원\u001f1",
        businessRound: 1,
        activityDate: "2026-05-17",
        organization: "성남초 병설유치원",
        expectedCommission: 5_000,
        receipts: [receipt(11, 2_000, "2026-05-20")],
      },
      {
        id: 12,
        businessKey: "성남초등학교병설유치원\u001f2",
        businessRound: 2,
        activityDate: "2026-07-22",
        organization: "성남초등학교 병설유치원",
        expectedCommission: 7_000,
        receipts: [receipt(12, 7_000, "2026-07-30")],
      },
    ],
    "2026-07",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].organization, "성남초등학교 병설유치원");
  assert.equal(rows[0].awards.length, 2);
  assert.equal(rows[0].expectedRevenue, 12_000);
  assert.equal(rows[0].periodCollected, 7_000);
  assert.equal(rows[0].cumulativeCollected, 9_000);
  assert.equal(rows[0].outstandingExpected, 3_000);
  assert.equal(rows[0].status, "일부 수금");
});

test("거래처 수주 중 기준금액 미확정 건이 있으면 합계 상태도 확정하지 않는다", () => {
  const [row] = aggregateCounterpartyCollections([
    {
      id: 21,
      businessRound: 1,
      organization: "기준테스트기관",
      expectedCommission: 10_000,
      receipts: [receipt(21, 10_000, "2026-01-01")],
    },
    {
      id: 22,
      businessRound: 2,
      organization: "기준테스트기관",
      expectedCommission: 0,
      receipts: [],
    },
  ]);
  assert.equal(row.status, "기준금액 미확정");
  assert.equal(row.outstandingExpected, null);
  assert.equal(row.unknownBasisCount, 1);
});

test("공사 손실이 입금 예정액을 초과한 건은 미확정이 아닌 지급 검토로 분리한다", () => {
  const [row] = aggregateCounterpartyCollections([
    {
      id: 31,
      businessRound: 1,
      organization: "공사정산기관",
      expectedCommission: 0,
      expectedSettlementDeficit: 2_000,
      receipts: [],
    },
  ]);

  assert.equal(row.expectedRevenue, 0);
  assert.equal(row.settlementDeficit, 2_000);
  assert.equal(row.outstandingExpected, 0);
  assert.equal(row.status, "지급 검토");
  assert.equal(row.unknownBasisCount, 0);
  assert.equal(row.awards[0].status, "지급 검토");
});

test("지급 검토 수주가 같은 기관의 확정 수금을 기준금액 미확정으로 만들지 않는다", () => {
  const [row] = aggregateCounterpartyCollections([
    {
      id: 41,
      businessRound: 1,
      organization: "혼합정산기관",
      expectedCommission: 10_000,
      receipts: [receipt(41, 4_000, "2026-07-01")],
    },
    {
      id: 42,
      businessRound: 2,
      organization: "혼합정산기관",
      expectedCommission: 0,
      expectedSettlementDeficit: 3_000,
      receipts: [],
    },
  ]);

  assert.equal(row.expectedRevenue, 10_000);
  assert.equal(row.settlementDeficit, 3_000);
  assert.equal(row.outstandingExpected, 6_000);
  assert.equal(row.status, "지급 검토");
  assert.equal(row.unknownBasisCount, 0);
});
