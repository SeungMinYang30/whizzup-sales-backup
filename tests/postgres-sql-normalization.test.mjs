import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adapter = await readFile(new URL("../db/index.ts", import.meta.url), "utf8");

test("dynamic SQLite datetime modifiers become one PostgreSQL interval expression", () => {
  const dynamicModifier = adapter.indexOf(
    '"(CURRENT_TIMESTAMP + CAST(? AS interval))"',
  );
  const genericDateTime = adapter.indexOf(
    '.replace(/datetime\\(([^)]+)\\)/gi, "($1)::timestamptz")',
  );
  assert.ok(dynamicModifier >= 0, "dynamic datetime modifier translation is missing");
  assert.ok(
    genericDateTime > dynamicModifier,
    "dynamic datetime modifiers must be handled before generic datetime casts",
  );
  assert.ok(adapter.includes('"(CURRENT_TIMESTAMP + INTERVAL \'$1 $2\')"'));
});

test("remaining SQLite INSTR calls use PostgreSQL STRPOS", () => {
  assert.ok(adapter.includes('.replace(/\\bINSTR\\s*\\(/gi, "STRPOS(")'));
});
