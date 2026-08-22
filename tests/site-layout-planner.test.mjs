import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pageSource = fs.readFileSync(new URL("../app/site-layout-planner-page.tsx", import.meta.url), "utf8");
const geometryViewSource = fs.readFileSync(new URL("../app/site-layout-geometry-view.tsx", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function assertContainsAll(source, values, message) {
  for (const value of values) {
    assert.match(source, value instanceof RegExp ? value : new RegExp(value), message ?? String(value));
  }
}

test("기초도면 작성 메뉴는 지연 로딩되고 BETA 상태를 함께 알린다", () => {
  assert.match(appSource, /lazy\(\(\) => import\("\.\/site-layout-planner-page"\)\)/);
  assert.match(appSource, /id: "site-layout", label: "기초도면 작성"/);
  assert.match(appSource, /view === "site-layout" && \(/);
  assert.match(appSource, /<SiteLayoutPlannerPage \/>/);
  assert.match(appSource, /item\.id === "site-layout" && <small className="nav-beta-badge">BETA<\/small>/);
});

test("페이지와 A3 출력은 비차단 BETA 안내를 유지한다", () => {
  assert.match(pageSource, /className="site-layout-beta-notice" role="note"/);
  assert.match(pageSource, /현재 개발 중인 기능입니다\. 현장 실측 초안 및 CAD팀 전달용이며 최종 시공 도면으로 사용할 수 없습니다\./);
  assert.match(pageSource, /BETA · 현장 실측 참고용 · CAD 검토 후 확정/);
  assert.match(stylesSource, /\.site-layout-beta-notice/);
  assert.doesNotMatch(pageSource, /alert\s*\(/);
});

test("모델과 A3 출력은 동일한 mm 초안과 공통 SVG 렌더러를 사용한다", () => {
  assert.match(pageSource, /import SiteLayoutGeometryView from "\.\/site-layout-geometry-view"/);
  assert.match(pageSource, /const physicalDraft = useMemo\(\(\) => normalizeDraft\(draft\)/);
  assert.match(pageSource, /const geometryViewBox = useMemo\(\(\) => computeSvgViewBox\(physicalDraft/);
  assert.match(pageSource, /<SiteLayoutGeometryView draft=\{physicalDraft\} mode="model"/);
  assert.match(pageSource, /<SiteLayoutGeometryView[\s\S]*?draft=\{physicalDraft\} mode="paper"/);
  assert.equal((pageSource.match(/<SiteLayoutGeometryView/g) ?? []).length, 2);
  assert.doesNotMatch(pageSource, /renderItems\("(?:model|paper)"\)/);
});

test("공통 SVG는 실제 mm 좌표, 동일 viewBox, 개구부 마스크를 사용한다", () => {
  assertContainsAll(geometryViewSource, [
    /computeItemGeometryMm/,
    /computeOpeningCutGeometryMm/,
    /computeSvgViewBox/,
    /computeWallGeometryMm/,
    /modelPointFromClient/,
    /viewBox=\{viewBox\.value\}/,
    /preserveAspectRatio="xMidYMid meet"/,
    /data-unit="mm"/,
    /maskUnits="userSpaceOnUse"/,
    /openingCuts\.map/,
    /vectorEffect="non-scaling-stroke"/,
  ]);
  assert.match(geometryViewSource, /export type SiteLayoutGeometryViewMode = "model" \| "mobile" \| "paper"/);
});

test("문·창호·구조물·에어컨 심벌은 공통 geometry 결과로 그린다", () => {
  assertContainsAll(geometryViewSource, [
    /function DoorSymbol/,
    /function WindowSymbol/,
    /function GenericItemSymbol/,
    /computeItemGeometryMm\(draft, item\)/,
    /<DoorSymbol/,
    /<WindowSymbol/,
    /<GenericItemSymbol/,
    /item\.kind === "pillar"/,
    /item\.kind === "beam"/,
    /item\.presetId === "aircon-wall"/,
  ]);
  assert.match(geometryViewSource, /presetId === "aircon-ceiling"/);
  assert.match(geometryViewSource, /width=\{width\} height=\{height\}/);
});

test("PC는 직접 편집, 모바일은 현장 실측 도우미를 기본으로 분리한다", () => {
  assert.match(pageSource, /type WorkflowMode = "guided" \| "direct"/);
  assert.match(pageSource, /useState<WorkflowMode>\("direct"\)/);
  assert.match(pageSource, /matchMedia\("\(max-width: 760px\), \(pointer: coarse\)"\)\.matches \? "guided" : "direct"/);
  assert.match(pageSource, />현장 실측 도우미<\/button>/);
  assert.match(pageSource, />도면 직접 편집<\/button>/);
  assert.match(pageSource, /모바일에서 질문을 하나씩 따라가며 빠짐없이 실측합니다\./);
  assert.match(pageSource, /workflowMode === "guided" && renderGuidedQuestion\(\)/);
  assert.match(pageSource, /workflowMode === "direct" && <div className="site-layout-commandbar"/);
  assert.match(pageSource, /interactive=\{workflowMode === "direct"\}/);
});

test("간편 실측은 한 질문씩 이전·다음으로 이동하는 7단계 흐름이다", () => {
  assertContainsAll(pageSource, [
    /id: "room"/,
    /id: "door"/,
    /id: "window"/,
    /id: "structure"/,
    /id: "facility"/,
    /id: "checklist"/,
    /id: "review"/,
    /const \[activeQuestionIndex, setActiveQuestionIndex\] = useState\(0\)/,
    /function renderGuidedQuestion\(\)/,
    /function questionNext\(\)/,
    /function questionPrevious\(\)/,
    />이전 질문<\/button>/,
    /activeQuestionIndex === currentQuestionCount - 1 \? "단계 완료·다음" : "다음 질문"/,
  ]);
  assert.match(pageSource, /roomQuestions\[activeQuestionIndex\]/);
  assert.match(pageSource, /checklistQuestions\[Math\.min\(activeQuestionIndex/);
});

test("간편 실측 질문은 현장 기준 벽·모서리·실측값을 순서대로 받는다", () => {
  assertContainsAll(pageSource, [
    /실내 가로 길이는 몇 m인가요\?/,
    /바닥부터 천장까지 높이는 몇 m인가요\?/,
    /어느 벽에 설치되어 있나요\?/,
    /어느 모서리에서 거리를 쟀나요\?/,
    /두 벽에서 중심까지 거리를 입력해 주세요\./,
    /현장에서 잰 실제 크기를 입력해 주세요\./,
    /좌측 D벽 → \{item\.kind === "pillar" \? "기둥 면" : "중심"\}/,
    /상단 A벽 → \{item\.kind === "pillar" \? "기둥 면" : "중심"\}/,
    /개구부 폭/,
    /개구부 높이/,
    /바닥 → 창 하단 높이/,
    /바닥 → 보 하단/,
    /다음 보까지 거리/,
    /이전 창호 기준/,
    /창호 끝면 사이/,
    /중심 사이/,
  ]);
});

test("현장 통신·전기·공사 조건과 CAD 메모를 마지막 설문과 A3에 반영한다", () => {
  assertContainsAll(pageSource, [
    /인터넷 사용/,
    /연결 방식/,
    /사용 망/,
    /사용 가능한 전원/,
    /암막커튼/,
    /바닥공사/,
    /엘리베이터/,
    /천장 조명 철거/,
    /에어컨 간섭/,
    /마지막으로 CAD팀 전달 메모를 적어 주세요\./,
    /현장 통신/,
    /전기·시공/,
    /CAD팀 전달 메모/,
  ]);
  assert.doesNotMatch(pageSource, /title: "전용 전기 회로가 필요한가요\?"/);
  assert.match(pageSource, /geometryIssues\.some\(\(issue\) => issue\.severity === "error"\)/);
  assert.match(pageSource, /물리 치수와 객체 위치 검사를 통과했습니다\./);
});

test("현재 입력은 기기 복구본과 기관별 API·Drive 저장 상태를 함께 사용한다", () => {
  assert.match(pageSource, /const STORAGE_KEY = "whizzup:site-layout-draft:v1"/);
  assert.match(pageSource, /const DRAFT_LIBRARY_KEY = "whizzup:site-layout-local-drafts:v1"/);
  assert.match(pageSource, /const REMOTE_CONTEXT_KEY = "whizzup:site-layout-remote-context:v1"/);
  assertContainsAll(pageSource, [
    /normalizeStoredDraft\(parsed\)/,
    /parseLocalDraftLibrary\(window\.localStorage\.getItem\(DRAFT_LIBRARY_KEY\)\)/,
    /function persistLocalDrafts\(/,
    /async function saveCurrentDraft\(\)/,
    /async function refreshRemoteLayouts\(\)/,
    /async function loadRemoteDraft\(/,
    /type RemoteLayoutSummary =/,
    /function normalizeRemoteSummary\(/,
    /const normalized = normalizeRemoteSummary\(item\)/,
    /function loadLocalDraft\(/,
    /function deleteLocalDraft\(/,
    /window\.localStorage\.setItem\(DRAFT_LIBRARY_KEY/,
    /fetch\("\/api\/site-layouts"/,
    /fetch\(`\/api\/site-layouts\?id=/,
    /method: "POST"/,
    /baseVersion: activeRemoteVersion/,
    /draft: \{ schemaVersion: 3, editorDraft: recovery\.draft, geometryDraft: physicalDraft \}/,
    /response\.status === 409/,
    /const \[activeRemoteFingerprint, setActiveRemoteFingerprint\] = useState\(""\)/,
    /setActiveRemoteFingerprint\(JSON\.stringify\(draft\)\)/,
    /activeRemoteFingerprint === currentDraftFingerprint \? "기관 도면 저장됨" : "저장 후 수정됨"/,
    /activeLocalDraftFingerprint === currentDraftFingerprint \? "기기 복구됨" : "복구 후 수정됨"/,
    /aria-label="기관별 기초도면 목록"/,
    /기관 도면 저장/,
    />불러오기<\/button>/,
    />삭제<\/button>/,
    /Google Drive 보관 완료/,
    /이 기기 복구본/,
    /organizationName:/,
    /businessRound:/,
    /roomName:/,
  ]);
  const summaryNormalizer = pageSource.match(/function normalizeRemoteSummary[\s\S]*?\n}\n\nfunction normalizeRemoteLayout/)?.[0] ?? "";
  assert.ok(summaryNormalizer, "metadata-only 목록 normalizer가 있어야 합니다.");
  assert.doesNotMatch(summaryNormalizer, /editorDraftFromRemote|!draft/, "목록 항목은 draft 없이도 유지되어야 합니다.");
  assert.doesNotMatch(pageSource, /organizationId|campaignId|quotationId/);
});

test("보는 벽 부착을 기본으로 첫 보와 다음 보의 실측 기준을 좌표에 반영한다", () => {
  assertContainsAll(pageSource, [
    /type StructureAttachment = \{ mode: "wall"; wall: WallSide \}/,
    /type StructureMeasurement =/,
    /structureAttachment: preset\.kind === "beam" \? \{ mode: "wall", wall: "top" \}/,
    /referenceType: "item"/,
    /distanceMode: "clear"/,
    /distanceMm:/,
    /function placeBeamByMeasurement\(/,
    /function addFollowupBeam\(/,
    /첫 보는 어느 모서리에서부터 쟀나요\?/,
    /이전 보 기준/,
    /면에서 면까지/,
    /중심에서 중심까지/,
    /"\+ 다음 보 추가"/,
  ]);
  assert.match(pageSource, /isWallMounted\(item: LayoutItem\)[^{]*\{ return[^}]*item\.kind === "beam"/);
});

test("모바일 도면 크게 보기는 CSS immersive와 전체화면·가로 보기의 안전한 폴백을 제공한다", () => {
  assertContainsAll(pageSource, [
    /const \[canvasExpanded, setCanvasExpanded\] = useState\(false\)/,
    /async function toggleCanvasExpanded\(\)/,
    /requestFullscreen/,
    /orientation\?\.lock\?\.\("landscape"\)/,
    /orientation\?\.unlock\?\.\(\)/,
    /orientation\?: ScreenOrientation/,
    /window\.addEventListener\("popstate"/,
    /document\.addEventListener\("fullscreenchange"/,
    /event\.key === "Escape"/,
    /휴대폰을 가로로 돌리면 도면을 더 넓게 볼 수 있습니다/,
  ]);
  assertContainsAll(stylesSource, [
    /\.site-layout-workspace\.is-mobile-expanded \{[\s\S]*?position: fixed;[\s\S]*?height: 100dvh;/,
    /\.site-layout-workspace\.is-mobile-expanded \.site-layout-model-space,[\s\S]*?overflow: auto;/,
    /@media \(max-width: 760px\) and \(orientation: portrait\)/,
    /@media \(max-height: 500px\) and \(orientation: landscape\)/,
  ]);
});

test("직접 편집에서는 PC 드래그와 포인터 좌표 변환을 유지한다", () => {
  assertContainsAll(pageSource, [
    /draggable/,
    /handlePresetDragStart/,
    /application\/x-whizzup-floor-block/,
    /handleBoardDrop/,
    /onDrop=\{handleBoardDrop\}/,
    /modelPointFromClient\(event, bounds, geometryViewBox\)/,
    /onItemPointerDown=\{startGeometryDrag\}/,
    /onModelPointerMove=/,
  ]);
});

test("직접 편집한 보는 새 벽 기준으로 재측정되고 복제와 inspector 거리도 실제 좌표를 갱신한다", () => {
  assertContainsAll(pageSource, [
    /function rebaseBeamToWall\(/,
    /const measurement = wallMeasurement\(placement\.wall, "start", placement\.offset\)/,
    /item\.kind === "beam" \? rebaseBeamToWall/,
    /function finishGeometryDrag\(/,
    /structureAttachment: \{ mode: "wall" as const, wall: placement\.wall \}/,
    /referenceItemId: selectedItem\.id/,
    /distanceMode: "clear"/,
    /distanceMm: Math\.round\(gap \* 1000\)/,
    /const oppositeWall: WallSide/,
    /function updateBeamDistanceFromInspector\(/,
    /updateBeamMeasurement\(item, \{ \.\.\.measurement, distanceMm: Math\.round\(value \* 1000\) \}\)/,
    /기준 모서리→보 시작면 거리\(m\)/,
    /value=\{selectedItem\.structureMeasurement \? selectedItem\.structureMeasurement\.distanceMm \/ 1000 : displayedWallDistance\(selectedItem\)\}/,
    /onCommit=\{\(value\) => updateBeamDistanceFromInspector\(selectedItem, value\)\}/,
  ]);
  assert.doesNotMatch(pageSource, /updateSelectedById\(item\.id, \{ beamSpacing: value \}\)/);
});

test("제품 블록은 보존하되 기초도면 입력과 출력에서 숨긴다", () => {
  assert.match(pageSource, /const basicGroups: PresetGroup\[\] = \["문", "창호", "기둥·보", "현장 설비"\]/);
  assert.match(pageSource, /itemPresets\.filter\(\(preset\) => basicGroups\.includes\(preset\.group\)\)/);
  assert.match(pageSource, /itemLayer\(legacy\) !== "equipment" && visibleLayers\[itemLayer\(legacy\)\]/);
  assert.match(pageSource, /equipment: false/);
  assert.doesNotMatch(pageSource, /제품 DB 매칭/);
  assert.doesNotMatch(pageSource, /VR 스포츠실 예시/);
});

test("수치 입력은 클릭 시 전체 선택되고 mm 입력은 명시적으로 m 모델에 환산된다", () => {
  assert.match(pageSource, /function FriendlyNumberInput/);
  assert.match(pageSource, /onClick=\{\(event\) => event\.currentTarget\.select\(\)\}/);
  assert.match(pageSource, /inputMode=\{decimals \? "decimal" : "numeric"\}/);
  assert.match(pageSource, /function MillimeterInput/);
  assert.match(pageSource, /value=\{Math\.round\(valueMeters \* 1000\)\}/);
  assert.match(pageSource, /onCommit=\{\(value\) => onCommit\(value \/ 1000\)\}/);
});

test("간편 실측의 모바일 UI는 패널 대신 큰 터치 입력과 한 열 측정을 제공한다", () => {
  assert.match(stylesSource, /Site layout studio v9: guided mobile survey, explicit local drafts and one mm renderer/);
  assert.match(stylesSource, /\.site-layout-workspace\.is-guided > \.site-layout-library,[\s\S]*?\.site-layout-workspace\.is-guided > \.site-layout-inspector \{ display: none; \}/);
  assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*?\.site-layout-question-card input,[\s\S]*?min-height: 50px; font-size: 16px/);
  assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*?\.site-layout-choice-grid button,[\s\S]*?min-height: 52px/);
  assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*?\.site-layout-guided-measurements \{ grid-template-columns: 1fr; \}/);
  assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*?\.site-layout-workspace\.is-guided \.site-layout-board-wrap \{ max-width: 100% !important; \}/);
});

test("모바일 진입부는 중복 브랜드와 설명을 숨기고 기관 정보를 접어서 질문을 빨리 보여준다", () => {
  assert.match(pageSource, /<details className="site-layout-context-details">/);
  assert.match(pageSource, /<summary><b>기관·사업 정보<\/b>/);
  assertContainsAll(stylesSource, [
    /@media \(max-width: 760px\)[\s\S]*?\.site-layout-brand \{ display: none; \}/,
    /@media \(max-width: 760px\)[\s\S]*?\.site-layout-local-state \{ display: none; \}/,
    /\.site-layout-context-details:not\(\[open\]\) > \.site-layout-context-bar \{ display: none; \}/,
    /\.site-layout-guide-copy small,[\s\S]*?\.site-layout-guide-copy p \{ display: none; \}/,
  ]);
});

test("A3 도면은 객체별 실제 치수와 측정 기준을 진한 선으로 표기한다", () => {
  assertContainsAll(geometryViewSource, [
    /function measurementLabel\(/,
    /개구부 \$\{formatMm\(item\.widthMm\)\}/,
    /이전 창호/,
    /이전 보/,
    /좌측 중심/,
    /const symbolStrokeWidth = mode === "paper" \? 2\.35 : 1\.55/,
    /paintOrder="stroke"/,
  ]);
  assert.match(pageSource, /천장조명 철거/);
  assert.doesNotMatch(pageSource, /전용 회로 \{surveyChoiceLabel/);
});
