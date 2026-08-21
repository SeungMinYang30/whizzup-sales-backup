import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pageSource = fs.readFileSync(new URL("../app/site-layout-planner-page.tsx", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("현장 배치도가 독립 메뉴와 지연 로딩 페이지로 연결된다", () => {
  assert.match(appSource, /lazy\(\(\) => import\("\.\/site-layout-planner-page"\)\)/);
  assert.match(appSource, /id: "site-layout", label: "현장 배치도"/);
  assert.match(appSource, /view === "site-layout" && \(/);
  assert.match(appSource, /<SiteLayoutPlannerPage \/>/);
});

test("기본판은 기관·견적 DB 대신 브라우저에만 저장한다", () => {
  assert.match(pageSource, /whizzup:site-layout-draft:v1/);
  assert.match(pageSource, /window\.localStorage\.getItem/);
  assert.match(pageSource, /window\.localStorage\.setItem/);
  assert.doesNotMatch(pageSource, /fetch\s*\(/);
  assert.doesNotMatch(pageSource, /\/api\//);
});

test("실 크기와 CAD 표준 블록을 편집하고 드래그할 수 있다", () => {
  for (const label of ["단문형", "양문형", "미닫이", "3분할", "4분할", "6분할", "장비", "모듈 책상", "기둥", "현장 메모"]) {
    assert.match(pageSource, new RegExp(`label: "${label}"`));
  }
  assert.match(pageSource, /roomWidth/);
  assert.match(pageSource, /roomHeight/);
  assert.match(pageSource, /roomCeilingHeight/);
  assert.match(pageSource, /교실 자동 생성/);
  assert.match(pageSource, /onPointerMove=\{moveDrag\}/);
  assert.match(pageSource, /snapOpening/);
  assert.match(pageSource, /90° 회전/);
  assert.match(pageSource, /duplicateSelected/);
});

test("모델 공간과 A3 출력 도면에 CAD 정보 구조를 제공한다", () => {
  assert.match(pageSource, /A3 출력 미리보기/);
  assert.match(pageSource, /site-layout-paper-sheet/);
  assert.match(pageSource, /RC 벽체 t=150/);
  assert.match(pageSource, /SNAP/);
  assert.match(pageSource, /ORTHO/);
  assert.match(pageSource, /OSNAP/);
  assert.match(pageSource, /A-WALL RC 벽체/);
  assert.match(stylesSource, /repeating-linear-gradient\(135deg/);
});

test("모바일에서는 넓은 배치도를 잘라내지 않고 좌우 탐색한다", () => {
  assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*?\.site-layout-model-space \{[\s\S]*?justify-items: start;/);
  assert.match(stylesSource, /\.site-layout-board-wrap \{ min-width: 620px; \}/);
  assert.match(stylesSource, /\.site-layout-model-space \{[\s\S]*?overflow: auto;/);
});
