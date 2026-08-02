import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [crm, styles] = await Promise.all([
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("관리자 점검은 내용 요약과 다음 행동을 현재 상황으로 함께 보여준다", () => {
  assert.match(crm, /className="manager-col-situation">현재 상황/);
  assert.match(crm, /\{record\.summary \|\| "내용 요약 미입력"\}/);
  assert.match(crm, /다음: \{record\.nextAction \|\| "다음 행동 미지정"\}/);
  assert.match(crm, /외 \{organization\.issues\.length - 2\}건/);
  assert.match(styles, /\.manager-inspection-table \.manager-col-situation/);
  assert.match(styles, /\.manager-issue-more/);
});

test("팀 업무 현황은 분류 주제 대신 실제 내용 요약과 다음 행동을 보여준다", () => {
  assert.match(crm, /"확인 사유 \/ 다음 행동"/);
  assert.match(crm, /"내용 요약 \/ 다음 행동"/);
  assert.match(
    crm,
    /teamDetailMode === "attention"[\s\S]+: record\.summary \|\| "내용 요약 미입력"/,
  );
  assert.match(styles, /\.team-record-next-action/);
});
