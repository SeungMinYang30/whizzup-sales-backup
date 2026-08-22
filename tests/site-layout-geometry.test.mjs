import assert from "node:assert/strict";
import test from "node:test";

import {
  DRAFT_SCHEMA_VERSION,
  GUIDE_STEPS,
  LEGACY_STORAGE_KEY,
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
  placeItemOnWall,
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

test("draft model stores physical dimensions as integer millimetres", () => {
  const draft = createDefaultDraft();

  assert.equal(draft.schemaVersion, DRAFT_SCHEMA_VERSION);
  assert.equal(draft.roomWidthMm, 13_724);
  assert.equal(draft.roomHeightMm, 8_146);
  assert.equal(draft.roomCeilingHeightMm, 2_551);
  assert.equal(draft.roomWallThicknessMm, 150);
  assert.equal(Number.isInteger(draft.roomWidthMm), true);
  assert.equal(STORAGE_KEY, "whizzup:site-layout-draft:v2");
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

test("outside-swing doors expand model padding so the complete leaf remains visible", () => {
  const base = createDefaultDraft();
  const outsideDoor = placeItemOnWall(base, makeItem({ widthMm: 1_800, swing: "outside" }), "top", 1_000);
  const viewBox = computeSvgViewBox({ ...base, items: [outsideDoor] }, { paddingMm: 650 });

  assert.ok(-viewBox.minY >= 1_800 + base.roomWallThicknessMm + 180);
  assert.ok(viewBox.height >= base.roomHeightMm + base.roomWallThicknessMm * 2 + (1_800 + base.roomWallThicknessMm + 180) * 2);
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

test("v2 local draft serializes and restores without losing survey fields", () => {
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

  assert.equal(restored.source, "v2");
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
