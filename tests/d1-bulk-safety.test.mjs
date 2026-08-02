import assert from "node:assert/strict";
import test from "node:test";
import { chunkValues } from "../lib/d1-bulk.ts";

function verifyChunks(total, size) {
  const values = Array.from({ length: total }, (_, index) => index + 1);
  const chunks = chunkValues(values, size);
  assert.deepEqual(chunks.flat(), values);
  assert.ok(chunks.every((chunk) => chunk.length > 0));
  assert.ok(chunks.every((chunk) => chunk.length <= size));
  assert.equal(chunks.length, Math.ceil(total / size));
}

test("change-ledger writes remain bounded at every requested validation size", () => {
  for (const total of [1, 3, 50, 500, 1_100]) {
    verifyChunks(total, 8);
  }
});

test("map work remains bounded for 1, 100, and 300 institutions", () => {
  for (const total of [1, 100, 300]) {
    verifyChunks(total, 50);
  }
});

test("trash lookups and large restores remain bounded", () => {
  for (const total of [1, 50, 300, 1_100]) {
    verifyChunks(total, 50);
    verifyChunks(total, 40);
  }
});
