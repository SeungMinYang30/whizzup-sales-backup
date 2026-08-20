import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [crm, selector, manager, styles] = await Promise.all([
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/budget-name-selector.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/budget-name-manager.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);
const budgetNamesRoute = await readFile(
  new URL("../app/api/budget-names/route.ts", import.meta.url),
  "utf8",
);

test("미분류 예산명 작업은 선택 후 모달에서만 연결·등록·제외한다", () => {
  assert.match(manager, /placeholder="미분류 예산명 검색"/);
  assert.match(manager, /selectedNames\.length > 0/);
  assert.match(manager, /기존 표준명에 연결/);
  assert.match(manager, /새 표준명으로 등록/);
  assert.match(manager, /placeholder="표준명·별칭 검색"/);
  assert.match(manager, /defaultAmount: newDefaultAmount/);
  assert.doesNotMatch(manager, /미분류 상태 유지/);
  assert.match(budgetNamesRoute, /action === "keep-unclassified"[\s\S]*status: 410/);
  assert.match(styles, /\.budget-unclassified-selection-actions/);
});

test("직원은 활성 표준 예산을 고르고 새 이름을 승인 대기로 저장한다", () => {
  assert.match(selector, /fetch\("\/api\/budget-catalog"/);
  assert.match(selector, /\+ 새 예산명 신청/);
  assert.match(selector, /confirmNoExistingMatch: confirmedNoSuggestion/);
  assert.match(selector, /budgetRequestId\?: string \| null/);
  assert.match(selector, /resolvedGroupId: number \| null/);
  assert.match(selector, /budgetGroupId: approved \? request\.resolvedGroupId : null/);
  assert.match(selector, /disabled=\{rejected\}/);
  assert.match(selector, /반려된 신청은 예산명으로 선택할 수 없습니다/);
});

test("관리자는 사전등록, 신청 처리, 선택 소급 및 이력을 한 흐름에서 관리한다", () => {
  for (const phrase of [
    "표준 예산명 사전등록",
    "미분류·불러온 예산명",
    "신청 대기",
    "새 표준 예산명으로 승인",
    "기존 표준 예산명의 별칭으로 연결",
    "추가 과거 기록 적용 대상",
    "변경 이력",
  ]) {
    assert.match(manager, new RegExp(phrase));
  }
  assert.match(manager, /preserveMissingCollections/);
  assert.match(manager, /retrofitPreview:[\s\S]*current\.retrofitPreview/);
  assert.match(manager, /협력사·타업체[\s\S]*제외/);
  assert.match(manager, /action: "set-active"/);
  assert.match(manager, /다시 활성화/);
  assert.match(manager, /const editing = group\.active && editGroupId === group\.id/);
  assert.match(manager, /\{group\.active && \([\s\S]*설정 수정/);
  assert.match(manager, /budget-standard-reactivation-note/);
});

test("같은 정규화 키가 여러 표준에 걸리면 자동 연결하지 않는다", () => {
  assert.match(crm, /const exactMatches = catalog/);
  assert.match(crm, /if \(exactMatches\.length > 1\)/);
  assert.match(crm, /matchMethod: "ambiguous-exact"/);
  assert.match(crm, /표준 예산명 후보를 선택해야 저장할 수 있습니다/);
  assert.match(crm, /row\.budgetMatchStatus === "review"/);
});

test("자체예산은 실제 직접 입력과 품목 합계 자동 계산을 안전하게 전환한다", () => {
  assert.match(crm, /const formIsSelfBudget =/);
  assert.match(crm, /const formUsesQuoteAuto =/);
  assert.match(
    crm,
    /function switchBudgetAmountToManual\(\)[\s\S]*budgetAmountMode: "manual"/,
  );
  assert.match(
    crm,
    /function recalculateBudgetFromQuote\(\)[\s\S]*budgetAmountMode: "quote_auto"/,
  );
  assert.match(crm, /formBudgetQuoteSummary\?\.quoteStatus !== "missing"/);
  assert.match(crm, /formBudgetQuoteAmount !== null/);
  assert.match(crm, /이 예산에 사용할 금액을 입력해 주세요/);
  assert.doesNotMatch(crm, /기관 확인 직접 입력값/);
  assert.doesNotMatch(crm, /자체예산 직접 입력값/);
  assert.match(crm, /품목·견적 미등록/);
  assert.match(
    crm,
    /amount: `\$\{totalAmount\.toLocaleString\("ko-KR"\)\}원`,[\s\S]*status: "complete" as const/,
  );
  assert.match(crm, /견적 금액 확인 필요/);
  assert.match(crm, /"미정",[\s\S]*"미등록",[\s\S]*"확인필요"/);
});

test("목록, 기관 상세, 이력과 엑셀 미리보기가 같은 예산 판정을 표시한다", () => {
  assert.ok(
    crm.match(/budgetAmountDisplayForRecord\(record\)/g)?.length >= 3,
    "목록·내보내기·이력에서 공통 금액 표시를 사용해야 합니다.",
  );
  assert.match(crm, /detailBudgetAmountDisplay/);
  assert.match(crm, /<th>원문 예산<\/th>/);
  assert.match(crm, /<th>표준 예산<\/th>/);
  assert.match(crm, /<th>판정<\/th>/);
  assert.match(crm, /className="budget-import-select"/);
  assert.match(crm, /importedSelfBudget && hasImportedBudgetAmount/);
  assert.match(crm, /budgetAmountOverride:/);
  assert.match(styles, /\.budget-selector-popover/);
  assert.match(styles, /\.budget-match-badge/);
  assert.match(styles, /\.budget-auto-amount/);
});

test("업무 화면의 예산명 입력은 활성 표준 예산명 선택기로 통일한다", () => {
  assert.ok(
    crm.match(/<BudgetNameSelector/g)?.length >= 4,
    "일괄 수정·기관 상세·기록 점검·신규 기록에서 공통 선택기를 사용해야 합니다.",
  );
  assert.ok(
    crm.match(/standardOnly/g)?.length >= 2,
    "일괄 수정과 기록 점검 선택기는 활성 표준 예산만 저장해야 합니다.",
  );
  assert.doesNotMatch(
    crm,
    /setInstitutionBudgetType\(event\.target\.value\)/,
  );
  assert.match(crm, /standardBudgetOnly: true/);
  assert.match(crm, /관리자에 등록된 활성 표준 예산명만 선택할 수 있습니다/);
});
