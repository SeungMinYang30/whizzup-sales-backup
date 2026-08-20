import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [calendar, recordsRoute, styles] = await Promise.all([
  readFile(new URL("../app/home-calendar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("신규 기관 버튼 연속 클릭은 상태와 ref로 즉시 차단한다", () => {
  assert.match(calendar, /if \(institutionCreatingRef\.current \|\| scheduleSavingRef\.current \|\| saving\) return;/);
  assert.match(calendar, /institutionCreatingRef\.current = true;\s*setInstitutionCreating\(true\);/);
  assert.match(calendar, /disabled=\{institutionCreating \|\| saving\}/);
  assert.match(calendar, /institutionCreating \? "기관 등록 중…" : "\+ 새 기관 등록 후 연결"/);
  assert.match(calendar, /if \(scheduleSavingRef\.current\) return false;/);
});

test("기존 기관은 새 이력을 만들지 않고 동일 기관과 사업 차수를 재사용한다", () => {
  assert.match(calendar, /function selectInstitution\(item: Institution\)/);
  assert.match(calendar, /organization: item\.organization, businessRound: item\.businessRound/);
  assert.match(recordsRoute, /findCalendarInstitutionRecord\(d1, organization, businessRound\)/);
  assert.match(recordsRoute, /if \(existing\) return Response\.json\(\{ record: existing, reused: true \}\);/);
  assert.match(recordsRoute, /calendar-institution:\$\{businessRound\}:/);
  assert.match(recordsRoute, /UNIQUE constraint failed/);
});

test("신규 기관 등록 뒤 Google 일정 연결 저장은 한 번만 실행하고 완료 안내를 남긴다", () => {
  assert.match(calendar, /reuseExistingInstitution: true/);
  assert.match(calendar, /const linkedEditor: CalendarEditor = \{/);
  assert.match(calendar, /await persistSchedule\(linkedEditor, "기관 등록 및 일정 연결 완료"\);/);
  assert.match(calendar, /scheduleSavingRef\.current = true;/);
  assert.match(calendar, /scheduleSavingRef\.current = false;/);
  assert.match(calendar, /setReloadVersion\(\(value\) => value \+ 1\)/);
  assert.match(calendar, /onRecordsChanged\?\.\(\)/);
});

test("검색 결과와 신규 기관 버튼은 분리되고 작은 화면에서는 팝업 내부만 스크롤한다", () => {
  assert.match(calendar, /className="home-schedule-institution-results"/);
  assert.match(calendar, /className="home-schedule-institution-create"/);
  assert.match(styles, /\.home-schedule-institution-results \{ position: static;/);
  assert.match(styles, /\.home-schedule-editor \{ width: min\(560px, 94vw\); max-height:/);
  assert.match(styles, /\.home-schedule-editor \{ width: 100%; max-height: calc\(100dvh - 16px\); padding: 18px 15px; overflow-y: auto;/);
});

test("Google 일정 연결창은 일반 편집창보다 조밀하게 한 화면에 표시한다", () => {
  assert.match(calendar, /editor\.googleEventId \? " google-link-editor" : ""/);
  assert.match(styles, /\.home-schedule-editor\.google-link-editor \{ max-height: calc\(100dvh - 24px\); padding: 16px 18px; \}/);
  assert.match(styles, /\.google-link-editor > label textarea \{ min-height: 64px;[\s\S]*resize: none;/);
  assert.match(styles, /\.google-link-editor footer \{ margin-top: 10px; padding-top: 10px; \}/);
});

test("통합 일정 시작 시간을 선택하면 종료 시간을 한 시간 뒤로 자동 설정한다", () => {
  assert.match(calendar, /const oneHourLater = \(time: string\) =>/);
  assert.match(calendar, /startTime, endTime: startTime \? oneHourLater\(startTime\) : ""/);
  assert.match(calendar, /value=\{editor\.endTime\}[\s\S]*onChange=\{\(event\) => setEditor/);
});
