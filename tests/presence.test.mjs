import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("limits live presence to the primary owner and refreshes it in near real time", async () => {
  const [route, collaboration, session, crm] = await Promise.all([
    readFile(new URL("../app/api/presence/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/collaboration.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(route, /requirePrimaryOwner\(\)/);
  assert.match(route, /-35 seconds/);
  assert.match(route, /last_seen_at = CURRENT_TIMESTAMP/);
  assert.match(collaboration, /ORDER BY id ASC/);
  assert.match(session, /canViewPresence/);
  assert.match(crm, /setInterval\(heartbeat, 60_000\)/);
  assert.match(crm, /whizzup-presence-heartbeat-leader/);
  assert.match(crm, /접속 중만 보기/);
  assert.match(crm, /구성원 관리/);
});
