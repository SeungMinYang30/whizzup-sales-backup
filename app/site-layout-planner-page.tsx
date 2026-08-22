"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type LayoutItemKind = "equipment" | "table" | "door" | "window" | "pillar" | "note";
type LayoutSymbol =
  | "equipment" | "screen" | "kiosk" | "vision-sensor" | "lidar-sensor" | "shooting-sensor"
  | "motion-3d" | "ifit-premium" | "ifit-slim" | "touch-table" | "action-floor" | "power-lan"
  | "table" | "chair" | "door-single" | "door-double" | "door-sliding"
  | "window-3" | "window-4" | "window-6" | "pillar" | "note";
type LayoutView = "model" | "paper";
type LayoutLayer = "opening" | "equipment" | "note";
type PresetGroup = "문" | "창호" | "에어패스 시스템" | "공통 장비·가구" | "기타";

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
};

type LayoutDraft = {
  roomName: string;
  roomWidth: number;
  roomHeight: number;
  roomCeilingHeight?: number;
  items: LayoutItem[];
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

const itemPresets: ItemPreset[] = [
  { id: "door-single", kind: "door", group: "문", label: "단문형", defaultName: "단문형 출입문", code: "A-DR01", width: 0.9, height: 0.18, guide: "힌지와 90° 개폐 반경을 함께 표시합니다." },
  { id: "door-double", kind: "door", group: "문", label: "양문형", defaultName: "양문형 출입문", code: "A-DR02", width: 1.8, height: 0.18, guide: "두 문짝의 개폐 반경과 중심선을 표시합니다." },
  { id: "door-sliding", kind: "door", group: "문", label: "미닫이", defaultName: "미닫이문", code: "A-DR03", width: 1.8, height: 0.14, guide: "문짝 겹침과 이동 방향을 평면 심벌로 표시합니다." },
  { id: "window-3", kind: "window", group: "창호", label: "3분할", defaultName: "3분할 창호", code: "A-W03", width: 2.1, height: 0.14 },
  { id: "window-4", kind: "window", group: "창호", label: "4분할", defaultName: "4분할 창호", code: "A-W04", width: 2.7, height: 0.14 },
  { id: "window-6", kind: "window", group: "창호", label: "6분할", defaultName: "6분할 창호", code: "A-W06", width: 4.1, height: 0.14 },
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
  { id: "pillar", kind: "pillar", group: "기타", label: "기둥", defaultName: "콘크리트 기둥", code: "A-C01", width: 0.45, height: 0.45 },
  { id: "note", kind: "note", group: "기타", label: "현장 메모", defaultName: "현장 확인 사항", code: "A-N01", width: 1.8, height: 0.65 },
];

const defaultDraft: LayoutDraft = { roomName: "스마트 체험교실", roomWidth: 13.724, roomHeight: 8.146, roomCeilingHeight: 2.551, items: [] };
const groups: PresetGroup[] = ["문", "창호", "에어패스 시스템", "공통 장비·가구", "기타"];

function positiveDimension(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0.1, Math.round(value * 1000) / 1000));
}
function clampPercent(value: number) { return Math.min(96, Math.max(0, value)); }
function snapGrid(value: number) { return clampPercent(Math.round(value * 5) / 5); }
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
  if (item.kind === "note") return "note";
  return "equipment";
}
function formatMillimeters(meters: number) { return new Intl.NumberFormat("ko-KR").format(Math.round(meters * 1000)); }

function CadSymbol({ symbol, compact = false }: { symbol: LayoutSymbol; compact?: boolean }) {
  const panels = symbol.startsWith("window-") ? Number(symbol.split("-")[1]) || 3 : 0;
  const shared = { vectorEffect: "non-scaling-stroke" as const };
  return (
    <svg className="site-layout-cad-symbol" viewBox="0 0 100 70" preserveAspectRatio="none" aria-hidden="true">
      {symbol === "door-single" && <><path {...shared} d="M4 66H96 M8 66V10 M8 10L72 66 M8 10A56 56 0 0 1 64 66" /><circle cx="8" cy="66" r="2.5" /></>}
      {symbol === "door-double" && <><path {...shared} d="M4 66H96 M50 66V12 M50 12L7 66 M50 12L93 66 M50 12A43 43 0 0 0 7 55 M50 12A43 43 0 0 1 93 55" /><circle cx="50" cy="66" r="2.5" /></>}
      {symbol === "door-sliding" && <><path {...shared} d="M4 57H96 M4 66H96 M12 45H58V62H12Z M42 40H88V57H42Z M18 33H78 M72 27L80 33L72 39" /></>}
      {panels > 0 && <><path {...shared} d="M3 26H97V45H3Z M3 31H97 M3 40H97" />{Array.from({ length: panels - 1 }, (_, index) => <path key={index} {...shared} d={`M${((index + 1) * 94) / panels + 3} 26V45`} />)}</>}
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
      {symbol === "pillar" && <><rect x="14" y="7" width="72" height="56" />{Array.from({ length: 9 }, (_, index) => <path key={index} {...shared} d={`M${-15 + index * 16} 63L${35 + index * 16} 7`} />)}</>}
      {symbol === "note" && <><path {...shared} d="M7 12H78L93 27V61H7Z M78 12V27H93" /><path {...shared} d="M17 30H72 M17 40H82 M17 50H62" /></>}
      {!compact && <path className="cad-center" {...shared} d="M1 35H99" />}
    </svg>
  );
}

export default function SiteLayoutPlannerPage() {
  const [draft, setDraft] = useState<LayoutDraft>(defaultDraft);
  const [selectedId, setSelectedId] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<LayoutView>("model");
  const [activeTool, setActiveTool] = useState("선택");
  const [command, setCommand] = useState("명령: 실 크기를 확인하고 표준 블록을 선택하세요.");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [visibleLayers, setVisibleLayers] = useState<Record<LayoutLayer, boolean>>({ opening: true, equipment: true, note: true });
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const parsed: unknown = stored ? JSON.parse(stored) : null;
        if (validStoredDraft(parsed)) {
          setDraft({ roomName: parsed.roomName.slice(0, 80) || defaultDraft.roomName, roomWidth: positiveDimension(parsed.roomWidth, defaultDraft.roomWidth), roomHeight: positiveDimension(parsed.roomHeight, defaultDraft.roomHeight), roomCeilingHeight: positiveDimension(parsed.roomCeilingHeight ?? defaultDraft.roomCeilingHeight ?? 2.7, 2.7), items: parsed.items.filter(validStoredItem).map((item) => ({ ...item, presetId: presetForItem(item).id, name: item.name.slice(0, 60), x: clampPercent(item.x), y: clampPercent(item.y), width: positiveDimension(item.width, 1), height: positiveDimension(item.height, 1) })) });
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
  const roomRatio = Math.min(1.85, Math.max(0.72, draft.roomWidth / draft.roomHeight));
  const ceilingHeight = draft.roomCeilingHeight ?? 2.7;
  const filteredPresets = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase("ko-KR");
    if (!query) return itemPresets;
    return itemPresets.filter((preset) => [preset.label, preset.defaultName, preset.code, preset.catalogName, preset.catalogSpecification].some((value) => value?.toLocaleLowerCase("ko-KR").includes(query)));
  }, [libraryQuery]);

  function updateDraft(patch: Partial<LayoutDraft>) { setDraft((current) => ({ ...current, ...patch })); }
  function updateSelected(patch: Partial<LayoutItem>) {
    if (!selectedId) return;
    setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === selectedId ? { ...item, ...patch } : item) }));
  }
  function generateRoom() {
    setView("model");
    setCommand(`명령: RC 벽체 t=150 · ${formatMillimeters(draft.roomWidth)} × ${formatMillimeters(draft.roomHeight)}mm 교실을 생성했습니다.`);
  }
  function makeItem(presetId: LayoutSymbol, x: number, y: number, rotation: 0 | 90 = 0, suffix = ""): LayoutItem {
    const preset = itemPresets.find((item) => item.id === presetId) ?? itemPresets[0];
    return { id: crypto.randomUUID(), kind: preset.kind, presetId: preset.id, name: `${preset.defaultName}${suffix}`, x, y, width: preset.width, height: preset.height, rotation };
  }
  function addItem(presetId: LayoutSymbol) {
    const preset = itemPresets.find((item) => item.id === presetId) ?? itemPresets[0];
    const samePresetCount = draft.items.filter((item) => presetForItem(item).id === preset.id).length;
    const isOpening = preset.kind === "door" || preset.kind === "window";
    const item = makeItem(presetId, isOpening ? 12 + ((samePresetCount * 18) % 55) : 18 + ((draft.items.length * 9) % 42), isOpening ? 0 : 22 + ((draft.items.length * 11) % 42), 0, samePresetCount ? ` ${samePresetCount + 1}` : "");
    setDraft((current) => ({ ...current, items: [...current.items, item] }));
    setSelectedId(item.id); setView("model");
    setCommand(`명령: ${preset.label} ${preset.code} 추가됨 · ${preset.catalogName ? "제품 DB 명칭과 연결된 블록입니다." : "원하는 위치로 드래그하세요."}`);
  }
  function applyExperienceRoomTemplate() {
    if (draft.items.length && !window.confirm("현재 배치를 지우고 에어패스 VR 스포츠실 예시를 적용할까요?")) return;
    const items = [makeItem("screen", 32, 0), makeItem("vision-sensor", 47, 7), makeItem("equipment", 47, 24), makeItem("kiosk", 82, 76), makeItem("lidar-sensor", 20, 68), makeItem("motion-3d", 66, 56), makeItem("power-lan", 29, 4), makeItem("power-lan", 62, 4, 0, " 2"), makeItem("door-double", 74, 96), makeItem("window-6", 15, 0)];
    setDraft((current) => ({ ...current, roomName: current.roomName || "VR 스포츠실", items }));
    setSelectedId(items[0].id); setView("model");
    setCommand("명령: DWG·브로셔·제품 DB 기준 VR 스포츠실 예시 배치를 적용했습니다.");
  }
  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, item: LayoutItem) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: item.id, pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startX: item.x, startY: item.y };
    setSelectedId(item.id); setActiveTool("이동");
  }
  function snapOpening(item: LayoutItem, x: number, y: number) {
    if (item.kind !== "door" && item.kind !== "window") return { x: snapGrid(x), y: snapGrid(y), rotation: item.rotation };
    const edges = [
      { distance: y, x: snapGrid(x), y: 0, rotation: 0 as const },
      { distance: 96 - y, x: snapGrid(x), y: 96, rotation: 0 as const },
      { distance: x, x: 0, y: snapGrid(y), rotation: 90 as const },
      { distance: 96 - x, x: 96, y: snapGrid(y), rotation: 90 as const },
    ];
    return edges.sort((a, b) => a.distance - b.distance)[0];
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const active = dragRef.current; const board = boardRef.current;
    if (!active || active.pointerId !== event.pointerId || !board) return;
    const bounds = board.getBoundingClientRect(); if (!bounds.width || !bounds.height) return;
    const nextX = active.startX + ((event.clientX - active.startClientX) / bounds.width) * 100;
    const nextY = active.startY + ((event.clientY - active.startClientY) / bounds.height) * 100;
    setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === active.id ? { ...item, ...snapOpening(item, nextX, nextY) } : item) }));
  }
  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null; setActiveTool("선택"); setCommand("명령: 객체 이동 완료 · 10mm 그리드와 벽 스냅을 적용했습니다.");
  }
  function duplicateSelected() {
    if (!selectedItem) return;
    const copy = { ...selectedItem, id: crypto.randomUUID(), name: `${selectedItem.name} 복사`, x: clampPercent(selectedItem.x + 4), y: clampPercent(selectedItem.y + 4) };
    setDraft((current) => ({ ...current, items: [...current.items, copy] })); setSelectedId(copy.id);
  }
  function removeSelected() {
    if (!selectedId) return;
    setDraft((current) => ({ ...current, items: current.items.filter((item) => item.id !== selectedId) })); setSelectedId(""); setCommand("명령: 선택 객체를 삭제했습니다.");
  }
  function resetDraft() {
    if (draft.items.length && !window.confirm("현재 배치 요소를 모두 지우고 새로 시작할까요?")) return;
    setDraft(defaultDraft); setSelectedId(""); setCommand("명령: 새 배치도를 준비했습니다.");
  }
  function renderItems(className: string) {
    return draft.items.filter((item) => visibleLayers[itemLayer(item)]).map((item) => {
      const preset = presetForItem(item); const isOpening = item.kind === "door" || item.kind === "window";
      const symbolWidth = (item.width / draft.roomWidth) * 100;
      const footprintHeight = item.kind === "door" ? (item.width * 0.72 / draft.roomHeight) * 100 : (item.height / draft.roomHeight) * 100;
      const rotated = item.rotation === 90;
      const widthPercent = rotated ? footprintHeight : symbolWidth; const heightPercent = rotated ? symbolWidth : footprintHeight;
      return (
        <button key={`${className}-${item.id}`} type="button" className={`${className} kind-${item.kind} symbol-${preset.id} ${selectedId === item.id ? "selected" : ""}`}
          style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${Math.min(44, Math.max(isOpening ? 5 : 3.6, widthPercent))}%`, height: `${Math.min(44, Math.max(item.kind === "window" ? 2.5 : isOpening ? 5 : 4.5, heightPercent))}%` }}
          onPointerDown={className === "site-layout-item" ? (event) => startDrag(event, item) : undefined} onClick={() => setSelectedId(item.id)} aria-label={`${item.name} ${className === "site-layout-item" ? "이동" : "선택"}`}>
          <CadSymbol symbol={preset.id} />
          <span className="site-layout-item-caption"><b>{item.name}</b><small>{preset.code}</small></span>
        </button>
      );
    });
  }

  return (
    <section className="site-layout-planner" aria-label="현장 배치도 CAD 편집기">
      <header className="site-layout-intro">
        <div className="site-layout-brand"><span>W</span><div><b>현장 배치도</b><small>WHIZZUP LAYOUT STUDIO · CAD BLOCK BETA</small></div></div>
        <div className="site-layout-header-actions"><div className="site-layout-save-state" role="status"><b>{savedAt ? "자동 저장됨" : "배치도 준비됨"}</b><small>{savedAt || "실 크기를 입력해 주세요."}</small></div><button type="button" onClick={() => setView("paper")}>A3 출력 미리보기</button></div>
      </header>

      <div className="site-layout-room-settings">
        <label><span>실 이름</span><input value={draft.roomName} onChange={(event) => updateDraft({ roomName: event.target.value.slice(0, 80) })} placeholder="예: 스마트 체험교실" /></label>
        <label><span>가로</span><div><input type="number" min="0.1" max="100" step="0.001" value={draft.roomWidth} onChange={(event) => updateDraft({ roomWidth: positiveDimension(Number(event.target.value), draft.roomWidth) })} /><em>m</em></div></label>
        <label><span>세로</span><div><input type="number" min="0.1" max="100" step="0.001" value={draft.roomHeight} onChange={(event) => updateDraft({ roomHeight: positiveDimension(Number(event.target.value), draft.roomHeight) })} /><em>m</em></div></label>
        <label><span>높이</span><div><input type="number" min="0.1" max="20" step="0.001" value={ceilingHeight} onChange={(event) => updateDraft({ roomCeilingHeight: positiveDimension(Number(event.target.value), ceilingHeight) })} /><em>m</em></div></label>
        <button type="button" className="site-layout-generate" onClick={generateRoom}>교실 자동 생성</button>
        <button type="button" className="site-layout-template" onClick={applyExperienceRoomTemplate}>VR 스포츠실 예시</button>
        <button type="button" className="site-layout-reset" onClick={resetDraft}>새 도면</button>
      </div>

      <div className="site-layout-commandbar"><div>{["선택", "이동", "치수", "회전"].map((tool) => <button key={tool} type="button" className={activeTool === tool ? "active" : ""} onClick={() => { setActiveTool(tool); setCommand(`명령: ${tool} 도구가 활성화되었습니다.`); }}>{tool}</button>)}</div><p aria-live="polite">{command}</p></div>

      <div className="site-layout-workspace">
        <aside className="site-layout-library">
          <div><b>CAD 블록 라이브러리</b><span>DWG·브로셔·제품 DB 기준 표준 블록입니다.</span></div>
          <label className="site-layout-library-search"><span>장비 검색</span><input type="search" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="아이핏, 센서, 문…" /></label>
          {groups.map((group) => {
            const presets = filteredPresets.filter((preset) => preset.group === group); if (!presets.length) return null;
            return <section key={group} className="site-layout-library-section"><h3>{group}<small>{presets.length}</small></h3><div className="site-layout-library-grid">{presets.map((preset) => <button key={preset.id} type="button" className={`kind-${preset.kind} symbol-${preset.id}`} onClick={() => addItem(preset.id)}><CadSymbol symbol={preset.id} compact /><span>{preset.label}</span><small>{preset.code} · {preset.width}m</small>{preset.catalogName && <em>DB</em>}</button>)}</div></section>;
          })}
          {!filteredPresets.length && <p className="site-layout-library-empty">일치하는 CAD 블록이 없습니다.</p>}
        </aside>

        <main className={`site-layout-canvas-panel view-${view}`}>
          <div className="site-layout-canvas-head"><div><button type="button" className={view === "model" ? "active" : ""} onClick={() => setView("model")}>모델</button><button type="button" className={view === "paper" ? "active" : ""} onClick={() => setView("paper")}>A3 출력</button></div><span>TOP · 1:60 · mm</span></div>
          <div className="site-layout-model-space">
            <div className="site-layout-ruler top"><span>{formatMillimeters(draft.roomWidth)} mm</span></div>
            <div className="site-layout-board-wrap" style={{ maxWidth: `${Math.round(720 * roomRatio)}px` }}><div ref={boardRef} className="site-layout-board" style={{ aspectRatio: `${draft.roomWidth} / ${draft.roomHeight}` }} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onPointerDown={(event) => { if (event.target === event.currentTarget) setSelectedId(""); }}><div className="site-layout-room-label"><b>RC 벽체 t=150</b><span>{draft.roomName} · 천장 H={formatMillimeters(ceilingHeight)}</span></div>{renderItems("site-layout-item")}<div className="site-layout-axis-label axis-x">X</div><div className="site-layout-axis-label axis-y">Y</div><div className="site-layout-crosshair" aria-hidden="true" /></div></div>
            <div className="site-layout-ruler side"><span>{formatMillimeters(draft.roomHeight)} mm</span></div>
            {!draft.items.length && <div className="site-layout-empty"><b>블록을 선택해 도면을 시작하세요.</b><span>빠른 시작은 상단의 ‘VR 스포츠실 예시’를 누르세요.</span></div>}
            <small className="site-layout-coordinates">X 8,410.000&nbsp;&nbsp;Y 4,215.000&nbsp;&nbsp;Z 0.000</small>
          </div>
          <div className="site-layout-paper-space"><div className="site-layout-paper-sheet"><div className="site-layout-paper-plan"><div className="site-layout-paper-note">RC 벽체 t=150 / 천장 높이 {formatMillimeters(ceilingHeight)}mm / 현장 실측 기준 예상 도면</div><div className="site-layout-paper-room" style={{ aspectRatio: `${draft.roomWidth} / ${draft.roomHeight}` }}>{renderItems("site-layout-paper-item")}</div><div className="site-layout-paper-title"><b>{draft.roomName} 평면도</b><span>축척 1/60 (A3)</span></div></div><aside className="site-layout-title-block"><strong>{draft.roomName}</strong><section><b>설치 품목</b><p>{draft.items.filter((item) => itemLayer(item) === "equipment").map((item) => presetForItem(item).label).slice(0, 6).join(" · ") || "미배치"}</p></section><section><b>공사 내역</b><p>RC 벽체 · 문·창호 · 전원·LAN</p></section><section><b>NOTE.</b><p>현장 실측 후 감독관 협의<br />센서 시야와 투사거리 확인<br />배선 경로 최종 확인</p></section><dl><dt>PROJECT</dt><dd>{draft.roomName}</dd><dt>DATE</dt><dd>{new Intl.DateTimeFormat("ko-KR").format(new Date())}</dd><dt>SCALE</dt><dd>A3 1/60</dd></dl></aside></div></div>
        </main>

        <aside className="site-layout-inspector">
          <div><b>레이어</b><span>화면 표시와 객체 속성을 제어합니다.</span></div>
          <div className="site-layout-layer-list"><div><i className="wall" /><span>A-WALL RC 벽체</span><b>ON</b></div>{(["opening", "equipment", "note"] as LayoutLayer[]).map((layer) => { const meta = { opening: ["A-OPEN 문·창호", "opening"], equipment: ["E-EQPM 장비·가구", "equipment"], note: ["A-NOTE 주석", "note"] }[layer]; return <button key={layer} type="button" aria-pressed={visibleLayers[layer]} onClick={() => setVisibleLayers((current) => ({ ...current, [layer]: !current[layer] }))}><i className={meta[1]} /><span>{meta[0]}</span><b>{visibleLayers[layer] ? "ON" : "OFF"}</b></button>; })}</div>
          <div className="site-layout-object-head"><b>{selectedItem ? selectedItem.name : "선택 객체"}</b><span>{selectedPreset?.code ?? "객체를 선택하세요."}</span></div>
          {selectedItem && selectedPreset ? <div className="site-layout-inspector-form"><div className="site-layout-inspector-preview"><CadSymbol symbol={selectedPreset.id} /><span>{selectedPreset.label}</span></div><label><span>이름</span><input value={selectedItem.name} onChange={(event) => updateSelected({ name: event.target.value.slice(0, 60) })} /></label><div className="site-layout-size-fields"><label><span>가로(m)</span><input type="number" min="0.1" max="30" step="0.1" value={selectedItem.width} onChange={(event) => updateSelected({ width: positiveDimension(Number(event.target.value), selectedItem.width) })} /></label><label><span>세로(m)</span><input type="number" min="0.1" max="30" step="0.1" value={selectedItem.height} onChange={(event) => updateSelected({ height: positiveDimension(Number(event.target.value), selectedItem.height) })} /></label></div><div className="site-layout-object-facts"><span>블록명 <b>{selectedPreset.code}</b></span><span>레이어 <b>{itemLayer(selectedItem).toUpperCase()}</b></span><span>스냅 <b>{selectedItem.kind === "door" || selectedItem.kind === "window" ? "벽 자동" : "10mm"}</b></span></div>{selectedPreset.catalogName && <div className="site-layout-catalog-match"><span>제품 DB 매칭</span><b>{selectedPreset.catalogName}</b><p>{selectedPreset.catalogSpecification}</p>{selectedPreset.catalogNumber && <small>{selectedPreset.catalogNumber}</small>}</div>}{selectedPreset.guide && <div className="site-layout-install-guide"><span>설치 검토</span><p>{selectedPreset.guide}</p></div>}<div className="site-layout-inspector-actions"><button type="button" onClick={() => updateSelected({ rotation: selectedItem.rotation === 90 ? 0 : 90 })}>90° 회전</button><button type="button" onClick={duplicateSelected}>복사</button><button type="button" className="danger" onClick={removeSelected}>삭제</button></div></div> : <div className="site-layout-inspector-empty"><b>객체를 선택하세요.</b><span>도면 또는 블록 라이브러리에서 장비를 선택하면 제품 DB 연결과 설치 기준을 확인할 수 있습니다.</span></div>}
        </aside>
      </div>
      <footer className="site-layout-statusbar"><div><b>SNAP</b><b>ORTHO</b><b>OSNAP</b><span>GRID 10</span></div><p>도면 단위 mm · 브라우저 자동 저장 · 제품 DB 읽기 참조</p></footer>
    </section>
  );
}
