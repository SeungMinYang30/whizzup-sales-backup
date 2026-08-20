import assert from "node:assert/strict";
import test from "node:test";

import {
  constructionStageTone,
  getConstructionDayMeta,
  getConstructionTimelineDays,
  getKoreanHolidayName,
} from "../lib/construction-calendar";

test("설날·부처님오신날·추석과 대체공휴일을 판정한다", () => {
  assert.equal(getKoreanHolidayName("2026-02-16"), "설날 연휴");
  assert.equal(getKoreanHolidayName("2026-02-17"), "설날");
  assert.equal(getKoreanHolidayName("2026-02-18"), "설날 연휴");
  assert.equal(getKoreanHolidayName("2026-05-24"), "부처님오신날");
  assert.equal(getKoreanHolidayName("2026-05-25"), "부처님오신날 대체공휴일");
  assert.equal(getKoreanHolidayName("2026-09-25"), "추석");
});

test("고정 공휴일의 토요일 대체공휴일과 오늘 표시를 함께 보존한다", () => {
  assert.equal(getKoreanHolidayName("2026-05-01"), "노동절");
  assert.equal(getKoreanHolidayName("2026-07-17"), "제헌절");
  assert.equal(getKoreanHolidayName("2026-08-15"), "광복절");
  assert.equal(getKoreanHolidayName("2026-08-17"), "광복절 대체공휴일");
  const todayHoliday = getConstructionDayMeta("2026-08-15", "2026-08-15");
  assert.equal(todayHoliday.isHoliday, true);
  assert.equal(todayHoliday.isSaturday, true);
  assert.equal(todayHoliday.isToday, true);
});

test("31일 일정과 단계 색상은 화면·엑셀에서 공유할 수 있다", () => {
  const days = getConstructionTimelineDays("2026-08-01", 31, "2026-08-03");
  assert.equal(days.length, 31);
  assert.equal(days[0].isSaturday, true);
  assert.equal(days[1].isSunday, true);
  assert.equal(days[2].isToday, true);
  assert.equal(constructionStageTone("출고"), 0);
  assert.equal(constructionStageTone("철거"), 1);
  assert.equal(constructionStageTone("통신"), 2);
  assert.equal(constructionStageTone("목공"), 3);
  assert.equal(constructionStageTone("검수"), 4);
});
