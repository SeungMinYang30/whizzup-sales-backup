import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("AI 상세 기록을 저장하고 이력별로 열어볼 수 있다", async () => {
  const [migration, schema, store, recordsRoute, aiRoute, crm, styles] =
    await Promise.all([
      source("../drizzle/0059_activity_details_and_share_cleanup.sql"),
      source("../db/schema.ts"),
      source("../lib/records-store.ts"),
      source("../app/api/records/route.ts"),
      source("../app/api/ai/organize/route.ts"),
      source("../app/crm-app.tsx"),
      source("../app/globals.css"),
    ]);

  for (const column of [
    "detail_level",
    "detail_summary",
    "detail_key_facts_json",
    "detail_sections_json",
    "raw_input",
  ]) {
    assert.match(migration, new RegExp(column));
    assert.match(store, new RegExp(column));
    assert.match(recordsRoute, new RegExp(column));
  }
  assert.match(schema, /detailLevel: text\("detail_level"\)/);
  assert.match(aiRoute, /detailLevelPreference/);
  assert.match(aiRoute, /detailSections/);
  assert.match(aiRoute, /rawInput: userProjectText/);
  assert.match(aiRoute, /function mergeDetailSections/);
  assert.match(crm, /AI 자동 판단/);
  assert.match(crm, /상세 기록 보기/);
  assert.match(crm, /상세 기록 수정/);
  assert.match(crm, /AI 상세 기록 수정/);
  assert.doesNotMatch(crm, /aria-label="상세 기록 수준"/);
  assert.match(crm, /detailKeyFacts: current\.detailKeyFacts\.map/);
  assert.match(crm, /detailSections: current\.detailSections\.map/);
  assert.match(crm, /activityDetailFactValueForRecord/);
  assert.match(crm, /className="activity-detail-dialog"/);
  assert.match(crm, /selectedActivityDetail\.rawInput/);
  assert.match(
    styles,
    /@media \(max-width: 700px\)[\s\S]*\.activity-detail-dialog \{ width: 100vw;[\s\S]*height: 100dvh;/,
  );
  assert.match(styles, /\.activity-detail-editor/);
  assert.match(styles, /\.activity-detail-edit-button/);
});

test("단톡방 공유 기능과 파생 저장 경로를 종료한다", async () => {
  const [migration, recommendationRoute, crm, backupStore] = await Promise.all([
    source("../drizzle/0059_activity_details_and_share_cleanup.sql"),
    source("../app/api/ai/recommendations/route.ts"),
    source("../app/crm-app.tsx"),
    source("../lib/backup-store.ts"),
  ]);

  assert.match(migration, /DELETE FROM `ai_recommendations`/);
  assert.match(
    await source("../lib/records-store.ts"),
    /SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_recommendations'[\s\S]*DELETE FROM ai_recommendations/,
  );
  assert.match(recommendationRoute, /recommendations: \[\]/);
  assert.match(recommendationRoute, /status: 410/);
  assert.doesNotMatch(crm, /단톡방 공유용/);
  assert.doesNotMatch(crm, /navigator\.share/);
  assert.doesNotMatch(crm, /buildActivityShareText/);
  assert.doesNotMatch(crm, /OrganizationAiRecommendations/);

  const insertOrder = backupStore.match(
    /const insertOrder: BackupTableName\[\] = \[([\s\S]*?)\n  \];/,
  )?.[1];
  assert.ok(insertOrder);
  assert.doesNotMatch(insertOrder, /ai_recommendations/);
});

test("새 상세 필드는 전체 백업과 이전 백업 복원에 안전하게 포함된다", async () => {
  const backupStore = await source("../lib/backup-store.ts");
  assert.match(
    backupStore,
    /BACKUP_SCHEMA_VERSION = "2026-08-02-joint-budget-period"/,
  );
  assert.match(backupStore, /"2026-08-02-complete-business-backup"/);
  assert.match(backupStore, /"2026-07-31-activity-details"/);
  for (const column of [
    "detail_level",
    "detail_summary",
    "detail_key_facts_json",
    "detail_sections_json",
    "raw_input",
  ]) {
    assert.match(backupStore, new RegExp(`"${column}"`));
  }
  assert.match(backupStore, /detail_level" in row \? row\.detail_level : "compact"/);
  assert.match(backupStore, /detail_key_facts_json[\s\S]*: "\[\]"/);
});
