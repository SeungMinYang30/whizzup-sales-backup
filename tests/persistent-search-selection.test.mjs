import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const crm = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const map = await readFile(new URL("../app/sales-map.tsx", import.meta.url), "utf8");
const campaigns = await readFile(
  new URL("../app/api/map/campaigns/route.ts", import.meta.url),
  "utf8",
);

test("기관별 관리 수주 전후 선택은 검색어를 바꿔도 유지된다", () => {
  const awardReset = crm.match(
    /if \(view !== "awards"\) return;[\s\S]*?setSelectedAwardIds\(\[\]\);[\s\S]*?\}, \[([\s\S]*?)\]\);/,
  );
  const institutionReset = crm.match(
    /if \(view !== "followup"\) return;[\s\S]*?setSelectedInstitutionIds\(\[\]\);[\s\S]*?\}, \[([\s\S]*?)\]\);/,
  );
  assert.ok(awardReset);
  assert.ok(institutionReset);
  assert.doesNotMatch(awardReset[1], /\bsearch\b/);
  assert.doesNotMatch(institutionReset[1], /\bsearch\b/);
  assert.match(crm, /선택 전체 해제/g);
});

test("예산별 기관은 검색과 별개로 누적 선택하고 전체 해제할 수 있다", () => {
  assert.match(
    map,
    /setBudgetSelectedTargetIds\(\(current\) =>[\s\S]*new Set\(\[\.\.\.current, \.\.\.resultIds\]\)/,
  );
  assert.match(
    map,
    /setBudgetSelectedTargetIds\(\[\]\);[\s\S]*setBudgetBulkAssigneeId\(""\);[\s\S]*선택 전체 해제/,
  );
});

test("기존 활동 금액은 저장 단위 규칙으로 연결하고 과거 오변환 값도 보정한다", () => {
  assert.match(
    campaigns,
    /parseStoredActivityBudgetMoney\(row\.budget_amount\)/,
  );
  assert.match(
    campaigns,
    /JOIN activities activity ON activity\.id = target\.activity_id[\s\S]*Number\(row\.budget_amount\) !== oldParsedAmount/,
  );
});
