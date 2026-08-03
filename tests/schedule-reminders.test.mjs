import assert from "node:assert/strict";
import test from "node:test";

import {
  canCompleteScheduleReminder,
  canMemberSeeScheduleReminder,
  isSharedPostAwardSchedule,
  isSharedSalesSchedule,
} from "../lib/schedule-reminder-policy.ts";

const employee = {
  id: 7,
  displayName: "김동훈 과장",
  role: "member",
};

test("personal sales schedules are visible only to their assignee", () => {
  const schedule = {
    awardStatus: "미정",
    label: "재연락",
    progressManager: "김동훈 과장",
    creatorMemberId: 3,
    creatorName: "양승민 이사",
  };
  assert.equal(canMemberSeeScheduleReminder(schedule, employee), true);
  assert.equal(
    canMemberSeeScheduleReminder(schedule, {
      id: 1,
      displayName: "양승민 이사",
      role: "admin",
    }),
    false,
  );
});

test("explicit sales calendar schedules remain shared after reassignment", () => {
  const schedule = {
    awardStatus: "미정",
    category: "general",
    label: "영업 · 재연락",
    progressManager: "김동훈 과장",
    creatorMemberId: 3,
    creatorName: "양승민 이사",
  };
  assert.equal(isSharedSalesSchedule(schedule), true);
  assert.equal(canMemberSeeScheduleReminder(schedule, employee), true);
  assert.equal(
    canMemberSeeScheduleReminder(schedule, {
      id: 1,
      displayName: "양승민 이사",
      role: "admin",
    }),
    true,
  );
  assert.equal(
    canMemberSeeScheduleReminder(schedule, {
      id: 8,
      displayName: "이준상 본부장",
      role: "member",
    }),
    true,
  );
});

test("plain follow-up reminders remain private", () => {
  const schedule = {
    awardStatus: "미정",
    category: "general",
    label: "재연락",
    progressManager: "김동훈 과장",
    creatorMemberId: 3,
    creatorName: "양승민 이사",
  };
  assert.equal(isSharedSalesSchedule(schedule), false);
  assert.equal(
    canMemberSeeScheduleReminder(schedule, {
      id: 1,
      displayName: "양승민 이사",
      role: "admin",
    }),
    false,
  );
});

test("an unassigned private schedule falls back to its creator", () => {
  const schedule = {
    awardStatus: "미정",
    label: "견적 확인",
    progressManager: "미지정",
    creatorMemberId: 7,
    creatorName: "김동훈 과장",
  };
  assert.equal(canMemberSeeScheduleReminder(schedule, employee), true);
  assert.equal(
    canMemberSeeScheduleReminder(schedule, {
      id: 8,
      displayName: "이준상 본부장",
      role: "member",
    }),
    false,
  );
});

test("post-award delivery schedules are shared with related staff and admins", () => {
  const schedule = {
    awardStatus: "위즈업 수주",
    label: "설치 및 납품",
    progressManager: "김동훈 과장",
    creatorMemberId: 3,
    creatorName: "양승민 이사",
  };
  assert.equal(isSharedPostAwardSchedule(schedule), true);
  assert.equal(canMemberSeeScheduleReminder(schedule, employee), true);
  assert.equal(
    canMemberSeeScheduleReminder(schedule, {
      id: 1,
      displayName: "대표 관리자",
      role: "admin",
    }),
    true,
  );
  assert.equal(
    canMemberSeeScheduleReminder(schedule, {
      id: 8,
      displayName: "이준상 본부장",
      role: "member",
    }),
    false,
  );
});

test("post-award sales follow-ups remain private", () => {
  const schedule = {
    awardStatus: "위즈업 수주",
    label: "재연락 및 견적 확인",
    progressManager: "김동훈 과장",
    creatorMemberId: 3,
    creatorName: "양승민 이사",
  };
  assert.equal(isSharedPostAwardSchedule(schedule), false);
});

test("ambiguous post-award schedules remain private", () => {
  const schedule = {
    awardStatus: "위즈업 수주",
    label: "추가 확인",
  };
  assert.equal(isSharedPostAwardSchedule(schedule), false);
});

test("only visible schedules before today can be completed from reminders", () => {
  const base = {
    awardStatus: "미정",
    label: "재연락",
    progressManager: "김동훈 과장",
    creatorMemberId: 3,
    creatorName: "양승민 이사",
  };
  assert.equal(
    canCompleteScheduleReminder(
      { ...base, scheduledDate: "2026-08-02" },
      employee,
      "2026-08-03",
    ),
    true,
  );
  assert.equal(
    canCompleteScheduleReminder(
      { ...base, scheduledDate: "2026-08-03" },
      employee,
      "2026-08-03",
    ),
    false,
  );
});
