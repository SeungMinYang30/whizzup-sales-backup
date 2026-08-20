import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("기관 합치기는 최종 기관의 전체 위치값을 읽고 빈 좌표를 D1용 null로 바꾼다", async () => {
  const merge = await source("../lib/institution-merge.ts");

  assert.match(
    merge,
    /canonicalLocation[\s\S]*SELECT TRIM\(region\)[\s\S]*latitude, longitude, TRIM\(place_name\) AS place_name,[\s\S]*TRIM\(place_id\) AS place_id/,
  );
  assert.match(
    merge,
    /institutionMergeLocationValues[\s\S]*Number\.isFinite\(location\.latitude\)[\s\S]*: null/,
  );
  assert.match(
    merge,
    /institutionMergeLocationValues[\s\S]*Number\.isFinite\(location\.longitude\)[\s\S]*: null/,
  );
});

test("기존 사업은 고정 담당자를 우선하고 그 외에는 최신 영업 기록 작성자로 소급 보정한다", async () => {
  const manager = await source("../lib/sales-manager-normalization.ts");
  const records = await source("../lib/records-store.ts");

  assert.match(manager, /latest_author_progress_manager_backfill_v1/);
  assert.match(
    manager,
    /locked\.progress_manager_locked = 1[\s\S]*ORDER BY locked\.updated_at DESC/,
  );
  assert.match(
    manager,
    /JOIN activity_authors author ON author\.activity_id = latest\.id[\s\S]*member\.is_sales = 1[\s\S]*ORDER BY latest\.activity_date DESC, latest\.id DESC/,
  );
  assert.match(
    manager,
    /award_status\) === "협력사 수주"[\s\S]*progress_manager = '해당 없음'/,
  );
  assert.match(
    manager,
    /AND award_status <> '협력사 수주'/,
  );
  assert.match(
    records,
    /await backfillHistoricalProgressManagersFromLatestAuthors\(d1\)/,
  );
  assert.match(
    records,
    /await syncBusinessProgressManagerFromLatestAuthor\([\s\S]*organization,[\s\S]*businessRound/,
  );
});

test("수주 후 목록은 기관 옆에 예산명을 별도 열로 표시한다", async () => {
  const crm = await source("../app/crm-app.tsx");
  const styles = await source("../app/globals.css");

  assert.match(
    crm,
    /<th>기관<\/th>\s*<th>예산<\/th>\s*<th>사업방식<\/th>/,
  );
  assert.match(
    crm,
    /className="award-budget-name"[\s\S]*record\.budgetType[\s\S]*record\.budgetOriginalName/,
  );
  assert.match(styles, /\.award-budget-name/);
});
