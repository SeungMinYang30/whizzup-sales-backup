import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  campaignBudgetAllocation,
  campaignBudgetDisplayAmount,
  upsertCampaignBudget,
} from "../lib/campaign-budgets.ts";

const card = {
  id: 41,
  budgetType: "스마트 체험교실",
  budgetGroupId: 6,
  budgetMatchStatus: "auto",
  budgetMatchMethod: "selected",
  budgetRequestId: null,
  budgetKind: "purpose",
  budgetAmountMode: "manual",
  defaultBudgetAmount: 58_000_000,
};

test("예산카드 기본금액과 기관 실제금액의 출처를 구분한다", () => {
  const fallback = campaignBudgetAllocation(card);
  assert.equal(fallback.budgetAmount, "58000000");
  assert.equal(fallback.budgetAmountSource, "campaign:41");
  assert.equal(fallback.budgetAmountOverride, "");

  const actual = campaignBudgetAllocation(card, 63_000_000);
  assert.equal(actual.budgetAmount, "63000000");
  assert.equal(actual.budgetAmountSource, "manual");
  assert.equal(actual.budgetAmountOverride, "63000000");
});

test("같은 사업 차수에 새 카드 예산을 추가해도 기존 대표 예산을 보존한다", () => {
  const existing = [
    campaignBudgetAllocation({
      ...card,
      id: 11,
      budgetType: "지능형 과학실",
      budgetGroupId: 3,
      defaultBudgetAmount: 100_000_000,
    }),
  ];
  const merged = upsertCampaignBudget(existing, card);
  assert.deepEqual(
    merged.map((budget) => budget.budgetType),
    ["지능형 과학실", "스마트 체험교실"],
  );
  assert.equal(merged[0].budgetGroupId, 3);
  assert.equal(merged[1].budgetGroupId, 6);
});

test("카드 기본금액 수정은 카드 기본값만 바꾸고 기관 실제금액은 유지한다", () => {
  const previousDefault = campaignBudgetAllocation(card);
  const changedCard = { ...card, defaultBudgetAmount: 60_000_000 };
  const changed = upsertCampaignBudget([previousDefault], changedCard);
  assert.equal(changed[0].budgetAmount, "60000000");
  assert.equal(changed[0].budgetAmountSource, "campaign:41");

  const manual = campaignBudgetAllocation(card, 63_000_000);
  const preserved = upsertCampaignBudget([manual], changedCard);
  assert.equal(preserved[0].budgetAmount, "63000000");
  assert.equal(preserved[0].budgetAmountSource, "manual");
});

test("표시 금액은 기관 상세 입력, 카드 기본금액, 미입력 순으로 결정한다", () => {
  assert.deepEqual(
    campaignBudgetDisplayAmount(campaignBudgetAllocation(card, 63_000_000), card, null),
    { amount: 63_000_000, source: "institution" },
  );
  assert.deepEqual(
    campaignBudgetDisplayAmount(campaignBudgetAllocation(card), card, null),
    { amount: 58_000_000, source: "card-default" },
  );
  assert.deepEqual(
    campaignBudgetDisplayAmount(
      { ...campaignBudgetAllocation(card, 58_000_000), budgetAmountSource: "manual" },
      card,
      58_000_000,
    ),
    { amount: 58_000_000, source: "card-default" },
  );
  assert.deepEqual(
    campaignBudgetDisplayAmount(undefined, { ...card, defaultBudgetAmount: null }, null),
    { amount: null, source: "missing" },
  );
});

test("예산카드 API와 화면은 카드 선등록, 수정, 복수 예산 연결을 제공한다", async () => {
  const [route, map, quotation] = await Promise.all([
    readFile(new URL("../app/api/map/campaigns/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/sales-map.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /cardOnly/);
  assert.match(route, /Number\(budgetMetadata\.budgetGroupId\) !== requestedBudgetGroupId/);
  assert.match(route, /upsertCampaignBudget/);
  assert.match(route, /synchronizeBusinessRoundBudgets/);
  assert.match(route, /action === "update-campaign"/);
  assert.match(map, /예산카드 등록/);
  assert.match(map, /예산카드 수정/);
  assert.match(map, /기관 상세 입력/);
  assert.match(map, /카드 기본금액/);
  assert.match(quotation, /type="checkbox" checked=\{selected\}/);
  assert.match(quotation, /budgetAllocationTotal/);
});
