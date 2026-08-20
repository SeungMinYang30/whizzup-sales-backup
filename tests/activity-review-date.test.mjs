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

test("상담 내용 보완은 실제 연락 활동에만 적용하고 기타 기록에는 소급 적용하지 않는다", () => {
  const start = crm.indexOf("function activityReviewFields(");
  const end = crm.indexOf("function activityReviewSignature(", start);
  const reviewFields =
    start >= 0 && end > start ? crm.slice(start, end) : "";

  assert.match(
    reviewFields,
    /if \(contactActivity && !record\.summary\.trim\(\)\)/,
  );
  assert.match(
    reviewFields,
    /contactActivity &&[\s\S]*"contactEmail"[\s\S]*"담당자 이메일이 비어 있습니다\."/,
  );
});
