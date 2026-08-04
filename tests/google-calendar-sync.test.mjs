import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [api, sync, store, route, calendar, crm, migration, connectionMigration, contentRefreshMigration, descriptionRefreshMigration, structuredRefreshMigration, schema] = await Promise.all([
  readFile(new URL("../lib/google-calendar-api.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/google-calendar-sync.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/organization-schedules.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/schedules/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/home-calendar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0069_google_calendar_sync.sql", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0070_google_calendar_connection_workflow.sql", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0071_google_calendar_content_refresh.sql", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0072_google_calendar_description_refresh.sql", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0073_google_calendar_structured_description.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
]);

test("사이트 일정은 Google 이벤트 식별자와 재시도 가능한 동기화 상태를 보존한다", () => {
  for (const column of [
    "google_event_id",
    "google_event_etag",
    "sync_status",
    "sync_operation",
    "sync_error",
    "sync_attempts",
    "last_synced_at",
    "google_updated_at",
    "deleted_at",
  ]) {
    assert.match(migration, new RegExp(column));
  }
  assert.match(schema, /organization_schedules_sync_idx/);
  assert.match(schema, /organization_schedules_google_event_idx/);
  assert.match(sync, /flushGoogleCalendarSync/);
  assert.match(sync, /retryGoogleCalendarSync/);
  assert.match(sync, /sync_status = 'failed'/);
  assert.match(route, /retry-google-sync/);
});

test("기존 시공 Google 일정은 안전하게 다시 연결하고 신뢰 가능한 정형 항목·색상을 소급 갱신한다", () => {
  assert.match(sync, /legacyConstructionStage/);
  assert.match(sync, /exact\.length === 1/);
  assert.match(sync, /unlinked\.length === 1/);
  assert.match(sync, /forcedRefreshIds/);
  assert.match(api, /담당자: \$\{required\(schedule\.assigneeName\)\}/);
  assert.match(api, /시공 단계: \$\{required\(schedule\.constructionStage \|\| cleanLabel\)\}/);
  assert.match(api, /시공업체: \$\{required\(schedule\.vendorName\)\}/);
  assert.match(api, /공사·품목: \$\{required\(schedule\.productSummary\)\}/);
  assert.match(api, /일정 내용: \$\{required\(cleanLabel\)\}/);
  assert.match(api, /"\[입력 필요\]"/);
  assert.match(sync, /missingManagedDescription/);
  assert.match(api, /colorId: colorId\[category\]/);
  assert.match(contentRefreshMigration, /기존 사이트 연결 일정/);
  assert.match(contentRefreshMigration, /sync_status = 'pending'/);
  assert.match(descriptionRefreshMigration, /담당자·일정 내용/);
  assert.match(descriptionRefreshMigration, /sync_status = 'pending'/);
  assert.match(structuredRefreshMigration, /신뢰 가능한 사이트·시공 일정 원본/);
  assert.match(structuredRefreshMigration, /sync_status = 'pending'/);
});

test("새 메모만 저장·양방향 동기화하고 과거 메모는 임의 생성하지 않는다", () => {
  assert.match(calendar, /메모 <small>선택 입력 · 새 일정부터 저장됩니다/);
  assert.match(calendar, /details: editor\.details\.trim\(\)/);
  assert.match(route, /details: payload\.details/);
  assert.match(store, /const details = clean\(input\.details\)\.slice\(0, 500\)/);
  assert.match(api, /메모: \$\{schedule\.details\.trim\(\)\}/);
  assert.match(sync, /memoFromGoogleDescription\(event\.description \|\| ""\)/);
  assert.match(sync, /googleStructuredDescription/);
  assert.match(sync, /\["\[입력 필요\]", "미정", "미입력"\]/);
  assert.doesNotMatch(descriptionRefreshMigration, /메모:/);
});

test("원본 우선순위와 제목 비추론 원칙을 지킨다", () => {
  assert.match(sync, /row\.project_work_summary\.trim\(\) \|\| row\.product_names\.trim\(\)/);
  assert.match(sync, /typeof input\.details === "string"/);
  assert.match(sync, /structured\.constructionStage : structured\.content/);
  assert.match(sync, /structured\.vendor/);
  assert.match(sync, /structured\.products/);
  assert.match(sync, /NOT EXISTS \(\s*SELECT 1 FROM activities/);
  assert.match(sync, /NOT EXISTS \(\s*SELECT 1 FROM equipment_projects/);
  assert.match(sync, /existingStructured\.memo/);
  assert.doesNotMatch(sync, /function linkedTitle/);
  assert.doesNotMatch(sync, /function suggestedCategory/);
  assert.doesNotMatch(sync, /event\.summary \|\| "", organization/);
  assert.match(calendar, /const title = structured\.constructionStage \|\| structured\.content/);
  assert.match(calendar, /<option value="">단계 선택<\/option>/);
  assert.doesNotMatch(calendar, /\? "목공" : current\.title/);
});

test("Google API 등록·수정·삭제는 사이트 일정 ID로 중복을 방지한다", () => {
  assert.match(api, /method = googleEventId \? "PATCH" : "POST"/);
  assert.match(api, /deleteGoogleCalendarEvent/);
  assert.match(api, /privateExtendedProperty: `whizzupScheduleId=\$\{scheduleId\}`/);
  assert.match(api, /whizzupSource: "site"/);
  assert.match(api, /whizzupScheduleId: String\(schedule\.id\)/);
  assert.match(sync, /findGoogleCalendarEventByScheduleId/);
  assert.match(route, /scheduleDedupeKey/);
  assert.match(route, /if \(!merged\.has\(key\)\)/);
  assert.match(api, /summary,/);
});

test("Google에서 가져온 일정은 팀 연결함에서 기관에 연결하고 관리자는 원본 삭제가 가능하다", () => {
  assert.match(sync, /editable: false/);
  assert.match(sync, /syncStatus: "readonly"/);
  assert.match(sync, /linkGoogleCalendarSchedule/);
  assert.match(sync, /deleteUnlinkedGoogleCalendarSchedule/);
  assert.match(route, /link-google-schedule/);
  assert.match(route, /delete-google-calendar-event/);
  assert.match(calendar, /Google Calendar 동기화 실패/);
  assert.match(calendar, /retrySync/);
  assert.match(calendar, /schedule\.category === "google"/);
  assert.match(calendar, /Google 일정 연결 필요/);
  assert.match(calendar, /기관과 연결/);
  assert.match(calendar, /Google에서도 삭제/);
});

test("공유 업무만 Google로 보내고 기존 일정 제목과 개인 일정은 소급 정리한다", () => {
  assert.match(api, /`\[\$\{categoryLabel\[category\] \|\| "기타"\}\] \$\{schedule\.organization\} · \$\{cleanLabel\}`/);
  assert.match(api, /colorId: colorId\[category\]/);
  assert.match(sync, /applyGoogleSharingPolicy/);
  assert.match(sync, /sync_operation === "unlink"/);
  assert.match(sync, /sync_status = 'local_only'/);
  assert.match(connectionMigration, /기존 공유 업무 일정/);
  assert.match(connectionMigration, /THEN 'unlink'/);
  assert.match(connectionMigration, /google_origin/);
  assert.match(calendar, /개인 일정 · Google 공유 안 함/);
});

test("시공 일정은 시공·납품 일정표 행을 유지하고 기관 상세와 대시보드가 같은 API 원본을 쓴다", () => {
  assert.match(store, /existingSchedules = await d1\.prepare/);
  assert.match(store, /category = 'construction'/);
  assert.match(store, /retainedIds/);
  assert.match(sync, /row\?\.category === "construction"/);
  assert.match(sync, /sync_status = 'pending', sync_operation = 'upsert'/);
  assert.match(calendar, /scope=calendar/);
  assert.match(crm, /`\/api\/schedules\?organization=\$\{encodeURIComponent\(detailOrganization\)\}/);
  assert.match(crm, /Google 동기화 실패 · 재시도/);
});
