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
  assert.match(crmApp, /위즈업·협력사·타업체 포함/);
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

test("시공 일정 제외는 원본 삭제 대신 숨김과 복구를 사용한다", () => {
  assert.match(schedules, /hidden_at TEXT NOT NULL DEFAULT ''/);
  assert.match(schedules, /setConstructionScheduleProjectHidden/);
  assert.match(scheduleRoute, /hide-construction-project/);
  assert.match(scheduleRoute, /restore-construction-project/);
  assert.match(constructionPage, /기관·수주 기록은 삭제되지 않습니다/);
  assert.match(constructionPage, /일정표에 다시 표시/);
  assert.match(constructionPage, /aria-expanded=\{rowMenuKey === scopeKey/);
  assert.match(styles, /\.construction-fixed-cells > span \{ overflow: hidden/);
  assert.match(styles, /\.construction-row-menu \{[^}]*overflow: visible !important/);
  assert.doesNotMatch(constructionPage, /일정표에서 빼기/);
  assert.match(backupStore, /name: "construction_schedule_projects",[\s\S]*?"hidden_at"/);
});
