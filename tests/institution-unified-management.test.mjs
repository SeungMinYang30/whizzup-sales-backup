import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const crm = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("기관별 관리는 전체·수주 전·수주 후 탭과 하나의 메뉴로 통합된다", () => {
  assert.match(crm, /label: "기관·예산 관리"/);
  assert.doesNotMatch(crm, /label: "기관별 관리\(수주 후\)"/);
  assert.match(crm, /\["all", "전체"\][\s\S]*\["pre", "수주 전"\][\s\S]*\["post", "수주 후"\]/);
  assert.match(css, /\.institution-management-tabs/);
});

test("기관별 관리 탭 수치는 현재 탭 필터가 아닌 동일한 전체 스냅샷으로 계산한다", () => {
  assert.match(crm, /const institutionManagementCounts = useMemo/);
  assert.match(crm, /const pre = groupJointProjectRows\(/);
  assert.match(crm, /const post = groupJointProjectRows\(latestAwardRecords\)\.length/);
  assert.match(crm, /return \{ all: pre \+ post, pre, post \}/);
  assert.match(crm, /recordsFullyLoaded \? institutionManagementCounts\[tab\] : "…"/);
  assert.match(crm, /recordsRequestSequenceRef/);
  assert.match(crm, /requestSequence !== recordsRequestSequenceRef\.current/);
});

test("통합 목록은 공통 열과 기관 담당자 3줄 정보를 제공한다", () => {
  assert.match(crm, /기관·사업[\s\S]*기관 담당자[\s\S]*예산·금액[\s\S]*현재 상태[\s\S]*업무 요약[\s\S]*사업방식[\s\S]*진행 담당자[\s\S]*상세/);
  assert.match(crm, /href={`tel:\$\{contact\.phone \|\| record\.contactPhone\}`}/);
  assert.match(crm, /href={`mailto:\$\{contact\.email \|\| record\.contactEmail\}`}/);
  assert.match(crm, /record\.executionType === "컨소"[\s\S]*컨소업체 미등록/);
});

test("등록 전용 기록은 뒤로 보내고 수주 결과와 실제 업체를 명확히 표시한다", () => {
  assert.match(crm, /function isMeaningfulSalesActivityRecord/);
  assert.match(crm, /isCampaignRegistrationSystemRecord\(record\)/);
  assert.match(crm, /meaningfulActivitySortMetaByBusinessKey/);
  assert.match(crm, /Number\(!aMeaningful\) - Number\(!bMeaningful\)/);
  assert.match(crm, /awardResultPriority\(a\.awardStatus\)/);
  assert.match(crm, /협력사 수주 · \$\{record\.awardCompany \|\| record\.consortiumCompany/);
  assert.match(crm, /타업체 수주 · \$\{record\.awardCompany/);
  assert.match(css, /\.award-result-badge\.result-0/);
});

test("납품 완료는 남은 일정을 먼저 확인하고 연속 처리를 막는다", () => {
  assert.match(crm, /awardCompletionBusyRef\.current/);
  assert.match(crm, /미완료 시공·납품 일정 \$\{unfinishedScheduleCount\}건/);
  assert.match(crm, /awardStage: COMPLETED_AWARD_STAGE/);
  assert.match(crm, /followUpRequired: false/);
});

test("상단 카드 문구는 영업·수주·현재 일정의 역할을 구분한다", () => {
  assert.match(crm, /영업 중[\s\S]*결과·종료/);
  assert.match(crm, /위즈업 수주 현황[\s\S]*전체 수주[\s\S]*진행 중[\s\S]*납품 완료/);
  assert.match(crm, /현재 시공·납품 일정[\s\S]*현재 대상[\s\S]*예정[\s\S]*진행/);
});

test("수주 후는 의미 있는 업무일 최신순이며 같은 날짜에만 수주 주체 순서를 적용한다", () => {
  const awardSortBlock = crm.slice(
    crm.indexOf("const displayedRecords = useMemo"),
    crm.indexOf("const awardDisplayGroups = useMemo"),
  );
  assert.ok(awardSortBlock.indexOf("const aMeaningful") < awardSortBlock.indexOf("const awardOrder"));
  assert.match(awardSortBlock, /bMeaningful\.activityDate\.localeCompare\(aMeaningful\.activityDate\)/);
  assert.match(awardSortBlock, /awardResultPriority\(a\.awardStatus\)/);
});

test("전체 기관은 현재 상태와 분리된 단계·수주 주체 상세 필터를 제공한다", () => {
  assert.match(crm, /institutionDetailFilter/);
  assert.match(crm, /aria-label="상세 필터"/);
  assert.match(crm, /전체 단계[\s\S]*수주 전[\s\S]*수주 후 전체[\s\S]*위즈업 수주[\s\S]*협력사 수주[\s\S]*타업체 수주/);
  assert.match(crm, /phase !== "post" \|\| record\.awardStatus !== institutionDetailFilter/);
});
