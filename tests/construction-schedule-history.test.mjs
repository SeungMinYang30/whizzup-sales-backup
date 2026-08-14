import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { constructionScheduleIntersectsRange } from "../lib/construction-calendar.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("지난 일정 범위는 하루 일정과 기간 일정을 모두 포함한다", () => {
  assert.equal(
    constructionScheduleIntersectsRange(
      { scheduledDate: "2026-07-15", endDate: "2026-07-15" },
      "2026-07-01",
      "2026-07-31",
    ),
    true,
  );
  assert.equal(
    constructionScheduleIntersectsRange(
      { scheduledDate: "2026-06-29", endDate: "2026-07-02" },
      "2026-07-01",
      "2026-07-31",
    ),
    true,
  );
  assert.equal(
    constructionScheduleIntersectsRange(
      { scheduledDate: "2026-06-30", endDate: "2026-06-30" },
      "2026-07-01",
      "2026-07-31",
    ),
    false,
  );
});

test("일정표는 지난 일정 보기에서 완료 기관과 실제 과거 일정만 표시한다", async () => {
  const page = await source("../app/construction-schedule-page.tsx");
  assert.match(page, /showPastSchedules \? "오늘 이후 보기" : "지난 일정 보기"/);
  assert.match(page, /setStart\(addConstructionDays\(today, -30\)\)/);
  assert.match(page, /setHideCompleted\(false\)/);
  assert.match(page, /constructionScheduleIntersectsRange\(item, start, rangeEnd\)/);
  assert.match(page, /선택한 기간에 등록된 지난 일정이 없습니다/);
});
