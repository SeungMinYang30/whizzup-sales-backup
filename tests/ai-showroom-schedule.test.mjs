import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  extractShowroomSchedulesFromText,
  isShowroomScheduleLabel,
} from "../lib/showroom-schedule.ts";

test("AI record demonstration dates become timed showroom schedules", () => {
  assert.deepEqual(
    extractShowroomSchedulesFromText(
      "8월 14일 오전 10시에 에어패스 시연이 예정되어 있습니다.",
      "2026-08-12",
    ),
    [{
      label: "에어패스 시연",
      date: "2026-08-14",
      startTime: "10:00",
      endTime: "11:00",
    }],
  );
  assert.equal(isShowroomScheduleLabel("에어패스 시연"), true);
  assert.equal(isShowroomScheduleLabel("담당자 방문 미팅"), false);
});

test("showroom schedules without a stated time remain all-day", () => {
  assert.deepEqual(
    extractShowroomSchedulesFromText(
      "8월 20일 에어패스 데모 일정입니다.",
      "2026-08-12",
    ),
    [{
      label: "에어패스 데모",
      date: "2026-08-20",
      startTime: "",
      endTime: "",
    }],
  );
});

test("AI organize and record persistence keep showroom category and time", async () => {
  const [aiRoute, schedules, crm] = await Promise.all([
    readFile(new URL("../app/api/ai/organize/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/organization-schedules.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(aiRoute, /extractShowroomSchedulesFromText/);
  assert.match(aiRoute, /mergeDetectedShowroomSchedules/);
  assert.match(aiRoute, /candidate\.date === item\.date && isShowroomScheduleLabel\(candidate\.label\)/);
  assert.match(aiRoute, /시연·데모·체험 일정/);
  assert.match(
    schedules,
    /(?:isShowroomScheduleLabel|isApprovedShowroomAutoSchedule)\(schedule\.label\)/,
  );
  assert.match(
    schedules,
    /category:\s*schedule\.category|INSERT INTO organization_schedules[\s\S]*?'showroom'/,
  );
  assert.match(crm, /startTime: schedule\.startTime/);
  assert.match(crm, /category: schedule\.category/);
});
