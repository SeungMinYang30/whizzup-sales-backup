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
