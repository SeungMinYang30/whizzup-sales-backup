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

test("실 크기와 기본 현장 요소를 편집하고 드래그할 수 있다", () => {
  for (const label of ["장비", "책상", "출입문", "창문", "기둥", "메모"]) {
    assert.match(pageSource, new RegExp(`label: "${label}"`));
  }
  assert.match(pageSource, /roomWidth/);
  assert.match(pageSource, /roomHeight/);
  assert.match(pageSource, /onPointerMove=\{moveDrag\}/);
  assert.match(pageSource, /90° 회전/);
  assert.match(pageSource, /duplicateSelected/);
});

test("모바일에서는 넓은 배치도를 잘라내지 않고 좌우 탐색한다", () => {
  assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*?\.site-layout-canvas-panel \{[\s\S]*?justify-items: start;/);
  assert.match(stylesSource, /\.site-layout-board-wrap \{ min-width: 620px; \}/);
  assert.match(stylesSource, /\.site-layout-canvas-panel \{[\s\S]*?overflow: auto;/);
});
