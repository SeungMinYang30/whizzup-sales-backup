import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("aligns post-award columns and keeps the team view on a 30-day default", async () => {
  const [crm, styles] = await Promise.all([
    fs.readFile(new URL("app/crm-app.tsx", root), "utf8"),
    fs.readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(crm, /useState<TeamPeriod>\(30\)/);
  assert.match(crm, /teamPeriodDays !== 30/);
  assert.match(crm, /setTeamPeriodDays\(30\)/);
  assert.doesNotMatch(crm, />\s*7일\s*<\/button>/);
  assert.doesNotMatch(crm, />\s*전체 직원\s*<\/button>/);
  assert.match(crm, /const selectingMember =\s*selectedTeamMember !== metric\.name/);
  assert.match(crm, /selectingMember \? metric\.name : "전체"/);

  assert.match(
    crm,
    /<th>수주일<\/th>\s*<th>지역<\/th>\s*<th>기관<\/th>\s*<th>예산<\/th>\s*<th>계약금액<\/th>\s*<th>사업방식<\/th>\s*<th>수주업체<\/th>\s*<th>컨소 업체<\/th>\s*<th>수주 진행 상태<\/th>\s*<th>진행 담당자<\/th>/,
  );
  assert.doesNotMatch(crm, /<th>최근 진행 내용<\/th>/);
  assert.match(crm, /hasResolvedStandardBudget\(record\)/);
  assert.match(crm, /\["auto", "approved", "matched"\]/);
  assert.match(crm, /표준 예산 연결 필요/);
  assert.match(styles, /\.awards-table \{ min-width: 1410px; \}/);
});
