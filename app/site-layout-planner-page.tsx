"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type LayoutItemKind = "equipment" | "table" | "door" | "window" | "pillar" | "note";

type LayoutItem = {
  id: string;
  kind: LayoutItemKind;
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
  items: LayoutItem[];
};

const STORAGE_KEY = "whizzup:site-layout-draft:v1";

const itemPresets: Array<{
  kind: LayoutItemKind;
  label: string;
  defaultName: string;
  width: number;
  height: number;
}> = [
  { kind: "equipment", label: "장비", defaultName: "장비", width: 1.2, height: 0.7 },
  { kind: "table", label: "책상", defaultName: "책상", width: 1.4, height: 0.7 },
  { kind: "door", label: "출입문", defaultName: "출입문", width: 0.9, height: 0.18 },
  { kind: "window", label: "창문", defaultName: "창문", width: 1.5, height: 0.14 },
  { kind: "pillar", label: "기둥", defaultName: "기둥", width: 0.45, height: 0.45 },
  { kind: "note", label: "메모", defaultName: "현장 메모", width: 1.6, height: 0.55 },
];

const defaultDraft: LayoutDraft = {
  roomName: "기본 실",
  roomWidth: 8,
  roomHeight: 6,
  items: [],
};

function positiveDimension(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0.1, Math.round(value * 100) / 100));
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

export default function SiteLayoutPlannerPage() {
  const [draft, setDraft] = useState<LayoutDraft>(defaultDraft);
  const [selectedId, setSelectedId] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [hydrated, setHydrated] = useState(false);
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
            items: parsed.items.filter(validStoredItem).map((item) => ({
              ...item,
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
      setSavedAt(new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date()));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draft, hydrated]);

  const selectedItem = useMemo(
    () => draft.items.find((item) => item.id === selectedId) ?? null,
    [draft.items, selectedId],
  );

  function updateDraft(patch: Partial<LayoutDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateSelected(patch: Partial<LayoutItem>) {
    if (!selectedId) return;
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => item.id === selectedId ? { ...item, ...patch } : item),
    }));
  }

  function addItem(kind: LayoutItemKind) {
    const preset = itemPresets.find((item) => item.kind === kind) ?? itemPresets[0];
    const sameKindCount = draft.items.filter((item) => item.kind === kind).length;
    const item: LayoutItem = {
      id: crypto.randomUUID(),
      kind,
      name: `${preset.defaultName}${sameKindCount ? ` ${sameKindCount + 1}` : ""}`,
      x: 10 + ((draft.items.length * 7) % 45),
      y: 10 + ((draft.items.length * 9) % 45),
      width: preset.width,
      height: preset.height,
      rotation: 0,
    };
    setDraft((current) => ({ ...current, items: [...current.items, item] }));
    setSelectedId(item.id);
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, item: LayoutItem) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: item.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: item.x,
      startY: item.y,
    };
    setSelectedId(item.id);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const active = dragRef.current;
    const board = boardRef.current;
    if (!active || active.pointerId !== event.pointerId || !board) return;
    const bounds = board.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const nextX = active.startX + ((event.clientX - active.startClientX) / bounds.width) * 100;
    const nextY = active.startY + ((event.clientY - active.startClientY) / bounds.height) * 100;
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => item.id === active.id
        ? { ...item, x: clampPercent(nextX), y: clampPercent(nextY) }
        : item),
    }));
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function duplicateSelected() {
    if (!selectedItem) return;
    const copy = {
      ...selectedItem,
      id: crypto.randomUUID(),
      name: `${selectedItem.name} 복사`,
      x: clampPercent(selectedItem.x + 4),
      y: clampPercent(selectedItem.y + 4),
    };
    setDraft((current) => ({ ...current, items: [...current.items, copy] }));
    setSelectedId(copy.id);
  }

  function removeSelected() {
    if (!selectedId) return;
    setDraft((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== selectedId),
    }));
    setSelectedId("");
  }

  function resetDraft() {
    if (draft.items.length && !window.confirm("현재 배치 요소를 모두 지우고 새로 시작할까요?")) return;
    setDraft(defaultDraft);
    setSelectedId("");
  }

  const roomRatio = Math.min(1.8, Math.max(0.55, draft.roomWidth / draft.roomHeight));

  return (
    <section className="site-layout-planner" aria-label="현장 배치도 편집기">
      <header className="site-layout-intro">
        <div>
          <span>FIELD LAYOUT · BASIC</span>
          <h2>실 크기를 입력하고 기본 요소를 배치해 보세요.</h2>
          <p>이 첫 버전은 현재 브라우저에만 자동 저장되며 기관·견적 DB에는 영향을 주지 않습니다.</p>
        </div>
        <div className="site-layout-save-state" role="status">
          <b>{savedAt ? "자동 저장됨" : "배치도 준비됨"}</b>
          <small>{savedAt || "실 크기를 입력해 주세요."}</small>
        </div>
      </header>

      <div className="site-layout-room-settings">
        <label>
          <span>실 이름</span>
          <input value={draft.roomName} onChange={(event) => updateDraft({ roomName: event.target.value.slice(0, 80) })} placeholder="예: 스마트 체험실" />
        </label>
        <label>
          <span>가로</span>
          <div><input type="number" min="0.1" max="100" step="0.1" value={draft.roomWidth} onChange={(event) => updateDraft({ roomWidth: positiveDimension(Number(event.target.value), draft.roomWidth) })} /><em>m</em></div>
        </label>
        <label>
          <span>세로</span>
          <div><input type="number" min="0.1" max="100" step="0.1" value={draft.roomHeight} onChange={(event) => updateDraft({ roomHeight: positiveDimension(Number(event.target.value), draft.roomHeight) })} /><em>m</em></div>
        </label>
        <button type="button" className="site-layout-reset" onClick={resetDraft}>빈 배치도</button>
      </div>

      <div className="site-layout-workspace">
        <aside className="site-layout-library">
          <div><b>기본 요소</b><span>선택하면 중앙에 추가됩니다.</span></div>
          <div className="site-layout-library-grid">
            {itemPresets.map((preset) => (
              <button key={preset.kind} type="button" className={`kind-${preset.kind}`} onClick={() => addItem(preset.kind)}>
                <i aria-hidden="true" />
                <span>{preset.label}</span>
                <small>{preset.width} × {preset.height}m</small>
              </button>
            ))}
          </div>
        </aside>

        <main className="site-layout-canvas-panel">
          <div className="site-layout-ruler top"><span>{draft.roomWidth}m</span></div>
          <div className="site-layout-board-wrap" style={{ maxWidth: `${Math.round(680 * roomRatio)}px` }}>
            <div
              ref={boardRef}
              className="site-layout-board"
              style={{ aspectRatio: `${draft.roomWidth} / ${draft.roomHeight}` }}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) setSelectedId("");
              }}
            >
              <div className="site-layout-room-label"><b>{draft.roomName || "이름 없는 실"}</b><span>{draft.roomWidth} × {draft.roomHeight}m</span></div>
              {draft.items.map((item) => {
                const horizontalSize = item.rotation === 90 ? item.height : item.width;
                const verticalSize = item.rotation === 90 ? item.width : item.height;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`site-layout-item kind-${item.kind} ${selectedId === item.id ? "selected" : ""}`}
                    style={{
                      left: `${item.x}%`,
                      top: `${item.y}%`,
                      width: `${Math.min(40, Math.max(4, (horizontalSize / draft.roomWidth) * 100))}%`,
                      height: `${Math.min(40, Math.max(4, (verticalSize / draft.roomHeight) * 100))}%`,
                    }}
                    onPointerDown={(event) => startDrag(event, item)}
                    aria-label={`${item.name} 이동`}
                  >
                    <span>{item.name}</span>
                    <small>{item.width}×{item.height}m</small>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="site-layout-ruler side"><span>{draft.roomHeight}m</span></div>
          {!draft.items.length && <p className="site-layout-empty">왼쪽에서 장비·가구·문·창문을 추가해 보세요.</p>}
        </main>

        <aside className="site-layout-inspector">
          <div><b>선택 요소</b><span>{selectedItem ? "이름과 실제 크기를 수정할 수 있습니다." : "배치된 요소를 선택해 주세요."}</span></div>
          {selectedItem ? (
            <div className="site-layout-inspector-form">
              <label><span>이름</span><input value={selectedItem.name} onChange={(event) => updateSelected({ name: event.target.value.slice(0, 60) })} /></label>
              <div className="site-layout-size-fields">
                <label><span>가로(m)</span><input type="number" min="0.1" max="30" step="0.1" value={selectedItem.width} onChange={(event) => updateSelected({ width: positiveDimension(Number(event.target.value), selectedItem.width) })} /></label>
                <label><span>세로(m)</span><input type="number" min="0.1" max="30" step="0.1" value={selectedItem.height} onChange={(event) => updateSelected({ height: positiveDimension(Number(event.target.value), selectedItem.height) })} /></label>
              </div>
              <button type="button" onClick={() => updateSelected({ rotation: selectedItem.rotation === 90 ? 0 : 90 })}>90° 회전</button>
              <button type="button" onClick={duplicateSelected}>복사</button>
              <button type="button" className="danger" onClick={removeSelected}>삭제</button>
            </div>
          ) : <div className="site-layout-inspector-empty">장비를 추가하거나 배치도에서 선택하면 편집 도구가 표시됩니다.</div>}
        </aside>
      </div>
    </section>
  );
}
