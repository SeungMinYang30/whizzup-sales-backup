import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("예산별 기관 요약 카드는 선정 유형과 진행 상태를 눌러 필터링한다", async () => {
  const page = await source("../app/sales-map.tsx");

  assert.match(
    page,
    /type BudgetQuickFilter =[\s\S]*"whizzup"[\s\S]*"other"[\s\S]*"post-award"[\s\S]*"complete"/,
  );
  assert.match(
    page,
    /budgetQuickFilter === "whizzup"[\s\S]*currentAwardStatus !== "위즈업 수주"/,
  );
  assert.match(
    page,
    /budgetQuickFilter === "other"[\s\S]*currentAwardStatus !== "타업체 수주"/,
  );
  assert.match(
    page,
    /budgetQuickFilter === "post-award"[\s\S]*budgetTargetStatus\(target\) !== "수주 후 진행"/,
  );
  assert.match(
    page,
    /budgetQuickFilter === "complete"[\s\S]*budgetTargetStatus\(target\) !== "완료"/,
  );
  assert.match(
    page,
    /<span>위즈업 선정<\/span>[\s\S]*<span>타업체 선정<\/span>[\s\S]*<span>수주 후 진행<\/span>[\s\S]*<span>완료<\/span>/,
  );
  assert.match(
    page,
    /current === "complete" \? "" : "complete"/,
  );
});

test("예산별 기관은 수주 전 세부 영업 단계를 진행 중으로 통합한다", async () => {
  const page = await source("../app/sales-map.tsx");
  const statusResolver = page.slice(
    page.indexOf("function budgetTargetStatus"),
    page.indexOf("function budgetTargetSelection"),
  );

  assert.match(
    statusResolver,
    /awardStage === "미정" \|\| awardStage === "해당 없음"[\s\S]*"위즈업 선정"[\s\S]*"수주 후 진행"/,
  );
  assert.match(statusResolver, /"타업체 선정"/);
  assert.match(statusResolver, /return "진행 중"/);
  assert.doesNotMatch(
    statusResolver,
    /currentStatus|신규 접촉|상담 진행|제안·견적|결과 대기|재영업 상담/,
  );
  assert.match(
    page,
    /const budgetStatuses = \[[\s\S]*"진행 중"[\s\S]*"위즈업 선정"[\s\S]*"타업체 선정"[\s\S]*"수주 후 진행"[\s\S]*"완료"/,
  );
});

test("위즈업과 타업체 선정 기관은 목록에서 시각적으로 구분한다", async () => {
  const page = await source("../app/sales-map.tsx");
  const styles = await source("../app/globals.css");

  assert.match(
    page,
    /budgetTargetSelection[\s\S]*위즈업 선정[\s\S]*타업체 선정/,
  );
  assert.match(page, /budget-selection-badge/);
  assert.match(styles, /\.budget-selection-badge\.whizzup/);
  assert.match(styles, /\.budget-selection-badge\.other/);
  assert.match(
    styles,
    /\.budget-institution-table tbody tr\.budget-selection-row\.other/,
  );
});

test("과거 자동 소급된 대표 담당자는 수동 배정과 고정 기록을 보존하며 복원한다", async () => {
  const manager = await source("../lib/sales-manager-normalization.ts");
  const records = await source("../lib/records-store.ts");

  assert.match(manager, /auto_backfilled_owner_progress_manager_repair_v2/);
  assert.match(manager, /AUTO_BACKFILLED_OWNER_PROGRESS_MANAGER = "양승민 이사"/);
  assert.match(
    manager,
    /UPDATE sales_campaign_targets[\s\S]*SET assigned_member_id = NULL/,
  );
  assert.match(
    manager,
    /SET progress_manager = ''[\s\S]*progress_manager_locked = 0/,
  );
  assert.match(
    manager,
    /NOT EXISTS \([\s\S]*activities fixed[\s\S]*fixed\.progress_manager_locked = 1/,
  );
  assert.match(
    manager,
    /NOT EXISTS \([\s\S]*activity_assignment_history history[\s\S]*history\.to_manager/,
  );
  assert.match(
    records,
    /await repairAutoBackfilledOwnerProgressManagers\(d1\)/,
  );
});
