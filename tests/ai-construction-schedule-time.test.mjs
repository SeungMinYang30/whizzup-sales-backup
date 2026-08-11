import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("AI construction schedules keep time and do not create equipment entries", async () => {
  const [aiRoute, recordsStore, schedules, constructionPage, recordsRoute, equipmentRoute, googleApi] =
    await Promise.all([
      source("app/api/ai/organize/route.ts"),
      source("lib/records-store.ts"),
      source("lib/organization-schedules.ts"),
      source("app/construction-schedule-page.tsx"),
      source("app/api/records/route.ts"),
      source("app/api/equipment/route.ts"),
      source("lib/google-calendar-api.ts"),
    ]);

  assert.match(aiRoute, /required: \["label", "date", "startTime", "endTime"\]/);
  assert.match(aiRoute, /정확한 시간이 확인되면 startTime과 endTime/);
  assert.match(recordsStore, /entry\.startTime/);
  assert.match(recordsStore, /entry\.endTime/);
  assert.match(schedules, /start_time, end_time, category, stage/);
  assert.match(schedules, /listStoredOrganizationSchedules\(organization, businessRound\)/);
  assert.match(schedules, /organization_schedule_import_state/);
  assert.match(schedules, /duplicateLegacyScheduleIds/);
  assert.match(constructionPage, /시작 시간/);
  assert.match(constructionPage, /종일/);
  assert.match(constructionPage, /자동\(\+1시간\)/);
  assert.match(constructionPage, /function updateEditorStartTime/);
  assert.match(constructionPage, /endTime: startTime \? oneHourLater\(startTime\) : ""/);
  assert.match(constructionPage, /onInput=\{\(event\) => updateEditorStartTime/);
  assert.match(googleApi, /startTime/);
  assert.match(googleApi, /endTime/);

  assert.doesNotMatch(aiRoute, /inferredEquipmentItemsFromSchedule/);
  assert.doesNotMatch(aiRoute, /equipmentItems에 반드시 정리/);
  assert.match(recordsRoute, /skipAiEquipmentSync/);
  assert.match(equipmentRoute, /source_chat/);
  assert.match(equipmentRoute, /!== "사이트 AI 입력"/);
  assert.match(equipmentRoute, /kind\.startsWith\("ai-"\)[\s\S]{0,100}disabled: true/);
});
