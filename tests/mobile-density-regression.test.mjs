import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const readability = await readFile(new URL("../app/readability.css", import.meta.url), "utf8");
const resources = await readFile(new URL("../app/resource-library-page.tsx", import.meta.url), "utf8");

test("dashboard activity tabs keep Korean labels on one line on mobile", () => {
  assert.match(styles, /\.dashboard-activity-scope button \{[\s\S]*?white-space: nowrap;[\s\S]*?word-break: keep-all;/);
});

test("project document filters fit the mobile modal without clipped scrolling", () => {
  assert.match(styles, /\.project-documents-filters \{[\s\S]*?grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);[\s\S]*?overflow: visible;/);
});

test("unified institution rows become compact mobile cards", () => {
  assert.match(readability, /\.unified-management-table \.unified-management-row \{[\s\S]*?grid-template-areas:[\s\S]*?"execution assignee assignee" !important;/);
  assert.match(readability, /\.unified-management-table td:nth-child\(4\) \{ display: block !important; grid-area: region !important;/);
  assert.match(readability, /content: "예산·계약";/);
  assert.match(readability, /\.unified-management-table \.management-detail-button \{[\s\S]*?align-items: center !important;[\s\S]*?justify-content: center !important;[\s\S]*?text-align: center !important;/);
});

test("resource downloads are visually prioritized before edit actions on mobile", () => {
  assert.match(resources, /className="resource-attachment-download"/);
  assert.match(resources, />다운로드<\/b>/);
  assert.match(styles, /\.resource-post-details \{\s*order: 2;/);
  assert.match(styles, /\.resource-post-actions \{\s*order: 3;/);
});

test("expanded construction schedule removes the extra hint row and keeps reset inline", () => {
  assert.match(styles, /\.construction-schedule-workspace\.is-expanded \.construction-order-hint \{\s*display: none;/);
  assert.match(styles, /\.construction-schedule-workspace\.is-expanded\.is-mobile-expanded \.construction-schedule-search \{\s*grid-template-columns: minmax\(0, 1fr\) auto auto(?: !important)?;/);
});
