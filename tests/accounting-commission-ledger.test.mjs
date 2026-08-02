import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("수수료 전표는 기관과 사업 차수가 같은 활동을 수주 한 건으로 저장한다", () => {
  const route = source("../app/api/accounting/entries/route.ts");
  const store = source("../lib/accounting-store.ts");
  assert.match(route, /const ACCOUNTING_TOTAL_KEY = "award-total"/);
  assert.match(route, /completedWhizzupAwardRows\(activityResult\.results\)/);
  assert.match(route, /businessKey: source\.businessKey/);
  assert.match(route, /groupedActivityIds: source\.groupedActivityIds/);
  assert.match(route, /consolidateEntriesByBusinessRound/);
  assert.match(route, /source\.items/);
  assert.match(route, /source\.expectedCommission/);
  assert.doesNotMatch(route, /inferManufacturerName|manufacturerKey\(/);
  assert.match(store, /UNIQUE\(activity_id, manufacturer_key\)/);
  assert.match(store, /completedAwardByBusiness/);
});

test("수금 대상은 납품 완료 처리된 위즈업 수주만 허용한다", () => {
  const route = source("../app/api/accounting/entries/route.ts");
  assert.match(route, /requireMemberPermission\("accounting:manage"\)/);
  assert.match(route, /completedWhizzupAwardRows\(activityResult\.results\)/);
  assert.match(route, /const eligibleEntry = entries\.find/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
});

test("실제 수금은 누적 저장하고 예상 수수료와의 차액을 자동 계산한다", () => {
  const route = source("../app/api/accounting/entries/route.ts");
  assert.match(route, /INSERT INTO accounting_collection_receipts/);
  assert.match(route, /COALESCE\(SUM\(amount\), 0\) AS collected_amount/);
  assert.match(
    route,
    /source\.expectedCollectionTotal - collectedAmount/,
  );
  assert.match(
    route,
    /calculateAwardSettlementProjection\(\{[\s\S]*expectedPartnerCommission: source\.expectedPartnerCommission,[\s\S]*expectedDirectSalesCollection: source\.expectedDirectSalesCollection,[\s\S]*expectedDirectMargin: source\.expectedDirectMargin,[\s\S]*expectedConstructionMargin: source\.expectedConstructionMargin,[\s\S]*expectedConsortiumSettlement: source\.expectedConsortiumSettlement/,
  );
  assert.match(
    route,
    /source\.expectedCollectionTotal = projection\.expectedCollectionTotal/,
  );
  assert.match(
    route,
    /source\.expectedProfit = projection\.expectedProfit/,
  );
  assert.match(route, /export async function DELETE/);
  assert.match(route, /DELETE FROM accounting_collection_receipts WHERE id = \?/);
});

test("협력사 수수료와 직접공급 판매대금·마진은 한 원장에서 구분 계산한다", () => {
  const route = source("../app/api/accounting/entries/route.ts");
  assert.match(route, /ei\.supply_type/);
  assert.match(route, /ei\.margin_rate/);
  assert.match(route, /expectedPartnerCommission/);
  assert.match(route, /expectedDirectSalesCollection/);
  assert.match(route, /expectedDirectMargin/);
  assert.match(
    route,
    /calculateAwardSettlementProjection/,
  );
  assert.match(
    route,
    /supplyType === "direct" \? itemFinance\.quotationAmount : 0/,
  );
  assert.doesNotMatch(
    route,
    /expectedCollectionTotal\s*=\s*source\.expectedPartnerCommission\s*\+\s*source\.expectedDirectSalesCollection\s*\+\s*source\.expectedDirectMargin/,
  );
});

test("공사 마진은 정산 후 입금 예정액과 예상수익에 소급 반영한다", () => {
  const route = source("../app/api/accounting/entries/route.ts");
  const page = source("../app/accounting-page.tsx");

  assert.match(route, /calculateConstructionFinance\(\{/);
  assert.match(
    route,
    /source\.expectedConstructionMargin \+=\s*constructionFinance\.constructionMargin/,
  );
  assert.match(
    route,
    /expectedSettlementDeficit: source\.expectedSettlementDeficit/,
  );
  assert.match(
    route,
    /source\.expectedSettlementDeficit > 0\s*\?\s*"지급 검토"/,
  );
  assert.doesNotMatch(
    route,
    /const constructionAmount = Math\.max\(/,
  );
  assert.match(page, /총 입금 예정액/);
  assert.match(page, /공사 마진/);
  assert.match(page, /정산 부족액 · 지급 검토/);
  assert.match(page, /collectionStatusLabel/);
  assert.match(
    page,
    /project\.constructionAmount !== 0 \|\|\s*project\.actualConstructionCost !== 0/,
  );
});

test("직접공급 할인 품목은 음수 견적금액으로 입금 예정액에서 차감한다", () => {
  const route = source("../app/api/accounting/entries/route.ts");
  const analytics = source("../app/api/accounting/route.ts");
  assert.match(
    route,
    /const parsedUnitPrice = Number\(row\.catalog_unit_price \?\? 0\);[\s\S]*Number\.isFinite\(parsedUnitPrice\) \? parsedUnitPrice : 0/,
  );
  assert.match(
    analytics,
    /const parsedUnitPrice = Number\(row\.catalog_unit_price \?\? 0\);[\s\S]*Number\.isFinite\(parsedUnitPrice\) \? parsedUnitPrice : 0/,
  );
  assert.doesNotMatch(
    route,
    /Math\.max\(0, Number\(row\.catalog_unit_price/,
  );
});

test("납품 완료 전 입금 예정은 최신 위즈업 수주만 읽기 전용으로 제공한다", () => {
  const route = source("../app/api/accounting/entries/route.ts");
  assert.match(route, /scope === "upcoming"/);
  assert.match(route, /upcomingWhizzupAwardRows\(activityResult\.results\)/);
  assert.match(route, /upcomingEntries/);
  assert.match(route, /upcomingSummary/);
});

test("수주 목록 배지는 신규 실수금 원장의 권한 범위 조회를 단일 소스로 사용한다", () => {
  const route = source("../app/api/accounting/entries/route.ts");
  const crm = source("../app/crm-app.tsx");
  const visibleReader = route.slice(
    route.indexOf("async function readVisibleEntries"),
    route.indexOf("async function readUpcomingEntries"),
  );
  assert.match(route, /scope === "visible"/);
  assert.match(route, /requireApprovedMember\(\)/);
  assert.match(route, /entry\.progressManager === member\.displayName/);
  assert.match(visibleReader, /accounting_collection_receipts|loadReceipts/);
  assert.doesNotMatch(
    visibleReader,
    /syncTotalEntries|migrateLegacyReceipts|consolidateEntriesByBusinessRound|linkEquipmentProjectsToWhizzupAwards/,
  );
  assert.match(crm, /\/api\/accounting\/entries\?scope=visible/);
  assert.doesNotMatch(crm, /\/api\/accounting\?scope=visible/);
  assert.match(crm, /accountingStatus: entry\.accountingStatus/);
});

test("구형 회계 정산 PUT은 신규 실수금 원장으로 일원화되어 명확히 거부한다", () => {
  const route = source("../app/api/accounting/route.ts");
  const putHandler = route.slice(route.indexOf("export async function PUT"));

  assert.match(putHandler, /^export async function PUT\(\) \{\s*return Response\.json/);
  assert.match(putHandler, /status: 405/);
  assert.match(putHandler, /headers: \{ Allow: "GET" \}/);
  assert.match(putHandler, /구형 회계 정산 저장 기능은 종료되었습니다/);
  assert.doesNotMatch(
    putHandler,
    /request|requireMemberPermission|accounting_settlements|INSERT INTO/,
  );
});

test("회계 화면은 실제 수금에 필요한 최소 입력과 네 개의 내부 화면만 제공한다", () => {
  const page = source("../app/accounting-page.tsx");
  for (const label of [
    "입금 예정",
    "수금·채권 관리",
    "실제 수금 입력",
    "등록 견적 기준 계약금액",
    "견적 미등록",
    "견적 금액 확인 필요",
    "현재 입력 합계",
    "실제 수금액",
    "수금일",
    "미수수익 예상액",
    "예상 공헌이익",
    "차이 메모 (선택)",
    "수금 내역 추가",
    "거래처별 채권",
    "수금 분석",
  ]) {
    assert.match(page, new RegExp(label.replace(/[()]/g, "\\$&")));
  }
  for (const removed of [
    "수수료 매출 인식일",
    "수수료 세금계산서 발행 상태",
    "세금계산서 발행일",
    "회계 처리 상태",
    "건별 직접비",
    "증빙 확인 완료",
  ]) {
    assert.doesNotMatch(page, new RegExp(removed));
  }
});

test("회계 화면은 등록 견적 완성 상태에 따라 계약금액과 확인 안내를 구분한다", () => {
  const page = source("../app/accounting-page.tsx");

  assert.match(page, /type RegisteredQuoteStatus = "complete" \| "partial" \| "missing"/);
  assert.match(page, /entry\.quoteStatus === "missing"/);
  assert.match(page, /entry\.quoteStatus === "partial"/);
  assert.match(page, /현재 입력 합계 \{formatMoney\(entry\.contractAmountReference\)\}/);
  assert.match(page, /<RegisteredQuoteContractAmount entry=\{entry\} \/>/);
  assert.match(page, /<RegisteredQuoteContractAmount entry=\{selectedEntry\} \/>/);
  assert.doesNotMatch(page, /전체 계약금액\(참고\)/);
});

test("영업·품목·공사비와 컨소 계산값은 읽기 전용으로 자동 연결한다", () => {
  const page = source("../app/accounting-page.tsx");
  const route = source("../app/api/accounting/entries/route.ts");
  assert.match(page, /납품 완료 처리된 위즈업 수주의 계산값을 자동 연결했습니다/);
  assert.match(page, /selectedEntry\.sourceItems/);
  assert.match(page, /selectedEntry\.sourceProjects/);
  assert.match(page, /selectedEntry\.executionType === "컨소"/);
  assert.match(page, /컨소 업체명/);
  assert.doesNotMatch(page, /selectedEntry\.manufacturerName/);
  assert.match(route, /a\.progress_manager/);
  assert.match(route, /ep\.construction_amount/);
  assert.match(route, /ei\.commission_rate/);
  assert.match(route, /expectedConsortiumSettlement/);
  assert.match(route, /equipmentSettlementQuantity/);
  assert.match(route, /estimatedContractAmount/);
});

test("계약금액은 예산이 아니라 등록 품목 견적과 견적 공사비만 소급 합산한다", () => {
  const entriesRoute = source("../app/api/accounting/entries/route.ts");
  const analyticsRoute = source("../app/api/accounting/route.ts");
  const quoteCalculator = source("../lib/registered-quote.ts");

  assert.match(entriesRoute, /calculateRegisteredQuote\(\{/);
  assert.match(entriesRoute, /isRegisteredQuoteItemAmount\(\{/);
  assert.match(entriesRoute, /quoteStatus: source\.quoteStatus/);
  assert.doesNotMatch(entriesRoute, /parseStoredMoney\(row\.budget_amount\)/);
  assert.doesNotMatch(
    entriesRoute,
    /source\.contractAmount \|\| source\.estimatedContractAmount/,
  );
  assert.match(analyticsRoute, /calculateRegisteredQuote\(\{/);
  assert.match(
    analyticsRoute,
    /registeredQuote\.quoteStatus === "complete"[\s\S]*registeredQuote\.contractAmount/,
  );
  assert.doesNotMatch(
    analyticsRoute,
    /parseStoredMoney\(row\.budget_amount\)/,
  );
  assert.match(quoteCalculator, /"complete" \| "partial" \| "missing"/);
});

test("컨소 정산 기준액은 수금 목록에 자동 연동하고 직영 건을 구분한다", () => {
  const page = source("../app/accounting-page.tsx");
  const styles = source("../app/globals.css");
  assert.match(page, /<th>컨소 정산 기준액<\/th>/);
  assert.match(page, /<small>해당 없음<\/small>/);
  assert.match(page, /entry\.executionType === "컨소" \?/);
  assert.match(page, /formatMoney\(entry\.expectedConsortiumSettlement\)/);
  assert.match(page, /item\.executionType === "컨소"/);
  assert.match(styles, /\.accounting-collection-table \.col-consortium/);
  assert.match(styles, /\.accounting-counterparty-table/);
  assert.match(styles, /\.accounting-consortium-cell small/);
});

test("납품 완료 수주의 품목은 제안·수주 구분 없이 입력 수량으로 자동 연결한다", () => {
  const route = source("../app/api/accounting/entries/route.ts");
  const store = source("../lib/accounting-store.ts");
  assert.match(
    route,
    /equipmentSettlementQuantity\(\{/,
  );
  assert.match(route, /installedQty: Number\(row\.installed_qty \?\? 0\)/);
  assert.match(route, /proposedQty: Number\(row\.proposed_qty \?\? 0\)/);
  assert.match(store, /analyticsBusinessRoundKey\(/);
  assert.match(store, /representativeActivityId/);
});

test("수금 내역은 수정과 삭제를 제공하고 삭제 뒤 합계를 다시 계산한다", () => {
  const page = source("../app/accounting-page.tsx");
  const route = source("../app/api/accounting/entries/route.ts");
  assert.match(page, /async function deleteReceipt/);
  assert.match(page, /method: "DELETE"/);
  assert.match(page, /누적 수금액과 미수수익 예상액이 다시 계산됩니다/);
  assert.match(route, /await syncEntryAggregate/);
});

test("회계 입력은 금액·수금일·선택 메모만 유지하고 수금 상태는 자동 계산한다", () => {
  const page = source("../app/accounting-page.tsx");
  const calculator = source("../lib/collection-analytics.ts");
  assert.match(page, /aria-label="실제 수금액"/);
  assert.match(page, /type="date"/);
  assert.match(page, /차이 메모 \(선택\)/);
  assert.match(page, /automaticCollectionStatus/);
  assert.doesNotMatch(page, /수금 상태 선택/);
  assert.doesNotMatch(page, /회계 분류/);
  assert.match(calculator, /"기준금액 미확정"/);
  assert.match(calculator, /"미수"/);
  assert.match(calculator, /"일부 수금"/);
  assert.match(calculator, /"수금 완료"/);
});

test("요약 카드는 목록만 필터링하고 상세 창은 행을 선택할 때만 연다", () => {
  const page = source("../app/accounting-page.tsx");
  assert.match(page, /applyFocus\("needsCollection"\)/);
  assert.match(page, /setFocus\(nextFocus\)/);
  assert.match(page, /listRef\.current\?\.scrollIntoView/);
  assert.doesNotMatch(page, /const firstMatch = entries\.find/);
  assert.doesNotMatch(page, /nextEntries\.find/);
  assert.match(page, /group\.isJointProject[\s\S]*openJointProject\(group, "collections"\)[\s\S]*openEditor\(entry\)/);
  assert.match(page, /전체 보기/);
});

test("수금 내역은 기존 회계 전표와 함께 전체 백업·복구 대상이다", () => {
  const backup = source("../lib/backup-store.ts");
  assert.match(backup, /2026-07-23-accounting-collection-receipts/);
  assert.match(backup, /name: "accounting_commission_entries"/);
  assert.match(backup, /name: "accounting_collection_receipts"/);
  assert.match(backup, /"activity_id",[\s\S]*"organization"/);
  assert.match(backup, /DELETE FROM accounting_collection_receipts/);
  assert.match(backup, /DELETE FROM accounting_commission_entries/);
  assert.match(backup, /"accounting_collection_receipts"/);
});

test("사이트 도입 전 기록은 원본과 수금 내역을 보존한 채 회계 작업에서 숨기고 다시 표시할 수 있다", () => {
  const page = source("../app/accounting-page.tsx");
  const route = source("../app/api/accounting/entries/route.ts");
  const store = source("../lib/accounting-store.ts");
  const backup = source("../lib/backup-store.ts");
  assert.match(page, /사이트 도입 전 기록 숨기기/);
  assert.match(page, /숨긴 기록 포함/);
  assert.match(page, /다시 표시/);
  assert.match(page, /원본과 실수금 내역은 그대로 보존/);
  assert.match(page, /회계 기본 작업목록과 요약 합계에서만 제외/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /workflow_excluded = 1/);
  assert.match(route, /workflow_excluded = 0/);
  assert.match(store, /workflow_excluded INTEGER DEFAULT 0/);
  assert.match(backup, /"workflow_excluded"/);
});

test("회계와 통계의 표·그래프 보조 글자는 읽기 가능한 크기로 표시한다", () => {
  const styles = source("../app/globals.css");
  assert.match(styles, /\.analytics-trend-item > header strong[^}]*font-size: 14px/);
  assert.match(styles, /\.analytics-bar-row strong[^}]*font-size: 13px/);
  assert.match(styles, /\.analytics-product-table-wrap td[^}]*font-size: 13px/);
  assert.match(styles, /\.accounting-panel-heading p,[\s\S]*font-size: 14px/);
  assert.match(styles, /max-width: 1540px/);
  assert.match(styles, /\.accounting-collection-table \.col-organization/);
});
