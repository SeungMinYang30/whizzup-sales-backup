import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shows won institutions from the team conversion metric", async () => {
  const crm = await readFile(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );
  const styles = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(
    crm,
    /type TeamDetailMode = "activity" \| "organizations" \| "followup" \| "attention" \| "conversion"/,
  );
  assert.match(crm, /const teamConversionRecords = useMemo/);
  assert.match(crm, /record\.awardStatus !== "위즈업 수주"/);
  assert.match(crm, /setTeamDetailMode\("conversion"\)/);
  assert.match(crm, /수주 기관 \$\{metric\.conversionWonCount\}곳 보기/);
  assert.match(crm, /수주 전환 기관/);
  assert.match(styles, /\.team-conversion-button/);
  assert.match(styles, /\.team-conversion-row/);
});

test("접촉 기관과 후속 관리율은 관련 목록을 열고 활동 기록은 최신순으로 정렬한다", async () => {
  const crm = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(crm, /setTeamDetailMode\("organizations"\)/);
  assert.match(crm, /setTeamDetailMode\("followup"\)/);
  assert.match(crm, /const teamOrganizationRecords = useMemo/);
  assert.match(crm, /const teamFollowUpRecords = useMemo/);
  assert.match(crm, /right\.activityDate\.localeCompare\(left\.activityDate\) \|\| right\.id - left\.id/);
  assert.match(crm, /접촉 기관 \$\{metric\.organizationCount\}곳 보기/);
  assert.match(crm, /후속 관리 대상 \$\{metric\.followUpCount\}건 보기/);
  assert.match(styles, /\.team-metric-detail-button/);
});
