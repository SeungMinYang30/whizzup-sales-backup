import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [calendar, reminders, googleApi, googleSync, schedules, crm, styles, env] = await Promise.all([
  readFile(new URL("../app/home-calendar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/schedule-reminders.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/google-calendar-api.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/google-calendar-sync.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/organization-schedules.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../.env.example", import.meta.url), "utf8"),
]);

test("완료 일정은 달력에 남고 사용자가 숨길 수 있다", () => {
  assert.doesNotMatch(reminders, /listScheduleCalendarForMember[\s\S]*WHERE s\.completed = 0/);
  assert.match(reminders, /COALESCE\(s\.completed, 0\) AS completed/);
  assert.match(reminders, /completed: Number\(row\.completed\) === 1/);
  assert.match(calendar, /const \[hideCompleted, setHideCompleted\] = useState\(false\)/);
  assert.match(calendar, /완료 일정 숨기기/);
  assert.match(calendar, /완료 처리해도 일정은 캘린더에 계속 표시되며 취소선으로 구분됩니다/);
  assert.match(styles, /home-calendar-day-items > span\.completed/);
  assert.match(styles, /home-calendar-agenda-list button\.completed/);
});

test("Google 일정 연결 기본 분류는 영업이며 사용자가 선택한 분류를 저장한다", () => {
  assert.match(calendar, /schedule\.suggestedCategory === "construction"[\s\S]*suggestedKind\.sales/);
  assert.match(calendar, /category: KIND_CATEGORY\[editor\.kind\]/);
  assert.match(calendar, /kind, title:/);
});

test("시공 일정은 별도 Google 캘린더로만 동기화한다", () => {
  assert.match(env, /WHIZZUP_GOOGLE_CONSTRUCTION_CALENDAR_ID=/);
  assert.match(googleApi, /category === "construction"[\s\S]*WHIZZUP_GOOGLE_CONSTRUCTION_CALENDAR_ID/);
  assert.match(googleApi, /googleRequest\(path, \{[\s\S]*\}, schedule\.category\)/);
  assert.match(googleSync, /google:construction_calendar_split:v2/);
  assert.match(googleSync, /WHEN TRIM\(COALESCE\(google_event_id, ''\)\) <> '' THEN 'move-construction'/);
  assert.match(googleSync, /const event = await upsertGoogleCalendarEvent[\s\S]*deleteGoogleCalendarEvent\(sourceEventId, "general"\)/);
  assert.match(googleApi, /resource has been deleted/);
  assert.match(googleApi, /if \(!googleEventId \|\| !isMissingGoogleResource\(error\)\) throw error/);
});

test("Vercel 일정표 조회는 장비 전체 보정 작업을 기다리지 않는다", () => {
  assert.match(schedules, /if \(!isPostgresDatabase\(\)\) await ensureEquipmentReady\(\)/);
});

test("Google에서 삭제한 시공 일정은 사이트 원본으로 자동 복원한다", () => {
  assert.match(googleSync, /listGoogleCalendarApiEvents\(start, end, "construction"\)/);
  assert.match(googleSync, /repairDeletedConstructionCalendarEvents/);
  assert.match(googleSync, /sync_status = 'synced'[\s\S]*scheduled_date <= \?[\s\S]*end_date/);
  assert.match(googleSync, /google_event_id = '', google_event_etag = '', google_updated_at = ''[\s\S]*sync_status = 'pending', sync_operation = 'upsert'/);
  assert.match(googleSync, /restoreIds\.forEach\(\(id\) => forcedRefreshIds\.add\(id\)\)/);
});

test("품목 카드는 개별 예산과 금액을 명확하게 표시한다", () => {
  assert.match(crm, /번째 예산/);
  assert.match(crm, /총예산/);
  assert.match(crm, /품목·공사비 합계/);
  assert.match(crm, /남은 예산/);
  assert.match(crm, /연결 예산 ·/);
  assert.match(crm, /budgets=\{detailLatest\?\.budgets \?\? \[\]\}/);
});

test("모바일 캘린더와 주요 업무 화면은 뷰포트 안에서 재배치된다", () => {
  assert.match(styles, /Mobile work-flow pass/);
  assert.match(styles, /overflow-x: hidden/);
  assert.match(styles, /home-calendar-day \{ min-height: 82px/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(styles, /max-height: calc\(100dvh - 16px\)/);
});
