import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, calendar] = await Promise.all([
  readFile(new URL("../app/api/schedules/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/home-calendar.tsx", import.meta.url), "utf8"),
]);

test("direct Sites standby loads Google events through the read-only ICS feed", () => {
  assert.match(route, /url\.hostname\.endsWith\("\.chatgpt\.site"\)/);
  assert.match(route, /directSitesStandby[\s\S]*?listGoogleCalendarSchedules\(start, end\)/);
  assert.match(route, /standbyGoogle\.events/);
  assert.match(route, /googleCalendarWritable:\s*false/);
  assert.match(route, /googleRefreshPending:\s*!directSitesStandby/);
});

test("direct standby never requests the full Google reconciliation path", () => {
  assert.match(
    calendar,
    /!window\.location\.hostname\.endsWith\("\.chatgpt\.site"\)/,
  );
  assert.match(route, /await reconcileGoogleCalendarRange\(start, end\)/);
});
