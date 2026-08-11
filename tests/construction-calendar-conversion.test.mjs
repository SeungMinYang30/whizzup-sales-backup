import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [calendar, schedules, crm] = await Promise.all([
  readFile(new URL("../app/home-calendar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/organization-schedules.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
]);

test("협력사 관리에서는 공용 팀 상세 기록을 표시하지 않는다", () => {
  assert.match(crm, /view !== "vendors" && \(\s*<section[\s\S]*?className=\{`panel records-panel/);
});

test("Google 시공 일정 연결은 일정표 기관을 확인하고 동의 후 자동 등록한다", () => {
  assert.match(calendar, /async function ensureConstructionProject/);
  assert.match(calendar, /scope=construction-board/);
  assert.match(calendar, /시공·납품 일정표에 없습니다/);
  assert.match(calendar, /action: "add-construction-project"/);
  assert.match(calendar, /시공일정표 기관 등록 및 일정 연결 완료/);
});

test("일정 수정에서 시공으로 전환하고 Google 시공 캘린더 이동을 예약한다", () => {
  assert.match(calendar, /editor\.scheduleId \? \["영업", "회의", "시공", "쇼룸", "기타", "내 일정"\]/);
  assert.match(calendar, /editor\.kind === "시공" \? <label>시공 단계/);
  assert.match(calendar, /draft\.kind === "시공" \? draft\.title\.trim\(\)/);
  assert.match(schedules, /requestedCategory === "construction"/);
  assert.match(schedules, /isConstructionStage\(label\)/);
  assert.match(schedules, /WHEN \? = 'construction'[\s\S]*?'move-construction'/);
});
