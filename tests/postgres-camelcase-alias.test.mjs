import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("PostgreSQL SQL normalization preserves camelCase result aliases", async () => {
  const source = await readFile(new URL("db/index.ts", root), "utf8");

  assert.match(
    source,
    /AS\\s\+\(\[a-z_\]\[A-Za-z0-9_\]\*\[A-Z\]\[A-Za-z0-9_\]\*\)\\b/,
  );
  assert.match(source, /'AS "\$1"'/);
});

test("budget queries do not reference quoted camelCase CTE aliases as lowercase identifiers", async () => {
  const source = await readFile(new URL("lib/budget-names.ts", root), "utf8");

  assert.match(source, /COUNT\(\*\) AS activity_count/);
  assert.match(source, /COUNT\(\*\) AS project_count/);
  assert.doesNotMatch(source, /activity\.activityCount|project\.projectCount/);
  assert.match(source, /ORDER BY "groupId"/);
  assert.match(source, /FROM budget_name_aliases WHERE COALESCE\(active, 1\) = 1/);
  assert.match(source, /WHERE COALESCE\(m\.active, 1\) = 1/);
  assert.match(source, /const groupId = Number\(alias\.groupId\)/);
  assert.match(source, /const groupId = Number\(member\.groupId\)/);
});
