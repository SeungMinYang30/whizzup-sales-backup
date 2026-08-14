import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAiCalendarSchedules } from "../lib/ai-calendar-schedules.ts";

test("AI calendar schedules normalize time, assignee and duplicate identities", () => {
  const schedules = normalizeAiCalendarSchedules([
    {
      organization: " 청도군 장애인복지관 ",
      region: "경북 청도",
      label: "영업 방문",
      scheduledDate: "2026-08-19",
      startTime: "17:00",
      endTime: "",
      details: " 기관 방문 ",
      assigneeName: " 이은림 팀장님 ",
    },
    {
      organization: "청도군장애인복지관",
      label: "영업 방문",
      scheduledDate: "2026-08-19",
      startTime: "17:00",
    },
  ]);

  assert.equal(schedules.length, 1);
  assert.deepEqual(schedules[0], {
    organization: "청도군 장애인복지관",
    region: "경북 청도",
    label: "영업 방문",
    scheduledDate: "2026-08-19",
    startTime: "17:00",
    endTime: "18:00",
    details: "기관 방문",
    assigneeName: "이은림 팀장님",
  });
});

test("AI calendar schedules reject malformed dates and times", () => {
  const schedules = normalizeAiCalendarSchedules([
    { organization: "기관", label: "방문", scheduledDate: "2026/08/19" },
    { organization: "기관", label: "방문", scheduledDate: "2026-08-19", startTime: "25:00" },
    { organization: "", label: "방문", scheduledDate: "2026-08-19" },
  ]);

  assert.deepEqual(schedules, []);
});
