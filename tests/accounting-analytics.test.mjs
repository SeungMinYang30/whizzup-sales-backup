import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("회계 관리와 전체 통계는 서로 분리된 관리자 권한을 사용한다", () => {
  const collaboration = source("../lib/collaboration.ts");
  const crm = source("../app/crm-app.tsx");
  assert.match(collaboration, /"accounting:manage"/);
  assert.match(collaboration, /"analytics:view"/);
  assert.match(crm, /label: "수금·채권 관리"/);
  assert.match(crm, /label: "수주·제품 통계"/);
  assert.match(crm, /id: "accounting:manage"/);
  assert.match(crm, /id: "analytics:view"/);
});

test("구형 회계 확정값과 변경 이력은 읽기·마이그레이션 호환용으로 보존한다", () => {
  const route = source("../app/api/accounting/route.ts");
  const store = source("../lib/accounting-store.ts");
  const migration = source("../drizzle/0033_accounting_settlements.sql");
  assert.match(route, /requireMemberPermission\("accounting:manage"\)/);
  assert.match(route, /LEFT JOIN accounting_settlements/);
  assert.doesNotMatch(route, /UPDATE activities SET budget_amount/);
  assert.match(route, /FROM accounting_settlement_history/);
  assert.doesNotMatch(route, /INSERT INTO accounting_settlement_history/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS accounting_settlements/);
  assert.match(migration, /accounting_settlement_history/);
});

test("회계는 수주별 실제 수금 내역을 원본과 분리해 누적 저장한다", () => {
  const page = source("../app/accounting-page.tsx");
  const route = source("../app/api/accounting/entries/route.ts");
  const migration = source("../drizzle/0036_accounting_collection_receipts.sql");
  assert.match(route, /manufacturer_key/);
  assert.match(route, /ACCOUNTING_TOTAL_KEY/);
  assert.match(route, /accounting_collection_receipts/);
  assert.match(route, /receivable_balance/);
  assert.match(route, /contribution_margin/);
  assert.match(page, /실제 수금 입력/);
  assert.match(page, /예상 공헌이익/);
  assert.match(page, /수금 기준 공헌이익/);
  assert.match(page, /accounting-column-group-row/);
  assert.match(migration, /accounting_collection_receipts/);
});

test("회계 수금은 납품 완료 처리된 위즈업 수주만 조회하고 수정한다", () => {
  const route = source("../app/api/accounting/entries/route.ts");
  assert.match(
    route,
    /WHERE a\.award_status IN \('위즈업 수주', '협력사 수주', '타업체 수주'\)/,
  );
  assert.match(route, /completedWhizzupAwardRows\(activityResult\.results\)/);
  assert.match(route, /const eligibleEntry = entries\.find/);
});

test("일반 회계 조회는 제품 연결 대량 갱신을 초기화 단계에서 실행하지 않는다", () => {
  const store = source("../lib/accounting-store.ts");
  const initializeAccounting = store.slice(
    store.indexOf("async function initializeAccounting()"),
    store.indexOf("export async function linkEquipmentProjectsToWhizzupAwards"),
  );
  assert.doesNotMatch(initializeAccounting, /linkEquipmentProjectsToWhizzupAwards/);
  assert.match(store, /export async function linkEquipmentProjectsToWhizzupAwards/);
});

test("회계 목록 요청은 무한 로딩 대신 시간 제한과 재시도 안내를 제공한다", () => {
  const page = source("../app/accounting-page.tsx");
  assert.match(page, /controller\.abort\(\), 15_000/);
  assert.match(page, /signal: controller\.signal/);
  assert.match(page, /수금 목록 응답이 지연되고 있습니다/);
});

test("수금·채권 관리는 전체 연도와 전체 목록으로 열리고 확인 필요 카드는 별도 필터를 적용한다", () => {
  const page = source("../app/accounting-page.tsx");
  assert.match(page, /initialTab = "collections"/);
  assert.match(
    page,
    /const \[yearFilter, setYearFilter\] = useState\("전체 연도"\)/,
  );
  assert.match(page, /const \[focus, setFocus\] = useState<Focus>\("all"\)/);
  assert.match(
    page,
    /const \[analysisYear, setAnalysisYear\] = useState\(currentYear\)/,
  );
  assert.match(
    page,
    /function openCollections\(\)[\s\S]*setYearFilter\("전체 연도"\)[\s\S]*setFocus\("all"\)/,
  );
  assert.match(page, /onClick=\{openCollections\}/);
  assert.match(
    page,
    /onClick=\{\(\) => applyFocus\("needsCollection"\)\}/,
  );
});

test("회계와 통계 요약 카드는 상세 창 대신 같은 페이지의 관련 영역으로 연결한다", () => {
  const accounting = source("../app/accounting-page.tsx");
  const analytics = source("../app/analytics-page.tsx");
  const crm = source("../app/crm-app.tsx");
  assert.match(accounting, /onClick=\{\(\) => applyFocus\("needsCollection"\)\}/);
  assert.match(accounting, /listRef\.current\?\.scrollIntoView/);
  assert.doesNotMatch(accounting, /nextFocus === "needsCollection"/);
  assert.doesNotMatch(accounting, /const firstMatch = entries\.find/);
  assert.match(accounting, /전체 보기/);
  assert.match(analytics, /onOpenCollectionAnalysis/);
  assert.match(analytics, /당기 수금액/);
  assert.match(analytics, /직접 공급 수금대상/);
  assert.match(analytics, /expectedDirectSalesCollection/);
  assert.match(analytics, /협력사 예상 수수료/);
  assert.match(analytics, /analytics-profit-guide/);
  assert.match(analytics, /analytics-column-group-row/);
  assert.doesNotMatch(analytics, /월별 실제 수금 흐름/);
  assert.doesNotMatch(analytics, /매출채권 상위 건/);
  assert.doesNotMatch(analytics, /analytics-detail-panel/);
  assert.match(analytics, /onOpenAwards/);
  assert.match(crm, /onOpenAwards=\{\(\) => void selectView\("awards"\)\}/);
  assert.match(
    crm,
    /selectView\("accounting", \{ accountingTab: "analysis" \}\)/,
  );
  assert.doesNotMatch(crm, /setAccountingFocusRequest/);
});

test("수금 분석은 입금일 기반 공통 집계와 거래처별 자동 합산을 사용한다", () => {
  const accounting = source("../app/accounting-page.tsx");
  const analytics = source("../app/analytics-page.tsx");
  const calculator = source("../lib/collection-analytics.ts");
  assert.match(accounting, /aggregateCounterpartyCollections/);
  assert.match(accounting, /monthlyCollectionTrend/);
  assert.match(accounting, /annualCollectionTrend/);
  assert.match(analytics, /sumReceiptsForPeriod\(receipts, periodPrefix\)/);
  assert.match(calculator, /businessInstitutionKey/);
  assert.match(calculator, /uniqueCollectionReceipts/);
  assert.match(calculator, /receipt\.collectionDate\.startsWith\(periodPrefix\)/);
});

test("통계 수금액과 미수금은 사업별 receipt 원장 합계만 사용한다", () => {
  const route = source("../app/api/accounting/route.ts");
  assert.match(
    route,
    /const collectedByBusiness = new Map<string, number>\(\)/,
  );
  assert.match(
    route,
    /collectedByBusiness\.get\(receipt\.businessKey\)[\s\S]*receipt\.amount/,
  );
  assert.match(
    route,
    /manufacturerCommissionReceived: collectedAmount/,
  );
  assert.match(
    route,
    /expectedCollectionTotal - collectedAmount/,
  );
  assert.match(route, /unconfirmedAwards: awards\.filter/);
});

test("전체 통계는 공사 프로젝트를 품목과 분리해 한 번만 집계하고 정산 예상액에 반영한다", () => {
  const route = source("../app/api/accounting/route.ts");
  const analytics = source("../app/analytics-page.tsx");
  const styles = source("../app/globals.css");
  const constructionQuery = route.slice(
    route.indexOf("ep.construction_amount"),
    route.indexOf("ep.id AS project_id", route.indexOf("ep.construction_amount") + 1),
  );
  const productMapping = route.slice(
    route.indexOf("const products ="),
    route.indexOf("const awardByBusinessKey"),
  );

  assert.match(route, /calculateConstructionFinance/);
  assert.match(route, /calculateAwardSettlementProjection/);
  assert.match(constructionQuery, /FROM equipment_projects ep/);
  assert.match(constructionQuery, /JOIN activities a ON a\.id = ep\.activity_id/);
  assert.match(constructionQuery, /WHERE a\.award_status = '위즈업 수주'/);
  assert.doesNotMatch(constructionQuery, /JOIN equipment_items/);
  assert.match(route, /constructionResult\.results\.forEach/);
  assert.match(
    route,
    /!eligibleBusinessKeys\.has\(businessKey\)[\s\S]*!eligibleActivityIds\.has\(Number\(row\.activity_id\)\)/,
  );
  assert.match(route, /constructionMarginByBusiness/);
  assert.match(route, /expectedConstructionMargin,/);
  assert.match(
    route,
    /expectedConsortiumSettlement: source\.consortium/,
  );
  assert.match(
    route,
    /expectedCollectionTotal: projection\.expectedCollectionTotal/,
  );
  assert.match(
    route,
    /netRevenue: finalQuotation\?\.marginAmount \?\? projection\.expectedProfit/,
  );
  assert.match(
    route,
    /projection\.expectedCollectionTotal - collectedAmount/,
  );

  assert.doesNotMatch(productMapping, /construction_amount|constructionMargin/);
  assert.match(analytics, /expectedConstructionMargin/);
  assert.match(analytics, /<span>공사 마진<\/span>/);
  assert.match(analytics, /견적 공사비 − 실제 공사비/);
  assert.match(analytics, /품목 정산 후 예상수익/);
  assert.match(analytics, /공사 마진은[\s\S]*배분하지 않습니다/);
  assert.match(
    styles,
    /\.analytics-summary-grid\s*\{\s*grid-template-columns: repeat\(8,/,
  );
  assert.match(styles, /button\.construction/);
});

test("공사 마진 소급 적용 뒤에도 당기 수금액은 실제 입금 원장만 사용한다", () => {
  const route = source("../app/api/accounting/route.ts");
  const analytics = source("../app/analytics-page.tsx");
  const receiptMapping = route.slice(
    route.indexOf("const receipts ="),
    route.indexOf("const collectedByBusiness"),
  );

  assert.match(receiptMapping, /accounting_collection_receipts|receiptResult/);
  assert.doesNotMatch(
    receiptMapping,
    /constructionMargin|expectedConstructionMargin/,
  );
  assert.match(
    analytics,
    /const actualReceiptTotal = sumReceiptsForPeriod\(receipts, periodPrefix\)/,
  );
});

test("수금액 상위 거래처 표는 그룹 헤더와 무관하게 일곱 열 너비를 고정한다", () => {
  const accounting = source("../app/accounting-page.tsx");
  const styles = source("../app/globals.css");
  assert.match(accounting, /<colgroup className="accounting-ranking-columns">/);
  for (const column of [
    "rank",
    "organization",
    "period",
    "cumulative",
    "date",
    "outstanding",
    "status",
  ]) {
    assert.match(
      accounting,
      new RegExp(`accounting-ranking-col-${column}`),
    );
    assert.match(
      styles,
      new RegExp(`\\.accounting-ranking-col-${column}`),
    );
  }
  assert.match(
    styles,
    /\.accounting-ranking-table tbody td:not\(:nth-child\(2\)\)/,
  );
});

test("통계 화면은 기존 자료 연결 점검 카드를 노출하지 않는다", () => {
  const analytics = source("../app/analytics-page.tsx");
  const route = source("../app/api/accounting/route.ts");
  assert.doesNotMatch(analytics, /기존 자료 연결 상태/);
  assert.doesNotMatch(analytics, /제품 미연계/);
  assert.doesNotMatch(analytics, /2025년 제품 연결/);
  assert.match(route, /qualityDetails:/);
  assert.match(route, /unlinkedProjects:/);
  assert.match(route, /linked2025Projects:/);
});

test("권한 설명에는 직원 비교 문구를 사용하지 않는다", () => {
  const crm = source("../app/crm-app.tsx");
  assert.doesNotMatch(crm, /직원 비교/);
  assert.match(crm, /회사 전체 월간·연간 수주·제품 통계 확인/);
});

test("일반 구성원에게는 본인 담당 수주의 회계 상태만 응답한다", () => {
  const route = source("../app/api/accounting/route.ts");
  assert.match(route, /params\.get\("scope"\) !== "visible"/);
  assert.match(
    route,
    /String\(row\.progress_manager \?\? ""\) === member\.displayName/,
  );
  assert.match(route, /member\.displayName/);
});

test("통계는 월간·연간 회사 집계이며 개인 성과표를 만들지 않는다", () => {
  const analytics = source("../app/analytics-page.tsx");
  const route = source("../app/api/accounting/route.ts");
  assert.match(route, /requireMemberPermission\("analytics:view"\)/);
  assert.match(analytics, />\s*연간\s*</);
  assert.match(analytics, />\s*월간\s*</);
  assert.match(analytics, /제품별 판매 성과/);
  assert.match(analytics, /지역별 수주 현황/);
  assert.match(analytics, /예산 종류별 현황/);
  for (const excluded of [
    "개인별 실적",
    "직원 순위",
    "협력사별 수주현황",
    "위즈업·협력사·타업체 수주 비율",
    "진행·설치·완공 단계별 건수",
    "향후 월별 설치 예정 건수",
  ]) {
    assert.doesNotMatch(analytics, new RegExp(excluded));
  }
});

test("수주·제품 통계는 위즈업 수주만 집계한다", () => {
  const analytics = source("../app/analytics-page.tsx");
  const route = source("../app/api/accounting/route.ts");
  assert.match(route, /completedWhizzupAwardRows\(awardResult\.results\)/);
  assert.match(
    route,
    /award_status IN \('위즈업 수주', '협력사 수주', '타업체 수주'\)/,
  );
  assert.match(route, /JOIN activities a ON a\.id = ep\.activity_id/);
  assert.match(
    route,
    /COALESCE\(NULLIF\(ei\.proposed_qty, 0\), NULLIF\(ei\.awarded_qty, 0\), NULLIF\(ei\.installed_qty, 0\), 1\)/,
  );
  assert.doesNotMatch(route, /latest_awards/);
  assert.match(analytics, /협력사·타업체 수주는\s*제외/);
  assert.match(analytics, /<span>수주 건수<\/span>/);
});

test("직접 공급 품목은 협력사·공급처 미지정 집계와 표시에서 분리한다", () => {
  const analytics = source("../app/analytics-page.tsx");

  assert.match(analytics, /\.filter\(\(row\) => row\.supplyType !== "direct"\)/);
  assert.match(
    analytics,
    /product\.supplyType === "direct"[\s\S]*"위즈업 직접 공급"[\s\S]*product\.supplierVendorName \|\| "공급처 미지정"/,
  );
});

test("협력사 수주에 연결된 품목은 최신 위즈업 수주의 회계·통계로 옮기지 않는다", () => {
  const route = source("../app/api/accounting/route.ts");
  const entries = source("../app/api/accounting/entries/route.ts");
  const store = source("../lib/accounting-store.ts");
  assert.match(
    route,
    /FROM equipment_items ei[\s\S]*JOIN activities a ON a\.id = ep\.activity_id[\s\S]*WHERE a\.award_status = '위즈업 수주'/,
  );
  assert.match(
    entries,
    /source\.groupedActivityIds\.includes\(projectActivityId\)[\s\S]*project_award_status \?\? ""\) !== "위즈업 수주"/,
  );
  assert.match(
    store,
    /groupedActivityIds\.has\(linkedActivityId\)[\s\S]*continue/,
  );
  assert.doesNotMatch(store, /SET activity_id = NULL/);
  assert.match(
    route,
    /eligibleActivityIds\.has\(Number\(row\.activity_id\)\)/,
  );
  assert.match(
    route,
    /eligibleActivityIds\.has\(Number\(row\.entry_activity_id\)\)/,
  );
});

test("수주·제품 통계는 기관의 사업 차수별로 한 번만 집계한다", () => {
  const route = source("../app/api/accounting/route.ts");
  const grouping = source("../lib/analytics-business-rounds.ts");
  const store = source("../lib/accounting-store.ts");
  const migration = source("../drizzle/0046_award_completion_dates.sql");
  const backup = source("../lib/backup-store.ts");
  const csv = source("../lib/activity-csv.ts");
  const xlsx = source("../app/activity-xlsx.ts");

  assert.match(route, /completedWhizzupAwardRows\(awardResult\.results\)/);
  assert.match(route, /analyticsBusinessRoundKey/);
  assert.match(grouping, /institutionAliasKey/);
  assert.match(grouping, /business_round/);
  assert.match(grouping, /award_completed_date/);
  assert.match(
    store,
    /groupLatestAuthoritativeAwardRows\(awardResult\.results\)/,
  );
  assert.match(store, /completedAwardByBusiness/);
  assert.match(store, /analyticsBusinessRoundKey\(/);
  assert.match(migration, /award_completed_date/);
  assert.match(backup, /"award_completed_date"/);
  assert.match(backup, /2026-07-27-award-completion-dates/);
  assert.match(csv, /"사업 차수"/);
  assert.match(csv, /"납품 완료일"/);
  assert.match(xlsx, /\["businessRound", "사업 차수"/);
  assert.match(xlsx, /\["awardCompletedDate", "납품 완료일"/);
});

test("과거 제품 연결 점검은 내부 계산에 유지하고 통계 화면에서는 숨긴다", () => {
  const store = source("../lib/accounting-store.ts");
  const analytics = source("../app/analytics-page.tsx");
  const route = source("../app/api/accounting/route.ts");
  assert.match(store, /linkEquipmentProjectsToWhizzupAwards/);
  assert.match(store, /representativeActivityId/);
  assert.match(store, /completedAwardByBusiness/);
  assert.match(
    store,
    /WHERE award_status IN \('위즈업 수주', '협력사 수주', '타업체 수주'\)/,
  );
  assert.match(store, /isCompletedWhizzupAwardRow/);
  assert.match(route, /unlinkedProductProjects/);
  assert.match(route, /missingCommissionItems/);
  assert.match(route, /linked2025Projects/);
  assert.doesNotMatch(analytics, /제품 미연계/);
  assert.doesNotMatch(analytics, /수수료율 미입력/);
  assert.doesNotMatch(analytics, /2025년 제품 연결/);
});

test("수주 목록은 정상 수금 완료를 숨기고 확인이 필요한 회계 상태만 표시한다", () => {
  const crm = source("../app/crm-app.tsx");
  assert.match(crm, /\/api\/accounting\/entries\?scope=visible/);
  assert.doesNotMatch(crm, /\/api\/accounting\?scope=visible/);
  assert.match(crm, /accountingExceptionForRecord/);
  assert.match(crm, /수금 확인 필요/);
  assert.match(crm, /미수금/);
  assert.doesNotMatch(crm, /회계 확인 ·/);
});
