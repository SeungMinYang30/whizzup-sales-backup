import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("일정표는 별도 지난 일정 버튼 없이 현재 화면에서 주 단위로 이동한다", async () => {
  const page = await source("../app/construction-schedule-page.tsx");
  assert.doesNotMatch(page, /지난 일정 보기/);
  assert.match(page, /onClick=\{\(\) => shift\(-7\)\}>이전/);
  assert.match(page, /onClick=\{\(\) => shift\(7\)\}>다음/);
  assert.match(page, /setHideCompleted\(false\)/);
  assert.doesNotMatch(page, /constructionScheduleIntersectsRange/);
  assert.match(page, /<div>\{items\.map\(\(item\) =>/);
});
