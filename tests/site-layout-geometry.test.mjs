import assert from "node:assert/strict";
import test from "node:test";

import {
  DRAFT_SCHEMA_VERSION,
  GUIDE_STEPS,
  LEGACY_STORAGE_KEY,
  PREVIOUS_STORAGE_KEY,
  STORAGE_KEY,
  advanceSurveyStep,
  clampWallOffsetMm,
  computeItemGeometryMm,
  computeOpeningCutGeometryMm,
  computeSvgViewBox,
  computeWallGeometryMm,
  createDefaultDraft,
  deserializeDraft,
  geometryToRoomPercent,
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
  assert.deepEqual(GUIDE_STEPS, ["room", "door", "window", "structure", "facility", "checklist", "review"]);
  assert.equal(advanceSurveyStep("room", -1), "room");
  assert.equal(advanceSurveyStep("room", 1), "door");
  assert.equal(advanceSurveyStep("facility", 1), "checklist");
  assert.equal(advanceSurveyStep("review", 1), "review");

  const draft = { ...createDefaultDraft(), activeGuideStep: "window" };
  assert.deepEqual(nextGuideState(draft), {
    stepId: "window",
    index: 2,
    total: 7,
    previousStepId: "door",
    nextStepId: "structure",
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
