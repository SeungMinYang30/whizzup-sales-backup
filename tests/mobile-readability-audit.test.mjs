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
  assert.match(
    finalMobile,
    /\.records-panel:has\(\.awards-table\) \.filter-row \{[\s\S]*grid-template-columns: repeat\(3/,
  );
  assert.match(
    finalMobile,
    /\.records-panel:has\(\.awards-table\) \.records-heading-actions > button:disabled \{[\s\S]*display: none;/,
  );
  assert.match(
    finalMobile,
    /\.awards-table td \{[\s\S]*height: auto !important;[\s\S]*min-height: 0;/,
  );
  assert.match(
    finalMobile,
    /\.awards-table td:nth-child\(9\) \{[\s\S]*display: block;[\s\S]*grid-row: 3;/,
  );
  assert.match(
    finalMobile,
    /\.awards-table td:nth-child\(10\),[\s\S]*\.awards-table td:nth-child\(12\) \{ display: none; \}/,
  );
  assert.match(finalMobile, /\.schedule-editor-actions[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(finalMobile, /\.quote-studio-topbar nav[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(calendar, /data-mobile-label="삭제"/);
  assert.match(quotation, /quote-topbar-cancel/);
});

test("pre-award institution cards remove desktop cell heights and group mobile information", async () => {
  const [styles, crm] = await Promise.all([
    read("../app/readability.css"),
    read("../app/crm-app.tsx"),
  ]);
  const finalMobile = styles.slice(styles.lastIndexOf("@media (max-width: 760px)"));
  assert.match(
    finalMobile,
    /\.followup-management \.records-heading-actions \{ display: none !important; \}/,
  );
  assert.match(
    finalMobile,
    /\.followup-table td \{[\s\S]*height: auto !important;[\s\S]*min-height: 0;/,
  );
  assert.match(
    finalMobile,
    /\.followup-table td:nth-child\(5\) \{ grid-column: 2; grid-row: 1; \}/,
  );
  assert.match(
    finalMobile,
    /\.followup-table td:nth-child\(8\) \{[\s\S]*grid-row: 2;[\s\S]*background: #f8faff;/,
  );
  assert.match(
    finalMobile,
    /\.followup-table td:nth-child\(10\),[\s\S]*\.followup-table td:nth-child\(11\) \{ display: none; \}/,
  );
  assert.match(finalMobile, /-webkit-line-clamp: 2/);
  assert.match(crm, /institution-mobile-selection-bar/);
});

test("mobile quotation tools share one row and modal content stays above fixed actions", async () => {
  const [styles, quotation] = await Promise.all([
    read("../app/globals.css"),
    read("../app/quotation-management-page.tsx"),
  ]);
  const compactEditors = styles.slice(styles.indexOf("/* Keep mobile quotation editors compact"));
  assert.match(styles, /\.quotation-item-toolbar-actions > button:first-child \{ grid-column: auto; \}/);
  assert.match(compactEditors, /\.equipment-kit-table-wrap\{[\s\S]*flex:1 1 auto;/);
  assert.match(
    compactEditors,
    /\.equipment-kit-toolbar>div\{[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/,
  );
  assert.match(quotation, /className="quote-internal-report-body"/);
  assert.match(compactEditors, /\.quote-internal-report-body\{[\s\S]*overflow-y:auto;/);
  assert.match(compactEditors, /\.quote-internal-report-formula\{[\s\S]*display:none;/);
  assert.match(compactEditors, /\.quote-internal-report-dialog>footer\{[\s\S]*position:static;/);
});

test("mobile quotation cards stay compact and the equipment picker uses the viewport", async () => {
  const [styles, quotation] = await Promise.all([
    read("../app/globals.css"),
    read("../app/quotation-management-page.tsx"),
  ]);
  const mobileEditors = styles.slice(styles.indexOf("/* Mobile PDF, equipment picker"));
  assert.match(mobileEditors, /\.equipment-kit-editor-shell\{[\s\S]*align-items:flex-start;[\s\S]*padding:6px;/);
  assert.match(mobileEditors, /\.equipment-kit-editor\{[\s\S]*height:calc\(100dvh - 12px\);/);
  assert.match(mobileEditors, /\.quotation-item-card-section\{[\s\S]*margin:6px;/);
  assert.match(mobileEditors, /\.quotation-item-card-summary\{[\s\S]*grid-template-columns:repeat\(2/);
  assert.match(mobileEditors, /\.quotation-item-card-controls\{[\s\S]*grid-template-columns:repeat\(2/);
  assert.match(mobileEditors, /\.quotation-item-internal-cost:not\(:has\(>label:first-child input:checked\)\)/);
  assert.match(mobileEditors, /\.quotation-item-card-note\{[\s\S]*grid-template-columns:42px/);
  assert.match(quotation, /reopenProductResultsAfterEquipmentRef/);
  assert.match(quotation, /if \(opensEquipmentEditor\) \{[\s\S]*setProductResultsOpen\(false\);/);
  assert.match(quotation, /function closeEquipmentKitEditor\(\)[\s\S]*restoreProductResultsAfterEquipment\(\);/);
  assert.match(quotation, /setDraft\([\s\S]*closeEquipmentKitEditor\(\);/);
  assert.match(mobileEditors, /\.equipment-kit-editor>header p\{[\s\S]*display:none;/);
  assert.match(mobileEditors, /\.equipment-kit-guide\{[\s\S]*display:none;/);
  assert.match(mobileEditors, /\.equipment-kit-toolbar>div\{[\s\S]*display:contents;/);
  assert.match(mobileEditors, /\.equipment-kit-table-wrap\{[\s\S]*min-height:180px;/);
});
