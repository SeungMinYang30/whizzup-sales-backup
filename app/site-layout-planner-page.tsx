"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type LayoutItemKind = "equipment" | "table" | "door" | "window" | "pillar" | "note";
type LayoutSymbol = "equipment" | "table" | "door-single" | "door-double" | "door-sliding" | "window-3" | "window-4" | "window-6" | "pillar" | "note";
type LayoutView = "model" | "paper";
type LayoutLayer = "opening" | "equipment" | "note";

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
  group: "문" | "창호" | "장비·가구" | "기타";
  label: string;
  defaultName: string;
  code: string;
  width: number;
  height: number;
};

const STORAGE_KEY = "whizzup:site-layout-draft:v1";

const itemPresets: ItemPreset[] = [
  { id: "door-single", kind: "door", group: "문", label: "단문형", defaultName: "단문형 출입문", code: "D-01", width: 0.9, height: 0.18 },
  { id: "door-double", kind: "door", group: "문", label: "양문형", defaultName: "양문형 출입문", code: "D-02", width: 1.8, height: 0.18 },
  { id: "door-sliding", kind: "door", group: "문", label: "미닫이", defaultName: "미닫이문", code: "D-03", width: 1.8, height: 0.14 },
  { id: "window-3", kind: "window", group: "창호", label: "3분할", defaultName: "3분할 창호", code: "W-03", width: 2.1, height: 0.14 },
  { id: "window-4", kind: "window", group: "창호", label: "4분할", defaultName: "4분할 창호", code: "W-04", width: 2.7, height: 0.14 },
  { id: "window-6", kind: "window", group: "창호", label: "6분할", defaultName: "6분할 창호", code: "W-06", width: 4.1, height: 0.14 },
  { id: "equipment", kind: "equipment", group: "장비·가구", label: "장비", defaultName: "빔프로젝터", code: "E-01", width: 0.6, height: 0.6 },
  { id: "table", kind: "table", group: "장비·가구", label: "모듈 책상", defaultName: "모듈형 책상", code: "F-01", width: 1.4, height: 1.4 },
  { id: "pillar", kind: "pillar", group: "기타", label: "기둥", defaultName: "콘크리트 기둥", code: "A-01", width: 0.45, height: 0.45 },
  { id: "note", kind: "note", group: "기타", label: "현장 메모", defaultName: "현장 확인 사항", code: "N-01", width: 1.6, height: 0.55 },
];

const defaultDraft: LayoutDraft = {
  roomName: "스마트 체험교실",
  roomWidth: 13.724,
  roomHeight: 8.146,
  roomCeilingHeight: 2.551,
  items: [],
};

const groups: ItemPreset["group"][] = ["문", "창호", "장비·가구", "기타"];

function positiveDimension(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0.1, Math.round(value * 1000) / 1000));
}

function clampPercent(value: number) {
  return Math.min(96, Math.max(0, value));
}

function validStoredDraft(value: unknown): value is LayoutDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<LayoutDraft>;
  return typeof draft.roomName === "string"
    && Number.isFinite(draft.roomWidth)
    && Number.isFinite(draft.roomHeight)
    && Array.isArray(draft.items);
}

function validStoredItem(value: unknown): value is LayoutItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LayoutItem>;
  return typeof item.id === "string"
    && itemPresets.some((preset) => preset.kind === item.kind)
    && typeof item.name === "string"
    && Number.isFinite(item.x)
    && Number.isFinite(item.y)
    && Number.isFinite(item.width)
    && Number.isFinite(item.height)
    && (item.rotation === 0 || item.rotation === 90);
}

function presetForItem(item: LayoutItem) {
  return itemPresets.find((preset) => preset.id === item.presetId)
    ?? itemPresets.find((preset) => preset.kind === item.kind)
    ?? itemPresets[0];
}

function itemLayer(item: LayoutItem): LayoutLayer {
  if (item.kind === "door" || item.kind === "window") return "opening";
  if (item.kind === "note") return "note";
  return "equipment";
}

function formatMillimeters(meters: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(meters * 1000));
}

export default function SiteLayoutPlannerPage() {
  const [draft, setDraft] = useState<LayoutDraft>(defaultDraft);
  const [selectedId, setSelectedId] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<LayoutView>("model");
  const [activeTool, setActiveTool] = useState("선택");
  const [command, setCommand] = useState("명령: 실 크기를 확인하고 표준 블록을 선택하세요.");
  const [visibleLayers, setVisibleLayers] = useState<Record<LayoutLayer, boolean>>({ opening: true, equipment: true, note: true });
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const parsed: unknown = stored ? JSON.parse(stored) : null;
        if (validStoredDraft(parsed)) {
          setDraft({
            roomName: parsed.roomName.slice(0, 80) || defaultDraft.roomName,
            roomWidth: positiveDimension(parsed.roomWidth, defaultDraft.roomWidth),
            roomHeight: positiveDimension(parsed.roomHeight, defaultDraft.roomHeight),
            roomCeilingHeight: positiveDimension(parsed.roomCeilingHeight ?? defaultDraft.roomCeilingHeight ?? 2.7, 2.7),
            items: parsed.items.filter(validStoredItem).map((item) => ({
              ...item,
              presetId: presetForItem(item).id,
              name: item.name.slice(0, 60),
              x: clampPercent(item.x),
              y: clampPercent(item.y),
              width: positiveDimension(item.width, 1),
              height: positiveDimension(item.height, 1),
            })),
          });
        }
      } catch {
        // A malformed local draft should never block the workspace.
      } finally {
        setHydrated(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    const frame = window.requestAnimationFrame(() => {
      setSavedAt(new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draft, hydrated]);

  const selectedItem = useMemo(() => draft.items.find((item) => item.id === selectedId) ?? null, [draft.items, selectedId]);
  const selectedPreset = selectedItem ? presetForItem(selectedItem) : null;
  const roomRatio = Math.min(1.85, Math.max(0.72, draft.roomWidth / draft.roomHeight));
  const ceilingHeight = draft.roomCeilingHeight ?? 2.7;

  function updateDraft(patch: Partial<LayoutDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateSelected(patch: Partial<LayoutItem>) {
    if (!selectedId) return;
    setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === selectedId ? { ...item, ...patch } : item) }));
  }

  function generateRoom() {
    setView("model");
    setCommand(`명령: RC 벽체 t=150 · ${formatMillimeters(draft.roomWidth)} × ${formatMillimeters(draft.roomHeight)}mm 교실을 생성했습니다.`);
  }

  function addItem(presetId: LayoutSymbol) {
    const preset = itemPresets.find((item) => item.id === presetId) ?? itemPresets[0];
    const samePresetCount = draft.items.filter((item) => presetForItem(item).id === preset.id).length;
    const isOpening = preset.kind === "door" || preset.kind === "window";
    const item: LayoutItem = {
      id: crypto.randomUUID(),
      kind: preset.kind,
      presetId: preset.id,
      name: `${preset.defaultName}${samePresetCount ? ` ${samePresetCount + 1}` : ""}`,
      x: isOpening ? 12 + ((samePresetCount * 18) % 55) : 18 + ((draft.items.length * 9) % 42),
      y: isOpening ? 0 : 22 + ((draft.items.length * 11) % 42),
      width: preset.width,
      height: preset.height,
      rotation: 0,
    };
    setDraft((current) => ({ ...current, items: [...current.items, item] }));
    setSelectedId(item.id);
    setView("model");
    setCommand(`명령: ${preset.label} ${preset.code} 추가됨 · 벽 또는 원하는 위치로 드래그하세요.`);
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, item: LayoutItem) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: item.id, pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startX: item.x, startY: item.y };
    setSelectedId(item.id);
    setActiveTool("이동");
  }

  function snapOpening(item: LayoutItem, x: number, y: number) {
    if (item.kind !== "door" && item.kind !== "window") return { x: clampPercent(x), y: clampPercent(y), rotation: item.rotation };
    const edges = [
      { distance: y, x: clampPercent(x), y: 0, rotation: 0 as const },
      { distance: 96 - y, x: clampPercent(x), y: 96, rotation: 0 as const },
      { distance: x, x: 0, y: clampPercent(y), rotation: 90 as const },
      { distance: 96 - x, x: 96, y: clampPercent(y), rotation: 90 as const },
    ];
    return edges.sort((a, b) => a.distance - b.distance)[0];
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const active = dragRef.current;
    const board = boardRef.current;
    if (!active || active.pointerId !== event.pointerId || !board) return;
    const bounds = board.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const nextX = active.startX + ((event.clientX - active.startClientX) / bounds.width) * 100;
    const nextY = active.startY + ((event.clientY - active.startClientY) / bounds.height) * 100;
    setDraft((current) => ({ ...current, items: current.items.map((item) => item.id === active.id ? { ...item, ...snapOpening(item, nextX, nextY) } : item) }));
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setActiveTool("선택");
    setCommand("명령: 객체 이동 완료 · 벽 스냅과 직교 모드가 적용되었습니다.");
  }

  function duplicateSelected() {
    if (!selectedItem) return;
    const copy = { ...selectedItem, id: crypto.randomUUID(), name: `${selectedItem.name} 복사`, x: clampPercent(selectedItem.x + 4), y: clampPercent(selectedItem.y + 4) };
    setDraft((current) => ({ ...current, items: [...current.items, copy] }));
    setSelectedId(copy.id);
  }

  function removeSelected() {
    if (!selectedId) return;
    setDraft((current) => ({ ...current, items: current.items.filter((item) => item.id !== selectedId) }));
    setSelectedId("");
    setCommand("명령: 선택 객체를 삭제했습니다.");
  }

  function resetDraft() {
    if (draft.items.length && !window.confirm("현재 배치 요소를 모두 지우고 새로 시작할까요?")) return;
    setDraft(defaultDraft);
    setSelectedId("");
    setCommand("명령: 새 배치도를 준비했습니다.");
  }

  function renderItems(className: string) {
    return draft.items.filter((item) => visibleLayers[itemLayer(item)]).map((item) => {
      const horizontalSize = item.rotation === 90 ? item.height : item.width;
      const verticalSize = item.rotation === 90 ? item.width : item.height;
      const preset = presetForItem(item);
      return (
        <button
          key={`${className}-${item.id}`}
          type="button"
          className={`${className} kind-${item.kind} symbol-${preset.id} ${selectedId === item.id ? "selected" : ""}`}
          style={{
            left: `${item.x}%`, top: `${item.y}%`,
            width: `${Math.min(42, Math.max(item.kind === "door" || item.kind === "window" ? 7 : 4, (horizontalSize / draft.roomWidth) * 100))}%`,
            height: `${Math.min(42, Math.max(item.kind === "door" || item.kind === "window" ? 2.8 : 5, (verticalSize / draft.roomHeight) * 100))}%`,
          }}
          onPointerDown={className === "site-layout-item" ? (event) => startDrag(event, item) : undefined}
          onClick={() => setSelectedId(item.id)}
          aria-label={`${item.name} ${className === "site-layout-item" ? "이동" : "선택"}`}
        >
          <i aria-hidden="true" /><span>{item.name}</span><small>{preset.code}</small>
        </button>
      );
    });
  }

  return (
    <section className="site-layout-planner" aria-label="현장 배치도 CAD 편집기">
      <header className="site-layout-intro">
        <div className="site-layout-brand"><span>W</span><div><b>현장 배치도</b><small>WHIZZUP LAYOUT STUDIO</small></div></div>
        <div className="site-layout-header-actions">
          <div className="site-layout-save-state" role="status"><b>{savedAt ? "자동 저장됨" : "배치도 준비됨"}</b><small>{savedAt || "실 크기를 입력해 주세요."}</small></div>
          <button type="button" onClick={() => setView("paper")}>A3 출력 미리보기</button>
        </div>
      </header>

      <div className="site-layout-room-settings">
        <label><span>실 이름</span><input value={draft.roomName} onChange={(event) => updateDraft({ roomName: event.target.value.slice(0, 80) })} placeholder="예: 스마트 체험교실" /></label>
        <label><span>가로</span><div><input type="number" min="0.1" max="100" step="0.001" value={draft.roomWidth} onChange={(event) => updateDraft({ roomWidth: positiveDimension(Number(event.target.value), draft.roomWidth) })} /><em>m</em></div></label>
        <label><span>세로</span><div><input type="number" min="0.1" max="100" step="0.001" value={draft.roomHeight} onChange={(event) => updateDraft({ roomHeight: positiveDimension(Number(event.target.value), draft.roomHeight) })} /><em>m</em></div></label>
        <label><span>높이</span><div><input type="number" min="0.1" max="20" step="0.001" value={ceilingHeight} onChange={(event) => updateDraft({ roomCeilingHeight: positiveDimension(Number(event.target.value), ceilingHeight) })} /><em>m</em></div></label>
        <button type="button" className="site-layout-generate" onClick={generateRoom}>교실 자동 생성</button>
        <button type="button" className="site-layout-reset" onClick={resetDraft}>새 도면</button>
      </div>

      <div className="site-layout-commandbar">
        <div>{["선택", "이동", "치수", "회전"].map((tool) => <button key={tool} type="button" className={activeTool === tool ? "active" : ""} onClick={() => { setActiveTool(tool); setCommand(`명령: ${tool} 도구가 활성화되었습니다.`); }}>{tool}</button>)}</div>
        <p aria-live="polite">{command}</p>
      </div>

      <div className="site-layout-workspace">
        <aside className="site-layout-library">
          <div><b>블록 라이브러리</b><span>표준 규격을 선택해 배치합니다.</span></div>
          {groups.map((group) => (
            <section key={group} className="site-layout-library-section">
              <h3>{group}</h3>
              <div className="site-layout-library-grid">
                {itemPresets.filter((preset) => preset.group === group).map((preset) => (
                  <button key={preset.id} type="button" className={`kind-${preset.kind} symbol-${preset.id}`} onClick={() => addItem(preset.id)}>
                    <i aria-hidden="true" /><span>{preset.label}</span><small>{preset.code} · {preset.width}m</small>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>

        <main className={`site-layout-canvas-panel view-${view}`}>
          <div className="site-layout-canvas-head">
            <div><button type="button" className={view === "model" ? "active" : ""} onClick={() => setView("model")}>모델</button><button type="button" className={view === "paper" ? "active" : ""} onClick={() => setView("paper")}>A3 출력</button></div>
            <span>TOP · 1:60 · mm</span>
          </div>
          <div className="site-layout-model-space">
            <div className="site-layout-ruler top"><span>{formatMillimeters(draft.roomWidth)} mm</span></div>
            <div className="site-layout-board-wrap" style={{ maxWidth: `${Math.round(720 * roomRatio)}px` }}>
              <div ref={boardRef} className="site-layout-board" style={{ aspectRatio: `${draft.roomWidth} / ${draft.roomHeight}` }} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onPointerDown={(event) => { if (event.target === event.currentTarget) setSelectedId(""); }}>
                <div className="site-layout-room-label"><b>RC 벽체 t=150</b><span>{draft.roomName} · 천장 H={formatMillimeters(ceilingHeight)}</span></div>
                {renderItems("site-layout-item")}
                <div className="site-layout-crosshair" aria-hidden="true" />
              </div>
            </div>
            <div className="site-layout-ruler side"><span>{formatMillimeters(draft.roomHeight)} mm</span></div>
            {!draft.items.length && <p className="site-layout-empty">왼쪽 표준 블록을 선택하면 도면에 추가됩니다.</p>}
            <small className="site-layout-coordinates">X 8,410.000&nbsp;&nbsp;Y 4,215.000&nbsp;&nbsp;Z 0.000</small>
          </div>
          <div className="site-layout-paper-space">
            <div className="site-layout-paper-sheet">
              <div className="site-layout-paper-plan"><div className="site-layout-paper-note">RC 벽체 t=150 / 천장 높이 {formatMillimeters(ceilingHeight)}mm / 실측 기준 예상 도면</div><div className="site-layout-paper-room" style={{ aspectRatio: `${draft.roomWidth} / ${draft.roomHeight}` }}>{renderItems("site-layout-paper-item")}</div><div className="site-layout-paper-title"><b>{draft.roomName} 평면도</b><span>축척 1/60 (A3)</span></div></div>
              <aside className="site-layout-title-block"><strong>{draft.roomName}</strong><section><b>설치 품목</b><p>장비·가구 {draft.items.filter((item) => itemLayer(item) === "equipment").length}EA</p></section><section><b>공사 내역</b><p>RC 벽체 · 문·창호 배치</p></section><section><b>NOTE.</b><p>현장 실측 후 감독관 협의<br />LAN·전기 위치 확인</p></section><dl><dt>PROJECT</dt><dd>{draft.roomName}</dd><dt>DATE</dt><dd>{new Intl.DateTimeFormat("ko-KR").format(new Date())}</dd><dt>SCALE</dt><dd>A3 1/60</dd></dl></aside>
            </div>
          </div>
        </main>

        <aside className="site-layout-inspector">
          <div><b>레이어</b><span>화면 표시를 제어합니다.</span></div>
          <div className="site-layout-layer-list">
            <div><i className="wall" /><span>A-WALL RC 벽체</span><b>ON</b></div>
            {(["opening", "equipment", "note"] as LayoutLayer[]).map((layer) => {
              const meta = { opening: ["A-OPEN 문·창호", "opening"], equipment: ["E-EQPM 장비·가구", "equipment"], note: ["A-NOTE 주석", "note"] }[layer];
              return <button key={layer} type="button" aria-pressed={visibleLayers[layer]} onClick={() => setVisibleLayers((current) => ({ ...current, [layer]: !current[layer] }))}><i className={meta[1]} /><span>{meta[0]}</span><b>{visibleLayers[layer] ? "ON" : "OFF"}</b></button>;
            })}
          </div>
          <div className="site-layout-object-head"><b>{selectedItem ? selectedItem.name : "선택 객체"}</b><span>{selectedPreset?.code ?? "객체를 선택하세요."}</span></div>
          {selectedItem && selectedPreset ? (
            <div className="site-layout-inspector-form">
              <label><span>이름</span><input value={selectedItem.name} onChange={(event) => updateSelected({ name: event.target.value.slice(0, 60) })} /></label>
              <div className="site-layout-size-fields"><label><span>가로(m)</span><input type="number" min="0.1" max="30" step="0.1" value={selectedItem.width} onChange={(event) => updateSelected({ width: positiveDimension(Number(event.target.value), selectedItem.width) })} /></label><label><span>세로(m)</span><input type="number" min="0.1" max="30" step="0.1" value={selectedItem.height} onChange={(event) => updateSelected({ height: positiveDimension(Number(event.target.value), selectedItem.height) })} /></label></div>
              <div className="site-layout-object-facts"><span>블록명 <b>{selectedPreset.code}</b></span><span>레이어 <b>{itemLayer(selectedItem).toUpperCase()}</b></span><span>스냅 <b>{selectedItem.kind === "door" || selectedItem.kind === "window" ? "벽 자동" : "10mm"}</b></span></div>
              <button type="button" onClick={() => updateSelected({ rotation: selectedItem.rotation === 90 ? 0 : 90 })}>90° 회전</button><button type="button" onClick={duplicateSelected}>복사</button><button type="button" className="danger" onClick={removeSelected}>삭제</button>
            </div>
          ) : <div className="site-layout-inspector-empty">블록을 추가하거나 모델 화면에서 선택하면 정확한 크기와 속성을 수정할 수 있습니다.</div>}
        </aside>
      </div>
      <footer className="site-layout-statusbar"><div><b>SNAP</b><b>ORTHO</b><b>OSNAP</b><span>GRID</span></div><p>도면 단위 mm · 기관·견적 DB와 분리 저장</p></footer>
    </section>
  );
}
