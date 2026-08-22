"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent } from "react";
import SiteLayoutGeometryView from "./site-layout-geometry-view";
import { downloadFile, fileAsDataUrl, siteLayoutPdfFromSvg } from "./site-layout-export";
import { computeSvgViewBox, modelPointFromClient, normalizeDraft, validateDraft, type SiteLayoutItemMm } from "../lib/site-layout-geometry";

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
type OffsetReference = "start" | "end";
type BeamDistanceMode = "clear" | "center";
type StructureAttachment = { mode: "wall"; wall: WallSide } | { mode: "free" };
type StructureMeasurement = {
  axis: "x" | "y";
  referenceType: "wall" | "item";
  referenceWall?: WallSide;
  referenceItemId?: string;
  direction: 1 | -1;
  distanceMode: BeamDistanceMode;
  distanceMm: number;
};
type OpeningMeasurement = StructureMeasurement;
type SurveyChoice = "" | "yes" | "no" | "review";
type InternetMode = "" | "wired" | "wireless" | "both" | "none";
type NetworkType = "" | "education" | "private" | "both" | "unknown";
type GuideStepId = "room" | "door" | "window" | "structure" | "facility" | "checklist" | "review";
type StageCheckKey = Exclude<GuideStepId, "review">;
type StageCheckStatus = "pending" | "complete" | "none" | "review";
type WorkflowMode = "guided" | "direct";
type RemoteOperation = "idle" | "listing" | "saving" | "retrying" | "loading" | "deleting";
type RemoteSavePhase = "idle" | "saving" | "db-saved" | "drive-syncing" | "drive-ready" | "drive-error" | "conflict" | "failed";

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
  structureAttachment?: StructureAttachment;
  structureMeasurement?: StructureMeasurement;
  openingMeasurement?: OpeningMeasurement;
  offsetReference?: OffsetReference;
  wallInset?: number;
  freeReferenceX?: "left" | "right";
  freeReferenceY?: "top" | "bottom";
};

type LayoutDraft = {
  organizationName?: string;
  businessRound?: number;
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
const DRAFT_LIBRARY_KEY = "whizzup:site-layout-local-drafts:v1";
const REMOTE_CONTEXT_KEY = "whizzup:site-layout-remote-context:v1";
const WORKFLOW_MODE_KEY = "whizzup:site-layout-workflow-mode:v1";

type StoredLocalDraft = {
  id: string;
  name: string;
  updatedAt: string;
  draft: LayoutDraft;
};

type RemoteLayoutSummary = {
  id: number;
  title: string;
  organizationName: string;
  businessRound: number;
  roomName: string;
  editVersion: number;
  driveSyncStatus: "queued" | "uploading" | "ready" | "error" | string;
  driveSyncError?: string;
  updatedByName?: string;
  updatedAt: string;
  pdfUrl?: string;
};

type RemoteLayoutRecord = RemoteLayoutSummary & { draft: LayoutDraft };
type InstitutionOption = { organization: string; businessRound: number; region: string };

const defaultSiteChecklist: SiteChecklist = {
  internetAvailable: "", internetMode: "", networkType: "", powerOutlet: "", dedicatedCircuit: "",
  blackoutCurtain: "", floorWork: "", elevator: "", ceilingLightRemoval: "", airconConflict: "",
};

const guideSteps: { id: GuideStepId; label: string; title: string; description: string; groups: PresetGroup[] }[] = [
  { id: "room", label: "공간", title: "공간 크기 입력", description: "실 이름과 가로·세로·천장 높이를 입력하면 방 외곽선이 자동으로 만들어집니다.", groups: [] },
  { id: "door", label: "출입문", title: "출입문 형태와 치수", description: "현장과 비슷한 문을 고르고 설치 벽을 터치한 뒤 넓이·높이·열림 방향을 확인하세요.", groups: ["문"] },
  { id: "structure", label: "기둥·보", title: "기둥과 보 실측", description: "보는 벽 부착을 기본으로 첫 보는 모서리에서, 다음 보는 앞 보에서 잰 거리를 기록하세요.", groups: ["기둥·보"] },
  { id: "window", label: "창호", title: "창호 형태와 분할", description: "고정창·좌우 슬라이딩창·연창 중 생김새가 비슷한 블록을 선택해 배치하세요.", groups: ["창호"] },
  { id: "facility", label: "에어컨", title: "에어컨과 고정 시설", description: "벽걸이는 설치 벽과 모서리 기준거리, 천장형은 두 벽에서 중심거리와 설치 높이를 기록합니다.", groups: ["현장 설비"] },
  { id: "checklist", label: "현장조건", title: "인터넷·전기·공사 조건", description: "CAD팀과 시공팀이 다시 확인하지 않도록 현장 조건을 단계별로 체크하세요.", groups: [] },
  { id: "review", label: "최종 확인", title: "CAD팀 전달 전 검수", description: "단계별 확인 상태와 누락 항목을 점검하고 CAD팀 전달용 PDF를 확인하세요.", groups: [] },
];

const checklistQuestions: { key: keyof SiteChecklist; title: string; help: string; options: { value: string; label: string }[] }[] = [
  { key: "internetAvailable", title: "현장에서 인터넷을 사용할 수 있나요?", help: "확실하지 않다면 재확인을 선택하세요.", options: [{ value: "yes", label: "있음" }, { value: "no", label: "없음" }, { value: "review", label: "재확인" }] },
  { key: "internetMode", title: "인터넷 연결 방식은 무엇인가요?", help: "현장에서 실제 사용할 연결을 선택하세요.", options: [{ value: "wired", label: "유선" }, { value: "wireless", label: "무선" }, { value: "both", label: "유선·무선" }, { value: "none", label: "사용 불가" }] },
  { key: "networkType", title: "사용하는 망 종류를 확인했나요?", help: "교육망과 사설망을 함께 쓰면 둘 다를 선택하세요.", options: [{ value: "education", label: "교육망" }, { value: "private", label: "사설망" }, { value: "both", label: "둘 다" }, { value: "unknown", label: "현장 확인" }] },
  { key: "powerOutlet", title: "사용 가능한 전원이 있나요?", help: "장비 설치 위치 주변의 콘센트를 기준으로 답하세요.", options: [{ value: "yes", label: "있음" }, { value: "no", label: "없음" }, { value: "review", label: "재확인" }] },
  { key: "blackoutCurtain", title: "암막커튼 설치가 필요한가요?", help: "채광과 프로젝터 사용 환경을 함께 확인하세요.", options: [{ value: "yes", label: "필요" }, { value: "no", label: "불필요" }, { value: "review", label: "재확인" }] },
  { key: "floorWork", title: "바닥 공사가 필요한가요?", help: "바닥 단차와 마감 상태를 기준으로 선택하세요.", options: [{ value: "yes", label: "필요" }, { value: "no", label: "불필요" }, { value: "review", label: "재확인" }] },
  { key: "elevator", title: "장비 반입용 엘리베이터가 있나요?", help: "승강기 크기와 적재 가능 여부는 메모에 남겨 주세요.", options: [{ value: "yes", label: "있음" }, { value: "no", label: "없음" }, { value: "review", label: "재확인" }] },
  { key: "ceilingLightRemoval", title: "천장 조명 철거 또는 이동이 필요한가요?", help: "스크린·프로젝터·에어컨 간섭을 확인하세요.", options: [{ value: "yes", label: "필요" }, { value: "no", label: "불필요" }, { value: "review", label: "재확인" }] },
];

const stepQuestionCounts: Record<GuideStepId, number> = {
  room: 4,
  door: 5,
  window: 5,
  structure: 5,
  facility: 5,
  checklist: checklistQuestions.length,
  review: 1,
};

const itemPresets: ItemPreset[] = [
  { id: "door-single", kind: "door", group: "문", label: "단문형", defaultName: "단문형 출입문", code: "A-DR01", width: 0.9, height: 0.18, guide: "힌지와 90° 개폐 반경을 함께 표시합니다." },
  { id: "door-double", kind: "door", group: "문", label: "양문형", defaultName: "양문형 출입문", code: "A-DR02", width: 1.8, height: 0.18, guide: "두 문짝의 개폐 반경과 중심선을 표시합니다." },
  { id: "door-unequal", kind: "door", group: "문", label: "비대칭 양문", defaultName: "비대칭 양문형 출입문", code: "A-DR03", width: 1.5, height: 0.18, guide: "주문과 보조문 폭이 다른 양문형 출입문입니다." },
  { id: "door-sliding", kind: "door", group: "문", label: "좌우 미닫이", defaultName: "좌우 미닫이문", code: "A-DR04", width: 1.8, height: 0.14, guide: "문짝 겹침과 이동 방향을 평면 심벌로 표시합니다." },
  { id: "door-folding", kind: "door", group: "문", label: "폴딩도어", defaultName: "폴딩도어", code: "A-DR05", width: 2.4, height: 0.18, guide: "접이식 문짝 개수와 문틀 끝에서 끝까지 잰 전체 폭을 확인합니다." },
  { id: "window-fixed", kind: "window", group: "창호", label: "고정창", defaultName: "고정창", code: "A-W01", width: 1.2, height: 0.14 },
  { id: "window-sliding-2", kind: "window", group: "창호", label: "슬라이딩 2짝", defaultName: "좌우 슬라이딩창 2짝", code: "A-W02", width: 1.8, height: 0.14 },
  { id: "window-3", kind: "window", group: "창호", label: "슬라이딩 3짝", defaultName: "좌우 슬라이딩창 3짝", code: "A-W03", width: 2.1, height: 0.14 },
  { id: "window-4", kind: "window", group: "창호", label: "슬라이딩 4짝", defaultName: "좌우 슬라이딩창 4짝", code: "A-W04", width: 2.7, height: 0.14 },
  { id: "window-6", kind: "window", group: "창호", label: "6분할 연창", defaultName: "6분할 연창", code: "A-W06", width: 4.2, height: 0.14, guide: "KS F 1515의 100mm 모듈을 참고한 예시값입니다. 실제 창틀 끝에서 끝까지 잰 치수를 우선합니다." },
  { id: "window-project", kind: "window", group: "창호", label: "상부 힌지 외여닫이창", defaultName: "상부 힌지 외여닫이창", code: "A-W07", width: 1.2, height: 0.14 },
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

const defaultDraft: LayoutDraft = { organizationName: "", businessRound: 1, roomName: "스마트 체험교실", roomWidth: 13.724, roomHeight: 8.146, roomCeilingHeight: 2.551, roomWallThickness: 0.15, items: [], stageChecks: {}, siteChecklist: defaultSiteChecklist, fieldNotes: "" };
const basicGroups: PresetGroup[] = ["문", "창호", "기둥·보", "현장 설비"];

function positiveDimension(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0.1, Math.round(value * 1000) / 1000));
}
function clampPercent(value: number) { return Math.min(96, Math.max(0, value)); }
function snapGrid(value: number) { return clampPercent(Math.round(value * 5) / 5); }
function isWallSide(value: unknown): value is WallSide { return value === "top" || value === "right" || value === "bottom" || value === "left"; }
function structureFootprint(item: LayoutItem) {
  return item.rotation === 90 ? { width: item.height, height: item.width } : { width: item.width, height: item.height };
}
function placePillarOnWall(item: LayoutItem, wall: WallSide, x: number, y: number, roomWidth: number, roomHeight: number) {
  const size = structureFootprint(item);
  const widthPercent = Math.min(100, (size.width / roomWidth) * 100);
  const heightPercent = Math.min(100, (size.height / roomHeight) * 100);
  const inset = Math.max(0, Number.isFinite(item.wallInset) ? item.wallInset ?? 0 : 0);
  const insetXPercent = Math.min(Math.max(0, 100 - widthPercent), (inset / roomWidth) * 100);
  const insetYPercent = Math.min(Math.max(0, 100 - heightPercent), (inset / roomHeight) * 100);
  const clampedX = Math.min(Math.max(0, 100 - widthPercent), Math.max(0, snapGrid(x)));
  const clampedY = Math.min(Math.max(0, 100 - heightPercent), Math.max(0, snapGrid(y)));
  if (wall === "top") return { wall, x: clampedX, y: insetYPercent };
  if (wall === "bottom") return { wall, x: clampedX, y: Math.max(0, 100 - heightPercent - insetYPercent) };
  if (wall === "left") return { wall, x: insetXPercent, y: clampedY };
  return { wall, x: Math.max(0, 100 - widthPercent - insetXPercent), y: clampedY };
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

function stageForItem(item: LayoutItem): StageCheckKey | null {
  if (item.kind === "door") return "door";
  if (item.kind === "window") return "window";
  if (item.kind === "pillar" || item.kind === "beam") return "structure";
  if (item.kind === "fixture") return "facility";
  return null;
}

function pendingStageChecks(draft: LayoutDraft, item: LayoutItem) {
  const stage = stageForItem(item);
  return stage ? { ...draft.stageChecks, [stage]: "pending" as const } : draft.stageChecks;
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

function normalizeStoredDraft(value: unknown): LayoutDraft | null {
  if (!validStoredDraft(value)) return null;
  const storedChecks = value.stageChecks && typeof value.stageChecks === "object" ? value.stageChecks : {};
  const storedRoomWidth = positiveDimension(value.roomWidth, defaultDraft.roomWidth);
  const storedRoomHeight = positiveDimension(value.roomHeight, defaultDraft.roomHeight);
  return {
    organizationName: typeof value.organizationName === "string" ? value.organizationName.slice(0, 100) : "",
    businessRound: Math.max(1, Math.round(Number(value.businessRound) || 1)),
    roomName: value.roomName.slice(0, 80) || defaultDraft.roomName,
    roomWidth: storedRoomWidth,
    roomHeight: storedRoomHeight,
    roomCeilingHeight: positiveDimension(value.roomCeilingHeight ?? defaultDraft.roomCeilingHeight ?? 2.7, 2.7),
    roomWallThickness: 0.15,
    items: value.items.filter(validStoredItem).map((item) => {
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
        sillHeight: item.sillHeight === undefined ? undefined : Math.max(0, Number.isFinite(item.sillHeight) ? item.sillHeight : 0.9),
        offset: item.offset === undefined ? undefined : Math.max(0, item.offset),
        wall: item.wall,
        handing: item.handing,
        swing: item.swing === "outside" ? "outside" : "inside",
        mountingHeight: item.mountingHeight === undefined ? undefined : Math.max(0, positiveDimension(item.mountingHeight, 2.1)),
        beamBottomHeight: item.beamBottomHeight === undefined ? undefined : Math.max(0, positiveDimension(item.beamBottomHeight, 2.2)),
        beamSpacing: item.beamSpacing === undefined ? undefined : Math.max(0, positiveDimension(item.beamSpacing, 1)),
        structureAttachment: item.structureAttachment?.mode === "wall" && ["top", "right", "bottom", "left"].includes(item.structureAttachment.wall)
          ? { mode: "wall", wall: item.structureAttachment.wall }
          : item.structureAttachment?.mode === "free" ? { mode: "free" } : undefined,
        structureMeasurement: item.structureMeasurement && (item.structureMeasurement.axis === "x" || item.structureMeasurement.axis === "y")
          ? {
            axis: item.structureMeasurement.axis,
            referenceType: item.structureMeasurement.referenceType === "item" ? "item" : "wall",
            referenceWall: item.structureMeasurement.referenceWall,
            referenceItemId: typeof item.structureMeasurement.referenceItemId === "string" ? item.structureMeasurement.referenceItemId : undefined,
            direction: item.structureMeasurement.direction === -1 ? -1 : 1,
            distanceMode: item.structureMeasurement.distanceMode === "center" ? "center" : "clear",
            distanceMm: Math.max(0, Number(item.structureMeasurement.distanceMm) || 0),
          }
          : undefined,
        openingMeasurement: item.openingMeasurement && (item.openingMeasurement.axis === "x" || item.openingMeasurement.axis === "y")
          ? {
            axis: item.openingMeasurement.axis,
            referenceType: item.openingMeasurement.referenceType === "item" ? "item" : "wall",
            referenceWall: item.openingMeasurement.referenceWall,
            referenceItemId: typeof item.openingMeasurement.referenceItemId === "string" ? item.openingMeasurement.referenceItemId : undefined,
            direction: item.openingMeasurement.direction === -1 ? -1 : 1,
            distanceMode: item.openingMeasurement.distanceMode === "center" ? "center" : "clear",
            distanceMm: Math.max(0, Number(item.openingMeasurement.distanceMm) || 0),
          }
          : undefined,
        offsetReference: item.offsetReference === "end" ? "end" : "start",
        wallInset: item.wallInset === undefined ? undefined : Math.max(0, Number(item.wallInset) || 0),
        freeReferenceX: item.freeReferenceX === "right" ? "right" : "left",
        freeReferenceY: item.freeReferenceY === "bottom" ? "bottom" : "top",
      };
      if (normalizedItem.kind !== "pillar") return normalizedItem;
      const placement = normalizedItem.structureAttachment?.mode === "free"
        ? { wall: undefined, x: normalizedItem.x, y: normalizedItem.y, rotation: normalizedItem.rotation }
        : normalizedItem.wall
          ? placePillarOnWall(normalizedItem, normalizedItem.wall, normalizedItem.x, normalizedItem.y, storedRoomWidth, storedRoomHeight)
          : snapPillarPlacement(normalizedItem, normalizedItem.x, normalizedItem.y, storedRoomWidth, storedRoomHeight);
      return { ...normalizedItem, ...placement };
    }),
    stageChecks: Object.fromEntries(Object.entries(storedChecks).filter((entry): entry is [string, StageCheckStatus] => validStageCheck(entry[1]))),
    siteChecklist: normalizeChecklist(value.siteChecklist),
    fieldNotes: typeof value.fieldNotes === "string" ? value.fieldNotes.slice(0, 1000) : "",
  };
}

function parseLocalDraftLibrary(raw: string | null): StoredLocalDraft[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as Partial<StoredLocalDraft>;
      const normalized = normalizeStoredDraft(candidate.draft);
      if (!normalized || typeof candidate.id !== "string") return [];
      const updatedAt = typeof candidate.updatedAt === "string" && Number.isFinite(Date.parse(candidate.updatedAt))
        ? candidate.updatedAt
        : new Date(0).toISOString();
      return [{
        id: candidate.id,
        name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.slice(0, 80) : normalized.roomName,
        updatedAt,
        draft: normalized,
      }];
    }).slice(0, 20);
  } catch {
    return [];
  }
}

function editorDraftFromRemote(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { editorDraft?: unknown };
  return normalizeStoredDraft(candidate.editorDraft ?? value);
}

function normalizeRemoteSummary(value: unknown): RemoteLayoutSummary | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = Number(candidate.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const updatedAt = typeof candidate.updatedAt === "string" && Number.isFinite(Date.parse(candidate.updatedAt))
    ? candidate.updatedAt
    : new Date(0).toISOString();
  return {
    id,
    title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.slice(0, 80) : "이름 없는 기초도면",
    organizationName: typeof candidate.organizationName === "string" && candidate.organizationName.trim() ? candidate.organizationName.slice(0, 100) : "기관 미지정",
    businessRound: Math.max(1, Math.round(Number(candidate.businessRound) || 1)),
    roomName: typeof candidate.roomName === "string" && candidate.roomName.trim() ? candidate.roomName.slice(0, 80) : "실 미지정",
    editVersion: Math.max(1, Number(candidate.editVersion) || 1),
    driveSyncStatus: typeof candidate.driveSyncStatus === "string" ? candidate.driveSyncStatus : "queued",
    driveSyncError: typeof candidate.driveSyncError === "string" ? candidate.driveSyncError : undefined,
    updatedByName: typeof candidate.updatedByName === "string" ? candidate.updatedByName : undefined,
    updatedAt,
    pdfUrl: typeof candidate.pdfUrl === "string" ? candidate.pdfUrl : undefined,
  };
}

function normalizeRemoteLayout(value: unknown): RemoteLayoutRecord | null {
  const summary = normalizeRemoteSummary(value);
  if (!summary || !value || typeof value !== "object") return null;
  const draft = editorDraftFromRemote((value as Record<string, unknown>).draft);
  return draft ? { ...summary, draft } : null;
}

function remoteLayoutsFromPayload(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const candidate = value as { layouts?: unknown };
  if (!Array.isArray(candidate.layouts)) return [];
  return candidate.layouts.flatMap((item) => {
    const normalized = normalizeRemoteSummary(item);
    return normalized ? [normalized] : [];
  });
}

function remoteLayoutFromPayload(value: unknown) {
  if (!value || typeof value !== "object") return null;
  return normalizeRemoteLayout((value as { layout?: unknown }).layout);
}

function cloneDraft(value: LayoutDraft): LayoutDraft {
  return JSON.parse(JSON.stringify(value)) as LayoutDraft;
}

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
  const [saveMessage, setSaveMessage] = useState("입력 내용은 이 기기에 자동 복구되며 기관 도면 저장을 누르면 Google Drive에 보관됩니다.");
  const [localDrafts, setLocalDrafts] = useState<StoredLocalDraft[]>([]);
  const [activeLocalDraftId, setActiveLocalDraftId] = useState("");
  const [activeLocalDraftFingerprint, setActiveLocalDraftFingerprint] = useState("");
  const [draftLibraryOpen, setDraftLibraryOpen] = useState(false);
  const [draftLibraryQuery, setDraftLibraryQuery] = useState("");
  const [draftLibraryPage, setDraftLibraryPage] = useState(1);
  const [remoteLayouts, setRemoteLayouts] = useState<RemoteLayoutSummary[]>([]);
  const [remoteOperation, setRemoteOperation] = useState<RemoteOperation>("idle");
  const [remoteSavePhase, setRemoteSavePhase] = useState<RemoteSavePhase>("idle");
  const [remoteSaveDetail, setRemoteSaveDetail] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [creatingInstitution, setCreatingInstitution] = useState(false);
  const [activeRemoteId, setActiveRemoteId] = useState<number | null>(null);
  const [activeRemoteVersion, setActiveRemoteVersion] = useState<number | null>(null);
  const [activeRemoteFingerprint, setActiveRemoteFingerprint] = useState("");
  const [activeDriveSyncStatus, setActiveDriveSyncStatus] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<LayoutView>("model");
  const [canvasFocus, setCanvasFocus] = useState(false);
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [orientationHint, setOrientationHint] = useState(false);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("direct");
  const [institutionSearchResult, setInstitutionSearchResult] = useState<{
    query: string;
    options: InstitutionOption[];
  }>({ query: "", options: [] });
  const institutionQuery = (draft.organizationName ?? "").trim();
  const institutionOptions = institutionSearchResult.query === institutionQuery
    ? institutionSearchResult.options
    : [];
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [activeTool, setActiveTool] = useState("선택");
  const [command, setCommand] = useState("명령: 실 크기를 확인하고 표준 블록을 선택하세요.");
  const [pendingPresetId, setPendingPresetId] = useState<LayoutSymbol | null>(null);
  const [visibleLayers, setVisibleLayers] = useState<Record<LayoutLayer, boolean>>({ opening: true, structure: true, fixture: true, equipment: false, note: false });
  const boardRef = useRef<HTMLDivElement | null>(null);
  const exportBoardRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number; startModelX: number; startModelY: number; startX: number; startY: number } | null>(null);
  const expandedRef = useRef(false);
  const expandedScrollYRef = useRef(0);
  const expandedHistoryTokenRef = useRef("");
  const suppressExpandedPopRef = useRef(false);
  const closingExpandedRef = useRef(false);
  const fullscreenEnteredRef = useRef(false);
  const remoteLoading = remoteOperation !== "idle";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const parsed: unknown = stored ? JSON.parse(stored) : null;
        const normalized = normalizeStoredDraft(parsed);
        if (normalized) setDraft(normalized);
      } catch {
        // A malformed local draft should never block the workspace.
      }
      try {
        const storedMode = window.localStorage.getItem(WORKFLOW_MODE_KEY);
        const mobileFieldDevice = window.matchMedia("(max-width: 760px)").matches;
        setWorkflowMode(mobileFieldDevice && storedMode === "direct" ? "direct" : window.matchMedia("(max-width: 760px)").matches ? "guided" : "direct");
      } catch {
        setWorkflowMode(window.matchMedia("(max-width: 760px)").matches ? "guided" : "direct");
      }
      try {
        setLocalDrafts(parseLocalDraftLibrary(window.localStorage.getItem(DRAFT_LIBRARY_KEY)));
      } catch {
        setLocalDrafts([]);
      }
      try {
        const context = JSON.parse(window.localStorage.getItem(REMOTE_CONTEXT_KEY) ?? "null") as { id?: unknown; editVersion?: unknown; fingerprint?: unknown; driveSyncStatus?: unknown } | null;
        const id = Number(context?.id);
        const editVersion = Number(context?.editVersion);
        if (Number.isInteger(id) && id > 0) setActiveRemoteId(id);
        if (Number.isInteger(editVersion) && editVersion > 0) setActiveRemoteVersion(editVersion);
        if (typeof context?.fingerprint === "string") setActiveRemoteFingerprint(context.fingerprint);
        if (typeof context?.driveSyncStatus === "string") {
          setActiveDriveSyncStatus(context.driveSyncStatus);
          setRemoteSavePhase(context.driveSyncStatus === "ready" ? "drive-ready" : context.driveSyncStatus === "error" ? "drive-error" : "drive-syncing");
        }
      } catch {
        // The recovery draft remains usable even when its remote context is malformed.
      } finally { setHydrated(true); }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
        if (activeRemoteId && activeRemoteVersion) {
          window.localStorage.setItem(REMOTE_CONTEXT_KEY, JSON.stringify({ id: activeRemoteId, editVersion: activeRemoteVersion, fingerprint: activeRemoteFingerprint, driveSyncStatus: activeDriveSyncStatus }));
        }
        if (!activeRemoteId && remoteSavePhase === "idle") setSaveMessage("아직 기관 도면 저장 전입니다. 현재 입력은 이 기기에 복구용으로 보관됩니다.");
        setSavedAt(new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
      } catch {
        if (remoteSavePhase === "idle") setSaveMessage("자동 저장에 실패했습니다. 브라우저 저장 공간을 확인해 주세요.");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [activeDriveSyncStatus, activeRemoteFingerprint, activeRemoteId, activeRemoteVersion, draft, hydrated, remoteSavePhase]);

  useEffect(() => {
    if (!hydrated) return;
    void refreshRemoteLayouts();
  }, [hydrated]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    if (!hydrated) return;
    const query = (draft.organizationName ?? "").trim();
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/institutions/search?q=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("기관 검색 실패")))
        .then((payload: { institutions?: InstitutionOption[] }) => setInstitutionSearchResult({
          query,
          options: Array.isArray(payload.institutions) ? payload.institutions : [],
        }))
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setInstitutionSearchResult({ query, options: [] });
          }
        });
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [draft.organizationName, hydrated]);

  useEffect(() => {
    expandedRef.current = canvasExpanded;
    if (!canvasExpanded) return;
    const previousOverflow = document.body.style.overflow;
    const updateOrientationHint = () => setOrientationHint(window.matchMedia("(orientation: portrait)").matches);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") void leaveCanvasExpanded(); };
    const closeWhenFullscreenEnds = () => {
      if (fullscreenEnteredRef.current && !document.fullscreenElement && !closingExpandedRef.current) void leaveCanvasExpanded();
    };
    const closeOnHistoryBack = () => {
      if (suppressExpandedPopRef.current) { suppressExpandedPopRef.current = false; return; }
      if (expandedRef.current) void leaveCanvasExpanded({ historyAlreadyPopped: true });
    };
    document.body.style.overflow = "hidden";
    updateOrientationHint();
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updateOrientationHint);
    window.addEventListener("popstate", closeOnHistoryBack);
    document.addEventListener("fullscreenchange", closeWhenFullscreenEnds);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updateOrientationHint);
      window.removeEventListener("popstate", closeOnHistoryBack);
      document.removeEventListener("fullscreenchange", closeWhenFullscreenEnds);
      const orientation = (screen as Screen & { orientation?: ScreenOrientation & { unlock?: () => void } }).orientation;
      try { orientation?.unlock?.(); } catch { /* Older Safari can expose a partial orientation API. */ }
    };
  }, [canvasExpanded]);

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
  const checklistAnsweredCount = checklistQuestions.filter((question) => Boolean(checklist[question.key])).length;
  const stageCounts = useMemo(() => ({
    room: draft.roomWidth > 0 && draft.roomHeight > 0 ? 1 : 0,
    door: draft.items.filter((item) => item.kind === "door").length,
    window: draft.items.filter((item) => item.kind === "window").length,
    structure: draft.items.filter((item) => item.kind === "pillar" || item.kind === "beam").length,
    facility: draft.items.filter((item) => item.kind === "fixture").length,
    checklist: checklistAnsweredCount,
  }), [checklistAnsweredCount, draft.items, draft.roomHeight, draft.roomWidth]);
  const physicalDraft = useMemo(() => normalizeDraft(draft), [draft]);
  const currentDraftFingerprint = useMemo(() => JSON.stringify(draft), [draft]);
  const geometryIssues = useMemo(() => validateDraft(physicalDraft), [physicalDraft]);
  const geometryViewBox = useMemo(() => computeSvgViewBox(physicalDraft, { paddingMm: 650 }), [physicalDraft]);
  const physicalRoomStyle = useMemo(() => ({ aspectRatio: `${geometryViewBox.width} / ${geometryViewBox.height}` } as CSSProperties), [geometryViewBox.height, geometryViewBox.width]);
  const currentQuestionCount = stepQuestionCounts[activeStep.id];
  const currentQuestionNumber = Math.min(activeQuestionIndex + 1, currentQuestionCount);
  const incompleteStageLabels = guideSteps.filter((step) => step.id !== "review").flatMap((step) => {
    const key = step.id as StageCheckKey;
    const status = draft.stageChecks?.[key] ?? "pending";
    return status === "pending" || status === "review" ? [step.label] : [];
  });
  const unansweredChecklistCount = checklistQuestions.filter((question) => !checklist[question.key]).length;
  const hasReviewProblems = geometryIssues.some((issue) => issue.severity === "error") || incompleteStageLabels.length > 0 || unansweredChecklistCount > 0;
  const selectedStageItem = useMemo(() => {
    if (selectedItem && activeStep.groups.includes(presetForItem(selectedItem).group)) return selectedItem;
    return [...draft.items].reverse().find((item) => activeStep.groups.includes(presetForItem(item).group)) ?? null;
  }, [activeStep.groups, draft.items, selectedItem]);
  const activeStageItems = useMemo(
    () => draft.items.filter((item) => activeStep.groups.includes(presetForItem(item).group)),
    [activeStep.groups, draft.items],
  );
  const filteredRemoteLayouts = useMemo(() => {
    const query = draftLibraryQuery.trim().toLocaleLowerCase("ko-KR");
    return query
      ? remoteLayouts.filter((record) => `${record.organizationName} ${record.roomName} ${record.businessRound}`.toLocaleLowerCase("ko-KR").includes(query))
      : remoteLayouts;
  }, [draftLibraryQuery, remoteLayouts]);
  const draftLibraryPageSize = 20;
  const draftLibraryPageCount = Math.max(1, Math.ceil(filteredRemoteLayouts.length / draftLibraryPageSize));
  const pagedRemoteLayouts = filteredRemoteLayouts.slice((Math.min(draftLibraryPage, draftLibraryPageCount) - 1) * draftLibraryPageSize, Math.min(draftLibraryPage, draftLibraryPageCount) * draftLibraryPageSize);

  function updateDraft(patch: Partial<LayoutDraft>) {
    setDraft((current) => ({
      ...current,
      ...patch,
      ...((patch.roomName !== undefined || patch.roomWidth !== undefined || patch.roomHeight !== undefined || patch.roomCeilingHeight !== undefined)
        ? { stageChecks: { ...current.stageChecks, room: "pending" as const } }
        : {}),
    }));
  }
  function updateSelected(patch: Partial<LayoutItem>) {
    if (!selectedId) return;
    setDraft((current) => {
      const selected = current.items.find((item) => item.id === selectedId);
      return {
        ...current,
        items: resolveWindowReferences(current.items.map((item) => item.id === selectedId ? { ...item, ...patch } : item)),
        ...(selected ? { stageChecks: pendingStageChecks(current, selected) } : {}),
      };
    });
  }
  function updateChecklist<K extends keyof SiteChecklist>(key: K, value: SiteChecklist[K]) {
    setDraft((current) => ({ ...current, siteChecklist: { ...(current.siteChecklist ?? defaultSiteChecklist), [key]: value }, stageChecks: { ...current.stageChecks, checklist: "pending" } }));
  }
  function persistLocalDrafts(nextDrafts: StoredLocalDraft[]) {
    const trimmed = nextDrafts.slice(0, 20);
    try {
      window.localStorage.setItem(DRAFT_LIBRARY_KEY, JSON.stringify(trimmed));
      setLocalDrafts(trimmed);
      return true;
    } catch {
      setSaveMessage("초안 저장에 실패했습니다. 브라우저 저장 공간을 확인해 주세요.");
      return false;
    }
  }
  function persistNamedRecovery() {
    const id = activeLocalDraftId || crypto.randomUUID();
    const record: StoredLocalDraft = { id, name: draft.roomName.trim() || "이름 없는 기초도면", updatedAt: new Date().toISOString(), draft: cloneDraft(draft) };
    const next = [record, ...localDrafts.filter((item) => item.id !== id)];
    if (!persistLocalDrafts(next)) return null;
    setActiveLocalDraftId(id);
    setActiveLocalDraftFingerprint(JSON.stringify(draft));
    setSavedAt(new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
    return record;
  }
  function exportFileName() {
    const base = `${draft.organizationName || "기관미지정"}_${draft.businessRound || 1}차_${draft.roomName || "기초도면"}`
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_");
    return `${base}_CAD팀전달용.pdf`;
  }
  async function createCurrentPdf() {
    const svg = exportBoardRef.current?.querySelector("svg") ?? boardRef.current?.querySelector("svg");
    if (!(svg instanceof SVGSVGElement)) throw new Error("PDF로 만들 도면을 찾지 못했습니다.");
    return await siteLayoutPdfFromSvg(svg, exportFileName());
  }
  async function downloadCurrentPdf() {
    if (exporting) return;
    setExporting(true);
    try {
      const file = await createCurrentPdf();
      downloadFile(file);
      setToastMessage("CAD팀 전달용 PDF를 저장했습니다.");
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : "PDF를 만들지 못했습니다.");
    } finally { setExporting(false); }
  }
  async function shareCurrentPdf() {
    if (exporting) return;
    setExporting(true);
    try {
      const file = await createCurrentPdf();
      const share = navigator.share?.bind(navigator);
      const canShare = navigator.canShare?.({ files: [file] }) ?? false;
      if (share && canShare) {
        await share({ title: `${draft.organizationName || "기관"} 기초도면`, text: "CAD팀 전달용 기초도면입니다.", files: [file] });
        setToastMessage("공유할 앱으로 PDF를 전달했습니다.");
      } else {
        downloadFile(file);
        setToastMessage("이 기기에서는 파일 공유를 지원하지 않아 PDF로 저장했습니다.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setToastMessage(error instanceof Error ? error.message : "PDF를 공유하지 못했습니다.");
    } finally { setExporting(false); }
  }
  async function createInstitutionFromDraft() {
    const organization = (draft.organizationName || "").trim();
    if (organization.length < 2 || creatingInstitution) return;
    setCreatingInstitution(true);
    try {
      const response = await fetch("/api/institutions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organization }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; institution?: { organization?: string } };
      if (!response.ok) throw new Error(payload.error || "새 기관을 추가하지 못했습니다.");
      setInstitutionSearchResult({ query: organization, options: [{ organization, businessRound: draft.businessRound || 1, region: "" }] });
      setToastMessage(`“${organization}” 기관을 추가하고 현재 도면에 연결했습니다.`);
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : "새 기관을 추가하지 못했습니다.");
    } finally { setCreatingInstitution(false); }
  }
  async function refreshRemoteLayouts() {
    setRemoteOperation("listing");
    try {
      const response = await fetch("/api/site-layouts", { method: "GET", cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || "기관 도면 목록을 불러오지 못했습니다.");
      const layouts = remoteLayoutsFromPayload(payload);
      setRemoteLayouts(layouts);
      const active = activeRemoteId ? layouts.find((layout) => layout.id === activeRemoteId) : null;
      if (active) {
        setActiveDriveSyncStatus(active.driveSyncStatus);
        setRemoteSavePhase(active.driveSyncStatus === "ready" ? "drive-ready" : active.driveSyncStatus === "error" ? "drive-error" : "drive-syncing");
        setRemoteSaveDetail(active.driveSyncStatus === "ready"
          ? "기관 DB와 Google Drive 원본 저장을 확인했습니다."
          : active.driveSyncStatus === "error"
            ? active.driveSyncError || "기관 DB 저장은 유지됐으며 Drive 저장을 다시 시도할 수 있습니다."
            : "기관 DB 최신본 · Drive 동기화 중입니다.");
      }
    } catch (error) {
      setSaveMessage(error instanceof Error ? `${error.message} 이 기기 복구본은 계속 유지됩니다.` : "기관 도면 목록을 불러오지 못했습니다. 이 기기 복구본은 계속 유지됩니다.");
    } finally {
      setRemoteOperation("idle");
    }
  }
  async function saveCurrentDraft() {
    const recovery = persistNamedRecovery();
    if (!recovery) return;
    setRemoteOperation("saving");
    setRemoteSavePhase("saving");
    setRemoteSaveDetail("기관 DB에 도면을 저장하고 있습니다.");
    setSaveMessage("기관 도면 저장소와 Google Drive에 저장하고 있습니다…");
    try {
      const pdf = await createCurrentPdf();
      const response = await fetch("/api/site-layouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(activeRemoteId ? { id: activeRemoteId } : {}),
          title: recovery.name,
          organizationName: draft.organizationName,
          businessRound: draft.businessRound,
          roomName: draft.roomName,
          draft: { schemaVersion: 3, editorDraft: recovery.draft, geometryDraft: physicalDraft },
          a3PdfBase64: await fileAsDataUrl(pdf),
          ...(activeRemoteId && activeRemoteVersion ? { baseVersion: activeRemoteVersion } : {}),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (response.status === 409) {
        const latest = normalizeRemoteLayout((payload as { layout?: unknown } | null)?.layout);
        if (latest) setRemoteLayouts((current) => [latest, ...current.filter((item) => item.id !== latest.id)]);
        setRemoteSavePhase("conflict");
        setRemoteSaveDetail("다른 사용자의 최신본을 먼저 불러온 뒤 다시 저장해 주세요.");
        setSaveMessage("다른 사용자가 먼저 수정했습니다. 내 입력은 이 기기에 보존했습니다. 기관 도면 목록에서 최신본을 불러온 뒤 다시 저장해 주세요.");
        return;
      }
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || "기관 도면 저장에 실패했습니다.");
      const saved = remoteLayoutFromPayload(payload);
      if (!saved) throw new Error("저장 결과 형식을 확인하지 못했습니다.");
      setActiveRemoteId(saved.id);
      setActiveRemoteVersion(saved.editVersion);
      setActiveRemoteFingerprint(JSON.stringify(draft));
      setActiveDriveSyncStatus(saved.driveSyncStatus);
      setActiveLocalDraftFingerprint(JSON.stringify(draft));
      setRemoteLayouts((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      window.localStorage.setItem(REMOTE_CONTEXT_KEY, JSON.stringify({ id: saved.id, editVersion: saved.editVersion, fingerprint: JSON.stringify(draft), driveSyncStatus: saved.driveSyncStatus }));
      setRemoteSavePhase("db-saved");
      if (saved.driveSyncStatus === "ready") {
        setRemoteSavePhase("drive-ready");
        setRemoteSaveDetail("기관 DB와 Google Drive 원본 저장을 모두 확인했습니다.");
      } else if (saved.driveSyncStatus === "error") {
        setRemoteSavePhase("drive-error");
        setRemoteSaveDetail(saved.driveSyncError || "기관 DB 저장은 완료됐지만 Drive 동기화를 다시 확인해야 합니다.");
      } else {
        setRemoteSavePhase("drive-syncing");
        setRemoteSaveDetail("기관 DB 저장 완료 · Google Drive 원본 동기화 중입니다.");
      }
      setSaveMessage(saved.driveSyncStatus === "ready"
        ? `“${saved.title}” 기관 도면 저장과 Google Drive 보관이 완료되었습니다.`
        : saved.driveSyncStatus === "error"
          ? `기관 도면 저장은 완료됐지만 Google Drive 동기화는 재시도가 필요합니다.${saved.driveSyncError ? ` ${saved.driveSyncError}` : ""}`
          : `“${saved.title}” 기관 도면 저장 완료 · Google Drive 동기화 중입니다.`);
      setToastMessage(saved.driveSyncStatus === "ready" ? "기관 도면과 PDF를 저장했습니다." : "기관 도면을 저장했습니다. Drive 동기화 상태를 확인해 주세요.");
    } catch (error) {
      setRemoteSavePhase("failed");
      setRemoteSaveDetail(error instanceof Error ? error.message : "기관 도면 저장 요청에 실패했습니다.");
      setSaveMessage(`${error instanceof Error ? error.message : "기관 도면 저장에 실패했습니다."} 내 입력은 이 기기 복구본에 안전하게 남아 있습니다.`);
      setToastMessage(error instanceof Error ? error.message : "기관 도면 저장에 실패했습니다.");
    } finally {
      setRemoteOperation("idle");
    }
  }
  async function retryRemoteDrive(record: RemoteLayoutSummary) {
    setRemoteOperation("retrying");
    if (activeRemoteId === record.id) {
      setRemoteSavePhase("drive-syncing");
      setRemoteSaveDetail("기관 DB의 최신 도면을 Google Drive에 다시 저장하고 있습니다.");
    }
    setSaveMessage(`“${record.title}” Google Drive 저장을 다시 시도하고 있습니다…`);
    try {
      const response = await fetch("/api/site-layouts/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || "Google Drive 저장을 다시 시도하지 못했습니다.");
      const latest = normalizeRemoteSummary((payload as { layout?: unknown } | null)?.layout);
      if (!latest) throw new Error("Google Drive 재시도 결과를 확인하지 못했습니다.");
      setRemoteLayouts((current) => [latest, ...current.filter((item) => item.id !== latest.id)]);
      if (activeRemoteId === latest.id) {
        setActiveDriveSyncStatus(latest.driveSyncStatus);
        setRemoteSavePhase(latest.driveSyncStatus === "ready" ? "drive-ready" : latest.driveSyncStatus === "error" ? "drive-error" : "drive-syncing");
        setRemoteSaveDetail(latest.driveSyncStatus === "ready" ? "기관 DB와 Google Drive 원본 저장을 모두 확인했습니다." : latest.driveSyncError || "Google Drive 동기화를 다시 확인해야 합니다.");
        window.localStorage.setItem(REMOTE_CONTEXT_KEY, JSON.stringify({ id: latest.id, editVersion: activeRemoteVersion ?? latest.editVersion, fingerprint: activeRemoteFingerprint, driveSyncStatus: latest.driveSyncStatus }));
      }
      setSaveMessage(latest.driveSyncStatus === "ready" ? `“${latest.title}” Google Drive 보관을 완료했습니다.` : `“${latest.title}” Drive 동기화 상태를 다시 확인해 주세요.`);
    } catch (error) {
      if (activeRemoteId === record.id) {
        setRemoteSavePhase("drive-error");
        setRemoteSaveDetail(error instanceof Error ? error.message : "Google Drive 저장 재시도에 실패했습니다.");
      }
      setSaveMessage(`${error instanceof Error ? error.message : "Google Drive 저장 재시도에 실패했습니다."} 기관 DB와 기기 복구본은 유지됩니다.`);
    } finally {
      setRemoteOperation("idle");
    }
  }
  async function loadRemoteDraft(record: RemoteLayoutSummary) {
    setRemoteOperation("loading");
    try {
      const response = await fetch(`/api/site-layouts?id=${encodeURIComponent(String(record.id))}`, { method: "GET", cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || "기관 도면을 불러오지 못했습니다.");
      const latest = remoteLayoutFromPayload(payload);
      if (!latest) throw new Error("기관 도면 형식을 확인하지 못했습니다.");
      const loadedDraft = cloneDraft(latest.draft);
      const mergedDraft = { ...loadedDraft, organizationName: loadedDraft.organizationName || (latest.organizationName === "기관 미지정" ? "" : latest.organizationName), businessRound: loadedDraft.businessRound || latest.businessRound, roomName: loadedDraft.roomName || latest.roomName };
      const mergedFingerprint = JSON.stringify(mergedDraft);
      setDraft(mergedDraft);
      setActiveRemoteId(latest.id);
      setActiveRemoteVersion(latest.editVersion);
      setActiveRemoteFingerprint(mergedFingerprint);
      setActiveDriveSyncStatus(latest.driveSyncStatus);
      setRemoteSavePhase(latest.driveSyncStatus === "ready" ? "drive-ready" : latest.driveSyncStatus === "error" ? "drive-error" : "drive-syncing");
      setRemoteSaveDetail(latest.driveSyncStatus === "ready" ? "기관 DB와 Google Drive 원본을 불러왔습니다." : latest.driveSyncStatus === "error" ? latest.driveSyncError || "Drive 동기화 재확인이 필요합니다." : "기관 DB 최신본 · Drive 동기화 중입니다.");
      setActiveLocalDraftId("");
      setActiveLocalDraftFingerprint(mergedFingerprint);
      setSelectedId("");
      setPendingPresetId(null);
      setActiveStepIndex(0);
      setActiveQuestionIndex(0);
      setView("model");
      setCanvasFocus(false);
      setDraftLibraryOpen(false);
      window.localStorage.setItem(REMOTE_CONTEXT_KEY, JSON.stringify({ id: latest.id, editVersion: latest.editVersion, fingerprint: mergedFingerprint, driveSyncStatus: latest.driveSyncStatus }));
      setRemoteLayouts((current) => [latest, ...current.filter((item) => item.id !== latest.id)]);
      setSaveMessage(`“${latest.title}” 기관 도면 최신본을 불러왔습니다.`);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "기관 도면을 불러오지 못했습니다.");
    } finally {
      setRemoteOperation("idle");
    }
  }
  async function deleteRemoteDraft(record: RemoteLayoutSummary) {
    if (!window.confirm(`“${record.title}” 기관 도면을 삭제할까요?`)) return;
    setRemoteOperation("deleting");
    try {
      const response = await fetch(`/api/site-layouts?id=${encodeURIComponent(String(record.id))}&baseVersion=${encodeURIComponent(String(record.editVersion))}`, { method: "DELETE" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || "기관 도면을 삭제하지 못했습니다.");
      setRemoteLayouts((current) => current.filter((item) => item.id !== record.id));
      if (activeRemoteId === record.id) {
        setActiveRemoteId(null);
        setActiveRemoteVersion(null);
        setActiveRemoteFingerprint("");
        setActiveDriveSyncStatus("");
        setRemoteSavePhase("idle");
        setRemoteSaveDetail("");
        window.localStorage.removeItem(REMOTE_CONTEXT_KEY);
      }
      setSaveMessage(`“${record.title}” 기관 도면을 삭제했습니다.`);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "기관 도면을 삭제하지 못했습니다.");
    } finally {
      setRemoteOperation("idle");
    }
  }
  function loadLocalDraft(record: StoredLocalDraft) {
    setDraft(cloneDraft(record.draft));
    setActiveLocalDraftId(record.id);
    setActiveLocalDraftFingerprint(JSON.stringify(record.draft));
    setSelectedId("");
    setPendingPresetId(null);
    setActiveStepIndex(0);
    setActiveQuestionIndex(0);
    setView("model");
    setActiveRemoteId(null);
    setActiveRemoteVersion(null);
    setActiveRemoteFingerprint("");
    setActiveDriveSyncStatus("");
    setRemoteSavePhase("idle");
    setRemoteSaveDetail("");
    window.localStorage.removeItem(REMOTE_CONTEXT_KEY);
    setSaveMessage(`“${record.name}” 기기 복구본을 새 기관 도면으로 불러왔습니다.`);
    setDraftLibraryOpen(false);
  }
  function deleteLocalDraft(record: StoredLocalDraft) {
    if (!window.confirm(`“${record.name}” 초안을 이 기기에서 삭제할까요?`)) return;
    if (!persistLocalDrafts(localDrafts.filter((item) => item.id !== record.id))) return;
    if (activeLocalDraftId === record.id) {
      setActiveLocalDraftId("");
      setActiveLocalDraftFingerprint("");
    }
    setSaveMessage(`“${record.name}” 초안을 삭제했습니다.`);
  }
  function questionNext() {
    if (["door", "window", "structure", "facility"].includes(activeStep.id) && activeQuestionIndex === 0 && !selectedStageItem) {
      setSaveMessage(`${activeStep.label} 형태를 먼저 선택하거나 ‘해당 없음’을 눌러 주세요.`);
      return;
    }
    if (activeStep.id === "checklist") {
      const question = checklistQuestions[Math.min(activeQuestionIndex, checklistQuestions.length - 1)];
      if (!checklist[question.key]) {
        setSaveMessage("현재 질문의 답을 선택해 주세요. 확실하지 않으면 재확인·현장 확인을 선택할 수 있습니다.");
        return;
      }
    }
    if (activeQuestionIndex < currentQuestionCount - 1) {
      setActiveQuestionIndex((current) => current + 1);
      return;
    }
    goNextStep();
  }
  function questionPrevious() {
    if (activeQuestionIndex > 0) {
      setActiveQuestionIndex((current) => current - 1);
      return;
    }
    if (activeStepIndex > 0) {
      goToStep(activeStepIndex - 1);
      setActiveQuestionIndex(stepQuestionCounts[guideSteps[Math.max(0, activeStepIndex - 1)].id] - 1);
    }
  }
  function wallReferenceLabels(wall: WallSide) {
    return wall === "top" || wall === "bottom" ? { start: "좌측 모서리", end: "우측 모서리" } : { start: "상단 모서리", end: "하단 모서리" };
  }
  function wallLength(item: LayoutItem) {
    return item.wall === "left" || item.wall === "right" ? draft.roomHeight : draft.roomWidth;
  }
  function displayedWallDistance(item: LayoutItem) {
    const start = item.presetId === "aircon-wall" ? (item.offset ?? item.width / 2) - item.width / 2 : item.offset ?? 0;
    return item.offsetReference === "end" ? Math.max(0, wallLength(item) - start - item.width) : Math.max(0, start);
  }
  function updateDisplayedWallDistance(value: number) {
    if (!selectedStageItem || !isWallMounted(selectedStageItem)) return;
    if (selectedStageItem.kind === "beam") {
      const wall = selectedStageItem.wall ?? "top";
      updateBeamMeasurement(selectedStageItem, wallMeasurement(wall, selectedStageItem.offsetReference ?? "start", value));
      return;
    }
    if (selectedStageItem.kind === "pillar") {
      const wall = selectedStageItem.wall ?? "top";
      updatePillarMeasurement(selectedStageItem, wallMeasurement(wall, selectedStageItem.offsetReference ?? "start", value));
      return;
    }
    if (selectedStageItem.kind === "window") {
      updateWindowMeasurement(selectedStageItem, wallMeasurement(selectedStageItem.wall ?? "top", selectedStageItem.offsetReference ?? "start", value));
      return;
    }
    const start = selectedStageItem.offsetReference === "end"
      ? Math.max(0, wallLength(selectedStageItem) - selectedStageItem.width - value)
      : Math.max(0, value);
    const canonical = selectedStageItem.presetId === "aircon-wall" ? start + selectedStageItem.width / 2 : start;
    setSelectedId(selectedStageItem.id);
    updateSelectedById(selectedStageItem.id, placeWallMountedItem(selectedStageItem, selectedStageItem.wall ?? "top", canonical));
  }
  function updateSelectedById(id: string, patch: Partial<LayoutItem>) {
    setDraft((current) => {
      const selected = current.items.find((item) => item.id === id);
      return {
        ...current,
        items: resolveWindowReferences(current.items.map((item) => item.id === id ? { ...item, ...patch } : item)),
        ...(selected ? { stageChecks: pendingStageChecks(current, selected) } : {}),
      };
    });
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
      structureAttachment: preset.kind === "beam" ? { mode: "wall", wall: "top" } : undefined,
      structureMeasurement: preset.kind === "beam" ? { axis: "x", referenceType: "wall", referenceWall: "left", direction: 1, distanceMode: "clear", distanceMm: 0 } : undefined,
    };
  }
  function wallMeasurement(wall: WallSide, reference: OffsetReference, distanceMeters: number): StructureMeasurement {
    const horizontal = wall === "top" || wall === "bottom";
    return {
      axis: horizontal ? "x" : "y",
      referenceType: "wall",
      referenceWall: horizontal ? (reference === "start" ? "left" : "right") : (reference === "start" ? "top" : "bottom"),
      direction: reference === "start" ? 1 : -1,
      distanceMode: "clear",
      distanceMm: Math.round(Math.max(0, distanceMeters) * 1000),
    };
  }
  function previousBeam(item: LayoutItem, wall = item.wall ?? "top") {
    const explicitId = item.structureMeasurement?.referenceType === "item" ? item.structureMeasurement.referenceItemId : undefined;
    const explicit = explicitId ? draft.items.find((candidate) => candidate.id === explicitId && candidate.kind === "beam") : null;
    if (explicit && (explicit.wall ?? "top") === wall) return explicit;
    const itemIndex = draft.items.findIndex((candidate) => candidate.id === item.id);
    return draft.items.slice(0, itemIndex < 0 ? draft.items.length : itemIndex).reverse().find((candidate) => candidate.kind === "beam" && (candidate.wall ?? "top") === wall) ?? null;
  }
  function previousPillar(item: LayoutItem, wall = item.wall ?? "top") {
    const explicitId = item.structureMeasurement?.referenceType === "item" ? item.structureMeasurement.referenceItemId : undefined;
    const explicit = explicitId ? draft.items.find((candidate) => candidate.id === explicitId && candidate.kind === "pillar") : null;
    if (explicit && (explicit.wall ?? "top") === wall) return explicit;
    const itemIndex = draft.items.findIndex((candidate) => candidate.id === item.id);
    return draft.items.slice(0, itemIndex < 0 ? draft.items.length : itemIndex).reverse().find((candidate) => candidate.kind === "pillar" && (candidate.wall ?? "top") === wall) ?? null;
  }
  function previousWindow(item: LayoutItem, wall = item.wall ?? "top") {
    const explicitId = item.openingMeasurement?.referenceType === "item" ? item.openingMeasurement.referenceItemId : undefined;
    const explicit = explicitId ? draft.items.find((candidate) => candidate.id === explicitId && candidate.kind === "window") : null;
    if (explicit && (explicit.wall ?? "top") === wall) return explicit;
    const itemIndex = draft.items.findIndex((candidate) => candidate.id === item.id);
    return draft.items.slice(0, itemIndex < 0 ? draft.items.length : itemIndex).reverse().find((candidate) => candidate.kind === "window" && (candidate.wall ?? "top") === wall) ?? null;
  }
  function placeBeamByMeasurement(item: LayoutItem, measurement: StructureMeasurement, reference: LayoutItem | null) {
    const wall = item.structureAttachment?.mode === "wall" ? item.structureAttachment.wall : item.wall ?? "top";
    const length = wall === "top" || wall === "bottom" ? draft.roomWidth : draft.roomHeight;
    const distance = Math.max(0, measurement.distanceMm / 1000);
    let start = 0;
    if (measurement.referenceType === "item" && reference) {
      const referenceStart = reference.offset ?? 0;
      const referenceCenter = referenceStart + reference.width / 2;
      start = measurement.direction === 1
        ? measurement.distanceMode === "center" ? referenceCenter + distance - item.width / 2 : referenceStart + reference.width + distance
        : measurement.distanceMode === "center" ? referenceCenter - distance - item.width / 2 : referenceStart - distance - item.width;
    } else if (measurement.direction === -1) {
      start = measurement.distanceMode === "center" ? length - distance - item.width / 2 : length - distance - item.width;
    } else {
      start = measurement.distanceMode === "center" ? distance - item.width / 2 : distance;
    }
    return placeWallMountedItem(item, wall, start);
  }
  function updateBeamMeasurement(item: LayoutItem, measurement: StructureMeasurement) {
    const reference = measurement.referenceType === "item"
      ? draft.items.find((candidate) => candidate.id === measurement.referenceItemId && candidate.kind === "beam") ?? null
      : null;
    const wall = item.structureAttachment?.mode === "wall" ? item.structureAttachment.wall : item.wall ?? "top";
    updateSelectedById(item.id, {
      structureAttachment: { mode: "wall", wall },
      structureMeasurement: measurement,
      beamSpacing: measurement.distanceMm / 1000,
      ...placeBeamByMeasurement(item, measurement, reference),
    });
  }
  function placePillarByMeasurement(item: LayoutItem, measurement: StructureMeasurement, reference: LayoutItem | null) {
    const wall = item.structureAttachment?.mode === "wall" ? item.structureAttachment.wall : item.wall ?? "top";
    const length = wall === "top" || wall === "bottom" ? draft.roomWidth : draft.roomHeight;
    const distance = Math.max(0, measurement.distanceMm / 1000);
    let start = 0;
    if (measurement.referenceType === "item" && reference) {
      const referenceStart = reference.offset ?? (wall === "top" || wall === "bottom" ? (reference.x / 100) * draft.roomWidth : (reference.y / 100) * draft.roomHeight);
      const referenceCenter = referenceStart + reference.width / 2;
      start = measurement.direction === 1
        ? measurement.distanceMode === "center" ? referenceCenter + distance - item.width / 2 : referenceStart + reference.width + distance
        : measurement.distanceMode === "center" ? referenceCenter - distance - item.width / 2 : referenceStart - distance - item.width;
    } else if (measurement.direction === -1) {
      start = measurement.distanceMode === "center" ? length - distance - item.width / 2 : length - distance - item.width;
    } else {
      start = measurement.distanceMode === "center" ? distance - item.width / 2 : distance;
    }
    const clampedStart = Math.min(Math.max(0, length - item.width), Math.max(0, start));
    const x = wall === "top" || wall === "bottom" ? (clampedStart / draft.roomWidth) * 100 : item.x;
    const y = wall === "left" || wall === "right" ? (clampedStart / draft.roomHeight) * 100 : item.y;
    return { ...placePillarOnWall(item, wall, x, y, draft.roomWidth, draft.roomHeight), offset: Math.round(clampedStart * 1000) / 1000 };
  }
  function updatePillarMeasurement(item: LayoutItem, measurement: StructureMeasurement) {
    const reference = measurement.referenceType === "item"
      ? draft.items.find((candidate) => candidate.id === measurement.referenceItemId && candidate.kind === "pillar") ?? null
      : null;
    const wall = item.structureAttachment?.mode === "wall" ? item.structureAttachment.wall : item.wall ?? "top";
    updateSelectedById(item.id, {
      structureAttachment: { mode: "wall", wall },
      structureMeasurement: measurement,
      ...placePillarByMeasurement(item, measurement, reference),
    });
  }
  function placeWindowByMeasurement(item: LayoutItem, measurement: OpeningMeasurement, reference: LayoutItem | null) {
    const wall = item.wall ?? "top";
    const length = wall === "top" || wall === "bottom" ? draft.roomWidth : draft.roomHeight;
    const distance = Math.max(0, measurement.distanceMm / 1000);
    let start = 0;
    if (measurement.referenceType === "item" && reference) {
      const referenceStart = reference.offset ?? 0;
      const referenceCenter = referenceStart + reference.width / 2;
      start = measurement.direction === 1
        ? measurement.distanceMode === "center" ? referenceCenter + distance - item.width / 2 : referenceStart + reference.width + distance
        : measurement.distanceMode === "center" ? referenceCenter - distance - item.width / 2 : referenceStart - distance - item.width;
    } else if (measurement.direction === -1) {
      start = measurement.distanceMode === "center" ? length - distance - item.width / 2 : length - distance - item.width;
    } else {
      start = measurement.distanceMode === "center" ? distance - item.width / 2 : distance;
    }
    return placeOpeningOnWall(item, wall, start);
  }
  function resolveWindowReferences(items: LayoutItem[]) {
    let resolved = items;
    for (let pass = 0; pass < items.length; pass += 1) {
      let changed = false;
      const byId = new Map(resolved.map((item) => [item.id, item]));
      const next = resolved.map((item) => {
        if (item.kind !== "window" || item.openingMeasurement?.referenceType !== "item") return item;
        const reference = item.openingMeasurement.referenceItemId ? byId.get(item.openingMeasurement.referenceItemId) : null;
        if (!reference || reference.kind !== "window" || (reference.wall ?? "top") !== (item.wall ?? "top")) return item;
        const placement = placeWindowByMeasurement(item, item.openingMeasurement, reference);
        if (placement.x === item.x && placement.y === item.y && placement.offset === item.offset && placement.rotation === item.rotation) return item;
        changed = true;
        return { ...item, ...placement };
      });
      resolved = next;
      if (!changed) break;
    }
    return resolved;
  }
  function updateWindowMeasurement(item: LayoutItem, measurement: OpeningMeasurement) {
    const reference = measurement.referenceType === "item"
      ? draft.items.find((candidate) => candidate.id === measurement.referenceItemId && candidate.kind === "window") ?? null
      : null;
    updateSelectedById(item.id, {
      openingMeasurement: measurement,
      offsetReference: measurement.direction === -1 ? "end" : "start",
      ...placeWindowByMeasurement(item, measurement, reference),
    });
  }
  function selectGuidedWall(item: LayoutItem, wall: WallSide) {
    setSelectedId(item.id);
    if (item.kind === "pillar") {
      const reference = previousPillar(item, wall);
      const measurement: StructureMeasurement = reference
        ? { axis: wall === "top" || wall === "bottom" ? "x" : "y", referenceType: "item", referenceItemId: reference.id, direction: 1, distanceMode: item.structureMeasurement?.distanceMode ?? "clear", distanceMm: item.structureMeasurement?.distanceMm ?? 1000 }
        : wallMeasurement(wall, item.offsetReference ?? "start", 0);
      const next = { ...item, wall, wallInset: item.wallInset ?? 0, structureAttachment: { mode: "wall" as const, wall }, structureMeasurement: measurement };
      updateSelectedById(item.id, { ...next, ...placePillarByMeasurement(next, measurement, reference) });
      return;
    }
    if (item.kind !== "beam") {
      if (item.kind === "window") {
        const reference = previousWindow(item, wall);
        const measurement: OpeningMeasurement = reference
          ? { axis: wall === "top" || wall === "bottom" ? "x" : "y", referenceType: "item", referenceItemId: reference.id, direction: 1, distanceMode: item.openingMeasurement?.distanceMode ?? "clear", distanceMm: item.openingMeasurement?.distanceMm ?? 1000 }
          : wallMeasurement(wall, item.offsetReference ?? "start", 0);
        const next = { ...item, wall, openingMeasurement: measurement };
        updateSelectedById(item.id, { ...next, ...placeWindowByMeasurement(next, measurement, reference) });
        return;
      }
      updateSelectedById(item.id, placeWallMountedItem(item, wall, item.offset ?? (item.presetId === "aircon-wall" ? item.width / 2 : 0)));
      return;
    }
    const reference = previousBeam(item, wall);
    const measurement: StructureMeasurement = reference
      ? { axis: wall === "top" || wall === "bottom" ? "x" : "y", referenceType: "item", referenceItemId: reference.id, direction: 1, distanceMode: item.structureMeasurement?.distanceMode ?? "clear", distanceMm: item.structureMeasurement?.distanceMm ?? 1000 }
      : wallMeasurement(wall, item.offsetReference ?? "start", 0);
    const next = { ...item, wall, structureAttachment: { mode: "wall" as const, wall }, structureMeasurement: measurement };
    updateSelectedById(item.id, { ...next, ...placeBeamByMeasurement(next, measurement, reference) });
  }
  function setGuidedPillarAttachment(item: LayoutItem, mode: "wall" | "free") {
    setSelectedId(item.id);
    if (mode === "free") {
      updateSelectedById(item.id, {
        wall: undefined,
        offset: undefined,
        wallInset: undefined,
        structureAttachment: { mode: "free" },
        structureMeasurement: undefined,
        freeReferenceX: item.freeReferenceX ?? "left",
        freeReferenceY: item.freeReferenceY ?? "top",
      });
      return;
    }
    selectGuidedWall({ ...item, wallInset: item.wallInset ?? 0 }, item.wall ?? "top");
  }
  function updatePillarWallInset(item: LayoutItem, rawValue: number) {
    if (item.kind !== "pillar" || item.structureAttachment?.mode !== "wall") return;
    const size = structureFootprint(item);
    const crossRoom = item.wall === "left" || item.wall === "right" ? draft.roomWidth : draft.roomHeight;
    const crossSize = item.wall === "left" || item.wall === "right" ? size.width : size.height;
    const wallInset = Math.min(Math.max(0, crossRoom - crossSize), Math.max(0, Number.isFinite(rawValue) ? rawValue : 0));
    const next = { ...item, wallInset };
    const measurement = next.structureMeasurement ?? wallMeasurement(next.wall ?? "top", next.offsetReference ?? "start", displayedWallDistance(next));
    const reference = measurement.referenceType === "item" ? previousPillar(next, next.wall ?? "top") : null;
    updateSelectedById(item.id, { wallInset, ...placePillarByMeasurement(next, measurement, reference) });
  }
  function updateFreePillarDistance(item: LayoutItem, axis: "x" | "y", reference: "left" | "right" | "top" | "bottom", rawValue: number) {
    if (item.kind !== "pillar") return;
    const size = structureFootprint(item);
    const roomSize = axis === "x" ? draft.roomWidth : draft.roomHeight;
    const objectSize = axis === "x" ? size.width : size.height;
    const distance = Math.min(Math.max(0, roomSize - objectSize), Math.max(0, Number.isFinite(rawValue) ? rawValue : 0));
    const start = reference === "right" || reference === "bottom" ? roomSize - objectSize - distance : distance;
    updateSelectedById(item.id, {
      wall: undefined,
      offset: undefined,
      structureAttachment: { mode: "free" },
      structureMeasurement: undefined,
      ...(axis === "x" ? { x: (start / draft.roomWidth) * 100, freeReferenceX: reference as "left" | "right" } : { y: (start / draft.roomHeight) * 100, freeReferenceY: reference as "top" | "bottom" }),
    });
  }
  function freePillarDistance(item: LayoutItem, axis: "x" | "y") {
    const size = structureFootprint(item);
    if (axis === "x") {
      const start = (item.x / 100) * draft.roomWidth;
      return item.freeReferenceX === "right" ? Math.max(0, draft.roomWidth - size.width - start) : Math.max(0, start);
    }
    const start = (item.y / 100) * draft.roomHeight;
    return item.freeReferenceY === "bottom" ? Math.max(0, draft.roomHeight - size.height - start) : Math.max(0, start);
  }
  function appendItem(current: LayoutDraft, item: LayoutItem) {
    return { ...current, items: [...current.items, item], stageChecks: pendingStageChecks(current, item) };
  }
  function addItem(presetId: LayoutSymbol, targetX?: number, targetY?: number) {
    const preset = itemPresets.find((item) => item.id === presetId) ?? itemPresets[0];
    const samePresetCount = draft.items.filter((item) => presetForItem(item).id === preset.id).length;
    const isWallBound = preset.kind === "door" || preset.kind === "window" || preset.kind === "beam" || preset.id === "aircon-wall";
    const wallBoundCount = draft.items.filter(isWallMounted).length;
    const startX = targetX ?? (isWallBound ? 8 + ((wallBoundCount * 16) % 76) : 18 + ((draft.items.length * 9) % 42));
    const startY = targetY ?? (isWallBound ? 0 : 22 + ((draft.items.length * 11) % 42));
    let rawItem = makeItem(presetId, startX, startY, 0, samePresetCount ? ` ${samePresetCount + 1}` : "");
    if (preset.kind === "pillar" && workflowMode === "guided") {
      const item: LayoutItem = {
        ...rawItem,
        wall: undefined,
        offset: undefined,
        offsetReference: "start",
        structureAttachment: { mode: "free" },
        structureMeasurement: undefined,
        wallInset: 0,
        freeReferenceX: "left",
        freeReferenceY: "top",
      };
      setDraft((current) => appendItem(current, item));
      setSelectedId(item.id); setPendingPresetId(null); setView("model");
      setCommand(`명령: ${preset.label} ${preset.code} 생성 완료 · 벽 부착 또는 실내 독립 배치 방식을 선택하세요.`);
      return item;
    }
    if (preset.kind === "beam") {
      const reference = [...draft.items].reverse().find((candidate) => candidate.kind === "beam" && (candidate.wall ?? "top") === "top") ?? null;
      const measurement: StructureMeasurement = reference
        ? { axis: "x", referenceType: "item", referenceItemId: reference.id, direction: 1, distanceMode: "clear", distanceMm: 1000 }
        : wallMeasurement("top", "start", 0);
      rawItem = { ...rawItem, wall: "top", offsetReference: "start", structureAttachment: { mode: "wall", wall: "top" }, structureMeasurement: measurement };
      const item = { ...rawItem, ...placeBeamByMeasurement(rawItem, measurement, reference) };
      setDraft((current) => appendItem(current, item));
      setSelectedId(item.id); setPendingPresetId(null); setView("model");
      setCommand(`명령: ${preset.label} ${preset.code} 배치 완료 · 벽과 기준거리를 입력해 위치를 확정하세요.`);
      return item;
    }
    let item = { ...rawItem, ...snapPlacement(rawItem, startX, startY) };
    if (item.kind === "pillar") {
      const placement = snapPillarPlacement(rawItem, startX, startY, draft.roomWidth, draft.roomHeight);
      const wallPlacement = placement.wall
        ? placeWallMountedItem(rawItem, placement.wall, (placement.wall === "top" || placement.wall === "bottom" ? startX / 100 * draft.roomWidth : startY / 100 * draft.roomHeight))
        : null;
      item = wallPlacement
        ? { ...rawItem, ...rebasePillarToWall(rawItem, wallPlacement) }
        : { ...rawItem, ...placement, wall: undefined, offset: undefined, structureAttachment: { mode: "free" }, structureMeasurement: undefined, freeReferenceX: "left", freeReferenceY: "top" };
    }
    if (item.kind === "window") {
      const reference = [...draft.items].reverse().find((candidate) => candidate.kind === "window" && (candidate.wall ?? "top") === (item.wall ?? "top")) ?? null;
      const measurement: OpeningMeasurement = reference
        ? { axis: item.wall === "left" || item.wall === "right" ? "y" : "x", referenceType: "item", referenceItemId: reference.id, direction: 1, distanceMode: "clear", distanceMm: 1000 }
        : wallMeasurement(item.wall ?? "top", "start", item.offset ?? 0);
      item = { ...item, openingMeasurement: measurement, ...placeWindowByMeasurement(item, measurement, reference) };
    }
    setDraft((current) => appendItem(current, item));
    setSelectedId(item.id); setPendingPresetId(null); setView("model");
    setCommand(`명령: ${preset.label} ${preset.code} 배치 완료 · 선택한 블록은 손가락으로 다시 이동할 수 있습니다.`);
    return item;
  }
  function setStageStatus(key: StageCheckKey, status: StageCheckStatus) {
    setDraft((current) => ({ ...current, stageChecks: { ...current.stageChecks, [key]: status } }));
  }
  function goToStep(index: number) {
    setActiveStepIndex(Math.min(guideSteps.length - 1, Math.max(0, index)));
    setActiveQuestionIndex(0);
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
    if (workflowMode === "guided") {
      chooseGuidedPreset(presetId);
      return;
    }
    const touchLayout = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
    if (!touchLayout) { addItem(presetId); return; }
    setPendingPresetId(presetId); setSelectedId(""); setView("model"); setActiveTool("배치");
    setCommand(`명령: ${preset.label} 선택됨 · 도면에서 놓을 위치를 터치하세요.`);
    window.requestAnimationFrame(() => boardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }
  function chooseGuidedPreset(presetId: LayoutSymbol) {
    addItem(presetId);
    setActiveQuestionIndex(1);
  }
  function addFollowupBeam(reference: LayoutItem) {
    const samePresetCount = draft.items.filter((item) => item.kind === "beam").length;
    const wall = reference.wall ?? "top";
    const measurement: StructureMeasurement = {
      axis: wall === "top" || wall === "bottom" ? "x" : "y",
      referenceType: "item",
      referenceItemId: reference.id,
      direction: 1,
      distanceMode: "clear",
      distanceMm: 1000,
    };
    const raw = {
      ...makeItem("beam", 0, 0, wall === "left" || wall === "right" ? 90 : 0, samePresetCount ? ` ${samePresetCount + 1}` : ""),
      wall,
      offsetReference: "start" as const,
      structureAttachment: { mode: "wall" as const, wall },
      structureMeasurement: measurement,
    };
    const item = { ...raw, ...placeBeamByMeasurement(raw, measurement, reference) };
    setDraft((current) => appendItem(current, item));
    setSelectedId(item.id);
    setActiveQuestionIndex(2);
    setSaveMessage(`${reference.name} 다음 위치의 보를 추가했습니다. 면 사이 또는 중심 사이 거리를 입력해 주세요.`);
  }
  function addFollowupPillar(reference: LayoutItem) {
    const samePresetCount = draft.items.filter((item) => item.kind === "pillar").length;
    const presetId: LayoutSymbol = reference.presetId === "pillar-round" ? "pillar-round" : "pillar";
    if (reference.structureAttachment?.mode !== "wall") {
      const size = structureFootprint(reference);
      const raw = {
        ...makeItem(presetId, reference.x, reference.y, reference.rotation, samePresetCount ? ` ${samePresetCount + 1}` : ""),
        structureAttachment: { mode: "free" as const },
        freeReferenceX: reference.freeReferenceX ?? "left" as const,
        freeReferenceY: reference.freeReferenceY ?? "top" as const,
      };
      const nextStart = Math.min(Math.max(0, draft.roomWidth - structureFootprint(raw).width), (reference.x / 100) * draft.roomWidth + size.width + 1);
      const item = { ...raw, x: (nextStart / draft.roomWidth) * 100 };
      setDraft((current) => appendItem(current, item));
      setSelectedId(item.id);
      setActiveQuestionIndex(2);
      setSaveMessage(`${reference.name} 다음 독립 기둥을 추가했습니다. 좌·우벽과 상·하벽 중 현장에서 잰 기준을 골라 면 거리 두 축을 입력해 주세요.`);
      return;
    }
    const wall = reference.wall ?? "top";
    const measurement: StructureMeasurement = {
      axis: wall === "top" || wall === "bottom" ? "x" : "y",
      referenceType: "item",
      referenceItemId: reference.id,
      direction: 1,
      distanceMode: "clear",
      distanceMm: 1000,
    };
    const raw = {
      ...makeItem(presetId, 0, 0, wall === "left" || wall === "right" ? 90 : 0, samePresetCount ? ` ${samePresetCount + 1}` : ""),
      wall,
      offsetReference: "start" as const,
      structureAttachment: { mode: "wall" as const, wall },
      structureMeasurement: measurement,
      wallInset: reference.wallInset ?? 0,
    };
    const item = { ...raw, ...placePillarByMeasurement(raw, measurement, reference) };
    setDraft((current) => appendItem(current, item));
    setSelectedId(item.id);
    setActiveQuestionIndex(2);
    setSaveMessage(`${reference.name} 다음 기둥을 추가했습니다. 이전 기둥 끝면부터 이번 기둥 시작면까지 거리를 입력해 주세요.`);
  }
  function addFollowupWindow(reference: LayoutItem) {
    const samePresetCount = draft.items.filter((item) => item.kind === "window").length;
    const wall = reference.wall ?? "top";
    const measurement: OpeningMeasurement = {
      axis: wall === "top" || wall === "bottom" ? "x" : "y",
      referenceType: "item",
      referenceItemId: reference.id,
      direction: 1,
      distanceMode: "clear",
      distanceMm: 1000,
    };
    const presetId: LayoutSymbol = reference.presetId?.startsWith("window-")
      ? reference.presetId
      : "window-sliding-2";
    const raw = {
      ...makeItem(presetId, 0, 0, wall === "left" || wall === "right" ? 90 : 0, samePresetCount ? ` ${samePresetCount + 1}` : ""),
      wall,
      offsetReference: "start" as const,
      openingMeasurement: measurement,
    };
    const item = { ...raw, ...placeWindowByMeasurement(raw, measurement, reference) };
    setDraft((current) => appendItem(current, item));
    setSelectedId(item.id);
    setActiveQuestionIndex(2);
    setSaveMessage(`${reference.name} 다음 창호를 추가했습니다. 창호 사이 거리 또는 중심 간 거리를 입력해 주세요.`);
  }
  function skipGuidedStage() {
    if (activeStep.id === "room" || activeStep.id === "checklist" || activeStep.id === "review") return;
    setStageStatus(activeStep.id, "none");
    goToStep(activeStepIndex + 1);
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
    const point = modelPointFromClient(event, bounds, geometryViewBox);
    addItem(presetId, (point.xMm / physicalDraft.roomWidthMm) * 100, (point.yMm / physicalDraft.roomHeightMm) * 100);
  }
  function startGeometryDrag(item: SiteLayoutItemMm, point: { xMm: number; yMm: number }, event: ReactPointerEvent<SVGGElement>) {
    if (event.button !== 0) return;
    const legacyItem = draft.items.find((candidate) => candidate.id === item.id);
    if (!legacyItem) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: item.id, pointerId: event.pointerId, startModelX: point.xMm, startModelY: point.yMm, startX: legacyItem.x, startY: legacyItem.y };
    setSelectedId(item.id); setActiveTool("이동");
  }
  function isWallMounted(item: LayoutItem) {
    return item.kind === "door"
      || item.kind === "window"
      || item.kind === "beam"
      || (item.kind === "pillar" && item.structureAttachment?.mode === "wall")
      || item.presetId === "aircon-wall";
  }
  function placeWallMountedItem(item: LayoutItem, wall: WallSide, rawOffset: number) {
    const wallLength = wall === "top" || wall === "bottom" ? draft.roomWidth : draft.roomHeight;
    const requested = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
    const centerBased = item.presetId === "aircon-wall";
    const offset = centerBased
      ? Math.min(Math.max(item.width / 2, requested), Math.max(item.width / 2, wallLength - item.width / 2))
      : Math.min(Math.max(0, wallLength - item.width), requested);
    const roundedOffset = Math.round(offset * 1000) / 1000;
    const start = centerBased ? roundedOffset - item.width / 2 : roundedOffset;
    const percent = Math.round(((start / wallLength) * 100) * 1000) / 1000;
    const wallThickness = draft.roomWallThickness ?? 0.15;
    const crossDepth = item.kind === "door" || item.kind === "window" ? openingPlanDepthMeters(item, wallThickness) : item.height;
    const topCross = item.kind === "door" || item.kind === "window" ? -((wallThickness + crossDepth) / 2 / draft.roomHeight) * 100 : 0;
    const bottomCross = item.kind === "door" || item.kind === "window"
      ? 100 + ((wallThickness - crossDepth) / 2 / draft.roomHeight) * 100
      : 100 - (crossDepth / draft.roomHeight) * 100;
    const leftCross = item.kind === "door" || item.kind === "window" ? -((wallThickness + crossDepth) / 2 / draft.roomWidth) * 100 : 0;
    const rightCross = item.kind === "door" || item.kind === "window"
      ? 100 + ((wallThickness - crossDepth) / 2 / draft.roomWidth) * 100
      : 100 - (crossDepth / draft.roomWidth) * 100;
    return wall === "top" ? { wall, offset: roundedOffset, x: percent, y: topCross, rotation: 0 as const }
      : wall === "bottom" ? { wall, offset: roundedOffset, x: percent, y: bottomCross, rotation: 0 as const }
        : wall === "left" ? { wall, offset: roundedOffset, x: leftCross, y: percent, rotation: 90 as const }
          : { wall, offset: roundedOffset, x: rightCross, y: percent, rotation: 90 as const };
  }
  function placeOpeningOnWall(item: LayoutItem, wall: WallSide, rawOffset: number) {
    return placeWallMountedItem(item, wall, rawOffset);
  }
  function rebaseBeamToWall(item: LayoutItem, placement: ReturnType<typeof placeWallMountedItem>) {
    if (item.kind !== "beam") return placement;
    const measurement = wallMeasurement(placement.wall, "start", placement.offset);
    return {
      ...placement,
      offsetReference: "start" as const,
      structureAttachment: { mode: "wall" as const, wall: placement.wall },
      structureMeasurement: measurement,
      beamSpacing: measurement.distanceMm / 1000,
    };
  }
  function rebasePillarToWall(item: LayoutItem, placement: ReturnType<typeof placeWallMountedItem>) {
    if (item.kind !== "pillar") return placement;
    const measurement = wallMeasurement(placement.wall, "start", placement.offset);
    return {
      ...placement,
      ...placePillarOnWall(item, placement.wall, placement.x, placement.y, draft.roomWidth, draft.roomHeight),
      offsetReference: "start" as const,
      structureAttachment: { mode: "wall" as const, wall: placement.wall },
      structureMeasurement: measurement,
    };
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
    if (selectedItem.kind === "beam") {
      const reference = previousBeam(selectedItem, wall);
      const measurement: StructureMeasurement = reference
        ? { axis: wall === "top" || wall === "bottom" ? "x" : "y", referenceType: "item", referenceItemId: reference.id, direction: 1, distanceMode: selectedItem.structureMeasurement?.distanceMode ?? "clear", distanceMm: selectedItem.structureMeasurement?.distanceMm ?? 1000 }
        : wallMeasurement(wall, selectedItem.offsetReference ?? "start", 0);
      const next = { ...selectedItem, wall, structureAttachment: { mode: "wall" as const, wall }, structureMeasurement: measurement };
      updateSelected({ ...next, ...placeBeamByMeasurement(next, measurement, reference) });
      return;
    }
    if (selectedItem.kind === "pillar") {
      const reference = previousPillar(selectedItem, wall);
      const measurement: StructureMeasurement = reference
        ? { axis: wall === "top" || wall === "bottom" ? "x" : "y", referenceType: "item", referenceItemId: reference.id, direction: 1, distanceMode: selectedItem.structureMeasurement?.distanceMode ?? "clear", distanceMm: selectedItem.structureMeasurement?.distanceMm ?? 1000 }
        : wallMeasurement(wall, selectedItem.offsetReference ?? "start", 0);
      const next = { ...selectedItem, wall, structureAttachment: { mode: "wall" as const, wall }, structureMeasurement: measurement };
      updateSelected({ ...next, ...placePillarByMeasurement(next, measurement, reference) });
      return;
    }
    if (selectedItem.kind === "window") {
      const reference = previousWindow(selectedItem, wall);
      const measurement: OpeningMeasurement = reference
        ? { axis: wall === "top" || wall === "bottom" ? "x" : "y", referenceType: "item", referenceItemId: reference.id, direction: 1, distanceMode: selectedItem.openingMeasurement?.distanceMode ?? "clear", distanceMm: selectedItem.openingMeasurement?.distanceMm ?? 1000 }
        : wallMeasurement(wall, selectedItem.offsetReference ?? "start", 0);
      const next = { ...selectedItem, wall, openingMeasurement: measurement };
      updateSelected({ ...next, ...placeWindowByMeasurement(next, measurement, reference) });
      return;
    }
    const placement = selectedItem.kind === "door" ? placeOpeningOnWall : placeWallMountedItem;
    updateSelected(placement(selectedItem, wall, selectedItem.offset ?? (selectedItem.presetId === "aircon-wall" ? selectedItem.width / 2 : 0)));
  }
  function updateWallMountedOffset(value: number) {
    if (!selectedItem || !isWallMounted(selectedItem)) return;
    if (selectedItem.kind === "pillar") {
      updatePillarMeasurement(selectedItem, wallMeasurement(selectedItem.wall ?? "top", "start", value));
      return;
    }
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
  function faceDistance(item: LayoutItem, axis: "x" | "y") {
    const roomSize = axis === "x" ? draft.roomWidth : draft.roomHeight;
    const startPercent = axis === "x" ? item.x : item.y;
    return Math.round(((startPercent / 100) * roomSize) * 1000) / 1000;
  }
  function updateFaceDistance(axis: "x" | "y", rawValue: number) {
    if (!selectedItem || isWallMounted(selectedItem)) return;
    const roomSize = axis === "x" ? draft.roomWidth : draft.roomHeight;
    const next = snapGrid((Math.max(0, Number.isFinite(rawValue) ? rawValue : 0) / roomSize) * 100);
    const nextX = axis === "x" ? next : selectedItem.x;
    const nextY = axis === "y" ? next : selectedItem.y;
    updateSelected(selectedItem.kind === "pillar" ? snapPillarPlacement(selectedItem, nextX, nextY, draft.roomWidth, draft.roomHeight) : axis === "x" ? { x: next } : { y: next });
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
    if (selectedItem.kind === "beam") {
      const next = { ...selectedItem, [axis]: value };
      const measurement = next.structureMeasurement ?? wallMeasurement(next.wall ?? "top", next.offsetReference ?? "start", displayedWallDistance(next));
      const reference = measurement.referenceType === "item" ? previousBeam(next, next.wall ?? "top") : null;
      updateSelected({ [axis]: value, ...placeBeamByMeasurement(next, measurement, reference) });
      return;
    }
    if (selectedItem.kind === "pillar" && selectedItem.structureAttachment?.mode === "wall") {
      const next = { ...selectedItem, [axis]: value };
      const measurement = next.structureMeasurement ?? wallMeasurement(next.wall ?? "top", next.offsetReference ?? "start", displayedWallDistance(next));
      const reference = measurement.referenceType === "item" ? previousPillar(next, next.wall ?? "top") : null;
      updateSelected({ [axis]: value, ...placePillarByMeasurement(next, measurement, reference) });
      return;
    }
    if (selectedItem.kind === "pillar") {
      const distanceX = freePillarDistance(selectedItem, "x");
      const distanceY = freePillarDistance(selectedItem, "y");
      const next = { ...selectedItem, [axis]: value };
      const size = structureFootprint(next);
      const startX = next.freeReferenceX === "right" ? draft.roomWidth - size.width - distanceX : distanceX;
      const startY = next.freeReferenceY === "bottom" ? draft.roomHeight - size.height - distanceY : distanceY;
      updateSelected({
        [axis]: value,
        x: (Math.max(0, startX) / draft.roomWidth) * 100,
        y: (Math.max(0, startY) / draft.roomHeight) * 100,
      });
      return;
    }
    if (axis === "width" && isWallMounted(selectedItem)) {
      const next = { ...selectedItem, width: value };
      updateSelected({ width: value, ...placeWallMountedItem(next, next.wall ?? "top", next.offset ?? (next.presetId === "aircon-wall" ? value / 2 : 0)) });
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
    if (next.kind === "window" && next.openingMeasurement) {
      const reference = next.openingMeasurement.referenceType === "item" ? previousWindow(next, wall) : null;
      updateSelected({ width, ...placeWindowByMeasurement(next, next.openingMeasurement, reference) });
      return;
    }
    updateSelected({ width, ...placeOpeningOnWall(next, wall, next.offset ?? 0) });
  }
  function updateOpeningHeight(value: number) {
    if (!selectedItem || (selectedItem.kind !== "door" && selectedItem.kind !== "window")) return;
    const sill = selectedItem.kind === "window" ? selectedItem.sillHeight ?? 0.9 : 0;
    updateSelected({ openingHeight: Math.min(Math.max(0.3, value), Math.max(0.3, ceilingHeight - sill)) });
  }
  function updateOpeningOffset(value: number) {
    if (!selectedItem || (selectedItem.kind !== "door" && selectedItem.kind !== "window")) return;
    if (selectedItem.kind === "window") {
      updateWindowMeasurement(selectedItem, wallMeasurement(selectedItem.wall ?? "top", "start", value));
      return;
    }
    updateSelected(placeOpeningOnWall(selectedItem, selectedItem.wall ?? "top", value));
  }
  function updateWindowSill(value: number) {
    if (!selectedItem || selectedItem.kind !== "window") return;
    const openingHeight = selectedItem.openingHeight ?? 1.5;
    updateSelected({ sillHeight: Math.min(Math.max(0, value), Math.max(0, ceilingHeight - openingHeight)) });
  }
  function moveGeometryDrag(point: { xMm: number; yMm: number }, pointerId: number) {
    const active = dragRef.current;
    if (!active || active.pointerId !== pointerId) return;
    const nextX = active.startX + ((point.xMm - active.startModelX) / physicalDraft.roomWidthMm) * 100;
    const nextY = active.startY + ((point.yMm - active.startModelY) / physicalDraft.roomHeightMm) * 100;
    setDraft((current) => {
      const moved: LayoutItem[] = current.items.map((item): LayoutItem => {
        if (item.id !== active.id) return item;
        const placement = snapPlacement(item, nextX, nextY);
        if (item.kind === "window" && "wall" in placement && isWallSide(placement.wall) && "offset" in placement && typeof placement.offset === "number") {
          const openingMeasurement = wallMeasurement(placement.wall, "start", placement.offset);
          return { ...item, ...placeOpeningOnWall(item, placement.wall, placement.offset), openingMeasurement, offsetReference: "start" as const };
        }
        return {
          ...item,
          ...(item.kind === "beam"
            ? rebaseBeamToWall(item, placement as ReturnType<typeof placeWallMountedItem>)
            : item.kind === "pillar" && "wall" in placement && isWallSide(placement.wall)
              ? rebasePillarToWall(item, placeWallMountedItem(item, placement.wall, (placement.wall === "top" || placement.wall === "bottom" ? nextX / 100 * current.roomWidth : nextY / 100 * current.roomHeight)))
              : item.kind === "pillar"
                ? { ...placement, wall: undefined, offset: undefined, structureAttachment: { mode: "free" as const }, structureMeasurement: undefined, freeReferenceX: item.freeReferenceX ?? "left" as const, freeReferenceY: item.freeReferenceY ?? "top" as const }
                : placement),
        };
      });
      const selected = current.items.find((item) => item.id === active.id);
      return { ...current, items: resolveWindowReferences(moved), ...(selected ? { stageChecks: pendingStageChecks(current, selected) } : {}) };
    });
  }
  function finishGeometryDrag(pointerId: number) {
    const active = dragRef.current;
    if (!active || active.pointerId !== pointerId) return;
    setDraft((current) => {
      const finished = current.items.map((item) => {
        if (item.id !== active.id) return item;
        if (item.kind === "beam") {
          const placement = placeWallMountedItem(item, item.wall ?? "top", item.offset ?? 0);
          return { ...item, ...rebaseBeamToWall(item, placement) };
        }
        if (item.kind === "pillar" && item.structureAttachment?.mode === "wall" && item.wall) {
          const placement = placeWallMountedItem(item, item.wall, item.offset ?? 0);
          return { ...item, ...rebasePillarToWall(item, placement) };
        }
        if (item.kind === "window") {
          const wall = item.wall ?? "top";
          const measurement = wallMeasurement(wall, "start", item.offset ?? 0);
          return { ...item, openingMeasurement: measurement, offsetReference: "start" as const, ...placeOpeningOnWall(item, wall, item.offset ?? 0) };
        }
        return item;
      });
      const selected = current.items.find((item) => item.id === active.id);
      return { ...current, items: resolveWindowReferences(finished), ...(selected ? { stageChecks: pendingStageChecks(current, selected) } : {}) };
    });
    dragRef.current = null; setActiveTool("선택"); setCommand("명령: 객체 이동 완료 · 고정 시설은 기준거리 입력으로 정밀 보정할 수 있습니다.");
  }
  function duplicateGuidedItem(item: LayoutItem) {
    if (item.kind === "beam") { addFollowupBeam(item); return; }
    if (item.kind === "pillar") { addFollowupPillar(item); return; }
    if (item.kind === "window") { addFollowupWindow(item); return; }
    const copyBase: LayoutItem = { ...item, id: crypto.randomUUID(), name: `${item.name} 복사` };
    const placement = isWallMounted(item)
      ? placeWallMountedItem(copyBase, item.wall ?? "top", (item.offset ?? 0) + item.width + 0.2)
      : snapPlacement(copyBase, clampPercent(item.x + 4), clampPercent(item.y + 4));
    const copy = { ...copyBase, ...placement };
    setDraft((current) => appendItem(current, copy));
    setSelectedId(copy.id);
    setActiveQuestionIndex(2);
    setSaveMessage(`${item.name}을 복사했습니다. 새 객체의 기준거리와 치수를 확인해 주세요.`);
  }
  function editGuidedItem(item: LayoutItem) {
    const group = presetForItem(item).group;
    const stepIndex = guideSteps.findIndex((step) => step.groups.includes(group));
    if (stepIndex >= 0) setActiveStepIndex(stepIndex);
    setSelectedId(item.id);
    setActiveQuestionIndex(1);
    setView("model");
    window.requestAnimationFrame(() => boardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }
  function measuredFromReference(subject: LayoutItem, reference: LayoutItem, measurement: StructureMeasurement): StructureMeasurement {
    const horizontal = measurement.axis === "x";
    const subjectStart = subject.offset ?? ((horizontal ? subject.x / 100 * draft.roomWidth : subject.y / 100 * draft.roomHeight));
    const referenceStart = reference.offset ?? ((horizontal ? reference.x / 100 * draft.roomWidth : reference.y / 100 * draft.roomHeight));
    const subjectCenter = subjectStart + subject.width / 2;
    const referenceCenter = referenceStart + reference.width / 2;
    const direction: 1 | -1 = subjectCenter >= referenceCenter ? 1 : -1;
    const distanceMeters = measurement.distanceMode === "center"
      ? Math.abs(subjectCenter - referenceCenter)
      : direction === 1
        ? Math.max(0, subjectStart - referenceStart - reference.width)
        : Math.max(0, referenceStart - subjectStart - subject.width);
    return { ...measurement, referenceType: "item", referenceItemId: reference.id, direction, distanceMm: Math.round(distanceMeters * 1000) };
  }
  function rebaseReferencesAfterDeletion(items: LayoutItem[], deleted: LayoutItem) {
    const remaining = items.filter((item) => item.id !== deleted.id);
    const deletedIndex = items.findIndex((item) => item.id === deleted.id);
    return remaining.map((item) => {
      const structureDependsOnDeleted = item.structureMeasurement?.referenceType === "item" && item.structureMeasurement.referenceItemId === deleted.id;
      const openingDependsOnDeleted = item.openingMeasurement?.referenceType === "item" && item.openingMeasurement.referenceItemId === deleted.id;
      if (!structureDependsOnDeleted && !openingDependsOnDeleted) return item;
      const subjectIndex = items.findIndex((candidate) => candidate.id === item.id);
      const sameWallAndKind = (candidate: LayoutItem) => candidate.id !== deleted.id && candidate.id !== item.id && candidate.kind === item.kind && (candidate.wall ?? "top") === (item.wall ?? "top");
      const deletedParentId = deleted.kind === "window" ? deleted.openingMeasurement?.referenceItemId : deleted.structureMeasurement?.referenceItemId;
      const directParent = deletedParentId ? remaining.find((candidate) => candidate.id === deletedParentId && sameWallAndKind(candidate)) ?? null : null;
      const earlier = items.slice(0, Math.max(deletedIndex, subjectIndex)).reverse().find((candidate) => remaining.some((entry) => entry.id === candidate.id) && sameWallAndKind(candidate)) ?? null;
      const fallback = directParent ?? earlier;
      if (structureDependsOnDeleted && item.structureMeasurement) {
        const structureMeasurement = fallback
          ? measuredFromReference(item, fallback, item.structureMeasurement)
          : wallMeasurement(item.wall ?? "top", item.offsetReference ?? "start", displayedWallDistance(item));
        return { ...item, structureMeasurement };
      }
      if (openingDependsOnDeleted && item.openingMeasurement) {
        const openingMeasurement = fallback
          ? measuredFromReference(item, fallback, item.openingMeasurement)
          : wallMeasurement(item.wall ?? "top", item.offsetReference ?? "start", displayedWallDistance(item));
        return { ...item, openingMeasurement };
      }
      return item;
    });
  }
  function removeItemById(id: string) {
    const deleted = draft.items.find((item) => item.id === id);
    if (!deleted) return;
    const nextItems = resolveWindowReferences(rebaseReferencesAfterDeletion(draft.items, deleted));
    setDraft((current) => ({ ...current, items: nextItems, stageChecks: pendingStageChecks(current, deleted) }));
    if (selectedId === id) setSelectedId("");
    setCommand("명령: 객체를 삭제하고 연결된 연속 치수 기준을 안전하게 다시 설정했습니다.");
  }
  function removeAllItems() {
    if (!draft.items.length || !window.confirm("도면에 등록한 모든 객체를 삭제할까요? 공간 크기와 현장 조건은 유지됩니다.")) return;
    setDraft((current) => ({
      ...current,
      items: [],
      stageChecks: { ...current.stageChecks, door: "pending", window: "pending", structure: "pending", facility: "pending" },
    }));
    setSelectedId("");
    setActiveQuestionIndex(0);
    setCommand("명령: 공간 크기와 현장 조건을 남기고 모든 객체를 삭제했습니다.");
  }
  function duplicateSelected() {
    if (!selectedItem) return;
    const baseCopy = { ...selectedItem, id: crypto.randomUUID(), name: `${selectedItem.name} 복사` };
    let copy: LayoutItem;
    if (selectedItem.kind === "beam") {
      const wall = selectedItem.wall ?? "top";
      const length = wall === "top" || wall === "bottom" ? draft.roomWidth : draft.roomHeight;
      const gap = 0.2;
      const afterFits = (selectedItem.offset ?? 0) + selectedItem.width + gap + baseCopy.width <= length;
      const beforeFits = (selectedItem.offset ?? 0) - gap - baseCopy.width >= 0;
      if (afterFits || beforeFits) {
        const measurement: StructureMeasurement = {
          axis: wall === "top" || wall === "bottom" ? "x" : "y",
          referenceType: "item",
          referenceItemId: selectedItem.id,
          direction: afterFits ? 1 : -1,
          distanceMode: "clear",
          distanceMm: Math.round(gap * 1000),
        };
        const measuredCopy = { ...baseCopy, wall, structureAttachment: { mode: "wall" as const, wall }, structureMeasurement: measurement, beamSpacing: gap };
        copy = { ...measuredCopy, ...placeBeamByMeasurement(measuredCopy, measurement, selectedItem) };
      } else {
        const oppositeWall: WallSide = wall === "top" ? "bottom" : wall === "bottom" ? "top" : wall === "left" ? "right" : "left";
        const offset = Math.min(Math.max(0, selectedItem.offset ?? 0), Math.max(0, length - baseCopy.width));
        const measurement = wallMeasurement(oppositeWall, "start", offset);
        const measuredCopy = { ...baseCopy, wall: oppositeWall, structureAttachment: { mode: "wall" as const, wall: oppositeWall }, structureMeasurement: measurement, beamSpacing: offset };
        copy = { ...measuredCopy, ...placeBeamByMeasurement(measuredCopy, measurement, null) };
      }
    } else if (selectedItem.kind === "pillar" && selectedItem.structureAttachment?.mode === "wall") {
      const wall = selectedItem.wall ?? "top";
      const measurement: StructureMeasurement = {
        axis: wall === "top" || wall === "bottom" ? "x" : "y",
        referenceType: "item",
        referenceItemId: selectedItem.id,
        direction: 1,
        distanceMode: "clear",
        distanceMm: 200,
      };
      const measuredCopy = { ...baseCopy, wall, structureAttachment: { mode: "wall" as const, wall }, structureMeasurement: measurement };
      copy = { ...measuredCopy, ...placePillarByMeasurement(measuredCopy, measurement, selectedItem) };
    } else if (selectedItem.kind === "window") {
      const wall = selectedItem.wall ?? "top";
      const measurement: OpeningMeasurement = {
        axis: wall === "top" || wall === "bottom" ? "x" : "y",
        referenceType: "item",
        referenceItemId: selectedItem.id,
        direction: 1,
        distanceMode: "clear",
        distanceMm: 200,
      };
      const measuredCopy = { ...baseCopy, wall, openingMeasurement: measurement };
      copy = { ...measuredCopy, ...placeWindowByMeasurement(measuredCopy, measurement, selectedItem) };
    } else {
      const placement = isWallMounted(selectedItem)
        ? placeWallMountedItem(baseCopy, selectedItem.wall ?? "top", (selectedItem.offset ?? 0) + selectedItem.width + 0.2)
        : snapPlacement(baseCopy, clampPercent(selectedItem.x + 4), clampPercent(selectedItem.y + 4));
      copy = { ...baseCopy, ...placement };
    }
    setDraft((current) => appendItem(current, copy)); setSelectedId(copy.id);
  }
  function removeSelected() {
    if (!selectedId) return;
    removeItemById(selectedId);
  }
  function updateStageItemDimension(item: LayoutItem, axis: "width" | "height", rawValue: number) {
    const value = positiveDimension(rawValue, item[axis]);
    const sized = item.presetId === "aircon-ceiling" ? { ...item, width: value, height: value } : { ...item, [axis]: value };
    const beamMeasurement = sized.kind === "beam" ? sized.structureMeasurement ?? wallMeasurement(sized.wall ?? "top", sized.offsetReference ?? "start", displayedWallDistance(sized)) : null;
    const pillarMeasurement = sized.kind === "pillar" && sized.structureAttachment?.mode === "wall"
      ? sized.structureMeasurement ?? wallMeasurement(sized.wall ?? "top", sized.offsetReference ?? "start", displayedWallDistance(sized))
      : null;
    const placement = sized.kind === "beam" && beamMeasurement
      ? placeBeamByMeasurement(sized, beamMeasurement, beamMeasurement.referenceType === "item" ? previousBeam(sized, sized.wall ?? "top") : null)
      : sized.kind === "pillar" && pillarMeasurement
        ? placePillarByMeasurement(sized, pillarMeasurement, pillarMeasurement.referenceType === "item" ? previousPillar(sized, sized.wall ?? "top") : null)
      : sized.kind === "window" && sized.openingMeasurement
        ? placeWindowByMeasurement(sized, sized.openingMeasurement, sized.openingMeasurement.referenceType === "item" ? previousWindow(sized, sized.wall ?? "top") : null)
      : isWallMounted(sized)
      ? placeWallMountedItem(sized, sized.wall ?? "top", sized.offset ?? (sized.presetId === "aircon-wall" ? sized.width / 2 : 0))
      : sized.kind === "pillar"
        ? sized.wall
          ? placePillarOnWall(sized, sized.wall, sized.x, sized.y, draft.roomWidth, draft.roomHeight)
          : {
            x: (Math.max(0, sized.freeReferenceX === "right" ? draft.roomWidth - structureFootprint(sized).width - freePillarDistance(item, "x") : freePillarDistance(item, "x")) / draft.roomWidth) * 100,
            y: (Math.max(0, sized.freeReferenceY === "bottom" ? draft.roomHeight - structureFootprint(sized).height - freePillarDistance(item, "y") : freePillarDistance(item, "y")) / draft.roomHeight) * 100,
          }
        : {};
    updateSelectedById(item.id, { ...sized, ...placement });
  }
  function updateBeamDistanceFromInspector(item: LayoutItem, rawValue: number) {
    const value = Math.max(0, Number.isFinite(rawValue) ? rawValue : 0);
    const measurement = item.structureMeasurement
      ?? wallMeasurement(item.wall ?? "top", item.offsetReference ?? "start", displayedWallDistance(item));
    updateBeamMeasurement(item, { ...measurement, distanceMm: Math.round(value * 1000) });
  }
  function updatePillarDistanceFromInspector(item: LayoutItem, rawValue: number) {
    const value = Math.max(0, Number.isFinite(rawValue) ? rawValue : 0);
    const measurement = item.structureMeasurement
      ?? wallMeasurement(item.wall ?? "top", item.offsetReference ?? "start", displayedWallDistance(item));
    updatePillarMeasurement(item, { ...measurement, distanceMm: Math.round(value * 1000) });
  }
  function renderGuidedQuestion() {
    if (activeStep.id === "room") {
      const roomQuestions = [
        <label key="room-name"><span>이 공간을 구분할 이름을 적어 주세요.</span><input autoFocus value={draft.roomName} onChange={(event) => updateDraft({ roomName: event.target.value.slice(0, 80) })} placeholder="예: 본관 2층 스마트 체험교실" /></label>,
        <label key="room-width"><span>실내 가로 길이는 몇 m인가요?</span><FriendlyNumberInput label="실내 가로 길이(m)" value={draft.roomWidth} min={0.1} max={100} onCommit={(value) => updateDraft({ roomWidth: positiveDimension(value, draft.roomWidth) })} /></label>,
        <label key="room-height"><span>실내 세로 길이는 몇 m인가요?</span><FriendlyNumberInput label="실내 세로 길이(m)" value={draft.roomHeight} min={0.1} max={100} onCommit={(value) => updateDraft({ roomHeight: positiveDimension(value, draft.roomHeight) })} /></label>,
        <label key="room-ceiling"><span>바닥부터 천장까지 높이는 몇 m인가요?</span><FriendlyNumberInput label="천장 높이(m)" value={ceilingHeight} min={0.3} max={20} onCommit={(value) => updateDraft({ roomCeilingHeight: positiveDimension(value, ceilingHeight) })} /></label>,
      ];
      return <div className="site-layout-question-card"><div className="site-layout-question-heading"><small>공간 {currentQuestionNumber}/{currentQuestionCount}</small><b>{["실 이름", "가로 실측", "세로 실측", "천장 높이"][activeQuestionIndex]}</b></div>{roomQuestions[activeQuestionIndex]}</div>;
    }
    if (activeStep.id === "checklist") {
      const question = checklistQuestions[Math.min(activeQuestionIndex, checklistQuestions.length - 1)];
      const currentValue = String(checklist[question.key] ?? "");
      return <div className="site-layout-question-card"><div className="site-layout-question-heading"><small>현장 조건 {currentQuestionNumber}/{currentQuestionCount}</small><b>{question.title}</b><span>{question.help}</span></div><div className="site-layout-choice-grid">{question.options.map((option) => <button key={option.value} type="button" className={currentValue === option.value ? "active" : ""} onClick={() => updateChecklist(question.key, option.value as never)}>{option.label}</button>)}</div>{activeQuestionIndex === checklistQuestions.length - 1 && <label className="site-layout-question-notes"><span>마지막으로 CAD팀 전달 메모를 적어 주세요.</span><textarea value={draft.fieldNotes ?? ""} onChange={(event) => updateDraft({ fieldNotes: event.target.value.slice(0, 1000) })} placeholder="보 사이 거리, 에어컨 간섭, 반입 동선 등 특이사항" /></label>}</div>;
    }
    if (activeStep.id === "review") {
      return <div className="site-layout-question-card site-layout-question-review"><div className="site-layout-question-heading"><small>최종 검수</small><b>{hasReviewProblems ? "확인하지 않은 항목을 점검해 주세요." : "CAD팀 전달용 초안이 준비되었습니다."}</b><span>기관 도면으로 저장하면 승인된 사용자가 함께 보고 Google Drive 버전으로 보관됩니다.</span></div>{geometryIssues.length > 0 && <ul>{geometryIssues.map((issue, index) => <li key={`${issue.code}-${issue.itemId ?? index}`} className={issue.severity}>{issue.message}</li>)}</ul>}{incompleteStageLabels.length > 0 && <ul><li className="error">단계 확인 필요: {incompleteStageLabels.join(", ")}</li></ul>}{unansweredChecklistCount > 0 && <ul><li className="error">현장 조건 {unansweredChecklistCount}개가 아직 미확인입니다.</li></ul>}{!hasReviewProblems && !geometryIssues.length && <p>물리 치수와 객체 위치 검사를 통과했습니다. 현장 조건 확인도 완료했습니다.</p>}<button type="button" className="site-layout-question-confirm" onClick={() => void saveCurrentDraft()}>기관 도면 저장</button></div>;
    }

    const item = selectedStageItem;
    if (activeQuestionIndex === 0 || !item) {
      return <div className="site-layout-question-card"><div className="site-layout-question-heading"><small>{activeStep.label} 1/{currentQuestionCount}</small><b>현장과 가장 비슷한 형태를 골라 주세요.</b><span>고르면 기본 규격으로 하나가 생기고, 다음 질문에서 위치와 실제 치수를 조정합니다.</span></div><div className="site-layout-guided-presets">{activePresets.map((preset) => <button key={preset.id} type="button" onClick={() => chooseGuidedPreset(preset.id)}><CadSymbol symbol={preset.id} compact /><b>{preset.label}</b><small>{formatMillimeters(preset.width)}mm 기본</small></button>)}</div><button type="button" className="site-layout-question-skip" onClick={skipGuidedStage}>이 단계는 해당 없음</button></div>;
    }
    const preset = presetForItem(item);
    const mounted = isWallMounted(item);
    const references = wallReferenceLabels(item.wall ?? "top");
    const beamReference = item.kind === "beam" ? previousBeam(item) : null;
    const pillarReference = item.kind === "pillar" ? previousPillar(item) : null;
    const windowReference = item.kind === "window" ? previousWindow(item) : null;
    const beamMeasurement = item.kind === "beam"
      ? item.structureMeasurement ?? wallMeasurement(item.wall ?? "top", item.offsetReference ?? "start", displayedWallDistance(item))
      : null;
    const pillarMeasurement = item.kind === "pillar"
      ? item.structureMeasurement ?? wallMeasurement(item.wall ?? "top", item.offsetReference ?? "start", displayedWallDistance(item))
      : null;
    if (activeQuestionIndex === 1) {
      if (item.kind === "pillar") {
        const wallAttached = item.structureAttachment?.mode === "wall";
        return <div className="site-layout-question-card"><div className="site-layout-question-heading"><small>기둥·보 2/{currentQuestionCount}</small><b>기둥이 벽에 붙어 있나요, 실내에 따로 있나요?</b><span>벽에 붙은 기둥은 벽·모서리·진행거리로, 독립 기둥은 두 기준벽에서 기둥 면까지의 거리로 기록합니다.</span></div><div className="site-layout-choice-grid two"><button type="button" className={wallAttached ? "active" : ""} onClick={() => setGuidedPillarAttachment(item, "wall")}>벽 부착 기둥</button><button type="button" className={!wallAttached ? "active" : ""} onClick={() => setGuidedPillarAttachment(item, "free")}>실내 독립 기둥</button></div>{wallAttached ? <div className="site-layout-wall-picker">{(["top", "right", "bottom", "left"] as WallSide[]).map((wall) => <button key={wall} type="button" className={(item.wall ?? "top") === wall ? "active" : ""} onClick={() => selectGuidedWall(item, wall)}>{wallLabel(wall)}</button>)}</div> : <div className="site-layout-reference-diagram"><b>좌·우벽 중 하나 → 기둥 면</b><b>상·하벽 중 하나 → 기둥 면</b></div>}</div>;
      }
      const mountedQuestion = item.kind === "beam" ? "보가 붙어 있는 벽을 골라 주세요." : "어느 벽에 설치되어 있나요?";
      return <div className="site-layout-question-card"><div className="site-layout-question-heading"><small>{activeStep.label} 2/{currentQuestionCount}</small><b>{mounted ? mountedQuestion : "배치 기준을 확인해 주세요."}</b><span>{mounted ? "현장에서 바라본 도면 기준으로 큰 벽 버튼을 누르세요." : "실내 객체는 좌측벽과 상단벽에서 중심까지의 거리로 기록합니다."}</span></div>{mounted ? <div className="site-layout-wall-picker">{(["top", "right", "bottom", "left"] as WallSide[]).map((wall) => <button key={wall} type="button" className={(item.wall ?? "top") === wall ? "active" : ""} onClick={() => selectGuidedWall(item, wall)}>{wallLabel(wall)}</button>)}</div> : <div className="site-layout-reference-diagram"><b>좌측 D벽 → 중심</b><b>상단 A벽 → 중심</b></div>}</div>;
    }
    if (activeQuestionIndex === 2) {
      if (item.kind === "pillar" && item.structureAttachment?.mode !== "wall") {
        const xReference = item.freeReferenceX ?? "left";
        const yReference = item.freeReferenceY ?? "top";
        return <div className="site-layout-question-card site-layout-beam-question"><div className="site-layout-question-heading"><small>기둥·보 3/{currentQuestionCount}</small><b>두 기준벽에서 기둥 면까지의 거리를 입력해 주세요.</b><span>현장에서 줄자를 댄 벽을 각각 고르면 기둥의 좌표를 mm 단위로 정확히 환산합니다.</span></div><div className="site-layout-guided-measurements"><div><span>가로 기준벽</span><div className="site-layout-choice-grid two"><button type="button" className={xReference === "left" ? "active" : ""} onClick={() => updateSelectedById(item.id, { freeReferenceX: "left" })}>좌측 D벽</button><button type="button" className={xReference === "right" ? "active" : ""} onClick={() => updateSelectedById(item.id, { freeReferenceX: "right" })}>우측 B벽</button></div><label><span>{xReference === "left" ? "좌측 D벽" : "우측 B벽"} → 기둥 면(mm)</span><MillimeterInput label="가로 기준벽에서 기둥 면까지(mm)" valueMeters={freePillarDistance(item, "x")} minMm={0} maxMm={Math.round(Math.max(0, draft.roomWidth - structureFootprint(item).width) * 1000)} onCommit={(value) => updateFreePillarDistance(item, "x", xReference, value)} /></label></div><div><span>세로 기준벽</span><div className="site-layout-choice-grid two"><button type="button" className={yReference === "top" ? "active" : ""} onClick={() => updateSelectedById(item.id, { freeReferenceY: "top" })}>상단 A벽</button><button type="button" className={yReference === "bottom" ? "active" : ""} onClick={() => updateSelectedById(item.id, { freeReferenceY: "bottom" })}>하단 C벽</button></div><label><span>{yReference === "top" ? "상단 A벽" : "하단 C벽"} → 기둥 면(mm)</span><MillimeterInput label="세로 기준벽에서 기둥 면까지(mm)" valueMeters={freePillarDistance(item, "y")} minMm={0} maxMm={Math.round(Math.max(0, draft.roomHeight - structureFootprint(item).height) * 1000)} onCommit={(value) => updateFreePillarDistance(item, "y", yReference, value)} /></label></div></div></div>;
      }
      if (item.kind === "pillar" && pillarMeasurement) {
        const usingPrevious = pillarMeasurement.referenceType === "item" && Boolean(pillarReference);
        return (
          <div className="site-layout-question-card site-layout-beam-question">
            <div className="site-layout-question-heading">
              <small>기둥·보 3/{currentQuestionCount}</small>
              <b>{pillarReference ? "이번 기둥은 어디에서부터 쟀나요?" : "첫 기둥은 어느 모서리에서 시작하나요?"}</b>
              <span>{pillarReference ? "이전 기둥의 끝면부터 이번 기둥의 시작면까지 잰 값을 입력하세요." : "선택한 벽에 밀착하고, 모서리부터 기둥 시작면까지 0m를 기본으로 배치합니다."}</span>
            </div>
            {pillarReference && (
              <div className="site-layout-choice-grid two">
                <button type="button" className={!usingPrevious ? "active" : ""} onClick={() => updatePillarMeasurement(item, wallMeasurement(item.wall ?? "top", item.offsetReference ?? "start", displayedWallDistance(item)))}>벽 모서리 기준</button>
                <button type="button" className={usingPrevious ? "active" : ""} onClick={() => updatePillarMeasurement(item, { axis: (item.wall === "left" || item.wall === "right") ? "y" : "x", referenceType: "item", referenceItemId: pillarReference.id, direction: 1, distanceMode: pillarMeasurement.distanceMode, distanceMm: pillarMeasurement.distanceMm || 1000 })}>이전 기둥 기준</button>
              </div>
            )}
            {usingPrevious && pillarReference ? (
              <>
                <div className="site-layout-beam-reference"><span>기준 기둥</span><b>{pillarReference.name}</b></div>
                <div className="site-layout-choice-grid two">
                  <button type="button" className={pillarMeasurement.distanceMode === "clear" ? "active" : ""} onClick={() => updatePillarMeasurement(item, { ...pillarMeasurement, distanceMode: "clear" })}>끝면 → 시작면</button>
                  <button type="button" className={pillarMeasurement.distanceMode === "center" ? "active" : ""} onClick={() => updatePillarMeasurement(item, { ...pillarMeasurement, distanceMode: "center" })}>중심 → 중심</button>
                </div>
                <label>
                  <span>{pillarMeasurement.distanceMode === "clear" ? "이전 기둥 끝면 → 이번 기둥 시작면 거리(m)" : "이전 기둥 중심 → 이번 기둥 중심 거리(m)"}</span>
                  <FriendlyNumberInput label="기둥 사이 거리(m)" value={pillarMeasurement.distanceMm / 1000} min={0} max={30} onCommit={(value) => updatePillarMeasurement(item, { ...pillarMeasurement, distanceMm: Math.round(value * 1000) })} />
                </label>
              </>
            ) : (
              <>
                <div className="site-layout-choice-grid two">{(["start", "end"] as OffsetReference[]).map((reference) => <button key={reference} type="button" className={(item.offsetReference ?? "start") === reference ? "active" : ""} onClick={() => { const measurement = wallMeasurement(item.wall ?? "top", reference, 0); const next = { ...item, offsetReference: reference, structureMeasurement: measurement }; updateSelectedById(item.id, { offsetReference: reference, structureMeasurement: measurement, ...placePillarByMeasurement(next, measurement, null) }); }}>{references[reference]}에서 시작</button>)}</div>
                <label>
                  <span>{(item.offsetReference ?? "start") === "start" ? references.start : references.end} → 기둥 시작면 거리(m)</span>
                  <FriendlyNumberInput label="벽 모서리에서 첫 기둥까지 거리(m)" value={displayedWallDistance(item)} min={0} max={wallLength(item)} onCommit={updateDisplayedWallDistance} />
                </label>
                <div className="site-layout-beam-summary"><span>벽 기준 배치</span><b>{wallLabel(item.wall)} · 시작 모서리에서 진행</b></div>
              </>
            )}
            <label><span>{wallLabel(item.wall)} → 기둥 면 직각거리(mm)</span><MillimeterInput label="벽에서 기둥 면 직각거리(mm)" valueMeters={item.wallInset ?? 0} minMm={0} maxMm={Math.round(Math.max(0, ((item.wall === "left" || item.wall === "right") ? draft.roomWidth - structureFootprint(item).width : draft.roomHeight - structureFootprint(item).height)) * 1000)} onCommit={(value) => updatePillarWallInset(item, value)} /></label>
          </div>
        );
      }
      if (item.kind === "beam" && beamMeasurement) {
        const usingPrevious = beamMeasurement.referenceType === "item" && Boolean(beamReference);
        return <div className="site-layout-question-card site-layout-beam-question"><div className="site-layout-question-heading"><small>기둥·보 3/{currentQuestionCount}</small><b>{beamReference ? "이번 보는 어디에서부터 쟀나요?" : "첫 보는 어느 모서리에서부터 쟀나요?"}</b><span>보가 여러 개면 앞 보에서 이번 보까지 잰 값을 그대로 입력할 수 있습니다.</span></div>{beamReference && <div className="site-layout-choice-grid two"><button type="button" className={!usingPrevious ? "active" : ""} onClick={() => updateBeamMeasurement(item, wallMeasurement(item.wall ?? "top", item.offsetReference ?? "start", displayedWallDistance(item)))}>벽 모서리 기준</button><button type="button" className={usingPrevious ? "active" : ""} onClick={() => updateBeamMeasurement(item, { axis: (item.wall === "left" || item.wall === "right") ? "y" : "x", referenceType: "item", referenceItemId: beamReference.id, direction: 1, distanceMode: beamMeasurement.distanceMode, distanceMm: beamMeasurement.distanceMm || 1000 })}>이전 보 기준</button></div>}{usingPrevious && beamReference ? <><div className="site-layout-beam-reference"><span>기준 보</span><b>{beamReference.name}</b></div><div className="site-layout-choice-grid two"><button type="button" className={beamMeasurement.distanceMode === "clear" ? "active" : ""} onClick={() => updateBeamMeasurement(item, { ...beamMeasurement, distanceMode: "clear" })}>면에서 면까지</button><button type="button" className={beamMeasurement.distanceMode === "center" ? "active" : ""} onClick={() => updateBeamMeasurement(item, { ...beamMeasurement, distanceMode: "center" })}>중심에서 중심까지</button></div><label><span>{beamMeasurement.distanceMode === "clear" ? "이전 보 면 → 이번 보 면 거리(m)" : "이전 보 중심 → 이번 보 중심 거리(m)"}</span><FriendlyNumberInput label="이전 보에서 다음 보까지 거리(m)" value={beamMeasurement.distanceMm / 1000} min={0} max={30} onCommit={(value) => updateBeamMeasurement(item, { ...beamMeasurement, distanceMm: Math.round(value * 1000) })} /></label></> : <><div className="site-layout-choice-grid two">{(["start", "end"] as OffsetReference[]).map((reference) => <button key={reference} type="button" className={(item.offsetReference ?? "start") === reference ? "active" : ""} onClick={() => { const measurement = wallMeasurement(item.wall ?? "top", reference, displayedWallDistance(item)); const next = { ...item, offsetReference: reference, structureMeasurement: measurement }; updateSelectedById(item.id, { offsetReference: reference, structureMeasurement: measurement, ...placeBeamByMeasurement(next, measurement, null) }); }}>{references[reference]}</button>)}</div><label><span>{(item.offsetReference ?? "start") === "start" ? references.start : references.end} → 보 시작면 거리(m)</span><FriendlyNumberInput label="벽 모서리에서 첫 보까지 거리(m)" value={displayedWallDistance(item)} min={0} max={wallLength(item)} onCommit={updateDisplayedWallDistance} /></label></>}</div>;
      }
      if (item.kind === "window") {
        const measurement = item.openingMeasurement ?? wallMeasurement(item.wall ?? "top", item.offsetReference ?? "start", displayedWallDistance(item));
        const usingPrevious = measurement.referenceType === "item" && Boolean(windowReference);
        return <div className="site-layout-question-card site-layout-beam-question"><div className="site-layout-question-heading"><small>창호 3/{currentQuestionCount}</small><b>{windowReference ? "이번 창호는 어디에서부터 쟀나요?" : "첫 창호는 어느 모서리에서부터 쟀나요?"}</b><span>연속 창호는 앞 창틀의 끝 또는 중심에서 잰 거리를 그대로 입력할 수 있습니다.</span></div>{windowReference && <div className="site-layout-choice-grid two"><button type="button" className={!usingPrevious ? "active" : ""} onClick={() => updateWindowMeasurement(item, wallMeasurement(item.wall ?? "top", item.offsetReference ?? "start", displayedWallDistance(item)))}>벽 모서리 기준</button><button type="button" className={usingPrevious ? "active" : ""} onClick={() => updateWindowMeasurement(item, { axis: (item.wall === "left" || item.wall === "right") ? "y" : "x", referenceType: "item", referenceItemId: windowReference.id, direction: 1, distanceMode: measurement.distanceMode, distanceMm: measurement.distanceMm || 1000 })}>이전 창호 기준</button></div>}{usingPrevious && windowReference ? <><div className="site-layout-beam-reference"><span>기준 창호</span><b>{windowReference.name}</b></div><div className="site-layout-choice-grid two"><button type="button" className={measurement.distanceMode === "clear" ? "active" : ""} onClick={() => updateWindowMeasurement(item, { ...measurement, distanceMode: "clear" })}>창틀 끝 사이</button><button type="button" className={measurement.distanceMode === "center" ? "active" : ""} onClick={() => updateWindowMeasurement(item, { ...measurement, distanceMode: "center" })}>중심 사이</button></div><label><span>{measurement.distanceMode === "clear" ? "이전 창틀 끝 → 이번 창틀 시작 거리(m)" : "이전 창호 중심 → 이번 창호 중심 거리(m)"}</span><FriendlyNumberInput label="창호 사이 거리(m)" value={measurement.distanceMm / 1000} min={0} max={30} onCommit={(value) => updateWindowMeasurement(item, { ...measurement, distanceMm: Math.round(value * 1000) })} /></label></> : <><div className="site-layout-choice-grid two">{(["start", "end"] as OffsetReference[]).map((reference) => <button key={reference} type="button" className={(item.offsetReference ?? "start") === reference ? "active" : ""} onClick={() => updateWindowMeasurement(item, wallMeasurement(item.wall ?? "top", reference, displayedWallDistance(item)))}>{references[reference]}</button>)}</div><label><span>{(item.offsetReference ?? "start") === "start" ? references.start : references.end} → 창틀 시작 거리(m)</span><FriendlyNumberInput label="벽 모서리에서 첫 창틀까지 거리(m)" value={displayedWallDistance(item)} min={0} max={wallLength(item)} onCommit={updateDisplayedWallDistance} /></label></>}</div>;
      }
      return <div className="site-layout-question-card"><div className="site-layout-question-heading"><small>{activeStep.label} 3/{currentQuestionCount}</small><b>{mounted ? "어느 모서리에서 거리를 쟀나요?" : item.kind === "pillar" ? "두 벽에서 기둥 면까지 거리를 입력해 주세요." : "두 벽에서 중심까지 거리를 입력해 주세요."}</b><span>손에 든 줄자 기준 그대로 입력하면 자동으로 도면 좌표로 환산됩니다.</span></div>{mounted ? <><div className="site-layout-choice-grid two">{(["start", "end"] as OffsetReference[]).map((reference) => <button key={reference} type="button" className={(item.offsetReference ?? "start") === reference ? "active" : ""} onClick={() => updateSelectedById(item.id, { offsetReference: reference })}>{references[reference]}</button>)}</div><label><span>{(item.offsetReference ?? "start") === "start" ? references.start : references.end} → {item.presetId === "aircon-wall" ? "에어컨 끝" : item.kind === "door" ? "문틀 시작" : "창틀 시작"} 거리(m)</span><FriendlyNumberInput label="벽 기준거리(m)" value={displayedWallDistance(item)} min={0} max={wallLength(item)} onCommit={updateDisplayedWallDistance} /></label></> : <div className="site-layout-guided-measurements"><label><span>좌측 D벽 → {item.kind === "pillar" ? "기둥 면" : "중심"}(m)</span><FriendlyNumberInput label="좌측벽 기준거리(m)" value={item.kind === "pillar" ? faceDistance(item, "x") : centerDistance(item, "x")} min={0} max={draft.roomWidth} onCommit={(value) => { setSelectedId(item.id); if (item.kind === "pillar") updateFaceDistance("x", value); else { const size = footprint(item); updateSelectedById(item.id, { x: snapGrid(((value - size.width / 2) / draft.roomWidth) * 100) }); } }} /></label><label><span>상단 A벽 → {item.kind === "pillar" ? "기둥 면" : "중심"}(m)</span><FriendlyNumberInput label="상단벽 기준거리(m)" value={item.kind === "pillar" ? faceDistance(item, "y") : centerDistance(item, "y")} min={0} max={draft.roomHeight} onCommit={(value) => { setSelectedId(item.id); if (item.kind === "pillar") updateFaceDistance("y", value); else { const size = footprint(item); updateSelectedById(item.id, { y: snapGrid(((value - size.height / 2) / draft.roomHeight) * 100) }); } }} /></label></div>}</div>;
    }
    if (activeQuestionIndex === 3) {
      if (item.kind === "pillar") {
        return <div className="site-layout-question-card"><div className="site-layout-question-heading"><small>기둥·보 4/{currentQuestionCount}</small><b>기둥의 폭과 깊이를 mm로 입력해 주세요.</b><span>사각 기둥은 가로 폭과 세로 깊이를 각각 기록하며, 원형 기둥은 두 값에 같은 지름을 입력합니다.</span></div><div className="site-layout-guided-measurements"><label><span>기둥 폭(mm)</span><MillimeterInput label="기둥 폭(mm)" valueMeters={item.width} minMm={100} maxMm={Math.round(draft.roomWidth * 1000)} onCommit={(value) => updateStageItemDimension(item, "width", value)} /></label><label><span>기둥 깊이(mm)</span><MillimeterInput label="기둥 깊이(mm)" valueMeters={item.height} minMm={100} maxMm={Math.round(draft.roomHeight * 1000)} onCommit={(value) => updateStageItemDimension(item, "height", value)} /></label></div></div>;
      }
      const wallMax = (item.wall === "left" || item.wall === "right") ? draft.roomHeight : draft.roomWidth;
      const widthLabel = item.kind === "door" ? "문틀 전체 폭" : item.kind === "window" ? "창틀 전체 폭" : item.kind === "beam" ? "벽과 나란한 보 길이" : item.presetId === "aircon-ceiling" ? "정사각형 한 변" : "가로";
      const openingHeightLabel = item.kind === "door" ? "문틀 전체 높이" : "창틀 전체 높이";
      return <div className="site-layout-question-card"><div className="site-layout-question-heading"><small>{activeStep.label} 4/{currentQuestionCount}</small><b>현장에서 잰 실제 크기를 입력해 주세요.</b><span>도면 확대·축소와 관계없이 실제 mm 치수는 그대로 유지됩니다.</span></div><div className="site-layout-guided-measurements"><label><span>{widthLabel}(m)</span><FriendlyNumberInput label={widthLabel} value={item.width} min={0.1} max={mounted ? wallMax : 100} onCommit={(value) => updateStageItemDimension(item, "width", value)} /></label>{item.kind === "door" || item.kind === "window" ? <label><span>{openingHeightLabel}(m)</span><FriendlyNumberInput label={openingHeightLabel} value={item.openingHeight ?? (item.kind === "door" ? 2.1 : 1.5)} min={0.3} max={ceilingHeight} onCommit={(value) => updateSelectedById(item.id, { openingHeight: Math.min(value, ceilingHeight - (item.kind === "window" ? item.sillHeight ?? 0.9 : 0)) })} /></label> : item.presetId !== "aircon-ceiling" && <label><span>{item.kind === "beam" ? "벽에서 실내 방향 보 폭" : "세로"}(m)</span><FriendlyNumberInput label="객체 세로(m)" value={item.height} min={0.1} max={100} onCommit={(value) => updateStageItemDimension(item, "height", value)} /></label>}</div></div>;
    }
    const addLabel = item.kind === "beam" ? "+ 다음 보 추가" : item.kind === "window" ? "+ 다음 창호 추가" : item.kind === "door" ? "+ 출입문 추가" : item.kind === "fixture" ? "+ 에어컨 추가" : "+ 다음 기둥 추가";
    const windowMeasurement = item.kind === "window" ? item.openingMeasurement : null;
    return <div className="site-layout-question-card">
      <div className="site-layout-question-heading"><small>{activeStep.label} 5/{currentQuestionCount}</small><b>{preset.label} 세부 조건을 확인해 주세요.</b><span>같은 종류가 더 있으면 아래 버튼으로 추가하고, 없으면 바로 다음 단계로 이동하세요.</span></div>
      {item.kind === "door" && <div className="site-layout-guided-measurements"><label><span>경첩 방향</span><select value={item.handing ?? "left"} onChange={(event) => updateSelectedById(item.id, { handing: event.target.value as OpeningHand })}><option value="left">좌경첩</option><option value="right">우경첩</option></select></label><label><span>열림 방향</span><select value={item.swing ?? "inside"} onChange={(event) => updateSelectedById(item.id, { swing: event.target.value as OpeningSwing })}><option value="inside">실 안쪽</option><option value="outside">실 바깥쪽</option></select></label></div>}
      {item.kind === "window" && <div className="site-layout-guided-measurements"><label><span>바닥 → 창 하단 높이(m)</span><FriendlyNumberInput label="창 하단 높이(m)" value={item.sillHeight ?? 0.9} min={0} max={ceilingHeight - (item.openingHeight ?? 1.5)} onCommit={(value) => updateSelectedById(item.id, { sillHeight: value })} /></label><div className="site-layout-beam-summary"><span>연속 창호 기준</span><b>{windowMeasurement?.referenceType === "item" ? `${windowMeasurement.distanceMode === "center" ? "중심 간" : "이전 끝면→다음 시작면"} ${Number(((windowMeasurement.distanceMm || 0) / 1000).toFixed(3))}m` : `${references[item.offsetReference ?? "start"]}에서 ${Number(displayedWallDistance(item).toFixed(3))}m`}</b></div></div>}
      {item.kind === "beam" && <div className="site-layout-guided-measurements"><label><span>바닥 → 보 하단(m)</span><FriendlyNumberInput label="보 하단 높이(m)" value={item.beamBottomHeight ?? 2.2} min={0} max={ceilingHeight} onCommit={(value) => updateSelectedById(item.id, { beamBottomHeight: value })} /></label><div className="site-layout-beam-summary"><span>배치 기준</span><b>{beamMeasurement?.referenceType === "item" ? `${beamMeasurement.distanceMode === "center" ? "중심 간" : "면 간"} ${Number(((beamMeasurement.distanceMm || 0) / 1000).toFixed(3))}m` : `${references[item.offsetReference ?? "start"]} 기준`}</b></div></div>}
      {item.kind === "pillar" && <div className="site-layout-beam-summary"><span>배치 기준</span><b>{item.structureAttachment?.mode === "wall" ? pillarMeasurement?.referenceType === "item" ? `${pillarMeasurement.distanceMode === "center" ? "중심 간" : "끝면→시작면"} ${Number(((pillarMeasurement.distanceMm || 0) / 1000).toFixed(3))}m · 직각 ${formatMillimeters(item.wallInset ?? 0)}mm` : `${wallLabel(item.wall)} · ${references[item.offsetReference ?? "start"]}에서 ${Number((displayedWallDistance(item) || 0).toFixed(3))}m · 직각 ${formatMillimeters(item.wallInset ?? 0)}mm` : `${item.freeReferenceX === "right" ? "우측 B벽" : "좌측 D벽"} ${formatMillimeters(freePillarDistance(item, "x"))}mm · ${item.freeReferenceY === "bottom" ? "하단 C벽" : "상단 A벽"} ${formatMillimeters(freePillarDistance(item, "y"))}mm`}</b></div>}
      {item.kind === "fixture" && <label><span>바닥 → 설치면 높이(m)</span><FriendlyNumberInput label="에어컨 설치 높이(m)" value={item.mountingHeight ?? (item.presetId === "aircon-ceiling" ? ceilingHeight : 2.1)} min={0} max={ceilingHeight} onCommit={(value) => updateSelectedById(item.id, { mountingHeight: value })} /></label>}
      <div className="site-layout-question-actions"><button type="button" onClick={() => { if (item.kind === "beam") addFollowupBeam(item); else if (item.kind === "pillar") addFollowupPillar(item); else if (item.kind === "window") addFollowupWindow(item); else { setSelectedId(""); setActiveQuestionIndex(0); } }}>{addLabel}</button></div>
    </div>;
  }
  async function leaveCanvasExpanded({ historyAlreadyPopped = false }: { historyAlreadyPopped?: boolean } = {}) {
    if (closingExpandedRef.current) return;
    closingExpandedRef.current = true;
    const historyToken = expandedHistoryTokenRef.current;
    const shouldPopHistory = !historyAlreadyPopped && historyToken && history.state?.siteLayoutExpanded === historyToken;
    setCanvasExpanded(false);
    setCanvasFocus(false);
    setOrientationHint(false);
    expandedRef.current = false;
    expandedHistoryTokenRef.current = "";
    const orientation = (screen as Screen & { orientation?: ScreenOrientation & { unlock?: () => void } }).orientation;
    try { orientation?.unlock?.(); } catch { /* Restoring scroll and panels must continue without orientation support. */ }
    if (document.fullscreenElement === workspaceRef.current && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch { /* CSS immersive mode can still close normally. */ }
    }
    fullscreenEnteredRef.current = false;
    if (shouldPopHistory) {
      suppressExpandedPopRef.current = true;
      history.back();
      window.setTimeout(() => { suppressExpandedPopRef.current = false; }, 500);
    }
    window.requestAnimationFrame(() => window.scrollTo({ top: expandedScrollYRef.current, behavior: "auto" }));
    window.setTimeout(() => { closingExpandedRef.current = false; }, 0);
  }
  async function toggleCanvasExpanded() {
    if (canvasExpanded) {
      await leaveCanvasExpanded();
      return;
    }
    const isMobile = window.matchMedia("(max-width: 1000px), (pointer: coarse)").matches;
    if (canvasFocus && !canvasExpanded) {
      setCanvasFocus(false);
      return;
    }
    if (!isMobile) {
      setCanvasFocus((current) => !current);
      return;
    }
    closingExpandedRef.current = false;
    expandedScrollYRef.current = window.scrollY;
    setCanvasFocus(true);
    setCanvasExpanded(true);
    expandedRef.current = true;
    const historyToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    expandedHistoryTokenRef.current = historyToken;
    const currentState = history.state && typeof history.state === "object" ? history.state : {};
    history.pushState({ ...currentState, siteLayoutExpanded: historyToken }, "");
    try {
      await workspaceRef.current?.requestFullscreen?.();
      fullscreenEnteredRef.current = document.fullscreenElement === workspaceRef.current;
    } catch {
      fullscreenEnteredRef.current = false;
    }
    try {
      const orientation = (screen as Screen & { orientation?: ScreenOrientation & { lock?: (mode: "landscape") => Promise<void> } }).orientation;
      await orientation?.lock?.("landscape");
    } catch {
      setOrientationHint(window.matchMedia("(orientation: portrait)").matches);
    }
  }
  function resetDraft() {
    const changed = draft.items.length
      || draft.fieldNotes
      || Object.values(draft.siteChecklist ?? {}).some(Boolean)
      || Object.values(draft.stageChecks ?? {}).some((status) => status && status !== "pending")
      || draft.roomName !== defaultDraft.roomName
      || draft.roomWidth !== defaultDraft.roomWidth
      || draft.roomHeight !== defaultDraft.roomHeight
      || draft.roomCeilingHeight !== defaultDraft.roomCeilingHeight
      || draft.roomWallThickness !== defaultDraft.roomWallThickness;
    if (changed && !window.confirm("현재 입력 내용을 지우고 새 초안을 시작할까요? 저장하지 않은 내용은 복구할 수 없습니다.")) return;
    setDraft(cloneDraft(defaultDraft)); setSelectedId(""); setPendingPresetId(null); setActiveLocalDraftId(""); setActiveLocalDraftFingerprint(""); setActiveRemoteId(null); setActiveRemoteVersion(null); setActiveRemoteFingerprint(""); setActiveDriveSyncStatus(""); setRemoteSavePhase("idle"); setRemoteSaveDetail(""); window.localStorage.removeItem(REMOTE_CONTEXT_KEY); setActiveStepIndex(0); setActiveQuestionIndex(0); setView("model"); setCanvasFocus(false); setCommand("명령: 새 기초도면을 준비했습니다.");
  }
  const remoteDraftDirty = Boolean(activeRemoteId && activeRemoteFingerprint !== currentDraftFingerprint);
  const typedOrganization = (draft.organizationName || "").trim();
  const exactInstitution = institutionOptions.some((option) => option.organization === typedOrganization);
  return (
    <section className="site-layout-planner" aria-label="현장 실측 기초도면 작성기">
      <header className="site-layout-intro">
        <div className="site-layout-brand"><span aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M5 25V7h22v18H5Z" /><path d="M9 21V11h14v10H9Zm0-5h14M14 11v10" /></svg></span><div><b>기초도면 작성</b><small>현장 실측 → CAD팀 전달</small></div></div>
        <div className="site-layout-header-actions"><button type="button" onClick={resetDraft}>새 도면</button><button type="button" className="secondary" onClick={() => { setDraftLibraryOpen(true); setDraftLibraryPage(1); }}>도면 보관함 {remoteLayouts.length}</button><button type="button" className={`primary ${remoteOperation === "saving" ? "is-saving" : remoteSavePhase === "drive-ready" && !remoteDraftDirty ? "is-saved" : ""}`} disabled={remoteLoading} onClick={() => void saveCurrentDraft()}>{remoteOperation === "saving" ? "저장 중…" : remoteSavePhase === "drive-ready" && !remoteDraftDirty ? "저장됨 ✓" : "기관 도면 저장"}</button>{activeRemoteId && remoteSavePhase === "drive-error" && <button type="button" disabled={remoteLoading} onClick={() => { const record = remoteLayouts.find((item) => item.id === activeRemoteId); if (record) void retryRemoteDrive(record); }}>Drive 다시 시도</button>}<button type="button" disabled={exporting} onClick={() => void downloadCurrentPdf()}>{exporting ? "PDF 생성 중…" : "PDF 저장"}</button><button type="button" className="site-layout-share-button" disabled={exporting} onClick={() => void shareCurrentPdf()}>PDF 공유</button></div>
      </header>
      {(remoteSavePhase === "failed" || remoteSavePhase === "conflict" || remoteSavePhase === "drive-error") && <div className="site-layout-local-state is-error" role="alert"><span>{saveMessage}</span><small>{remoteSaveDetail || "현재 입력은 이 기기의 복구본에 남아 있습니다."}</small></div>}
      {toastMessage && <div className="site-layout-toast" role="status" aria-live="polite">{toastMessage}</div>}
      <details className="site-layout-context-details" open>
        <summary><b>기관·사업 정보</b><span>{draft.organizationName || "기관 미지정"} · {draft.businessRound ?? 1}차 · {draft.roomName}</span></summary>
        <div className="site-layout-context-bar">
          <label><span>기관명</span><input list="site-layout-institutions" value={draft.organizationName ?? ""} onChange={(event) => updateDraft({ organizationName: event.target.value.slice(0, 100) })} onBlur={(event) => { const match = institutionOptions.find((option) => option.organization === event.target.value.trim()); if (match) updateDraft({ organizationName: match.organization, businessRound: match.businessRound }); }} placeholder="기관명을 검색하거나 입력" /></label>
          <datalist id="site-layout-institutions">{institutionOptions.map((option) => <option key={`${option.organization}-${option.businessRound}-${option.region}`} value={option.organization}>{option.businessRound}차 · {option.region}</option>)}</datalist>
          <label><span>사업 차수</span><FriendlyNumberInput label="사업 차수" value={draft.businessRound ?? 1} min={1} max={99} decimals={0} onCommit={(value) => updateDraft({ businessRound: Math.max(1, Math.round(value)) })} /></label>
          <label><span>실 이름</span><input value={draft.roomName} onChange={(event) => updateDraft({ roomName: event.target.value.slice(0, 80) })} placeholder="예: 본관 2층 스마트 체험교실" /></label>
          <label className="site-layout-context-notes"><span>현장 메모·CAD팀 전달사항</span><textarea value={draft.fieldNotes ?? ""} onChange={(event) => updateDraft({ fieldNotes: event.target.value.slice(0, 1000) })} placeholder="보 하단 높이, 보 사이 거리, 반입 동선 등 특이사항" /></label>
          {typedOrganization.length >= 2 && institutionSearchResult.query === typedOrganization && !exactInstitution && <button type="button" className="site-layout-create-institution" disabled={creatingInstitution} onClick={() => void createInstitutionFromDraft()}>{creatingInstitution ? "기관 추가 중…" : `“${typedOrganization}” 새 기관으로 추가`}</button>}
        </div>
      </details>
      {draftLibraryOpen && <div className="site-layout-draft-library-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraftLibraryOpen(false); }}><section className="site-layout-draft-library" role="dialog" aria-modal="true" aria-label="도면 보관함">
        <div className="site-layout-draft-library-head"><div><b>도면 보관함</b><span>기관·차수·실 이름으로 검색해 필요한 도면만 불러옵니다.</span></div><button type="button" onClick={() => setDraftLibraryOpen(false)} aria-label="도면 보관함 닫기">닫기</button></div>
        <div className="site-layout-draft-library-tools"><input value={draftLibraryQuery} onChange={(event) => { setDraftLibraryQuery(event.target.value); setDraftLibraryPage(1); }} placeholder="기관명·실 이름·사업 차수 검색" /><button type="button" disabled={remoteLoading} onClick={() => void refreshRemoteLayouts()}>새로고침</button></div>
        {filteredRemoteLayouts.length ? <ul>{pagedRemoteLayouts.map((record) => <li key={record.id}><div><b>{record.organizationName} · {record.businessRound}차 · {record.roomName}</b><small>v{record.editVersion} · {record.updatedByName || "사용자"} · {new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(record.updatedAt))}</small><em className={`drive-${record.driveSyncStatus}`}>{record.driveSyncStatus === "ready" ? "Drive 완료" : record.driveSyncStatus === "error" ? "Drive 재시도" : "Drive 동기화 중"}</em></div><button type="button" disabled={remoteLoading} onClick={() => void loadRemoteDraft(record)}>불러오기</button>{record.pdfUrl && <a href={record.pdfUrl} target="_blank" rel="noreferrer">PDF</a>}{record.driveSyncStatus === "error" && <button type="button" disabled={remoteLoading} onClick={() => void retryRemoteDrive(record)}>Drive 재시도</button>}<button type="button" className="danger" disabled={remoteLoading} onClick={() => void deleteRemoteDraft(record)}>삭제</button></li>)}</ul> : <p>{remoteLoading ? "기관 도면을 불러오는 중입니다…" : "조건에 맞는 저장 도면이 없습니다."}</p>}
        <div className="site-layout-draft-library-pages"><button type="button" disabled={draftLibraryPage <= 1} onClick={() => setDraftLibraryPage((page) => Math.max(1, page - 1))}>이전</button><span>{Math.min(draftLibraryPage, draftLibraryPageCount)} / {draftLibraryPageCount}</span><button type="button" disabled={draftLibraryPage >= draftLibraryPageCount} onClick={() => setDraftLibraryPage((page) => Math.min(draftLibraryPageCount, page + 1))}>다음</button></div>
        <details className="site-layout-recovery-library"><summary>이 기기 복구본 {localDrafts.length}개</summary>{localDrafts.length ? <ul>{localDrafts.map((record) => <li key={record.id}><div><b>{record.name}</b><small>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(record.updatedAt))}</small></div><button type="button" onClick={() => loadLocalDraft(record)}>복구</button><button type="button" className="danger" onClick={() => deleteLocalDraft(record)}>삭제</button></li>)}</ul> : <p>기기 복구본이 없습니다.</p>}</details>
      </section></div>}

      <section className="site-layout-guide" aria-label="현장 실측 단계">
        <nav className={`site-layout-guide-progress ${workflowMode === "direct" ? "is-direct" : ""}`}>{guideSteps.map((step, index) => {
          const status = step.id === "review" ? "pending" : draft.stageChecks?.[step.id] ?? "pending";
          return <button key={step.id} type="button" className={`${index === activeStepIndex ? "active" : ""} status-${status}`} onClick={() => goToStep(index)}><i>{index + 1}</i><span>{step.label}</span></button>;
        })}</nav>
        <div className="site-layout-guide-card">
          <div className="site-layout-guide-copy"><small>STEP {activeStepIndex + 1} / {guideSteps.length}</small><h2>{activeStep.title}</h2><p>{activeStep.description}</p></div>
          {workflowMode === "guided" && renderGuidedQuestion()}
          {workflowMode === "guided" && activeStageItems.length > 0 && <section className="site-layout-guided-stage-items" aria-label={`${activeStep.label} 등록 객체`} style={{ display: "grid", gap: 8, marginTop: 12, padding: 12, border: "1px solid #d8e0f0", borderRadius: 12, background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><div><b>{activeStep.label} 등록 객체 {activeStageItems.length}개</b><small style={{ display: "block", color: "#667085" }}>도면이나 아래 목록에서 객체를 골라 수정·복사·삭제할 수 있습니다.</small></div><button type="button" className="danger" onClick={removeAllItems}>모든 객체 삭제</button></div>
            <ul style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>{activeStageItems.map((stageItem) => <li key={stageItem.id} className={selectedId === stageItem.id ? "active" : ""} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto auto", alignItems: "center", gap: 6, padding: 8, border: selectedId === stageItem.id ? "2px solid #3157e8" : "1px solid #e1e6f0", borderRadius: 10 }}>
              <button type="button" onClick={() => { setSelectedId(stageItem.id); setView("model"); }} style={{ minWidth: 0, textAlign: "left", border: 0, background: "transparent" }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stageItem.name}</b><small>{formatMillimeters(stageItem.width)} × {formatMillimeters(stageItem.height)}mm{stageItem.wall ? ` · ${wallLabel(stageItem.wall)}` : " · 실내 독립"}</small></button>
              <button type="button" onClick={() => editGuidedItem(stageItem)}>수정</button><button type="button" onClick={() => duplicateGuidedItem(stageItem)}>복사</button><button type="button" className="danger" onClick={() => removeItemById(stageItem.id)}>삭제</button>
            </li>)}</ul>
          </section>}
          {workflowMode === "direct" && activeStep.id === "room" && <div className="site-layout-room-settings">
            <label><span>가로</span><div><FriendlyNumberInput label="공간 가로(m)" value={draft.roomWidth} min={0.1} max={100} onCommit={(value) => updateDraft({ roomWidth: positiveDimension(value, draft.roomWidth) })} /><em>m</em></div></label>
            <label><span>세로</span><div><FriendlyNumberInput label="공간 세로(m)" value={draft.roomHeight} min={0.1} max={100} onCommit={(value) => updateDraft({ roomHeight: positiveDimension(value, draft.roomHeight) })} /><em>m</em></div></label>
            <label><span>천장 높이</span><div><FriendlyNumberInput label="천장 높이(m)" value={ceilingHeight} min={0.1} max={20} onCommit={(value) => updateDraft({ roomCeilingHeight: positiveDimension(value, ceilingHeight) })} /><em>m</em></div></label>
            <p className="site-layout-room-live-note">입력 즉시 내부 실측 크기로 도면 외곽선과 전체 치수에 반영됩니다.</p>
          </div>}
          {workflowMode === "direct" && activeStep.id !== "room" && activeStep.id !== "review" && <div className="site-layout-stage-check">
            <div><b>{stageCounts[activeStep.id]}개 등록</b><span>현장 확인 상태를 선택하세요.</span></div>
            <div role="radiogroup" aria-label={`${activeStep.label} 확인 상태`}>{([
              ["complete", "확인 완료"], ["none", "해당 없음"], ["review", "재확인 필요"],
            ] as [StageCheckStatus, string][]).map(([status, label]) => <button key={status} type="button" role="radio" aria-checked={(draft.stageChecks?.[activeStep.id as StageCheckKey] ?? "pending") === status} onClick={() => setStageStatus(activeStep.id as StageCheckKey, status)}>{label}</button>)}</div>
          </div>}
          {workflowMode === "direct" && activeStep.id === "checklist" && <div className="site-layout-site-checklist">
            <div className="site-layout-checklist-group"><h3>인터넷·망</h3><div>
              <label><span>인터넷 사용</span><select value={checklist.internetAvailable} onChange={(event) => updateChecklist("internetAvailable", event.target.value as SurveyChoice)}><option value="">미확인</option><option value="yes">있음</option><option value="no">없음</option><option value="review">재확인</option></select></label>
              <label><span>연결 방식</span><select value={checklist.internetMode} onChange={(event) => updateChecklist("internetMode", event.target.value as InternetMode)}><option value="">미확인</option><option value="wired">유선</option><option value="wireless">무선</option><option value="both">유선·무선</option><option value="none">사용 불가</option></select></label>
              <label><span>사용 망</span><select value={checklist.networkType} onChange={(event) => updateChecklist("networkType", event.target.value as NetworkType)}><option value="">미확인</option><option value="education">교육망</option><option value="private">사설망</option><option value="both">교육망·사설망</option><option value="unknown">현장 확인</option></select></label>
            </div></div>
            <div className="site-layout-checklist-group"><h3>전기·시공</h3><div>{([
              ["powerOutlet", "사용 가능한 전원"], ["blackoutCurtain", "암막커튼"], ["floorWork", "바닥공사"], ["elevator", "엘리베이터"], ["ceilingLightRemoval", "천장 조명 철거"],
            ] as [keyof SiteChecklist, string][]).map(([key, label]) => <label key={key}><span>{label}</span><select value={checklist[key]} onChange={(event) => updateChecklist(key, event.target.value as never)}><option value="">미확인</option><option value="yes">있음·필요</option><option value="no">없음·불필요</option><option value="review">재확인</option></select></label>)}</div></div>
            <label className="site-layout-field-notes"><span>현장 메모·CAD팀 전달사항</span><textarea value={draft.fieldNotes ?? ""} onChange={(event) => updateDraft({ fieldNotes: event.target.value.slice(0, 1000) })} placeholder="보 하단 높이, 보와 보 사이, 반입 동선 등 특이사항을 입력하세요." /></label>
          </div>}
          {workflowMode === "direct" && activeStep.id === "review" && <div className="site-layout-review-grid">
            {guideSteps.filter((step) => step.id !== "review").map((step) => {
              const key = step.id as StageCheckKey;
              const status = draft.stageChecks?.[key] ?? "pending";
              const labels: Record<StageCheckStatus, string> = { pending: "미확인", complete: "확인 완료", none: "해당 없음", review: "재확인 필요" };
              return <button key={step.id} type="button" className={`status-${status}`} onClick={() => goToStep(guideSteps.findIndex((item) => item.id === step.id))}><span>{step.label}</span><b>{labels[status]}</b><small>{stageCounts[key]}개</small></button>;
            })}
            <div className="site-layout-review-note"><span>현장 메모</span><p>{draft.fieldNotes || "등록된 메모가 없습니다."}</p></div>
          </div>}
        </div>
      </section>

      <div ref={workspaceRef} className={`site-layout-workspace ${canvasFocus ? "is-canvas-focus" : ""} ${canvasExpanded ? "is-mobile-expanded" : ""} ${workflowMode === "guided" ? "is-guided" : ""}`}>
        <aside className={`site-layout-library ${activePresets.length ? "" : "is-context-only"}`}>
          <div><b>{activeStep.id === "room" ? "공간 입력 안내" : activeStep.id === "review" ? "최종 검수" : `${activeStep.label} 모양 선택`}</b><span>{activeStep.id === "room" ? "위에서 실측값을 입력한 뒤 다음 단계로 이동하세요." : activeStep.id === "review" ? "미확인 단계를 눌러 바로 보완할 수 있습니다." : "현장과 가장 비슷한 그림을 먼저 선택하세요."}</span></div>
          {activePresets.length > 0 && <p className="site-layout-mobile-help">그림 선택 → 도면의 벽이나 위치 터치 → 실제 치수 입력</p>}
          {(activeStep.id === "door" || activeStep.id === "window") && <p className="site-layout-standard-note">기본 폭은 KS F 1515의 100mm 모듈을 참고한 시작값입니다. 현장에서는 문틀·창틀 끝에서 끝까지 잰 실제 치수를 우선하세요.</p>}
          {activeStep.groups.map((group) => {
            const presets = activePresets.filter((preset) => preset.group === group); if (!presets.length) return null;
            return <section key={group} className="site-layout-library-section"><h3>{group}<small>{presets.length}</small></h3><div className="site-layout-library-grid">{presets.map((preset) => <button key={preset.id} type="button" draggable className={`kind-${preset.kind} symbol-${preset.id} ${pendingPresetId === preset.id ? "pending" : ""}`} aria-pressed={pendingPresetId === preset.id} onDragStart={(event) => handlePresetDragStart(event, preset.id)} onClick={() => choosePreset(preset.id)}><CadSymbol symbol={preset.id} compact /><span>{preset.label}</span><small>{preset.code} · {formatMillimeters(preset.width)}mm</small></button>)}</div></section>;
          })}
          {!activePresets.length && <div className="site-layout-library-empty">{activeStep.id === "review" ? "단계별 상태와 도면을 최종 확인하세요." : "공간 치수를 입력하면 도면이 자동 생성됩니다."}</div>}
        </aside>

        <main className="site-layout-canvas-panel view-model">
          <div className="site-layout-canvas-head"><div><b>CAD 모델</b><span>전체 도면 자동 맞춤</span></div><div className="site-layout-canvas-meta">{pendingPreset ? <button type="button" className="site-layout-pending-placement" onClick={() => { setPendingPresetId(null); setActiveTool("선택"); setCommand("명령: 블록 배치를 취소했습니다."); }}>{pendingPreset.label} 배치 대기 · 취소</button> : <span>클릭 선택 · 끌어서 이동 · 단위 mm</span>}</div></div>
          {orientationHint && <div className="site-layout-orientation-hint" role="status">휴대폰을 가로로 돌리면 도면을 더 넓게 볼 수 있습니다. 세로 화면에서도 계속 사용할 수 있습니다.</div>}
          <div className="site-layout-model-space">
            <div className="site-layout-board-wrap" style={{ ...physicalRoomStyle, maxWidth: `${Math.round(920 * roomRatio)}px` }}><div ref={boardRef} className={`site-layout-board site-layout-geometry-host ${pendingPreset ? "placing" : ""}`} style={physicalRoomStyle} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={handleBoardDrop}><SiteLayoutGeometryView draft={physicalDraft} mode="model" paddingMm={650} selectedItemId={selectedId} interactive interactionMode={workflowMode === "direct" ? "drag" : "select"} showDimensions showLabels isItemVisible={(item) => { const legacy = draft.items.find((candidate) => candidate.id === item.id); return Boolean(legacy && itemLayer(legacy) !== "equipment" && visibleLayers[itemLayer(legacy)]); }} onBackgroundPointerDown={(point) => { if (pendingPresetId) addItem(pendingPresetId, (point.xMm / physicalDraft.roomWidthMm) * 100, (point.yMm / physicalDraft.roomHeightMm) * 100); else setSelectedId(""); }} onItemSelect={(item) => setSelectedId(item.id)} onItemPointerDown={workflowMode === "direct" ? startGeometryDrag : undefined} onModelPointerMove={(point, event) => moveGeometryDrag(point, event.pointerId)} onModelPointerUp={(_, event) => finishGeometryDrag(event.pointerId)} onModelPointerCancel={(event) => finishGeometryDrag(event.pointerId)} /></div></div>
            {!visibleBasicItemCount && activeStep.id !== "room" && <div className="site-layout-empty"><b>{activeStep.label} 모양을 선택해 도면을 시작하세요.</b><span>모바일에서는 그림을 누른 뒤 도면의 위치를 터치하세요.</span></div>}
            <small className="site-layout-coordinates">X 8,410.000&nbsp;&nbsp;Y 4,215.000&nbsp;&nbsp;Z 0.000</small>
          </div>
        </main>

        <aside className="site-layout-inspector">
          <div><b>레이어</b><span>화면 표시와 객체 속성을 제어합니다.</span></div>
          <div className="site-layout-layer-list"><div><i className="wall" /><span>A-WALL RC 벽체</span><b>ON</b></div>{(["opening", "structure", "fixture"] as LayoutLayer[]).map((layer) => { const meta: Record<LayoutLayer, [string, string]> = { opening: ["A-OPEN 문·창호", "opening"], structure: ["A-STRC 기둥·보", "structure"], fixture: ["M-FIX 고정 시설", "fixture"], equipment: ["E-EQPM 제품 장비", "equipment"], note: ["A-NOTE 주석", "note"] }; return <button key={layer} type="button" aria-pressed={visibleLayers[layer]} onClick={() => setVisibleLayers((current) => ({ ...current, [layer]: !current[layer] }))}><i className={meta[layer][1]} /><span>{meta[layer][0]}</span><b>{visibleLayers[layer] ? "ON" : "OFF"}</b></button>; })}</div>
          <div className="site-layout-object-head"><b>{selectedItem ? selectedItem.name : "선택 객체"}</b><span>{selectedPreset?.code ?? "객체를 선택하세요."}</span></div>
          {selectedItem && selectedPreset && itemLayer(selectedItem) !== "equipment" ? <div className="site-layout-inspector-form">
            <div className="site-layout-inspector-preview"><CadSymbol symbol={selectedPreset.id} /><span>{selectedPreset.label}</span></div>
            <label><span>이름</span><input value={selectedItem.name} onChange={(event) => updateSelected({ name: event.target.value.slice(0, 60) })} /></label>
            {selectedItem.kind === "pillar" && <div className="site-layout-structure-fields site-layout-pillar-mode-fields">
              <div className="site-layout-choice-grid two" role="group" aria-label="기둥 배치 방식">
                <button type="button" className={selectedItem.structureAttachment?.mode === "wall" ? "active" : ""} onClick={() => setGuidedPillarAttachment(selectedItem, "wall")}>벽 부착 기둥</button>
                <button type="button" className={selectedItem.structureAttachment?.mode !== "wall" ? "active" : ""} onClick={() => setGuidedPillarAttachment(selectedItem, "free")}>실내 독립 기둥</button>
              </div>
            </div>}
            <div className={`site-layout-size-fields ${selectedItem.presetId === "aircon-ceiling" ? "is-square" : ""}`}>
              {selectedItem.kind === "door" || selectedItem.kind === "window" ? <>
                <label><span>{selectedItem.kind === "door" ? "문틀 전체 폭" : "창틀 전체 폭"}(mm)</span><MillimeterInput label={selectedItem.kind === "door" ? "문틀 전체 폭(mm)" : "창틀 전체 폭(mm)"} valueMeters={selectedItem.width} minMm={300} maxMm={Math.round(((selectedItem.wall === "left" || selectedItem.wall === "right") ? draft.roomHeight : draft.roomWidth) * 1000)} onCommit={updateOpeningWidth} /></label>
                <label><span>{selectedItem.kind === "door" ? "문틀 전체 높이" : "창틀 전체 높이"}(mm)</span><MillimeterInput label={selectedItem.kind === "door" ? "문틀 전체 높이(mm)" : "창틀 전체 높이(mm)"} valueMeters={selectedItem.openingHeight ?? (selectedItem.kind === "door" ? 2.1 : 1.5)} minMm={300} maxMm={Math.round(Math.max(0.3, ceilingHeight - (selectedItem.kind === "window" ? selectedItem.sillHeight ?? 0.9 : 0)) * 1000)} onCommit={updateOpeningHeight} /></label>
              </> : selectedItem.presetId === "aircon-ceiling" ? <label><span>정사각형 한 변(m)</span><FriendlyNumberInput label="천장형 에어컨 한 변(m)" value={selectedItem.width} min={0.3} max={3} onCommit={(value) => updateSelectedDimension("width", value)} /></label> : <>
                <label><span>가로(m)</span><FriendlyNumberInput label="객체 가로(m)" value={selectedItem.width} min={0.1} max={30} onCommit={(value) => updateSelectedDimension("width", value)} /></label>
                <label><span>세로(m)</span><FriendlyNumberInput label="객체 세로(m)" value={selectedItem.height} min={0.1} max={30} onCommit={(value) => updateSelectedDimension("height", value)} /></label>
              </>}
            </div>
            {(selectedItem.kind === "door" || selectedItem.kind === "window") && <div className="site-layout-opening-fields">
              <label><span>설치 벽</span><select value={selectedItem.wall ?? "top"} onChange={(event) => updateWallMountedWall(event.target.value as WallSide)}><option value="top">상단 A벽</option><option value="right">우측 B벽</option><option value="bottom">하단 C벽</option><option value="left">좌측 D벽</option></select></label>
              <label><span>거리 기준</span><select value={selectedItem.offsetReference ?? "start"} onChange={(event) => updateSelected({ offsetReference: event.target.value as OffsetReference })}><option value="start">{wallReferenceLabels(selectedItem.wall ?? "top").start}</option><option value="end">{wallReferenceLabels(selectedItem.wall ?? "top").end}</option></select></label>
              <label><span>기준 모서리→{selectedItem.kind === "door" ? "문틀" : "창틀"}(mm)</span><MillimeterInput label={selectedItem.kind === "door" ? "기준 모서리에서 문틀(mm)" : "기준 모서리에서 창틀(mm)"} valueMeters={displayedWallDistance(selectedItem)} minMm={0} maxMm={Math.round(Math.max(0, ((selectedItem.wall === "left" || selectedItem.wall === "right") ? draft.roomHeight : draft.roomWidth) - selectedItem.width) * 1000)} onCommit={(value) => { const start = selectedItem.offsetReference === "end" ? Math.max(0, wallLength(selectedItem) - selectedItem.width - value) : value; updateOpeningOffset(start); }} /></label>
              {selectedItem.kind === "window" && <label><span>창 하단 높이(mm)</span><MillimeterInput label="창 하단 높이(mm)" valueMeters={selectedItem.sillHeight ?? 0.9} minMm={0} maxMm={Math.round(Math.max(0, ceilingHeight - (selectedItem.openingHeight ?? 1.5)) * 1000)} onCommit={updateWindowSill} /></label>}
              {selectedItem.kind === "window" && previousWindow(selectedItem) && <label><span>연속 창호 측정</span><select value={selectedItem.openingMeasurement?.referenceType ?? "wall"} onChange={(event) => { const reference = previousWindow(selectedItem); if (event.target.value === "item" && reference) updateWindowMeasurement(selectedItem, { axis: selectedItem.wall === "left" || selectedItem.wall === "right" ? "y" : "x", referenceType: "item", referenceItemId: reference.id, direction: 1, distanceMode: "clear", distanceMm: selectedItem.openingMeasurement?.distanceMm ?? 1000 }); else updateWindowMeasurement(selectedItem, wallMeasurement(selectedItem.wall ?? "top", selectedItem.offsetReference ?? "start", displayedWallDistance(selectedItem))); }}><option value="wall">벽 모서리 기준</option><option value="item">이전 창호 기준</option></select></label>}
              {selectedItem.kind === "window" && selectedItem.openingMeasurement?.referenceType === "item" && <label><span>이전 창호→현재 창호 거리(m)</span><FriendlyNumberInput label="창호 사이 거리(m)" value={(selectedItem.openingMeasurement.distanceMm || 0) / 1000} min={0} max={30} onCommit={(value) => updateWindowMeasurement(selectedItem, { ...selectedItem.openingMeasurement!, distanceMm: Math.round(value * 1000) })} /></label>}
              {selectedItem.kind === "door" && <label><span>경첩·열림 방향</span><select value={selectedItem.handing ?? "left"} onChange={(event) => updateSelected({ handing: event.target.value as OpeningHand })}><option value="left">좌경첩</option><option value="right">우경첩</option></select></label>}
              {selectedItem.kind === "door" && <label><span>실내·실외 열림</span><select value={selectedItem.swing ?? "inside"} onChange={(event) => updateSelected({ swing: event.target.value as OpeningSwing })}><option value="inside">실 안쪽으로</option><option value="outside">실 바깥쪽으로</option></select></label>}
            </div>}
            {selectedItem.presetId === "aircon-wall" && <div className="site-layout-opening-fields site-layout-aircon-fields">
              <label><span>설치 벽</span><select value={selectedItem.wall ?? "top"} onChange={(event) => updateWallMountedWall(event.target.value as WallSide)}><option value="top">상단 A벽</option><option value="right">우측 B벽</option><option value="bottom">하단 C벽</option><option value="left">좌측 D벽</option></select></label>
              <label><span>모서리→에어컨 중심(m)</span><FriendlyNumberInput label="모서리에서 에어컨 중심(m)" value={selectedItem.offset ?? selectedItem.width / 2} min={0} max={(selectedItem.wall === "left" || selectedItem.wall === "right") ? draft.roomHeight : draft.roomWidth} onCommit={updateWallMountedOffset} /></label>
              <label><span>바닥→에어컨 하단(m)</span><FriendlyNumberInput label="바닥에서 에어컨 하단(m)" value={selectedItem.mountingHeight ?? 2.1} min={0} max={10} onCommit={(value) => updateSelected({ mountingHeight: value })} /></label>
            </div>}
            {!isWallMounted(selectedItem) && selectedItem.kind !== "pillar" && <div className="site-layout-reference-fields">
              <label><span>좌측 D벽→중심(m)</span><FriendlyNumberInput label="좌측 D벽 기준거리(m)" value={centerDistance(selectedItem, "x")} min={0} max={draft.roomWidth} onCommit={(value) => updateCenterDistance("x", value)} /></label>
              <label><span>상단 A벽→중심(m)</span><FriendlyNumberInput label="상단 A벽 기준거리(m)" value={centerDistance(selectedItem, "y")} min={0} max={draft.roomHeight} onCommit={(value) => updateCenterDistance("y", value)} /></label>
            </div>}
            {selectedItem.kind === "pillar" && selectedItem.structureAttachment?.mode !== "wall" && <div className="site-layout-reference-fields site-layout-free-pillar-fields">
              <label><span>가로 기준벽</span><select value={selectedItem.freeReferenceX ?? "left"} onChange={(event) => updateSelectedById(selectedItem.id, { freeReferenceX: event.target.value as "left" | "right" })}><option value="left">좌측 D벽</option><option value="right">우측 B벽</option></select></label>
              <label><span>{selectedItem.freeReferenceX === "right" ? "우측 B벽" : "좌측 D벽"}→기둥 면(mm)</span><MillimeterInput label="가로 기준벽에서 기둥 면까지(mm)" valueMeters={freePillarDistance(selectedItem, "x")} minMm={0} maxMm={Math.round(Math.max(0, draft.roomWidth - structureFootprint(selectedItem).width) * 1000)} onCommit={(value) => updateFreePillarDistance(selectedItem, "x", selectedItem.freeReferenceX ?? "left", value)} /></label>
              <label><span>세로 기준벽</span><select value={selectedItem.freeReferenceY ?? "top"} onChange={(event) => updateSelectedById(selectedItem.id, { freeReferenceY: event.target.value as "top" | "bottom" })}><option value="top">상단 A벽</option><option value="bottom">하단 C벽</option></select></label>
              <label><span>{selectedItem.freeReferenceY === "bottom" ? "하단 C벽" : "상단 A벽"}→기둥 면(mm)</span><MillimeterInput label="세로 기준벽에서 기둥 면까지(mm)" valueMeters={freePillarDistance(selectedItem, "y")} minMm={0} maxMm={Math.round(Math.max(0, draft.roomHeight - structureFootprint(selectedItem).height) * 1000)} onCommit={(value) => updateFreePillarDistance(selectedItem, "y", selectedItem.freeReferenceY ?? "top", value)} /></label>
            </div>}
            {selectedItem.presetId === "aircon-ceiling" && <div className="site-layout-structure-fields"><label><span>바닥→설치면 높이(m)</span><FriendlyNumberInput label="바닥에서 설치면 높이(m)" value={selectedItem.mountingHeight ?? ceilingHeight} min={0} max={20} onCommit={(value) => updateSelected({ mountingHeight: value })} /></label></div>}
            {selectedItem.kind === "beam" && <div className="site-layout-structure-fields">
              <label><span>바닥→보 하단(m)</span><FriendlyNumberInput label="바닥에서 보 하단(m)" value={selectedItem.beamBottomHeight ?? 2.2} min={0} max={20} onCommit={(value) => updateSelected({ beamBottomHeight: value })} /></label>
              <label><span>{selectedItem.structureMeasurement?.referenceType === "item" ? "기준 보에서 거리(m)" : "기준 모서리→보 시작면 거리(m)"}</span><FriendlyNumberInput label="보 기준거리(m)" value={selectedItem.structureMeasurement ? selectedItem.structureMeasurement.distanceMm / 1000 : displayedWallDistance(selectedItem)} min={0} max={30} onCommit={(value) => updateBeamDistanceFromInspector(selectedItem, value)} /></label>
            </div>}
            {selectedItem.kind === "pillar" && selectedItem.structureAttachment?.mode === "wall" && <div className="site-layout-structure-fields">
              <label><span>설치 벽</span><select value={selectedItem.wall ?? "top"} onChange={(event) => selectGuidedWall(selectedItem, event.target.value as WallSide)}><option value="top">상단 A벽</option><option value="right">우측 B벽</option><option value="bottom">하단 C벽</option><option value="left">좌측 D벽</option></select></label>
              <label><span>벽→기둥 면 직각거리(mm)</span><MillimeterInput label="벽에서 기둥 면 직각거리(mm)" valueMeters={selectedItem.wallInset ?? 0} minMm={0} maxMm={Math.round(Math.max(0, ((selectedItem.wall === "left" || selectedItem.wall === "right") ? draft.roomWidth - structureFootprint(selectedItem).width : draft.roomHeight - structureFootprint(selectedItem).height)) * 1000)} onCommit={(value) => updatePillarWallInset(selectedItem, value)} /></label>
              <label><span>{selectedItem.structureMeasurement?.referenceType === "item" ? "이전 기둥 끝면→현재 기둥 시작면(m)" : "기준 모서리→기둥 시작면(m)"}</span><FriendlyNumberInput label="기둥 기준거리(m)" value={selectedItem.structureMeasurement ? selectedItem.structureMeasurement.distanceMm / 1000 : displayedWallDistance(selectedItem)} min={0} max={30} onCommit={(value) => updatePillarDistanceFromInspector(selectedItem, value)} /></label>
            </div>}
            <div className="site-layout-object-facts"><span>블록명 <b>{selectedPreset.code}</b></span><span>레이어 <b>{itemLayer(selectedItem).toUpperCase()}</b></span><span>스냅 <b>{isWallMounted(selectedItem) ? `${wallLabel(selectedItem.wall)} 기준거리` : selectedItem.kind === "pillar" ? "두 기준벽→기둥 면거리" : "두 벽 중심거리"}</b></span></div>
            {selectedPreset.guide && <div className="site-layout-install-guide"><span>현장 확인</span><p>{selectedPreset.guide}</p></div>}
            <div className="site-layout-inspector-actions">{!isWallMounted(selectedItem) && <button type="button" onClick={() => updateSelected({ rotation: selectedItem.rotation === 90 ? 0 : 90 })}>90° 회전</button>}<button type="button" onClick={duplicateSelected}>복사</button><button type="button" className="danger" onClick={removeSelected}>삭제</button></div>
          </div> : <div className="site-layout-inspector-empty"><b>{activeStep.id === "room" ? "공간 크기를 먼저 입력하세요." : "배치한 블록을 선택하세요."}</b><span>선택하면 실제 치수와 설치 벽·기준 거리를 조정할 수 있습니다.</span></div>}
        </aside>
      </div>
      <div ref={exportBoardRef} className="site-layout-export-source" aria-hidden="true"><SiteLayoutGeometryView draft={physicalDraft} mode="paper" paddingMm={650} interactive={false} showDimensions showLabels isItemVisible={(item) => { const legacy = draft.items.find((candidate) => candidate.id === item.id); return Boolean(legacy && itemLayer(legacy) !== "equipment" && itemLayer(legacy) !== "note"); }} /></div>
      {workflowMode === "guided" && selectedItem && <div className="site-layout-guided-selection-bar" role="group" aria-label="선택 객체 빠른 작업" style={{ position: "fixed", left: 12, right: 12, bottom: 72, zIndex: canvasExpanded ? 220 : 60, display: "grid", gridTemplateColumns: "minmax(0,1fr) repeat(3,auto)", alignItems: "center", gap: 8, maxWidth: 720, margin: "0 auto", padding: "10px 12px", border: "1px solid #cfd8ea", borderRadius: 14, background: "rgba(255,255,255,.98)", boxShadow: "0 -8px 24px rgba(25,43,80,.16)" }}><div style={{ minWidth: 0 }}><b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedItem.name}</b><small>{presetForItem(selectedItem).label} · {formatMillimeters(selectedItem.width)}mm</small></div><button type="button" onClick={() => editGuidedItem(selectedItem)}>수정</button><button type="button" onClick={() => duplicateGuidedItem(selectedItem)}>복사</button><button type="button" className="danger" onClick={() => removeItemById(selectedItem.id)}>삭제</button></div>}
      {workflowMode === "guided" ? <div className="site-layout-step-actions site-layout-question-navigation"><button type="button" onClick={questionPrevious} disabled={activeStepIndex === 0 && activeQuestionIndex === 0}>이전 질문</button><div><b>{activeStepIndex + 1}단계 · {activeStep.label}</b><span>{currentQuestionNumber}/{currentQuestionCount} 질문 · 자동 복구 중</span></div>{activeStep.id === "review" ? <button type="button" className="primary" onClick={() => void saveCurrentDraft()}>기관 도면 저장</button> : <button type="button" className="primary" onClick={questionNext}>{activeQuestionIndex === currentQuestionCount - 1 ? "단계 완료·다음" : "다음 질문"}</button>}</div> : <div className="site-layout-step-actions"><button type="button" onClick={() => goToStep(activeStepIndex - 1)} disabled={activeStepIndex === 0}>이전</button><div><b>{activeStepIndex + 1}/{guideSteps.length} · {activeStep.label}</b><span>입력 내용은 이 기기에 자동 복구됩니다.</span></div>{activeStep.id === "review" ? <button type="button" className="primary" onClick={() => void downloadCurrentPdf()}>CAD팀 전달 PDF</button> : <button type="button" className="primary" onClick={goNextStep}>저장하고 다음</button>}</div>}
      <footer className="site-layout-statusbar"><div><b>SNAP</b><b>ORTHO</b><b>OSNAP</b><span>GRID 10</span></div><p>도면 단위 mm · 기관별 DB 및 Google Drive 저장 · CAD팀 전달용 기초도면</p></footer>
    </section>
  );
}
