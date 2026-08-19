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
const quotationDownloads = await readFile(new URL("../app/authored-quotation-downloads.ts", import.meta.url), "utf8");
const quotationHistory = await readFile(new URL("../app/organization-quotation-history.tsx", import.meta.url), "utf8");

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
  assert.match(page, /setQuotationFileJobVersion\(\(version\) => version \+ 1\)/);
  assert.match(page, /item\.driveSyncToken === quote\.driveSyncToken[\s\S]*driveSyncStatus: "error"/);
  const processingBody = page.slice(
    page.indexOf("async function processQuotationFiles"),
    page.indexOf("async function viewSavedPdf"),
  );
  assert.doesNotMatch(processingBody, /await load\(\)/);
  assert.match(page, /whizzup:quotation-files-updated/);
  assert.match(page, /pendingQuotationFileSignature/);
  assert.match(page, /refreshPendingQuotationRows/);
  assert.match(page, /window\.setInterval\(\(\) => \{ void refreshPendingQuotationRows\(\); \}, 2_000\)/);
  const pendingRefreshBody = page.slice(
    page.indexOf("const pendingQuotationFileSignature"),
    page.indexOf("quotes\n      .filter", page.indexOf("const pendingQuotationFileSignature")),
  );
  assert.doesNotMatch(pendingRefreshBody, /setLoading|setQuery|setQuotationPage|await load\(\)/);
  assert.match(filesRoute, /uploadDriveFile/);
  assert.match(filesRoute, /drive_sync_token=\?/);
  assert.match(filesRoute, /WHERE id=\? AND drive_sync_token=\?/);
  assert.match(filesRoute, /Promise\.all/);
  assert.match(filesRoute, /QUOTATION_LIBRARY_FOLDER/);
  assert.match(filesRoute, /quotationInstitutionFolderSegments/);
  assert.match(filesRoute, /upsertDriveFileByContext/);
  assert.match(filesRoute, /SET status='final'/);
  assert.match(store, /authoredQuotationFromRowForMember/);
  assert.match(filesRoute, /authoredQuotationFromRowForMember\(saved, member\)/);
  assert.match(filesRoute, /authoredQuotationFromRowForMember\(latest, member\)/);
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

test("saved quotation downloads regenerate from current data when Drive is unavailable", () => {
  assert.match(page, /storedQuotationFile\(quote\.pdfUrl/);
  assert.match(page, /await createAuthoredQuotationPdf\(quote\)/);
  assert.match(page, /await quotationWorkbookFile\(quote\)/);
  assert.match(page, /저장소 연결이 원활하지 않아 현재 최종 견적 내용으로/);
  assert.match(quotationDownloads, /createAuthoredQuotationWorkbookFile/);
  assert.match(quotationDownloads, /createQuotationWorkbook/);
  assert.match(quotationHistory, /downloadQuotationPdf/);
  assert.match(quotationHistory, /downloadQuotationExcel/);
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

test("retroactive quotation refresh validates replacements and preserves Drive file ids", () => {
  assert.match(page, /기존 PDF·Excel 일괄 갱신/);
  assert.match(page, /storeQuotationFiles\(quote, \{ replaceExisting: true \}\)/);
  assert.match(page, /Google Drive 파일 ID와 공유 링크, 견적 수정일은 유지됩니다/);
  assert.match(filesRoute, /replaceDriveFile/);
  assert.match(filesRoute, /authored-quotation-pdf-replacement-temp/);
  assert.match(filesRoute, /authored-quotation-xlsx-replacement-temp/);
  assert.match(filesRoute, /validateStagedFile/);
  assert.match(filesRoute, /bytes\.length !== expectedSize/);
  assert.match(filesRoute, /SET updated_at=\? WHERE id=\? AND drive_sync_token=\?/);
});

test("quotation outputs separate procurement fees from the product VAT reference", () => {
  assert.match(page, /<dt>품목금액<\/dt><dd>VAT 포함<\/dd>/);
  assert.match(page, /<dt>조달수수료<\/dt><dd>별도<\/dd>/);
  assert.match(page, /<dt>공급가액<\/dt><dd>품목금액 기준<\/dd>/);
  assert.match(page, /<dt>부가가치세<\/dt><dd>품목금액 기준<\/dd>/);
  assert.match(pdf, /label: "공급가액", qualifier: "품목금액 기준"/);
  assert.match(pdf, /label: "부가가치세", qualifier: "품목금액 기준"/);
  assert.match(pdf, /표시 단가는 VAT·일반 수수료 포함, 조달수수료는 합계에 별도 반영/);
  assert.match(pdf, /\["담당", "위즈업 영업팀"\]/);
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
