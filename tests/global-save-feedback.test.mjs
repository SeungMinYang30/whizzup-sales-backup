import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("root layout installs one common save failure notifier", async () => {
  const [layout, feedback] = await Promise.all([
    read("../app/layout.tsx"),
    read("../app/global-save-feedback.tsx"),
  ]);
  assert.match(layout, /<GlobalSaveFeedback \/>/);
  assert.match(feedback, /MUTATION_METHODS = new Set\(\["POST", "PUT", "PATCH", "DELETE"\]\)/);
  assert.match(feedback, /response\.clone\(\)/);
  assert.match(feedback, /NON_SAVE_API_PREFIXES/);
  assert.match(feedback, /\/api\/standby-sync/);
  assert.match(feedback, /document\.addEventListener\("invalid", handleInvalid, true\)/);
  assert.match(feedback, /role="alertdialog" aria-modal="true"/);
  assert.match(feedback, /누락 항목 보기/);
  assert.match(feedback, /event\.preventDefault\(\)/);
  assert.match(feedback, /target\.scrollIntoView/);
  assert.doesNotMatch(feedback, /target\.focus/);
});

test("quotation save opens one common dialog without focusing an input or duplicating an inline warning", async () => {
  const quotation = await read("../app/quotation-management-page.tsx");
  assert.match(quotation, /missingFields\.map\(\(field\) => field\.message\)/);
  assert.match(quotation, /showGlobalSaveError\(errorMessage, missingFields\[0\]\.selector\)/);
  assert.doesNotMatch(quotation, /className="quote-save-error"/);
  assert.doesNotMatch(quotation, /target\?\.focus/);
  assert.match(quotation, /data-save-field="organization"/);
  assert.match(quotation, /data-save-item-id=\{item\.id\}/);
});
