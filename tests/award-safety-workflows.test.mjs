import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [crm, recordsRoute, recordsStore, styles, aiOrganizer] = await Promise.all([
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/records-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/api/ai/organize/route.ts", import.meta.url), "utf8"),
]);

test("admins get checked award deletion with trash recovery", () => {
  assert.match(crm, /선택 \{selectedAwardIds\.length\}건 삭제/);
  assert.doesNotMatch(crm, /현재 목록 일괄 삭제/);
  assert.match(crm, /awardDeleteSafetyChecked/);
  assert.match(crm, /awardDeleteConfirmation\.trim\(\) !== "삭제"/);
  assert.match(crm, /adminAwardDelete: true/);
  assert.match(recordsRoute, /requireAdminMember/);
  assert.match(recordsRoute, /payload\.adminAwardDelete/);
  assert.match(recordsRoute, /createTrashBatch/);
  assert.match(styles, /\.award-delete-modal/);
});

test("equipment set starts at 1.5 million won and remains directly editable", () => {
  assert.match(crm, /directEquipmentSetDefaultUnitPrice = 1_500_000/);
  assert.match(crm, /기본 1,500,000원 · 바로 수정 가능/);
  assert.match(crm, /aria-label=\{`\$\{product\.name\} 금액`\}/);
  assert.match(crm, /setCatalogUnitPriceDrafts/);
});

test("completed awards clear follow-up flags and dates on every save path", () => {
  assert.match(crm, /isCompletedAwardStage\(normalizedHiddenFields\.awardStage\)[\s\S]*followUpRequired: false/);
  assert.match(crm, /재연락 표시와 예정일은 자동으로 해제됩니다/);
  assert.match(recordsRoute, /WHEN \? = 1 AND \? = '납품 완료' THEN 0/);
  assert.match(recordsRoute, /isCompletedAwardStage\(awardManagement\.awardStage\)/);
  assert.match(recordsStore, /isCompletedAwardStage\(awardManagement\.awardStage\)/);
});

test("bulk award completion resolves the next stage inside the record update", () => {
  const bulkStart = crm.indexOf("async function saveSelectedAwardChanges()");
  const bulkEnd = crm.indexOf("async function markAwardAsCompleted", bulkStart);
  const bulkSource = crm.slice(bulkStart, bulkEnd);
  const stageDeclaration = bulkSource.indexOf("const nextAwardStage =");
  const stageUsage = bulkSource.indexOf('awardStage: nextAwardStage');

  assert.ok(bulkStart >= 0);
  assert.ok(stageDeclaration >= 0, "bulk update must resolve nextAwardStage locally");
  assert.ok(stageUsage > stageDeclaration, "nextAwardStage must be declared before use");
});

test("progress schedules never promote an undecided award to a Whizzup award", () => {
  assert.match(recordsStore, /awardStatus:\s*requestedAwardStatus/);
  assert.doesNotMatch(
    recordsStore,
    /requestedAwardStatus === "미정"\s*\?\s*"위즈업 수주"/,
  );
  assert.doesNotMatch(
    crm,
    /management && current\.awardStatus === "미정"/,
  );
  assert.match(
    aiOrganizer,
    /progressSchedule에 일정이 있다는 이유만으로 수주 주체를 위즈업으로 추정하지 마세요/,
  );
  assert.doesNotMatch(
    aiOrganizer,
    /progressSchedule에 일정이 있고 협력사 수주가 명시되지 않았다면 awardStatus는 위즈업 수주/,
  );
});
