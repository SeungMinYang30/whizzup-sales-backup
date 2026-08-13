import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recordsRoute = await readFile(
  new URL("../app/api/records/route.ts", import.meta.url),
  "utf8",
);
const crmApp = await readFile(
  new URL("../app/crm-app.tsx", import.meta.url),
  "utf8",
);

test("record update lookup does not leave a trailing comma before FROM", () => {
  assert.doesNotMatch(
    recordsRoute,
    /budget_amount_override,\s*budgets_json,\s*FROM activities WHERE id = \?/,
  );
  assert.match(
    recordsRoute,
    /budget_amount_override,\s*budgets_json\s*FROM activities WHERE id = \?/,
  );
});

test("changing a budget selection resets the amount to the new budget default", () => {
  const changeChecks = crmApp.match(/const budgetSelectionChanged =/g) ?? [];
  const resetBranches = crmApp.match(/budgetSelectionChanged\s*\? defaultAmount/g) ?? [];
  assert.equal(changeChecks.length, 2);
  assert.equal(resetBranches.length, 2);
  assert.match(crmApp, /!budgetSelectionChanged\s*&&\s*hasExplicitBudgetAmount/);
});
