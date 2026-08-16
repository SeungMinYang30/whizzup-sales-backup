import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, calendar] = await Promise.all([
  readFile(new URL("../app/api/schedules/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/home-calendar.tsx", import.meta.url), "utf8"),
]);

test("direct Sites standby loads Google events through the read-only ICS feed", () => {
  assert.match(route, /url\.hostname\.endsWith\("\.chatgpt\.site"\)/);
  assert.match(route, /directSitesStandby[\s\S]*?listReadOnlyGoogleCalendarRange\(start, end\)/);
  assert.match(route, /standbyGoogle\.events/);
  assert.match(route, /googleCalendarWritable:\s*false/);
  assert.match(route, /googleRefreshPending:\s*!directSitesStandby/);
});

test("read-only Sites reconciliation excludes Google events already linked in replicated data", async () => {
  const [sync, feed] = await Promise.all([
    readFile(new URL("../lib/google-calendar-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/google-calendar-feed.ts", import.meta.url), "utf8"),
  ]);
  assert.match(sync, /SELECT google_event_id[\s\S]*?organization_schedules/);
  assert.match(sync, /linkedEventIds\.has\(normalizeGoogleCalendarEventId\(event\.googleEventId/);
  assert.match(feed, /replace\(\/@google\\\.com\$\/i, ""\)/);
});

test("direct standby never requests the full Google reconciliation path", () => {
  assert.match(
    calendar,
    /!window\.location\.hostname\.endsWith\("\.chatgpt\.site"\)/,
  );
  assert.match(route, /await reconcileGoogleCalendarRange\(start, end\)/);
});
