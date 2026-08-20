import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canMemberSeeScheduleReminder,
  isSharedSalesSchedule,
} from "../lib/schedule-reminder-policy.ts";

const unrelatedEmployee = {
  id: 27,
  displayName: "공유 일정 확인자",
  role: "member",
};

function schedule(category) {
  return {
    awardStatus: "미정",
    category,
    label: "업무 일정",
    progressManager: "다른 담당자",
    creatorMemberId: 3,
    creatorName: "다른 작성자",
  };
}

test("all explicit work-calendar categories are visible to every approved member", () => {
  for (const category of ["general", "sales", "meeting", "construction", "showroom", "other"]) {
    assert.equal(isSharedSalesSchedule(schedule(category)), true, category);
    assert.equal(canMemberSeeScheduleReminder(schedule(category), unrelatedEmployee), true, category);
  }
});

test("only personal schedules remain private", () => {
  assert.equal(isSharedSalesSchedule(schedule("personal")), false);
  assert.equal(canMemberSeeScheduleReminder(schedule("personal"), unrelatedEmployee), false);
});

test("storage and Google sync preserve the same visibility rule", async () => {
  const [store, googleSync] = await Promise.all([
    readFile(new URL("../lib/organization-schedules.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/google-calendar-sync.ts", import.meta.url), "utf8"),
  ]);
  assert.match(store, /"general", "sales", "meeting", "construction", "showroom", "other", "personal"/);
  assert.match(googleSync, /return row\.category !== "personal"/);
});
