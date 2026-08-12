import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("quotation final-save lock converts SQLite relative datetime to a PostgreSQL interval", () => {
  return Promise.all([
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/quotations/files/route.ts", import.meta.url), "utf8"),
  ]).then(([adapter, filesRoute]) => {
    assert.match(filesRoute, /datetime\('now', '-10 minutes'\)/);
    assert.match(adapter, /second\|minute\|hour\|day/);
    assert.match(adapter, /CURRENT_TIMESTAMP - INTERVAL/);
    assert.match(adapter, /\$\{amount\} \$\{unit\}s/);
  });
});
