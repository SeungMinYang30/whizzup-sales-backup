import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recordsStore = await readFile(
  new URL("../lib/records-store.ts", import.meta.url),
  "utf8",
);
const confirmationUi = await readFile(
  new URL("../app/institution-confirmation.ts", import.meta.url),
  "utf8",
);
const institutionNames = await readFile(
  new URL("../lib/institution-names.ts", import.meta.url),
  "utf8",
);
const merge = await readFile(
  new URL("../lib/institution-merge.ts", import.meta.url),
  "utf8",
);

test("새 영업 기록은 유사 기관을 자동 병합하지 않고 저장 전에 확인한다", () => {
  assert.match(recordsStore, /findSimilarInstitutionMatches/);
  assert.match(
    recordsStore,
    /throw new InstitutionConfirmationRequiredError/,
  );
  assert.match(confirmationUi, /이 기존 기관에 새 기록 연결/);
  assert.match(confirmationUi, /확인 전에는 자동으로 병합하지 않습니다/);
});

test("후보는 지역·주소·학교 코드·전화번호를 함께 비교해 표시한다", () => {
  ["region", "address", "schoolCode", "phone"].forEach((field) => {
    assert.match(institutionNames, new RegExp(field));
    assert.match(confirmationUi, new RegExp(field));
  });
  assert.match(recordsStore, /official_school_directory/);
  assert.match(recordsStore, /organization_locations/);
  assert.match(confirmationUi, /학교 코드/);
});

test("확인된 축약명은 기존 병합 공통 로직을 통해 지역별 별칭으로 기억한다", () => {
  assert.match(merge, /updateInstitutionAliasSetting/);
  assert.match(merge, /aliasScopes/);
  assert.match(recordsStore, /rememberedInstitutionAliasCandidates/);
});
