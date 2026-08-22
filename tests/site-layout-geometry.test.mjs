import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DRAFT_SCHEMA_VERSION,
  GUIDE_STEPS,
  LEGACY_STORAGE_KEY,
  PREVIOUS_STORAGE_KEY,
  STORAGE_KEY,
  advanceSurveyStep,
  buildSiteLayoutDimensionSegmentsMm,
  clampWallOffsetMm,
  computeItemGeometryMm,
  computeOpeningCutGeometryMm,
  computeSvgViewBox,
  computeWallGeometryMm,
  createDefaultDraft,
  deserializeDraft,
  geometryToRoomPercent,
  layoutSiteLayoutDimensionSegmentsMm,
  migrateLegacyDraft,
  modelPointFromClient,
  modelRectToClient,
  nextGuideState,
  normalizeDraft,
  normalizeDraftWithIssues,
  placeItemOnWall,
  resolveStructurePlacements,
  serializeDraft,
} from "../lib/site-layout-geometry.ts";

const geometryViewSource = readFileSync(new URL("../app/site-layout-geometry-view.tsx", import.meta.url), "utf8");

function geometryViewSection(startMarker, endMarker) {
  const start = geometryViewSource.indexOf(startMarker);
  const end = geometryViewSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing geometry view marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing geometry view marker: ${endMarker}`);
  return geometryViewSource.slice(start, end);
}

function makeItem(overrides = {}) {
  return {
    id: "item-1",
    kind: "door",
    presetId: "door-single",
    name: "단문형 출입문",
    xMm: 0,
    yMm: 0,
    widthMm: 900,
    heightMm: 180,
    rotation: 0,
    openingHeightMm: 2100,
    handing: "left",
    swing: "inside",
    ...overrides,
  };
}

function makeBeam(id, overrides = {}) {
  return makeItem({
    id,
    kind: "beam",
    presetId: "beam",
    name: `콘크리트 보 ${id}`,
    widthMm: 2_400,
    heightMm: 350,
    openingHeightMm: undefined,
    handing: undefined,
    swing: undefined,
    beamBottomHeightMm: 2_200,
    ...overrides,
  });
}

function makePillar(id, overrides = {}) {
  return makeItem({
    id,
    kind: "pillar",
    presetId: "pillar",
    name: `콘크리트 기둥 ${id}`,
    widthMm: 450,
    heightMm: 450,
    openingHeightMm: undefined,
    handing: undefined,
    swing: undefined,
    ...overrides,
  });
}

test("draft model stores physical dimensions as integer millimetres", () => {
  const draft = createDefaultDraft();

  assert.equal(draft.schemaVersion, DRAFT_SCHEMA_VERSION);
  assert.equal(draft.roomWidthMm, 13_724);
  assert.equal(draft.roomHeightMm, 8_146);
  assert.equal(draft.roomCeilingHeightMm, 2_551);
  assert.equal(draft.roomWallThicknessMm, 150);
  assert.equal(Number.isInteger(draft.roomWidthMm), true);
  assert.equal(STORAGE_KEY, "whizzup:site-layout-draft:v3");
  assert.equal(PREVIOUS_STORAGE_KEY, "whizzup:site-layout-draft:v2");
  assert.equal(LEGACY_STORAGE_KEY, "whizzup:site-layout-draft:v1");
});

test("wall thickness remains exactly 150 mm in every wall geometry", () => {
  const walls = computeWallGeometryMm(createDefaultDraft());

  assert.deepEqual(walls.top, { xMm: -150, yMm: -150, widthMm: 14_024, heightMm: 150 });
  assert.deepEqual(walls.right, { xMm: 13_724, yMm: -150, widthMm: 150, heightMm: 8_446 });
  assert.deepEqual(walls.bottom, { xMm: -150, yMm: 8_146, widthMm: 14_024, heightMm: 150 });
  assert.deepEqual(walls.left, { xMm: -150, yMm: -150, widthMm: 150, heightMm: 8_446 });
});

test("user and legacy wall-thickness values normalize to the fixed 150 mm drawing convention", () => {
  const normalized = normalizeDraft({ ...createDefaultDraft(), roomWallThicknessMm: 900 });
  const migrated = migrateLegacyDraft({ roomName: "기존 도면", roomWidth: 10, roomHeight: 7, roomWallThickness: 0.9, items: [] });

  assert.equal(normalized.roomWallThicknessMm, 150);
  assert.equal(migrated.roomWallThicknessMm, 150);
});

test("window-to-window measurement metadata survives normalization and storage", () => {
  const source = {
    ...createDefaultDraft(),
    items: [makeItem({
      id: "window-followup",
      kind: "window",
      presetId: "window-sliding-2",
      name: "두 번째 창호",
      widthMm: 1_800,
      heightMm: 140,
      openingHeightMm: 1_500,
      sillHeightMm: 900,
      openingMeasurement: { axis: "x", referenceType: "item", referenceItemId: "window-first", direction: 1, distanceMode: "clear", distanceMm: 650 },
    })],
  };

  const restored = deserializeDraft(serializeDraft(source));
  assert.equal(restored.draft.items[0].openingMeasurement.referenceType, "item");
  assert.equal(restored.draft.items[0].openingMeasurement.referenceItemId, "window-first");
  assert.equal(restored.draft.items[0].openingMeasurement.distanceMode, "clear");
  assert.equal(restored.draft.items[0].openingMeasurement.distanceMm, 650);
});

test("doors and windows keep their physical span when mounted on horizontal or vertical walls", () => {
  const draft = createDefaultDraft();
  const topDoor = placeItemOnWall(draft, makeItem(), "top", 2_000);
  const rightDoor = placeItemOnWall(draft, makeItem(), "right", 2_000);
  const topGeometry = computeItemGeometryMm(draft, topDoor);
  const rightGeometry = computeItemGeometryMm(draft, rightDoor);

  assert.deepEqual(
    {
      xMm: topGeometry.xMm,
      yMm: topGeometry.yMm,
      widthMm: topGeometry.widthMm,
      heightMm: topGeometry.heightMm,
      physicalWidthMm: topGeometry.physicalWidthMm,
      spanStartMm: topGeometry.spanStartMm,
      spanEndMm: topGeometry.spanEndMm,
    },
    { xMm: 2_000, yMm: -165, widthMm: 900, heightMm: 180, physicalWidthMm: 900, spanStartMm: 2_000, spanEndMm: 2_900 },
  );
  assert.deepEqual(
    {
      xMm: rightGeometry.xMm,
      yMm: rightGeometry.yMm,
      widthMm: rightGeometry.widthMm,
      heightMm: rightGeometry.heightMm,
      rotation: rightGeometry.rotation,
      physicalWidthMm: rightGeometry.physicalWidthMm,
      spanStartMm: rightGeometry.spanStartMm,
      spanEndMm: rightGeometry.spanEndMm,
    },
    { xMm: 13_709, yMm: 2_000, widthMm: 180, heightMm: 900, rotation: 90, physicalWidthMm: 900, spanStartMm: 2_000, spanEndMm: 2_900 },
  );
});

test("opening cuts use the physical opening width and wall thickness", () => {
  const draft = createDefaultDraft();
  const topDoor = placeItemOnWall(draft, makeItem(), "top", 1_200);
  const leftWindow = placeItemOnWall(
    draft,
    makeItem({ id: "window-1", kind: "window", presetId: "window-sliding-2", name: "미닫이창", widthMm: 1_800, heightMm: 140, openingHeightMm: 1_500, sillHeightMm: 900 }),
    "left",
    900,
  );

  assert.deepEqual(computeOpeningCutGeometryMm(draft, topDoor), { xMm: 1_200, yMm: -150, widthMm: 900, heightMm: 150 });
  assert.deepEqual(computeOpeningCutGeometryMm(draft, leftWindow), { xMm: -150, yMm: 900, widthMm: 150, heightMm: 1_800 });
});

test("panel width, full-screen mode, and mobile viewport change only pixels, not millimetres", () => {
  const draft = createDefaultDraft();
  const viewBox = computeSvgViewBox(draft, { paddingMm: 300 });
  const door = computeItemGeometryMm(draft, placeItemOnWall(draft, makeItem(), "bottom", 4_000));
  const wall = computeWallGeometryMm(draft).bottom;
  const boundsList = [
    { left: 0, top: 0, width: 606.5, height: 360 },
    { left: 0, top: 0, width: 1_420, height: 820 },
    { left: 0, top: 0, width: 312, height: 185.1875 },
  ];

  for (const bounds of boundsList) {
    const projectedDoor = modelRectToClient(door, bounds, viewBox);
    const projectedWall = modelRectToClient(wall, bounds, viewBox);

    assert.equal(Math.round(projectedDoor.width / projectedDoor.pixelsPerMm), 900);
    assert.equal(Math.round(projectedDoor.height / projectedDoor.pixelsPerMm), 180);
    assert.equal(Math.round(projectedWall.height / projectedWall.pixelsPerMm), 150);

    const doorCenter = modelPointFromClient(
      {
        clientX: projectedDoor.left + projectedDoor.width / 2,
        clientY: projectedDoor.top + projectedDoor.height / 2,
      },
      bounds,
      viewBox,
    );
    assert.equal(doorCenter.xMm, door.centerXmm);
    assert.equal(doorCenter.yMm, door.centerYmm);
    assert.equal(doorCenter.insideViewBox, true);
  }
});

test("outside-swing doors expand only their mounted wall side without shrinking the opposite axis", () => {
  const base = createDefaultDraft();
  const baseViewBox = computeSvgViewBox({ ...base, items: [] }, { paddingMm: 650 });
  const outsidePadding = 1_800 + base.roomWallThicknessMm + 180;
  const oppositeX = baseViewBox.minX + baseViewBox.width;
  const oppositeY = baseViewBox.minY + baseViewBox.height;

  for (const wall of ["top", "right", "bottom", "left"]) {
    const outsideDoor = placeItemOnWall(base, makeItem({ id: `outside-${wall}`, widthMm: 1_800, swing: "outside" }), wall, 1_000);
    const viewBox = computeSvgViewBox({ ...base, items: [outsideDoor] }, { paddingMm: 650 });

    if (wall === "top") {
      assert.equal(viewBox.minY, -base.roomWallThicknessMm - outsidePadding);
      assert.equal(viewBox.minY + viewBox.height, oppositeY);
      assert.equal(viewBox.minX, baseViewBox.minX);
      assert.equal(viewBox.width, baseViewBox.width);
    } else if (wall === "right") {
      assert.equal(viewBox.minX, baseViewBox.minX);
      assert.equal(viewBox.minX + viewBox.width, base.roomWidthMm + base.roomWallThicknessMm + outsidePadding);
      assert.equal(viewBox.minY, baseViewBox.minY);
      assert.equal(viewBox.height, baseViewBox.height);
    } else if (wall === "bottom") {
      assert.equal(viewBox.minY, baseViewBox.minY);
      assert.equal(viewBox.minY + viewBox.height, base.roomHeightMm + base.roomWallThicknessMm + outsidePadding);
      assert.equal(viewBox.minX, baseViewBox.minX);
      assert.equal(viewBox.width, baseViewBox.width);
    } else {
      assert.equal(viewBox.minX, -base.roomWallThicknessMm - outsidePadding);
      assert.equal(viewBox.minX + viewBox.width, oppositeX);
      assert.equal(viewBox.minY, baseViewBox.minY);
      assert.equal(viewBox.height, baseViewBox.height);
    }
  }
});

test("room-percent projection is derived from mm geometry without pixel minimums", () => {
  const draft = createDefaultDraft();
  const geometry = computeItemGeometryMm(draft, placeItemOnWall(draft, makeItem(), "top", 1_000));
  const projected = geometryToRoomPercent(draft, geometry);

  assert.equal(projected.left, (1_000 / 13_724) * 100);
  assert.equal(projected.width, (900 / 13_724) * 100);
  assert.equal(projected.height, (180 / 8_146) * 100);
});

test("wall offsets clamp by physical wall length and anchor semantics", () => {
  const draft = createDefaultDraft();
  const item = makeItem();

  assert.equal(clampWallOffsetMm(draft, item, "top", 99_999, "start"), 12_824);
  assert.equal(clampWallOffsetMm(draft, item, "left", 99_999, "start"), 7_246);
  assert.equal(clampWallOffsetMm(draft, item, "top", -10, "center"), 450);
  assert.equal(clampWallOffsetMm(draft, item, "top", 99_999, "center"), 13_274);
});

test("v3 local draft serializes and restores without losing survey fields", () => {
  const source = {
    ...createDefaultDraft(),
    roomName: "현장 실측실",
    activeGuideStep: "facility",
    stageChecks: { room: "complete", door: "none", window: "review" },
    siteChecklist: { internetAvailable: "yes", internetMode: "wired" },
    fieldNotes: "CAD팀 전달 메모",
    items: [
      placeItemOnWall(createDefaultDraft(), makeItem(), "bottom", 1_234),
      makeItem({ id: "aircon-1", kind: "fixture", presetId: "aircon-ceiling", name: "천장형 에어컨", xMm: 5_000, yMm: 3_000, widthMm: 840, heightMm: 840, openingHeightMm: undefined, handing: undefined, swing: undefined }),
    ],
  };

  const raw = serializeDraft(source);
  const restored = deserializeDraft(raw);

  assert.equal(restored.source, "v3");
  assert.deepEqual(restored.issues, []);
  assert.deepEqual(restored.draft, normalizeDraft(source));
  assert.equal(restored.draft.activeGuideStep, "facility");
  assert.deepEqual(restored.draft.stageChecks, source.stageChecks);
  assert.deepEqual(restored.draft.siteChecklist, source.siteChecklist);
  assert.equal(restored.draft.fieldNotes, "CAD팀 전달 메모");
  assert.doesNotMatch(raw, /organization|campaign|quotation|\/api\//i);
});

test("malformed storage data safely restores the default local draft", () => {
  const restored = deserializeDraft("{not-json");

  assert.equal(restored.source, "default");
  assert.deepEqual(restored.draft, createDefaultDraft());
  assert.deepEqual(restored.issues, []);
});

test("legacy v1 browser draft migrates metres and percentages to exact millimetres", () => {
  const legacy = {
    roomName: "기존 저장본",
    roomWidth: 13.724,
    roomHeight: 8.146,
    roomCeilingHeight: 2.551,
    roomWallThickness: 0.15,
    stageChecks: { room: "complete" },
    siteChecklist: { internetAvailable: "yes" },
    fieldNotes: "기존 메모",
    items: [
      { id: "legacy-door", kind: "door", presetId: "door-single", name: "기존 문", x: 20, y: 0, width: 0.9, height: 0.18, rotation: 0, wall: "top", offset: 1.234, openingHeight: 2.1, sillHeight: 0 },
      { id: "legacy-ac", kind: "fixture", presetId: "aircon-ceiling", name: "기존 천장형", x: 50, y: 50, width: 0.84, height: 0.62, rotation: 0 },
      {
        id: "legacy-beam-1", kind: "beam", presetId: "beam", name: "기존 보 1", x: 0, y: 0, width: 2.4, height: 0.35, rotation: 0,
        structureAttachment: { mode: "wall", wall: "top" },
        structureMeasurement: { axis: "x", referenceType: "wall", referenceWall: "left", direction: 1, distanceMode: "clear", distance: 1 },
      },
      {
        id: "legacy-beam-2", kind: "beam", presetId: "beam", name: "기존 보 2", x: 0, y: 0, width: 2.4, height: 0.35, rotation: 0,
        structureAttachment: { mode: "wall", wall: "top" },
        structureMeasurement: { axis: "x", referenceType: "item", referenceItemId: "legacy-beam-1", direction: 1, distanceMode: "clear", distance: 2 },
      },
    ],
  };

  const migrated = migrateLegacyDraft(legacy);
  assert.ok(migrated);
  assert.equal(migrated.roomWidthMm, 13_724);
  assert.equal(migrated.roomHeightMm, 8_146);
  assert.equal(migrated.roomCeilingHeightMm, 2_551);
  assert.equal(migrated.roomWallThicknessMm, 150);
  assert.equal(migrated.items[0].widthMm, 900);
  assert.equal(migrated.items[0].offsetMm, 1_234);
  assert.equal(migrated.items[0].openingHeightMm, 2_100);
  assert.equal(migrated.items[0].sillHeightMm, 0);
  assert.equal(migrated.items[1].widthMm, 840);
  assert.equal(migrated.items[1].heightMm, 840);
  assert.equal(migrated.items[2].structureMeasurement.distanceMm, 1_000);
  assert.equal(migrated.items[2].xMm, 1_000);
  assert.equal(migrated.items[3].structureMeasurement.referenceItemId, "legacy-beam-1");
  assert.equal(migrated.items[3].xMm, 5_400);
  assert.deepEqual(migrated.stageChecks, { room: "complete" });
  assert.deepEqual(migrated.siteChecklist, { internetAvailable: "yes" });
  assert.equal(migrated.fieldNotes, "기존 메모");
});

test("normalization keeps a ceiling cassette square and preserves a zero sill height", () => {
  const normalized = normalizeDraft({
    ...createDefaultDraft(),
    items: [
      makeItem({ id: "zero-sill", kind: "window", presetId: "window-fixed", name: "바닥창", widthMm: 1_200, heightMm: 140, openingHeightMm: 1_500, sillHeightMm: 0 }),
      makeItem({ id: "square-ac", kind: "fixture", presetId: "aircon-ceiling", name: "천장형 에어컨", xMm: 3_000, yMm: 3_000, widthMm: 840, heightMm: 620, openingHeightMm: undefined, handing: undefined, swing: undefined }),
    ],
  });

  assert.equal(normalized.items[0].sillHeightMm, 0);
  assert.equal(normalized.items[1].widthMm, 840);
  assert.equal(normalized.items[1].heightMm, 840);
});

test("missing square-symbol dimensions use the current 1000 mm cassette and 450 mm round-pillar defaults", () => {
  const normalized = normalizeDraft({
    ...createDefaultDraft(),
    items: [
      makeItem({ id: "default-ac", kind: "fixture", presetId: "aircon-ceiling", name: "천장형 에어컨", widthMm: undefined, heightMm: undefined, openingHeightMm: undefined, handing: undefined, swing: undefined }),
      makeItem({ id: "round-pillar", kind: "pillar", presetId: "pillar-round", name: "원형 기둥", widthMm: 600, heightMm: 420, openingHeightMm: undefined, handing: undefined, swing: undefined }),
      makeItem({ id: "default-round-pillar", kind: "pillar", presetId: "pillar-round", name: "기본 원형 기둥", widthMm: undefined, heightMm: undefined, openingHeightMm: undefined, handing: undefined, swing: undefined }),
    ],
  });

  assert.deepEqual(
    normalized.items.map((item) => [item.widthMm, item.heightMm]),
    [[1_000, 1_000], [600, 600], [450, 450]],
  );
});

test("v3 beams default to wall attachment while v2 free beams keep their legacy coordinates", () => {
  const base = createDefaultDraft();
  const v3 = normalizeDraft({
    ...base,
    items: [makeBeam("new-beam", { xMm: 4_000, yMm: 2_000 })],
  });
  const v2 = normalizeDraftWithIssues({
    ...base,
    schemaVersion: 2,
    items: [makeBeam("old-beam", { xMm: 4_000, yMm: 2_000 })],
  });

  assert.deepEqual(v3.items[0].structureAttachment, { mode: "wall", wall: "top" });
  assert.equal(v3.items[0].wall, "top");
  assert.equal(v3.items[0].yMm, 0);
  assert.equal(v2.source, "v2");
  assert.deepEqual(v2.draft.items[0].structureAttachment, { mode: "free" });
  assert.equal(v2.draft.items[0].wall, undefined);
  assert.equal(v2.draft.items[0].xMm, 4_000);
  assert.equal(v2.draft.items[0].yMm, 2_000);
});

test("wall and previous-beam clear distances resolve to exact physical millimetres", () => {
  const draft = {
    ...createDefaultDraft(),
    roomWidthMm: 10_000,
    roomHeightMm: 6_000,
    items: [
      makeBeam("beam-1", {
        structureAttachment: { mode: "wall", wall: "top" },
        structureMeasurement: {
          axis: "x",
          referenceType: "wall",
          referenceWall: "left",
          direction: 1,
          distanceMode: "clear",
          distanceMm: 1_000,
        },
      }),
      makeBeam("beam-2", {
        structureAttachment: { mode: "wall", wall: "top" },
        structureMeasurement: {
          axis: "x",
          referenceType: "item",
          referenceItemId: "beam-1",
          direction: 1,
          distanceMode: "clear",
          distanceMm: 2_000,
        },
      }),
    ],
  };

  const placement = resolveStructurePlacements(draft);
  const first = computeItemGeometryMm(draft, placement.items[0]);
  const second = computeItemGeometryMm(draft, placement.items[1]);

  assert.deepEqual(placement.issues, []);
  assert.deepEqual(
    { xMm: first.xMm, yMm: first.yMm, widthMm: first.widthMm, heightMm: first.heightMm },
    { xMm: 1_000, yMm: 0, widthMm: 2_400, heightMm: 350 },
  );
  assert.equal(second.xMm, 5_400);
  assert.equal(second.yMm, 0);
  assert.equal(second.xMm - (first.xMm + first.widthMm), 2_000);
});

test("first pillar starts flush at zero and the next pillar uses face-to-face distance", () => {
  const draft = normalizeDraft({
    ...createDefaultDraft(),
    roomWidthMm: 10_000,
    roomHeightMm: 6_000,
    items: [
      makePillar("pillar-1", {
        structureAttachment: { mode: "wall", wall: "top" },
        structureMeasurement: {
          axis: "x",
          referenceType: "wall",
          referenceWall: "left",
          direction: 1,
          distanceMode: "clear",
          distanceMm: 0,
        },
      }),
      makePillar("pillar-2", {
        structureAttachment: { mode: "wall", wall: "top" },
        structureMeasurement: {
          axis: "x",
          referenceType: "item",
          referenceItemId: "pillar-1",
          direction: 1,
          distanceMode: "clear",
          distanceMm: 1_200,
        },
      }),
    ],
  });

  const placement = resolveStructurePlacements(draft);
  const first = computeItemGeometryMm(draft, placement.items[0]);
  const second = computeItemGeometryMm(draft, placement.items[1]);
  const segment = buildSiteLayoutDimensionSegmentsMm(draft)
    .find((candidate) => candidate.id === "pillar-2-reference");

  assert.deepEqual(placement.issues, []);
  assert.deepEqual({ xMm: first.xMm, yMm: first.yMm }, { xMm: 0, yMm: 0 });
  assert.deepEqual({ xMm: second.xMm, yMm: second.yMm }, { xMm: 1_650, yMm: 0 });
  assert.equal(second.xMm - (first.xMm + first.widthMm), 1_200);
  assert.deepEqual(segment?.start, { xMm: 450, yMm: 0 });
  assert.deepEqual(segment?.end, { xMm: 1_650, yMm: 0 });
  assert.equal(segment?.label, "기둥 면간 1,200 mm");
});

test("A3 beam dimensions use the previous beam end face and next beam start face", () => {
  const draft = normalizeDraft({
    ...createDefaultDraft(),
    roomWidthMm: 10_000,
    roomHeightMm: 6_000,
    items: [
      makeBeam("beam-1", {
        structureAttachment: { mode: "wall", wall: "top" },
        structureMeasurement: {
          axis: "x",
          referenceType: "wall",
          referenceWall: "left",
          direction: 1,
          distanceMode: "clear",
          distanceMm: 1_000,
        },
      }),
      makeBeam("beam-2", {
        structureAttachment: { mode: "wall", wall: "top" },
        structureMeasurement: {
          axis: "x",
          referenceType: "item",
          referenceItemId: "beam-1",
          direction: 1,
          distanceMode: "clear",
          distanceMm: 2_000,
        },
      }),
    ],
  });

  const segment = buildSiteLayoutDimensionSegmentsMm(draft)
    .find((candidate) => candidate.id === "beam-2-reference");

  assert.deepEqual(segment, {
    id: "beam-2-reference",
    subjectItemId: "beam-2",
    referenceItemId: "beam-1",
    axis: "x",
    side: "top",
    kind: "reference",
    distanceMode: "clear",
    start: { xMm: 3_400, yMm: 0 },
    end: { xMm: 5_400, yMm: 0 },
    distanceMm: 2_000,
    label: "보 면간 2,000 mm",
  });
});

test("A3 window dimensions use the previous window end face and next window start face", () => {
  const base = { ...createDefaultDraft(), roomWidthMm: 10_000, roomHeightMm: 6_000 };
  const first = placeItemOnWall(base, makeItem({
    id: "window-1",
    kind: "window",
    presetId: "window-sliding-2",
    name: "첫 창호",
    widthMm: 1_800,
    heightMm: 140,
    openingHeightMm: 1_500,
    sillHeightMm: 900,
    handing: undefined,
    swing: undefined,
  }), "top", 500);
  const second = placeItemOnWall(base, makeItem({
    id: "window-2",
    kind: "window",
    presetId: "window-sliding-2",
    name: "다음 창호",
    widthMm: 1_800,
    heightMm: 140,
    openingHeightMm: 1_500,
    sillHeightMm: 900,
    handing: undefined,
    swing: undefined,
    openingMeasurement: {
      axis: "x",
      referenceType: "item",
      referenceItemId: "window-1",
      direction: 1,
      distanceMode: "clear",
      distanceMm: 650,
    },
  }), "top", 2_950);
  const draft = normalizeDraft({ ...base, items: [first, second] });

  const segment = buildSiteLayoutDimensionSegmentsMm(draft)
    .find((candidate) => candidate.id === "window-2-reference");

  assert.deepEqual(segment, {
    id: "window-2-reference",
    subjectItemId: "window-2",
    referenceItemId: "window-1",
    axis: "x",
    side: "top",
    kind: "reference",
    distanceMode: "clear",
    start: { xMm: 2_300, yMm: 0 },
    end: { xMm: 2_950, yMm: 0 },
    distanceMm: 650,
    label: "창호 면간 650 mm",
  });
});

test("A3 door dimensions expose the opening span and both wall reference distances", () => {
  const base = { ...createDefaultDraft(), roomWidthMm: 10_000, roomHeightMm: 6_000 };
  const door = placeItemOnWall(base, makeItem({
    id: "door-bottom",
    name: "하단 출입문",
    widthMm: 1_800,
  }), "bottom", 7_000);
  const draft = normalizeDraft({ ...base, items: [door] });
  const segments = buildSiteLayoutDimensionSegmentsMm(draft);

  assert.deepEqual(
    segments
      .filter((segment) => segment.subjectItemId === "door-bottom")
      .map(({ id, start, end, distanceMm, label }) => ({ id, start, end, distanceMm, label })),
    [
      {
        id: "door-bottom-span",
        start: { xMm: 7_000, yMm: 6_000 },
        end: { xMm: 8_800, yMm: 6_000 },
        distanceMm: 1_800,
        label: "문틀 전체 1,800 mm",
      },
      {
        id: "door-bottom-reference",
        start: { xMm: 0, yMm: 6_000 },
        end: { xMm: 7_000, yMm: 6_000 },
        distanceMm: 7_000,
        label: "벽 시작→문틀 시작 7,000 mm",
      },
      {
        id: "door-bottom-reference-end",
        start: { xMm: 8_800, yMm: 6_000 },
        end: { xMm: 10_000, yMm: 6_000 },
        distanceMm: 1_200,
        label: "문틀 끝→벽 끝 1,200 mm",
      },
    ],
  );
});

test("A3 ceiling AC dimensions report center datums without an 840 mm size dimension", () => {
  const draft = normalizeDraft({
    ...createDefaultDraft(),
    roomWidthMm: 10_000,
    roomHeightMm: 6_000,
    items: [makeItem({
      id: "aircon-ceiling",
      kind: "fixture",
      presetId: "aircon-ceiling",
      name: "천장형 에어컨",
      xMm: 5_000,
      yMm: 3_000,
      widthMm: 840,
      heightMm: 840,
      openingHeightMm: undefined,
      handing: undefined,
      swing: undefined,
    })],
  });

  const segments = buildSiteLayoutDimensionSegmentsMm(draft)
    .filter((segment) => segment.subjectItemId === "aircon-ceiling");

  assert.deepEqual(
    segments.map(({ id, start, end, distanceMm, label }) => ({ id, start, end, distanceMm, label })),
    [
      {
        id: "aircon-ceiling-position-x",
        start: { xMm: 0, yMm: 3_420 },
        end: { xMm: 5_420, yMm: 3_420 },
        distanceMm: 5_420,
        label: "좌측벽→중심 5,420 mm",
      },
      {
        id: "aircon-ceiling-position-y",
        start: { xMm: 5_420, yMm: 0 },
        end: { xMm: 5_420, yMm: 3_420 },
        distanceMm: 3_420,
        label: "상단벽→중심 3,420 mm",
      },
    ],
  );
  assert.equal(segments.some((segment) => segment.kind === "span" || /840/.test(segment.label)), false);
});

test("center distances and reverse wall references preserve their distinct semantics", () => {
  const draft = {
    ...createDefaultDraft(),
    roomWidthMm: 10_000,
    roomHeightMm: 6_000,
    items: [
      makeBeam("beam-center-1", {
        structureAttachment: { mode: "wall", wall: "bottom" },
        structureMeasurement: {
          axis: "x",
          referenceType: "wall",
          referenceWall: "right",
          direction: -1,
          distanceMode: "clear",
          distanceMm: 500,
        },
      }),
      makeBeam("beam-center-2", {
        structureAttachment: { mode: "wall", wall: "bottom" },
        structureMeasurement: {
          axis: "x",
          referenceType: "item",
          referenceItemId: "beam-center-1",
          direction: -1,
          distanceMode: "center",
          distanceMm: 3_000,
        },
      }),
    ],
  };

  const placement = resolveStructurePlacements(draft);
  const first = computeItemGeometryMm(draft, placement.items[0]);
  const second = computeItemGeometryMm(draft, placement.items[1]);

  assert.deepEqual(placement.issues, []);
  assert.equal(first.xMm, 7_100);
  assert.equal(first.yMm, 5_650);
  assert.equal(first.centerXmm - second.centerXmm, 3_000);
});

test("vertical wall beams resolve along y and wall-mounted pillars remain flush to the boundary", () => {
  const draft = {
    ...createDefaultDraft(),
    roomWidthMm: 10_000,
    roomHeightMm: 6_000,
    items: [
      makeBeam("vertical-beam", {
        structureAttachment: { mode: "wall", wall: "left" },
        structureMeasurement: {
          axis: "y",
          referenceType: "wall",
          referenceWall: "top",
          direction: 1,
          distanceMode: "clear",
          distanceMm: 700,
        },
      }),
      makeItem({
        id: "pillar-right",
        kind: "pillar",
        presetId: "pillar",
        name: "벽 부착 기둥",
        widthMm: 450,
        heightMm: 450,
        openingHeightMm: undefined,
        handing: undefined,
        swing: undefined,
        structureAttachment: { mode: "wall", wall: "right" },
        structureMeasurement: {
          axis: "y",
          referenceType: "wall",
          referenceWall: "top",
          direction: 1,
          distanceMode: "clear",
          distanceMm: 0,
        },
      }),
    ],
  };

  const placement = resolveStructurePlacements(draft);
  const beam = computeItemGeometryMm(draft, placement.items[0]);
  const pillar = computeItemGeometryMm(draft, placement.items[1]);

  assert.deepEqual(placement.issues, []);
  assert.deepEqual(
    { xMm: beam.xMm, yMm: beam.yMm, widthMm: beam.widthMm, heightMm: beam.heightMm, rotation: beam.rotation },
    { xMm: 0, yMm: 700, widthMm: 350, heightMm: 2_400, rotation: 90 },
  );
  assert.equal(pillar.xMm + pillar.widthMm, draft.roomWidthMm);
  assert.equal(pillar.yMm, 0);
});

test("structure references report deleted ids, wrong axes, wrong walls, and cycles", () => {
  const base = createDefaultDraft();
  const missing = makeBeam("missing", {
    structureAttachment: { mode: "wall", wall: "top" },
    structureMeasurement: { axis: "x", referenceType: "item", referenceItemId: "deleted", direction: 1, distanceMode: "clear", distanceMm: 500 },
  });
  const wrongAxis = makeBeam("wrong-axis", {
    structureAttachment: { mode: "wall", wall: "top" },
    structureMeasurement: { axis: "y", referenceType: "wall", referenceWall: "top", direction: 1, distanceMode: "clear", distanceMm: 500 },
  });
  const topReference = makeBeam("top-reference", {
    structureAttachment: { mode: "wall", wall: "top" },
    structureMeasurement: { axis: "x", referenceType: "wall", referenceWall: "left", direction: 1, distanceMode: "clear", distanceMm: 500 },
  });
  const wrongWall = makeBeam("wrong-wall", {
    structureAttachment: { mode: "wall", wall: "bottom" },
    structureMeasurement: { axis: "x", referenceType: "item", referenceItemId: "top-reference", direction: 1, distanceMode: "clear", distanceMm: 500 },
  });
  const cycleA = makeBeam("cycle-a", {
    structureAttachment: { mode: "wall", wall: "top" },
    structureMeasurement: { axis: "x", referenceType: "item", referenceItemId: "cycle-b", direction: 1, distanceMode: "clear", distanceMm: 500 },
  });
  const cycleB = makeBeam("cycle-b", {
    structureAttachment: { mode: "wall", wall: "top" },
    structureMeasurement: { axis: "x", referenceType: "item", referenceItemId: "cycle-a", direction: 1, distanceMode: "clear", distanceMm: 500 },
  });
  const issues = resolveStructurePlacements({
    ...base,
    items: [missing, wrongAxis, topReference, wrongWall, cycleA, cycleB],
  }).issues;

  assert.ok(issues.some((issue) => issue.code === "structure-reference-missing" && issue.itemId === "missing"));
  assert.ok(issues.some((issue) => issue.code === "structure-reference-axis" && issue.itemId === "wrong-axis"));
  assert.ok(issues.some((issue) => issue.code === "structure-reference-wall" && issue.itemId === "wrong-wall"));
  assert.ok(issues.some((issue) => issue.code === "structure-reference-cycle" && issue.itemId === "cycle-a"));
  assert.ok(issues.some((issue) => issue.code === "structure-reference-cycle" && issue.itemId === "cycle-b"));
});

test("v3 serialization preserves stable previous-beam ids and millimetre distance modes", () => {
  const draft = {
    ...createDefaultDraft(),
    items: [
      makeBeam("serialized-beam", {
        structureAttachment: { mode: "wall", wall: "top" },
        structureMeasurement: {
          axis: "x",
          referenceType: "item",
          referenceItemId: "stable-previous-id",
          direction: -1,
          distanceMode: "center",
          distanceMm: 2_750,
        },
      }),
    ],
  };
  const raw = serializeDraft(draft);
  const restored = deserializeDraft(raw);

  assert.equal(restored.source, "v3");
  assert.equal(restored.draft.schemaVersion, 3);
  assert.deepEqual(restored.draft.items[0].structureAttachment, { mode: "wall", wall: "top" });
  assert.deepEqual(restored.draft.items[0].structureMeasurement, {
    axis: "x",
    referenceType: "item",
    referenceWall: undefined,
    referenceItemId: "stable-previous-id",
    direction: -1,
    distanceMode: "center",
    distanceMm: 2_750,
  });
  assert.ok(restored.issues.some((issue) => issue.code === "structure-reference-missing"));
});

test("mobile survey follows one stable step at a time with bounded previous and next navigation", () => {
  assert.deepEqual(GUIDE_STEPS, ["room", "door", "structure", "window", "facility", "checklist", "review"]);
  assert.equal(advanceSurveyStep("room", -1), "room");
  assert.equal(advanceSurveyStep("room", 1), "door");
  assert.equal(advanceSurveyStep("facility", 1), "checklist");
  assert.equal(advanceSurveyStep("review", 1), "review");

  const draft = { ...createDefaultDraft(), activeGuideStep: "window" };
  assert.deepEqual(nextGuideState(draft), {
    stepId: "window",
    index: 3,
    total: 7,
    previousStepId: "structure",
    nextStepId: "facility",
    complete: false,
  });
});

test("review completion is based on real geometry validation", () => {
  const valid = { ...createDefaultDraft(), activeGuideStep: "review" };
  const invalid = {
    ...valid,
    items: [makeItem({ id: "too-tall-window", kind: "window", presetId: "window-fixed", name: "높이 오류 창", openingHeightMm: 2_000, sillHeightMm: 900 })],
  };

  assert.equal(nextGuideState(valid).complete, true);
  assert.equal(nextGuideState(invalid).complete, false);
});

test("free pillar A3 dimensions use the same left and top face distances entered on site", () => {
  const draft = {
    ...createDefaultDraft(),
    roomWidthMm: 10_000,
    roomHeightMm: 6_000,
    items: [makePillar("free-pillar", {
      xMm: 2_200,
      yMm: 1_700,
      structureAttachment: { mode: "free" },
    })],
  };

  const segments = buildSiteLayoutDimensionSegmentsMm(draft)
    .filter((segment) => segment.subjectItemId === "free-pillar");

  assert.deepEqual(
    segments.map(({ id, distanceMode, start, end, distanceMm, label }) => ({ id, distanceMode, start, end, distanceMm, label })),
    [
      {
        id: "free-pillar-position-x",
        distanceMode: "clear",
        start: { xMm: 0, yMm: 1_925 },
        end: { xMm: 2_200, yMm: 1_925 },
        distanceMm: 2_200,
        label: "좌벽→기둥면 2,200 mm",
      },
      {
        id: "free-pillar-position-y",
        distanceMode: "clear",
        start: { xMm: 2_425, yMm: 0 },
        end: { xMm: 2_425, yMm: 1_700 },
        distanceMm: 1_700,
        label: "상벽→기둥면 1,700 mm",
      },
    ],
  );
});

test("free pillar keeps right and bottom survey walls and dimensions their nearest faces", () => {
  const draft = normalizeDraft({
    roomName: "독립 기둥 반대벽 기준",
    roomWidth: 10,
    roomHeight: 6,
    roomCeilingHeight: 2.7,
    items: [{
      id: "reverse-free-pillar",
      kind: "pillar",
      presetId: "pillar",
      name: "독립 기둥",
      x: 76,
      y: 75,
      width: 0.6,
      height: 0.45,
      rotation: 0,
      structureAttachment: { mode: "free" },
      freeReferenceX: "right",
      freeReferenceY: "bottom",
    }],
  });
  const item = draft.items[0];
  const segments = buildSiteLayoutDimensionSegmentsMm(draft)
    .filter((segment) => segment.subjectItemId === "reverse-free-pillar");

  assert.equal(item.freeReferenceX, "right");
  assert.equal(item.freeReferenceY, "bottom");
  assert.deepEqual(
    segments.map(({ id, side, start, end, distanceMm, label }) => ({ id, side, start, end, distanceMm, label })),
    [
      {
        id: "reverse-free-pillar-position-x",
        side: "bottom",
        start: { xMm: 10_000, yMm: 4_725 },
        end: { xMm: 8_200, yMm: 4_725 },
        distanceMm: 1_800,
        label: "우벽→기둥면 1,800 mm",
      },
      {
        id: "reverse-free-pillar-position-y",
        side: "right",
        start: { xMm: 7_900, yMm: 6_000 },
        end: { xMm: 7_900, yMm: 4_950 },
        distanceMm: 1_050,
        label: "하벽→기둥면 1,050 mm",
      },
    ],
  );
});

test("wall pillar inset is preserved in millimetres and rendered from wall face to pillar face", () => {
  const draft = normalizeDraft({
    roomName: "벽 이격 기둥",
    roomWidth: 10,
    roomHeight: 6,
    roomCeilingHeight: 2.7,
    items: [{
      id: "inset-pillar",
      kind: "pillar",
      presetId: "pillar",
      name: "우측 이격 기둥",
      x: 0,
      y: 0,
      width: 0.45,
      height: 0.6,
      rotation: 90,
      wall: "right",
      offset: 0,
      wallInset: 0.3,
      structureAttachment: { mode: "wall", wall: "right" },
      structureMeasurement: { axis: "y", referenceType: "wall", referenceWall: "top", direction: 1, distanceMode: "clear", distanceMm: 0 },
    }],
  });
  const item = draft.items[0];
  const geometry = computeItemGeometryMm(draft, item);
  const inset = buildSiteLayoutDimensionSegmentsMm(draft)
    .find((segment) => segment.id === "inset-pillar-wall-inset");

  assert.equal(item.wallInsetMm, 300);
  assert.deepEqual(
    { xMm: geometry.xMm, yMm: geometry.yMm, widthMm: geometry.widthMm, heightMm: geometry.heightMm },
    { xMm: 9_100, yMm: 0, widthMm: 600, heightMm: 450 },
  );
  assert.deepEqual(inset && {
    start: inset.start,
    end: inset.end,
    distanceMm: inset.distanceMm,
    label: inset.label,
  }, {
    start: { xMm: 10_000, yMm: 225 },
    end: { xMm: 9_700, yMm: 225 },
    distanceMm: 300,
    label: "우벽→기둥면 300 mm",
  });
});

test("dimension layout packs overlapping measurements into lanes and keeps overall dimensions outermost", () => {
  const segment = (id, startX, endX, label, kind = "reference") => ({
    id,
    subjectItemId: id,
    axis: "x",
    side: "top",
    kind,
    distanceMode: "clear",
    start: { xMm: startX, yMm: 0 },
    end: { xMm: endX, yMm: 0 },
    distanceMm: Math.abs(endX - startX),
    label,
  });
  const duplicate = segment("duplicate-id", 0, 2_000, "문 개구부 2,000 mm", "span");
  const layout = layoutSiteLayoutDimensionSegmentsMm([
    segment("opening", 0, 2_000, "문 개구부 2,000 mm", "span"),
    segment("overlap", 500, 2_500, "벽 시작→문 시작면 2,000 mm"),
    segment("far", 6_000, 7_000, "보 길이 1,000 mm", "span"),
    duplicate,
    { ...duplicate, id: "duplicate-copy" },
    {
      id: "inside-position",
      subjectItemId: "inside-position",
      axis: "y",
      side: "left",
      kind: "position",
      distanceMode: "clear",
      start: { xMm: 2_000, yMm: 0 },
      end: { xMm: 2_000, yMm: 1_500 },
      distanceMm: 1_500,
      label: "상벽→기둥면 1,500 mm",
    },
  ]);
  const byId = new Map(layout.segments.map((item) => [item.id, item]));
  const maximumObjectOffset = Math.max(...layout.segments.map((item) => item.laneOffsetMm));

  assert.notEqual(byId.get("opening").laneIndex, byId.get("overlap").laneIndex);
  assert.equal(byId.get("opening").laneIndex, byId.get("far").laneIndex);
  assert.equal(byId.get("inside-position").laneIndex, -1);
  assert.equal(byId.get("inside-position").laneOffsetMm, 0);
  assert.equal(layout.segments.some((item) => item.id === "duplicate-copy"), false);
  assert.ok(layout.overallOffsetMm.top > maximumObjectOffset);
  assert.ok(layout.paddingBySideMm.top > layout.overallOffsetMm.top);
});

test("directional dimension padding expands only the required viewBox sides", () => {
  const draft = { ...createDefaultDraft(), roomWidthMm: 10_000, roomHeightMm: 6_000, items: [] };
  const base = computeSvgViewBox(draft, { paddingMm: 650 });
  const expanded = computeSvgViewBox(draft, {
    paddingMm: 650,
    paddingBySideMm: { top: 1_240, left: 930 },
  });

  assert.equal(expanded.minY, -draft.roomWallThicknessMm - 1_240);
  assert.equal(expanded.minX, -draft.roomWallThicknessMm - 930);
  assert.equal(expanded.minX + expanded.width, base.minX + base.width);
  assert.equal(expanded.minY + expanded.height, base.minY + base.height);
});

test("KS F 1501 door plan symbols keep jambs, leaves, 90-degree arcs, overlapping sliders, and folding zigzags", () => {
  const source = geometryViewSection("function DoorLeaf", "function windowPartitionCount");

  assert.match(source, /const officialKsSymbol = ksAppendix2OpeningPresets\.has\(presetId\);/);
  assert.match(source, /data-plan-source=\{planSource\}/);
  assert.equal((source.match(/data-symbol-part="opening-jamb"/g) ?? []).length, 2);
  assert.match(source, /data-symbol-part="door-leaf"/);
  assert.match(source, /data-symbol-part="door-swing-arc" data-swing-angle-deg="90"/);
  assert.equal((source.match(/data-symbol-part="sliding-door-track"/g) ?? []).length, 2);
  assert.equal((source.match(/data-symbol-part="sliding-door-leaf"/g) ?? []).length, 2);
  assert.match(source, /const pocketLeafSpan = span \* 0\.32;/);
  assert.match(source, /data-symbol-part="sliding-door-clear-opening"/);
  assert.match(source, /const meetingMm = start \+ span \/ 2;/);
  assert.match(source, /data-symbol-part="sliding-door-meeting-stile"/);
  assert.doesNotMatch(source, /panelOverlapRatio/);
  assert.match(source, /const foldCount = 4;/);
  assert.match(source, /data-symbol-part="folding-door-leaves" data-fold-count=\{foldCount\}/);
  assert.doesNotMatch(source, /arrowHeadPath|strokeDasharray/);
});

test("KS F 1501 window plan symbols distinguish fixed glazing, overlapping sliding sashes, and outside casement swing", () => {
  const source = geometryViewSection("function WindowSymbol", "function GenericItemSymbol");

  assert.match(source, /const officialKsSymbol = ksAppendix2OpeningPresets\.has\(presetId\);/);
  assert.match(source, /data-plan-source=\{planSource\}/);
  assert.match(source, /data-window-operation=\{slidingWindow \? "sliding" : item\.presetId === "window-project" \? "casement-out" : "fixed"\}/);
  assert.equal((source.match(/data-symbol-part="fixed-window-frame"/g) ?? []).length, 2);
  assert.equal((source.match(/data-symbol-part="fixed-window-glazing"/g) ?? []).length, 1);
  assert.equal((source.match(/data-symbol-part="sliding-window-track"/g) ?? []).length, 2);
  assert.match(source, /data-symbol-part="sliding-window-leaf"/);
  assert.match(source, /const symbolicMeetingOverlapMm = Math\.min\(openingSpan \* 0\.06, draft\.roomWallThicknessMm\);/);
  assert.match(source, /const panelWidth = \(openingSpan \+ symbolicMeetingOverlapMm \* Math\.max\(0, count - 1\)\) \/ count;/);
  assert.match(source, /const panelStart = start \+ index \* \(panelWidth - symbolicMeetingOverlapMm\);/);
  assert.doesNotMatch(source, /0\.78/);
  assert.match(source, /const casementOpenAlongMm = casementHingeMm \+ \(casementDirection \* openingSpan\) \/ Math\.SQRT2;/);
  assert.match(source, /centerOffset - openingSpan \/ Math\.SQRT2/);
  assert.match(source, /data-symbol-part="casement-window-operation" data-swing="outside" data-swing-angle-deg="45"/);
  assert.match(source, /data-symbol-part="casement-window-leaf"/);
  assert.match(source, /data-symbol-part="casement-window-swing-arc"/);
  assert.match(source, /A \$\{openingSpan\} \$\{openingSpan\}/);
  assert.doesNotMatch(source, /projectPeak|casement-window-swing"[\s\S]*?<polyline/);
  assert.doesNotMatch(source, /arrowHeadPath|strokeDasharray/);

  const openingSpan = 2_700;
  const panelCount = 4;
  const symbolicMeetingOverlapMm = Math.min(openingSpan * 0.06, 150);
  const panelWidth = (openingSpan + symbolicMeetingOverlapMm * (panelCount - 1)) / panelCount;
  const lastPanelStart = (panelCount - 1) * (panelWidth - symbolicMeetingOverlapMm);
  assert.ok(symbolicMeetingOverlapMm > 0);
  assert.ok(Math.abs(lastPanelStart + panelWidth - openingSpan) < 1e-9);
});

test("structure symbols use RC plan-cut hatch and rotation-aware hidden beam edges while cassette AC stays supplied-DWG", () => {
  const source = geometryViewSection("function GenericItemSymbol", "function itemColor");
  const cassetteSource = source.slice(
    source.indexOf('if (item.presetId === "aircon-ceiling")'),
    source.indexOf('if (item.presetId === "aircon-wall")'),
  );

  assert.match(source, /data-plan-source="KS F 1501 부표 3"/);
  assert.equal((source.match(/data-symbol-part="rc-pillar-cut"/g) ?? []).length, 2);
  assert.equal((source.match(/fill=\{`url\(#\$\{wallHatchId\}\)`\}/g) ?? []).length, 2);
  assert.match(source, /const vertical = geometry\.rotation === 90;/);
  assert.match(source, /data-symbol-part="beam-hidden-double-line"/);
  assert.match(source, /data-symbol-part="beam-hidden-edge"/);
  assert.match(source, /strokeDasharray="75 38"/);
  assert.match(cassetteSource, /data-symbol-source="supplied-dwg"/);
  assert.match(cassetteSource, /data-symbol-part="cassette-ac"/);
  assert.doesNotMatch(cassetteSource, /data-drawing-standard=/);
});
