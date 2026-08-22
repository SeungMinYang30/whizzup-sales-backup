import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pageSource = fs.readFileSync(new URL("../app/site-layout-planner-page.tsx", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("기초도면 작성이 독립 메뉴와 지연 로딩 페이지로 연결된다", () => {
  assert.match(appSource, /lazy\(\(\) => import\("\.\/site-layout-planner-page"\)\)/);
  assert.match(appSource, /id: "site-layout", label: "기초도면 작성"/);
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
  for (const label of ["단문형", "양문형", "비대칭 양문", "좌우 미닫이", "폴딩도어", "고정창", "슬라이딩 2짝", "슬라이딩 3짝", "슬라이딩 4짝", "6분할 연창", "프로젝트창", "사각 기둥", "보", "벽걸이 에어컨", "천장형 에어컨", "현장 메모"]) {
    assert.match(pageSource, new RegExp(`label: "${label}"`));
  }
  assert.match(pageSource, /roomWidth/);
  assert.match(pageSource, /roomHeight/);
  assert.match(pageSource, /roomCeilingHeight/);
  assert.match(pageSource, /공간 자동 생성/);
  assert.match(pageSource, /onPointerMove=\{moveDrag\}/);
  assert.match(pageSource, /snapOpening/);
  assert.match(pageSource, /90° 회전/);
  assert.match(pageSource, /duplicateSelected/);
});

test("제품 블록은 보존하되 기초 도면 UI와 출력에서 숨긴다", () => {
  assert.match(pageSource, /const basicGroups: PresetGroup\[\] = \["문", "창호", "기둥·보", "현장 설비", "기타"\]/);
  assert.match(pageSource, /itemPresets\.filter\(\(preset\) => basicGroups\.includes\(preset\.group\)\)/);
  assert.match(pageSource, /itemLayer\(item\) !== "equipment" && visibleLayers/);
  assert.match(pageSource, /equipment: false/);
  assert.doesNotMatch(pageSource, /제품 DB 매칭/);
  assert.doesNotMatch(pageSource, /VR 스포츠실 예시/);
  assert.match(pageSource, /CAD팀 전달용 기초도면/);
});

test("문·창호는 중복 의사 요소 없이 재사용 SVG CAD 심벌로 그린다", () => {
  assert.match(pageSource, /function CadSymbol/);
  assert.match(pageSource, /viewBox="0 0 100 70"/);
  assert.match(pageSource, /M74 66A64 64/);
  assert.match(pageSource, /M50 66A40 40/);
  assert.match(pageSource, /Array\.from\(\{ length: panels - 1 \}/);
  assert.match(stylesSource, /\.site-layout-cad-symbol/);
  assert.match(stylesSource, /\.site-layout-item\.kind-door:not\(\.selected\)::before,[\s\S]*?content: none/);
  assert.match(pageSource, /vectorEffect: "non-scaling-stroke"/);
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

test("모바일에서는 블록을 먼저 고르고 도면을 터치해 배치한다", () => {
  assert.match(pageSource, /pendingPresetId/);
  assert.match(pageSource, /handleBoardPointerDown/);
  assert.match(pageSource, /\(max-width: 760px\), \(pointer: coarse\)/);
  assert.match(pageSource, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(stylesSource, /Site layout studio v3[\s\S]*?\.site-layout-library \{[\s\S]*?order: 1/);
  assert.match(stylesSource, /Site layout studio v3[\s\S]*?\.site-layout-canvas-panel \{ order: 2/);
  assert.match(stylesSource, /Site layout studio v3[\s\S]*?\.site-layout-board-wrap \{[\s\S]*?min-width: 0;[\s\S]*?max-width: none !important/);
  assert.match(stylesSource, /\.site-layout-board\.placing \{ cursor: crosshair; touch-action: none; \}/);
});

test("현장 실측은 공간부터 검수까지 단계별로 진행한다", () => {
  for (const id of ["room", "door", "window", "structure", "facility", "review"]) {
    assert.match(pageSource, new RegExp(`id: "${id}"`));
  }
  for (const text of ["공간 크기 입력", "출입문 형태와 치수", "창호 형태와 분할", "기둥과 보 실측", "에어컨과 고정 시설", "CAD팀 전달 전 검수"]) {
    assert.match(pageSource, new RegExp(text));
  }
  assert.match(pageSource, /확인 완료/);
  assert.match(pageSource, /해당 없음/);
  assert.match(pageSource, /재확인 필요/);
  assert.match(pageSource, /저장하고 다음/);
  assert.match(pageSource, /site-layout-guide-progress/);
  assert.match(stylesSource, /Site layout studio v4: guided field measurement workflow/);
});

test("문·창호는 설치 벽과 실측 치수를 저장한다", () => {
  assert.match(pageSource, /type WallSide = "top" \| "right" \| "bottom" \| "left"/);
  assert.match(pageSource, /openingHeight/);
  assert.match(pageSource, /sillHeight/);
  assert.match(pageSource, /handing/);
  assert.match(pageSource, /기준 모서리 거리/);
  assert.match(pageSource, /바닥에서 창 하단/);
  assert.match(pageSource, /placeOpeningOnWall/);
});
