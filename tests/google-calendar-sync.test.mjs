import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [api, sync, store, route, calendar, crm, migration, connectionMigration, contentRefreshMigration, descriptionRefreshMigration, structuredRefreshMigration, scheduleDedupMigration, semanticScheduleDedupMigration, schema] = await Promise.all([
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
  readFile(new URL("../drizzle/0087_organization_schedule_identity_dedup.sql", import.meta.url), "utf8"),
  readFile(new URL("../drizzle/0088_organization_schedule_semantic_identity.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
]);
const title = await readFile(new URL("../lib/google-calendar-title.ts", import.meta.url), "utf8");
const aiOrganizer = await readFile(new URL("../app/api/ai/organize/route.ts", import.meta.url), "utf8");
const constructionPage = await readFile(new URL("../app/construction-schedule-page.tsx", import.meta.url), "utf8");

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
  assert.match(calendar, /details: draft\.details\.trim\(\)/);
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
  assert.match(
    calendar,
    /const title = cleanScheduleTitle\(schedule\.label\) \|\| structured\.constructionStage \|\| structured\.content/,
  );
  assert.match(calendar, /<input list="construction-stage-options"/);
  assert.match(calendar, /<datalist id="construction-stage-options">/);
  assert.match(calendar, /목록에 없어도 직접 입력하면 저장 후 다음 선택부터 재사용됩니다/);
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

test("과거 형식의 시작 시간을 정규화하고 잘못된 값은 Google 400 대신 종일 일정으로 안전 처리한다", () => {
  assert.match(api, /normalizeGoogleCalendarTime/);
  assert.match(api, /오전\|오후/);
  assert.match(api, /const allDay = !startTime/);
  assert.match(api, /defaultTimedEnd\(endDate, startTime\)/);
});

test("AI 취소 문구는 확인 후 사이트와 Google 일정에 함께 반영한다", () => {
  assert.match(aiOrganizer, /ScheduleCancellationIntent/);
  assert.match(aiOrganizer, /재문의 대기/);
  assert.match(route, /preview-schedule-cancellation/);
  assert.match(route, /cancel-schedule-candidates/);
  assert.match(
    route,
    /queueGoogleCalendarSync\(\{ ids, source: "cancel-schedule-candidates" \}\)/,
  );
  assert.match(route, /after\(async \(\) =>/);
  assert.match(crm, /아래 일정을 사이트와 Google Calendar에서 함께 취소할까요/);
  assert.match(crm, /취소·연기 여부가 불명확해 기존 일정은 유지했습니다/);
});

test("시공 일정표 기관 삭제는 본계정만 노출·실행하고 모바일은 현황 필터를 제공한다", () => {
  assert.match(route, /시공·납품 일정표의 기관 삭제·복원은 기본 운영자만/);
  assert.match(constructionPage, /isPrimaryOwner \? <button/);
  assert.match(constructionPage, /construction-mobile-summary/);
  assert.match(constructionPage, /missingSchedule/);
  assert.match(calendar, /home-calendar-agenda-backdrop/);
  assert.match(calendar, /mobileAgendaOpen/);
});

test("같은 기관·날짜·제목 일정은 서버와 DB에서 한 번만 저장한다", () => {
  assert.match(store, /organization_schedules_active_local_identity_idx/);
  assert.match(store, /INSERT OR IGNORE INTO organization_schedules/);
  assert.match(store, /WHERE NOT EXISTS \(/);
  assert.match(store, /같은 기관·날짜·제목의 일정이 이미 등록되어 있습니다/);
  assert.match(scheduleDedupMigration, /Google에 이미 연결된 행 또는 먼저 생성된 원본 행/);
  assert.match(scheduleDedupMigration, /CREATE UNIQUE INDEX IF NOT EXISTS organization_schedules_active_local_identity_idx/);
  assert.match(scheduleDedupMigration, /LOWER\(TRIM\(label\)\)/);
  assert.match(schema, /organization_schedules_active_local_identity_idx/);
});

test("기관명 행정구역 표기가 달라도 같은 일정으로 정리한다", () => {
  assert.match(store, /organization_schedules_active_local_semantic_identity_idx/);
  assert.match(store, /normalizeScheduleSemanticLabel/);
  assert.match(store, /특별자치도\|특별자치시\|광역시\|특별시\|도\|시\|군\|구/);
  assert.match(semanticScheduleDedupMigration, /organization_schedules_active_local_semantic_identity_idx/);
  assert.match(semanticScheduleDedupMigration, /TRIM\(COALESCE\(keeper\.google_event_id, ''\)\) <> ''/);
  assert.match(semanticScheduleDedupMigration, /PRAGMA optimize/);
  assert.match(schema, /organization_schedules_active_local_semantic_identity_idx/);
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
  assert.match(api, /googleCalendarTitle\(schedule\)/);
  assert.match(title, /`\[영업\] \$\{input\.organization\} 방문`/);
  assert.match(title, /`\[회의\] \$\{input\.organization\} 회의`/);
  assert.match(title, /`\[시공\] \$\{input\.organization\} · \$\{input\.productSummary/);
  assert.match(title, /`\[쇼룸\] \$\{input\.organization\} 방문`/);
  assert.match(title, /`\[기타\] \$\{input\.organization\} · \$\{cleanLabel\}`/);
  assert.match(api, /colorId: colorId\[category\]/);
  assert.match(sync, /applyGoogleSharingPolicy/);
  assert.match(sync, /sync_operation === "unlink"/);
  assert.match(sync, /sync_status = 'local_only'/);
  assert.match(connectionMigration, /기존 공유 업무 일정/);
  assert.match(connectionMigration, /THEN 'unlink'/);
  assert.match(connectionMigration, /google_origin/);
  assert.match(calendar, /사이트 전용 일정 · Google 공유 안 함/);
});

test("Google에서 삭제된 사이트 일정은 보존하고 명시적으로 다시 연결하거나 삭제한다", () => {
  assert.match(sync, /sync_error = 'google_event_deleted'/);
  assert.doesNotMatch(sync, /DELETE FROM organization_schedules WHERE id = \?"\)\.bind\(siteId\)/);
  assert.match(calendar, /Google에서 삭제됨 · 사이트 일정 유지 중/);
  assert.match(calendar, /Google에 다시 연결/);
  assert.match(calendar, /사이트에서 삭제/);
});

test("마지막 기관 일정을 삭제해도 과거 활동 문자열에서 다시 생성하지 않는다", () => {
  assert.match(store, /function listStoredOrganizationSchedules/);
  assert.match(store, /await listStoredOrganizationSchedules\(organization, businessRound\)/);
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

test("시공 일정 저장 응답은 Google 동기화를 기다리지 않고 범위 결과만 반환한다", () => {
  const branch = route.slice(
    route.indexOf('if (payload.action === "save-construction")'),
    route.indexOf('if (payload.action === "update-general-schedule")'),
  );
  assert.match(route, /import \{ after \} from "next\/server"/);
  assert.match(branch, /after\(async \(\) =>/);
  assert.match(branch, /flushGoogleCalendarSync\(\{ ids: syncIds\.slice/);
  assert.doesNotMatch(branch, /await flushGoogleCalendarSync\(\{ limit:/);
  assert.match(branch, /project: saved\.project/);
  assert.match(branch, /googleSyncPending: saved\.syncIds\.length > 0/);
  assert.match(store, /Promise<ConstructionScheduleSaveResult>/);
  assert.match(store, /WHERE organization = \? AND business_round = \? AND category = 'construction'/);
});

test("schedule category changes reuse the existing Google event and clean only matched orphans", () => {
  assert.match(store, /export function normalizeScheduleSemanticLabel/);
  assert.match(store, /const semanticMatches = candidates\.results\.filter/);
  assert.match(store, /if \(existingCategory !== category\)/);
  const reclassification = store.slice(
    store.indexOf("if (semanticMatches.length === 1)"),
    store.indexOf("await d1.prepare(\n      `INSERT OR IGNORE", store.indexOf("if (semanticMatches.length === 1)")),
  );
  assert.match(reclassification, /UPDATE organization_schedules/);
  assert.doesNotMatch(reclassification, /google_event_id\s*=/);
  assert.match(route, /normalizeScheduleSemanticLabel\(schedule\.organization, schedule\.label\)/);
  assert.match(sync, /siteOwned && !siteIds\.has\(siteId\)/);
  assert.match(sync, /candidate\.google_event_id !== event\.id/);
  assert.match(sync, /if \(replacements\.length === 1\)/);
  assert.match(sync, /await deleteGoogleCalendarEvent\(event\.id, "general"\)/);
});

test("personal schedules stay local and their legacy public Google events are removed", () => {
  assert.match(store, /WHEN \? = 'personal' AND TRIM\(COALESCE\(google_event_id, ''\)\) <> '' THEN 'pending'/);
  assert.match(sync, /row\.category === "personal" \? "general" : row\.category/);
  assert.match(sync, /if \(row\?\.category === "personal"\)/);
  assert.match(sync, /await deleteGoogleCalendarEvent\(event\.id, "general"\)/);
  assert.match(sync, /sync_status = 'local_only', sync_operation = 'upsert'/);
});
