import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("custom stages are queried only for the linked institution and business round", async () => {
  const [store, route, calendar] = await Promise.all([
    readFile(new URL("../lib/organization-schedules.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/schedules/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/home-calendar.tsx", import.meta.url), "utf8"),
  ]);
  const options = store.slice(store.indexOf("export async function listConstructionStageOptions"));
  assert.match(options, /if \(!organization\) return \[\.\.\.CONSTRUCTION_STAGES\]/);
  assert.match(options, /AND organization = \?/);
  assert.match(options, /AND business_round = \?/);
  assert.match(route, /listConstructionStageOptions\([\s\S]*organization[\s\S]*businessRound/);
  assert.match(calendar, /editor\.kind !== "시공"[\s\S]*setConstructionStages\(\[\.\.\.CONSTRUCTION_STAGES\]\)/);
  assert.match(calendar, /organization: editor\.organization[\s\S]*businessRound:/);
});
