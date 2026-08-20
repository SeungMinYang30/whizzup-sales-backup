import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function sources() {
  return Promise.all([
    readFile(new URL("app/crm-app.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
}

test("기관별 관리는 전체·수주 전·수주 후 탭과 하나의 메뉴로 통합된다", async () => {
  const [crm, css] = await sources();
  assert.match(crm, /type InstitutionManagementTab = "all" \| "pre" \| "post"/);
  assert.match(crm, /label: "기관·예산 관리"/);
  assert.doesNotMatch(crm, /label: "기관별 관리\(수주 후\)"/);
  assert.match(crm, /전체/);
  assert.match(crm, /수주 전/);
  assert.match(crm, /수주 후/);
  assert.match(css, /\.institution-management-tabs/);
});

test("기관별 관리 탭 수치는 현재 탭 필터가 아닌 동일한 전체 스냅샷으로 계산한다", async () => {
  const [crm] = await sources();
  assert.match(crm, /const institutionManagementCounts = useMemo/);
  assert.match(crm, /const pre = groupJointProjectRows\(/);
  assert.match(crm, /const post = groupJointProjectRows\(latestAwardRecords\)\.length/);
  assert.match(crm, /return \{ all: pre \+ post, pre, post \}/);
  assert.match(crm, /recordsFullyLoaded \? institutionManagementCounts\[tab\] : "…"/);
  assert.match(crm, /recordsRequestSequenceRef/);
  assert.match(crm, /requestSequence !== recordsRequestSequenceRef\.current/);
});

test("통합 목록은 공통 열과 기관 담당자 3줄 정보를 제공한다", async () => {
  const [crm] = await sources();
  assert.match(crm, /기관·사업/);
  assert.match(crm, /기관 담당자/);
  assert.match(crm, /예산·금액/);
  assert.match(crm, /현재 상태/);
  assert.match(crm, /업무 요약/);
  assert.match(crm, /사업방식/);
  assert.match(crm, /진행 담당자/);
  assert.match(crm, /전화 미등록/);
  assert.match(crm, /기관 메일 미등록/);
});

test("등록 전용 기록은 뒤로 보내고 수주 결과와 실제 업체를 명확히 표시한다", async () => {
  const [crm, css] = await sources();
  assert.match(crm, /function isMeaningfulSalesActivityRecord/);
  assert.match(crm, /isCampaignRegistrationSystemRecord\(record\)/);
  assert.match(crm, /meaningfulActivitySortMetaByBusinessKey/);
  assert.match(crm, /Number\(!aMeaningful\) - Number\(!bMeaningful\)/);
  assert.match(crm, /awardResultPriority\(a\.awardStatus\)/);
  assert.match(crm, /협력사 수주 · \$\{record\.awardCompany \|\| record\.consortiumCompany/);
  assert.match(crm, /타업체 수주 · \$\{record\.awardCompany/);
  assert.match(css, /\.award-result-badge\.result-0/);
});

test("납품 완료는 남은 일정을 먼저 확인하고 연속 처리를 막는다", async () => {
  const [crm] = await sources();
  assert.match(crm, /awardCompletionBusyRef/);
  assert.match(crm, /api\/schedules\?organization=/);
  assert.match(crm, /미완료 시공·납품 일정 \$\{unfinishedScheduleCount\}건/);
  assert.match(crm, /납품 완료 처리/);
});

test("상단 카드 문구는 영업·수주·현재 일정의 역할을 구분한다", async () => {
  const [crm] = await sources();
  assert.match(crm, /영업 중/);
  assert.match(crm, /결과·종료/);
  assert.match(crm, /위즈업 수주 현황/);
  assert.match(crm, /현재 시공·납품 일정/);
  assert.match(crm, /전체 수주/);
  assert.match(crm, /납품 완료/);
});

test("수주 후는 의미 있는 업무일 최신순이며 같은 날짜에만 수주 주체 순서를 적용한다", async () => {
  const [crm] = await sources();
  const awardSortBlock = crm.slice(
    crm.indexOf("const displayedRecords = useMemo"),
    crm.indexOf("const awardDisplayGroups = useMemo"),
  );
  assert.ok(awardSortBlock.indexOf("const aMeaningful") < awardSortBlock.indexOf("const awardOrder"));
  assert.match(awardSortBlock, /bMeaningful\.activityDate\.localeCompare\(aMeaningful\.activityDate\)/);
  assert.match(awardSortBlock, /awardResultPriority\(a\.awardStatus\)/);
});

test("전체 기관은 현재 상태와 분리된 단계·수주 주체 상세 필터를 제공한다", async () => {
  const [crm] = await sources();
  assert.match(crm, /institutionDetailFilter/);
  assert.match(crm, /aria-label="상세 필터"/);
  assert.match(crm, /전체 단계[\s\S]*수주 전[\s\S]*수주 후 전체[\s\S]*위즈업 수주[\s\S]*협력사 수주[\s\S]*타업체 수주/);
  assert.match(crm, /phase !== "post" \|\| record\.awardStatus !== institutionDetailFilter/);
});

test("수주 전 목록은 공동사업 예산 상태를 행 안에서 안전하게 계산한다", async () => {
  const [crm] = await sources();
  assert.doesNotMatch(crm, /\{groupBudgetMatchStatus &&/);
  assert.match(crm, /budgetMatchStatusForGroup\(group\)/);
});
