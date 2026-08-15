import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("mobile header keeps action labels visible and status cards horizontally readable", async () => {
  const styles = await read("../app/readability.css");
  const audit = styles.slice(styles.indexOf("/* Mobile audit pass"));
  assert.match(audit, /\.topbar\.has-dashboard-status[\s\S]*display: grid/);
  assert.match(audit, /\.top-actions \.ai-button[\s\S]*font-size: 10px/);
  assert.doesNotMatch(audit, /\.top-actions \.ai-button[\s\S]{0,180}font-size: 0/);
  assert.match(audit, /\.dashboard-status-strip[\s\S]*scroll-snap-type: x proximity/);
});

test("mobile calendar shortens only the visible grid label and preserves the full institution name", async () => {
  const [calendar, styles] = await Promise.all([
    read("../app/home-calendar.tsx"),
    read("../app/readability.css"),
  ]);
  assert.match(calendar, /compactCalendarOrganization/);
  assert.match(calendar, /calendar-organization-full/);
  assert.match(calendar, /calendar-organization-compact/);
  assert.match(styles, /\.calendar-organization-full \{ display: none; \}/);
  assert.match(styles, /\.calendar-organization-compact[\s\S]*display: inline/);
});

test("mobile workspaces use cards or explicit internal scrolling instead of page overflow", async () => {
  const styles = await read("../app/readability.css");
  const audit = styles.slice(styles.indexOf("/* Mobile audit pass"));
  assert.match(audit, /\.quote-studio-topbar nav[\s\S]*overflow-x: auto/);
  assert.match(audit, /\.award-vendor-list[\s\S]*overflow-x: auto/);
  assert.match(audit, /\.resource-post-card[\s\S]*border-radius: 12px/);
  assert.match(audit, /\.accounting-table th:first-child[\s\S]*position: sticky/);
});

test("post-award cards and modal action bars are compact and fully visible", async () => {
  const [styles, calendar, quotation] = await Promise.all([
    read("../app/readability.css"),
    read("../app/home-calendar.tsx"),
    read("../app/quotation-management-page.tsx"),
  ]);
  const finalMobile = styles.slice(styles.lastIndexOf("@media (max-width: 760px)"));
  assert.match(finalMobile, /\.awards-table td:nth-child\(12\)[\s\S]*grid-row: 6/);
  assert.match(finalMobile, /\.schedule-editor-actions[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(finalMobile, /\.quote-studio-topbar nav[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(calendar, /data-mobile-label="삭제"/);
  assert.match(quotation, /quote-topbar-cancel/);
});
