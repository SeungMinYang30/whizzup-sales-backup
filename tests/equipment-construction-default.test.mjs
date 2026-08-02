import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("construction cost defaults to the quoted amount until manually changed", () => {
  const crm = readFileSync(
    new URL("../app/crm-app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(crm, /project\.constructionAmount === null\s*\? "0"/);
  assert.match(
    crm,
    /project\.actualConstructionCost === null\s*\? constructionAmount/,
  );
  assert.match(crm, /if \(!actualConstructionCostCustomized\) \{\s*setActualConstructionCostDraft\(nextAmount\)/);
  assert.match(crm, /setActualConstructionCostCustomized\(true\)/);
  assert.match(
    crm,
    /\} = calculateConstructionFinance\(project\)/,
  );
  assert.doesNotMatch(
    crm,
    /const actualConstructionCost = project\.actualConstructionCost \?\? 0/,
  );
});
