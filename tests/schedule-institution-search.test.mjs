import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [calendar, styles] = await Promise.all([
  readFile(new URL("../app/home-calendar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("일정 기관 검색은 최신 요청만 화면에 반영한다", () => {
  assert.match(calendar, /institutionRequestSequence = useRef\(0\)/);
  assert.match(calendar, /const requestId = \+\+institutionRequestSequence\.current/);
  assert.match(calendar, /requestId !== institutionRequestSequence\.current/);
  assert.match(calendar, /controller\.signal\.aborted/);
  assert.doesNotMatch(calendar, /\.finally\(\(\) => setInstitutionLoading\(false\)\)/);
});

test("한글 조합 입력 중에는 검색하지 않고 완료 후 한 번 검색한다", () => {
  assert.match(calendar, /institutionComposing/);
  assert.match(calendar, /onCompositionStart=\{\(\) => setInstitutionComposing\(true\)\}/);
  assert.match(calendar, /onCompositionEnd=/);
  assert.match(calendar, /editor\.linked \|\| institutionComposing/);
});

test("검색 완료 전에는 기관 없음 문구를 표시하지 않는다", () => {
  assert.match(calendar, /setInstitutionSearchState\("debouncing"\)/);
  assert.match(calendar, /institutionSearchState === "empty"/);
  assert.match(calendar, /institutionSearchState === "error"/);
  assert.doesNotMatch(calendar, /!institutionLoading && !institutions\.length/);
});

test("검색 결과는 모달 레이아웃을 밀지 않는 드롭다운으로 표시한다", () => {
  assert.match(calendar, /home-schedule-institution-search/);
  assert.match(styles, /\.home-schedule-institution-search \{ position: relative; display: block; \}/);
  assert.match(styles, /\.home-schedule-institution-results \{ position: absolute; z-index: 110;/);
});
