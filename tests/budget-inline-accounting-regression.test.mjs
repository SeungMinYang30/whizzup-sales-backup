import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

test("표준 예산 기본금액은 선택 입력이고 기존 금액과 견적 자동계산을 덮어쓰지 않는다", async () => {
  const [migration, budgetNames, selector, crm] = await Promise.all([
    source("../drizzle/0052_budget_default_amount.sql"),
    source("../lib/budget-names.ts"),
    source("../app/budget-name-selector.tsx"),
    source("../app/crm-app.tsx"),
  ]);
  assert.match(migration, /ADD `default_amount` integer/);
  assert.match(budgetNames, /default_amount/);
  assert.match(selector, /defaultBudgetAmount: option\.defaultAmount/);
  assert.match(crm, /preservesExistingManualAmount/);
  assert.match(crm, /quoteAvailable[\s\S]*defaultAmount/);
  assert.match(crm, /defaultAmount \|\| current\.budgetAmount/);
});

test("연결 기록은 삭제 대신 다른 표준 예산명으로 공통 로직을 통해 이동한다", async () => {
  const [manager, route, budgetNames] = await Promise.all([
    source("../app/budget-name-manager.tsx"),
    source("../app/api/budget-names/route.ts"),
    source("../lib/budget-names.ts"),
  ]);
  assert.match(manager, /다른 예산명으로 변경/);
  assert.match(manager, /고급 작업/);
  assert.match(route, /action === "move-member"/);
  assert.match(budgetNames, /export async function moveBudgetMember/);
  assert.match(budgetNames, /connectBudgetRowsToGroup/);
  assert.match(budgetNames, /memberIds,[\s\S]*members: rows/);
  assert.match(budgetNames, /targets: rows\.map/);
  assert.match(budgetNames, /ORDER BY m\.group_id, m\.id DESC/);
  assert.doesNotMatch(budgetNames, /ORDER BY group_id, id DESC/);
});

test("표준 예산명 연결 기록 조회는 여러 테이블의 id를 혼동하지 않는다", async () => {
  const budgetNames = await source("../lib/budget-names.ts");
  const queryBlock = budgetNames.match(
    /`SELECT m\.id,[\s\S]*?ORDER BY m\.group_id, m\.id DESC`/,
  )?.[0];
  assert.ok(queryBlock);

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE budget_name_members (
      id INTEGER, group_id INTEGER, entity_type TEXT, entity_id INTEGER,
      original_name TEXT, alias_key TEXT, active INTEGER
    );
    CREATE TABLE activities (
      id INTEGER, organization TEXT, activity_date TEXT, business_round INTEGER,
      topic TEXT, progress_manager TEXT, award_status TEXT
    );
    CREATE TABLE equipment_projects (
      id INTEGER, activity_id INTEGER, organization TEXT, name TEXT
    );
  `);
  assert.doesNotThrow(() =>
    database.prepare(queryBlock.slice(1, -1)).all(),
  );
  database.close();
});

test("내 기록 점검은 기관별로 묶고 공통 연락처와 기록별 확인을 분리한다", async () => {
  const crm = await source("../app/crm-app.tsx");
  assert.match(crm, /const pendingActivityReviewGroups = useMemo/);
  assert.match(crm, /institutionAliasKey\(record\.organization\)/);
  assert.match(crm, /기관 공통 연락처/);
  assert.match(crm, /updateActivityReviewGroupDraft/);
  assert.match(crm, /관련 영업 기록 \{group\.records\.length\}건/);
  assert.match(crm, /completeActivityReviewGroup/);
});

test("기관 상세 카드는 같은 화면에서 저장하고 영업·수주 진행상황을 구분한다", async () => {
  const crm = await source("../app/crm-app.tsx");
  for (const field of [
    "activityType",
    "budget",
    "contact",
    "status",
    "awardStage",
    "execution",
    "progressManager",
  ]) {
    assert.match(
      crm,
      new RegExp(`beginDetailInlineEdit\\([\\s\\S]{0,80}"${field}"`),
    );
  }
  assert.match(crm, /statusManual:\s*field === "status" \? true/);
  assert.match(crm, /\/api\/records\/assignee/);
  assert.match(crm, /<span>수주 진행단계<\/span>/);
  assert.match(crm, /awardStageOptions\.map/);
  assert.match(crm, /완료일이 오늘로 기록되고 재연락 표시와 예정일은 자동으로 해제/);
  assert.match(crm, /납품 완료일은 해제되며 완료 기준 통계에서도 제외/);
  assert.match(crm, /detailDisplayRecord\.awardStatus === "미정"[\s\S]*"수주 전"/);
  assert.match(crm, /detailDisplayRecord\.awardStatus === "타업체 수주"[\s\S]*"해당 없음"/);
  assert.doesNotMatch(crm, /예산 정보 수정/);
});

test("수금 화면은 실제 수금과 정산 기준, 공헌이익을 구분한다", async () => {
  const accounting = await source("../app/accounting-page.tsx");
  assert.match(accounting, /누적 실제 수금액/);
  assert.match(accounting, /컨소 정산 기준액/);
  assert.match(accounting, /미수수익 예상액/);
  assert.match(accounting, /수금 기준 공헌이익/);
  assert.match(accounting, /entry\.commissionCollectedAmount -[\s\S]*directSupplyCostBasis\(entry\)[\s\S]*entry\.expectedConsortiumSettlement/);
  assert.match(accounting, /if \(!isCollectionComplete\(entry\)\)/);
  assert.match(accounting, /회계 담당자는 실제로 받은 금액과 날짜만 입력/);
});

test("제품 견적 표는 텍스트와 수치 정렬을 나누고 열 경계를 표시한다", async () => {
  const styles = await source("../app/globals.css");
  assert.match(
    styles,
    /\.product-catalog-table th,[\s\S]*border-right: 1px solid #edf0f5/,
  );
  assert.match(
    styles,
    /\.product-catalog-table td:nth-child\(3\),[\s\S]*text-align: center/,
  );
  assert.match(
    styles,
    /\.product-catalog-table th:nth-child\(8\),[\s\S]*border-left: 1px solid #dfe5ef/,
  );
});

test("표준 예산명 관리 화면은 주요 메뉴와 입력 글자를 읽기 쉽게 표시한다", async () => {
  const [manager, styles] = await Promise.all([
    source("../app/budget-name-manager.tsx"),
    source("../app/globals.css"),
  ]);
  assert.match(
    styles,
    /\.manager-admin-tabs button[\s\S]*font-size: 15px/,
  );
  assert.match(
    styles,
    /\.budget-manager-tabs button[\s\S]*font-size: 14px/,
  );
  assert.match(
    styles,
    /\.budget-name-manager input,[\s\S]*font-size: 14px/,
  );
  assert.match(
    styles,
    /\.budget-member-details strong[\s\S]*font-size: 15px/,
  );
  assert.match(
    styles,
    /\.budget-member-details small[\s\S]*font-size: 13px/,
  );
  assert.match(manager, /영업 기록/);
  assert.match(manager, /사업 기록/);
});

test("같은 영업에서 이어진 수주 사업은 한 사업으로 묶고 함께 예산명을 변경한다", async () => {
  const [manager, budgetNames] = await Promise.all([
    source("../app/budget-name-manager.tsx"),
    source("../lib/budget-names.ts"),
  ]);
  assert.match(manager, /function budgetBusinessKey/);
  assert.match(manager, /function groupBudgetBusinessMembers/);
  assert.match(manager, /연결된 사업 보기/);
  assert.match(manager, /원본 기록/);
  assert.match(manager, /memberIds,/);
  assert.match(manager, /영업 기록 \$\{activityCount\}건/);
  assert.match(manager, /사업 기록 \$\{projectCount\}건/);
  assert.match(budgetNames, /END AS activityId/);
  assert.match(
    budgetNames,
    /한 사업의 영업·사업 기록 \$\{rows\.length\}건/,
  );
});

test("불러온 예산명은 그대로 대표 표준명이 되고 같은 이름을 별칭으로 중복 표시하지 않는다", async () => {
  const manager = await source("../app/budget-name-manager.tsx");
  assert.match(manager, /!wasSelected && !clean\(newName\)/);
  assert.match(manager, /setNewName\(name\)/);
  assert.match(manager, /선택 이름을 표준 예산명으로 등록/);
  assert.match(manager, /const additionalAliases = group\.aliases\.filter/);
  assert.match(manager, /추가로 등록된 별칭이 없습니다/);
});
