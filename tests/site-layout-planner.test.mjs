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
  for (const label of ["단문형", "양문형", "비대칭 양문", "좌우 미닫이", "폴딩도어", "고정창", "슬라이딩 2짝", "슬라이딩 3짝", "슬라이딩 4짝", "6분할 연창", "프로젝트창", "사각 기둥", "원형 기둥", "천장 보", "벽걸이 에어컨", "천장형 에어컨"]) {
    assert.match(pageSource, new RegExp(`label: "${label}"`));
  }
  assert.match(pageSource, /roomWidth/);
  assert.match(pageSource, /roomHeight/);
  assert.match(pageSource, /roomCeilingHeight/);
  assert.match(pageSource, /이 크기로 시작/);
  assert.match(pageSource, /onPointerMove=\{moveDrag\}/);
  assert.match(pageSource, /snapOpening/);
  assert.match(pageSource, /90° 회전/);
  assert.match(pageSource, /duplicateSelected/);
});

test("제품 블록은 보존하되 기초 도면 UI와 출력에서 숨긴다", () => {
  assert.match(pageSource, /const basicGroups: PresetGroup\[\] = \["문", "창호", "기둥·보", "현장 설비"\]/);
  assert.match(pageSource, /itemPresets\.filter\(\(preset\) => basicGroups\.includes\(preset\.group\)\)/);
  assert.match(pageSource, /itemLayer\(item\) !== "equipment" && visibleLayers/);
  assert.match(pageSource, /equipment: false/);
  assert.doesNotMatch(pageSource, /제품 DB 매칭/);
  assert.doesNotMatch(pageSource, /VR 스포츠실 예시/);
  assert.match(pageSource, /CAD팀 전달용 기초도면/);
});

test("문·창호는 중복 의사 요소 없이 재사용 SVG CAD 심벌로 그린다", () => {
  assert.match(pageSource, /function CadSymbol/);
  assert.match(pageSource, /vertical \? "0 0 70 100" : "0 0 100 70"/);
  assert.match(pageSource, /M74 66A64 64/);
  assert.match(pageSource, /M50 66A40 40/);
  assert.match(pageSource, /Array\.from\(\{ length: panels - 1 \}/);
  assert.match(pageSource, /openingCadTransform/);
  assert.match(stylesSource, /\.site-layout-cad-symbol/);
  assert.match(stylesSource, /\.site-layout-item\.kind-door:not\(\.selected\)::before,[\s\S]*?content: none/);
  assert.match(pageSource, /vectorEffect: "non-scaling-stroke"/);
});

test("모델 공간과 A3 출력 도면에 CAD 정보 구조를 제공한다", () => {
  assert.match(pageSource, /A3 출력 미리보기/);
  assert.match(pageSource, /site-layout-paper-sheet/);
  assert.match(pageSource, /RC 벽체 t=\{formatMillimeters\(draft\.roomWallThickness/);
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
  assert.match(stylesSource, /Site layout studio v4[\s\S]*?\.site-layout-workspace \{[\s\S]*?max-width: 100%;[\s\S]*?align-items: stretch/);
  assert.match(stylesSource, /Site layout studio v4[\s\S]*?\.site-layout-canvas-head,[\s\S]*?\.site-layout-model-space \{ width: 100%; max-width: 100%; \}/);
  assert.match(stylesSource, /Site layout studio v4[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
});

test("PC에서는 그림 블록을 도면으로 직접 드래그해 넣는다", () => {
  assert.match(pageSource, /draggable/);
  assert.match(pageSource, /handlePresetDragStart/);
  assert.match(pageSource, /application\/x-whizzup-floor-block/);
  assert.match(pageSource, /handleBoardDrop/);
  assert.match(pageSource, /onDrop=\{handleBoardDrop\}/);
});

test("현장 실측은 공간부터 현장조건과 검수까지 단계별로 진행한다", () => {
  for (const id of ["room", "door", "window", "structure", "facility", "checklist", "review"]) {
    assert.match(pageSource, new RegExp(`id: "${id}"`));
  }
  for (const text of ["공간 크기 입력", "출입문 형태와 치수", "창호 형태와 분할", "기둥과 보 실측", "에어컨과 고정 시설", "인터넷·전기·공사 조건", "CAD팀 전달 전 검수"]) {
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
  assert.match(pageSource, /개구부 폭\(mm\)/);
  assert.match(pageSource, /개구부 높이\(mm\)/);
  assert.match(pageSource, /모서리→개구부 시작\(mm\)/);
  assert.match(pageSource, /창 하단 높이\(mm\)/);
  assert.match(pageSource, /function MillimeterInput/);
  assert.match(pageSource, /placeOpeningOnWall/);
  assert.match(pageSource, /실내·실외 열림/);
  assert.match(pageSource, /swing/);
});

test("여닫이·미닫이·폴딩도어는 종류별 실제 평면 깊이와 벽 축을 사용한다", () => {
  assert.match(pageSource, /function openingPlanDepthMeters/);
  assert.match(pageSource, /door-sliding/);
  assert.match(pageSource, /door-folding/);
  assert.match(pageSource, /verticalOpening/);
  assert.match(pageSource, /\(verticalOpening \? openingDepth : item\.width\) \/ draft\.roomWidth/);
  assert.match(pageSource, /\(verticalOpening \? item\.width : openingDepth\) \/ draft\.roomHeight/);
  assert.doesNotMatch(pageSource, /item\.width \* 0\.72/);
  assert.match(pageSource, /item\.wall === "top" && outside \? -renderedHeight/);
  assert.match(pageSource, /wallBoundCount = draft\.items\.filter\(isWallMounted\)\.length/);
});

test("기둥과 보는 혼동되는 해칭 대신 구조 외곽선과 중심선으로 표시한다", () => {
  assert.match(pageSource, /symbol === "pillar"[\s\S]*?<rect x="22" y="15" width="56" height="40"/);
  assert.match(pageSource, /symbol === "pillar-round"[\s\S]*?<circle cx="50" cy="35" r="21"/);
  assert.match(pageSource, /symbol === "beam"[\s\S]*?<rect className="cad-dash"/);
  assert.match(stylesSource, /Site layout studio v6[\s\S]*?\.site-layout-item\.kind-pillar,[\s\S]*?background: rgba/);
});

test("도면 크게 보기에서는 양쪽 패널을 접고 A3와 모델 공간을 확대한다", () => {
  assert.match(pageSource, /canvasFocus/);
  assert.match(pageSource, /도면 크게/);
  assert.match(pageSource, /패널 보기/);
  assert.match(pageSource, /Math\.round\(920 \* roomRatio\)/);
  assert.match(stylesSource, /\.site-layout-workspace\.is-canvas-focus[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(stylesSource, /\.site-layout-workspace\.is-canvas-focus > \.site-layout-library,[\s\S]*?display: none/);
});

test("에어컨과 구조물은 CAD팀 전달용 기준거리와 높이를 저장한다", () => {
  assert.match(pageSource, /모서리→에어컨 중심/);
  assert.match(pageSource, /바닥→에어컨 하단/);
  assert.match(pageSource, /좌측 D벽→중심/);
  assert.match(pageSource, /상단 A벽→중심/);
  assert.match(pageSource, /바닥→보 하단/);
  assert.match(pageSource, /다음 보까지 유효거리/);
  assert.match(pageSource, /isWallMounted/);
  assert.match(pageSource, /snapPlacement/);
});

test("인터넷·전기·공사 체크표와 현장 메모를 A3 출력에 포함한다", () => {
  for (const text of ["인터넷 사용", "연결 방식", "사용 망", "사용 가능한 전원", "전용 회로", "암막커튼", "바닥공사", "엘리베이터", "천장 조명 철거", "에어컨 간섭", "CAD팀 전달 메모"]) {
    assert.match(pageSource, new RegExp(text));
  }
  assert.match(pageSource, /siteChecklist/);
  assert.match(pageSource, /normalizeChecklist/);
  assert.match(pageSource, /현장 통신/);
  assert.match(pageSource, /전기·시공/);
  assert.match(stylesSource, /site-layout-site-checklist/);
});

test("기존 브라우저 저장본은 새 현장조사 필드로 안전하게 보완한다", () => {
  assert.match(pageSource, /parsed\.roomWallThickness \?\? defaultDraft\.roomWallThickness/);
  assert.match(pageSource, /normalizeChecklist\(parsed\.siteChecklist\)/);
  assert.match(pageSource, /item\.swing === "outside" \? "outside" : "inside"/);
  assert.match(pageSource, /fieldNotes: typeof parsed\.fieldNotes === "string"/);
});

test("수치 입력은 클릭 즉시 기존 값을 전체 선택하고 자연스럽게 교체한다", () => {
  assert.match(pageSource, /function FriendlyNumberInput/);
  assert.match(pageSource, /onClick=\{\(event\) => event\.currentTarget\.select\(\)\}/);
  assert.match(pageSource, /inputMode=\{decimals \? "decimal" : "numeric"\}/);
  assert.match(pageSource, /if \(next && next !== "\."\) commit\(next\)/);
  assert.match(pageSource, /label="공간 가로\(m\)"/);
  assert.match(pageSource, /label="좌측 D벽에서 중심\(m\)"/);
});

test("천장형 에어컨은 저장본과 편집 화면 모두 정사각형을 유지한다", () => {
  assert.match(pageSource, /preset\.id === "aircon-ceiling" \? normalizedWidth/);
  assert.match(pageSource, /selectedItem\.presetId === "aircon-ceiling"[\s\S]*?width: value, height: value/);
  assert.match(pageSource, /정사각형 한 변\(m\)/);
  assert.match(pageSource, /label="천장형 에어컨 한 변\(m\)"/);
  assert.match(pageSource, /symbol === "aircon-ceiling"[\s\S]*?<rect x="20" y="5" width="60" height="60"/);
  assert.match(stylesSource, /\.site-layout-size-fields\.is-square \{ grid-template-columns: minmax\(0, 1fr\)/);
});

test("A3 출력은 도면·치수선·제목란을 분리하고 블록 규격을 표시한다", () => {
  assert.match(pageSource, /site-layout-paper-drawing/);
  assert.match(pageSource, /site-layout-paper-dimension dimension-width/);
  assert.match(pageSource, /site-layout-paper-dimension dimension-height/);
  assert.match(pageSource, /현장 실측 기준 · 축척 1\/60 \(A3\)/);
  assert.match(pageSource, /formatMillimeters\(item\.width\).*?formatMillimeters\(isOpening/);
  assert.match(stylesSource, /Site layout studio v7: friendly measurement editing and production-quality A3 preview/);
  assert.match(stylesSource, /\.site-layout-paper-item\.wall-bottom \.site-layout-item-caption[\s\S]*?bottom: calc\(100% \+ 3px\)/);
});
