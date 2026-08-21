import {
  accessErrorResponse,
  requireAdminMember,
} from "../../../../../lib/collaboration";
import { ensureAuthoredQuotationsReady } from "../../../../../lib/authored-quotations";
import {
  getDriveFileMetadata,
  isGoogleDriveConfigured,
  listDriveFilesByContext,
  organizeDriveFile,
  removeEmptyLegacyQuotationFolders,
  removeEmptyQuotationFolderChain,
  syncDriveFileCopyFromSource,
} from "../../../../../lib/google-drive-storage";
import {
  QUOTATION_LIBRARY_FOLDER,
  QUOTATION_LIBRARY_FOLDER_SEGMENTS,
  QUOTATION_LIBRARY_PATH,
  quotationDownloadName,
  quotationInstitutionFolderSegments,
  quotationSourceFileName,
} from "../../../../../lib/quotation-file-name";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type QuotationRow = Record<string, unknown>;
const BATCH_SIZE = 5;

async function regionFor(
  d1: Awaited<ReturnType<typeof ensureAuthoredQuotationsReady>>,
  row: QuotationRow,
) {
  const match = await d1
    .prepare(`SELECT region FROM activities
      WHERE organization = ? AND business_round = ? AND TRIM(region) <> ''
      ORDER BY updated_at DESC, id DESC LIMIT 1`)
    .bind(String(row.organization ?? ""), Math.max(1, Number(row.business_round) || 1))
    .first<{ region: string }>();
  return String(match?.region || "");
}

function nameInput(row: QuotationRow, region: string) {
  return {
    region,
    organization: row.organization,
    businessRound: row.business_round,
    projectTitle: row.project_title,
    quoteDate: row.quote_date,
    quoteNumber: row.quote_number,
    revisionNumber: row.revision_number,
  };
}

export async function POST(request: Request) {
  try {
    await requireAdminMember();
    if (!isGoogleDriveConfigured()) {
      return Response.json({ error: "Google Drive 자료실 연결 정보가 등록되지 않았습니다." }, { status: 503 });
    }
    const payload = await request.json().catch(() => ({})) as { dryRun?: boolean; afterId?: number };
    const dryRun = payload.dryRun === true;
    const afterId = Math.max(0, Number(payload.afterId) || 0);
    const d1 = await ensureAuthoredQuotationsReady();
    const rows = await d1
      .prepare(`SELECT * FROM authored_quotations
        WHERE deleted_at = ''
          AND id > ?
          AND (drive_pdf_file_id <> '' OR drive_xlsx_file_id <> '' OR source_file_id <> '')
        ORDER BY id
        LIMIT ?`)
      .bind(afterId, BATCH_SIZE)
      .all<QuotationRow>();
    const oldParentIds = new Set<string>();
    const failures: Array<{ quotationId: number; kind: string; error: string }> = [];
    let moved = 0;
    let renamed = 0;
    let mirrored = 0;
    let checked = 0;
    let recoverable = 0;
    let recovered = 0;

    for (const row of rows.results) {
      const quotationId = Number(row.id);
      const region = await regionFor(d1, row);
      const input = nameInput(row, region);
      const institutionFolder = quotationInstitutionFolderSegments(input);
      const contextId = `${String(row.organization ?? "")}|${Math.max(1, Number(row.business_round) || 1)}|${quotationId}`;
      const files = [
        {
          kind: "pdf",
          id: String(row.drive_pdf_file_id || ""),
          currentName: String(row.drive_pdf_name || ""),
          desiredName: quotationDownloadName(input, "pdf"),
        },
        {
          kind: "xlsx",
          id: String(row.drive_xlsx_file_id || ""),
          currentName: String(row.drive_xlsx_name || ""),
          desiredName: quotationDownloadName(input, "xlsx"),
        },
        {
          kind: "source",
          id: String(row.source_file_id || ""),
          currentName: String(row.source_file_name || ""),
          desiredName: quotationSourceFileName(input, row.source_file_name || "원본.xlsx"),
        },
      ].filter((file) => file.id);
      const savedNames = {
        pdf: String(row.drive_pdf_name || ""),
        xlsx: String(row.drive_xlsx_name || ""),
        source: String(row.source_file_name || ""),
      };
      const savedIds = {
        pdf: String(row.drive_pdf_file_id || ""),
        xlsx: String(row.drive_xlsx_file_id || ""),
        source: String(row.source_file_id || ""),
      };

      for (const file of files) {
        try {
          let activeFileId = file.id;
          let metadata;
          try {
            metadata = await getDriveFileMetadata(activeFileId);
          } catch (missingError) {
            const mirror = (await listDriveFilesByContext({
              folderSegments: [...QUOTATION_LIBRARY_FOLDER_SEGMENTS],
              contextTypes: [`authored-quotation-${file.kind}-mirror`],
              contextId,
            }))[0];
            if (!mirror) throw missingError;
            recoverable += 1;
            if (dryRun) {
              checked += 1;
              continue;
            }
            const restored = await syncDriveFileCopyFromSource({
              sourceFileId: mirror.id,
              name: file.desiredName,
              folderSegments: institutionFolder,
              contextType: `authored-quotation-${file.kind}`,
              contextId,
            });
            activeFileId = restored.fileId;
            savedIds[file.kind as keyof typeof savedIds] = activeFileId;
            recovered += 1;
            metadata = await getDriveFileMetadata(activeFileId);
          }
          checked += 1;
          for (const parent of metadata.parents || []) oldParentIds.add(parent);
          const alreadyInTargetName = String(metadata.name || "") === file.desiredName;
          if (dryRun) {
            if (!alreadyInTargetName) renamed += 1;
            continue;
          }
          const organized = await organizeDriveFile(
            activeFileId,
            institutionFolder,
            file.desiredName,
          );
          if (!organized.previousParents.includes(organized.destinationFolderId)) moved += 1;
          if (organized.previousName !== organized.name) renamed += 1;
          savedNames[file.kind as keyof typeof savedNames] = organized.name;
          await syncDriveFileCopyFromSource({
            sourceFileId: activeFileId,
            name: organized.name,
            folderSegments: [...QUOTATION_LIBRARY_FOLDER_SEGMENTS],
            contextType: `authored-quotation-${file.kind}-mirror`,
            contextId,
          });
          mirrored += 1;
        } catch (error) {
          failures.push({
            quotationId,
            kind: file.kind,
            error: `${String(row.organization || "기관 미지정")} · ${Math.max(1, Number(row.business_round) || 1)}차 · ${String(row.quote_number || "번호 미등록")} · ${error instanceof Error ? error.message : "파일 정리 실패"}`.slice(0, 300),
          });
        }
      }

      if (!dryRun) {
        await d1.prepare(`UPDATE authored_quotations
          SET drive_pdf_file_id=?, drive_pdf_name=?, drive_xlsx_file_id=?, drive_xlsx_name=?, source_file_id=?, source_file_name=?
          WHERE id=?`)
          .bind(savedIds.pdf, savedNames.pdf, savedIds.xlsx, savedNames.xlsx, savedIds.source, savedNames.source, quotationId)
          .run();
      }
    }

    const nextAfterId = rows.results.length
      ? Number(rows.results[rows.results.length - 1]?.id) || afterId
      : afterId;
    const done = rows.results.length < BATCH_SIZE;
    let removedFolders = 0;
    if (!dryRun) {
      for (const folderId of oldParentIds) {
        removedFolders += await removeEmptyQuotationFolderChain(folderId).catch(() => 0);
      }
      if (done) {
        removedFolders += await removeEmptyLegacyQuotationFolders().catch(() => 0);
      }
    }

    return Response.json({
      dryRun,
      quotations: rows.results.length,
      files: rows.results.reduce((sum, row) => sum + [row.drive_pdf_file_id, row.drive_xlsx_file_id, row.source_file_id].filter(Boolean).length, 0),
      moved,
      renamed,
      mirrored,
      checked,
      recoverable,
      recovered,
      removedFolders,
      failures,
      folder: `01_기관자료/지역/기관/${QUOTATION_LIBRARY_FOLDER}/사업 차수/연도 + ${QUOTATION_LIBRARY_PATH}`,
      nextAfterId,
      done,
    }, { status: failures.length ? 207 : 200 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
