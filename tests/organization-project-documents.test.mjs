import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [route, card, store, crm, styles] = await Promise.all([
  readFile(new URL("../app/api/organization-project-documents/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/organization-project-documents-card.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/organization-project-documents.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("도면과 조감도는 기관과 사업 차수별 Google Drive 폴더에만 저장한다", () => {
  assert.match(route, /"01_기관자료"/);
  assert.match(route, /`\$\{businessRound\}차 사업`/);
  assert.match(route, /"도면·조감도"/);
  assert.match(route, /createDriveResumableUpload/);
  assert.match(route, /uploadDriveResumableChunk/);
  assert.match(store, /2 \* 1024 \* 1024 \* 1024/);
  assert.match(route, /최대 2GB까지/);
  assert.doesNotMatch(route, /writeFile|put\(/);
  assert.match(store, /organization_project_documents/);
  assert.match(store, /organization, business_round, archived_at/);
});

test("도면과 조감도 삭제는 원본 제거 대신 99_보관으로 이동한다", () => {
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
  assert.match(card, /파일을 삭제할까요/);
  assert.match(card, /삭제된 파일은 복구를 위해 99_보관 폴더로 이동됩니다/);
  assert.match(card, />삭제<\/button>/);
});

test("PDF와 이미지는 기존 보기 버튼으로 내부 미리보기를 열고 대용량 PDF 구간 요청을 전달한다", () => {
  assert.match(card, /setPreviewDocument\(document\)/);
  assert.match(card, /project-documents-preview-frame/);
  assert.match(card, /새 탭에서 열기/);
  assert.match(route, /request\.headers\.get\("range"\)/);
  assert.match(route, /bytes=0-1048575/);
  assert.match(route, /Content-Range/);
  assert.match(route, /Accept-Ranges/);
  assert.match(route, /"X-Frame-Options": "SAMEORIGIN"/);
  assert.match(route, /"Content-Security-Policy": "frame-ancestors 'self'"/);
  assert.match(styles, /\.project-documents-preview-shell/);
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
  assert.match(card, /RESOURCE_UPLOAD_CHUNK_BYTES/);
  assert.match(card, /Content-Range/);
  assert.match(card, /X-Drive-Upload-Url/);
  assert.match(card, /progress \|\| 0/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /getDriveFileMetadata/);
});

test("대용량 도면 창은 배경을 가리지 않는 일반 팝업이고 인라인 입력의 띄어쓰기를 유지한다", () => {
  assert.match(styles, /\.history-summary-grid > \.project-documents-modal-shell\{[\s\S]*?background:rgba\(20,34,58,\.18\)/);
  const modalShell = styles.slice(
    styles.indexOf(".project-documents-modal-shell,"),
    styles.indexOf(".project-documents-modal{", styles.indexOf(".project-documents-modal-shell,")),
  );
  assert.doesNotMatch(modalShell, /backdrop-filter/);
  assert.match(styles, /\.project-documents-list article strong\{[^}]*font-size:14px/);
  assert.match(styles, /\.project-documents-list article button,\.project-documents-list article a\{[^}]*min-height:38px[^}]*font-size:13px/);
  assert.match(
    crm,
    /event\.target === event\.currentTarget &&[\s\S]{0,180}beginDetailInlineEdit\("contact", detailDisplayRecord\)/,
  );
});
