"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent } from "react";

type LayoutItemKind = "equipment" | "table" | "door" | "window" | "pillar" | "beam" | "fixture" | "note";
type LayoutSymbol =
  | "equipment" | "screen" | "kiosk" | "vision-sensor" | "lidar-sensor" | "shooting-sensor"
  | "motion-3d" | "ifit-premium" | "ifit-slim" | "touch-table" | "action-floor" | "power-lan"
  | "table" | "chair" | "door-single" | "door-double" | "door-unequal" | "door-sliding" | "door-folding"
  | "window-fixed" | "window-sliding-2" | "window-3" | "window-4" | "window-6" | "window-project"
  | "pillar" | "pillar-round" | "beam" | "aircon-wall" | "aircon-ceiling" | "note";
type LayoutView = "model" | "paper";
type LayoutLayer = "opening" | "structure" | "fixture" | "equipment" | "note";
type PresetGroup = "문" | "창호" | "기둥·보" | "현장 설비" | "에어패스 시스템" | "공통 장비·가구" | "기타";
type WallSide = "top" | "right" | "bottom" | "left";
type OpeningHand = "left" | "right";
type OpeningSwing = "inside" | "outside";
type SurveyChoice = "" | "yes" | "no" | "review";
type InternetMode = "" | "wired" | "wireless" | "both" | "none";
type NetworkType = "" | "education" | "private" | "both" | "unknown";
type GuideStepId = "room" | "door" | "window" | "structure" | "facility" | "checklist" | "review";
type StageCheckKey = Exclude<GuideStepId, "review">;
type StageCheckStatus = "pending" | "complete" | "none" | "review";

type SiteChecklist = {
  internetAvailable: SurveyChoice;
  internetMode: InternetMode;
  networkType: NetworkType;
  powerOutlet: SurveyChoice;
  dedicatedCircuit: SurveyChoice;
  blackoutCurtain: SurveyChoice;
  floorWork: SurveyChoice;
  elevator: SurveyChoice;
  ceilingLightRemoval: SurveyChoice;
  airconConflict: SurveyChoice;
};

type LayoutItem = {
  id: string;
  kind: LayoutItemKind;
  presetId?: LayoutSymbol;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90;
  wall?: WallSide;
  offset?: number;
  openingHeight?: number;
  sillHeight?: number;
  handing?: OpeningHand;
  swing?: OpeningSwing;
  mountingHeight?: number;
  beamBottomHeight?: number;
  beamSpacing?: number;
};

type LayoutDraft = {
  roomName: string;
  roomWidth: number;
  roomHeight: number;
  roomCeilingHeight?: number;
  roomWallThickness?: number;
  items: LayoutItem[];
  stageChecks?: Partial<Record<StageCheckKey, StageCheckStatus>>;
  siteChecklist?: SiteChecklist;
  fieldNotes?: string;
};

type ItemPreset = {
  id: LayoutSymbol;
  kind: LayoutItemKind;
  group: PresetGroup;
  label: string;
  defaultName: string;
  code: string;
  width: number;
  height: number;
  catalogName?: string;
  catalogSpecification?: string;
  catalogNumber?: string;
  guide?: string;
};

const STORAGE_KEY = "whizzup:site-layout-draft:v1";

const defaultSiteChecklist: SiteChecklist = {
  internetAvailable: "", internetMode: "", networkType: "", powerOutlet: "", dedicatedCircuit: "",
  blackoutCurtain: "", floorWork: "", elevator: "", ceilingLightRemoval: "", airconConflict: "",
};

const guideSteps: { id: GuideStepId; label: string; title: string; description: string; groups: PresetGroup[] }[] = [
  { id: "room", label: "공간", title: "공간 크기 입력", description: "실 이름과 가로·세로·천장 높이를 입력하면 방 외곽선이 자동으로 만들어집니다.", groups: [] },
  { id: "door", label: "출입문", title: "출입문 형태와 치수", description: "현장과 비슷한 문을 고르고 설치 벽을 터치한 뒤 넓이·높이·열림 방향을 확인하세요.", groups: ["문"] },
  { id: "window", label: "창호", title: "창호 형태와 분할", description: "고정창·좌우 슬라이딩창·연창 중 생김새가 비슷한 블록을 선택해 배치하세요.", groups: ["창호"] },
  { id: "structure", label: "기둥·보", title: "기둥과 보 실측", description: "기둥은 두 기준벽에서 중심거리로, 보는 길이·폭·하단 높이와 보 사이 간격으로 기록하세요.", groups: ["기둥·보"] },
  { id: "facility", label: "에어컨", title: "에어컨과 고정 시설", description: "벽걸이는 설치 벽과 모서리 기준거리, 천장형은 두 벽에서 중심거리와 설치 높이를 기록합니다.", groups: ["현장 설비"] },
  { id: "checklist", label: "현장조건", title: "인터넷·전기·공사 조건", description: "CAD팀과 시공팀이 다시 확인하지 않도록 현장 조건을 단계별로 체크하세요.", groups: [] },
  { id: "review", label: "최종 확인", title: "CAD팀 전달 전 검수", description: "단계별 확인 상태와 누락 항목을 점검하고 A3 출력 도면을 확인하세요.", groups: [] },
];

const itemPresets: ItemPreset[] = [
  { id: "door-single", kind: "door", group: "문", label: "단문형", defaultName: "단문형 출입문", code: "A-DR01", width: 0.9, height: 0.18, guide: "힌지와 90° 개폐 반경을 함께 표시합니다." },
  { id: "door-double", kind: "door", group: "문", label: "양문형", defaultName: "양문형 출입문", code: "A-DR02", width: 1.8, height: 0.18, guide: "두 문짝의 개폐 반경과 중심선을 표시합니다." },
  { id: "door-unequal", kind: "door", group: "문", label: "비대칭 양문", defaultName: "비대칭 양문형 출입문", code: "A-DR03", width: 1.5, height: 0.18, guide: "주문과 보조문 폭이 다른 양문형 출입문입니다." },
  { id: "door-sliding", kind: "door", group: "문", label: "좌우 미닫이", defaultName: "좌우 미닫이문", code: "A-DR04", width: 1.8, height: 0.14, guide: "문짝 겹침과 이동 방향을 평면 심벌로 표시합니다." },
  { id: "door-folding", kind: "door", group: "문", label: "폴딩도어", defaultName: "폴딩도어", code: "A-DR05", width: 2.4, height: 0.18, guide: "접이식 문짝 개수와 전체 개구부 폭을 확인합니다." },
  { id: "window-fixed", kind: "window", group: "창호", label: "고정창", defaultName: "고정창", code: "A-W01", width: 1.2, height: 0.14 },
  { id: "window-sliding-2", kind: "window", group: "창호", label: "슬라이딩 2짝", defaultName: "좌우 슬라이딩창 2짝", code: "A-W02", width: 1.8, height: 0.14 },
  { id: "window-3", kind: "window", group: "창호", label: "슬라이딩 3짝", defaultName: "좌우 슬라이딩창 3짝", code: "A-W03", width: 2.1, height: 0.14 },
  { id: "window-4", kind: "window", group: "창호", label: "슬라이딩 4짝", defaultName: "좌우 슬라이딩창 4짝", code: "A-W04", width: 2.7, height: 0.14 },
  { id: "window-6", kind: "window", group: "창호", label: "6분할 연창", defaultName: "6분할 연창", code: "A-W06", width: 4.1, height: 0.14 },
  { id: "window-project", kind: "window", group: "창호", label: "프로젝트창", defaultName: "프로젝트창", code: "A-W07", width: 1.2, height: 0.14 },
  { id: "screen", kind: "equipment", group: "에어패스 시스템", label: "스크린", defaultName: "XR 전면 스크린", code: "E-SCR", width: 4.1, height: 0.32, catalogName: "가상스포츠시스템 (터치스크린)", catalogSpecification: "에어패스 AP-EDUVR-01 / AP-EDUVR-03 구성", guide: "DWG 기준 화면 높이는 천장 높이에서 센서·여유 약 400mm를 제외해 검토합니다." },
  { id: "equipment", kind: "equipment", group: "에어패스 시스템", label: "프로젝터", defaultName: "빔프로젝터", code: "E-PJ", width: 0.55, height: 0.42, catalogName: "빔프로젝터", catalogSpecification: "Epson 또는 단테크 초단초점 모델", guide: "단테크 초단초점 참고값은 스크린 폭 × 0.42의 투사거리입니다." },
  { id: "kiosk", kind: "equipment", group: "에어패스 시스템", label: "키오스크", defaultName: "운영 키오스크", code: "E-KSK", width: 0.72, height: 0.58, catalogName: "가상스포츠시스템 (터치스크린)", catalogSpecification: "AP-EDUVR 시스템 구성 장비", guide: "DWG 시공 메모 기준 키오스크와 각 장비 배선 거리는 15m 이내를 권장합니다." },
  { id: "vision-sensor", kind: "equipment", group: "에어패스 시스템", label: "3X 비전", defaultName: "3X비전센서", code: "E-3XV", width: 0.52, height: 0.3, catalogName: "3X비전센서", catalogSpecification: "3X VISION 시스템 센서 / XR스크린 스포츠용", catalogNumber: "S2B 202507143379297", guide: "DWG 기준 전원 1구와 CAT6 네트워크 4회선을 확인합니다." },
  { id: "lidar-sensor", kind: "equipment", group: "에어패스 시스템", label: "라이다", defaultName: "라이다센서", code: "E-LDR", width: 0.34, height: 0.34, catalogName: "라이더센서", catalogSpecification: "라이더센서(케이스 포함)", guide: "DWG 기준 전원 1구와 CAT6 네트워크 1회선을 확인합니다." },
  { id: "shooting-sensor", kind: "equipment", group: "에어패스 시스템", label: "사격 센서", defaultName: "가상사격 센서", code: "E-SHT", width: 0.45, height: 0.3, catalogName: "에어패스 가상사격시스템", catalogSpecification: "카메라센서·레이저센서·전용 총 구성", guide: "브로셔의 비전 카메라·레이저 센서 구성을 반영했으며 전원과 CAT6 1회선을 확인합니다." },
  { id: "motion-3d", kind: "equipment", group: "에어패스 시스템", label: "3D 모션", defaultName: "3D 모션 시스템", code: "E-3DM", width: 0.85, height: 0.52, catalogName: "멀티미디어학습장치 3D motion sports", catalogSpecification: "에어패스 AIFIT-3D MOTION", catalogNumber: "G2B 25816875" },
  { id: "ifit-premium", kind: "equipment", group: "에어패스 시스템", label: "아이핏 보드", defaultName: "아이핏 전자칠판형", code: "E-IFP", width: 1.75, height: 0.72, catalogName: "아이핏 전자칠판형 (AiFit)", catalogSpecification: "에어패스 AIFIT-PREMIUM", catalogNumber: "G2B 25815808" },
  { id: "ifit-slim", kind: "equipment", group: "에어패스 시스템", label: "아이핏 슬림", defaultName: "아이핏 슬림형", code: "E-IFS", width: 1.1, height: 0.72, catalogName: "아이핏 슬림형 (AiFit)", catalogSpecification: "에어패스 AIFIT-FLOOR", catalogNumber: "G2B 25814005" },
  { id: "touch-table", kind: "equipment", group: "에어패스 시스템", label: "터치테이블", defaultName: "터치테이블", code: "E-TBL", width: 1.2, height: 0.78, catalogName: "터치테이블", catalogSpecification: "위즈업 / 에어패스 APM-003", catalogNumber: "G2B 24533259" },
  { id: "action-floor", kind: "equipment", group: "에어패스 시스템", label: "AR 액션", defaultName: "AR 액션플로어", code: "E-ARF", width: 3.6, height: 2.5, catalogName: "멀티미디어학습장치 (바닥형인터랙티브)", catalogSpecification: "바닥형 인터랙티브 시스템", guide: "투사 영역과 이동 동선을 겹치지 않게 확보합니다." },
  { id: "table", kind: "table", group: "공통 장비·가구", label: "모듈 책상", defaultName: "모듈형 책상", code: "F-T01", width: 1.4, height: 1.4 },
  { id: "chair", kind: "table", group: "공통 장비·가구", label: "의자", defaultName: "이동형 의자", code: "F-C01", width: 0.55, height: 0.55 },
  { id: "power-lan", kind: "equipment", group: "공통 장비·가구", label: "전원·LAN", defaultName: "전원·LAN 포인트", code: "E-IO", width: 0.28, height: 0.28, guide: "장비별 전원·HDMI·CAT6 포인트를 현장 실측 후 확정합니다." },
  { id: "pillar", kind: "pillar", group: "기둥·보", label: "사각 기둥", defaultName: "콘크리트 기둥", code: "A-C01", width: 0.45, height: 0.45 },
  { id: "pillar-round", kind: "pillar", group: "기둥·보", label: "원형 기둥", defaultName: "원형 콘크리트 기둥", code: "A-C02", width: 0.45, height: 0.45 },
  { id: "beam", kind: "beam", group: "기둥·보", label: "천장 보", defaultName: "콘크리트 보", code: "A-B01", width: 2.4, height: 0.35, guide: "평면에서는 천장 위 구조물임을 점선으로 표시합니다. 보 하단 높이와 보 사이 유효거리를 확인하세요." },
  { id: "aircon-wall", kind: "fixture", group: "현장 설비", label: "벽걸이 에어컨", defaultName: "벽걸이 에어컨", code: "M-AC01", width: 1.05, height: 0.32 },
  { id: "aircon-ceiling", kind: "fixture", group: "현장 설비", label: "천장형 에어컨", defaultName: "천장형 에어컨", code: "M-AC02", width: 0.84, height: 0.84 },
  { id: "note", kind: "note", group: "기타", label: "현장 메모", defaultName: "현장 확인 사항", code: "A-N01", width: 1.8, height: 0.65 },
];

const defaultDraft: LayoutDraft = { roomName: "스마트 체험교실", roomWidth: 13.724, roomHeight: 8.146, roomCeilingHeight: 2.551, roomWallThickness: 0.15, items: [], stageChecks: {}, siteChecklist: defaultSiteChecklist, fieldNotes: "" };
const basicGroups: PresetGroup[] = ["문", "창호", "기둥·보", "현장 설비"];

function positiveDimension(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0.1, Math.round(value * 1000) / 1000));
}
function clampPercent(value: number) { return Math.min(96, Math.max(0, value)); }
function snapGrid(value: number) { return clampPercent(Math.round(value * 5) / 5); }
function structureFootprint(item: LayoutItem) {
  return item.rotation === 90 ? { width: item.height, height: item.width } : { width: item.width, height: item.height };
}
function placePillarOnWall(item: LayoutItem, wall: WallSide, x: number, y: number, roomWidth: number, roomHeight: number) {
  const size = structureFootprint(item);
  const widthPercent = Math.min(100, (size.width / roomWidth) * 100);
  const heightPercent = Math.min(100, (size.height / roomHeight) * 100);
  const clampedX = Math.min(Math.max(0, 100 - widthPercent), Math.max(0, snapGrid(x)));
  const clampedY = Math.min(Math.max(0, 100 - heightPercent), Math.max(0, snapGrid(y)));
  if (wall === "top") return { wall, x: clampedX, y: 0 };
  if (wall === "bottom") return { wall, x: clampedX, y: Math.max(0, 100 - heightPercent) };
  if (wall === "left") return { wall, x: 0, y: clampedY };
  return { wall, x: Math.max(0, 100 - widthPercent), y: clampedY };
}
function snapPillarPlacement(item: LayoutItem, x: number, y: number, roomWidth: number, roomHeight: number) {
  const freePlacement = { wall: undefined, x: snapGrid(x), y: snapGrid(y), rotation: item.rotation };
  if (item.kind !== "pillar") return freePlacement;
  const size = structureFootprint(item);
  const widthPercent = (size.width / roomWidth) * 100;
  const heightPercent = (size.height / roomHeight) * 100;
  const edges = [
    { distance: Math.abs(y), wall: "top" as const },
    { distance: Math.abs(100 - (y + heightPercent)), wall: "bottom" as const },
    { distance: Math.abs(x), wall: "left" as const },
    { distance: Math.abs(100 - (x + widthPercent)), wall: "right" as const },
  ];
  const nearest = edges.sort((a, b) => a.distance - b.distance)[0];
  return nearest.distance <= 6
    ? { ...placePillarOnWall(item, nearest.wall, x, y, roomWidth, roomHeight), rotation: item.rotation }
    : freePlacement;
}
function validStoredDraft(value: unknown): value is LayoutDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<LayoutDraft>;
  return typeof draft.roomName === "string" && Number.isFinite(draft.roomWidth) && Number.isFinite(draft.roomHeight) && Array.isArray(draft.items);
}
function validStoredItem(value: unknown): value is LayoutItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LayoutItem>;
  return typeof item.id === "string" && itemPresets.some((preset) => preset.kind === item.kind) && typeof item.name === "string"
    && Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.width) && Number.isFinite(item.height)
    && (item.rotation === 0 || item.rotation === 90);
}
function presetForItem(item: LayoutItem) {
  return itemPresets.find((preset) => preset.id === item.presetId) ?? itemPresets.find((preset) => preset.kind === item.kind) ?? itemPresets[0];
}
function itemLayer(item: LayoutItem): LayoutLayer {
  if (item.kind === "door" || item.kind === "window") return "opening";
  if (item.kind === "pillar" || item.kind === "beam") return "structure";
  if (item.kind === "fixture") return "fixture";
  if (item.kind === "note") return "note";
  return "equipment";
}
function formatMillimeters(meters: number) { return new Intl.NumberFormat("ko-KR").format(Math.round(meters * 1000)); }
function wallLabel(wall?: WallSide) { return ({ top: "상단 A벽", right: "우측 B벽", bottom: "하단 C벽", left: "좌측 D벽" } as const)[wall ?? "top"]; }
function validStageCheck(value: unknown): value is StageCheckStatus { return value === "pending" || value === "complete" || value === "none" || value === "review"; }
function validSurveyChoice(value: unknown): value is SurveyChoice { return value === "" || value === "yes" || value === "no" || value === "review"; }
function normalizeChecklist(value: unknown): SiteChecklist {
  if (!value || typeof value !== "object") return { ...defaultSiteChecklist };
  const checklist = value as Partial<SiteChecklist>;
  return {
    internetAvailable: validSurveyChoice(checklist.internetAvailable) ? checklist.internetAvailable : "",
    internetMode: ["", "wired", "wireless", "both", "none"].includes(checklist.internetMode ?? "") ? checklist.internetMode ?? "" : "",
    networkType: ["", "education", "private", "both", "unknown"].includes(checklist.networkType ?? "") ? checklist.networkType ?? "" : "",
    powerOutlet: validSurveyChoice(checklist.powerOutlet) ? checklist.powerOutlet : "",
    dedicatedCircuit: validSurveyChoice(checklist.dedicatedCircuit) ? checklist.dedicatedCircuit : "",
    blackoutCurtain: validSurveyChoice(checklist.blackoutCurtain) ? checklist.blackoutCurtain : "",
    floorWork: validSurveyChoice(checklist.floorWork) ? checklist.floorWork : "",
    elevator: validSurveyChoice(checklist.elevator) ? checklist.elevator : "",
    ceilingLightRemoval: validSurveyChoice(checklist.ceilingLightRemoval) ? checklist.ceilingLightRemoval : "",
    airconConflict: validSurveyChoice(checklist.airconConflict) ? checklist.airconConflict : "",
  } as SiteChecklist;
}
function surveyChoiceLabel(value: SurveyChoice) { return ({ "": "미확인", yes: "있음", no: "없음", review: "재확인" } as const)[value]; }
function internetModeLabel(value: InternetMode) { return ({ "": "미확인", wired: "유선", wireless: "무선", both: "유선·무선", none: "사용 불가" } as const)[value]; }
function networkTypeLabel(value: NetworkType) { return ({ "": "미확인", education: "교육망", private: "사설망", both: "교육망·사설망", unknown: "현장 확인" } as const)[value]; }

function FriendlyNumberInput({ value, min, max, decimals = 3, label, onCommit }: { value: number; min: number; max: number; decimals?: number; label: string; onCommit: (value: number) => void }) {
  const formattedValue = String(Number(value.toFixed(decimals)));
  const safeMax = Math.max(min, max);
  const [textValue, setTextValue] = useState(formattedValue);
  const [editing, setEditing] = useState(false);
  function commit(raw: string, clamp = false) {
    const parsed = Number(raw.replace(",", "."));
    if (!Number.isFinite(parsed)) return false;
    const next = clamp ? Math.min(safeMax, Math.max(min, parsed)) : parsed;
    if (next < min || next > safeMax) return false;
    const rounded = Number(next.toFixed(decimals));
    onCommit(rounded);
    if (clamp) setTextValue(String(rounded));
    return true;
  }
  function handleBlur(event: ReactFocusEvent<HTMLInputElement>) {
    setEditing(false);
    if (!event.currentTarget.value.trim()) { setTextValue(formattedValue); return; }
    if (!commit(event.currentTarget.value, true)) setTextValue(formattedValue);
  }
  return <input aria-label={label} inputMode={decimals ? "decimal" : "numeric"} type="text" value={editing ? textValue : formattedValue}
    onFocus={(event) => { setTextValue(formattedValue); setEditing(true); event.currentTarget.select(); }}
    onClick={(event) => event.currentTarget.select()}
    onChange={(event) => { const next = event.target.value.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"); setTextValue(next); if (next && next !== ".") commit(next); }}
    onBlur={handleBlur} />;
}

function MillimeterInput({ valueMeters, minMm, maxMm, label, onCommit }: { valueMeters: number; minMm: number; maxMm: number; label: string; onCommit: (meters: number) => void }) {
  return <FriendlyNumberInput value={Math.round(valueMeters * 1000)} min={minMm} max={maxMm} decimals={0} label={label} onCommit={(value) => onCommit(value / 1000)} />;
}

function openingPlanDepthMeters(item: LayoutItem, wallThickness: number) {
  if (item.kind === "window") return Math.max(0.2, wallThickness * 1.45);
  if (item.presetId === "door-sliding") return Math.max(0.26, wallThickness * 1.8);
  if (item.presetId === "door-folding") return Math.min(0.72, Math.max(0.34, item.width * 0.16));
  if (item.presetId === "door-double") return Math.max(0.45, item.width / 2);
  if (item.presetId === "door-unequal") return Math.max(0.5, item.width * 0.64);
  return Math.max(0.55, item.width);
}

function openingCadTransform(wall?: WallSide, swing: OpeningSwing = "inside") {
  if (!wall) return undefined;
  if (wall === "top") return swing === "outside" ? undefined : "matrix(1 0 0 -1 0 70)";
  if (wall === "bottom") return swing === "outside" ? "matrix(1 0 0 -1 0 70)" : undefined;
  if (wall === "left") return swing === "outside" ? "matrix(0 -1 1 0 0 100)" : "matrix(0 1 -1 0 70 0)";
  return swing === "outside" ? "matrix(0 1 -1 0 70 0)" : "matrix(0 -1 1 0 0 100)";
}

function CadSymbol({ symbol, compact = false, wall, handing = "left", swing = "inside" }: { symbol: LayoutSymbol; compact?: boolean; wall?: WallSide; handing?: OpeningHand; swing?: OpeningSwing }) {
  const panels = symbol.startsWith("window-") ? Number(symbol.split("-")[1]) || 3 : 0;
  const shared = { vectorEffect: "non-scaling-stroke" as const };
  const isOpening = symbol.startsWith("door-") || symbol.startsWith("window-");
  const vertical = isOpening && (wall === "left" || wall === "right");
  const squareCoordinateSymbol = symbol === "pillar" || symbol === "pillar-round" || symbol === "aircon-ceiling";
  const centerY = squareCoordinateSymbol ? 50 : 35;
  return (
    <svg className="site-layout-cad-symbol" viewBox={vertical ? "0 0 70 100" : squareCoordinateSymbol ? "0 0 100 100" : "0 0 100 70"} preserveAspectRatio="none" aria-hidden="true">
      <g transform={isOpening ? openingCadTransform(wall, swing) : undefined}><g transform={isOpening && handing === "right" ? "translate(100 0) scale(-1 1)" : undefined}>
      {symbol === "door-single" && <><path {...shared} d="M2 66H10 M74 66H98 M10 66V3 M74 66A64 64 0 0 0 10 3" /><circle cx="10" cy="66" r="2.6" /><path className="cad-jamb" {...shared} d="M10 61V70 M74 61V70" /></>}
      {symbol === "door-double" && <><path {...shared} d="M2 66H10 M90 66H98 M10 66V26 M90 66V26 M50 66A40 40 0 0 0 10 26 M50 66A40 40 0 0 1 90 26" /><circle cx="10" cy="66" r="2.6" /><circle cx="90" cy="66" r="2.6" /><path className="cad-jamb" {...shared} d="M10 61V70 M90 61V70" /></>}
      {symbol === "door-unequal" && <><path {...shared} d="M2 66H10 M90 66H98 M10 66V22 M90 66V38 M62 66A52 52 0 0 0 10 14 M62 66A28 28 0 0 1 90 38" /><circle cx="10" cy="66" r="2.6" /><circle cx="90" cy="66" r="2.6" /><path className="cad-jamb" {...shared} d="M10 61V70 M90 61V70" /></>}
      {symbol === "door-sliding" && <><path {...shared} d="M2 60H10 M90 60H98 M2 67H10 M90 67H98 M10 50H56V63H10Z M44 43H90V56H44Z M18 34H82 M75 28L83 34L75 40" /><path className="cad-jamb" {...shared} d="M10 55V70 M90 55V70" /></>}
      {symbol === "door-folding" && <><path {...shared} d="M2 66H10 M90 66H98 M10 66L24 43L38 66L52 43L66 66L80 43L90 66" /><circle cx="10" cy="66" r="2.5" /><circle cx="90" cy="66" r="2.5" /><path className="cad-jamb" {...shared} d="M10 61V70 M90 61V70" /></>}
      {symbol === "window-fixed" && <><path {...shared} d="M2 28H10 M90 28H98 M2 43H10 M90 43H98 M10 25H90V46H10Z M10 31H90 M10 40H90 M18 28L82 43 M82 28L18 43" /><path className="cad-jamb" {...shared} d="M10 22V49 M90 22V49" /></>}
      {symbol === "window-sliding-2" && <><path {...shared} d="M2 28H10 M90 28H98 M2 43H10 M90 43H98 M10 25H90V46H10Z M10 31H90 M10 40H90 M50 25V46 M27 20H52 M47 16L53 20L47 24 M73 51H48 M53 47L47 51L53 55" /><path className="cad-jamb" {...shared} d="M10 22V49 M90 22V49" /></>}
      {panels > 0 && <><path {...shared} d="M2 28H10 M90 28H98 M2 43H10 M90 43H98 M10 25H90V46H10Z M10 31H90 M10 40H90" />{Array.from({ length: panels - 1 }, (_, index) => <path key={index} {...shared} d={`M${((index + 1) * 80) / panels + 10} 25V46`} />)}<path className="cad-jamb" {...shared} d="M10 22V49 M90 22V49" /></>}
      {symbol === "window-project" && <><path {...shared} d="M2 28H10 M90 28H98 M2 43H10 M90 43H98 M10 25H90V46H10Z M10 31H90 M10 40H90 M18 44L50 16L82 44 M50 16V7 M44 13L50 7L56 13" /><path className="cad-jamb" {...shared} d="M10 22V49 M90 22V49" /></>}
      {symbol === "screen" && <><path {...shared} d="M4 15H96V50H4Z M9 20H91V45H9Z M50 50V61 M36 61H64" /><path className="cad-dash" {...shared} d="M50 12V54" /></>}
      {symbol === "equipment" && <><path {...shared} d="M20 19H77V53H20Z M30 53V61H67V53 M77 27L93 32V40L77 45" /><circle cx="85" cy="36" r="4" /></>}
      {symbol === "kiosk" && <><path {...shared} d="M27 8H73V45H27Z M33 14H67V37H33Z M42 45V58 M58 45V58 M30 58H70V64H30Z" /><circle cx="50" cy="41" r="2" /></>}
      {symbol === "vision-sensor" && <><path {...shared} d="M22 20H78V49H22Z M15 49H85 M30 49V60 M70 49V60" />{[36, 50, 64].map((x) => <circle key={x} cx={x} cy="34" r="7" />)}<path className="cad-dash" {...shared} d="M36 34L5 7 M64 34L95 7" /></>}
      {symbol === "lidar-sensor" && <><circle cx="50" cy="35" r="19" /><circle cx="50" cy="35" r="6" /><path {...shared} d="M50 5V65 M20 35H80 M29 14L71 56 M71 14L29 56" /><circle className="cad-dash" cx="50" cy="35" r="29" /></>}
      {symbol === "shooting-sensor" && <><path {...shared} d="M22 19H78V50H22Z M32 50V60 M68 50V60" /><circle cx="50" cy="34" r="10" /><path {...shared} d="M50 24V44 M40 34H60" /><path className="cad-dash" {...shared} d="M50 34L5 8 M50 34L95 8" /></>}
      {symbol === "motion-3d" && <><path {...shared} d="M15 22H85V51H15Z M23 30H38V43H23Z M62 30H77V43H62Z M44 29H56V44H44Z" /><path className="cad-dash" {...shared} d="M27 18L10 7 M73 18L90 7 M50 18V4" /></>}
      {symbol === "ifit-premium" && <><path {...shared} d="M7 9H93V50H7Z M13 15H87V44H13Z M23 50V61 M77 50V61 M15 61H85" /><path className="cad-dash" {...shared} d="M50 9V50" /></>}
      {symbol === "ifit-slim" && <><path {...shared} d="M22 9H78V46H22Z M28 15H72V40H28Z M43 46V58 M57 46V58 M30 58H70V64H30Z" /><path {...shared} d="M34 64H66" /></>}
      {symbol === "touch-table" && <><rect x="10" y="12" width="80" height="43" rx="4" /><rect x="17" y="19" width="66" height="29" rx="2" /><path {...shared} d="M24 55V65 M76 55V65 M50 19V48" /></>}
      {symbol === "action-floor" && <><rect x="7" y="8" width="86" height="54" /><path className="cad-dash" {...shared} d="M7 8L93 62 M93 8L7 62 M50 8V62 M7 35H93" /></>}
      {symbol === "power-lan" && <><circle cx="50" cy="35" r="25" /><path {...shared} d="M37 18V35 M63 18V35 M35 35H65 M50 35V57" /><text x="50" y="66" textAnchor="middle">LAN</text></>}
      {symbol === "table" && <><circle cx="50" cy="35" r="21" /><path {...shared} d="M50 14V56 M29 35H71 M35 20L65 50 M65 20L35 50" />{[12, 50, 88].map((x) => <circle key={`t-${x}`} cx={x} cy="35" r="7" />)}<circle cx="50" cy="7" r="6" /><circle cx="50" cy="63" r="6" /></>}
      {symbol === "chair" && <><rect x="29" y="22" width="42" height="35" rx="5" /><path {...shared} d="M29 30H18V52H29 M71 30H82V52H71 M35 57V65 M65 57V65" /></>}
      {symbol === "pillar" && <><rect x="18" y="18" width="64" height="64" /><rect x="24" y="24" width="52" height="52" /><path className="cad-center" {...shared} d="M50 8V92 M8 50H92" /></>}
      {symbol === "pillar-round" && <><circle cx="50" cy="50" r="32" /><circle cx="50" cy="50" r="25" /><path className="cad-center" {...shared} d="M50 8V92 M8 50H92" /></>}
      {symbol === "beam" && <><rect className="cad-dash" x="5" y="20" width="90" height="30" /><path className="cad-center" {...shared} d="M3 35H97" />{!compact && <text x="50" y="15" textAnchor="middle">BEAM</text>}</>}
      {symbol === "aircon-wall" && <><rect x="8" y="18" width="84" height="34" rx="5" /><path {...shared} d="M15 31H85 M20 39H80 M30 47H70" /><circle cx="79" cy="25" r="2" /></>}
      {symbol === "aircon-ceiling" && <><rect x="18" y="18" width="64" height="64" /><rect x="27" y="27" width="46" height="46" /><path {...shared} d="M27 27L73 73 M73 27L27 73 M50 27V73 M27 50H73" /><circle cx="50" cy="50" r="7" /></>}
      {symbol === "note" && <><path {...shared} d="M7 12H78L93 27V61H7Z M78 12V27H93" /><path {...shared} d="M17 30H72 M17 40H82 M17 50H62" /></>}
      {!compact && !isOpening && <path className="cad-center" {...shared} d={`M1 ${centerY}H99`} />}
      </g></g>
    </svg>
  );
}

export default function SiteLayoutPlannerPage() {
  const [draft, setDraft] = useState<LayoutDraft>(defaultDraft);
  const [selectedId, setSelectedId] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<LayoutView>("model");
  const [canvasFocus, setCanvasFocus] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [activeTool, setActiveTool] = useState("선택");
  const [command, setCommand] = useState("명령: 실 크기를 확인하고 표준 블록을 선택하세요.");
  const [pendingPresetId, setPendingPresetId] = useState<LayoutSymbol | null>(null);
  const [visibleLayers, setVisibleLayers] = useState<Record<LayoutLayer, boolean>>({ opening: true, structure: true, fixture: true, equipment: false, note: false });
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const parsed: unknown = stored ? JSON.parse(stored) : null;
        if (validStoredDraft(parsed)) {
          const storedChecks = parsed.stageChecks && typeof parsed.stageChecks === "object" ? parsed.stageChecks : {};
          const storedRoomWidth = positiveDimension(parsed.roomWidth, defaultDraft.roomWidth);
          const storedRoomHeight = positiveDimension(parsed.roomHeight, defaultDraft.roomHeight);
          setDraft({
            roomName: parsed.roomName.slice(0, 80) || defaultDraft.roomName,
            roomWidth: storedRoomWidth,
            roomHeight: storedRoomHeight,
            roomCeilingHeight: positiveDimension(parsed.roomCeilingHeight ?? defaultDraft.roomCeilingHeight ?? 2.7, 2.7),
            roomWallThickness: positiveDimension(parsed.roomWallThickness ?? defaultDraft.roomWallThickness ?? 0.15, 0.15),
            items: parsed.items.filter(validStoredItem).map((item) => {
              const preset = presetForItem(item);
              const normalizedWidth = positiveDimension(item.width, 1);
              const normalizedItem: LayoutItem = {
                ...item,
                presetId: preset.id,
                name: item.name.slice(0, 60),
                x: clampPercent(item.x),
                y: clampPercent(item.y),
                width: normalizedWidth,
                height: preset.id === "aircon-ceiling" ? normalizedWidth : positiveDimension(item.height, 1),
                openingHeight: item.openingHeight ? positiveDimension(item.openingHeight, item.kind === "door" ? 2.1 : 1.5) : undefined,
                sillHeight: item.sillHeight === undefined ? undefined : Math.max(0, positiveDimension(item.sillHeight, 0.9)),
                offset: item.offset === undefined ? undefined : Math.max(0, item.offset),
                wall: item.wall,
                handing: item.handing,
                swing: item.swing === "outside" ? "outside" : "inside",
                mountingHeight: item.mountingHeight === undefined ? undefined : Math.max(0, positiveDimension(item.mountingHeight, 2.1)),
                beamBottomHeight: item.beamBottomHeight === undefined ? undefined : Math.max(0, positiveDimension(item.beamBottomHeight, 2.2)),
                beamSpacing: item.beamSpacing === undefined ? undefined : Math.max(0, positiveDimension(item.beamSpacing, 1)),
              };
              if (normalizedItem.kind !== "pillar") return normalizedItem;
              const placement = normalizedItem.wall
                ? placePillarOnWall(normalizedItem, normalizedItem.wall, normalizedItem.x, normalizedItem.y, storedRoomWidth, storedRoomHeight)
                : snapPillarPlacement(normalizedItem, normalizedItem.x, normalizedItem.y, storedRoomWidth, storedRoomHeight);
              return { ...normalizedItem, ...placement };
            }),
            stageChecks: Object.fromEntries(Object.entries(storedChecks).filter((entry): entry is [string, StageCheckStatus] => validStageCheck(entry[1]))),
            siteChecklist: normalizeChecklist(parsed.siteChecklist),
            fieldNotes: typeof parsed.fieldNotes === "string" ? parsed.fieldNotes.slice(0, 1000) : "",
          });
        }
      } catch {
        // A malformed local draft should never block the workspace.
      } finally { setHydrated(true); }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    const frame = window.requestAnimationFrame(() => setSavedAt(new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())));
    return () => window.cancelAnimationFrame(frame);
  }, [draft, hydrated]);

  const selectedItem = useMemo(() => draft.items.find((item) => item.id === selectedId) ?? null, [draft.items, selectedId]);
  const selectedPreset = selectedItem ? presetForItem(selectedItem) : null;
  const pendingPreset = pendingPresetId ? itemPresets.find((preset) => preset.id === pendingPresetId) ?? null : null;
  const activeStep = guideSteps[activeStepIndex];
  const roomRatio = Math.min(1.85, Math.max(0.72, draft.roomWidth / draft.roomHeight));
  const ceilingHeight = draft.roomCeilingHeight ?? 2.7;
  const basicPresets = useMemo(() => itemPresets.filter((preset) => basicGroups.includes(preset.group)), []);
  const visibleBasicItemCount = useMemo(() => draft.items.filter((item) => itemLayer(item) !== "equipment" && itemLayer(item) !== "note").length, [draft.items]);
  const activePresets = useMemo(() => basicPresets.filter((preset) => activeStep.groups.includes(preset.group)), [activeStep.groups, basicPresets]);
  const checklist = draft.siteChecklist ?? defaultSiteChecklist;
  const checklistAnsweredCount = Object.values(checklist).filter(Boolean).length;
  const stageCounts = useMemo(() => ({
    room: draft.roomWidth > 0 && draft.roomHeight > 0 ? 1 : 0,
    door: draft.items.filter((item) => item.kind === "door").length,
    window: draft.items.filter((item) => item.kind === "window").length,
    structure: draft.items.filter((item) => item.kind === "pillar" || item.kind === "beam").length,
    facility: draft.items.filter((item) => item.kind === "fixture").length,
    checklist: checklistAnsweredCount,
  }), [checklistAnsweredCount, draft.items, draft.roomHeight, draft.roomWidth]);

  function updateDraft(patch: Partial<LayoutDraft>) { setDraft((current) => ({ ...current, ...patch })); }
  function updateSelected(patch: Partial<LayoutItem>) {
    if (!selectedId) return;
    setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === selectedId ? { ...item, ...patch } : item) }));
  }
  function updateChecklist<K extends keyof SiteChecklist>(key: K, value: SiteChecklist[K]) {
    setDraft((current) => ({ ...current, siteChecklist: { ...(current.siteChecklist ?? defaultSiteChecklist), [key]: value } }));
  }
  function generateRoom() {
    setView("model");
    setDraft((current) => ({ ...current, stageChecks: { ...current.stageChecks, room: "complete" } }));
    setCommand(`명령: RC 벽체 t=${formatMillimeters(draft.roomWallThickness ?? 0.15)} · ${formatMillimeters(draft.roomWidth)} × ${formatMillimeters(draft.roomHeight)}mm 교실을 생성했습니다.`);
  }
  function makeItem(presetId: LayoutSymbol, x: number, y: number, rotation: 0 | 90 = 0, suffix = ""): LayoutItem {
    const preset = itemPresets.find((item) => item.id === presetId) ?? itemPresets[0];
    return {
      id: crypto.randomUUID(), kind: preset.kind, presetId: preset.id, name: `${preset.defaultName}${suffix}`, x, y, width: preset.width, height: preset.height, rotation,
      openingHeight: preset.kind === "door" ? 2.1 : preset.kind === "window" ? 1.5 : undefined,
      sillHeight: preset.kind === "window" ? 0.9 : undefined,
      handing: preset.kind === "door" ? "left" : undefined,
      swing: preset.kind === "door" ? "inside" : undefined,
      mountingHeight: preset.id === "aircon-wall" ? 2.1 : preset.id === "aircon-ceiling" ? ceilingHeight : undefined,
      beamBottomHeight: preset.kind === "beam" ? 2.2 : undefined,
      beamSpacing: preset.kind === "beam" ? 1 : undefined,
    };
  }
  function addItem(presetId: LayoutSymbol, targetX?: number, targetY?: number) {
    const preset = itemPresets.find((item) => item.id === presetId) ?? itemPresets[0];
    const samePresetCount = draft.items.filter((item) => presetForItem(item).id === preset.id).length;
    const isWallBound = preset.kind === "door" || preset.kind === "window" || preset.id === "aircon-wall";
    const wallBoundCount = draft.items.filter(isWallMounted).length;
    const startX = targetX ?? (isWallBound ? 8 + ((wallBoundCount * 16) % 76) : 18 + ((draft.items.length * 9) % 42));
    const startY = targetY ?? (isWallBound ? 0 : 22 + ((draft.items.length * 11) % 42));
    const rawItem = makeItem(presetId, startX, startY, 0, samePresetCount ? ` ${samePresetCount + 1}` : "");
    const item = { ...rawItem, ...snapPlacement(rawItem, startX, startY) };
    setDraft((current) => ({ ...current, items: [...current.items, item] }));
    setSelectedId(item.id); setPendingPresetId(null); setView("model");
    setCommand(`명령: ${preset.label} ${preset.code} 배치 완료 · 선택한 블록은 손가락으로 다시 이동할 수 있습니다.`);
  }
  function setStageStatus(key: StageCheckKey, status: StageCheckStatus) {
    setDraft((current) => ({ ...current, stageChecks: { ...current.stageChecks, [key]: status } }));
  }
  function goToStep(index: number) {
    setActiveStepIndex(Math.min(guideSteps.length - 1, Math.max(0, index)));
    setPendingPresetId(null); setSelectedId(""); setActiveTool("선택"); setView("model");
  }
  function goNextStep() {
    if (activeStep.id !== "review") {
      const key = activeStep.id as StageCheckKey;
      const currentStatus = draft.stageChecks?.[key] ?? "pending";
      if (currentStatus === "pending") setStageStatus(key, stageCounts[key] > 0 ? "complete" : "review");
    }
    goToStep(activeStepIndex + 1);
  }
  function choosePreset(presetId: LayoutSymbol) {
    const preset = itemPresets.find((item) => item.id === presetId) ?? itemPresets[0];
    const touchLayout = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
    if (!touchLayout) { addItem(presetId); return; }
    setPendingPresetId(presetId); setSelectedId(""); setView("model"); setActiveTool("배치");
    setCommand(`명령: ${preset.label} 선택됨 · 도면에서 놓을 위치를 터치하세요.`);
    window.requestAnimationFrame(() => boardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }
  function handleBoardPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (!pendingPresetId) { setSelectedId(""); return; }
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    event.preventDefault();
    addItem(pendingPresetId, ((event.clientX - bounds.left) / bounds.width) * 100, ((event.clientY - bounds.top) / bounds.height) * 100);
  }
  function handlePresetDragStart(event: ReactDragEvent<HTMLButtonElement>, presetId: LayoutSymbol) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-whizzup-floor-block", presetId);
    setPendingPresetId(null); setView("model"); setActiveTool("배치");
    setCommand("명령: 블록을 도면의 원하는 위치에 놓으세요. 문·창호는 가장 가까운 벽에 자동 부착됩니다.");
  }
  function handleBoardDrop(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    const presetId = event.dataTransfer.getData("application/x-whizzup-floor-block") as LayoutSymbol;
    if (!itemPresets.some((preset) => preset.id === presetId)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    addItem(presetId, ((event.clientX - bounds.left) / bounds.width) * 100, ((event.clientY - bounds.top) / bounds.height) * 100);
  }
  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, item: LayoutItem) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: item.id, pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startX: item.x, startY: item.y };
    setSelectedId(item.id); setActiveTool("이동");
  }
  function isWallMounted(item: LayoutItem) { return item.kind === "door" || item.kind === "window" || item.presetId === "aircon-wall"; }
  function placeWallMountedItem(item: LayoutItem, wall: WallSide, rawOffset: number) {
    const wallLength = wall === "top" || wall === "bottom" ? draft.roomWidth : draft.roomHeight;
    const requested = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
    const centerBased = item.presetId === "aircon-wall";
    const offset = centerBased
      ? Math.min(Math.max(item.width / 2, requested), Math.max(item.width / 2, wallLength - item.width / 2))
      : Math.min(Math.max(0, wallLength - item.width), requested);
    const roundedOffset = Math.round(offset * 1000) / 1000;
    const start = centerBased ? roundedOffset - item.width / 2 : roundedOffset;
    const percent = snapGrid((start / wallLength) * 100);
    return wall === "top" ? { wall, offset: roundedOffset, x: percent, y: 0, rotation: 0 as const }
      : wall === "bottom" ? { wall, offset: roundedOffset, x: percent, y: 92, rotation: 0 as const }
        : wall === "left" ? { wall, offset: roundedOffset, x: 0, y: percent, rotation: 90 as const }
          : { wall, offset: roundedOffset, x: 92, y: percent, rotation: 90 as const };
  }
  function placeOpeningOnWall(item: LayoutItem, wall: WallSide, rawOffset: number) {
    return placeWallMountedItem(item, wall, rawOffset);
  }
  function snapOpening(item: LayoutItem, x: number, y: number) {
    if (!isWallMounted(item)) return { x: snapGrid(x), y: snapGrid(y), rotation: item.rotation };
    const edges = [
      { distance: Math.abs(y), wall: "top" as const, rawOffset: (x / 100) * draft.roomWidth },
      { distance: Math.abs(100 - y), wall: "bottom" as const, rawOffset: (x / 100) * draft.roomWidth },
      { distance: Math.abs(x), wall: "left" as const, rawOffset: (y / 100) * draft.roomHeight },
      { distance: Math.abs(100 - x), wall: "right" as const, rawOffset: (y / 100) * draft.roomHeight },
    ];
    const nearest = edges.sort((a, b) => a.distance - b.distance)[0];
    return placeWallMountedItem(item, nearest.wall, nearest.rawOffset);
  }
  function snapPlacement(item: LayoutItem, x: number, y: number) {
    if (isWallMounted(item)) return snapOpening(item, x, y);
    if (item.kind === "pillar") return snapPillarPlacement(item, x, y, draft.roomWidth, draft.roomHeight);
    return { x: snapGrid(x), y: snapGrid(y), rotation: item.rotation };
  }
  function updateWallMountedWall(wall: WallSide) {
    if (!selectedItem || !isWallMounted(selectedItem)) return;
    const placement = selectedItem.kind === "door" || selectedItem.kind === "window" ? placeOpeningOnWall : placeWallMountedItem;
    updateSelected(placement(selectedItem, wall, selectedItem.offset ?? (selectedItem.presetId === "aircon-wall" ? selectedItem.width / 2 : 0)));
  }
  function updateWallMountedOffset(value: number) {
    if (!selectedItem || !isWallMounted(selectedItem)) return;
    updateSelected(placeWallMountedItem(selectedItem, selectedItem.wall ?? "top", value));
  }
  function footprint(item: LayoutItem) {
    return item.rotation === 90 ? { width: item.height, height: item.width } : { width: item.width, height: item.height };
  }
  function centerDistance(item: LayoutItem, axis: "x" | "y") {
    const size = footprint(item); const roomSize = axis === "x" ? draft.roomWidth : draft.roomHeight;
    const startPercent = axis === "x" ? item.x : item.y;
    const objectSize = axis === "x" ? size.width : size.height;
    return Math.round(((startPercent / 100) * roomSize + objectSize / 2) * 1000) / 1000;
  }
  function updateCenterDistance(axis: "x" | "y", rawValue: number) {
    if (!selectedItem || isWallMounted(selectedItem)) return;
    const size = footprint(selectedItem); const roomSize = axis === "x" ? draft.roomWidth : draft.roomHeight;
    const objectSize = axis === "x" ? size.width : size.height;
    const center = Math.min(Math.max(objectSize / 2, Number.isFinite(rawValue) ? rawValue : objectSize / 2), Math.max(objectSize / 2, roomSize - objectSize / 2));
    const percent = snapGrid(((center - objectSize / 2) / roomSize) * 100);
    const nextX = axis === "x" ? percent : selectedItem.x;
    const nextY = axis === "y" ? percent : selectedItem.y;
    updateSelected(selectedItem.kind === "pillar" ? snapPillarPlacement(selectedItem, nextX, nextY, draft.roomWidth, draft.roomHeight) : axis === "x" ? { x: percent } : { y: percent });
  }
  function updateSelectedDimension(axis: "width" | "height", rawValue: number) {
    if (!selectedItem) return;
    const value = positiveDimension(rawValue, selectedItem[axis]);
    if (selectedItem.presetId === "aircon-ceiling") {
      updateSelected({ width: value, height: value });
      return;
    }
    if (axis === "width" && isWallMounted(selectedItem)) {
      const next = { ...selectedItem, width: value };
      updateSelected({ width: value, ...placeWallMountedItem(next, next.wall ?? "top", next.offset ?? (next.presetId === "aircon-wall" ? value / 2 : 0)) });
      return;
    }
    if (selectedItem.kind === "pillar" && selectedItem.wall) {
      const next = { ...selectedItem, [axis]: value };
      updateSelected({ [axis]: value, ...placePillarOnWall(next, selectedItem.wall, next.x, next.y, draft.roomWidth, draft.roomHeight) });
      return;
    }
    updateSelected({ [axis]: value });
  }
  function updateOpeningWidth(value: number) {
    if (!selectedItem || (selectedItem.kind !== "door" && selectedItem.kind !== "window")) return;
    const wall = selectedItem.wall ?? "top";
    const wallLength = wall === "top" || wall === "bottom" ? draft.roomWidth : draft.roomHeight;
    const width = Math.min(wallLength, Math.max(0.3, value));
    const next = { ...selectedItem, width };
    updateSelected({ width, ...placeOpeningOnWall(next, wall, next.offset ?? 0) });
  }
  function updateOpeningHeight(value: number) {
    if (!selectedItem || (selectedItem.kind !== "door" && selectedItem.kind !== "window")) return;
    const sill = selectedItem.kind === "window" ? selectedItem.sillHeight ?? 0.9 : 0;
    updateSelected({ openingHeight: Math.min(Math.max(0.3, value), Math.max(0.3, ceilingHeight - sill)) });
  }
  function updateOpeningOffset(value: number) {
    if (!selectedItem || (selectedItem.kind !== "door" && selectedItem.kind !== "window")) return;
    updateSelected(placeOpeningOnWall(selectedItem, selectedItem.wall ?? "top", value));
  }
  function updateWindowSill(value: number) {
    if (!selectedItem || selectedItem.kind !== "window") return;
    const openingHeight = selectedItem.openingHeight ?? 1.5;
    updateSelected({ sillHeight: Math.min(Math.max(0, value), Math.max(0, ceilingHeight - openingHeight)) });
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const active = dragRef.current; const board = boardRef.current;
    if (!active || active.pointerId !== event.pointerId || !board) return;
    const bounds = board.getBoundingClientRect(); if (!bounds.width || !bounds.height) return;
    const nextX = active.startX + ((event.clientX - active.startClientX) / bounds.width) * 100;
    const nextY = active.startY + ((event.clientY - active.startClientY) / bounds.height) * 100;
    setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === active.id ? { ...item, ...snapPlacement(item, nextX, nextY) } : item) }));
  }
  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null; setActiveTool("선택"); setCommand("명령: 객체 이동 완료 · 고정 시설은 기준거리 입력으로 정밀 보정할 수 있습니다.");
  }
  function duplicateSelected() {
    if (!selectedItem) return;
    const baseCopy = { ...selectedItem, id: crypto.randomUUID(), name: `${selectedItem.name} 복사` };
    const placement = isWallMounted(selectedItem)
      ? placeWallMountedItem(baseCopy, selectedItem.wall ?? "top", (selectedItem.offset ?? 0) + selectedItem.width + 0.2)
      : snapPlacement(baseCopy, clampPercent(selectedItem.x + 4), clampPercent(selectedItem.y + 4));
    const copy = { ...baseCopy, ...placement };
    setDraft((current) => ({ ...current, items: [...current.items, copy] })); setSelectedId(copy.id);
  }
  function removeSelected() {
    if (!selectedId) return;
    setDraft((current) => ({ ...current, items: current.items.filter((item) => item.id !== selectedId) })); setSelectedId(""); setCommand("명령: 선택 객체를 삭제했습니다.");
  }
  function resetDraft() {
    if (draft.items.length && !window.confirm("현재 배치 요소를 모두 지우고 새로 시작할까요?")) return;
    setDraft(defaultDraft); setSelectedId(""); setPendingPresetId(null); setCommand("명령: 새 배치도를 준비했습니다.");
  }
  function renderItems(className: string) {
    return draft.items.filter((item) => itemLayer(item) !== "equipment" && visibleLayers[itemLayer(item)]).map((item) => {
      const wallAdjustedItem = item.kind === "pillar" && item.wall
        ? { ...item, ...placePillarOnWall(item, item.wall, item.x, item.y, draft.roomWidth, draft.roomHeight) }
        : item;
      const preset = presetForItem(wallAdjustedItem); const isOpening = wallAdjustedItem.kind === "door" || wallAdjustedItem.kind === "window";
      const wallThickness = draft.roomWallThickness ?? 0.15;
      const verticalOpening = isOpening && (wallAdjustedItem.wall === "left" || wallAdjustedItem.wall === "right");
      const openingDepth = isOpening ? openingPlanDepthMeters(wallAdjustedItem, wallThickness) : wallAdjustedItem.height;
      const widthPercent = isOpening
        ? ((verticalOpening ? openingDepth : wallAdjustedItem.width) / draft.roomWidth) * 100
        : ((wallAdjustedItem.rotation === 90 ? wallAdjustedItem.height : wallAdjustedItem.width) / draft.roomWidth) * 100;
      const heightPercent = isOpening
        ? ((verticalOpening ? wallAdjustedItem.width : openingDepth) / draft.roomHeight) * 100
        : ((wallAdjustedItem.rotation === 90 ? wallAdjustedItem.width : wallAdjustedItem.height) / draft.roomHeight) * 100;
      const exactPhysicalSize = wallAdjustedItem.kind === "pillar" || preset.id === "aircon-ceiling";
      const renderedWidth = Math.min(64, exactPhysicalSize ? Math.max(0.25, widthPercent) : Math.max(isOpening ? (verticalOpening ? 1.8 : 3) : 3.6, widthPercent));
      const renderedHeight = Math.min(64, exactPhysicalSize ? Math.max(0.25, heightPercent) : Math.max(isOpening ? (verticalOpening ? 3 : 1.8) : 4.5, heightPercent));
      const outside = wallAdjustedItem.kind === "door" && wallAdjustedItem.swing === "outside";
      const renderedLeft = wallAdjustedItem.wall === "right" ? (outside ? 100 : Math.max(0, 100 - renderedWidth)) : wallAdjustedItem.wall === "left" && outside ? -renderedWidth : wallAdjustedItem.x;
      const renderedTop = wallAdjustedItem.wall === "bottom" && isOpening ? (outside ? 100 : Math.max(0, 100 - renderedHeight)) : wallAdjustedItem.wall === "top" && outside && isOpening ? -renderedHeight : wallAdjustedItem.y;
      return (
        <button key={`${className}-${item.id}`} type="button" className={`${className} kind-${wallAdjustedItem.kind} symbol-${preset.id} rotation-${wallAdjustedItem.rotation} hand-${wallAdjustedItem.handing ?? "left"} swing-${wallAdjustedItem.swing ?? "inside"} wall-${wallAdjustedItem.wall ?? "free"} ${selectedId === item.id ? "selected" : ""}`}
          style={{ left: `${renderedLeft}%`, top: `${renderedTop}%`, width: `${renderedWidth}%`, height: `${renderedHeight}%` }}
          onPointerDown={className === "site-layout-item" ? (event) => startDrag(event, item) : undefined} onClick={() => setSelectedId(item.id)} aria-label={`${item.name} ${className === "site-layout-item" ? "이동" : "선택"}`}>
          <CadSymbol symbol={preset.id} wall={isOpening ? wallAdjustedItem.wall : undefined} handing={wallAdjustedItem.handing} swing={wallAdjustedItem.swing} />
          <span className="site-layout-item-caption"><b>{wallAdjustedItem.name}</b><small>{className === "site-layout-paper-item" ? `${preset.code} · ${formatMillimeters(wallAdjustedItem.width)}×${formatMillimeters(isOpening ? wallAdjustedItem.openingHeight ?? wallAdjustedItem.height : wallAdjustedItem.height)}mm` : preset.code}</small></span>
        </button>
      );
    });
  }

  return (
    <section className="site-layout-planner" aria-label="현장 실측 기초도면 작성기">
      <header className="site-layout-intro">
        <div className="site-layout-brand"><span>W</span><div><b>기초도면 작성</b><small>현장 실측 → CAD팀 전달 · MOBILE FIRST BETA</small></div></div>
        <div className="site-layout-header-actions"><div className="site-layout-save-state" role="status"><b>{savedAt ? "자동 저장됨" : "배치도 준비됨"}</b><small>{savedAt || "실 크기를 입력해 주세요."}</small></div><button type="button" onClick={() => { setView("paper"); setCanvasFocus(true); }}>A3 출력 미리보기</button></div>
      </header>
      <div className="site-layout-beta-notice" role="note"><b>BETA · 개발 중</b><span>현재 개발 중인 기능입니다. 현장 실측 초안 및 CAD팀 전달용이며 최종 시공 도면으로 사용할 수 없습니다.</span></div>

      <section className="site-layout-guide" aria-label="현장 실측 단계">
        <nav className="site-layout-guide-progress">{guideSteps.map((step, index) => {
          const status = step.id === "review" ? "pending" : draft.stageChecks?.[step.id] ?? (step.id === "room" && stageCounts.room ? "complete" : "pending");
          return <button key={step.id} type="button" className={`${index === activeStepIndex ? "active" : ""} status-${status}`} onClick={() => goToStep(index)}><i>{index + 1}</i><span>{step.label}</span></button>;
        })}</nav>
        <div className="site-layout-guide-card">
          <div className="site-layout-guide-copy"><small>STEP {activeStepIndex + 1} / {guideSteps.length}</small><h2>{activeStep.title}</h2><p>{activeStep.description}</p></div>
          {activeStep.id === "room" && <div className="site-layout-room-settings">
            <label><span>실 이름</span><input value={draft.roomName} onChange={(event) => updateDraft({ roomName: event.target.value.slice(0, 80) })} placeholder="예: 2층 스마트 체험교실" /></label>
            <label><span>가로</span><div><FriendlyNumberInput label="공간 가로(m)" value={draft.roomWidth} min={0.1} max={100} onCommit={(value) => updateDraft({ roomWidth: positiveDimension(value, draft.roomWidth) })} /><em>m</em></div></label>
            <label><span>세로</span><div><FriendlyNumberInput label="공간 세로(m)" value={draft.roomHeight} min={0.1} max={100} onCommit={(value) => updateDraft({ roomHeight: positiveDimension(value, draft.roomHeight) })} /><em>m</em></div></label>
            <label><span>천장 높이</span><div><FriendlyNumberInput label="천장 높이(m)" value={ceilingHeight} min={0.1} max={20} onCommit={(value) => updateDraft({ roomCeilingHeight: positiveDimension(value, ceilingHeight) })} /><em>m</em></div></label>
            <label><span>벽 두께</span><div><FriendlyNumberInput label="벽 두께(mm)" value={Math.round((draft.roomWallThickness ?? 0.15) * 1000)} min={100} max={1000} decimals={0} onCommit={(value) => updateDraft({ roomWallThickness: positiveDimension(value / 1000, draft.roomWallThickness ?? 0.15) })} /><em>mm</em></div></label>
            <button type="button" className="site-layout-generate" onClick={generateRoom}>이 크기로 시작</button>
            <button type="button" className="site-layout-reset" onClick={resetDraft}>새 도면</button>
          </div>}
          {activeStep.id !== "room" && activeStep.id !== "review" && <div className="site-layout-stage-check">
            <div><b>{stageCounts[activeStep.id]}개 등록</b><span>현장 확인 상태를 선택하세요.</span></div>
            <div role="radiogroup" aria-label={`${activeStep.label} 확인 상태`}>{([
              ["complete", "확인 완료"], ["none", "해당 없음"], ["review", "재확인 필요"],
            ] as [StageCheckStatus, string][]).map(([status, label]) => <button key={status} type="button" role="radio" aria-checked={(draft.stageChecks?.[activeStep.id as StageCheckKey] ?? "pending") === status} onClick={() => setStageStatus(activeStep.id as StageCheckKey, status)}>{label}</button>)}</div>
          </div>}
          {activeStep.id === "checklist" && <div className="site-layout-site-checklist">
            <div className="site-layout-checklist-group"><h3>인터넷·망</h3><div>
              <label><span>인터넷 사용</span><select value={checklist.internetAvailable} onChange={(event) => updateChecklist("internetAvailable", event.target.value as SurveyChoice)}><option value="">미확인</option><option value="yes">있음</option><option value="no">없음</option><option value="review">재확인</option></select></label>
              <label><span>연결 방식</span><select value={checklist.internetMode} onChange={(event) => updateChecklist("internetMode", event.target.value as InternetMode)}><option value="">미확인</option><option value="wired">유선</option><option value="wireless">무선</option><option value="both">유선·무선</option><option value="none">사용 불가</option></select></label>
              <label><span>사용 망</span><select value={checklist.networkType} onChange={(event) => updateChecklist("networkType", event.target.value as NetworkType)}><option value="">미확인</option><option value="education">교육망</option><option value="private">사설망</option><option value="both">교육망·사설망</option><option value="unknown">현장 확인</option></select></label>
            </div></div>
            <div className="site-layout-checklist-group"><h3>전기·시공</h3><div>{([
              ["powerOutlet", "사용 가능한 전원"], ["dedicatedCircuit", "전용 회로"], ["blackoutCurtain", "암막커튼"], ["floorWork", "바닥공사"], ["elevator", "엘리베이터"], ["ceilingLightRemoval", "천장 조명 철거"], ["airconConflict", "에어컨 간섭"],
            ] as [keyof SiteChecklist, string][]).map(([key, label]) => <label key={key}><span>{label}</span><select value={checklist[key]} onChange={(event) => updateChecklist(key, event.target.value as never)}><option value="">미확인</option><option value="yes">있음·필요</option><option value="no">없음·불필요</option><option value="review">재확인</option></select></label>)}</div></div>
            <label className="site-layout-field-notes"><span>현장 메모·CAD팀 전달사항</span><textarea value={draft.fieldNotes ?? ""} onChange={(event) => updateDraft({ fieldNotes: event.target.value.slice(0, 1000) })} placeholder="보 하단 높이, 보와 보 사이, 에어컨·기둥 간섭, 반입 동선 등 특이사항을 입력하세요." /></label>
          </div>}
          {activeStep.id === "review" && <div className="site-layout-review-grid">
            {guideSteps.filter((step) => step.id !== "review").map((step) => {
              const key = step.id as StageCheckKey;
              const status = draft.stageChecks?.[key] ?? (key === "room" && stageCounts.room ? "complete" : "pending");
              const labels: Record<StageCheckStatus, string> = { pending: "미확인", complete: "확인 완료", none: "해당 없음", review: "재확인 필요" };
              return <button key={step.id} type="button" className={`status-${status}`} onClick={() => goToStep(guideSteps.findIndex((item) => item.id === step.id))}><span>{step.label}</span><b>{labels[status]}</b><small>{stageCounts[key]}개</small></button>;
            })}
            <div className="site-layout-review-note"><span>현장 메모</span><p>{draft.fieldNotes || "등록된 메모가 없습니다."}</p></div>
          </div>}
        </div>
      </section>

      <div className="site-layout-commandbar"><div>{["선택", "이동"].map((tool) => <button key={tool} type="button" className={activeTool === tool ? "active" : ""} onClick={() => { setActiveTool(tool); setCommand(`명령: ${tool} 도구가 활성화되었습니다.`); }}>{tool}</button>)}</div><p aria-live="polite">{command}</p></div>

      <div className={`site-layout-workspace ${canvasFocus ? "is-canvas-focus" : ""}`}>
        <aside className={`site-layout-library ${activePresets.length ? "" : "is-context-only"}`}>
          <div><b>{activeStep.id === "room" ? "공간 입력 안내" : activeStep.id === "review" ? "최종 검수" : `${activeStep.label} 모양 선택`}</b><span>{activeStep.id === "room" ? "위에서 실측값을 입력한 뒤 다음 단계로 이동하세요." : activeStep.id === "review" ? "미확인 단계를 눌러 바로 보완할 수 있습니다." : "현장과 가장 비슷한 그림을 먼저 선택하세요."}</span></div>
          {activePresets.length > 0 && <p className="site-layout-mobile-help">그림 선택 → 도면의 벽이나 위치 터치 → 실제 치수 입력</p>}
          {activeStep.groups.map((group) => {
            const presets = activePresets.filter((preset) => preset.group === group); if (!presets.length) return null;
            return <section key={group} className="site-layout-library-section"><h3>{group}<small>{presets.length}</small></h3><div className="site-layout-library-grid">{presets.map((preset) => <button key={preset.id} type="button" draggable className={`kind-${preset.kind} symbol-${preset.id} ${pendingPresetId === preset.id ? "pending" : ""}`} aria-pressed={pendingPresetId === preset.id} onDragStart={(event) => handlePresetDragStart(event, preset.id)} onClick={() => choosePreset(preset.id)}><CadSymbol symbol={preset.id} compact /><span>{preset.label}</span><small>{preset.code} · {formatMillimeters(preset.width)}mm</small></button>)}</div></section>;
          })}
          {!activePresets.length && <div className="site-layout-library-empty">{activeStep.id === "review" ? "단계별 상태와 도면을 최종 확인하세요." : "공간 치수를 입력하면 도면이 자동 생성됩니다."}</div>}
        </aside>

        <main className={`site-layout-canvas-panel view-${view}`}>
          <div className="site-layout-canvas-head"><div><button type="button" className={view === "model" ? "active" : ""} onClick={() => setView("model")}>모델</button><button type="button" className={view === "paper" ? "active" : ""} onClick={() => { setView("paper"); setCanvasFocus(true); }}>A3 출력</button></div><div className="site-layout-canvas-meta">{pendingPreset ? <button type="button" className="site-layout-pending-placement" onClick={() => { setPendingPresetId(null); setActiveTool("선택"); setCommand("명령: 블록 배치를 취소했습니다."); }}>{pendingPreset.label} 배치 대기 · 취소</button> : <span>TOP · 1:60 · mm</span>}<button type="button" className="site-layout-focus-toggle" aria-pressed={canvasFocus} onClick={() => setCanvasFocus((current) => !current)}>{canvasFocus ? "패널 보기" : "도면 크게"}</button></div></div>
          <div className="site-layout-model-space">
            <div className="site-layout-ruler top"><span>{formatMillimeters(draft.roomWidth)} mm</span></div>
            <div className="site-layout-board-wrap" style={{ maxWidth: `${Math.round(920 * roomRatio)}px` }}><div ref={boardRef} className={`site-layout-board ${pendingPreset ? "placing" : ""}`} style={{ aspectRatio: `${draft.roomWidth} / ${draft.roomHeight}` }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={handleBoardDrop} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onPointerDown={handleBoardPointerDown}><div className="site-layout-room-label"><b>RC 벽체 t={formatMillimeters(draft.roomWallThickness ?? 0.15)}</b><span>{draft.roomName} · 천장 H={formatMillimeters(ceilingHeight)}</span></div>{renderItems("site-layout-item")}<div className="site-layout-axis-label axis-x">X</div><div className="site-layout-axis-label axis-y">Y</div><div className="site-layout-crosshair" aria-hidden="true" /></div></div>
            <div className="site-layout-ruler side"><span>{formatMillimeters(draft.roomHeight)} mm</span></div>
            {!visibleBasicItemCount && activeStep.id !== "room" && <div className="site-layout-empty"><b>{activeStep.label} 모양을 선택해 도면을 시작하세요.</b><span>모바일에서는 그림을 누른 뒤 도면의 위치를 터치하세요.</span></div>}
            <small className="site-layout-coordinates">X 8,410.000&nbsp;&nbsp;Y 4,215.000&nbsp;&nbsp;Z 0.000</small>
          </div>
          <div className="site-layout-paper-space"><div className="site-layout-paper-sheet"><div className="site-layout-paper-plan">
            <div className="site-layout-paper-note"><b>기초 평면도</b><span>RC 벽체 t={formatMillimeters(draft.roomWallThickness ?? 0.15)} · 천장 H={formatMillimeters(ceilingHeight)} · 현장 실측 기준 예상 도면</span></div>
            <div className="site-layout-paper-drawing">
              <div className="site-layout-paper-dimension dimension-width"><span>{formatMillimeters(draft.roomWidth)} mm</span></div>
              <div className="site-layout-paper-dimension dimension-height"><span>{formatMillimeters(draft.roomHeight)} mm</span></div>
              <div className="site-layout-paper-room" style={{ aspectRatio: `${draft.roomWidth} / ${draft.roomHeight}` }}>{renderItems("site-layout-paper-item")}</div>
            </div>
            <div className="site-layout-paper-title"><div><b>{draft.roomName} 평면도</b><small>BETA · 현장 실측 참고용 · CAD 검토 후 확정</small></div><span>현장 실측 기준 · 축척 1/60 (A3)</span></div>
          </div><aside className="site-layout-title-block"><strong>{draft.roomName}</strong><section><b>도면 구성</b><p>RC 벽체 · 문 · 창호 · 기둥 · 보 · 에어컨</p></section><section><b>현장 통신</b><p>인터넷 {surveyChoiceLabel(checklist.internetAvailable)} · {internetModeLabel(checklist.internetMode)}<br />망 {networkTypeLabel(checklist.networkType)}</p></section><section><b>전기·시공</b><p>전원 {surveyChoiceLabel(checklist.powerOutlet)} · 전용회로 {surveyChoiceLabel(checklist.dedicatedCircuit)}<br />암막 {surveyChoiceLabel(checklist.blackoutCurtain)} · 바닥 {surveyChoiceLabel(checklist.floorWork)}<br />E/V {surveyChoiceLabel(checklist.elevator)} · 에어컨 간섭 {surveyChoiceLabel(checklist.airconConflict)}</p></section><section><b>CAD팀 전달 메모</b><p>{draft.fieldNotes || "특이사항 없음"}</p></section><dl><dt>PROJECT</dt><dd>{draft.roomName}</dd><dt>DATE</dt><dd>{new Intl.DateTimeFormat("ko-KR").format(new Date())}</dd><dt>SCALE</dt><dd>A3 1/60</dd></dl></aside></div></div>
        </main>

        <aside className="site-layout-inspector">
          <div><b>레이어</b><span>화면 표시와 객체 속성을 제어합니다.</span></div>
          <div className="site-layout-layer-list"><div><i className="wall" /><span>A-WALL RC 벽체</span><b>ON</b></div>{(["opening", "structure", "fixture"] as LayoutLayer[]).map((layer) => { const meta: Record<LayoutLayer, [string, string]> = { opening: ["A-OPEN 문·창호", "opening"], structure: ["A-STRC 기둥·보", "structure"], fixture: ["M-FIX 고정 시설", "fixture"], equipment: ["E-EQPM 제품 장비", "equipment"], note: ["A-NOTE 주석", "note"] }; return <button key={layer} type="button" aria-pressed={visibleLayers[layer]} onClick={() => setVisibleLayers((current) => ({ ...current, [layer]: !current[layer] }))}><i className={meta[layer][1]} /><span>{meta[layer][0]}</span><b>{visibleLayers[layer] ? "ON" : "OFF"}</b></button>; })}</div>
          <div className="site-layout-object-head"><b>{selectedItem ? selectedItem.name : "선택 객체"}</b><span>{selectedPreset?.code ?? "객체를 선택하세요."}</span></div>
          {selectedItem && selectedPreset && itemLayer(selectedItem) !== "equipment" ? <div className="site-layout-inspector-form">
            <div className="site-layout-inspector-preview"><CadSymbol symbol={selectedPreset.id} /><span>{selectedPreset.label}</span></div>
            <label><span>이름</span><input value={selectedItem.name} onChange={(event) => updateSelected({ name: event.target.value.slice(0, 60) })} /></label>
            <div className={`site-layout-size-fields ${selectedItem.presetId === "aircon-ceiling" ? "is-square" : ""}`}>
              {selectedItem.kind === "door" || selectedItem.kind === "window" ? <>
                <label><span>개구부 폭(mm)</span><MillimeterInput label="개구부 폭(mm)" valueMeters={selectedItem.width} minMm={300} maxMm={Math.round(((selectedItem.wall === "left" || selectedItem.wall === "right") ? draft.roomHeight : draft.roomWidth) * 1000)} onCommit={updateOpeningWidth} /></label>
                <label><span>개구부 높이(mm)</span><MillimeterInput label="개구부 높이(mm)" valueMeters={selectedItem.openingHeight ?? (selectedItem.kind === "door" ? 2.1 : 1.5)} minMm={300} maxMm={Math.round(Math.max(0.3, ceilingHeight - (selectedItem.kind === "window" ? selectedItem.sillHeight ?? 0.9 : 0)) * 1000)} onCommit={updateOpeningHeight} /></label>
              </> : selectedItem.presetId === "aircon-ceiling" ? <label><span>정사각형 한 변(m)</span><FriendlyNumberInput label="천장형 에어컨 한 변(m)" value={selectedItem.width} min={0.3} max={3} onCommit={(value) => updateSelectedDimension("width", value)} /></label> : <>
                <label><span>가로(m)</span><FriendlyNumberInput label="객체 가로(m)" value={selectedItem.width} min={0.1} max={30} onCommit={(value) => updateSelectedDimension("width", value)} /></label>
                <label><span>세로(m)</span><FriendlyNumberInput label="객체 세로(m)" value={selectedItem.height} min={0.1} max={30} onCommit={(value) => updateSelectedDimension("height", value)} /></label>
              </>}
            </div>
            {(selectedItem.kind === "door" || selectedItem.kind === "window") && <div className="site-layout-opening-fields">
              <label><span>설치 벽</span><select value={selectedItem.wall ?? "top"} onChange={(event) => updateWallMountedWall(event.target.value as WallSide)}><option value="top">상단 A벽</option><option value="right">우측 B벽</option><option value="bottom">하단 C벽</option><option value="left">좌측 D벽</option></select></label>
              <label><span>모서리→개구부 시작(mm)</span><MillimeterInput label="모서리에서 개구부 시작(mm)" valueMeters={selectedItem.offset ?? 0} minMm={0} maxMm={Math.round(Math.max(0, ((selectedItem.wall === "left" || selectedItem.wall === "right") ? draft.roomHeight : draft.roomWidth) - selectedItem.width) * 1000)} onCommit={updateOpeningOffset} /></label>
              {selectedItem.kind === "window" && <label><span>창 하단 높이(mm)</span><MillimeterInput label="창 하단 높이(mm)" valueMeters={selectedItem.sillHeight ?? 0.9} minMm={0} maxMm={Math.round(Math.max(0, ceilingHeight - (selectedItem.openingHeight ?? 1.5)) * 1000)} onCommit={updateWindowSill} /></label>}
              {selectedItem.kind === "door" && <label><span>경첩·열림 방향</span><select value={selectedItem.handing ?? "left"} onChange={(event) => updateSelected({ handing: event.target.value as OpeningHand })}><option value="left">좌경첩</option><option value="right">우경첩</option></select></label>}
              {selectedItem.kind === "door" && <label><span>실내·실외 열림</span><select value={selectedItem.swing ?? "inside"} onChange={(event) => updateSelected({ swing: event.target.value as OpeningSwing })}><option value="inside">실 안쪽으로</option><option value="outside">실 바깥쪽으로</option></select></label>}
            </div>}
            {selectedItem.presetId === "aircon-wall" && <div className="site-layout-opening-fields site-layout-aircon-fields">
              <label><span>설치 벽</span><select value={selectedItem.wall ?? "top"} onChange={(event) => updateWallMountedWall(event.target.value as WallSide)}><option value="top">상단 A벽</option><option value="right">우측 B벽</option><option value="bottom">하단 C벽</option><option value="left">좌측 D벽</option></select></label>
              <label><span>모서리→에어컨 중심(m)</span><FriendlyNumberInput label="모서리에서 에어컨 중심(m)" value={selectedItem.offset ?? selectedItem.width / 2} min={0} max={(selectedItem.wall === "left" || selectedItem.wall === "right") ? draft.roomHeight : draft.roomWidth} onCommit={updateWallMountedOffset} /></label>
              <label><span>바닥→에어컨 하단(m)</span><FriendlyNumberInput label="바닥에서 에어컨 하단(m)" value={selectedItem.mountingHeight ?? 2.1} min={0} max={10} onCommit={(value) => updateSelected({ mountingHeight: value })} /></label>
            </div>}
            {!isWallMounted(selectedItem) && <div className="site-layout-reference-fields">
              <label><span>좌측 D벽→중심(m)</span><FriendlyNumberInput label="좌측 D벽에서 중심(m)" value={centerDistance(selectedItem, "x")} min={0} max={draft.roomWidth} onCommit={(value) => updateCenterDistance("x", value)} /></label>
              <label><span>상단 A벽→중심(m)</span><FriendlyNumberInput label="상단 A벽에서 중심(m)" value={centerDistance(selectedItem, "y")} min={0} max={draft.roomHeight} onCommit={(value) => updateCenterDistance("y", value)} /></label>
            </div>}
            {selectedItem.presetId === "aircon-ceiling" && <div className="site-layout-structure-fields"><label><span>바닥→설치면 높이(m)</span><FriendlyNumberInput label="바닥에서 설치면 높이(m)" value={selectedItem.mountingHeight ?? ceilingHeight} min={0} max={20} onCommit={(value) => updateSelected({ mountingHeight: value })} /></label></div>}
            {selectedItem.kind === "beam" && <div className="site-layout-structure-fields">
              <label><span>바닥→보 하단(m)</span><FriendlyNumberInput label="바닥에서 보 하단(m)" value={selectedItem.beamBottomHeight ?? 2.2} min={0} max={20} onCommit={(value) => updateSelected({ beamBottomHeight: value })} /></label>
              <label><span>다음 보까지 유효거리(m)</span><FriendlyNumberInput label="다음 보까지 유효거리(m)" value={selectedItem.beamSpacing ?? 1} min={0} max={30} onCommit={(value) => updateSelected({ beamSpacing: value })} /></label>
            </div>}
            <div className="site-layout-object-facts"><span>블록명 <b>{selectedPreset.code}</b></span><span>레이어 <b>{itemLayer(selectedItem).toUpperCase()}</b></span><span>스냅 <b>{isWallMounted(selectedItem) ? `${wallLabel(selectedItem.wall)} 기준거리` : "두 벽 중심거리"}</b></span></div>
            {selectedPreset.guide && <div className="site-layout-install-guide"><span>현장 확인</span><p>{selectedPreset.guide}</p></div>}
            <div className="site-layout-inspector-actions">{!isWallMounted(selectedItem) && <button type="button" onClick={() => updateSelected({ rotation: selectedItem.rotation === 90 ? 0 : 90 })}>90° 회전</button>}<button type="button" onClick={duplicateSelected}>복사</button><button type="button" className="danger" onClick={removeSelected}>삭제</button></div>
          </div> : <div className="site-layout-inspector-empty"><b>{activeStep.id === "room" ? "공간 크기를 먼저 입력하세요." : "배치한 블록을 선택하세요."}</b><span>선택하면 실제 치수와 설치 벽·기준 거리를 조정할 수 있습니다.</span></div>}
        </aside>
      </div>
      <div className="site-layout-step-actions"><button type="button" onClick={() => goToStep(activeStepIndex - 1)} disabled={activeStepIndex === 0}>이전</button><div><b>{activeStepIndex + 1}/{guideSteps.length} · {activeStep.label}</b><span>입력 내용은 이 기기에 자동 저장됩니다.</span></div>{activeStep.id === "review" ? <button type="button" className="primary" onClick={() => { setView("paper"); setCanvasFocus(true); }}>A3 도면 확인</button> : <button type="button" className="primary" onClick={goNextStep}>저장하고 다음</button>}</div>
      <footer className="site-layout-statusbar"><div><b>SNAP</b><b>ORTHO</b><b>OSNAP</b><span>GRID 10</span></div><p>도면 단위 mm · 브라우저 자동 저장 · CAD팀 전달용 기초도면</p></footer>
    </section>
  );
}
