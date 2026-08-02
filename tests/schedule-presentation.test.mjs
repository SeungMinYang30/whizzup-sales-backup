import assert from "node:assert/strict";
import test from "node:test";

import {
  formatScheduleDate,
  sortScheduleRowsForDashboard,
  sortScheduleRowsByEarliestDate,
} from "../lib/schedule-presentation.ts";

test("진행 일정 날짜에 한국어 요일을 표시한다", () => {
  assert.equal(formatScheduleDate("2026-07-23"), "7/23 (목)");
  assert.equal(formatScheduleDate("2026-08-31"), "8/31 (월)");
});

test("필터링된 첫 일정 날짜가 빠른 기관부터 정렬한다", () => {
  const rows = sortScheduleRowsByEarliestDate([
    {
      organization: "충주 성남초등학교 병설유치원",
      items: [{ date: "2026-08-31" }],
    },
    {
      organization: "남해군 꿈나눔센터",
      items: [{ date: "2026-07-23" }],
    },
  ]);

  assert.deepEqual(
    rows.map((row) => row.organization),
    ["남해군 꿈나눔센터", "충주 성남초등학교 병설유치원"],
  );
});

test("지난 일정은 날짜 오름차순으로 합치고 예정 일정이 있는 기관을 먼저 둔다", () => {
  const rows = sortScheduleRowsForDashboard(
    [
      {
        organization: "충주 성남초등학교 병설유치원",
        items: [
          { date: "2026-07-01" },
          { date: "2026-06-18" },
          { date: "2026-06-01" },
          { date: "2026-08-31" },
        ],
      },
      {
        organization: "사천 스포츠클럽",
        items: [{ date: "2026-06-23" }],
      },
      {
        organization: "남해군 꿈나눔센터",
        items: [{ date: "2026-07-23" }],
      },
    ],
    "2026-07-22",
  );

  assert.deepEqual(
    rows.map((row) => row.organization),
    [
      "남해군 꿈나눔센터",
      "충주 성남초등학교 병설유치원",
      "사천 스포츠클럽",
    ],
  );
  assert.deepEqual(
    rows[1].items.map((item) => item.date),
    ["2026-06-01", "2026-06-18", "2026-07-01", "2026-08-31"],
  );
});
