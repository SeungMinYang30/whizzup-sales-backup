import assert from "node:assert/strict";
import test from "node:test";

import {
  extractActivityHeaderDate,
  messageContainsActivityDate,
  resolveActivityDateFromMessage,
} from "../lib/activity-date.ts";

test("과거 날짜가 적힌 미팅 제목을 실제 기록일로 사용한다", () => {
  const message = `[2026년 6월 4일 성남 장안초등학교 미팅 내용 정리]

- 학교명: 성남 장안초등학교
- 미팅 내용: 스마트 체험교실 구축 방향을 논의했습니다.`;
  assert.equal(extractActivityHeaderDate(message, 2026), "2026-06-04");
  assert.deepEqual(
    resolveActivityDateFromMessage({
      message,
      aiDate: "2026-07-20",
      today: "2026-07-20",
    }),
    {
      activityDate: "2026-06-04",
      dateConfidence: "확정",
    },
  );
});

test("점과 하이픈으로 쓴 날짜 제목도 인식한다", () => {
  assert.equal(
    extractActivityHeaderDate("[2026.07.16 TM 진행 내용 정리]", 2026),
    "2026-07-16",
  );
  assert.equal(
    extractActivityHeaderDate("2026-07-16 통화 기록", 2026),
    "2026-07-16",
  );
});

test("활동 제목이 아닌 공사 일정은 기록일로 오인하지 않는다", () => {
  const message = `성남초등학교
목공 6월 4일
시스템 6월 6일`;
  assert.equal(extractActivityHeaderDate(message, 2026), "");
  assert.deepEqual(
    resolveActivityDateFromMessage({
      message,
      aiDate: "",
      today: "2026-07-20",
    }),
    {
      activityDate: "2026-07-20",
      dateConfidence: "대화시각 추정",
    },
  );
});

test("AI가 기관별로 고른 명시 날짜는 해당 기관 기록에 보존한다", () => {
  const message = `성남초 2026년 6월 4일 통화
장안초 2026년 6월 5일 미팅`;
  assert.equal(messageContainsActivityDate(message, "2026-06-05"), true);
  assert.deepEqual(
    resolveActivityDateFromMessage({
      message,
      aiDate: "2026-06-05",
      today: "2026-07-20",
    }),
    {
      activityDate: "2026-06-05",
      dateConfidence: "확정",
    },
  );
});
