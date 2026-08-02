import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/sales-map.tsx", import.meta.url), "utf8");

test("nearby school radius options are limited to 10km and 30km", () => {
  assert.match(source, /type NearbyRadius = 10 \| 30;/);
  assert.match(source, /\(\[10, 30\] as NearbyRadius\[\]\)\.map/);
  assert.doesNotMatch(source, /type NearbyRadius = .*50/);
  assert.doesNotMatch(source, /type NearbyRadius = .*100/);
});

test("automatic map lookup waits for the full record list and can resume after cancellation", () => {
  assert.match(source, /!recordsReady/);
  assert.match(
    source,
    /autoLocateAttemptedRef\.current\.delete\(item\.organization\)/,
  );
});
