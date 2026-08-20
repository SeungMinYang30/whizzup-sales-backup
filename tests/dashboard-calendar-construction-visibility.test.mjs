import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [crmApp, calendar, constructionPage, schedules, scheduleRoute, recordsRoute, styles, backupStore] = await Promise.all([
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/home-calendar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/construction-schedule-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/organization-schedules.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/schedules/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
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
  assert.match(calendar, /window\.setTimeout\(resolve, 900\)/);
  assert.match(calendar, /Google 일정 확인 중/);
});

test("초기 대시보드는 핵심 기록만 받고 관리 자료는 화면을 열 때 불러온다", () => {
  const initialLoad = crmApp.slice(
    crmApp.indexOf("void requestSession()"),
    crmApp.indexOf('if (sessionStatus !== "approved") return;', crmApp.indexOf("void requestSession()")),
  );
  assert.match(crmApp, /dashboardRecordsRequest = requestRecords\("dashboard"\)/);
  assert.match(initialLoad, /prefetchedRecords\.error[\s\S]*?requestRecords\("dashboard"\)/);
  assert.doesNotMatch(initialLoad, /ensureBudgetReviewCatalog|loadManagerAlerts|loadEquipmentQuoteSummaries|loadActivityReviews|loadProtectionReviews|loadCorrectionRequests/);
  assert.match(crmApp, /const firstHeartbeat = window\.setTimeout\(heartbeat, 15_000\)/);
  assert.match(crmApp, /whizzup-presence-heartbeat-leader/);
  assert.match(crmApp, /requestScheduleReminders\(\)[\s\S]*?\}, 4_500\)/);
  assert.match(calendar, /if \(!editorOpen \|\| members\.length\) return;[\s\S]*?\/api\/members\?scope=assignees/);
});

test("대시보드 기록은 기관 사업별 최신 수주와 화면 대상 공동사업만 조회한다", () => {
  assert.match(crmApp, /requestRecords\("dashboard"\)/);
  assert.match(recordsRoute, /award_records AS \([\s\S]*?SELECT DISTINCT ON \(organization, business_round\)/);
  assert.match(recordsRoute, /WHERE source_activity\.id IN \(SELECT id FROM dashboard_ids\)/);
});

test("대시보드 시공 현황은 경량 요약을 즉시 조회하고 전체 일정표는 뒤에서 불러온다", () => {
  assert.match(crmApp, /scope=construction-summary&today=/);
  assert.doesNotMatch(crmApp, /scope=construction-board/);
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

test("시공 일정표 기관 추가 upsert는 PostgreSQL과 D1에서 대상 열을 명확히 구분한다", () => {
  assert.match(
    schedules,
    /WHEN excluded\.work_summary <> '' THEN excluded\.work_summary[\s\S]*?ELSE construction_schedule_projects\.work_summary/,
  );
  assert.doesNotMatch(
    schedules,
    /WHEN excluded\.work_summary <> '' THEN excluded\.work_summary ELSE work_summary END/,
  );
});
test("시공 일정표 기관 순서는 기본 운영자만 저장하고 일반 사용자도 같은 순서를 본다", () => {
  assert.match(schedules, /manual_sort_order INTEGER NOT NULL DEFAULT 0/);
  assert.match(schedules, /ensureConstructionScheduleManualOrderColumn\(d1\)/);
  assert.match(schedules, /PRAGMA table_info\(construction_schedule_projects\)/);
  assert.match(schedules, /saveConstructionScheduleProjectOrder/);
  assert.match(schedules, /SET manual_sort_order=0/);
  assert.match(scheduleRoute, /reorder-construction-projects/);
  assert.match(scheduleRoute, /reset-construction-project-order/);
  assert.match(scheduleRoute, /if \(!\(await isPrimaryOwner\(member\)\)\)/);
  assert.match(constructionPage, /project\.manualSortOrder/);
  assert.match(constructionPage, /draggable=\{canReorder && !saving\}/);
  assert.match(constructionPage, /moveProjectBy\(project, -1\)/);
  assert.match(constructionPage, /moveProjectBy\(project, 1\)/);
  assert.match(constructionPage, /기관 순서를 기본 일정순으로 되돌렸습니다/);
  assert.match(styles, /\.construction-order-handle/);
  assert.match(backupStore, /"construction_schedule_projects",[\s\S]*?"manual_sort_order"/);
});
