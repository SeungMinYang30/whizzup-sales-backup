import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");

test("direct quotations deduct internal costs instead of adding them to item margin", () => {
  assert.match(
    page,
    /const consortiumBearsInternalCost = draft\.executionType === "컨소"[\s\S]*?const settledConsortiumPayment = consortiumBearsInternalCost[\s\S]*?expectedEarning - settledConsortiumPayment - \(consortiumBearsInternalCost \? 0 : internalCost\)/,
  );
});
