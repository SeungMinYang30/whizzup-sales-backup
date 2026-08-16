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
  assert.match(feedback, /role="alert" aria-live="assertive"/);
});

test("quotation save reports missing fields in the open editor and focuses the first one", async () => {
  const quotation = await read("../app/quotation-management-page.tsx");
  assert.match(quotation, /const \[saveError, setSaveError\] = useState\(""\)/);
  assert.match(quotation, /missingFields\.map\(\(field\) => field\.message\)/);
  assert.match(quotation, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(quotation, /className="quote-save-error" role="alert"/);
  assert.match(quotation, /data-save-field="organization"/);
  assert.match(quotation, /data-save-item-id=\{item\.id\}/);
});
