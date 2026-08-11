import assert from "node:assert/strict";
import test from "node:test";

import {
  isConstructionStage,
  isValidConstructionStage,
} from "../lib/construction-stages.ts";

test("clear onsite work is classified as construction even when it is not a fixed stage", () => {
  for (const label of [
    "수납장 체결 및 기자재 이동",
    "복도 벽 유리 시공",
    "미납 가구 설치",
    "멀티미디어실 짐 이동",
    "사인물 설치",
    "청소",
  ]) {
    assert.equal(isConstructionStage(label), true, label);
  }
});

test("custom construction stage names are accepted but unsafe labels are rejected", () => {
  assert.equal(isValidConstructionStage("가구 보완 설치"), true);
  assert.equal(isValidConstructionStage(""), false);
  assert.equal(isValidConstructionStage("한 줄\n두 줄"), false);
  assert.equal(isValidConstructionStage("가".repeat(41)), false);
});
