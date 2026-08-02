import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const crm = fs.readFileSync(path.join(root, "app", "crm-app.tsx"), "utf8");

test("activity date never creates a my-record-review issue", () => {
  const start = crm.indexOf("function activityReviewFields(");
  const end = crm.indexOf("function activityReviewSignature(", start);
  const reviewFields =
    start >= 0 && end > start ? crm.slice(start, end) : "";

  assert.ok(reviewFields, "activityReviewFields function should exist");
  assert.doesNotMatch(reviewFields, /"activityDate"/);
  assert.doesNotMatch(reviewFields, /dateConfidence/);
});
