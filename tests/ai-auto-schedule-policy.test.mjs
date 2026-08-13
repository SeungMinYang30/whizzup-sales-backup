import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedAiAutoSchedule,
  isApprovedShowroomAutoSchedule,
} from "../lib/ai-auto-schedule-policy.ts";

test("confirmed Whizzup or Airpass showroom demonstrations may auto-register", () => {
  assert.equal(isApprovedShowroomAutoSchedule("에어패스 쇼룸 시연"), true);
  assert.equal(isApprovedShowroomAutoSchedule("위즈업 시연"), true);
  assert.equal(isApprovedShowroomAutoSchedule("타 업체 쇼룸 시연"), false);
  assert.equal(isApprovedShowroomAutoSchedule("에어패스 시연 가능성 검토"), false);
  assert.equal(isApprovedShowroomAutoSchedule("에어패스 시연 취소"), false);
});

test("construction auto-registration requires a Whizzup-award scope", () => {
  assert.equal(isAllowedAiAutoSchedule("도장", {
    allowConstruction: true,
    isConstruction: true,
  }), true);
  assert.equal(isAllowedAiAutoSchedule("도장", {
    allowConstruction: false,
    isConstruction: true,
  }), false);
  assert.equal(isAllowedAiAutoSchedule("영업 방문", {
    allowConstruction: true,
    isConstruction: false,
  }), false);
  assert.equal(isAllowedAiAutoSchedule("재연락", {
    allowConstruction: true,
    isConstruction: false,
  }), false);
});
