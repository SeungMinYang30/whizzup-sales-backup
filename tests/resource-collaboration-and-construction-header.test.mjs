import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateConstructionDashboardCounts } from "../lib/construction-dashboard.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("시공·납품 상단 현황은 숨김·완료·시작일을 기준으로 계산한다", () => {
  const counts = calculateConstructionDashboardCounts(
    [
      { organization: "예정 기관", businessRound: 1, completed: false, hidden: false },
      { organization: "진행 기관", businessRound: 1, completed: false, hidden: false },
      { organization: "완료 기관", businessRound: 2, completed: true, hidden: false },
      { organization: "숨김 기관", businessRound: 1, completed: false, hidden: true },
    ],
    [
      { organization: "예정 기관", businessRound: 1, scheduledDate: "2026-08-11", completed: false },
      { organization: "진행 기관", businessRound: 1, scheduledDate: "2026-08-09", completed: false },
      { organization: "숨김 기관", businessRound: 1, scheduledDate: "2026-08-01", completed: false },
    ],
    "2026-08-10",
  );

  assert.deepEqual(counts, { planned: 1, active: 1, completed: 1 });
});

test("어느 메뉴에서 시작해도 시공·납품 현황을 조회하고 미조회 상태를 0으로 표시하지 않는다", async () => {
  const crm = await source("../app/crm-app.tsx");
  assert.match(crm, /requestConstructionDashboardCounts\(\)/);
  assert.match(crm, /scope=construction-board/);
  assert.match(crm, /constructionDashboardCounts\?\.planned \?\? "—"/);
});

test("승인된 구성원은 업로더와 관계없이 자료 글과 첨부파일을 수정할 수 있다", async () => {
  const [page, route, attachments] = await Promise.all([
    source("../app/resource-library-page.tsx"),
    source("../app/api/resources/route.ts"),
    source("../app/api/resources/attachments/route.ts"),
  ]);

  assert.doesNotMatch(page, /post\.createdBy === memberId/);
  assert.match(page, />수정<\/button>/);
  assert.doesNotMatch(route, /본인이 등록한 자료만 수정할 수 있습니다/);
  assert.doesNotMatch(attachments, /본인이 등록한 자료만 수정할 수 있습니다/);
  assert.match(route, /export async function DELETE[\s\S]*requireAdminMember\(\)/);
});
