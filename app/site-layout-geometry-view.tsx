"use client";

import {
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  buildSiteLayoutDimensionSegmentsMm,
  computeItemGeometryMm,
  computeOpeningCutGeometryMm,
  computeSvgViewBox,
  computeWallGeometryMm,
  layoutSiteLayoutDimensionSegmentsMm,
  modelPointFromClient,
  type GeometryRectMm,
  type ItemGeometryMm,
  type SiteLayoutLaidOutDimensionSegmentMm,
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
  viewport?: { x: number; y: number; width: number; height: number };
  paddingMm?: number;
  selectedItemId?: string;
  interactive?: boolean;
  interactionMode?: "drag" | "select";
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
  opening: "#064f5d",
  structure: "#343b42",
  fixture: "#075b4e",
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

function wallBandPath(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm">,
  wall: SiteLayoutWallSide,
  startMm: number,
  endMm: number,
  firstInwardMm: number,
  secondInwardMm: number,
) {
  const points = [
    pointForWall(draft, wall, startMm, firstInwardMm),
    pointForWall(draft, wall, endMm, firstInwardMm),
    pointForWall(draft, wall, endMm, secondInwardMm),
    pointForWall(draft, wall, startMm, secondInwardMm),
  ];
  return `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`;
}

const ksAppendix2OpeningPresets = new Set([
  "door-single",
  "door-double",
  "door-sliding",
  "door-folding",
  "window-fixed",
  "window-sliding-2",
  "window-4",
  "window-6",
  "window-project",
]);

function openingSymbolSource(presetId: string) {
  return ksAppendix2OpeningPresets.has(presetId)
    ? "KS F 1501 부표 2"
    : "KS F 1501 부표 2 형상 파생·현장용";
}

function DoorLeaf({
  draft,
  wall,
  hingeMm,
  closedMm,
  inwardMm,
  color,
  strokeWidth,
}: {
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm">;
  wall: SiteLayoutWallSide;
  hingeMm: number;
  closedMm: number;
  inwardMm: number;
  color: string;
  strokeWidth: number;
}) {
  const radius = Math.abs(closedMm - hingeMm);
  const hinge = pointForWall(draft, wall, hingeMm, 0);
  const closed = pointForWall(draft, wall, closedMm, 0);
  const opened = pointForWall(draft, wall, hingeMm, inwardMm);
  const closedVector = { x: closed.x - hinge.x, y: closed.y - hinge.y };
  const openedVector = { x: opened.x - hinge.x, y: opened.y - hinge.y };
  const cross = closedVector.x * openedVector.y - closedVector.y * openedVector.x;
  return (
    <g fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="square" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
      <path data-symbol-part="door-leaf" d={linePath(hinge, opened)} />
      <path data-symbol-part="door-swing-arc" data-swing-angle-deg="90" d={`M ${closed.x} ${closed.y} A ${radius} ${radius} 0 0 ${cross > 0 ? 1 : 0} ${opened.x} ${opened.y}`} strokeWidth={Math.max(1.05, strokeWidth * 0.58)} />
    </g>
  );
}

function DoorSymbol({ draft, item, geometry, color, strokeWidth }: {
  draft: SiteLayoutDraftMm;
  item: SiteLayoutItemMm;
  geometry: ItemGeometryMm;
  color: string;
  strokeWidth: number;
}) {
  if (!item.wall || geometry.spanStartMm === undefined || geometry.spanEndMm === undefined) return null;
  const start = geometry.spanStartMm;
  const end = geometry.spanEndMm;
  const span = end - start;
  const inward = item.swing === "outside" ? -1 : 1;
  const presetId = item.presetId ?? "door-single";
  const wallOuter = -draft.roomWallThicknessMm * 0.88;
  const wallInner = -draft.roomWallThicknessMm * 0.12;
  const officialKsSymbol = ksAppendix2OpeningPresets.has(presetId);
  const planSource = openingSymbolSource(presetId);
  const frameBand = [
    pointForWall(draft, item.wall, start, wallOuter),
    pointForWall(draft, item.wall, end, wallOuter),
    pointForWall(draft, item.wall, end, wallInner),
    pointForWall(draft, item.wall, start, wallInner),
  ];
  const openingFrame = (
    <g data-drawing-standard={officialKsSymbol ? "KS F 1501" : undefined} data-plan-source={planSource}>
      <path data-symbol-part="opening-jamb" d={linePath(frameBand[0], frameBand[3])} fill="none" stroke={color} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
      <path data-symbol-part="opening-jamb" d={linePath(frameBand[1], frameBand[2])} fill="none" stroke={color} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
    </g>
  );

  if (presetId === "door-sliding") {
    const firstTrack = -draft.roomWallThicknessMm * 0.68;
    const secondTrack = -draft.roomWallThicknessMm * 0.32;
    const leafThickness = Math.min(40, Math.max(24, draft.roomWallThicknessMm * 0.18));
    const pocketLeafSpan = span * 0.32;
    const firstLeafEndMm = start + pocketLeafSpan;
    const secondLeafStartMm = end - pocketLeafSpan;
    const meetingMm = start + span / 2;
    const centerTrack = (firstTrack + secondTrack) / 2;
    return (
      <g data-drawing-standard={officialKsSymbol ? "KS F 1501" : undefined} data-plan-source={planSource} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="square" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
        {openingFrame}
        <path data-symbol-part="sliding-door-track" d={wallStrokePath(draft, item.wall, start, end, firstTrack)} strokeWidth={Math.max(0.9, strokeWidth * 0.55)} />
        <path data-symbol-part="sliding-door-track" d={wallStrokePath(draft, item.wall, start, end, secondTrack)} strokeWidth={Math.max(0.9, strokeWidth * 0.55)} />
        <path data-symbol-part="sliding-door-leaf" data-panel-index="1" d={wallBandPath(draft, item.wall, start, firstLeafEndMm, firstTrack - leafThickness / 2, firstTrack + leafThickness / 2)} />
        <path data-symbol-part="sliding-door-clear-opening" d={wallStrokePath(draft, item.wall, firstLeafEndMm, secondLeafStartMm, centerTrack)} strokeWidth={Math.max(0.9, strokeWidth * 0.55)} />
        <path data-symbol-part="sliding-door-leaf" data-panel-index="2" d={wallBandPath(draft, item.wall, secondLeafStartMm, end, secondTrack - leafThickness / 2, secondTrack + leafThickness / 2)} />
        <path data-symbol-part="sliding-door-meeting-stile" d={linePath(pointForWall(draft, item.wall, meetingMm, wallOuter), pointForWall(draft, item.wall, meetingMm, wallInner))} />
      </g>
    );
  }

  if (presetId === "door-folding") {
    const foldCount = 4;
    const foldingDepth = Math.min(span * 0.34, Math.max(210, span / foldCount));
    const points = Array.from({ length: foldCount + 1 }, (_, index) => {
      const along = start + (span * index) / foldCount;
      return pointForWall(draft, item.wall as SiteLayoutWallSide, along, index % 2 === 0 ? 0 : foldingDepth * inward);
    });
    return (
      <g data-drawing-standard={officialKsSymbol ? "KS F 1501" : undefined} data-plan-source={planSource} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="square" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
        {openingFrame}
        <polyline data-symbol-part="folding-door-leaves" data-fold-count={foldCount} points={points.map((point) => `${point.x},${point.y}`).join(" ")} />
      </g>
    );
  }

  const doubleDoor = presetId === "door-double" || presetId === "door-unequal";
  if (doubleDoor) {
    const split = presetId === "door-unequal" ? start + span * 0.65 : start + span / 2;
    return (
      <g data-drawing-standard={officialKsSymbol ? "KS F 1501" : undefined} data-plan-source={planSource}>
        {openingFrame}
        <DoorLeaf draft={draft} wall={item.wall} hingeMm={start} closedMm={split} inwardMm={(split - start) * inward} color={color} strokeWidth={strokeWidth} />
        <DoorLeaf draft={draft} wall={item.wall} hingeMm={end} closedMm={split} inwardMm={(end - split) * inward} color={color} strokeWidth={strokeWidth} />
      </g>
    );
  }

  const hinge = item.handing === "right" ? end : start;
  const closed = item.handing === "right" ? start : end;
  return (
    <g data-drawing-standard={officialKsSymbol ? "KS F 1501" : undefined} data-plan-source={planSource}>
      {openingFrame}
      <DoorLeaf draft={draft} wall={item.wall} hingeMm={hinge} closedMm={closed} inwardMm={span * inward} color={color} strokeWidth={strokeWidth} />
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

function WindowSymbol({ draft, item, geometry, color, strokeWidth }: {
  draft: SiteLayoutDraftMm;
  item: SiteLayoutItemMm;
  geometry: ItemGeometryMm;
  color: string;
  strokeWidth: number;
}) {
  if (!item.wall || geometry.spanStartMm === undefined || geometry.spanEndMm === undefined) return null;
  const start = geometry.spanStartMm;
  const end = geometry.spanEndMm;
  const count = windowPartitionCount(item.presetId);
  // KS F 1501 부표 2의 평면 표시기호처럼 벽 개구부 안에 창틀과
  // 미서기 창짝을 중첩해 그린다. 이동 방향 화살표와 입면용 X 표시는 쓰지 않는다.
  const outerOffset = -draft.roomWallThicknessMm * 0.82;
  const centerOffset = -draft.roomWallThicknessMm * 0.5;
  const innerOffset = -draft.roomWallThicknessMm * 0.18;
  const openingSpan = end - start;
  const slidingWindow = item.presetId === "window-sliding-2" || item.presetId === "window-3" || item.presetId === "window-4";
  const presetId = item.presetId ?? "window-fixed";
  const officialKsSymbol = ksAppendix2OpeningPresets.has(presetId);
  const planSource = openingSymbolSource(presetId);
  const firstTrack = -draft.roomWallThicknessMm * 0.71;
  const secondTrack = -draft.roomWallThicknessMm * 0.29;
  const sashThickness = Math.min(28, Math.max(16, draft.roomWallThicknessMm * 0.12));
  const symbolicMeetingOverlapMm = Math.min(openingSpan * 0.06, draft.roomWallThicknessMm);
  const casementHingeMm = item.handing === "right" ? end : start;
  const casementClosedMm = item.handing === "right" ? start : end;
  const casementHinge = pointForWall(draft, item.wall, casementHingeMm, centerOffset);
  const casementClosed = pointForWall(draft, item.wall, casementClosedMm, centerOffset);
  // KS F 1501 부표 2의 외여닫이창은 문처럼 90°로 세우지 않고,
  // 창짝을 약 45° 바깥으로 연 평면 표시기호로 그린다.
  const casementDirection = item.handing === "right" ? -1 : 1;
  const casementOpenAlongMm = casementHingeMm + (casementDirection * openingSpan) / Math.SQRT2;
  const casementOpened = pointForWall(draft, item.wall, casementOpenAlongMm, centerOffset - openingSpan / Math.SQRT2);
  const casementClosedVector = { x: casementClosed.x - casementHinge.x, y: casementClosed.y - casementHinge.y };
  const casementOpenedVector = { x: casementOpened.x - casementHinge.x, y: casementOpened.y - casementHinge.y };
  const casementArcSweep = casementClosedVector.x * casementOpenedVector.y - casementClosedVector.y * casementOpenedVector.x > 0 ? 1 : 0;
  return (
    <g data-drawing-standard={officialKsSymbol ? "KS F 1501" : undefined} data-plan-source={planSource} data-window-operation={slidingWindow ? "sliding" : item.presetId === "window-project" ? "casement-out" : "fixed"} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="square" strokeLinejoin="miter" vectorEffect="non-scaling-stroke">
      {!slidingWindow && <>
        <path data-symbol-part="fixed-window-frame" d={wallStrokePath(draft, item.wall, start, end, outerOffset)} />
        <path data-symbol-part="fixed-window-glazing" d={wallStrokePath(draft, item.wall, start, end, centerOffset)} strokeWidth={Math.max(1.15, strokeWidth * 0.68)} />
        <path data-symbol-part="fixed-window-frame" d={wallStrokePath(draft, item.wall, start, end, innerOffset)} />
      </>}
      <path data-symbol-part="window-jamb" d={linePath(pointForWall(draft, item.wall, start, outerOffset), pointForWall(draft, item.wall, start, innerOffset))} />
      <path data-symbol-part="window-jamb" d={linePath(pointForWall(draft, item.wall, end, outerOffset), pointForWall(draft, item.wall, end, innerOffset))} />
      {!slidingWindow && Array.from({ length: Math.max(0, count - 1) }, (_, index) => {
        const along = start + ((end - start) * (index + 1)) / count;
        const first = pointForWall(draft, item.wall as SiteLayoutWallSide, along, outerOffset);
        const second = pointForWall(draft, item.wall as SiteLayoutWallSide, along, innerOffset);
        return <path data-symbol-part="window-mullion" key={along} d={linePath(first, second)} />;
      })}
      {slidingWindow && (
        <>
          <path data-symbol-part="sliding-window-track" d={wallStrokePath(draft, item.wall, start, end, firstTrack)} strokeWidth={Math.max(0.85, strokeWidth * 0.52)} />
          <path data-symbol-part="sliding-window-track" d={wallStrokePath(draft, item.wall, start, end, secondTrack)} strokeWidth={Math.max(0.85, strokeWidth * 0.52)} />
          {Array.from({ length: count }, (_, index) => {
            const panelWidth = (openingSpan + symbolicMeetingOverlapMm * Math.max(0, count - 1)) / count;
            const panelStart = start + index * (panelWidth - symbolicMeetingOverlapMm);
            const track = index % 2 === 0 ? firstTrack : secondTrack;
            return <path data-symbol-part="sliding-window-leaf" data-panel-index={index + 1} key={index} d={wallBandPath(draft, item.wall as SiteLayoutWallSide, panelStart, panelStart + panelWidth, track - sashThickness / 2, track + sashThickness / 2)} />;
          })}
        </>
      )}
      {item.presetId === "window-project" && (
        <g data-symbol-part="casement-window-operation" data-swing="outside" data-swing-angle-deg="45">
          <path data-symbol-part="casement-window-leaf" d={linePath(casementHinge, casementOpened)} />
          <path
            data-symbol-part="casement-window-swing-arc"
            d={`M ${casementClosed.x} ${casementClosed.y} A ${openingSpan} ${openingSpan} 0 0 ${casementArcSweep} ${casementOpened.x} ${casementOpened.y}`}
            strokeWidth={Math.max(1.05, strokeWidth * 0.58)}
          />
        </g>
      )}
    </g>
  );
}

function GenericItemSymbol({ item, geometry, color, wallHatchId, strokeWidth }: {
  item: SiteLayoutItemMm;
  geometry: ItemGeometryMm;
  color: string;
  wallHatchId: string;
  strokeWidth: number;
}) {
  const { xMm: x, yMm: y, widthMm: width, heightMm: height } = geometry;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const common = { stroke: color, strokeWidth, vectorEffect: "non-scaling-stroke" as const };

  if (item.kind === "pillar") {
    if (item.presetId === "pillar-round") {
      const radius = Math.min(width, height) / 2;
      return <circle data-drawing-standard="KS F 1501" data-plan-source="KS F 1501 부표 3" data-symbol-part="rc-pillar-cut" cx={centerX} cy={centerY} r={radius} fill={`url(#${wallHatchId})`} strokeLinecap="square" strokeLinejoin="miter" {...common} />;
    }
    return <rect data-drawing-standard="KS F 1501" data-plan-source="KS F 1501 부표 3" data-symbol-part="rc-pillar-cut" x={x} y={y} width={width} height={height} fill={`url(#${wallHatchId})`} strokeLinecap="square" strokeLinejoin="miter" {...common} />;
  }
  if (item.kind === "beam") {
    const vertical = geometry.rotation === 90;
    const hiddenEdges = vertical
      ? [`M ${x} ${y} V ${y + height}`, `M ${x + width} ${y} V ${y + height}`]
      : [`M ${x} ${y} H ${x + width}`, `M ${x} ${y + height} H ${x + width}`];
    return (
      <g data-drawing-standard="KS F 1540·1541·1542" data-symbol-part="beam-hidden-double-line" data-beam-axis={vertical ? "vertical" : "horizontal"} fill="none" strokeLinecap="butt">
        {hiddenEdges.map((edge, index) => <path data-symbol-part="beam-hidden-edge" key={index} d={edge} strokeDasharray="75 38" {...common} />)}
      </g>
    );
  }
  if (item.presetId === "aircon-ceiling") {
    const chamfer = Math.min(width, height) * 0.02;
    const innerInset = Math.min(width, height) * 0.02;
    const centerInset = Math.min(width, height) * 0.12;
    const ventInset = Math.min(width, height) * 0.07;
    // 현장 제공 DWG의 카세트 블록이며 KS F 1501 표시기호로 분류하지 않는다.
    return (
      <g data-symbol-source="supplied-dwg" data-symbol-part="cassette-ac" fill="none" {...common}>
        <path d={`M ${x + chamfer} ${y} H ${x + width - chamfer} L ${x + width} ${y + chamfer} V ${y + height - chamfer} L ${x + width - chamfer} ${y + height} H ${x + chamfer} L ${x} ${y + height - chamfer} V ${y + chamfer} Z`} />
        <rect x={x + innerInset} y={y + innerInset} width={width - innerInset * 2} height={height - innerInset * 2} />
        <rect x={x + centerInset} y={y + centerInset} width={width - centerInset * 2} height={height - centerInset * 2} />
        <path d={`M ${x + centerInset} ${y + ventInset} H ${x + width - centerInset} L ${x + width - centerInset - ventInset * 0.55} ${y + centerInset - innerInset} H ${x + centerInset + ventInset * 0.55} Z`} />
        <path d={`M ${x + centerInset} ${y + height - ventInset} H ${x + width - centerInset} L ${x + width - centerInset - ventInset * 0.55} ${y + height - centerInset + innerInset} H ${x + centerInset + ventInset * 0.55} Z`} />
        <path d={`M ${x + ventInset} ${y + centerInset} V ${y + height - centerInset} L ${x + centerInset - innerInset} ${y + height - centerInset - ventInset * 0.55} V ${y + centerInset + ventInset * 0.55} Z`} />
        <path d={`M ${x + width - ventInset} ${y + centerInset} V ${y + height - centerInset} L ${x + width - centerInset + innerInset} ${y + height - centerInset - ventInset * 0.55} V ${y + centerInset + ventInset * 0.55} Z`} />
        <text x={centerX} y={centerY} dy="0.35em" textAnchor="middle" fill={color} stroke="none" fontSize={Math.min(width, height) * 0.16} fontWeight="700">A/C</text>
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

function measurementLabel(item: SiteLayoutItemMm, draft: SiteLayoutDraftMm) {
  if (item.presetId === "aircon-ceiling") {
    return [`설치면 H=${formatMm(item.mountingHeightMm ?? draft.roomCeilingHeightMm)} mm`];
  }
  if (item.presetId === "aircon-wall") {
    return [`설치높이 ${formatMm(item.mountingHeightMm ?? 2_100)} mm`];
  }
  const size = item.kind === "door" || item.kind === "window"
    ? `${item.kind === "door" ? "문틀 전체" : "창틀 전체"} ${formatMm(item.widthMm)}×${formatMm(item.openingHeightMm ?? item.heightMm)} mm`
    : `${formatMm(item.widthMm)}×${formatMm(item.heightMm)} mm`;
  if (item.kind === "window") {
    return [`창틀 전체 높이 ${formatMm(item.openingHeightMm ?? item.heightMm)} mm`, `바닥→창틀 하단 ${formatMm(item.sillHeightMm ?? 0)} mm`];
  }
  if (item.kind === "door") return [`문틀 전체 높이 ${formatMm(item.openingHeightMm ?? item.heightMm)} mm`];
  if (item.kind === "beam") {
    return [size, `보 하단 ${formatMm(item.beamBottomHeightMm ?? 0)} mm`];
  }
  if (item.kind === "pillar") {
    const wallFlush = item.structureAttachment?.mode === "wall"
      && (item.wallInsetMm ?? 0) === 0;
    return wallFlush ? [size, "벽 밀착 · 이격 0 mm"] : [size];
  }
  return [size];
}

type ItemLabelPlacement = { xMm: number; yMm: number; textAnchor: "start" | "middle" | "end" };

function ItemLabel({ draft, item, geometry, color, compact, paper, placement }: {
  draft: SiteLayoutDraftMm;
  item: SiteLayoutItemMm;
  geometry: ItemGeometryMm;
  color: string;
  compact: boolean;
  paper: boolean;
  placement?: ItemLabelPlacement;
}) {
  if (compact) return null;
  const fontSize = paper ? 132 : 145;
  const x = placement?.xMm ?? geometry.centerXmm;
  const y = placement?.yMm ?? (item.wall === "top"
    ? geometry.yMm + geometry.heightMm + 155
    : item.wall === "bottom"
      ? geometry.yMm - (paper ? 190 : 115)
      : geometry.yMm + geometry.heightMm + 185);
  const details = paper ? measurementLabel(item, draft) : [];
  return (
    <text x={x} y={y} fill={color} fontSize={fontSize} fontWeight={800} textAnchor={placement?.textAnchor ?? "middle"} pointerEvents="none" paintOrder="stroke" stroke={paper ? "#fff" : "transparent"} strokeWidth={paper ? 5 : 0} strokeLinejoin="round">
      <tspan x={x}>{item.name.slice(0, 26)}</tspan>
      {details.map((line, index) => <tspan key={`${item.id}-${index}`} x={x} dy={index === 0 ? 155 : 135} fontSize={paper ? 112 : fontSize} fontWeight={650}>{line}</tspan>)}
    </text>
  );
}

function dimensionProjection(
  draft: SiteLayoutDraftMm,
  segment: SiteLayoutLaidOutDimensionSegmentMm,
  point: { xMm: number; yMm: number },
) {
  // Room-to-centre measurements belong inside the room. Projecting them to an
  // exterior lane makes long AC/pillar datums collide with door/window chains.
  if (segment.kind === "position") return point;
  const offset = segment.laneOffsetMm;
  if (segment.axis === "x") {
    return { xMm: point.xMm, yMm: segment.side === "bottom" ? draft.roomHeightMm + draft.roomWallThicknessMm + offset : -draft.roomWallThicknessMm - offset };
  }
  return { xMm: segment.side === "right" ? draft.roomWidthMm + draft.roomWallThicknessMm + offset : -draft.roomWallThicknessMm - offset, yMm: point.yMm };
}

function LinearDimension({ draft, segment, palette }: {
  draft: SiteLayoutDraftMm;
  segment: SiteLayoutLaidOutDimensionSegmentMm;
  palette: Palette;
}) {
  const projectedStart = dimensionProjection(draft, segment, segment.start);
  const projectedEnd = dimensionProjection(draft, segment, segment.end);
  const midpoint = {
    xMm: (projectedStart.xMm + projectedEnd.xMm) / 2,
    yMm: (projectedStart.yMm + projectedEnd.yMm) / 2,
  };
  const tick = 52;
  const horizontal = segment.axis === "x";
  const textX = horizontal ? midpoint.xMm : midpoint.xMm + (segment.side === "right" ? 94 : -94);
  const textY = horizontal ? midpoint.yMm + (segment.side === "bottom" ? 160 : -76) : midpoint.yMm;
  const textTransform = horizontal ? undefined : `rotate(-90 ${textX} ${textY})`;
  const startTick = horizontal
    ? `M ${projectedStart.xMm - tick} ${projectedStart.yMm + tick} L ${projectedStart.xMm + tick} ${projectedStart.yMm - tick}`
    : `M ${projectedStart.xMm - tick} ${projectedStart.yMm + tick} L ${projectedStart.xMm + tick} ${projectedStart.yMm - tick}`;
  const endTick = horizontal
    ? `M ${projectedEnd.xMm - tick} ${projectedEnd.yMm + tick} L ${projectedEnd.xMm + tick} ${projectedEnd.yMm - tick}`
    : `M ${projectedEnd.xMm - tick} ${projectedEnd.yMm + tick} L ${projectedEnd.xMm + tick} ${projectedEnd.yMm - tick}`;
  return (
    <g data-dimension-id={segment.id} data-dimension-kind={segment.kind} data-dimension-lane={segment.laneIndex} fill="none" stroke={palette.dimension} strokeWidth={1.7} vectorEffect="non-scaling-stroke" pointerEvents="none">
      <path d={`M ${segment.start.xMm} ${segment.start.yMm} L ${projectedStart.xMm} ${projectedStart.yMm}`} opacity={0.62} />
      <path d={`M ${segment.end.xMm} ${segment.end.yMm} L ${projectedEnd.xMm} ${projectedEnd.yMm}`} opacity={0.62} />
      <path d={`M ${projectedStart.xMm} ${projectedStart.yMm} L ${projectedEnd.xMm} ${projectedEnd.yMm}`} />
      <path d={`${startTick} ${endTick}`} />
      <circle cx={projectedStart.xMm} cy={projectedStart.yMm} r={15} fill={palette.dimension} stroke="none" />
      <circle cx={projectedEnd.xMm} cy={projectedEnd.yMm} r={15} fill={palette.dimension} stroke="none" />
      <text
        x={textX}
        y={textY}
        transform={textTransform}
        fill={palette.dimension}
        stroke="#fff"
        strokeWidth={12}
        paintOrder="stroke"
        strokeLinejoin="round"
        fontSize={126}
        fontWeight={850}
        textAnchor="middle"
        dominantBaseline="middle"
      >{segment.label}</text>
    </g>
  );
}

function ObjectDimensionLayer({ draft, segments, palette }: { draft: SiteLayoutDraftMm; segments: SiteLayoutLaidOutDimensionSegmentMm[]; palette: Palette }) {
  return <g aria-label="객체 실측 치수선">{segments.map((segment) => <LinearDimension key={segment.id} draft={draft} segment={segment} palette={palette} />)}</g>;
}

function DimensionLayer({ draft, palette, topOffsetMm, leftOffsetMm }: { draft: SiteLayoutDraftMm; palette: Palette; topOffsetMm: number; leftOffsetMm: number }) {
  const wall = draft.roomWallThicknessMm;
  const widthY = -wall - topOffsetMm;
  const heightX = -wall - leftOffsetMm;
  const strokeWidth = 1.5;
  return (
    <g fill={palette.dimension} stroke={palette.dimension} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" pointerEvents="none">
      <path d={`M 0 0 L 0 ${widthY} M ${draft.roomWidthMm} 0 L ${draft.roomWidthMm} ${widthY} M 0 ${widthY} L ${draft.roomWidthMm} ${widthY} M -52 ${widthY + 52} L 52 ${widthY - 52} M ${draft.roomWidthMm - 52} ${widthY + 52} L ${draft.roomWidthMm + 52} ${widthY - 52}`} fill="none" />
      <text x={draft.roomWidthMm / 2} y={widthY - 60} fill={palette.dimension} stroke="#fff" strokeWidth={12} paintOrder="stroke" fontSize={150} fontWeight={850} textAnchor="middle">{formatMm(draft.roomWidthMm)} mm</text>
      <path d={`M 0 0 L ${heightX} 0 M 0 ${draft.roomHeightMm} L ${heightX} ${draft.roomHeightMm} M ${heightX} 0 L ${heightX} ${draft.roomHeightMm} M ${heightX - 52} 52 L ${heightX + 52} -52 M ${heightX - 52} ${draft.roomHeightMm + 52} L ${heightX + 52} ${draft.roomHeightMm - 52}`} fill="none" />
      <text x={heightX - 70} y={draft.roomHeightMm / 2} fill={palette.dimension} stroke="#fff" strokeWidth={12} paintOrder="stroke" fontSize={150} fontWeight={850} textAnchor="middle" transform={`rotate(-90 ${heightX - 70} ${draft.roomHeightMm / 2})`}>{formatMm(draft.roomHeightMm)} mm</text>
    </g>
  );
}

type LabelBoundsMm = { left: number; right: number; top: number; bottom: number };

function labelBounds(
  placement: ItemLabelPlacement,
  widthMm: number,
  fontSizeMm: number,
  detailCount: number,
): LabelBoundsMm {
  const left = placement.textAnchor === "start"
    ? placement.xMm
    : placement.textAnchor === "end" ? placement.xMm - widthMm : placement.xMm - widthMm / 2;
  return {
    left,
    right: left + widthMm,
    top: placement.yMm - fontSizeMm,
    bottom: placement.yMm + detailCount * 145 + 35,
  };
}

function labelBoundsOverlap(first: LabelBoundsMm, second: LabelBoundsMm, gapMm = 55) {
  return first.left < second.right + gapMm
    && second.left < first.right + gapMm
    && first.top < second.bottom + gapMm
    && second.top < first.bottom + gapMm;
}

function dimensionTextBounds(draft: SiteLayoutDraftMm, segment: SiteLayoutLaidOutDimensionSegmentMm): LabelBoundsMm {
  const start = dimensionProjection(draft, segment, segment.start);
  const end = dimensionProjection(draft, segment, segment.end);
  const midpoint = { xMm: (start.xMm + end.xMm) / 2, yMm: (start.yMm + end.yMm) / 2 };
  const labelLengthMm = Math.max(320, segment.label.length * 76);
  if (segment.axis === "x") {
    const yMm = midpoint.yMm + (segment.side === "bottom" ? 160 : -76);
    return { left: midpoint.xMm - labelLengthMm / 2, right: midpoint.xMm + labelLengthMm / 2, top: yMm - 75, bottom: yMm + 75 };
  }
  const xMm = midpoint.xMm + (segment.side === "right" ? 94 : -94);
  return { left: xMm - 75, right: xMm + 75, top: midpoint.yMm - labelLengthMm / 2, bottom: midpoint.yMm + labelLengthMm / 2 };
}

function layoutItemLabels(
  draft: SiteLayoutDraftMm,
  items: SiteLayoutItemMm[],
  segments: SiteLayoutLaidOutDimensionSegmentMm[],
  paper: boolean,
) {
  const placements = new Map<string, ItemLabelPlacement>();
  const occupied: LabelBoundsMm[] = segments.filter((segment) => segment.kind === "position").map((segment) => dimensionTextBounds(draft, segment));
  const paddingBySideMm: Record<SiteLayoutWallSide, number> = { top: 0, right: 0, bottom: 0, left: 0 };
  const sorted = [...items].sort((first, second) => {
    const firstGeometry = computeItemGeometryMm(draft, first);
    const secondGeometry = computeItemGeometryMm(draft, second);
    return firstGeometry.yMm - secondGeometry.yMm || firstGeometry.xMm - secondGeometry.xMm;
  });

  for (const item of sorted) {
    const geometry = computeItemGeometryMm(draft, item);
    const details = paper ? measurementLabel(item, draft) : [];
    const fontSize = paper ? 132 : 145;
    const lines = [item.name.slice(0, 26), ...details];
    const estimatedWidthMm = Math.max(...lines.map((line, index) => line.length * (index === 0 ? fontSize : 112) * 0.62), 280);
    const blockStepMm = fontSize + details.length * 145 + 95;
    const preferred: ItemLabelPlacement = item.wall === "left"
      ? { xMm: geometry.xMm + geometry.widthMm + 175, yMm: geometry.centerYmm, textAnchor: "start" }
      : item.wall === "right"
        ? { xMm: geometry.xMm - 175, yMm: geometry.centerYmm, textAnchor: "end" }
        : item.wall === "bottom"
          ? { xMm: geometry.centerXmm, yMm: geometry.yMm - 170 - details.length * 145, textAnchor: "middle" }
          : { xMm: geometry.centerXmm, yMm: geometry.yMm + geometry.heightMm + (item.wall === "top" ? 155 : 185), textAnchor: "middle" };
    const direction = item.wall === "bottom" ? -1 : 1;
    const candidateSteps = [0, 1, -1, 2, -2, 3, -3];
    let chosen = preferred;
    let chosenBounds = labelBounds(chosen, estimatedWidthMm, fontSize, details.length);
    for (const step of candidateSteps) {
      const candidate = { ...preferred, yMm: preferred.yMm + step * direction * blockStepMm };
      const bounds = labelBounds(candidate, estimatedWidthMm, fontSize, details.length);
      if (occupied.every((existing) => !labelBoundsOverlap(bounds, existing))) {
        chosen = candidate;
        chosenBounds = bounds;
        break;
      }
    }
    placements.set(item.id, chosen);
    occupied.push(chosenBounds);
    const topOverflowMm = Math.max(0, -chosenBounds.top);
    const leftOverflowMm = Math.max(0, -chosenBounds.left);
    const rightOverflowMm = Math.max(0, chosenBounds.right - draft.roomWidthMm);
    const bottomOverflowMm = Math.max(0, chosenBounds.bottom - draft.roomHeightMm);
    paddingBySideMm.top = Math.max(paddingBySideMm.top, topOverflowMm > 0 ? topOverflowMm + 90 : 0);
    paddingBySideMm.left = Math.max(paddingBySideMm.left, leftOverflowMm > 0 ? leftOverflowMm + 90 : 0);
    paddingBySideMm.right = Math.max(paddingBySideMm.right, rightOverflowMm > 0 ? rightOverflowMm + 90 : 0);
    paddingBySideMm.bottom = Math.max(paddingBySideMm.bottom, bottomOverflowMm > 0 ? bottomOverflowMm + 90 : 0);
  }
  return { placements, paddingBySideMm };
}

function RoomInformation({ draft, palette, compact }: { draft: SiteLayoutDraftMm; palette: Palette; compact: boolean }) {
  if (compact) return null;
  const x = 0;
  const y = -draft.roomWallThicknessMm - 430;
  const width = Math.min(5_400, draft.roomWidthMm * 0.58);
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={width} height={230} rx={45} fill={palette.background} fillOpacity={0.94} stroke={palette.wallLine} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <text x={x + 120} y={y + 150} fill={palette.label} fontSize={130} fontWeight={750}>내부 실측 · {draft.roomName} · 천장 H={formatMm(draft.roomCeilingHeightMm)} mm</text>
    </g>
  );
}

export function SiteLayoutGeometryView({
  draft,
  mode = "model",
  className,
  style,
  viewport,
  paddingMm,
  selectedItemId,
  interactive = false,
  interactionMode = "drag",
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
  const backgroundPointerRef = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null);
  const hatchId = `${id}-wall-hatch`;
  const wallMaskId = `${id}-wall-mask`;
  const palette = mode === "paper" ? paperPalette : modelPalette;
  const compact = mode === "mobile";
  const visibleItems = draft.items.filter(isItemVisible);
  const objectDimensionSegments = showDimensions && mode === "paper"
    ? buildSiteLayoutDimensionSegmentsMm({ ...draft, items: visibleItems })
    : [];
  const dimensionLayout = layoutSiteLayoutDimensionSegmentsMm(objectDimensionSegments);
  const itemLabelLayout = showLabels && !compact
    ? layoutItemLabels(draft, visibleItems, dimensionLayout.segments, mode === "paper")
    : { placements: new Map<string, ItemLabelPlacement>(), paddingBySideMm: { top: 0, right: 0, bottom: 0, left: 0 } };
  const requiredPaddingBySideMm: Record<SiteLayoutWallSide, number> = {
    top: Math.max(dimensionLayout.paddingBySideMm.top, itemLabelLayout.paddingBySideMm.top),
    right: Math.max(dimensionLayout.paddingBySideMm.right, itemLabelLayout.paddingBySideMm.right),
    bottom: Math.max(dimensionLayout.paddingBySideMm.bottom, itemLabelLayout.paddingBySideMm.bottom),
    left: Math.max(dimensionLayout.paddingBySideMm.left, itemLabelLayout.paddingBySideMm.left),
  };
  const viewBox: SvgViewBoxMm = computeSvgViewBox(draft, {
    paddingMm,
    paddingBySideMm: showDimensions || showLabels ? requiredPaddingBySideMm : undefined,
  });
  const wallGeometry = computeWallGeometryMm(draft);
  const openingCuts = visibleItems
    .map((item) => computeOpeningCutGeometryMm(draft, item))
    .filter((rect): rect is GeometryRectMm => rect !== null);
  // Keep the same plotted line hierarchy in model, A3 preview, and PDF.
  // Cut structures are strongest, opening frames are medium, and hidden
  // overhead members remain the lightest line type.
  const cutStrokeWidth = 2.05;
  const openingStrokeWidth = 1.8;
  const fixtureStrokeWidth = 1.55;
  const hiddenStrokeWidth = 1.35;

  function modelPoint(event: { clientX: number; clientY: number; currentTarget: SVGElement }) {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
      ?? event.currentTarget.getBoundingClientRect();
    return modelPointFromClient(event, bounds, viewBox);
  }

  function handleBackgroundPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!interactive) return;
    if (interactionMode === "select") {
      backgroundPointerRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
      return;
    }
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
      x={viewport?.x}
      y={viewport?.y}
      width={viewport?.width}
      height={viewport?.height}
      style={{
        display: "block",
        width: viewport ? undefined : "100%",
        height: viewport ? undefined : "100%",
        minWidth: 0,
        minHeight: 0,
        background: palette.background,
        touchAction: interactive ? interactionMode === "select" ? "pan-x pan-y pinch-zoom" : "none" : "auto",
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
        const pointerStart = backgroundPointerRef.current;
        if (interactive && interactionMode === "select" && pointerStart?.pointerId === event.pointerId) {
          const moved = Math.hypot(event.clientX - pointerStart.clientX, event.clientY - pointerStart.clientY);
          // Item groups stop propagation, so every pointer recorded here started on
          // the drawing background (including wall/room SVG children). A movement
          // threshold keeps a guided-mode scroll or pinch from placing an object.
          if (moved < 8) onBackgroundPointerDown?.(modelPoint(event), event);
          backgroundPointerRef.current = null;
        }
        if (interactive) onModelPointerUp?.(modelPoint(event), event);
      }}
      onPointerCancel={(event) => {
        backgroundPointerRef.current = null;
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
          <rect key={wall} {...svgRect(rect)} fill={`url(#${hatchId})`} stroke={palette.wallLine} strokeWidth={cutStrokeWidth} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <rect x={0} y={0} width={draft.roomWidthMm} height={draft.roomHeightMm} fill="none" stroke={palette.wallLine} strokeWidth={cutStrokeWidth} vectorEffect="non-scaling-stroke" />

      {showDimensions && <DimensionLayer draft={draft} palette={palette} topOffsetMm={dimensionLayout.overallOffsetMm.top} leftOffsetMm={dimensionLayout.overallOffsetMm.left} />}
      {showDimensions && mode === "paper" && <ObjectDimensionLayer draft={draft} segments={dimensionLayout.segments} palette={palette} />}
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
              <DoorSymbol draft={draft} item={item} geometry={geometry} color={color} strokeWidth={openingStrokeWidth} />
            ) : item.kind === "window" ? (
              <WindowSymbol draft={draft} item={item} geometry={geometry} color={color} strokeWidth={openingStrokeWidth} />
            ) : (
              <GenericItemSymbol
                item={item}
                geometry={geometry}
                color={color}
                wallHatchId={hatchId}
                strokeWidth={item.kind === "pillar" ? cutStrokeWidth : item.kind === "beam" ? hiddenStrokeWidth : fixtureStrokeWidth}
              />
            )}
            {showLabels && <ItemLabel draft={draft} item={item} geometry={geometry} color={color} compact={compact} paper={mode === "paper"} placement={itemLabelLayout.placements.get(item.id)} />}
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
