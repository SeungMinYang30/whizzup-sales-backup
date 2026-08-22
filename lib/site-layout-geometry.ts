/**
 * Physical geometry and local persistence primitives for the basic floor-plan tool.
 *
 * The model deliberately stores every physical value as an integer millimetre.
 * Browser pixels, percentages and responsive breakpoints are projections only and
 * must never be written back into a draft.
 */

export const DRAFT_SCHEMA_VERSION = 2 as const;
export const STORAGE_KEY = "whizzup:site-layout-draft:v2";
export const LEGACY_STORAGE_KEY = "whizzup:site-layout-draft:v1";

export const GUIDE_STEPS = [
  "room",
  "door",
  "window",
  "structure",
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
    | "ceiling-aircon-square";
  severity: "warning" | "error";
  message: string;
  itemId?: string;
  path?: string;
};

export type NormalizedDraftResult = {
  draft: SiteLayoutDraftMm;
  source: "v2" | "legacy-v1" | "default";
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
  item: Pick<SiteLayoutItemMm, "kind" | "presetId" | "widthMm" | "heightMm" | "wall" | "offsetMm" | "offsetAnchor" | "wallAlignment">,
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

  if (wall === "top") {
    const yMm = crossAxisCenter ? -(thicknessMm + footprint.heightMm) / 2 : 0;
    return { xMm: startMm, yMm, rotation, offsetMm, startMm };
  }
  if (wall === "bottom") {
    const yMm = crossAxisCenter
      ? draft.roomHeightMm + (thicknessMm - footprint.heightMm) / 2
      : draft.roomHeightMm - footprint.heightMm;
    return { xMm: startMm, yMm, rotation, offsetMm, startMm };
  }
  if (wall === "left") {
    const xMm = crossAxisCenter ? -(thicknessMm + footprint.widthMm) / 2 : 0;
    return { xMm, yMm: startMm, rotation, offsetMm, startMm };
  }
  const xMm = crossAxisCenter
    ? draft.roomWidthMm + (thicknessMm - footprint.widthMm) / 2
    : draft.roomWidthMm - footprint.widthMm;
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
  options: { paddingMm?: number } = {},
): SvgViewBoxMm {
  const automaticPadding = Math.max(300, Math.round(Math.min(draft.roomWidthMm, draft.roomHeightMm) * 0.04));
  const outsideDoorPadding = (draft.items ?? []).reduce((largest, item) => {
    if (item.kind !== "door" || item.swing !== "outside") return largest;
    return Math.max(largest, item.widthMm + draft.roomWallThicknessMm + 180);
  }, 0);
  const paddingMm = normalizedMm(Math.max(options.paddingMm ?? automaticPadding, outsideDoorPadding), automaticPadding, 0, 20_000);
  const minX = -draft.roomWallThicknessMm - paddingMm;
  const minY = -draft.roomWallThicknessMm - paddingMm;
  const width = draft.roomWidthMm + draft.roomWallThicknessMm * 2 + paddingMm * 2;
  const height = draft.roomHeightMm + draft.roomWallThicknessMm * 2 + paddingMm * 2;
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

function normalizeV2Item(value: unknown, index: number, draft: SiteLayoutDraftMm): SiteLayoutItemMm | null {
  if (!isRecord(value) || !isItemKind(value.kind)) return null;
  const presetId = typeof value.presetId === "string" ? value.presetId.slice(0, 80) : undefined;
  const widthMm = normalizedMm(value.widthMm, presetId === "aircon-ceiling" ? 840 : 900, 1, MAX_ITEM_DIMENSION_MM);
  const rawHeightMm = normalizedMm(value.heightMm, presetId === "aircon-ceiling" ? 840 : 180, 1, MAX_ITEM_DIMENSION_MM);
  const heightMm = presetId === "aircon-ceiling" ? widthMm : rawHeightMm;
  const rotation: SiteLayoutRotation = value.rotation === 90 ? 90 : 0;
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
    wall: isWallSide(value.wall) ? value.wall : undefined,
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
  };

  if (item.wall) return placeItemOnWall(draft, item, item.wall, item.offsetMm ?? 0);
  const footprint = rotatedFootprintMm(item);
  return {
    ...item,
    xMm: clamp(item.xMm, 0, Math.max(0, draft.roomWidthMm - footprint.widthMm)),
    yMm: clamp(item.yMm, 0, Math.max(0, draft.roomHeightMm - footprint.heightMm)),
  };
}

function normalizeV2Draft(value: Record<string, unknown>): SiteLayoutDraftMm {
  const fallback = createDefaultDraft();
  const draft: SiteLayoutDraftMm = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    roomName: sanitizeText(value.roomName, fallback.roomName, 80) || fallback.roomName,
    roomWidthMm: normalizedMm(value.roomWidthMm, fallback.roomWidthMm, 100, MAX_ROOM_DIMENSION_MM),
    roomHeightMm: normalizedMm(value.roomHeightMm, fallback.roomHeightMm, 100, MAX_ROOM_DIMENSION_MM),
    roomCeilingHeightMm: normalizedMm(value.roomCeilingHeightMm, fallback.roomCeilingHeightMm, 300, 20_000),
    roomWallThicknessMm: normalizedMm(value.roomWallThicknessMm, fallback.roomWallThicknessMm, 10, 2_000),
    items: [],
    stageChecks: sanitizeStringRecord(value.stageChecks),
    siteChecklist: sanitizeStringRecord(value.siteChecklist),
    fieldNotes: sanitizeText(value.fieldNotes, "", 1000),
    activeGuideStep: isGuideStep(value.activeGuideStep) ? value.activeGuideStep : "room",
    savedAt: typeof value.savedAt === "string" ? value.savedAt.slice(0, 40) : undefined,
  };
  draft.items = Array.isArray(value.items)
    ? value.items.map((item, index) => normalizeV2Item(item, index, draft)).filter((item): item is SiteLayoutItemMm => item !== null)
    : [];
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
  const wall = isWallSide(value.wall) ? value.wall : undefined;
  const wallBound = Boolean(wall) && (value.kind === "door" || value.kind === "window" || value.kind === "pillar" || presetId === "aircon-wall");
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
    roomWallThicknessMm: legacyMetersToMm(value.roomWallThickness, fallback.roomWallThicknessMm, 10, 2_000),
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
  return draft;
}

export function validateDraft(draft: SiteLayoutDraftMm): DraftValidationIssue[] {
  const issues: DraftValidationIssue[] = [];
  if (!(draft.roomWidthMm > 0) || !(draft.roomHeightMm > 0)) {
    issues.push({ code: "room-dimension", severity: "error", message: "공간 가로·세로 치수는 0보다 커야 합니다.", path: "room" });
  }
  if (!(draft.roomWallThicknessMm > 0) || draft.roomWallThicknessMm * 2 >= Math.min(draft.roomWidthMm, draft.roomHeightMm)) {
    issues.push({ code: "wall-thickness", severity: "error", message: "벽 두께가 공간 치수에 비해 너무 큽니다.", path: "roomWallThicknessMm" });
  }
  if (!(draft.roomCeilingHeightMm > 0)) {
    issues.push({ code: "ceiling-height", severity: "error", message: "천장 높이를 확인해 주세요.", path: "roomCeilingHeightMm" });
  }

  for (const item of draft.items) {
    if (!(item.widthMm > 0) || !(item.heightMm > 0)) {
      issues.push({ code: "item-dimension", severity: "error", message: `${item.name}의 치수를 확인해 주세요.`, itemId: item.id });
      continue;
    }
    if (item.presetId === "aircon-ceiling" && item.widthMm !== item.heightMm) {
      issues.push({ code: "ceiling-aircon-square", severity: "error", message: `${item.name}은 정사각형 규격이어야 합니다.`, itemId: item.id });
    }
    const geometry = computeItemGeometryMm(draft, item);
    if (item.wall) {
      const start = geometry.spanStartMm ?? 0;
      const end = geometry.spanEndMm ?? start;
      const length = wallLengthMm(draft, item.wall);
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

  const wallOpenings = draft.items.filter((item) => item.wall && isOpening(item));
  for (let outerIndex = 0; outerIndex < wallOpenings.length; outerIndex += 1) {
    const outer = wallOpenings[outerIndex];
    const outerGeometry = computeItemGeometryMm(draft, outer);
    for (let innerIndex = outerIndex + 1; innerIndex < wallOpenings.length; innerIndex += 1) {
      const inner = wallOpenings[innerIndex];
      if (outer.wall !== inner.wall) continue;
      const innerGeometry = computeItemGeometryMm(draft, inner);
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
    const draft = normalizeV2Draft(value);
    return { draft, source: "v2", issues: validateDraft(draft) };
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
