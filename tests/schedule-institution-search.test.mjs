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

test("한글 조합 입력 중에도 실제 입력값으로 검색 결과를 즉시 갱신한다", () => {
  assert.match(calendar, /onInput=\{\(event\) => updateInstitutionQuery\(event\.currentTarget\.value\)\}/);
  assert.match(calendar, /onCompositionEnd=\{\(event\) => updateInstitutionQuery\(event\.currentTarget\.value\)\}/);
  assert.doesNotMatch(calendar, /institutionComposing/);
});

test("한글 조합 완료 값과 일반 입력 값은 동일한 갱신 함수를 사용한다", () => {
  assert.match(calendar, /function updateInstitutionQuery\(value: string\)/);
  assert.match(calendar, /onChange=\{\(event\) => \{\s+const value = event\.currentTarget\.value;\s+updateInstitutionQuery\(value\)/);
  assert.doesNotMatch(calendar, /organizationQuery: event\.currentTarget\.value/);
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

test("일정 기관 검색은 이미 불러온 기록을 즉시 색인하고 서버 조회는 보조로만 사용한다", () => {
  assert.match(calendar, /const institutionIndex = useMemo\(\(\) =>/);
  assert.match(calendar, /if \(institutionIndex\.length\) \{/);
  assert.match(calendar, /institutionSearchRank/);
  assert.match(calendar, /\.slice\(0, 10\)/);
  assert.match(calendar, /fetch\(`\/api\/institutions\/search\?q=/);
  assert.match(calendar, /\}, 120\)/);
});

test("일정 등록과 Google 일정 연결은 같은 기관 검색 색인을 공유한다", () => {
  assert.match(calendar, /editor\.googleEventId/);
  assert.match(calendar, /normalizedInstitution\(item\.organization\) === normalizedQuery/);
  assert.match(calendar, /setCreatedInstitutions/);
  assert.match(calendar, /organization: editor\.organizationQuery\.trim\(\), businessRound: 1/);
});
