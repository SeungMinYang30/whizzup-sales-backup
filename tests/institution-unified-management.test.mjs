import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const crm = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("기관별 관리는 전체·수주 전·수주 후 탭과 하나의 메뉴로 통합된다", () => {
  assert.match(crm, /label: "기관별 통합 관리"/);
  assert.doesNotMatch(crm, /label: "기관별 관리\(수주 후\)"/);
  assert.match(crm, /\["all", "전체"\][\s\S]*\["pre", "수주 전"\][\s\S]*\["post", "수주 후"\]/);
  assert.match(css, /\.institution-management-tabs/);
});

test("통합 목록은 공통 열과 기관 담당자 3줄 정보를 제공한다", () => {
  assert.match(crm, /기관·사업[\s\S]*기관 담당자[\s\S]*예산·금액[\s\S]*현재 상태[\s\S]*업무 요약[\s\S]*사업방식[\s\S]*진행 담당자[\s\S]*상세/);
  assert.match(crm, /href={`tel:\$\{contact\.phone \|\| record\.contactPhone\}`}/);
  assert.match(crm, /href={`mailto:\$\{contact\.email \|\| record\.contactEmail\}`}/);
  assert.match(crm, /record\.executionType === "컨소"[\s\S]*컨소업체 미등록/);
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
