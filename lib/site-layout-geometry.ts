/**
 * Physical geometry and local persistence primitives for the basic floor-plan tool.
 *
 * The model deliberately stores every physical value as an integer millimetre.
 * Browser pixels, percentages and responsive breakpoints are projections only and
 * must never be written back into a draft.
 */

export const DRAFT_SCHEMA_VERSION = 3 as const;
export const STORAGE_KEY = "whizzup:site-layout-draft:v3";
export const PREVIOUS_STORAGE_KEY = "whizzup:site-layout-draft:v2";
export const LEGACY_STORAGE_KEY = "whizzup:site-layout-draft:v1";

export const GUIDE_STEPS = [
  "room",
  "door",
  "structure",
  "window",
  "facility",
  "checklist",
  "review",
] as const;

export type SiteLayoutGuideStep = (typeof GUIDE_STEPS)[number];
export type SiteLayoutWallSide = "top" | "right" | "bottom" | "left";
export type SiteLayoutRotation = 0 | 90;
export type SiteLayoutItemKind =
  | "equipment"
  | "table"
  | "door"
  | "window"
  | "pillar"
  | "beam"
  | "fixture"
  | "note";
export type WallOffsetAnchor = "start" | "center";
export type WallAlignment = "centerline" | "inside";
export type StructureDistanceMode = "clear" | "center";
export type StructureMeasurementAxis = "x" | "y";
export type StructureAttachment =
  | { mode: "wall"; wall: SiteLayoutWallSide }
  | { mode: "free" };
export type StructureMeasurement = {
  axis: StructureMeasurementAxis;
  referenceType: "wall" | "item";
  referenceWall?: SiteLayoutWallSide;
  referenceItemId?: string;
  /** +1 is left-to-right/top-to-bottom, -1 is the reverse direction. */
  direction: 1 | -1;
  /** clear = face-to-face, center = centre-line-to-centre-line. */
  distanceMode: StructureDistanceMode;
  distanceMm: number;
};
export type OpeningMeasurement = StructureMeasurement;

export type SiteLayoutItemMm = {
  id: string;
  kind: SiteLayoutItemKind;
  presetId?: string;
  name: string;
  /** Top-left position in room coordinates. Origin is the inner top-left corner. */
  xMm: number;
  yMm: number;
  /** Unrotated plan footprint. For an opening, width is the wall span. */
  widthMm: number;
  heightMm: number;
  rotation: SiteLayoutRotation;
  wall?: SiteLayoutWallSide;
  /** Distance along the wall, measured from its left/top origin. */
  offsetMm?: number;
  offsetAnchor?: WallOffsetAnchor;
  wallAlignment?: WallAlignment;
  openingHeightMm?: number;
  sillHeightMm?: number;
  handing?: "left" | "right";
  swing?: "inside" | "outside";
  mountingHeightMm?: number;
  beamBottomHeightMm?: number;
  beamSpacingMm?: number;
  /** Physical mounting is independent from the datum used to measure location. */
  structureAttachment?: StructureAttachment;
  /** Measurement datum for a pillar/beam. The referenced item is a stable item id. */
  structureMeasurement?: StructureMeasurement;
  /** Clear perpendicular distance from an attached wall to the nearest pillar face. */
  wallInsetMm?: number;
  /** Survey walls used for each clear face-distance of a free-standing pillar. */
  freeReferenceX?: "left" | "right";
  freeReferenceY?: "top" | "bottom";
  /** Optional field-survey datum for a window measured from a wall or previous window. */
  openingMeasurement?: OpeningMeasurement;
};

export type SiteLayoutDraftMm = {
  schemaVersion: typeof DRAFT_SCHEMA_VERSION;
  roomName: string;
  roomWidthMm: number;
  roomHeightMm: number;
  roomCeilingHeightMm: number;
  roomWallThicknessMm: number;
  items: SiteLayoutItemMm[];
  stageChecks: Record<string, string>;
  siteChecklist: Record<string, string>;
  fieldNotes: string;
  activeGuideStep: SiteLayoutGuideStep;
  savedAt?: string;
};

export type GeometryRectMm = {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
};

export type ItemGeometryMm = GeometryRectMm & {
  itemId: string;
  rotation: SiteLayoutRotation;
  /** Physical wall span before axis-aligned rotation. */
  physicalWidthMm: number;
  physicalHeightMm: number;
  centerXmm: number;
  centerYmm: number;
  wall?: SiteLayoutWallSide;
  spanStartMm?: number;
  spanEndMm?: number;
};

export type SiteLayoutDimensionPointMm = {
  xMm: number;
  yMm: number;
};

export type SiteLayoutDimensionSegmentMm = {
  id: string;
  subjectItemId: string;
  referenceItemId?: string;
  axis: StructureMeasurementAxis;
  side: SiteLayoutWallSide;
  kind: "span" | "reference" | "position";
  distanceMode: StructureDistanceMode;
  start: SiteLayoutDimensionPointMm;
  end: SiteLayoutDimensionPointMm;
  distanceMm: number;
  label: string;
};

export type SiteLayoutLaidOutDimensionSegmentMm = SiteLayoutDimensionSegmentMm & {
  /** Zero-based exterior lane. Interior position dimensions use -1. */
  laneIndex: number;
  /** Perpendicular distance from the outside face of the wall. */
  laneOffsetMm: number;
};

export type SiteLayoutDimensionLayoutMm = {
  segments: SiteLayoutLaidOutDimensionSegmentMm[];
  /** Overall room dimensions are always placed outside every object lane. */
  overallOffsetMm: Pick<Record<SiteLayoutWallSide, number>, "top" | "left">;
  /** Minimum directional viewBox padding required to contain lines and text. */
  paddingBySideMm: Record<SiteLayoutWallSide, number>;
};

export type SvgViewBoxMm = {
  minX: number;
  minY: number;
  width: number;
  height: number;
  value: string;
};

export type DraftValidationIssue = {
  code:
    | "room-dimension"
    | "wall-thickness"
    | "ceiling-height"
    | "item-dimension"
    | "item-outside-room"
    | "wall-offset"
    | "opening-height"
    | "opening-overlap"
    | "ceiling-aircon-square"
    | "structure-reference-missing"
    | "structure-reference-kind"
    | "structure-reference-axis"
    | "structure-reference-wall"
    | "structure-reference-direction"
    | "structure-reference-cycle"
    | "structure-distance-outside-room";
  severity: "warning" | "error";
  message: string;
  itemId?: string;
  path?: string;
};

export type NormalizedDraftResult = {
  draft: SiteLayoutDraftMm;
  source: "v3" | "v2" | "legacy-v1" | "default";
  issues: DraftValidationIssue[];
};

export type StructurePlacementResult = {
  items: SiteLayoutItemMm[];
  issues: DraftValidationIssue[];
};

const DEFAULT_ROOM_WIDTH_MM = 13_724;
const DEFAULT_ROOM_HEIGHT_MM = 8_146;
const DEFAULT_CEILING_HEIGHT_MM = 2_551;
const DEFAULT_WALL_THICKNESS_MM = 150;
const MAX_ROOM_DIMENSION_MM = 100_000;
const MAX_ITEM_DIMENSION_MM = 100_000;
const WALL_SIDES: readonly SiteLayoutWallSide[] = ["top", "right", "bottom", "left"];
const ITEM_KINDS: readonly SiteLayoutItemKind[] = [
  "equipment",
  "table",
  "door",
  "window",
  "pillar",
  "beam",
  "fixture",
  "note",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function roundMillimeters(value: number) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

export function metersToMillimeters(value: number) {
  return roundMillimeters(value * 1000);
}

export function millimetersToMeters(value: number) {
  return roundMillimeters(value) / 1000;
}

function normalizedMm(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = finiteNumber(value);
  return clamp(roundMillimeters(parsed ?? fallback), minimum, maximum);
}

function legacyMetersToMm(value: unknown, fallbackMm: number, minimum = 0, maximum = MAX_ITEM_DIMENSION_MM) {
  const parsed = finiteNumber(value);
  return normalizedMm(parsed === null ? fallbackMm : parsed * 1000, fallbackMm, minimum, maximum);
}

function sanitizeText(value: unknown, fallback: string, maximumLength: number) {
  return typeof value === "string" ? value.slice(0, maximumLength) : fallback;
}

function sanitizeStringRecord(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, recordValue]) => [key.slice(0, 80), recordValue.slice(0, 200)]),
  );
}

function isWallSide(value: unknown): value is SiteLayoutWallSide {
  return typeof value === "string" && WALL_SIDES.includes(value as SiteLayoutWallSide);
}

function isItemKind(value: unknown): value is SiteLayoutItemKind {
  return typeof value === "string" && ITEM_KINDS.includes(value as SiteLayoutItemKind);
}

function isGuideStep(value: unknown): value is SiteLayoutGuideStep {
  return typeof value === "string" && GUIDE_STEPS.includes(value as SiteLayoutGuideStep);
}

function isStructureItem(item: Pick<SiteLayoutItemMm, "kind">) {
  return item.kind === "pillar" || item.kind === "beam";
}

function measurementAxisForWall(wall: SiteLayoutWallSide): StructureMeasurementAxis {
  return wall === "left" || wall === "right" ? "x" : "y";
}

function wallSpanAxis(wall: SiteLayoutWallSide): StructureMeasurementAxis {
  return wall === "top" || wall === "bottom" ? "x" : "y";
}

function normalizeStructureAttachment(
  value: unknown,
  kind: SiteLayoutItemKind,
  legacyWall: SiteLayoutWallSide | undefined,
  defaultBeamToWall: boolean,
): StructureAttachment | undefined {
  if (kind !== "pillar" && kind !== "beam") return undefined;
  if (isRecord(value) && value.mode === "free") return { mode: "free" };
  if (isRecord(value) && value.mode === "wall") {
    return { mode: "wall", wall: isWallSide(value.wall) ? value.wall : legacyWall ?? "top" };
  }
  if (legacyWall) return { mode: "wall", wall: legacyWall };
  if (kind === "beam" && defaultBeamToWall) return { mode: "wall", wall: "top" };
  return { mode: "free" };
}

function normalizeStructureMeasurement(
  value: unknown,
  attachment: StructureAttachment | undefined,
  legacyMeters: boolean,
): StructureMeasurement | undefined {
  if (!isRecord(value)) return undefined;
  const referenceItemId = sanitizeText(value.referenceItemId, "", 120) || undefined;
  const referenceWall = isWallSide(value.referenceWall) ? value.referenceWall : undefined;
  const referenceType = value.referenceType === "item" || (!value.referenceType && referenceItemId) ? "item" : "wall";
  const fallbackAxis = referenceWall
    ? measurementAxisForWall(referenceWall)
    : attachment?.mode === "wall"
      ? wallSpanAxis(attachment.wall)
      : "x";
  const rawDistanceMm = finiteNumber(value.distanceMm);
  const rawDistanceMeters = finiteNumber(value.distance);
  const distanceMm = normalizedMm(
    rawDistanceMm ?? (legacyMeters && rawDistanceMeters !== null ? rawDistanceMeters * 1000 : 0),
    0,
    0,
    MAX_ROOM_DIMENSION_MM,
  );
  return {
    axis: value.axis === "y" ? "y" : value.axis === "x" ? "x" : fallbackAxis,
    referenceType,
    referenceWall,
    referenceItemId,
    direction: value.direction === -1 ? -1 : referenceWall === "right" || referenceWall === "bottom" ? -1 : 1,
    distanceMode: value.distanceMode === "center" ? "center" : "clear",
    distanceMm,
  };
}

function normalizeOpeningMeasurement(value: unknown, legacyMeters: boolean): OpeningMeasurement | undefined {
  if (!isRecord(value)) return undefined;
  const referenceItemId = sanitizeText(value.referenceItemId, "", 120) || undefined;
  const referenceWall = isWallSide(value.referenceWall) ? value.referenceWall : undefined;
  const rawDistanceMm = finiteNumber(value.distanceMm);
  const rawDistanceMeters = finiteNumber(value.distance);
  return {
    axis: value.axis === "y" ? "y" : "x",
    referenceType: value.referenceType === "item" || (!value.referenceType && referenceItemId) ? "item" : "wall",
    referenceWall,
    referenceItemId,
    direction: value.direction === -1 ? -1 : 1,
    distanceMode: value.distanceMode === "center" ? "center" : "clear",
    distanceMm: normalizedMm(
      rawDistanceMm ?? (legacyMeters && rawDistanceMeters !== null ? rawDistanceMeters * 1000 : 0),
      0,
      0,
      MAX_ROOM_DIMENSION_MM,
    ),
  };
}

function isOpening(item: Pick<SiteLayoutItemMm, "kind">) {
  return item.kind === "door" || item.kind === "window";
}

function isWallAircon(item: Pick<SiteLayoutItemMm, "presetId">) {
  return item.presetId === "aircon-wall";
}

function defaultOffsetAnchor(item: Pick<SiteLayoutItemMm, "kind" | "presetId">): WallOffsetAnchor {
  return isWallAircon(item) ? "center" : "start";
}

function defaultWallAlignment(item: Pick<SiteLayoutItemMm, "kind" | "presetId">): WallAlignment {
  return isOpening(item) ? "centerline" : "inside";
}

export function createDefaultDraft(): SiteLayoutDraftMm {
  return {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    roomName: "스마트 체험교실",
    roomWidthMm: DEFAULT_ROOM_WIDTH_MM,
    roomHeightMm: DEFAULT_ROOM_HEIGHT_MM,
    roomCeilingHeightMm: DEFAULT_CEILING_HEIGHT_MM,
    roomWallThicknessMm: DEFAULT_WALL_THICKNESS_MM,
    items: [],
    stageChecks: {},
    siteChecklist: {},
    fieldNotes: "",
    activeGuideStep: "room",
    savedAt: undefined,
  };
}

export function wallLengthMm(draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm">, wall: SiteLayoutWallSide) {
  return wall === "top" || wall === "bottom" ? draft.roomWidthMm : draft.roomHeightMm;
}

export function rotatedFootprintMm(item: Pick<SiteLayoutItemMm, "widthMm" | "heightMm" | "rotation">) {
  return item.rotation === 90
    ? { widthMm: item.heightMm, heightMm: item.widthMm }
    : { widthMm: item.widthMm, heightMm: item.heightMm };
}

export function clampWallOffsetMm(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm">,
  item: Pick<SiteLayoutItemMm, "widthMm">,
  wall: SiteLayoutWallSide,
  requestedOffsetMm: number,
  anchor: WallOffsetAnchor = "start",
) {
  const lengthMm = wallLengthMm(draft, wall);
  const spanMm = Math.min(lengthMm, Math.max(1, roundMillimeters(item.widthMm)));
  if (anchor === "center") {
    return clamp(roundMillimeters(requestedOffsetMm), Math.ceil(spanMm / 2), Math.floor(lengthMm - spanMm / 2));
  }
  return clamp(roundMillimeters(requestedOffsetMm), 0, lengthMm - spanMm);
}

function wallSpanStartMm(item: Pick<SiteLayoutItemMm, "widthMm" | "offsetMm" | "offsetAnchor">) {
  const offsetMm = item.offsetMm ?? 0;
  return item.offsetAnchor === "center" ? offsetMm - item.widthMm / 2 : offsetMm;
}

function positionForWallMount(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm" | "roomWallThicknessMm">,
  item: Pick<SiteLayoutItemMm, "kind" | "presetId" | "widthMm" | "heightMm" | "wall" | "offsetMm" | "offsetAnchor" | "wallAlignment" | "wallInsetMm">,
) {
  const wall = item.wall ?? "top";
  const anchor = item.offsetAnchor ?? defaultOffsetAnchor(item);
  const offsetMm = clampWallOffsetMm(draft, item, wall, item.offsetMm ?? 0, anchor);
  const startMm = anchor === "center" ? offsetMm - item.widthMm / 2 : offsetMm;
  const alignment = item.wallAlignment ?? defaultWallAlignment(item);
  const thicknessMm = draft.roomWallThicknessMm;
  const crossAxisCenter = alignment === "centerline";
  const horizontal = wall === "top" || wall === "bottom";
  const rotation: SiteLayoutRotation = horizontal ? 0 : 90;
  const footprint = rotation === 90
    ? { widthMm: item.heightMm, heightMm: item.widthMm }
    : { widthMm: item.widthMm, heightMm: item.heightMm };
  const wallInsetMm = item.kind === "pillar"
    ? clamp(roundMillimeters(item.wallInsetMm ?? 0), 0, horizontal
      ? Math.max(0, draft.roomHeightMm - footprint.heightMm)
      : Math.max(0, draft.roomWidthMm - footprint.widthMm))
    : 0;

  if (wall === "top") {
    const yMm = crossAxisCenter ? -(thicknessMm + footprint.heightMm) / 2 : wallInsetMm;
    return { xMm: startMm, yMm, rotation, offsetMm, startMm };
  }
  if (wall === "bottom") {
    const yMm = crossAxisCenter
      ? draft.roomHeightMm + (thicknessMm - footprint.heightMm) / 2
      : draft.roomHeightMm - footprint.heightMm - wallInsetMm;
    return { xMm: startMm, yMm, rotation, offsetMm, startMm };
  }
  if (wall === "left") {
    const xMm = crossAxisCenter ? -(thicknessMm + footprint.widthMm) / 2 : wallInsetMm;
    return { xMm, yMm: startMm, rotation, offsetMm, startMm };
  }
  const xMm = crossAxisCenter
    ? draft.roomWidthMm + (thicknessMm - footprint.widthMm) / 2
    : draft.roomWidthMm - footprint.widthMm - wallInsetMm;
  return { xMm, yMm: startMm, rotation, offsetMm, startMm };
}

export function placeItemOnWall(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm" | "roomWallThicknessMm">,
  item: SiteLayoutItemMm,
  wall: SiteLayoutWallSide,
  requestedOffsetMm: number,
  options: { anchor?: WallOffsetAnchor; alignment?: WallAlignment } = {},
): SiteLayoutItemMm {
  const offsetAnchor = options.anchor ?? item.offsetAnchor ?? defaultOffsetAnchor(item);
  const wallAlignment = options.alignment ?? item.wallAlignment ?? defaultWallAlignment(item);
  const mounted = { ...item, wall, offsetMm: requestedOffsetMm, offsetAnchor, wallAlignment };
  const position = positionForWallMount(draft, mounted);
  return {
    ...mounted,
    xMm: roundMillimeters(position.xMm),
    yMm: roundMillimeters(position.yMm),
    rotation: position.rotation,
    offsetMm: position.offsetMm,
  };
}

export function computeItemGeometryMm(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm" | "roomWallThicknessMm">,
  item: SiteLayoutItemMm,
): ItemGeometryMm {
  const positioned = item.wall ? placeItemOnWall(draft, item, item.wall, item.offsetMm ?? 0) : item;
  const footprint = rotatedFootprintMm(positioned);
  const spanStartMm = positioned.wall ? wallSpanStartMm(positioned) : undefined;
  return {
    itemId: positioned.id,
    xMm: positioned.xMm,
    yMm: positioned.yMm,
    widthMm: footprint.widthMm,
    heightMm: footprint.heightMm,
    rotation: positioned.rotation,
    physicalWidthMm: positioned.widthMm,
    physicalHeightMm: positioned.heightMm,
    centerXmm: positioned.xMm + footprint.widthMm / 2,
    centerYmm: positioned.yMm + footprint.heightMm / 2,
    wall: positioned.wall,
    spanStartMm,
    spanEndMm: spanStartMm === undefined ? undefined : spanStartMm + positioned.widthMm,
  };
}

function dimensionPointForWall(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm">,
  wall: SiteLayoutWallSide,
  alongMm: number,
): SiteLayoutDimensionPointMm {
  if (wall === "top") return { xMm: alongMm, yMm: 0 };
  if (wall === "bottom") return { xMm: alongMm, yMm: draft.roomHeightMm };
  if (wall === "left") return { xMm: 0, yMm: alongMm };
  return { xMm: draft.roomWidthMm, yMm: alongMm };
}

function itemDimensionPoint(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm" | "roomWallThicknessMm">,
  item: SiteLayoutItemMm,
  geometry: ItemGeometryMm,
  axis: StructureMeasurementAxis,
  coordinateMm: number,
): SiteLayoutDimensionPointMm {
  if (item.wall && wallSpanAxis(item.wall) === axis) {
    return dimensionPointForWall(draft, item.wall, coordinateMm);
  }
  return axis === "x"
    ? { xMm: coordinateMm, yMm: geometry.centerYmm }
    : { xMm: geometry.centerXmm, yMm: coordinateMm };
}

function dimensionSideForItem(item: SiteLayoutItemMm, axis: StructureMeasurementAxis): SiteLayoutWallSide {
  const attachmentWall = item.structureAttachment?.mode === "wall" ? item.structureAttachment.wall : item.wall;
  if (attachmentWall && wallSpanAxis(attachmentWall) === axis) return attachmentWall;
  return axis === "x" ? "top" : "left";
}

function itemAxisCoordinates(geometry: ItemGeometryMm, axis: StructureMeasurementAxis) {
  const startMm = axis === "x" ? geometry.xMm : geometry.yMm;
  const endMm = axis === "x" ? geometry.xMm + geometry.widthMm : geometry.yMm + geometry.heightMm;
  return { startMm, endMm, centerMm: (startMm + endMm) / 2 };
}

function dimensionLabel(prefix: string, distanceMm: number) {
  return `${prefix}${prefix ? " " : ""}${Math.round(Math.abs(distanceMm)).toLocaleString("ko-KR")} mm`;
}

function dimensionSubjectName(item: Pick<SiteLayoutItemMm, "kind">) {
  if (item.kind === "pillar") return "기둥";
  if (item.kind === "beam") return "보";
  if (item.kind === "window") return "창호";
  if (item.kind === "door") return "문";
  return "객체";
}

function shortWallName(wall: SiteLayoutWallSide | undefined) {
  if (!wall) return "벽";
  if (wall === "top") return "상벽";
  if (wall === "right") return "우벽";
  if (wall === "bottom") return "하벽";
  return "좌벽";
}

/**
 * Converts stored survey datums into explicit CAD witness points.
 * The returned distance is always derived from the rendered geometry so zoom,
 * responsive layout and wall-hatch thickness can never change a measurement.
 */
export function buildSiteLayoutDimensionSegmentsMm(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm" | "roomWallThicknessMm" | "items">,
): SiteLayoutDimensionSegmentMm[] {
  const itemById = new Map(draft.items.map((item) => [item.id, item]));
  const geometryById = new Map(draft.items.map((item) => [item.id, computeItemGeometryMm(draft, item)]));
  const segments: SiteLayoutDimensionSegmentMm[] = [];

  function addSegment(segment: Omit<SiteLayoutDimensionSegmentMm, "distanceMm" | "label"> & { labelPrefix?: string }) {
    const distanceMm = segment.axis === "x"
      ? Math.abs(segment.end.xMm - segment.start.xMm)
      : Math.abs(segment.end.yMm - segment.start.yMm);
    if (distanceMm < 1) return;
    const { labelPrefix = "", ...rest } = segment;
    segments.push({ ...rest, distanceMm, label: dimensionLabel(labelPrefix, distanceMm) });
  }

  function addMeasuredReference(
    item: SiteLayoutItemMm,
    geometry: ItemGeometryMm,
    measurement: StructureMeasurement,
  ) {
    const target = itemAxisCoordinates(geometry, measurement.axis);
    const side = dimensionSideForItem(item, measurement.axis);
    const targetCoordinateMm = measurement.distanceMode === "center"
      ? target.centerMm
      : measurement.direction === 1 ? target.startMm : target.endMm;
    const end = itemDimensionPoint(draft, item, geometry, measurement.axis, targetCoordinateMm);

    if (measurement.referenceType === "item") {
      const reference = measurement.referenceItemId ? itemById.get(measurement.referenceItemId) : undefined;
      const referenceGeometry = reference ? geometryById.get(reference.id) : undefined;
      if (!reference || !referenceGeometry) return;
      const referenceAxis = itemAxisCoordinates(referenceGeometry, measurement.axis);
      const referenceCoordinateMm = measurement.distanceMode === "center"
        ? referenceAxis.centerMm
        : measurement.direction === 1 ? referenceAxis.endMm : referenceAxis.startMm;
      addSegment({
        id: `${item.id}-reference`,
        subjectItemId: item.id,
        referenceItemId: reference.id,
        axis: measurement.axis,
        side,
        kind: "reference",
        distanceMode: measurement.distanceMode,
        start: itemDimensionPoint(draft, reference, referenceGeometry, measurement.axis, referenceCoordinateMm),
        end,
        labelPrefix: `${dimensionSubjectName(item)} ${measurement.distanceMode === "center" ? "중심간" : "면간"}`,
      });
      return;
    }

    const roomSpanMm = measurement.axis === "x" ? draft.roomWidthMm : draft.roomHeightMm;
    const datumCoordinateMm = measurement.direction === 1 ? 0 : roomSpanMm;
    const datum = item.wall && wallSpanAxis(item.wall) === measurement.axis
      ? dimensionPointForWall(draft, item.wall, datumCoordinateMm)
      : measurement.axis === "x"
        ? { xMm: datumCoordinateMm, yMm: geometry.centerYmm }
        : { xMm: geometry.centerXmm, yMm: datumCoordinateMm };
    addSegment({
      id: `${item.id}-reference`,
      subjectItemId: item.id,
      axis: measurement.axis,
      side,
      kind: "reference",
      distanceMode: measurement.distanceMode,
      start: datum,
      end,
      labelPrefix: measurement.distanceMode === "center"
        ? `${shortWallName(measurement.referenceWall)}→${dimensionSubjectName(item)} 중심`
        : `${shortWallName(measurement.referenceWall)}→${dimensionSubjectName(item)} ${measurement.direction === 1 ? "시작" : "끝"}`,
    });
  }

  for (const item of draft.items) {
    const geometry = geometryById.get(item.id);
    if (!geometry) continue;

    if (isOpening(item) && item.wall && geometry.spanStartMm !== undefined && geometry.spanEndMm !== undefined) {
      addSegment({
        id: `${item.id}-span`,
        subjectItemId: item.id,
        axis: wallSpanAxis(item.wall),
        side: item.wall,
        kind: "span",
        distanceMode: "clear",
        start: dimensionPointForWall(draft, item.wall, geometry.spanStartMm),
        end: dimensionPointForWall(draft, item.wall, geometry.spanEndMm),
        labelPrefix: item.kind === "door" ? "문틀 전체" : "창틀 전체",
      });

      if (item.kind === "window" && item.openingMeasurement) {
        addMeasuredReference(item, geometry, item.openingMeasurement);
      } else {
        const axis = wallSpanAxis(item.wall);
        const targetCoordinateMm = item.offsetAnchor === "center"
          ? (axis === "x" ? geometry.centerXmm : geometry.centerYmm)
          : geometry.spanStartMm;
        addSegment({
          id: `${item.id}-reference`,
          subjectItemId: item.id,
          axis,
          side: item.wall,
          kind: "reference",
          distanceMode: item.offsetAnchor === "center" ? "center" : "clear",
          start: dimensionPointForWall(draft, item.wall, 0),
          end: dimensionPointForWall(draft, item.wall, targetCoordinateMm),
          labelPrefix: item.offsetAnchor === "center"
            ? `벽 시작→${dimensionSubjectName(item)} 중심`
            : `벽 시작→${item.kind === "door" ? "문틀 시작" : "창틀 시작"}`,
        });
        if (item.kind === "door") {
          addSegment({
            id: `${item.id}-reference-end`,
            subjectItemId: item.id,
            axis,
            side: item.wall,
            kind: "reference",
            distanceMode: "clear",
            start: dimensionPointForWall(draft, item.wall, geometry.spanEndMm),
            end: dimensionPointForWall(draft, item.wall, wallLengthMm(draft, item.wall)),
            labelPrefix: "문틀 끝→벽 끝",
          });
        }
      }
    }

    if (isStructureItem(item) && item.structureMeasurement) {
      addMeasuredReference(item, geometry, item.structureMeasurement);
    } else if (item.kind === "pillar" && !item.wall) {
      const xFromRight = item.freeReferenceX === "right";
      const yFromBottom = item.freeReferenceY === "bottom";
      addSegment({
        id: `${item.id}-position-x`, subjectItemId: item.id, axis: "x", side: xFromRight ? "bottom" : "top", kind: "position", distanceMode: "clear",
        start: { xMm: xFromRight ? draft.roomWidthMm : 0, yMm: geometry.centerYmm },
        end: { xMm: xFromRight ? geometry.xMm + geometry.widthMm : geometry.xMm, yMm: geometry.centerYmm },
        labelPrefix: xFromRight ? "우벽→기둥면" : "좌벽→기둥면",
      });
      addSegment({
        id: `${item.id}-position-y`, subjectItemId: item.id, axis: "y", side: yFromBottom ? "right" : "left", kind: "position", distanceMode: "clear",
        start: { xMm: geometry.centerXmm, yMm: yFromBottom ? draft.roomHeightMm : 0 },
        end: { xMm: geometry.centerXmm, yMm: yFromBottom ? geometry.yMm + geometry.heightMm : geometry.yMm },
        labelPrefix: yFromBottom ? "하벽→기둥면" : "상벽→기둥면",
      });
    }

    if (item.kind === "pillar" && item.wall) {
      if (item.wall === "top") {
        addSegment({
          id: `${item.id}-wall-inset`, subjectItemId: item.id, axis: "y", side: "left", kind: "position", distanceMode: "clear",
          start: { xMm: geometry.centerXmm, yMm: 0 }, end: { xMm: geometry.centerXmm, yMm: geometry.yMm }, labelPrefix: "상벽→기둥면",
        });
      } else if (item.wall === "bottom") {
        addSegment({
          id: `${item.id}-wall-inset`, subjectItemId: item.id, axis: "y", side: "right", kind: "position", distanceMode: "clear",
          start: { xMm: geometry.centerXmm, yMm: draft.roomHeightMm }, end: { xMm: geometry.centerXmm, yMm: geometry.yMm + geometry.heightMm }, labelPrefix: "하벽→기둥면",
        });
      } else if (item.wall === "left") {
        addSegment({
          id: `${item.id}-wall-inset`, subjectItemId: item.id, axis: "x", side: "top", kind: "position", distanceMode: "clear",
          start: { xMm: 0, yMm: geometry.centerYmm }, end: { xMm: geometry.xMm, yMm: geometry.centerYmm }, labelPrefix: "좌벽→기둥면",
        });
      } else {
        addSegment({
          id: `${item.id}-wall-inset`, subjectItemId: item.id, axis: "x", side: "bottom", kind: "position", distanceMode: "clear",
          start: { xMm: draft.roomWidthMm, yMm: geometry.centerYmm }, end: { xMm: geometry.xMm + geometry.widthMm, yMm: geometry.centerYmm }, labelPrefix: "우벽→기둥면",
        });
      }
    }

    if (item.kind === "beam" && item.wall && geometry.spanStartMm !== undefined && geometry.spanEndMm !== undefined) {
      addSegment({
        id: `${item.id}-span`,
        subjectItemId: item.id,
        axis: wallSpanAxis(item.wall),
        side: item.wall,
        kind: "span",
        distanceMode: "clear",
        start: dimensionPointForWall(draft, item.wall, geometry.spanStartMm),
        end: dimensionPointForWall(draft, item.wall, geometry.spanEndMm),
        labelPrefix: "보 길이",
      });
    }

    if (item.presetId === "aircon-ceiling") {
      addSegment({
        id: `${item.id}-position-x`, subjectItemId: item.id, axis: "x", side: "top", kind: "position", distanceMode: "center",
        start: { xMm: 0, yMm: geometry.centerYmm }, end: { xMm: geometry.centerXmm, yMm: geometry.centerYmm }, labelPrefix: "좌측벽→중심",
      });
      addSegment({
        id: `${item.id}-position-y`, subjectItemId: item.id, axis: "y", side: "left", kind: "position", distanceMode: "center",
        start: { xMm: geometry.centerXmm, yMm: 0 }, end: { xMm: geometry.centerXmm, yMm: geometry.centerYmm }, labelPrefix: "상단벽→중심",
      });
    }
  }

  return segments;
}

type DimensionLaneInterval = {
  lineStartMm: number;
  lineEndMm: number;
  labelStartMm: number;
  labelEndMm: number;
};

const DIMENSION_FIRST_LANE_OFFSET_MM = 150;
const DIMENSION_LANE_GAP_MM = 230;
const DIMENSION_OVERALL_GAP_MM = 280;
const DIMENSION_MIN_OVERALL_OFFSET_MM = 565;
const DIMENSION_TEXT_PADDING_MM = 260;

function dimensionLaneInterval(segment: SiteLayoutDimensionSegmentMm): DimensionLaneInterval {
  const startMm = segment.axis === "x" ? segment.start.xMm : segment.start.yMm;
  const endMm = segment.axis === "x" ? segment.end.xMm : segment.end.yMm;
  const lineStartMm = Math.min(startMm, endMm);
  const lineEndMm = Math.max(startMm, endMm);
  const midpointMm = (lineStartMm + lineEndMm) / 2;
  // Text is rendered at 126 SVG user units. Korean glyphs and formatted values
  // are conservatively estimated so lane allocation remains stable in print.
  const estimatedLabelWidthMm = Math.max(320, segment.label.length * 76);
  return {
    lineStartMm,
    lineEndMm,
    labelStartMm: midpointMm - estimatedLabelWidthMm / 2,
    labelEndMm: midpointMm + estimatedLabelWidthMm / 2,
  };
}

function dimensionIntervalsConflict(first: DimensionLaneInterval, second: DimensionLaneInterval) {
  const lineOverlap = first.lineStartMm < second.lineEndMm - 1
    && second.lineStartMm < first.lineEndMm - 1;
  const labelGapMm = 90;
  const labelOverlap = first.labelStartMm < second.labelEndMm + labelGapMm
    && second.labelStartMm < first.labelEndMm + labelGapMm;
  return lineOverlap || labelOverlap;
}

function dimensionSegmentKey(segment: SiteLayoutDimensionSegmentMm) {
  const start = `${roundMillimeters(segment.start.xMm)},${roundMillimeters(segment.start.yMm)}`;
  const end = `${roundMillimeters(segment.end.xMm)},${roundMillimeters(segment.end.yMm)}`;
  const endpoints = start < end ? `${start}:${end}` : `${end}:${start}`;
  return `${segment.axis}:${segment.side}:${segment.kind}:${endpoints}:${segment.label}`;
}

/**
 * Packs exterior object dimensions into non-overlapping CAD lanes. The output
 * remains entirely in millimetres, so responsive zoom changes only pixels.
 */
export function layoutSiteLayoutDimensionSegmentsMm(
  segments: SiteLayoutDimensionSegmentMm[],
): SiteLayoutDimensionLayoutMm {
  const seen = new Set<string>();
  const uniqueSegments = segments.filter((segment) => {
    const key = dimensionSegmentKey(segment);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const laidOutById = new Map<string, SiteLayoutLaidOutDimensionSegmentMm>();
  const laneCountBySide: Record<SiteLayoutWallSide, number> = { top: 0, right: 0, bottom: 0, left: 0 };

  for (const side of WALL_SIDES) {
    const lanes: DimensionLaneInterval[][] = [];
    const exteriorSegments = uniqueSegments
      .filter((segment) => segment.kind !== "position" && segment.side === side)
      .sort((first, second) => {
        const kindDifference = (first.kind === "span" ? 0 : 1) - (second.kind === "span" ? 0 : 1);
        if (kindDifference) return kindDifference;
        const distanceDifference = first.distanceMm - second.distanceMm;
        return distanceDifference || first.id.localeCompare(second.id);
      });

    for (const segment of exteriorSegments) {
      const interval = dimensionLaneInterval(segment);
      let laneIndex = lanes.findIndex((lane) => lane.every((occupied) => !dimensionIntervalsConflict(interval, occupied)));
      if (laneIndex < 0) {
        laneIndex = lanes.length;
        lanes.push([]);
      }
      lanes[laneIndex].push(interval);
      laidOutById.set(segment.id, {
        ...segment,
        laneIndex,
        laneOffsetMm: DIMENSION_FIRST_LANE_OFFSET_MM + laneIndex * DIMENSION_LANE_GAP_MM,
      });
    }
    laneCountBySide[side] = lanes.length;
  }

  const segmentsWithLanes = uniqueSegments.map((segment) => laidOutById.get(segment.id) ?? {
    ...segment,
    laneIndex: -1,
    laneOffsetMm: 0,
  });
  const maximumLaneOffset = (side: SiteLayoutWallSide) => laneCountBySide[side] > 0
    ? DIMENSION_FIRST_LANE_OFFSET_MM + (laneCountBySide[side] - 1) * DIMENSION_LANE_GAP_MM
    : 0;
  const overallOffsetMm = {
    top: Math.max(DIMENSION_MIN_OVERALL_OFFSET_MM, maximumLaneOffset("top") + DIMENSION_OVERALL_GAP_MM),
    left: Math.max(DIMENSION_MIN_OVERALL_OFFSET_MM, maximumLaneOffset("left") + DIMENSION_OVERALL_GAP_MM),
  };

  return {
    segments: segmentsWithLanes,
    overallOffsetMm,
    paddingBySideMm: {
      top: overallOffsetMm.top + DIMENSION_TEXT_PADDING_MM,
      left: overallOffsetMm.left + DIMENSION_TEXT_PADDING_MM,
      right: maximumLaneOffset("right") > 0 ? maximumLaneOffset("right") + DIMENSION_TEXT_PADDING_MM : 0,
      bottom: maximumLaneOffset("bottom") > 0 ? maximumLaneOffset("bottom") + DIMENSION_TEXT_PADDING_MM : 0,
    },
  };
}

export function computeWallGeometryMm(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm" | "roomWallThicknessMm">,
) {
  const widthMm = draft.roomWidthMm;
  const heightMm = draft.roomHeightMm;
  const thicknessMm = draft.roomWallThicknessMm;
  return {
    top: { xMm: -thicknessMm, yMm: -thicknessMm, widthMm: widthMm + thicknessMm * 2, heightMm: thicknessMm },
    right: { xMm: widthMm, yMm: -thicknessMm, widthMm: thicknessMm, heightMm: heightMm + thicknessMm * 2 },
    bottom: { xMm: -thicknessMm, yMm: heightMm, widthMm: widthMm + thicknessMm * 2, heightMm: thicknessMm },
    left: { xMm: -thicknessMm, yMm: -thicknessMm, widthMm: thicknessMm, heightMm: heightMm + thicknessMm * 2 },
  } satisfies Record<SiteLayoutWallSide, GeometryRectMm>;
}

export function computeOpeningCutGeometryMm(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm" | "roomWallThicknessMm">,
  item: SiteLayoutItemMm,
): GeometryRectMm | null {
  if (!item.wall || !isOpening(item)) return null;
  const mounted = placeItemOnWall(draft, item, item.wall, item.offsetMm ?? 0, { alignment: "centerline" });
  const startMm = wallSpanStartMm(mounted);
  const thicknessMm = draft.roomWallThicknessMm;
  if (mounted.wall === "top") return { xMm: startMm, yMm: -thicknessMm, widthMm: mounted.widthMm, heightMm: thicknessMm };
  if (mounted.wall === "bottom") return { xMm: startMm, yMm: draft.roomHeightMm, widthMm: mounted.widthMm, heightMm: thicknessMm };
  if (mounted.wall === "left") return { xMm: -thicknessMm, yMm: startMm, widthMm: thicknessMm, heightMm: mounted.widthMm };
  return { xMm: draft.roomWidthMm, yMm: startMm, widthMm: thicknessMm, heightMm: mounted.widthMm };
}

export function computeSvgViewBox(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm" | "roomWallThicknessMm"> & Partial<Pick<SiteLayoutDraftMm, "items">>,
  options: { paddingMm?: number; paddingBySideMm?: Partial<Record<SiteLayoutWallSide, number>> } = {},
): SvgViewBoxMm {
  const automaticPadding = Math.max(300, Math.round(Math.min(draft.roomWidthMm, draft.roomHeightMm) * 0.04));
  const paddingMm = normalizedMm(options.paddingMm ?? automaticPadding, automaticPadding, 0, 20_000);
  const sidePadding = (side: SiteLayoutWallSide) => Math.max(
    paddingMm,
    normalizedMm(options.paddingBySideMm?.[side] ?? 0, 0, 0, 20_000),
  );
  let topPaddingMm = sidePadding("top");
  let rightPaddingMm = sidePadding("right");
  let bottomPaddingMm = sidePadding("bottom");
  let leftPaddingMm = sidePadding("left");

  for (const item of draft.items ?? []) {
    if (item.kind !== "door" || item.swing !== "outside" || !item.wall) continue;
    const outsideDoorPaddingMm = normalizedMm(
      item.widthMm + draft.roomWallThicknessMm + 180,
      paddingMm,
      0,
      20_000,
    );
    if (item.wall === "top") topPaddingMm = Math.max(topPaddingMm, outsideDoorPaddingMm);
    else if (item.wall === "right") rightPaddingMm = Math.max(rightPaddingMm, outsideDoorPaddingMm);
    else if (item.wall === "bottom") bottomPaddingMm = Math.max(bottomPaddingMm, outsideDoorPaddingMm);
    else leftPaddingMm = Math.max(leftPaddingMm, outsideDoorPaddingMm);
  }

  const minX = -draft.roomWallThicknessMm - leftPaddingMm;
  const minY = -draft.roomWallThicknessMm - topPaddingMm;
  const width = draft.roomWidthMm + draft.roomWallThicknessMm * 2 + leftPaddingMm + rightPaddingMm;
  const height = draft.roomHeightMm + draft.roomWallThicknessMm * 2 + topPaddingMm + bottomPaddingMm;
  return { minX, minY, width, height, value: `${minX} ${minY} ${width} ${height}` };
}

export function modelPointFromClient(
  point: { clientX: number; clientY: number },
  bounds: { left: number; top: number; width: number; height: number },
  viewBox: Pick<SvgViewBoxMm, "minX" | "minY" | "width" | "height">,
) {
  if (!(bounds.width > 0) || !(bounds.height > 0) || !(viewBox.width > 0) || !(viewBox.height > 0)) {
    return { xMm: viewBox.minX, yMm: viewBox.minY, insideViewBox: false };
  }
  const pixelsPerMm = Math.min(bounds.width / viewBox.width, bounds.height / viewBox.height);
  const renderedWidth = viewBox.width * pixelsPerMm;
  const renderedHeight = viewBox.height * pixelsPerMm;
  const offsetX = (bounds.width - renderedWidth) / 2;
  const offsetY = (bounds.height - renderedHeight) / 2;
  const localX = point.clientX - bounds.left - offsetX;
  const localY = point.clientY - bounds.top - offsetY;
  const xMm = viewBox.minX + localX / pixelsPerMm;
  const yMm = viewBox.minY + localY / pixelsPerMm;
  return {
    xMm: roundMillimeters(xMm),
    yMm: roundMillimeters(yMm),
    insideViewBox: localX >= 0 && localX <= renderedWidth && localY >= 0 && localY <= renderedHeight,
  };
}

export function modelRectToClient(
  rect: GeometryRectMm,
  bounds: { left: number; top: number; width: number; height: number },
  viewBox: Pick<SvgViewBoxMm, "minX" | "minY" | "width" | "height">,
) {
  const pixelsPerMm = Math.min(bounds.width / viewBox.width, bounds.height / viewBox.height);
  const offsetX = (bounds.width - viewBox.width * pixelsPerMm) / 2;
  const offsetY = (bounds.height - viewBox.height * pixelsPerMm) / 2;
  return {
    left: bounds.left + offsetX + (rect.xMm - viewBox.minX) * pixelsPerMm,
    top: bounds.top + offsetY + (rect.yMm - viewBox.minY) * pixelsPerMm,
    width: rect.widthMm * pixelsPerMm,
    height: rect.heightMm * pixelsPerMm,
    pixelsPerMm,
  };
}

/** Transitional projection for existing absolutely-positioned markup. */
export function geometryToRoomPercent(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm">,
  geometry: GeometryRectMm,
) {
  return {
    left: (geometry.xMm / draft.roomWidthMm) * 100,
    top: (geometry.yMm / draft.roomHeightMm) * 100,
    width: (geometry.widthMm / draft.roomWidthMm) * 100,
    height: (geometry.heightMm / draft.roomHeightMm) * 100,
  };
}

function normalizeMmItem(
  value: unknown,
  index: number,
  draft: SiteLayoutDraftMm,
  defaultBeamToWall: boolean,
): SiteLayoutItemMm | null {
  if (!isRecord(value) || !isItemKind(value.kind)) return null;
  const presetId = typeof value.presetId === "string" ? value.presetId.slice(0, 80) : undefined;
  const widthMm = normalizedMm(value.widthMm, presetId === "aircon-ceiling" ? 840 : 900, 1, MAX_ITEM_DIMENSION_MM);
  const rawHeightMm = normalizedMm(value.heightMm, presetId === "aircon-ceiling" ? 840 : 180, 1, MAX_ITEM_DIMENSION_MM);
  const heightMm = presetId === "aircon-ceiling" ? widthMm : rawHeightMm;
  const rotation: SiteLayoutRotation = value.rotation === 90 ? 90 : 0;
  const legacyWall = isWallSide(value.wall) ? value.wall : undefined;
  const structureAttachment = normalizeStructureAttachment(value.structureAttachment, value.kind, legacyWall, defaultBeamToWall);
  const structureMeasurement = normalizeStructureMeasurement(value.structureMeasurement, structureAttachment, false);
  const openingMeasurement = value.kind === "window" ? normalizeOpeningMeasurement(value.openingMeasurement, false) : undefined;
  const wall = structureAttachment?.mode === "wall" ? structureAttachment.wall : isStructureItem({ kind: value.kind }) ? undefined : legacyWall;
  const item: SiteLayoutItemMm = {
    id: sanitizeText(value.id, `item-${index + 1}`, 120) || `item-${index + 1}`,
    kind: value.kind,
    presetId,
    name: sanitizeText(value.name, `객체 ${index + 1}`, 80),
    xMm: roundMillimeters(finiteNumber(value.xMm) ?? 0),
    yMm: roundMillimeters(finiteNumber(value.yMm) ?? 0),
    widthMm,
    heightMm,
    rotation,
    wall,
    offsetMm: finiteNumber(value.offsetMm) === null ? undefined : roundMillimeters(finiteNumber(value.offsetMm) ?? 0),
    offsetAnchor: value.offsetAnchor === "center" ? "center" : value.offsetAnchor === "start" ? "start" : undefined,
    wallAlignment: value.wallAlignment === "centerline" ? "centerline" : value.wallAlignment === "inside" ? "inside" : undefined,
    openingHeightMm: finiteNumber(value.openingHeightMm) === null ? undefined : normalizedMm(value.openingHeightMm, 2100, 1, 20_000),
    sillHeightMm: finiteNumber(value.sillHeightMm) === null ? undefined : normalizedMm(value.sillHeightMm, 900, 0, 20_000),
    handing: value.handing === "right" ? "right" : value.handing === "left" ? "left" : undefined,
    swing: value.swing === "outside" ? "outside" : value.swing === "inside" ? "inside" : undefined,
    mountingHeightMm: finiteNumber(value.mountingHeightMm) === null ? undefined : normalizedMm(value.mountingHeightMm, 2100, 0, 20_000),
    beamBottomHeightMm: finiteNumber(value.beamBottomHeightMm) === null ? undefined : normalizedMm(value.beamBottomHeightMm, 2200, 0, 20_000),
    beamSpacingMm: finiteNumber(value.beamSpacingMm) === null ? undefined : normalizedMm(value.beamSpacingMm, 1000, 0, 100_000),
    structureAttachment,
    structureMeasurement,
    wallInsetMm: value.kind === "pillar"
      ? normalizedMm(value.wallInsetMm, 0, 0, MAX_ROOM_DIMENSION_MM)
      : undefined,
    freeReferenceX: value.kind === "pillar" ? (value.freeReferenceX === "right" ? "right" : "left") : undefined,
    freeReferenceY: value.kind === "pillar" ? (value.freeReferenceY === "bottom" ? "bottom" : "top") : undefined,
    openingMeasurement,
  };

  if (item.wall) return placeItemOnWall(draft, item, item.wall, item.offsetMm ?? 0);
  const footprint = rotatedFootprintMm(item);
  return {
    ...item,
    xMm: clamp(item.xMm, 0, Math.max(0, draft.roomWidthMm - footprint.widthMm)),
    yMm: clamp(item.yMm, 0, Math.max(0, draft.roomHeightMm - footprint.heightMm)),
  };
}

function normalizeMmDraft(value: Record<string, unknown>, sourceVersion: 2 | 3): SiteLayoutDraftMm {
  const fallback = createDefaultDraft();
  const draft: SiteLayoutDraftMm = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    roomName: sanitizeText(value.roomName, fallback.roomName, 80) || fallback.roomName,
    roomWidthMm: normalizedMm(value.roomWidthMm, fallback.roomWidthMm, 100, MAX_ROOM_DIMENSION_MM),
    roomHeightMm: normalizedMm(value.roomHeightMm, fallback.roomHeightMm, 100, MAX_ROOM_DIMENSION_MM),
    roomCeilingHeightMm: normalizedMm(value.roomCeilingHeightMm, fallback.roomCeilingHeightMm, 300, 20_000),
    roomWallThicknessMm: DEFAULT_WALL_THICKNESS_MM,
    items: [],
    stageChecks: sanitizeStringRecord(value.stageChecks),
    siteChecklist: sanitizeStringRecord(value.siteChecklist),
    fieldNotes: sanitizeText(value.fieldNotes, "", 1000),
    activeGuideStep: isGuideStep(value.activeGuideStep) ? value.activeGuideStep : "room",
    savedAt: typeof value.savedAt === "string" ? value.savedAt.slice(0, 40) : undefined,
  };
  draft.items = Array.isArray(value.items)
    ? value.items
      .map((item, index) => normalizeMmItem(item, index, draft, sourceVersion === 3))
      .filter((item): item is SiteLayoutItemMm => item !== null)
    : [];
  draft.items = resolveStructurePlacements(draft).items;
  return draft;
}

function legacyPercent(value: unknown) {
  return clamp(finiteNumber(value) ?? 0, 0, 100);
}

function legacyWallOffsetMm(
  value: Record<string, unknown>,
  draft: SiteLayoutDraftMm,
  wall: SiteLayoutWallSide,
  anchor: WallOffsetAnchor,
  widthMm: number,
) {
  const storedOffsetMeters = finiteNumber(value.offset);
  if (storedOffsetMeters !== null) return metersToMillimeters(storedOffsetMeters);
  const percent = wall === "top" || wall === "bottom" ? legacyPercent(value.x) : legacyPercent(value.y);
  const startMm = roundMillimeters((percent / 100) * wallLengthMm(draft, wall));
  return anchor === "center" ? startMm + widthMm / 2 : startMm;
}

function migrateLegacyItem(value: unknown, index: number, draft: SiteLayoutDraftMm): SiteLayoutItemMm | null {
  if (!isRecord(value) || !isItemKind(value.kind)) return null;
  const presetId = typeof value.presetId === "string" ? value.presetId.slice(0, 80) : undefined;
  const widthMm = legacyMetersToMm(value.width, presetId === "aircon-ceiling" ? 840 : 900, 1);
  const legacyHeightMm = legacyMetersToMm(value.height, presetId === "aircon-ceiling" ? 840 : 180, 1);
  const heightMm = presetId === "aircon-ceiling" ? widthMm : legacyHeightMm;
  const rotation: SiteLayoutRotation = value.rotation === 90 ? 90 : 0;
  const legacyWall = isWallSide(value.wall) ? value.wall : undefined;
  const structureAttachment = normalizeStructureAttachment(value.structureAttachment, value.kind, legacyWall, false);
  const structureMeasurement = normalizeStructureMeasurement(value.structureMeasurement, structureAttachment, true);
  const openingMeasurement = value.kind === "window" ? normalizeOpeningMeasurement(value.openingMeasurement, true) : undefined;
  const structureWall = structureAttachment?.mode === "wall" ? structureAttachment.wall : undefined;
  const wall = structureWall ?? legacyWall;
  const wallBound = Boolean(wall) && (
    value.kind === "door"
    || value.kind === "window"
    || structureAttachment?.mode === "wall"
    || presetId === "aircon-wall"
  );
  const anchor = presetId === "aircon-wall" ? "center" : "start";
  const item: SiteLayoutItemMm = {
    id: sanitizeText(value.id, `migrated-${index + 1}`, 120) || `migrated-${index + 1}`,
    kind: value.kind,
    presetId,
    name: sanitizeText(value.name, `객체 ${index + 1}`, 80),
    xMm: roundMillimeters((legacyPercent(value.x) / 100) * draft.roomWidthMm),
    yMm: roundMillimeters((legacyPercent(value.y) / 100) * draft.roomHeightMm),
    widthMm,
    heightMm,
    rotation,
    wall: wallBound ? wall : undefined,
    offsetMm: undefined,
    offsetAnchor: wallBound ? anchor : undefined,
    wallAlignment: wallBound ? (value.kind === "door" || value.kind === "window" ? "centerline" : "inside") : undefined,
    openingHeightMm: finiteNumber(value.openingHeight) === null ? undefined : legacyMetersToMm(value.openingHeight, value.kind === "door" ? 2100 : 1500, 1, 20_000),
    sillHeightMm: finiteNumber(value.sillHeight) === null ? undefined : legacyMetersToMm(value.sillHeight, 900, 0, 20_000),
    handing: value.handing === "right" ? "right" : value.handing === "left" ? "left" : undefined,
    swing: value.swing === "outside" ? "outside" : value.swing === "inside" ? "inside" : undefined,
    mountingHeightMm: finiteNumber(value.mountingHeight) === null ? undefined : legacyMetersToMm(value.mountingHeight, 2100, 0, 20_000),
    beamBottomHeightMm: finiteNumber(value.beamBottomHeight) === null ? undefined : legacyMetersToMm(value.beamBottomHeight, 2200, 0, 20_000),
    beamSpacingMm: finiteNumber(value.beamSpacing) === null ? undefined : legacyMetersToMm(value.beamSpacing, 1000, 0, 100_000),
    structureAttachment,
    structureMeasurement,
    wallInsetMm: value.kind === "pillar"
      ? finiteNumber(value.wallInsetMm) === null
        ? legacyMetersToMm(value.wallInset, 0, 0, MAX_ROOM_DIMENSION_MM)
        : normalizedMm(value.wallInsetMm, 0, 0, MAX_ROOM_DIMENSION_MM)
      : undefined,
    freeReferenceX: value.kind === "pillar" ? (value.freeReferenceX === "right" ? "right" : "left") : undefined,
    freeReferenceY: value.kind === "pillar" ? (value.freeReferenceY === "bottom" ? "bottom" : "top") : undefined,
    openingMeasurement,
  };
  if (wallBound && wall) {
    item.offsetMm = legacyWallOffsetMm(value, draft, wall, anchor, widthMm);
    return placeItemOnWall(draft, item, wall, item.offsetMm, { anchor, alignment: item.wallAlignment });
  }
  const footprint = rotatedFootprintMm(item);
  return {
    ...item,
    xMm: clamp(item.xMm, 0, Math.max(0, draft.roomWidthMm - footprint.widthMm)),
    yMm: clamp(item.yMm, 0, Math.max(0, draft.roomHeightMm - footprint.heightMm)),
  };
}

export function migrateLegacyDraft(value: unknown): SiteLayoutDraftMm | null {
  if (!isRecord(value)) return null;
  const roomWidth = finiteNumber(value.roomWidth);
  const roomHeight = finiteNumber(value.roomHeight);
  if (roomWidth === null || roomHeight === null || !Array.isArray(value.items)) return null;
  const fallback = createDefaultDraft();
  const draft: SiteLayoutDraftMm = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    roomName: sanitizeText(value.roomName, fallback.roomName, 80) || fallback.roomName,
    roomWidthMm: legacyMetersToMm(roomWidth, fallback.roomWidthMm, 100, MAX_ROOM_DIMENSION_MM),
    roomHeightMm: legacyMetersToMm(roomHeight, fallback.roomHeightMm, 100, MAX_ROOM_DIMENSION_MM),
    roomCeilingHeightMm: legacyMetersToMm(value.roomCeilingHeight, fallback.roomCeilingHeightMm, 300, 20_000),
    roomWallThicknessMm: DEFAULT_WALL_THICKNESS_MM,
    items: [],
    stageChecks: sanitizeStringRecord(value.stageChecks),
    siteChecklist: sanitizeStringRecord(value.siteChecklist),
    fieldNotes: sanitizeText(value.fieldNotes, "", 1000),
    activeGuideStep: "room",
    savedAt: undefined,
  };
  draft.items = value.items
    .map((item, index) => migrateLegacyItem(item, index, draft))
    .filter((item): item is SiteLayoutItemMm => item !== null);
  draft.items = resolveStructurePlacements(draft).items;
  return draft;
}

function structureAxis(item: SiteLayoutItemMm): StructureMeasurementAxis {
  if (item.structureAttachment?.mode === "wall") return wallSpanAxis(item.structureAttachment.wall);
  return item.rotation === 90 ? "y" : "x";
}

function structurePlacementBaseline(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm" | "roomWallThicknessMm">,
  item: SiteLayoutItemMm,
) {
  if (item.structureAttachment?.mode === "wall") {
    return placeItemOnWall(draft, item, item.structureAttachment.wall, item.offsetMm ?? 0, {
      anchor: item.offsetAnchor ?? "start",
      alignment: "inside",
    });
  }
  if (item.structureAttachment?.mode === "free") return { ...item, wall: undefined };
  return item.wall ? placeItemOnWall(draft, item, item.wall, item.offsetMm ?? 0) : item;
}

function itemAxisSpanMm(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm" | "roomWallThicknessMm">,
  item: SiteLayoutItemMm,
  axis: StructureMeasurementAxis,
) {
  const geometry = computeItemGeometryMm(draft, item);
  return axis === "x" ? geometry.widthMm : geometry.heightMm;
}

function itemAxisCenterMm(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm" | "roomWallThicknessMm">,
  item: SiteLayoutItemMm,
  axis: StructureMeasurementAxis,
) {
  const geometry = computeItemGeometryMm(draft, item);
  return axis === "x" ? geometry.centerXmm : geometry.centerYmm;
}

function placeStructureCenterMm(
  draft: Pick<SiteLayoutDraftMm, "roomWidthMm" | "roomHeightMm" | "roomWallThicknessMm">,
  item: SiteLayoutItemMm,
  axis: StructureMeasurementAxis,
  centerMm: number,
  crossAxisCenterMm?: number,
) {
  if (item.structureAttachment?.mode === "wall") {
    return placeItemOnWall(draft, item, item.structureAttachment.wall, centerMm, { anchor: "center", alignment: "inside" });
  }
  const footprint = rotatedFootprintMm(item);
  const next = { ...item, wall: undefined };
  if (axis === "x") {
    next.xMm = roundMillimeters(centerMm - footprint.widthMm / 2);
    if (crossAxisCenterMm !== undefined) next.yMm = roundMillimeters(crossAxisCenterMm - footprint.heightMm / 2);
  } else {
    next.yMm = roundMillimeters(centerMm - footprint.heightMm / 2);
    if (crossAxisCenterMm !== undefined) next.xMm = roundMillimeters(crossAxisCenterMm - footprint.widthMm / 2);
  }
  return next;
}

/**
 * Resolves wall/previous-item measurement data into physical x/y coordinates.
 * This function is deterministic and side-effect free; the input draft is never mutated.
 */
export function resolveStructurePlacements(draft: SiteLayoutDraftMm): StructurePlacementResult {
  const itemById = new Map(draft.items.map((item) => [item.id, item]));
  const resolved = new Map<string, SiteLayoutItemMm>();
  const states = new Map<string, "visiting" | "done">();
  const invalidIds = new Set<string>();
  const issues: DraftValidationIssue[] = [];
  const issueKeys = new Set<string>();
  const stack: string[] = [];

  function addIssue(issue: DraftValidationIssue) {
    const key = `${issue.code}:${issue.itemId ?? ""}:${issue.path ?? ""}`;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    issues.push(issue);
  }

  function markCycle(itemId: string) {
    const cycleStart = Math.max(0, stack.indexOf(itemId));
    const cycleIds = stack.slice(cycleStart);
    if (!cycleIds.includes(itemId)) cycleIds.push(itemId);
    for (const cycleId of cycleIds) {
      invalidIds.add(cycleId);
      addIssue({
        code: "structure-reference-cycle",
        severity: "error",
        message: `${itemById.get(cycleId)?.name ?? "구조물"}의 보 참조가 순환합니다. 기준 보를 다시 선택해 주세요.`,
        itemId: cycleId,
      });
    }
  }

  function resolveItem(item: SiteLayoutItemMm): SiteLayoutItemMm {
    const alreadyResolved = resolved.get(item.id);
    if (alreadyResolved) return alreadyResolved;
    if (states.get(item.id) === "visiting") {
      markCycle(item.id);
      return structurePlacementBaseline(draft, item);
    }

    states.set(item.id, "visiting");
    stack.push(item.id);
    let placed = structurePlacementBaseline(draft, item);
    const measurement = item.structureMeasurement;

    if (isStructureItem(item) && measurement) {
      const attachmentAxis = structureAxis(placed);
      if (item.kind === "beam" && measurement.axis !== attachmentAxis) {
        invalidIds.add(item.id);
        addIssue({
          code: "structure-reference-axis",
          severity: "error",
          message: `${item.name}의 측정 방향이 보 진행축과 다릅니다.`,
          itemId: item.id,
        });
      } else if (measurement.referenceType === "wall") {
        const referenceWall = measurement.referenceWall;
        if (!referenceWall) {
          invalidIds.add(item.id);
          addIssue({
            code: "structure-reference-missing",
            severity: "error",
            message: `${item.name}의 기준 벽을 선택해 주세요.`,
            itemId: item.id,
          });
        } else if (measurementAxisForWall(referenceWall) !== measurement.axis) {
          invalidIds.add(item.id);
          addIssue({
            code: "structure-reference-axis",
            severity: "error",
            message: `${item.name}의 기준 벽과 측정축이 서로 맞지 않습니다.`,
            itemId: item.id,
          });
        } else {
          const expectedDirection = referenceWall === "right" || referenceWall === "bottom" ? -1 : 1;
          if (measurement.direction !== expectedDirection) {
            invalidIds.add(item.id);
            addIssue({
              code: "structure-reference-direction",
              severity: "error",
              message: `${item.name}의 측정 방향이 실 안쪽을 향하도록 확인해 주세요.`,
              itemId: item.id,
            });
          } else {
            const roomSpanMm = measurement.axis === "x" ? draft.roomWidthMm : draft.roomHeightMm;
            const targetSpanMm = itemAxisSpanMm(draft, placed, measurement.axis);
            const datumMm = expectedDirection === 1 ? 0 : roomSpanMm;
            const centerMm = datumMm + expectedDirection * (
              measurement.distanceMm + (measurement.distanceMode === "clear" ? targetSpanMm / 2 : 0)
            );
            if (centerMm - targetSpanMm / 2 < 0 || centerMm + targetSpanMm / 2 > roomSpanMm) {
              invalidIds.add(item.id);
              addIssue({
                code: "structure-distance-outside-room",
                severity: "error",
                message: `${item.name}의 기준거리가 공간 범위를 벗어납니다.`,
                itemId: item.id,
              });
            } else {
              placed = placeStructureCenterMm(draft, placed, measurement.axis, centerMm);
            }
          }
        }
      } else {
        const referenceId = measurement.referenceItemId;
        const reference = referenceId ? itemById.get(referenceId) : undefined;
        if (!reference) {
          invalidIds.add(item.id);
          addIssue({
            code: "structure-reference-missing",
            severity: "error",
            message: `${item.name}의 이전 기준 객체를 찾을 수 없습니다. 기준 기둥·보를 다시 선택해 주세요.`,
            itemId: item.id,
          });
        } else if (reference.kind !== item.kind || !isStructureItem(reference)) {
          invalidIds.add(item.id);
          addIssue({
            code: "structure-reference-kind",
            severity: "error",
            message: `${item.name}의 기준은 같은 종류의 기둥·보여야 합니다.`,
            itemId: item.id,
          });
        } else {
          const resolvedReference = resolveItem(reference);
          if (invalidIds.has(reference.id)) {
            invalidIds.add(item.id);
          } else {
            const referenceAxis = structureAxis(resolvedReference);
            if (referenceAxis !== measurement.axis) {
              invalidIds.add(item.id);
              addIssue({
                code: "structure-reference-axis",
                severity: "error",
                message: `${item.name}과 기준 기둥·보의 진행축이 서로 다릅니다.`,
                itemId: item.id,
              });
            } else if (
              (placed.structureAttachment?.mode === "wall" || resolvedReference.structureAttachment?.mode === "wall")
              && (
                placed.structureAttachment?.mode !== "wall"
                || resolvedReference.structureAttachment?.mode !== "wall"
                || placed.structureAttachment.wall !== resolvedReference.structureAttachment.wall
              )
            ) {
              invalidIds.add(item.id);
              addIssue({
                code: "structure-reference-wall",
                severity: "error",
                message: `${item.name}과 기준 기둥·보가 같은 벽에 설치되어 있는지 확인해 주세요.`,
                itemId: item.id,
              });
            } else {
              const targetSpanMm = itemAxisSpanMm(draft, placed, measurement.axis);
              const referenceSpanMm = itemAxisSpanMm(draft, resolvedReference, measurement.axis);
              const referenceCenterMm = itemAxisCenterMm(draft, resolvedReference, measurement.axis);
              const targetCenterMm = referenceCenterMm + measurement.direction * (
                measurement.distanceMm
                + (measurement.distanceMode === "clear" ? (referenceSpanMm + targetSpanMm) / 2 : 0)
              );
              const roomSpanMm = measurement.axis === "x" ? draft.roomWidthMm : draft.roomHeightMm;
              if (targetCenterMm - targetSpanMm / 2 < 0 || targetCenterMm + targetSpanMm / 2 > roomSpanMm) {
                invalidIds.add(item.id);
                addIssue({
                  code: "structure-distance-outside-room",
                  severity: "error",
                  message: `${item.name}의 기둥·보 사이 거리가 공간 범위를 벗어납니다.`,
                  itemId: item.id,
                });
              } else {
                const referenceGeometry = computeItemGeometryMm(draft, resolvedReference);
                const crossAxisCenterMm = measurement.axis === "x" ? referenceGeometry.centerYmm : referenceGeometry.centerXmm;
                placed = placeStructureCenterMm(draft, placed, measurement.axis, targetCenterMm, crossAxisCenterMm);
              }
            }
          }
        }
      }
    }

    stack.pop();
    states.set(item.id, "done");
    resolved.set(item.id, placed);
    return placed;
  }

  return {
    items: draft.items.map((item) => resolveItem(item)),
    issues,
  };
}

export function validateDraft(draft: SiteLayoutDraftMm): DraftValidationIssue[] {
  const placement = resolveStructurePlacements(draft);
  const issues: DraftValidationIssue[] = [...placement.issues];
  const geometryDraft = { ...draft, items: placement.items };
  if (!(draft.roomWidthMm > 0) || !(draft.roomHeightMm > 0)) {
    issues.push({ code: "room-dimension", severity: "error", message: "공간 가로·세로 치수는 0보다 커야 합니다.", path: "room" });
  }
  if (!(draft.roomWallThicknessMm > 0) || draft.roomWallThicknessMm * 2 >= Math.min(draft.roomWidthMm, draft.roomHeightMm)) {
    issues.push({ code: "wall-thickness", severity: "error", message: "벽 두께가 공간 치수에 비해 너무 큽니다.", path: "roomWallThicknessMm" });
  }
  if (!(draft.roomCeilingHeightMm > 0)) {
    issues.push({ code: "ceiling-height", severity: "error", message: "천장 높이를 확인해 주세요.", path: "roomCeilingHeightMm" });
  }

  for (const item of placement.items) {
    if (!(item.widthMm > 0) || !(item.heightMm > 0)) {
      issues.push({ code: "item-dimension", severity: "error", message: `${item.name}의 치수를 확인해 주세요.`, itemId: item.id });
      continue;
    }
    if (item.presetId === "aircon-ceiling" && item.widthMm !== item.heightMm) {
      issues.push({ code: "ceiling-aircon-square", severity: "error", message: `${item.name}은 정사각형 규격이어야 합니다.`, itemId: item.id });
    }
    const geometry = computeItemGeometryMm(geometryDraft, item);
    if (item.wall) {
      const start = geometry.spanStartMm ?? 0;
      const end = geometry.spanEndMm ?? start;
      const length = wallLengthMm(geometryDraft, item.wall);
      if (start < 0 || end > length) {
        issues.push({ code: "wall-offset", severity: "error", message: `${item.name}이 벽 길이를 벗어났습니다.`, itemId: item.id });
      }
    } else if (
      geometry.xMm < 0
      || geometry.yMm < 0
      || geometry.xMm + geometry.widthMm > draft.roomWidthMm
      || geometry.yMm + geometry.heightMm > draft.roomHeightMm
    ) {
      issues.push({ code: "item-outside-room", severity: "warning", message: `${item.name}이 공간 경계를 벗어났습니다.`, itemId: item.id });
    }
    if (isOpening(item)) {
      const openingHeightMm = item.openingHeightMm ?? 0;
      const sillHeightMm = item.kind === "window" ? item.sillHeightMm ?? 0 : 0;
      if (openingHeightMm <= 0 || openingHeightMm + sillHeightMm > draft.roomCeilingHeightMm) {
        issues.push({ code: "opening-height", severity: "error", message: `${item.name}의 높이와 천장 높이를 확인해 주세요.`, itemId: item.id });
      }
    }
  }

  const wallOpenings = placement.items.filter((item) => item.wall && isOpening(item));
  for (let outerIndex = 0; outerIndex < wallOpenings.length; outerIndex += 1) {
    const outer = wallOpenings[outerIndex];
    const outerGeometry = computeItemGeometryMm(geometryDraft, outer);
    for (let innerIndex = outerIndex + 1; innerIndex < wallOpenings.length; innerIndex += 1) {
      const inner = wallOpenings[innerIndex];
      if (outer.wall !== inner.wall) continue;
      const innerGeometry = computeItemGeometryMm(geometryDraft, inner);
      if ((outerGeometry.spanStartMm ?? 0) < (innerGeometry.spanEndMm ?? 0)
        && (innerGeometry.spanStartMm ?? 0) < (outerGeometry.spanEndMm ?? 0)) {
        issues.push({
          code: "opening-overlap",
          severity: "warning",
          message: `${outer.name}과 ${inner.name}이 같은 벽에서 겹칩니다.`,
          itemId: inner.id,
        });
      }
    }
  }
  return issues;
}

export function normalizeDraftWithIssues(value: unknown): NormalizedDraftResult {
  if (isRecord(value) && (value.schemaVersion === DRAFT_SCHEMA_VERSION || "roomWidthMm" in value)) {
    const sourceVersion = value.schemaVersion === DRAFT_SCHEMA_VERSION ? 3 : 2;
    const draft = normalizeMmDraft(value, sourceVersion);
    return { draft, source: sourceVersion === 3 ? "v3" : "v2", issues: validateDraft(draft) };
  }
  const migrated = migrateLegacyDraft(value);
  if (migrated) return { draft: migrated, source: "legacy-v1", issues: validateDraft(migrated) };
  const draft = createDefaultDraft();
  return { draft, source: "default", issues: validateDraft(draft) };
}

export function normalizeDraft(value: unknown) {
  return normalizeDraftWithIssues(value).draft;
}

export function serializeDraft(value: unknown) {
  const draft = normalizeDraft(value);
  return JSON.stringify(draft);
}

export function deserializeDraft(raw: string | null | undefined): NormalizedDraftResult {
  if (!raw) return normalizeDraftWithIssues(null);
  try {
    return normalizeDraftWithIssues(JSON.parse(raw) as unknown);
  } catch {
    return normalizeDraftWithIssues(null);
  }
}

export function advanceSurveyStep(current: SiteLayoutGuideStep, direction: 1 | -1 = 1) {
  const currentIndex = Math.max(0, GUIDE_STEPS.indexOf(current));
  return GUIDE_STEPS[clamp(currentIndex + direction, 0, GUIDE_STEPS.length - 1)];
}

export function nextGuideState(draft: SiteLayoutDraftMm, current: SiteLayoutGuideStep = draft.activeGuideStep) {
  const index = Math.max(0, GUIDE_STEPS.indexOf(current));
  return {
    stepId: current,
    index,
    total: GUIDE_STEPS.length,
    previousStepId: index > 0 ? GUIDE_STEPS[index - 1] : null,
    nextStepId: index < GUIDE_STEPS.length - 1 ? GUIDE_STEPS[index + 1] : null,
    complete: current === "review" && validateDraft(draft).every((issue) => issue.severity !== "error"),
  };
}
