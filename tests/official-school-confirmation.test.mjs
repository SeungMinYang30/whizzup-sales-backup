import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const organizeRoute = await readFile(
  new URL("../app/api/ai/organize/route.ts", import.meta.url),
  "utf8",
);
const confirmationUi = await readFile(
  new URL("../app/institution-confirmation.ts", import.meta.url),
  "utf8",
);
const recordsRoute = await readFile(
  new URL("../app/api/records/route.ts", import.meta.url),
  "utf8",
);

test("AI 정리 결과에 교육청 공식 학교 후보와 기존 축약 기록 수를 함께 제공한다", () => {
  assert.match(organizeRoute, /findOfficialSchoolCandidates/);
  assert.match(organizeRoute, /existingRecordCount/);
  assert.match(organizeRoute, /schoolConfirmations/);
});

test("사용자가 공식 학교와 기존 기록 명칭 통일 여부를 선택할 수 있다", () => {
  assert.match(confirmationUi, /어느 학교가 맞나요\?/);
  assert.match(confirmationUi, /기존 기록도 통일/);
  assert.match(confirmationUi, /입력한 이름 그대로 사용/);
});

test("승인한 경우에만 같은 공식 학교의 기존 축약 기록을 병합한다", () => {
  assert.match(recordsRoute, /payload\.normalizeOfficialSchoolAliases === true/);
  assert.match(recordsRoute, /institutionAliasKey\(alias\) !== canonicalKey/);
  assert.match(recordsRoute, /mergeInstitutionRecords\(alias, canonicalOrganization/);
});
