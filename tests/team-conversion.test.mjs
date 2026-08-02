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
    /type TeamDetailMode = "activity" \| "attention" \| "conversion"/,
  );
  assert.match(crm, /const teamConversionRecords = useMemo/);
  assert.match(crm, /record\.awardStatus !== "위즈업 수주"/);
  assert.match(crm, /setTeamDetailMode\("conversion"\)/);
  assert.match(crm, /수주 기관 \$\{metric\.conversionWonCount\}곳 보기/);
  assert.match(crm, /수주 전환 기관/);
  assert.match(styles, /\.team-conversion-button/);
  assert.match(styles, /\.team-conversion-row/);
});
