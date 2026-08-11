import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps desktop list controls visible without clipping rows", async () => {
  const [crm, catalog, styles] = await Promise.all([
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/product-catalog-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(crm, /--sticky-heading-height/);
  assert.match(crm, /manager-priority-header/);
  assert.match(crm, /manager-toolbar/);
  assert.match(catalog, /product-catalog-sticky-controls/);
  assert.match(catalog, /product-catalog-bulk-vendor/);
  assert.match(catalog, /product-catalog-column-head-scroll/);
  assert.match(catalog, /선택 · 품명/);
  assert.match(catalog, /stickyColumnHeaderRef\.current\.scrollLeft/);
  assert.match(
    styles,
    /\.records-panel:has\(\.data-list-workspace\) > \.records-heading/,
  );
  assert.match(styles, /\.manager-priority-panel > \.manager-toolbar/);
  assert.match(styles, /\.product-catalog-sticky-controls/);
  assert.match(styles, /\.product-catalog-column-head/);
  assert.match(styles, /grid-template-columns: 18% 20% 10% 14% 8% 10% 10% 10%/);
  assert.match(styles, /\.history-body > \.history-summary-grid/);
  assert.match(
    styles,
    /top: calc\(74px \+ var\(--sticky-heading-height, 75px\)\)/,
  );
  assert.match(
    styles,
    /\.data-list-workspace \{ min-height: 0; max-height: none; overflow: visible/,
  );
  assert.doesNotMatch(styles, /\.data-list-table \{ max-height: min\(/);
});
