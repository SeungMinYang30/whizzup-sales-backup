import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register(new URL("./typescript-resolver.mjs", import.meta.url));

const {
  AWARD_STAGE_OPTIONS,
  COMPLETED_AWARD_STAGE,
  isCompletedAwardStage,
  normalizeAwardStage,
} = await import("../lib/sales-taxonomy.ts");

const source = async (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

test("기존 수주 단계는 새 단계로 소급 변환하며 기록 시각은 바꾸지 않는다", async () => {
  const migration = await source("../drizzle/0044_delivery_stage_normalization.sql");

  assert.match(migration, /SET `award_stage` = '납품 완료'[\s\S]*WHERE `award_stage` = '완공'/);
  assert.match(migration, /SET `award_stage` = '검수·교육 진행'[\s\S]*IN \('검수', '교육'\)/);
  assert.match(migration, /SET `award_stage` = '협상'[\s\S]*WHERE `award_stage` = '품의'/);
  assert.match(migration, /SET `award_stage` = '해당 없음'[\s\S]*타업체 수주 종료/);
  assert.doesNotMatch(migration, /updated_at|created_at/);
});

test("옛 백업이나 파일을 다시 불러와도 단계 명칭을 현재 기준으로 정규화한다", async () => {
  const backupStore = await source("../lib/backup-store.ts");
  const csvImport = await source("../lib/activity-csv.ts");
  const xlsxImport = await source("../app/activity-xlsx.ts");

  assert.deepEqual(AWARD_STAGE_OPTIONS, [
    "미정",
    "협상",
    "계약",
    "일정 조율",
    "설치·공사 진행",
    "검수·교육 진행",
    "납품 완료",
  ]);
  assert.equal(COMPLETED_AWARD_STAGE, "납품 완료");
  assert.equal(normalizeAwardStage("완공"), "납품 완료");
  assert.equal(normalizeAwardStage("검수"), "검수·교육 진행");
  assert.equal(normalizeAwardStage("교육"), "검수·교육 진행");
  assert.equal(normalizeAwardStage("품의"), "협상");
  assert.equal(normalizeAwardStage("타업체 수주 종료"), "해당 없음");
  assert.equal(normalizeAwardStage("계약", "타업체 수주"), "해당 없음");
  assert.equal(isCompletedAwardStage("완공"), true);
  assert.equal(isCompletedAwardStage("검수"), false);
  assert.match(backupStore, /award_stage: normalizeAwardStage/);
  assert.match(csvImport, /awardStage: normalizeAwardStage/);
  assert.match(xlsxImport, /normalizeAwardStage\(values\.awardStage/);
});

test("새 수주 단계는 통계와 수금의 완료 기준까지 동일하게 연결한다", async () => {
  const accountingRoute = await source("../app/api/accounting/entries/route.ts");
  const accountingStore = await source("../lib/accounting-store.ts");
  const analyticsPage = await source("../app/analytics-page.tsx");
  const mapPage = await source("../app/sales-map.tsx");

  assert.match(accountingRoute, /a\.award_stage = '납품 완료'/);
  assert.match(accountingStore, /isCompletedWhizzupAwardRow/);
  assert.match(analyticsPage, /납품 완료 처리된 계약금액 합계/);
  assert.match(mapPage, /isCompletedAwardStage\(record\.awardStage\)/);
});
