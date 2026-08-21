import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, card, store, crm] = await Promise.all([
  readFile(new URL("../app/api/organization-project-documents/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/organization-project-documents-card.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/organization-project-documents.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
]);

test("도면과 조감도는 기관과 사업 차수별 Google Drive 폴더에만 저장한다", () => {
  assert.match(route, /"01_기관자료"/);
  assert.match(route, /`\$\{businessRound\}차 사업`/);
  assert.match(route, /"도면·조감도"/);
  assert.match(route, /uploadDriveFile/);
  assert.doesNotMatch(route, /writeFile|put\(/);
  assert.match(store, /organization_project_documents/);
  assert.match(store, /organization, business_round, archived_at/);
});

test("도면과 조감도 보관은 원본 삭제 대신 99_보관으로 이동한다", () => {
  assert.match(route, /"99_보관"/);
  assert.match(route, /moveDriveFile/);
  assert.match(route, /SET archived_at = CURRENT_TIMESTAMP/);
  assert.match(route, /rollbackDriveMoves/);
});

test("기관 상세 요약 카드에서 사업별 파일을 보고 등록하고 내려받는다", () => {
  assert.match(crm, /<OrganizationProjectDocumentsCard/);
  assert.match(crm, /businessRound=\{selectedDetailBusinessRound\}/);
  assert.match(card, /도면·조감도 보기/);
  assert.match(card, /Google Drive의 기관명 \/ 사업 차수 \/ 도면·조감도 폴더에만 저장/);
  assert.match(card, /preview=1/);
  assert.match(card, /download=1/);
  assert.match(card, /99_보관 폴더로 옮길까요/);
});

test("도면과 조감도는 통합본 또는 파일별 종류를 확인해 한 번에 등록한다", () => {
  assert.match(route, /"통합본"/);
  assert.match(card, /도면·조감도 한 번에 등록/);
  assert.match(card, /type="file" multiple/);
  assert.match(card, /pendingDocuments\.map/);
  assert.match(card, /entry\.documentType/);
  assert.match(card, /선택 파일 \$\{pendingDocuments\.length\}개 등록/);
  assert.match(card, /실패 \$\{failedCount\}개는 목록에서 확인 후 다시 등록/);
  assert.match(card, /도면·조감도 자료 필터/);
  assert.match(card, /documentFilter === "전체"/);
});
