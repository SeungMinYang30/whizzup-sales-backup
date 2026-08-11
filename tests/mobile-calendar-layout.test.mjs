import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("mobile calendar uses a compact continuous grid", () => {
  const mobileCalendar = styles.slice(
    styles.indexOf("/* Mobile calendar: use a compact"),
  );

  assert.match(mobileCalendar, /@media \(max-width: 700px\)/);
  assert.match(
    mobileCalendar,
    /\.home-calendar-day \{[\s\S]*border-radius: 0 !important;[\s\S]*box-shadow: none !important;/,
  );
  assert.match(
    mobileCalendar,
    /\.home-calendar-filters \{[\s\S]*flex-wrap: nowrap;[\s\S]*overflow-x: auto;/,
  );
  assert.match(
    mobileCalendar,
    /\.home-calendar-day-items > span:nth-child\(n\+4\)/,
  );
  assert.match(
    mobileCalendar,
    /\.home-calendar-month-controls \.home-calendar-add[\s\S]*font-size: 0;/,
  );
});
