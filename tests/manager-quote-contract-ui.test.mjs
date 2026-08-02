import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [crm, equipmentRoute, activityXlsx] = await Promise.all([
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/equipment/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/activity-xlsx.ts", import.meta.url), "utf8"),
]);

test("관리자 영업점검 배지는 처리 이력과 견적 현황이 모두 준비된 뒤 표시한다", () => {
  assert.match(
    crm,
    /const managerInspectionHydrated =\s*recordsFullyLoaded &&\s*managerAlertsHydrated &&\s*equipmentQuoteSummariesHydrated;/,
  );
  assert.match(crm, /requestRecords\("full"\)/);
  assert.match(
    crm,
    /item\.id === "organizations" &&\s*managerInspectionHydrated &&\s*managerOrganizations\.length > 0/,
  );
  assert.match(
    crm,
    /memberCan\(nextSession\.member, "records:manage"\)\) \{\s*void loadManagerAlerts\(\);/,
  );
  assert.match(
    crm,
    /fetch\(`\/api\/manager-alerts\$\{query\}`, \{\s*cache: "no-store",\s*\}\)/,
  );
});

test("관리자 영업점검 메뉴 진입은 검색과 점검 필터를 기본값으로 되돌린다", () => {
  assert.match(
    crm,
    /if \(nextView === "organizations"\) \{\s*setManagerIssueFilter\("attention"\);\s*setManagerSearch\(""\);\s*setManagerAdminSection\("alerts"\);/,
  );
  assert.match(
    crm,
    /await Promise\.all\(\[\s*loadManagerAlerts\(\),\s*loadEquipmentQuoteSummaries\(\),\s*\]\);/,
  );
});

test("위즈업 수주 견적 누락과 금액 누락은 관리자 점검 사유와 서명에 반영한다", () => {
  assert.match(
    crm,
    /authoritativeAwardRecordsByBusiness\.set\(businessKey, record\)/,
  );
  assert.match(
    crm,
    /\.filter\(\s*\(\[, record\]\) => record\.awardStatus === "위즈업 수주"/,
  );
  assert.match(crm, /issues\.push\("견적 미등록"\)/);
  assert.match(crm, /issues\.push\("견적 금액 확인 필요"\)/);
  assert.match(crm, /\.\.\.\(quoteIssueStates\.length\s*\?\s*\{\s*quoteIssues:/);
});

test("수주 후 계약금액은 예산금액이 아닌 등록 견적 요약을 표시하고 정렬한다", () => {
  assert.match(crm, /<th>계약금액<\/th>/);
  assert.match(crm, /registeredContractDisplay\(record\)/);
  assert.match(crm, /aQuote\?\.quoteStatus === "complete"/);
  assert.match(crm, /aQuote\.contractAmountReference/);
  assert.match(crm, /amount: "견적 미등록"/);
  assert.match(crm, /amount: "견적 금액 확인 필요"/);
});

test("품목 요약 API는 사업 차수별 등록 견적만 합산하고 금액 완결성을 판정한다", () => {
  assert.match(equipmentRoute, /p\.business_round/);
  assert.match(equipmentRoute, /linked_award_status/);
  assert.match(
    equipmentRoute,
    /\["협력사 수주", "타업체 수주"\]\.includes/,
  );
  assert.match(equipmentRoute, /eligibleProjectIds/);
  assert.match(equipmentRoute, /calculateEquipmentFinance\(/);
  assert.match(equipmentRoute, /isRegisteredQuoteItemAmount\(/);
  assert.match(equipmentRoute, /calculateRegisteredQuote\(/);
  assert.match(equipmentRoute, /contractAmountReference: quote\.contractAmount/);
  assert.match(equipmentRoute, /quoteMissingAmountItemCount/);
  assert.doesNotMatch(
    equipmentRoute.slice(
      equipmentRoute.indexOf('searchParams.get("summary") === "1"'),
      equipmentRoute.indexOf("const organization = clean", equipmentRoute.indexOf('searchParams.get("summary") === "1"')),
    ),
    /budget_amount/,
  );
});

test("수주 대량등록의 금액 열은 계약금액이 아닌 예산 참고값으로 안내한다", () => {
  assert.match(activityXlsx, /"예산금액\(참고\)"/);
  assert.match(activityXlsx, /계약금액이 아닙니다/);
  assert.match(crm, /<th>예산금액\(참고\)<\/th>/);
});
