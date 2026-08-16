import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");
const store = await readFile(new URL("../lib/authored-quotations.ts", import.meta.url), "utf8");
const filesRoute = await readFile(new URL("../app/api/quotations/files/route.ts", import.meta.url), "utf8");
const reorganizeRoute = await readFile(new URL("../app/api/quotations/files/reorganize/route.ts", import.meta.url), "utf8");
const pdf = await readFile(new URL("../app/authored-quotation-pdf.ts", import.meta.url), "utf8");
const crm = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const documents = await readFile(new URL("../app/quotation-documents.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const backup = await readFile(new URL("../lib/backup-store.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../drizzle/0083_quotation_revisions_and_drive_files.sql", import.meta.url), "utf8");
const trashMigration = await readFile(new URL("../drizzle/0084_quotation_trash_and_upload_guard.sql", import.meta.url), "utf8");
const quotationsRoute = await readFile(new URL("../app/api/quotations/route.ts", import.meta.url), "utf8");
const quotationReconcileRoute = await readFile(new URL("../app/api/quotations/reconcile/route.ts", import.meta.url), "utf8");

test("quotation actions distinguish drafts, current final files and same-number editing", () => {
  assert.match(page, /이어서 작성/);
  assert.match(page, /PDF 보기/);
  assert.match(page, /Excel 다운로드/);
  assert.match(page, /견적 수정/);
  assert.doesNotMatch(page, /원본 보존 후 수정/);
  assert.match(page, /currentQuotes/);
  assert.doesNotMatch(page, /openQuotation\(quote, "copy"\)/);
  assert.doesNotMatch(page, /openQuotation\(quote, "revision"\)/);
  assert.doesNotMatch(page, />복사<\/button>/);
});

test("quotation and settlement PDF actions use compact download menus", () => {
  assert.match(page, /function downloadBlob/);
  assert.match(page, /async function downloadSavedPdf/);
  assert.match(page, /async function downloadConsortiumSettlementPdf/);
  assert.match(page, /quotation-output-menu/);
  assert.match(page, /견적서 PDF/);
  assert.match(page, /정산서 출력·다운로드/);
  assert.match(page, /정산서 PDF 다운로드/);
  assert.match(styles, /quotation-output-menu-panel/);
});

test("legacy revision lineage stays readable while current direct edits refresh files", () => {
  assert.match(store, /revision_root_id/);
  assert.match(store, /revision_parent_id/);
  assert.match(store, /revision_number/);
  assert.match(store, /COALESCE\(MAX\(revision_number\), 0\)/);
  assert.match(store, /revisionNumber > 0 \? `수정\$\{revisionNumber\}` : "원본"/);
  assert.match(store, /drive_sync_status=\?/);
  assert.match(store, /drive_sync_token=\?/);
  assert.doesNotMatch(store, /최종 견적서는 덮어쓸 수 없습니다/);
  assert.match(migration, /authored_quotations_revision_idx/);
});

test("final save queues PDF and Excel while Drive finalization protects the newest edit", () => {
  assert.match(page, /createAuthoredQuotationPdf/);
  assert.match(page, /quotationWorkbookFile/);
  assert.match(page, /formData\.set\("pdf", pdf\)/);
  assert.match(page, /formData\.set\("xlsx", xlsx\)/);
  assert.match(page, /견적 내용은 저장됐습니다\. PDF·Excel을 안전하게 처리하고 있습니다/);
  assert.match(page, /void processQuotationFiles\(payload\.quotation, sourceFile\)/);
  assert.match(page, /driveSyncStatus === "queued"/);
  assert.match(page, /파일 재시도/);
  assert.match(page, /whizzup:quotation-files-updated/);
  assert.match(filesRoute, /uploadDriveFile/);
  assert.match(filesRoute, /drive_sync_token=\?/);
  assert.match(filesRoute, /WHERE id=\? AND drive_sync_token=\?/);
  assert.match(filesRoute, /Promise\.all/);
  assert.match(filesRoute, /QUOTATION_LIBRARY_FOLDER/);
  assert.match(filesRoute, /quotationInstitutionFolderSegments/);
  assert.match(filesRoute, /upsertDriveFileByContext/);
  assert.match(filesRoute, /SET status='final'/);
  assert.match(filesRoute, /kind === "pdf" \? "inline" : "attachment"/);
  assert.match(backup, /"revision_root_id"/);
  assert.match(backup, /"drive_pdf_file_id"/);
  assert.match(backup, /"drive_xlsx_file_id"/);
  assert.match(backup, /"drive_sync_token"/);
});

test("generated Drive file names and PDF use one canonical quotation name", () => {
  assert.match(pdf, /quotationDownloadName/);
  assert.match(pdf, /PDF_RENDER_SCALE = 2/);
  assert.match(pdf, /context\.scale\(PDF_RENDER_SCALE, PDF_RENDER_SCALE\)/);
  assert.match(pdf, /%PDF-1\.4/);
  assert.match(pdf, /식별번호/);
  assert.match(pdf, /견적 조건 및 특이사항/);
  assert.match(pdf, /금액 요약/);
});

test("existing Drive quotation files are renamed and moved in place", () => {
  assert.match(reorganizeRoute, /requireAdminMember/);
  assert.match(reorganizeRoute, /organizeDriveFile/);
  assert.match(reorganizeRoute, /QUOTATION_LIBRARY_FOLDER/);
  assert.match(reorganizeRoute, /quotationInstitutionFolderSegments/);
  assert.match(reorganizeRoute, /syncDriveFileCopyFromSource/);
  assert.match(reorganizeRoute, /removeEmptyQuotationFolderChain/);
  assert.doesNotMatch(reorganizeRoute, /removeDriveFile/);
});

test("institution detail keeps final quotations once and shows only legacy external reference files below", () => {
  assert.match(crm, /<OrganizationQuotationHistory[\s\S]*?readOnly/);
  assert.match(crm, /canManageExternalQuotations=\{false\}/);
  assert.doesNotMatch(crm, /<QuotationManagementPage[\s\S]*?embedded/);
  assert.match(documents, /외부 원본·참고 파일/);
  assert.match(documents, /첨부된 외부 원본/);
  assert.doesNotMatch(documents, /시스템 작성 견적서/);
  assert.doesNotMatch(documents, /setAuthoredPreview/);
  assert.doesNotMatch(documents, /fetch\(\s*`\/api\/quotations\?organization=/);
  assert.match(documents, /!canManageExternalQuotations && \(loading \|\| \(documents\.length === 0 && !error\)\)/);
});

test("institution quotation cards remove horizontal scrolling and keep generated files in history only", () => {
  assert.match(page, /quotation-row-facts/);
  assert.doesNotMatch(page, /quotation-list-head/);
  assert.match(styles, /\.quotation-list\{display:grid/);
  assert.doesNotMatch(styles, /\.quotation-list\{overflow-x:auto/);
  assert.doesNotMatch(documents, /quotation-system-thumbnail/);
  assert.doesNotMatch(documents, /quotation-system-preview-frame/);
  assert.doesNotMatch(documents, /renderStoredPdfPreviewPages/);
  assert.doesNotMatch(documents, /onOpenAuthoredQuotation/);
  assert.match(page, /저장된 PDF 파일이 없습니다/);
  assert.doesNotMatch(page, /const saved = await storeQuotationFiles\(quote\)/);
});

test("quotation deletion uses a recoverable trash before Drive-backed permanent removal", () => {
  assert.match(page, /휴지통/);
  assert.match(page, /restoreQuotation/);
  assert.match(page, /purgeQuotation/);
  assert.match(store, /trashAuthoredQuotation/);
  assert.match(store, /수정본이 있는 원본/);
  assert.match(quotationsRoute, /action === "restore"/);
  assert.match(quotationsRoute, /action === "purge"/);
  assert.match(quotationsRoute, /removeDriveFile/);
  assert.match(trashMigration, /deleted_at/);
  assert.match(trashMigration, /authored_quotations_deleted_idx/);
});

test("quotation editor uses internal history and Drive finalization is idempotent", () => {
  assert.match(page, /whizzupQuotationEditor/);
  assert.match(page, /window\.history\.pushState/);
  assert.match(page, /window\.addEventListener\("popstate"/);
  assert.match(page, /등록 품목으로 견적 만들기/);
  assert.match(page, /현재 기관 빈 견적 만들기/);
  assert.match(filesRoute, /drive_sync_status='uploading'/);
  assert.match(filesRoute, /같은 견적서 파일을 이미 저장하고 있습니다/);
});

test("quotation reconciliation archives only unlinked duplicate Drive outputs", () => {
  assert.match(quotationReconcileRoute, /requireAdminMember/);
  assert.match(quotationReconcileRoute, /file\.appProperties\?\.contextId !== contextId/);
  assert.match(quotationReconcileRoute, /file\.id === expectedId/);
  assert.match(quotationReconcileRoute, /archiveDriveFile\(file\.id, "중복 견적서"\)/);
  assert.match(page, /fetch\("\/api\/quotations\/reconcile", \{ method: "POST" \}\)/);
});
