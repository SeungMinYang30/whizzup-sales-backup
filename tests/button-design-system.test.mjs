import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const salesMap = await readFile(
  new URL("../app/sales-map.tsx", import.meta.url),
  "utf8",
);

test("raised action buttons share one radius, border weight, font weight and shadow", () => {
  assert.match(styles, /--site-button-radius: 11px/);
  assert.match(styles, /--site-button-border: #c7d3e8/);
  assert.match(styles, /--site-button-shadow:/);
  assert.match(styles, /button:is\([\s\S]*\.app-button,[\s\S]*\.primary-button,[\s\S]*\) \{[\s\S]*border-width: 1px !important/);
  assert.match(styles, /border-radius: var\(--site-button-radius\) !important/);
  assert.match(styles, /font-weight: var\(--site-button-font-weight\) !important/);
  assert.match(styles, /box-shadow: var\(--site-button-shadow\) !important/);
  assert.doesNotMatch(styles, /(?:^|\n)button \{[^}]*--site-button-font-weight/);
});

test("primary, secondary and destructive buttons keep consistent semantic colors", () => {
  assert.match(styles, /button:is\(\.primary-button, \.app-button-primary\)/);
  assert.match(styles, /button:is\(\.secondary-button, \.ghost-button/);
  assert.match(styles, /button:is\(\.danger, \.danger-button, \.app-button-danger\)/);
  assert.match(styles, /button:is\([\s\S]*\):hover:not\(:disabled\)/);
  assert.match(styles, /button:focus-visible/);
});

test("institution history compact actions keep readable local typography", () => {
  assert.match(styles, /\.history-section-actions > button \{[\s\S]*font-size: 11px;[\s\S]*font-weight: 700;[\s\S]*box-shadow: none/);
  assert.match(styles, /\.history-section-actions > button\.history-primary-action \{[\s\S]*background: #4658db/);
});

test("campaign import toolbar uses three secondary actions and one primary action", () => {
  assert.match(salesMap, /className="campaign-manual-button"/);
  assert.match(salesMap, /className="campaign-pdf-button"/);
  assert.match(salesMap, /className="campaign-template-button"/);
  assert.match(salesMap, /className="campaign-import-button"/);
  assert.match(styles, /\.sales-campaign-actions :is\([\s\S]*\.campaign-template-button/);
  assert.match(styles, /\.sales-campaign-actions \.campaign-import-button/);
});

test("navigation and construction timeline cells stay flat", () => {
  assert.match(styles, /\.main-nav button \{[\s\S]*box-shadow: none !important/);
  assert.match(styles, /\.construction-institution-main,[\s\S]*\.construction-fixed-cells > \.construction-work-summary/);
  assert.match(styles, /\.construction-event \{[\s\S]*box-shadow: none !important/);
  assert.match(styles, /\.construction-row-remove \{[\s\S]*box-shadow: none !important/);
});
