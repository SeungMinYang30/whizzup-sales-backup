import assert from "node:assert/strict";
import test from "node:test";

import {
  accountingBusinessTitle,
  groupAccountingJointProjects,
} from "../lib/accounting-joint-projects.ts";
import { aggregateCounterpartyCollections } from "../lib/collection-analytics.ts";

const base = {
  businessRound: 1,
  activityDate: "2026-07-22",
  region: "경남 함양",
  budgetType: "가상현실스포츠실",
  progressManager: "양승민 이사",
  awardStage: "일정 조율",
  contractAmountReference: 50_000_000,
  quoteStatus: "complete",
  quoteItemCount: 1,
  quoteMissingAmountItemCount: 0,
  executionType: "직영",
  consortiumCompany: "",
  sourceItems: [],
  sourceProjects: [],
  expectedPartnerCommission: 12_500_000,
  expectedDirectSalesCollection: 0,
  expectedDirectMargin: 0,
  expectedConstructionMargin: 0,
  expectedCollectionTotal: 12_500_000,
  expectedSettlementDeficit: 0,
  expectedProfit: 12_500_000,
  expectedCommission: 12_500_000,
  expectedConsortiumSettlement: 0,
  expectedContributionMargin: 12_500_000,
  commissionCollectedAmount: 0,
  receivableBalance: 12_500_000,
  collectionDate: "",
  workflowExcluded: false,
  workflowExcludedAt: "",
  confirmed: false,
  accountingStatus: "미수",
  needsCollection: true,
  receipts: [],
  jointProjectId: 71,
  jointProjectName: "함양 가상현실스포츠실 공동사업",
  jointProjectSponsor: "함양군청",
  jointProjectSponsorKey: "함양군청",
  jointProjectRole: "site",
  jointProjectBudgetType: "가상현실스포츠실",
  jointProjectYear: 2026,
  jointProjectRound: 1,
};

function entry(id, organization, overrides = {}) {
  return {
    ...base,
    id,
    activityId: id,
    businessKey: `${organization}\u001f1`,
    organization,
    groupedActivityIds: [id],
    ...overrides,
  };
}

test("입금 예정 공동사업은 납품 전 설치기관만 주관기관 대표 행으로 합산한다", () => {
  const upcoming = [
    entry(101, "함양 항노화 건강 문화활력센터"),
    entry(102, "함양군청-행복안의봄날센터"),
    entry(103, "함양군청", {
      jointProjectRole: "sponsor",
      expectedCollectionTotal: 37_500_000,
      expectedCommission: 37_500_000,
    }),
  ];

  const groups = groupAccountingJointProjects(upcoming);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].isJointProject, true);
  assert.equal(groups[0].representative.organization, "함양군청");
  assert.equal(groups[0].members.length, 2);
  assert.equal(groups[0].representative.expectedCollectionTotal, 25_000_000);
  assert.equal(
    accountingBusinessTitle(groups[0].representative),
    "가상현실스포츠실 · 공동사업 1차",
  );
});

test("수금·채권 공동사업은 납품 완료 범위의 설치기관과 기존 입금만 유지한다", () => {
  const completed = [
    entry(201, "경상남도 함양군(수동면 생기발랄복지센터)", {
      commissionCollectedAmount: 12_500_000,
      receivableBalance: 0,
      accountingStatus: "수금 완료",
      needsCollection: false,
      receipts: [
        { id: 901, amount: 12_500_000, collectionDate: "2026-07-28" },
      ],
    }),
  ];

  const [group] = groupAccountingJointProjects(completed);
  assert.equal(group.members.length, 1);
  assert.equal(group.representative.organization, "함양군청");
  assert.equal(group.representative.commissionCollectedAmount, 12_500_000);
  assert.equal(group.representative.receivableBalance, 0);
  assert.equal(group.representative.accountingStatus, "수금 완료");
  assert.deepEqual(group.representative.receipts, completed[0].receipts);
});

test("동일 입금 행과 공동사업 주관기관 원본 행은 중복 합산하지 않는다", () => {
  const receipt = { id: 902, amount: 6_000_000, collectionDate: "2026-07-29" };
  const completed = [
    entry(211, "설치기관 A", {
      expectedCollectionTotal: 10_000_000,
      expectedCommission: 10_000_000,
      commissionCollectedAmount: 6_000_000,
      receipts: [receipt],
    }),
    entry(212, "설치기관 B", {
      expectedCollectionTotal: 10_000_000,
      expectedCommission: 10_000_000,
      commissionCollectedAmount: 0,
      receipts: [receipt],
    }),
    entry(213, "함양군청", {
      jointProjectRole: "sponsor",
      expectedCollectionTotal: 20_000_000,
      expectedCommission: 20_000_000,
    }),
  ];

  const [group] = groupAccountingJointProjects(completed);
  assert.equal(group.representative.expectedCollectionTotal, 20_000_000);
  assert.equal(group.representative.receipts.length, 1);
});

test("일반 수주는 그대로 두고 같은 주관기관의 공동사업 1차와 자체예산 2차를 상세에서 분리한다", () => {
  const [joint] = groupAccountingJointProjects([
    entry(301, "수동면 생기발랄복지센터", {
      commissionCollectedAmount: 12_500_000,
      receipts: [
        { id: 903, amount: 12_500_000, collectionDate: "2026-07-28" },
      ],
    }),
  ]);
  const ownBudget = entry(302, "함양군청", {
    businessKey: "함양군청\u001f2",
    businessRound: 2,
    budgetType: "자체예산",
    jointProjectId: null,
    jointProjectRole: "",
    jointProjectSponsor: "",
    jointProjectSponsorKey: "",
    jointProjectBudgetType: "",
    jointProjectRound: null,
    expectedCollectionTotal: 5_000_000,
    expectedCommission: 5_000_000,
  });

  const rows = aggregateCounterpartyCollections([
    joint.representative,
    ownBudget,
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].awards.length, 2);
  assert.deepEqual(
    rows[0].awards.map((award) => accountingBusinessTitle(award.entry)).sort(),
    ["가상현실스포츠실 · 공동사업 1차", "자체예산 · 2차 사업"].sort(),
  );

  const [regular] = groupAccountingJointProjects([ownBudget]);
  assert.equal(regular.isJointProject, false);
  assert.equal(regular.representative, ownBudget);
});
