import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [crmApp, calendar, constructionPage, schedules, scheduleRoute, styles, backupStore] = await Promise.all([
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/home-calendar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/construction-schedule-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/organization-schedules.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/schedules/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../lib/backup-store.ts", import.meta.url), "utf8"),
]);

test("대시보드 상단 현황 카드는 영업 수주 시공 화면으로 연결된다", () => {
  assert.match(crmApp, /className="dashboard-status-card sales"/);
  assert.match(crmApp, /selectView\("followup"\)/);
  assert.match(crmApp, /className="dashboard-status-card awards"/);
  assert.match(crmApp, /selectView\("awards"\)/);
  assert.match(crmApp, /className="dashboard-status-card construction"/);
  assert.match(crmApp, /selectView\("installation-schedule"\)/);
  assert.match(crmApp, /전체 기관의 최신 영업 기록/);
  assert.match(crmApp, /위즈업 수주·계약만/);
  assert.match(crmApp, /const whizzupAwards = latestAwardRecords\.filter/);
  assert.match(crmApp, /record\.awardStatus === "위즈업 수주"/);
  assert.match(crmApp, /일정표에 등록된 위즈업 수주/);
});

test("통합 일정 필터와 상세 표시는 같은 카테고리 색상을 공유한다", () => {
  assert.match(calendar, /home-calendar-filter-\$\{key\}/);
  assert.match(calendar, /<em className=\{item\.category\}>/);
  for (const category of ["sales", "meeting", "construction", "showroom", "other", "personal", "google"]) {
    assert.match(styles, new RegExp(`\\.home-calendar-filter-${category}`));
    assert.match(styles, new RegExp(`\\.home-calendar-agenda-list em\\.${category}`));
  }
});

test("대시보드는 저장된 일정을 먼저 표시하고 Google 확인은 뒤에서 갱신한다", () => {
  assert.match(scheduleRoute, /refreshGoogle = url\.searchParams\.get\("refreshGoogle"\) !== "0"/);
  assert.match(scheduleRoute, /if \(!refreshGoogle\)[\s\S]*?listScheduleCalendarForMember/);
  assert.match(calendar, /requestCalendar\(false\)/);
  assert.match(calendar, /requestCalendar\(true\)/);
  assert.match(calendar, /Google 일정 확인 중/);
});

test("대시보드 시공 현황과 일정표는 같은 조회 결과를 공유한다", () => {
  assert.doesNotMatch(crmApp, /fetch\("\/api\/schedules\?scope=construction-board"/);
  assert.match(crmApp, /onDashboardCounts=\{setConstructionDashboardCounts\}/);
  assert.equal(
    (constructionPage.match(/fetch\("\/api\/schedules\?scope=construction-board"/g) ?? []).length,
    1,
  );
  assert.match(constructionPage, /onDashboardCounts\(projects\.filter/);
});

test("시공 일정표 목록 삭제는 원본을 보존하고 기관 추가로 재등록한다", () => {
  assert.match(schedules, /hidden_at TEXT NOT NULL DEFAULT ''/);
  assert.match(schedules, /setConstructionScheduleProjectHidden/);
  assert.match(scheduleRoute, /hide-construction-project/);
  assert.match(constructionPage, /기관·수주·품목·기존 일정 기록은 유지되며/);
  assert.match(constructionPage, /‘기관 추가’로 다시 등록할 수 있습니다/);
  assert.match(constructionPage, /className="construction-row-remove"/);
  assert.match(constructionPage, /onClick=\{\(\) => void removeProjectFromBoard\(project\)\}>−<\/button>/);
  assert.match(constructionPage, /\.filter\(\(project\) => !project\.hidden\)[\s\S]*?\.map\(\(project\) => scopeKey/);
  assert.doesNotMatch(constructionPage, /제외된 기관 보기|제외된 기관 목록|construction-excluded-panel/);
  assert.match(schedules, /ON CONFLICT\(organization, business_round\) DO UPDATE SET[\s\S]*?hidden_at = ''/);
  assert.match(constructionPage, /candidate\.endDate \|\| candidate\.scheduledDate\) >= start/);
  assert.match(constructionPage, /left\.localeCompare\(right\) \|\| a\.project\.organization\.localeCompare/);
  assert.doesNotMatch(constructionPage, /rowMenuKey/);
  assert.doesNotMatch(constructionPage, /construction-row-menu-popover/);
  assert.match(styles, /\.construction-fixed-cells > span \{ overflow: hidden/);
  assert.match(styles, /\.construction-row-remove \{/);
  assert.doesNotMatch(constructionPage, /일정표에서 빼기|일정표에서 제외/);
  assert.match(backupStore, /name: "construction_schedule_projects",[\s\S]*?"hidden_at"/);
});
