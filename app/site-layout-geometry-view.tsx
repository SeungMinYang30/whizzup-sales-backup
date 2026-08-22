"use client";

import {
  useId,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  computeItemGeometryMm,
  computeOpeningCutGeometryMm,
  computeSvgViewBox,
  computeWallGeometryMm,
  modelPointFromClient,
  type GeometryRectMm,
  type ItemGeometryMm,
  type SiteLayoutDraftMm,
  type SiteLayoutItemMm,
  type SiteLayoutWallSide,
  type SvgViewBoxMm,
} from "../lib/site-layout-geometry";

export type SiteLayoutGeometryViewMode = "model" | "mobile" | "paper";
export type SiteLayoutModelPoint = ReturnType<typeof modelPointFromClient>;

export type SiteLayoutGeometryViewProps = {
  draft: SiteLayoutDraftMm;
  mode?: SiteLayoutGeometryViewMode;
  className?: string;
  style?: CSSProperties;
  paddingMm?: number;
  selectedItemId?: string;
  interactive?: boolean;
  showDimensions?: boolean;
  showLabels?: boolean;
  isItemVisible?: (item: SiteLayoutItemMm) => boolean;
  onBackgroundPointerDown?: (
    point: SiteLayoutModelPoint,
    event: ReactPointerEvent<SVGSVGElement>,
  ) => void;
  onItemPointerDown?: (
    item: SiteLayoutItemMm,
    point: SiteLayoutModelPoint,
    event: ReactPointerEvent<SVGGElement>,
  ) => void;
  onModelPointerMove?: (
    point: SiteLayoutModelPoint,
    event: ReactPointerEvent<SVGSVGElement>,
  ) => void;
  onModelPointerUp?: (
    point: SiteLayoutModelPoint,
    event: ReactPointerEvent<SVGSVGElement>,
  ) => void;
  onModelPointerCancel?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onItemSelect?: (item: SiteLayoutItemMm) => void;
};

type Palette = {
  background: string;
  room: string;
  wall: string;
  wallLine: string;
  hatch: string;
  opening: string;
  structure: string;
  fixture: string;
  equipment: string;
  note: string;
  label: string;
  dimension: string;
  selected: string;
};

const modelPalette: Palette = {
  background: "#07141c",
  room: "#081820",
  wall: "#243842",
  wallLine: "#c6dce4",
  hatch: "#91a9b4",
  opening: "#64e3ee",
  structure: "#9cb7c4",
  fixture: "#64d8b1",
  equipment: "#d8b55d",
  note: "#9fb1ff",
  label: "#d9edf2",
  dimension: "#f2bd45",
  selected: "#89a6ff",
};

const paperPalette: Palette = {
  background: "#ffffff",
  room: "#ffffff",
  wall: "#eeeeec",
  wallLine: "#161a1d",
  hatch: "#676b70",
  opening: "#151a1f",
  structure: "#343b42",
  fixture: "#256d61",
  equipment: "#6e571b",
  note: "#384c7d",
  label: "#20262b",
  dimension: "#c33b32",
  selected: "#315fe8",
};

const numberFormatter = new Intl.NumberFormat("ko-KR");

function formatMm(value: number) {
  return numberFormatter.format(Math.round(value));
}

function svgRect(rect: GeometryRectMm) {
  return {
    x: rect.xMm,
    y: rect.yMm,
    width: rect.widthMm,
    height: rect.heightMm,
  };
}

function pointForWall(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm">,
  wall: SiteLayoutWallSide,
  alongMm: number,
  inwardMm: number,
) {
  if (wall === "top") return { x: alongMm, y: inwardMm };
  if (wall === "bottom") return { x: alongMm, y: draft.roomHeightMm - inwardMm };
  if (wall === "left") return { x: inwardMm, y: alongMm };
  return { x: draft.roomWidthMm - inwardMm, y: alongMm };
}

function linePath(start: { x: number; y: number }, end: { x: number; y: number }) {
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

function arrowHeadPath(start: { x: number; y: number }, end: { x: number; y: number }) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY) || 1;
  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const normalX = -unitY;
  const normalY = unitX;
  const back = Math.min(105, length * 0.22);
  const side = Math.min(58, length * 0.12);
  const left = { x: end.x - unitX * back + normalX * side, y: end.y - unitY * back + normalY * side };
  const right = { x: end.x - unitX * back - normalX * side, y: end.y - unitY * back - normalY * side };
  return `M ${end.x} ${end.y} L ${left.x} ${left.y} M ${end.x} ${end.y} L ${right.x} ${right.y}`;
}

function wallStrokePath(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm">,
  wall: SiteLayoutWallSide,
  startMm: number,
  endMm: number,
  inwardMm = 0,
) {
  return linePath(
    pointForWall(draft, wall, startMm, inwardMm),
    pointForWall(draft, wall, endMm, inwardMm),
  );
}

function DoorLeaf({
  draft,
  wall,
  hingeMm,
  closedMm,
  inwardMm,
  color,
}: {
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm">;
  wall: SiteLayoutWallSide;
  hingeMm: number;
  closedMm: number;
  inwardMm: number;
  color: string;
}) {
  const radius = Math.abs(closedMm - hingeMm);
  const hinge = pointForWall(draft, wall, hingeMm, 0);
  const closed = pointForWall(draft, wall, closedMm, 0);
  const opened = pointForWall(draft, wall, hingeMm, inwardMm);
  const closedVector = { x: closed.x - hinge.x, y: closed.y - hinge.y };
  const openedVector = { x: opened.x - hinge.x, y: opened.y - hinge.y };
  const cross = closedVector.x * openedVector.y - closedVector.y * openedVector.x;
  return (
    <g fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke">
      <path d={linePath(hinge, opened)} />
      <path d={`M ${closed.x} ${closed.y} A ${radius} ${radius} 0 0 ${cross > 0 ? 1 : 0} ${opened.x} ${opened.y}`} strokeDasharray="55 34" />
      <circle cx={hinge.x} cy={hinge.y} r={32} fill={color} stroke="none" />
    </g>
  );
}

function DoorSymbol({ draft, item, geometry, color }: {
  draft: SiteLayoutDraftMm;
  item: SiteLayoutItemMm;
  geometry: ItemGeometryMm;
  color: string;
}) {
  if (!item.wall || geometry.spanStartMm === undefined || geometry.spanEndMm === undefined) return null;
  const start = geometry.spanStartMm;
  const end = geometry.spanEndMm;
  const span = end - start;
  const inward = item.swing === "outside" ? -1 : 1;
  const presetId = item.presetId ?? "door-single";
  const threshold = wallStrokePath(draft, item.wall, start, end);

  if (presetId === "door-sliding") {
    const trackA = wallStrokePath(draft, item.wall, start, end, -draft.roomWallThicknessMm * 0.28);
    const trackB = wallStrokePath(draft, item.wall, start, end, draft.roomWallThicknessMm * 0.18);
    const arrowStart = pointForWall(draft, item.wall, start + span * 0.25, 130 * inward);
    const arrowEnd = pointForWall(draft, item.wall, start + span * 0.75, 130 * inward);
    return (
      <g fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke">
        <path d={trackA} />
        <path d={trackB} />
        <path d={linePath(arrowStart, arrowEnd)} />
        <path d={arrowHeadPath(arrowStart, arrowEnd)} />
      </g>
    );
  }

  if (presetId === "door-folding") {
    const points = Array.from({ length: 7 }, (_, index) => {
      const along = start + (span * index) / 6;
      return pointForWall(draft, item.wall as SiteLayoutWallSide, along, index % 2 === 0 ? 0 : 170 * inward);
    });
    return (
      <g fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke">
        <path d={threshold} />
        <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} />
      </g>
    );
  }

  const doubleDoor = presetId === "door-double" || presetId === "door-unequal";
  if (doubleDoor) {
    const split = presetId === "door-unequal" ? start + span * 0.65 : start + span / 2;
    return (
      <g>
        <path d={threshold} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        <DoorLeaf draft={draft} wall={item.wall} hingeMm={start} closedMm={split} inwardMm={(split - start) * inward} color={color} />
        <DoorLeaf draft={draft} wall={item.wall} hingeMm={end} closedMm={split} inwardMm={(end - split) * inward} color={color} />
      </g>
    );
  }

  const hinge = item.handing === "right" ? end : start;
  const closed = item.handing === "right" ? start : end;
  return (
    <g>
      <path d={threshold} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      <DoorLeaf draft={draft} wall={item.wall} hingeMm={hinge} closedMm={closed} inwardMm={span * inward} color={color} />
    </g>
  );
}

function windowPartitionCount(presetId?: string) {
  if (presetId === "window-3") return 3;
  if (presetId === "window-4") return 4;
  if (presetId === "window-6") return 6;
  if (presetId === "window-sliding-2") return 2;
  return 1;
}

function WindowSymbol({ draft, item, geometry, color }: {
  draft: SiteLayoutDraftMm;
  item: SiteLayoutItemMm;
  geometry: ItemGeometryMm;
  color: string;
}) {
  if (!item.wall || geometry.spanStartMm === undefined || geometry.spanEndMm === undefined) return null;
  const start = geometry.spanStartMm;
  const end = geometry.spanEndMm;
  const count = windowPartitionCount(item.presetId);
  const outerOffset = -draft.roomWallThicknessMm * 0.68;
  const innerOffset = -draft.roomWallThicknessMm * 0.18;
  const mullions = Array.from({ length: Math.max(0, count - 1) }, (_, index) => {
    const along = start + ((end - start) * (index + 1)) / count;
    return wallStrokePath(draft, item.wall as SiteLayoutWallSide, along, along, outerOffset);
  });
  return (
    <g fill="none" stroke={color} strokeWidth={1.45} vectorEffect="non-scaling-stroke">
      <path d={wallStrokePath(draft, item.wall, start, end, outerOffset)} />
      <path d={wallStrokePath(draft, item.wall, start, end, innerOffset)} />
      {mullions.map((_, index) => {
        const along = start + ((end - start) * (index + 1)) / count;
        const first = pointForWall(draft, item.wall as SiteLayoutWallSide, along, outerOffset);
        const second = pointForWall(draft, item.wall as SiteLayoutWallSide, along, innerOffset);
        return <path key={along} d={linePath(first, second)} />;
      })}
      {item.presetId === "window-project" && (
        <path d={wallStrokePath(draft, item.wall, start + (end - start) * 0.16, end - (end - start) * 0.16, 180)} strokeDasharray="50 30" />
      )}
    </g>
  );
}

function GenericItemSymbol({ item, geometry, color, wallHatchId }: {
  item: SiteLayoutItemMm;
  geometry: ItemGeometryMm;
  color: string;
  wallHatchId: string;
}) {
  const { xMm: x, yMm: y, widthMm: width, heightMm: height } = geometry;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const common = { stroke: color, strokeWidth: 1.45, vectorEffect: "non-scaling-stroke" as const };

  if (item.kind === "pillar") {
    if (item.presetId === "pillar-round") {
      return <circle cx={centerX} cy={centerY} r={Math.min(width, height) / 2} fill={`url(#${wallHatchId})`} {...common} />;
    }
    return <rect x={x} y={y} width={width} height={height} fill={`url(#${wallHatchId})`} {...common} />;
  }
  if (item.kind === "beam") {
    return <rect x={x} y={y} width={width} height={height} fill="none" strokeDasharray="75 38" {...common} />;
  }
  if (item.presetId === "aircon-ceiling") {
    return (
      <g fill="none" {...common}>
        <rect x={x} y={y} width={width} height={height} />
        <rect x={x + width * 0.12} y={y + height * 0.12} width={width * 0.76} height={height * 0.76} />
        <path d={`M ${x} ${y} L ${x + width} ${y + height} M ${x + width} ${y} L ${x} ${y + height}`} />
        <circle cx={centerX} cy={centerY} r={Math.min(width, height) * 0.11} />
      </g>
    );
  }
  if (item.presetId === "aircon-wall") {
    return (
      <g fill="none" {...common}>
        <rect x={x} y={y} width={width} height={height} rx={Math.min(width, height) * 0.16} />
        <path d={`M ${x + width * 0.12} ${y + height * 0.7} L ${x + width * 0.88} ${y + height * 0.7}`} />
        <path d={`M ${x + width * 0.3} ${y + height * 0.45} L ${x + width * 0.7} ${y + height * 0.45}`} strokeDasharray="45 25" />
      </g>
    );
  }
  if (item.kind === "note") {
    return (
      <g fill="none" {...common}>
        <rect x={x} y={y} width={width} height={height} rx={45} />
        <path d={`M ${x + width * 0.12} ${y + height * 0.32} L ${x + width * 0.82} ${y + height * 0.32} M ${x + width * 0.12} ${y + height * 0.58} L ${x + width * 0.66} ${y + height * 0.58}`} />
      </g>
    );
  }
  return (
    <g fill="none" {...common}>
      <rect x={x} y={y} width={width} height={height} rx={Math.min(width, height) * 0.08} />
      <path d={`M ${x} ${y} L ${x + width} ${y + height} M ${x + width} ${y} L ${x} ${y + height}`} opacity={0.42} />
    </g>
  );
}

function itemColor(item: SiteLayoutItemMm, palette: Palette) {
  if (item.kind === "door" || item.kind === "window") return palette.opening;
  if (item.kind === "pillar" || item.kind === "beam") return palette.structure;
  if (item.kind === "fixture") return palette.fixture;
  if (item.kind === "note") return palette.note;
  return palette.equipment;
}

function ItemLabel({ item, geometry, color, compact }: {
  item: SiteLayoutItemMm;
  geometry: ItemGeometryMm;
  color: string;
  compact: boolean;
}) {
  if (compact) return null;
  const fontSize = 145;
  const x = geometry.centerXmm;
  const y = item.wall === "top"
    ? 260
    : item.wall === "bottom"
      ? geometry.yMm - 115
      : geometry.yMm + geometry.heightMm + 185;
  return (
    <text x={x} y={y} fill={color} fontSize={fontSize} fontWeight={750} textAnchor="middle" pointerEvents="none">
      {item.name.slice(0, 26)}
    </text>
  );
}

function DimensionLayer({ draft, palette }: { draft: SiteLayoutDraftMm; palette: Palette }) {
  const wall = draft.roomWallThicknessMm;
  const widthY = -wall - 125;
  const heightX = -wall - 125;
  const strokeWidth = 1.15;
  return (
    <g fill={palette.dimension} stroke={palette.dimension} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" pointerEvents="none">
      <path d={`M 0 ${widthY} L ${draft.roomWidthMm} ${widthY} M 0 ${widthY - 70} L 0 ${widthY + 70} M ${draft.roomWidthMm} ${widthY - 70} L ${draft.roomWidthMm} ${widthY + 70}`} fill="none" />
      <text x={draft.roomWidthMm / 2} y={widthY - 55} stroke="none" fontSize={150} fontWeight={800} textAnchor="middle">{formatMm(draft.roomWidthMm)} mm</text>
      <path d={`M ${heightX} 0 L ${heightX} ${draft.roomHeightMm} M ${heightX - 70} 0 L ${heightX + 70} 0 M ${heightX - 70} ${draft.roomHeightMm} L ${heightX + 70} ${draft.roomHeightMm}`} fill="none" />
      <text x={heightX - 60} y={draft.roomHeightMm / 2} stroke="none" fontSize={150} fontWeight={800} textAnchor="middle" transform={`rotate(-90 ${heightX - 60} ${draft.roomHeightMm / 2})`}>{formatMm(draft.roomHeightMm)} mm</text>
    </g>
  );
}

function RoomInformation({ draft, palette, compact }: { draft: SiteLayoutDraftMm; palette: Palette; compact: boolean }) {
  if (compact) return null;
  const x = 0;
  const y = -draft.roomWallThicknessMm - 520;
  const width = Math.min(3_550, draft.roomWidthMm * 0.42);
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={width} height={260} rx={45} fill={palette.background} fillOpacity={0.94} stroke={palette.wallLine} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <text x={x + 120} y={y + 108} fill={palette.label} fontFamily="Consolas, monospace" fontSize={145} fontWeight={800}>RC 벽체 t={formatMm(draft.roomWallThicknessMm)}</text>
      <text x={x + 120} y={y + 210} fill={palette.label} fontSize={125}>{draft.roomName} · 천장 H={formatMm(draft.roomCeilingHeightMm)}</text>
    </g>
  );
}

export function SiteLayoutGeometryView({
  draft,
  mode = "model",
  className,
  style,
  paddingMm,
  selectedItemId,
  interactive = false,
  showDimensions = true,
  showLabels = mode !== "mobile",
  isItemVisible = () => true,
  onBackgroundPointerDown,
  onItemPointerDown,
  onModelPointerMove,
  onModelPointerUp,
  onModelPointerCancel,
  onItemSelect,
}: SiteLayoutGeometryViewProps) {
  const id = useId().replaceAll(":", "");
  const hatchId = `${id}-wall-hatch`;
  const wallMaskId = `${id}-wall-mask`;
  const palette = mode === "paper" ? paperPalette : modelPalette;
  const viewBox: SvgViewBoxMm = computeSvgViewBox(draft, { paddingMm });
  const wallGeometry = computeWallGeometryMm(draft);
  const visibleItems = draft.items.filter(isItemVisible);
  const openingCuts = visibleItems
    .map((item) => computeOpeningCutGeometryMm(draft, item))
    .filter((rect): rect is GeometryRectMm => rect !== null);
  const compact = mode === "mobile";

  function modelPoint(event: { clientX: number; clientY: number; currentTarget: SVGElement }) {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
      ?? event.currentTarget.getBoundingClientRect();
    return modelPointFromClient(event, bounds, viewBox);
  }

  function handleBackgroundPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!interactive) return;
    onBackgroundPointerDown?.(modelPoint(event), event);
  }

  function handleItemPointerDown(item: SiteLayoutItemMm, event: ReactPointerEvent<SVGGElement>) {
    if (!interactive) return;
    event.stopPropagation();
    onItemSelect?.(item);
    onItemPointerDown?.(item, modelPoint(event), event);
  }

  function handleItemKeyDown(item: SiteLayoutItemMm, event: ReactKeyboardEvent<SVGGElement>) {
    if (!interactive || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onItemSelect?.(item);
  }

  return (
    <svg
      className={className}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        background: palette.background,
        touchAction: interactive ? "none" : "auto",
        ...style,
      }}
      viewBox={viewBox.value}
      preserveAspectRatio="xMidYMid meet"
      role={interactive ? "application" : "img"}
      aria-label={`${draft.roomName} 기초 평면도, ${formatMm(draft.roomWidthMm)} × ${formatMm(draft.roomHeightMm)} 밀리미터`}
      data-layout-mode={mode}
      data-unit="mm"
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={(event) => {
        if (interactive) onModelPointerMove?.(modelPoint(event), event);
      }}
      onPointerUp={(event) => {
        if (interactive) onModelPointerUp?.(modelPoint(event), event);
      }}
      onPointerCancel={(event) => {
        if (interactive) onModelPointerCancel?.(event);
      }}
    >
      <defs>
        <pattern id={hatchId} width={105} height={105} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={105} height={105} fill={palette.wall} />
          <line x1={0} y1={0} x2={0} y2={105} stroke={palette.hatch} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </pattern>
        <mask id={wallMaskId} maskUnits="userSpaceOnUse" x={viewBox.minX} y={viewBox.minY} width={viewBox.width} height={viewBox.height}>
          <rect x={viewBox.minX} y={viewBox.minY} width={viewBox.width} height={viewBox.height} fill="black" />
          {Object.entries(wallGeometry).map(([wall, rect]) => <rect key={wall} {...svgRect(rect)} fill="white" />)}
          {openingCuts.map((rect, index) => <rect key={`${rect.xMm}-${rect.yMm}-${index}`} {...svgRect(rect)} fill="black" />)}
        </mask>
      </defs>

      <rect x={0} y={0} width={draft.roomWidthMm} height={draft.roomHeightMm} fill={palette.room} />
      <g mask={`url(#${wallMaskId})`}>
        {Object.entries(wallGeometry).map(([wall, rect]) => (
          <rect key={wall} {...svgRect(rect)} fill={`url(#${hatchId})`} stroke={palette.wallLine} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <rect x={0} y={0} width={draft.roomWidthMm} height={draft.roomHeightMm} fill="none" stroke={palette.wallLine} strokeWidth={1.15} vectorEffect="non-scaling-stroke" />

      {showDimensions && <DimensionLayer draft={draft} palette={palette} />}
      <RoomInformation draft={draft} palette={palette} compact={compact || mode === "paper"} />

      {visibleItems.map((item) => {
        const geometry = computeItemGeometryMm(draft, item);
        const color = itemColor(item, palette);
        const selected = item.id === selectedItemId;
        return (
          <g
            key={item.id}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `${item.name} 선택` : undefined}
            data-item-id={item.id}
            data-item-kind={item.kind}
            onPointerDown={(event) => handleItemPointerDown(item, event)}
            onKeyDown={(event) => handleItemKeyDown(item, event)}
            style={{ cursor: interactive ? "pointer" : "default", outline: "none" }}
          >
            <rect
              x={geometry.xMm}
              y={geometry.yMm}
              width={geometry.widthMm}
              height={geometry.heightMm}
              fill="transparent"
              stroke="transparent"
              strokeWidth={interactive ? 36 : 0}
              vectorEffect="non-scaling-stroke"
              pointerEvents={interactive ? "all" : "none"}
            />
            {selected && (
              <rect
                x={geometry.xMm - 85}
                y={geometry.yMm - 85}
                width={geometry.widthMm + 170}
                height={geometry.heightMm + 170}
                fill="none"
                stroke={palette.selected}
                strokeWidth={1.5}
                strokeDasharray="70 42"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            {item.kind === "door" ? (
              <DoorSymbol draft={draft} item={item} geometry={geometry} color={color} />
            ) : item.kind === "window" ? (
              <WindowSymbol draft={draft} item={item} geometry={geometry} color={color} />
            ) : (
              <GenericItemSymbol item={item} geometry={geometry} color={color} wallHatchId={hatchId} />
            )}
            {showLabels && <ItemLabel item={item} geometry={geometry} color={color} compact={compact} />}
          </g>
        );
      })}

      <g stroke={palette.wallLine} strokeWidth={1} opacity={0.58} vectorEffect="non-scaling-stroke" pointerEvents="none">
        <path d={`M ${draft.roomWidthMm / 2 - 180} ${draft.roomHeightMm / 2} H ${draft.roomWidthMm / 2 + 180}`} />
        <path d={`M ${draft.roomWidthMm / 2} ${draft.roomHeightMm / 2 - 180} V ${draft.roomHeightMm / 2 + 180}`} />
      </g>
    </svg>
  );
}

export default SiteLayoutGeometryView;
