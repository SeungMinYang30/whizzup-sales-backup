import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pageSource = fs.readFileSync(new URL("../app/site-layout-planner-page.tsx", import.meta.url), "utf8");
const geometryViewSource = fs.readFileSync(new URL("../app/site-layout-geometry-view.tsx", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const exportSource = fs.readFileSync(new URL("../app/site-layout-export.ts", import.meta.url), "utf8");

function assertContainsAll(source, values, message) {
  for (const value of values) {
    assert.match(source, value instanceof RegExp ? value : new RegExp(value), message ?? String(value));
  }
}

test("기초도면 작성 메뉴는 지연 로딩되고 개발 배지를 노출하지 않는다", () => {
  assert.match(appSource, /lazy\(\(\) => import\("\.\/site-layout-planner-page"\)\)/);
  assert.match(appSource, /id: "site-layout", label: "기초도면 작성"/);
  assert.match(appSource, /view === "site-layout" && \(/);
  assert.match(appSource, /<SiteLayoutPlannerPage \/>/);
  assert.doesNotMatch(appSource, /nav-beta-badge|>BETA</);
});

test("PDF 버튼은 인라인으로 확장되고 모바일 호환 미리보기·저장·공유를 제공한다", () => {
  assert.doesNotMatch(pageSource, /site-layout-beta-notice|BETA ·|개발 중/);
  assert.match(pageSource, /siteLayoutPdfFromSvg/);
  assert.match(pageSource, /site-layout-action-pdf-menu/);
  assert.match(pageSource, /site-layout-pdf-action-group/);
  assert.match(pageSource, /site-layout-pdf-inline/);
  assert.match(pageSource, /aria-expanded=\{pdfMenuOpen\}/);
  assert.match(pageSource, /site-layout-pdf-preview/);
  assert.match(pageSource, />미리보기<\/button>/);
  assert.match(pageSource, />저장<\/button>/);
  assert.match(pageSource, />공유<\/button>/);
  assert.match(pageSource, /site-layout-pdf-preview-canvas/);
  assert.doesNotMatch(pageSource, /<iframe src=\{pdfPreviewUrl\}/);
  assert.doesNotMatch(pageSource, /className="site-layout-action-pdf"/);
  assert.doesNotMatch(pageSource, /className="site-layout-share-button site-layout-action-share"/);
  assert.match(pageSource, /navigator\.share/);
  assert.doesNotMatch(pageSource, /navigator\.canShare/);
  assert.match(pageSource, /PDF 저장 후 카카오톡에 첨부해 주세요/);
  assert.match(pageSource, /error\.name === "AbortError"/);
  assert.match(pageSource, /PDF 공유를 열지 못했습니다\. 브라우저 권한을 확인하거나 PDF 저장 후 첨부해 주세요/);
  assert.match(stylesSource, /\.site-layout-pdf-action-group button,[\s\S]*?text-align:center/);
  assert.match(stylesSource, /\.site-layout-pdf-inline \{[\s\S]*?grid-template-columns:repeat\(3/);
  assert.match(exportSource, /document\.body\.appendChild\(anchor\)/);
  assert.match(exportSource, /anchor\.remove\(\)/);
  assert.match(exportSource, /60_000/);
  assert.doesNotMatch(pageSource, /alert\s*\(/);
});

test("모델과 A3 출력은 동일한 mm 초안과 공통 SVG 렌더러를 사용한다", () => {
  assert.match(pageSource, /import SiteLayoutGeometryView from "\.\/site-layout-geometry-view"/);
  assert.match(pageSource, /const physicalDraft = useMemo\(\(\) => normalizeDraft\(draft\)/);
  assert.match(pageSource, /const geometryViewBox = useMemo\(\(\) => computeSvgViewBox\(physicalDraft/);
  assert.match(pageSource, /<SiteLayoutGeometryView draft=\{physicalDraft\} mode="model"/);
  assert.match(pageSource, /function SiteLayoutA3Sheet/);
  assert.match(pageSource, /<SiteLayoutGeometryView[\s\S]*?draft=\{physicalDraft\}[\s\S]*?mode="paper"[\s\S]*?viewport=/);
  assert.equal((pageSource.match(/<SiteLayoutA3Sheet draft=\{draft\} physicalDraft=\{physicalDraft\}/g) ?? []).length, 2);
  assert.equal((pageSource.match(/<SiteLayoutGeometryView/g) ?? []).length, 2);
  assert.doesNotMatch(pageSource, /renderItems\("(?:model|paper)"\)/);
});

test("PDF는 기존 A3 도곽과 기관·현장 정보를 포함한 한 장의 완성 시트를 사용한다", () => {
  assertContainsAll(pageSource, [
    /className="site-layout-a3-sheet"/,
    /viewBox="0 0 4200 2970"/,
    />기초 평면도</,
    /내부 실측/,
    />기관·사업</,
    />도면 구성</,
    />현장 통신</,
    />전기·시공</,
    />CAD팀 전달 메모</,
    />PROJECT</,
    />ROOM</,
    />DATE</,
    />SCALE</,
    /NTS · 치수 mm 우선/,
    /CAD팀 전달용 · 현장 실측 후 확정/,
  ]);
  assert.match(pageSource, /site-layout-pdf-preview-canvas[\s\S]*?<SiteLayoutA3Sheet draft=\{draft\} physicalDraft=\{physicalDraft\}/);
  assert.match(pageSource, /site-layout-export-source[\s\S]*?<SiteLayoutA3Sheet draft=\{draft\} physicalDraft=\{physicalDraft\}/);
  assert.doesNotMatch(pageSource, /BETA · 현장 실측 참고용/);
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

test("PC는 직접 편집, 모바일은 단계형 실측을 자동 적용한다", () => {
  assert.match(pageSource, /type WorkflowMode = "guided" \| "direct"/);
  assert.match(pageSource, /useState<WorkflowMode>\("direct"\)/);
  assert.match(pageSource, /matchMedia\("\(max-width: 760px\)"\)\.matches \? "guided" : "direct"/);
  assert.doesNotMatch(pageSource, />현장 실측 도우미<\/button>/);
  assert.doesNotMatch(pageSource, /site-layout-mode-toggle/);
  assert.match(pageSource, /workflowMode === "guided" && renderGuidedQuestion\(\)/);
  assert.match(pageSource, /className="site-layout-canvas-head"/);
  assert.match(pageSource, /selectedItemId=\{selectedId\} interactive interactionMode=\{workflowMode === "direct" \? "drag" : "select"\} showDimensions showLabels/);
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

test("모바일 질문 이동 버튼은 CAD 모델 위에 노출하고 기존 하단 버튼은 숨긴다", () => {
  assert.match(pageSource, /renderQuestionNavigation\("site-layout-question-navigation-mobile"\)[\s\S]*?<div ref=\{workspaceRef\}/);
  assert.match(pageSource, /renderQuestionNavigation\("site-layout-question-navigation-desktop"\)/);
  assert.match(stylesSource, /\.site-layout-question-navigation-mobile \{ display: none; \}/);
  assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*?\.site-layout-question-navigation-mobile \{[\s\S]*?display: grid;/);
  assert.match(stylesSource, /@media \(max-width: 760px\)[\s\S]*?\.site-layout-question-navigation-desktop \{ display: none; \}/);
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
    /문틀 전체 폭/,
    /창틀 전체 폭/,
    /문틀 전체 높이/,
    /창틀 전체 높이/,
    /바닥 → 창 하단 높이/,
    /바닥 → 보 하단/,
    /다음 보까지 거리/,
    /이전 창호 기준/,
    /창틀 끝 사이/,
    /중심 사이/,
  ]);
});

test("현장 통신·전기·공사 조건과 CAD 메모를 마지막 설문과 PDF에 반영한다", () => {
  assertContainsAll(pageSource, [
    /인터넷 사용/,
    /연결 방식/,
    /사용 망/,
    /사용 가능한 전원/,
    /암막커튼/,
    /바닥공사/,
    /엘리베이터/,
    /천장 조명 철거/,
    /마지막으로 CAD팀 전달 메모를 적어 주세요\./,
    /인터넷·망/,
    /전기·시공/,
    /현장 메모·CAD팀 전달사항/,
  ]);
  assert.doesNotMatch(pageSource, /key: "airconConflict"/);
  assert.doesNotMatch(pageSource, /title: "전용 전기 회로가 필요한가요\?"/);
  assert.match(pageSource, /geometryIssues\.some\(\(issue\) => issue\.severity === "error"\)/);
  assert.match(pageSource, /물리 치수와 객체 위치 검사를 통과했습니다\./);
});

test("현재 입력은 기기 복구본과 기관별 API·Drive 저장 및 보관함을 함께 사용한다", () => {
  assert.match(pageSource, /const STORAGE_KEY = "whizzup:site-layout-draft:v1"/);
  assert.match(pageSource, /const DRAFT_LIBRARY_KEY = "whizzup:site-layout-local-drafts:v1"/);
  assert.match(pageSource, /const REMOTE_CONTEXT_KEY = "whizzup:site-layout-remote-context:v1"/);
  assertContainsAll(pageSource, [
    /normalizeStoredDraft\(parsed\)/,
    /parseLocalDraftLibrary\(window\.localStorage\.getItem\(DRAFT_LIBRARY_KEY\)\)/,
    /async function saveCurrentDraft\(\)/,
    /async function retryRemoteDrive\(/,
    /async function refreshRemoteLayouts\(\)/,
    /async function loadRemoteDraft\(/,
    /fetch\("\/api\/site-layouts"/,
    /fetch\("\/api\/site-layouts\/files"/,
    /baseVersion: activeRemoteVersion/,
    /response\.status === 409/,
    /aria-label="도면 보관함"/,
    /placeholder="기관명·실 이름·사업 차수 검색"/,
    /draftLibraryPageSize = 20/,
    /Drive 다시 시도/,
  ]);
  assert.match(pageSource, /a3PdfBase64: await fileAsDataUrl\(pdf\)/);
  const summaryNormalizer = pageSource.match(/function normalizeRemoteSummary[\s\S]*?\n}\n\nfunction normalizeRemoteLayout/)?.[0] ?? "";
  assert.ok(summaryNormalizer, "metadata-only 목록 normalizer가 있어야 합니다.");
  assert.doesNotMatch(summaryNormalizer, /editorDraftFromRemote|!draft/, "목록 항목은 draft 없이도 유지되어야 합니다.");
  assert.doesNotMatch(pageSource, /organizationId|campaignId|quotationId/);
});

test("보는 벽 부착을 기본으로 첫 보와 다음 보의 실측 기준을 좌표에 반영한다", () => {
  assertContainsAll(pageSource, [
    /type StructureAttachment = \{ mode: "wall"; wall: WallSide \}/,
    /type StructureMeasurement =/,
    /structureAttachment: preset\.kind === "beam" \|\| preset\.kind === "pillar" \? \{ mode: "wall", wall: "top" \}/,
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
  const wallMountedSource = pageSource.match(/function isWallMounted\(item: LayoutItem\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(wallMountedSource, "벽 부착 객체 판별 함수를 찾을 수 있어야 합니다.");
  assert.match(wallMountedSource, /item\.kind === "beam"/);
  assert.match(wallMountedSource, /item\.kind === "pillar" && item\.structureAttachment\?\.mode === "wall"/);
});

test("기둥은 벽 부착과 실내 독립을 나누고 다음 기둥을 면간·중심간 거리로 이어 붙인다", () => {
  assertContainsAll(pageSource, [
    /function previousPillar\(/,
    /function placePillarByMeasurement\(/,
    /function updatePillarMeasurement\(/,
    /function updatePillarWallInset\(/,
    /function updateFreePillarDistance\(/,
    /function addFollowupPillar\(/,
    /기둥이 벽에 붙어 있나요, 실내에 따로 있나요\?/,
    /벽 부착 기둥/,
    /실내 독립 기둥/,
    /좌측 D벽/,
    /우측 B벽/,
    /상단 A벽/,
    /하단 C벽/,
    /기둥 면 직각거리\(mm\)/,
    /기둥 폭\(mm\)/,
    /기둥 깊이\(mm\)/,
    /이전 기둥 끝면 → 이번 기둥 시작면 거리\(m\)/,
    /끝면 → 시작면/,
    /중심 → 중심/,
    /\+ 다음 기둥 추가/,
    /else if \(item\.kind === "pillar"\) addFollowupPillar\(item\)/,
    /function rebasePillarToWall\(/,
  ]);
  assert.match(pageSource, /preset\.kind === "beam" \|\| preset\.kind === "pillar" \? \{ mode: "wall", wall: "top" \}/);
  assert.match(pageSource, /preset\.kind === "beam" \|\| preset\.kind === "pillar" \? \{ axis: "x", referenceType: "wall"/);
});

test("창호는 이전 창틀 끝 또는 중심을 기준으로 연쇄 등록한다", () => {
  assertContainsAll(pageSource, [
    /function previousWindow\(/,
    /function addFollowupWindow\(/,
    /referenceItemId: reference\.id/,
    /distanceMode: "clear"/,
    /이전 창호 기준/,
    /창틀 끝 사이/,
    /중심 사이/,
    /\+ 다음 창호 추가/,
    /items: resolveWindowReferences\(moved\)/,
    /items: resolveWindowReferences\(finished\)/,
  ]);
});

test("간편 실측 객체 작업은 수정에 집중하고 복사·삭제를 더보기 안에 안전하게 둔다", () => {
  assertContainsAll(pageSource, [
    /const activeStageItems = useMemo/,
    /className="site-layout-guided-stage-items"/,
    /className="site-layout-object-more"/,
    /className="site-layout-stage-manage"/,
    /function duplicateGuidedItem\(/,
    /function editGuidedItem\(/,
    /function rebaseReferencesAfterDeletion\(/,
    /function removeItemById\(/,
    /deletedParentId/,
    /referenceItemId: reference\.id/,
    /모든 객체 삭제/,
    /function pendingStageChecks\(/,
    /stageChecks: pendingStageChecks\(current, deleted\)/,
    /객체를 선택해 치수를 확인하거나 수정할 수 있습니다/,
  ]);
  assert.doesNotMatch(pageSource, /site-layout-guided-selection-bar/);
  assert.match(pageSource, /selectedItemId=\{selectedId\} interactive interactionMode=\{workflowMode === "direct" \? "drag" : "select"\} showDimensions showLabels/);
  assert.match(pageSource, /onItemPointerDown=\{workflowMode === "direct" \? startGeometryDrag : undefined\}/);
});

test("벽 두께는 고정 기본값을 사용하고 공간 입력은 즉시 도면에 반영한다", () => {
  assert.doesNotMatch(pageSource, />벽 두께</);
  assert.doesNotMatch(pageSource, />이 크기로 시작</);
  assert.match(pageSource, /roomWallThickness: 0\.15/);
  assert.match(pageSource, /onChange=\{\(event\) => \{[\s\S]*?if \(next && next !== "\."\) commit\(next\)/);
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
    /\.site-layout-workspace\.is-mobile-expanded \.site-layout-canvas-panel\.view-paper \.site-layout-model-space \{[\s\S]*?display: none;/,
    /\.site-layout-workspace\.is-mobile-expanded \.site-layout-canvas-panel\.view-model \.site-layout-paper-space \{[\s\S]*?display: none;/,
    /\.site-layout-workspace\.is-mobile-expanded \.site-layout-canvas-panel\.view-paper \.site-layout-paper-space \{[\s\S]*?display: grid;/,
    /@media \(max-width: 760px\) and \(orientation: portrait\)/,
    /@media \(max-height: 500px\) and \(orientation: landscape\)/,
    /\.site-layout-workspace\.is-mobile-expanded\.is-guided \.site-layout-board > svg \[data-item-id\] \{[\s\S]*?touch-action: pan-x pan-y pinch-zoom;/,
  ]);
  assert.doesNotMatch(pageSource, /선택 객체 빠른 작업/);
});

test("직접 편집에서는 PC 드래그와 포인터 좌표 변환을 유지한다", () => {
  assertContainsAll(pageSource, [
    /draggable/,
    /handlePresetDragStart/,
    /application\/x-whizzup-floor-block/,
    /handleBoardDrop/,
    /onDrop=\{handleBoardDrop\}/,
    /modelPointFromClient\(event, bounds, geometryViewBox\)/,
    /onItemPointerDown=\{workflowMode === "direct" \? startGeometryDrag : undefined\}/,
    /onModelPointerMove=/,
  ]);
});

test("큰 터치 PC는 직접 편집으로 시작하고 guided 도면은 선택 전용 터치 동작을 쓴다", () => {
  assert.match(pageSource, /window\.matchMedia\("\(max-width: 760px\)"\)\.matches \? "guided" : "direct"/);
  assert.doesNotMatch(pageSource, /setWorkflowMode\(window\.matchMedia\("\(max-width: 760px\), \(pointer: coarse\)"/);
  assert.match(pageSource, /interactionMode=\{workflowMode === "direct" \? "drag" : "select"\}/);
  assert.match(geometryViewSource, /interactionMode === "select" \? "pan-x pan-y pinch-zoom" : "none"/);
  assert.match(geometryViewSource, /if \(moved < 8\) onBackgroundPointerDown/);
});

test("직접 편집 기둥은 벽 부착과 독립 배치, 네 기준벽 면거리를 모두 수정한다", () => {
  assertContainsAll(pageSource, [
    /aria-label="기둥 배치 방식"/,
    /벽 부착 기둥/,
    /실내 독립 기둥/,
    /가로 기준벽/,
    /세로 기준벽/,
    /freeReferenceX/,
    /freeReferenceY/,
    /벽→기둥 면 직각거리\(mm\)/,
    /두 기준벽→기둥 면거리/,
  ]);
});

test("CAD 모델은 전체 도면 자동 맞춤과 mm 단위를 명확히 알린다", () => {
  assert.match(pageSource, /전체 도면 자동 맞춤/);
  assert.match(pageSource, /클릭 선택 · 끌어서 이동 · 단위 mm/);
  assert.doesNotMatch(pageSource, /도면 크게|zoom|paperZoom/);
});

test("직접 편집한 보는 새 벽 기준으로 재측정되고 복제와 inspector 거리도 실제 좌표를 갱신한다", () => {
  assertContainsAll(pageSource, [
    /function rebaseBeamToWall\(/,
    /const measurement = wallMeasurement\(placement\.wall, "start", placement\.offset\)/,
    /item\.kind === "beam"[\s\S]*?\? rebaseBeamToWall/,
    /item\.kind === "pillar"[\s\S]*?\? rebasePillarToWall/,
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
  assert.doesNotMatch(pageSource, /<details className="site-layout-context-details" open>/);
  assert.match(pageSource, /<summary><b>기관·사업 정보<\/b>/);
  assertContainsAll(stylesSource, [
    /@media \(max-width: 760px\)[\s\S]*?\.site-layout-brand \{ display: none; \}/,
    /@media \(max-width: 760px\)[\s\S]*?\.site-layout-local-state \{ display: none; \}/,
    /\.site-layout-context-details:not\(\[open\]\) > \.site-layout-context-bar \{ display: none; \}/,
    /\.site-layout-guide-copy small,[\s\S]*?\.site-layout-guide-copy p \{ display: none; \}/,
  ]);
});

test("새 진입은 빈 도면으로 시작하고 직전 작업은 복구본으로만 보존한다", () => {
  assertContainsAll(pageSource, [
    /function hasMeaningfulDraftChanges\(/,
    /if \(normalized && hasMeaningfulDraftChanges\(normalized\)\) recoveryDraft = normalized/,
    /window\.localStorage\.removeItem\(STORAGE_KEY\)/,
    /이전 작업 복구/,
    /setDraft\(cloneDraft\(defaultDraft\)\)/,
    /window\.localStorage\.removeItem\(REMOTE_CONTEXT_KEY\)/,
  ]);
  const hydrationSource = pageSource.match(/useEffect\(\(\) => \{\n    const frame[\s\S]*?\n  \}, \[\]\);/)?.[0] ?? "";
  assert.ok(hydrationSource, "초기 진입 복구 로직을 찾을 수 있어야 합니다.");
  assert.doesNotMatch(hydrationSource, /setDraft\(normalized\)/);
});

test("최종 단계 저장은 중복 버튼 없이 sticky 버튼 상태로 피드백한다", () => {
  const reviewSource = pageSource.match(/if \(activeStep\.id === "review"\)[\s\S]*?return <div className="site-layout-question-card site-layout-question-review"[\s\S]*?;\n    }/)?.[0] ?? "";
  assert.ok(reviewSource, "최종 검수 카드를 찾을 수 있어야 합니다.");
  assert.doesNotMatch(reviewSource, /site-layout-question-confirm/);
  assert.match(pageSource, /remoteOperation === "saving" \? "저장 중…"/);
  assert.match(pageSource, /remoteSavePhase === "drive-ready" && !remoteDraftDirty \? "저장됨 ✓"/);
  assert.match(stylesSource, /\.site-layout-step-actions > button\.is-saved/);
});

test("PDF 공유는 공유 실패를 다운로드로 바꾸지 않고 세 작업을 같은 강조로 표시한다", () => {
  const shareSource = pageSource.match(/function sharePreparedPdf\([\s\S]*?\n  }\n  async function downloadCurrentPdf/)?.[0] ?? "";
  assert.ok(shareSource, "PDF 공유 함수를 찾을 수 있어야 합니다.");
  assert.match(shareSource, /navigator\.share\?\.bind\(navigator\)/);
  assert.doesNotMatch(shareSource, /navigator\.canShare/);
  assert.doesNotMatch(shareSource, /downloadPreparedPdf\(/);
  assert.match(shareSource, /PDF 저장 후 카카오톡에 첨부해 주세요/);
  assert.doesNotMatch(stylesSource, /\.site-layout-pdf-inline > button:last-child \{[^}]*background:#3157e8/);
});

test("CAD팀 PDF는 객체별 실제 치수와 측정 기준을 진한 선으로 표기한다", () => {
  assertContainsAll(geometryViewSource, [
    /function measurementLabel\(/,
    /buildSiteLayoutDimensionSegmentsMm/,
    /function LinearDimension\(/,
    /function ObjectDimensionLayer\(/,
    /data-dimension-id=\{segment\.id\}/,
    /segment\.start\.xMm/,
    /segment\.end\.xMm/,
    /showDimensions && mode === "paper" && <ObjectDimensionLayer/,
    /const symbolStrokeWidth = mode === "paper" \? 3\.2 : 1\.55/,
    /const pillarStrokeWidth = mode === "paper" \? 1\.05 : 1/,
    /const openingStrokeWidth = mode === "paper" \? 2\.75 : 2\.5/,
    /openingFill: "#d5eef2"/,
    /fillOpacity=\{0\.66\}/,
    /const centerOffset = -draft\.roomWallThicknessMm \* 0\.5/,
    /item\.kind === "pillar" \? pillarStrokeWidth : symbolStrokeWidth/,
    /paintOrder="stroke"/,
  ]);
  const measurementLabelSource = geometryViewSource.match(/function measurementLabel[\s\S]*?\n}\n\ntype ItemLabelPlacement/)?.[0] ?? "";
  assert.ok(measurementLabelSource, "A3 객체 설명 생성 함수를 찾을 수 있어야 합니다.");
  assert.match(measurementLabelSource, /if \(item\.presetId === "aircon-ceiling"\) \{[\s\S]*?설치면 H=/);
  assert.doesNotMatch(measurementLabelSource, /840|이전 창호|이전 보|좌측 중심/);
  assert.match(geometryViewSource, /if \(segment\.kind === "position"\) return point/);
  assert.match(pageSource, /천장 조명 철거/);
  assert.doesNotMatch(pageSource, /전용 회로 \{surveyChoiceLabel/);
});

test("PC 직접 편집 도면은 전체 가용 폭을 사용하고 모바일에만 실측 방식 선택을 노출한다", () => {
  assertContainsAll(stylesSource, [
    /@media \(min-width: 761px\)[\s\S]*?\.site-layout-mode-toggle \{[\s\S]*?display: none;/,
    /\.site-layout-workspace:not\(\.is-guided\) \.site-layout-canvas-panel \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?width: 100%;/,
    /\.site-layout-workspace:not\(\.is-guided\) \.site-layout-model-space \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?width: 100%;/,
    /\.site-layout-workspace:not\(\.is-guided\) \.site-layout-board-wrap \{[\s\S]*?width: 100% !important;/,
  ]);
});
