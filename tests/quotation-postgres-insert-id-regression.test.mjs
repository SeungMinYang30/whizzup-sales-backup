import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("quotation insert obtains its PostgreSQL id with RETURNING", async () => {
  const source = await readFile(
    new URL("../lib/authored-quotations.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /INSERT INTO authored_quotations[\s\S]*?RETURNING id/);
  assert.match(source, /Number\(result\.results\[0\]\?\.id\)/);
  assert.doesNotMatch(source, /Number\(result\.meta\.last_row_id\)/);
});
