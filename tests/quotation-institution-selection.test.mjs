import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../app/quotation-management-page.tsx", import.meta.url),
  "utf8",
);

test("institution detail handoff fills the quotation recipient immediately", () => {
  const transferredTarget = page.slice(
    page.indexOf("const openTransferredTarget"),
    page.indexOf("function updateItem"),
  );
  assert.match(
    transferredTarget,
    /setInstitutionQuery\(target\.scope\.organization\)/,
  );
  assert.match(transferredTarget, /beginEditor\(draftForScope\(target\.scope\)\)/);
});

test("clicking an institution result commits its name before loading items", () => {
  const selection = page.slice(
    page.indexOf("async function selectInstitution"),
    page.indexOf("async function selectBusinessRound"),
  );
  const commitIndex = selection.indexOf(
    "setInstitutionQuery(selectedRound.organization)",
  );
  const loadIndex = selection.indexOf("await loadInstitutionItems(targetDraft)");
  assert.ok(commitIndex >= 0);
  assert.ok(loadIndex > commitIndex);
});
