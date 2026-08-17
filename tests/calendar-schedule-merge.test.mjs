import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeCalendarSchedules,
  normalizeCalendarSchedule,
} from "../lib/calendar-schedule-merge.ts";

const sales = {
  id: "12",
  organization: "경기도 광주 도수초등학교",
  businessRound: "1",
  label: "영업 · 목공",
  category: "general",
  scheduledDate: "2026-08-12T00:00:00.000Z",
  endDate: null,
  startTime: "18:00:00",
  endTime: "18:00:00",
  sourceActivityId: "81",
};

const construction = {
  id: 99,
  organization: "경기도 광주 도수초등학교",
  businessRound: 1,
  label: "목공",
  stage: "목공",
  category: "construction",
  scheduledDate: "2026-08-12",
  endDate: "2026-08-12",
  startTime: "18:00",
  endTime: "18:00",
  sourceActivityId: 81,
};

test("data arrival order never changes the final calendar merge", () => {
  assert.deepEqual(
    mergeCalendarSchedules([sales], [construction]),
    mergeCalendarSchedules([construction], [sales]),
  );
  assert.deepEqual(mergeCalendarSchedules([sales, construction]), [construction]);
});

test("a real sales visit and construction work on the same day both remain", () => {
  const visit = { ...sales, id: 13, label: "영업 · 현장 협의", sourceActivityId: 82 };
  assert.deepEqual(mergeCalendarSchedules([visit, construction]), [construction, visit]);
});

test("multi-day work keeps separate occurrences and does not merge dates", () => {
  const nextDay = {
    ...construction,
    id: 100,
    scheduledDate: "2026-08-13",
    endDate: "2026-08-13",
  };
  assert.equal(mergeCalendarSchedules([construction, nextDay]).length, 2);
});

test("construction replaces the matching AI-origin sales schedule in presentation", () => {
  assert.deepEqual(mergeCalendarSchedules([sales, construction]), [construction]);
});

test("PostgreSQL and D1 id date and null shapes normalize to one key", () => {
  const pg = normalizeCalendarSchedule(sales);
  const d1 = normalizeCalendarSchedule({
    ...sales,
    businessRound: 1,
    scheduledDate: "2026-08-12",
    endDate: "",
    startTime: "18:00",
    endTime: "18:00",
    sourceActivityId: 81,
  });
  assert.deepEqual(pg, d1);
});

test("Google duplication is independent from connection order", () => {
  const linked = { ...sales, id: 200, googleEventId: "google-1" };
  const readOnly = { ...sales, id: "google:1", category: "google", googleEventId: "google-1" };
  assert.deepEqual(mergeCalendarSchedules([readOnly], [linked]), [linked]);
  assert.deepEqual(mergeCalendarSchedules([linked], [readOnly]), [linked]);
});
