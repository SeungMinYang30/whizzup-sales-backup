import {
  accessErrorResponse,
  requireAdminMember,
} from "../../../../../lib/collaboration";
import { ensureAuthoredQuotationsReady } from "../../../../../lib/authored-quotations";
import {
  getDriveFileMetadata,
  isGoogleDriveConfigured,
  organizeDriveFile,
  removeEmptyQuotationFolderChain,
} from "../../../../../lib/google-drive-storage";
import {
  QUOTATION_LIBRARY_FOLDER,
  quotationDownloadName,
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

    for (const row of rows.results) {
      const quotationId = Number(row.id);
      const region = await regionFor(d1, row);
      const input = nameInput(row, region);
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

      for (const file of files) {
        try {
          const metadata = await getDriveFileMetadata(file.id);
          for (const parent of metadata.parents || []) oldParentIds.add(parent);
          const alreadyInTargetName = String(metadata.name || "") === file.desiredName;
          if (dryRun) {
            if (!alreadyInTargetName) renamed += 1;
            continue;
          }
          const organized = await organizeDriveFile(
            file.id,
            [QUOTATION_LIBRARY_FOLDER],
            file.desiredName,
          );
          if (!organized.previousParents.includes(organized.destinationFolderId)) moved += 1;
          if (organized.previousName !== organized.name) renamed += 1;
          savedNames[file.kind as keyof typeof savedNames] = organized.name;
        } catch (error) {
          failures.push({
            quotationId,
            kind: file.kind,
            error: (error instanceof Error ? error.message : "파일 정리 실패").slice(0, 300),
          });
        }
      }

      if (!dryRun) {
        await d1.prepare(`UPDATE authored_quotations
          SET drive_pdf_name=?, drive_xlsx_name=?, source_file_name=?, updated_at=CURRENT_TIMESTAMP
          WHERE id=?`)
          .bind(savedNames.pdf, savedNames.xlsx, savedNames.source, quotationId)
          .run();
      }
    }

    let removedFolders = 0;
    if (!dryRun) {
      for (const folderId of oldParentIds) {
        removedFolders += await removeEmptyQuotationFolderChain(folderId).catch(() => 0);
      }
    }

    const nextAfterId = rows.results.length
      ? Number(rows.results[rows.results.length - 1]?.id) || afterId
      : afterId;
    return Response.json({
      dryRun,
      quotations: rows.results.length,
      files: rows.results.reduce((sum, row) => sum + [row.drive_pdf_file_id, row.drive_xlsx_file_id, row.source_file_id].filter(Boolean).length, 0),
      moved,
      renamed,
      removedFolders,
      failures,
      folder: QUOTATION_LIBRARY_FOLDER,
      nextAfterId,
      done: rows.results.length < BATCH_SIZE,
    }, { status: failures.length ? 207 : 200 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
