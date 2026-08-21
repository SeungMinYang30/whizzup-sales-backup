import { accessErrorResponse, requireAdminMember } from "../../../../lib/collaboration";
import {
  ensureQuotationDocumentsReady,
  parseStoredStringList,
  type QuotationDocumentRow,
} from "../../../../lib/quotation-documents";
import {
  driveFileIdFromKey,
  getDriveFileMetadata,
  isGoogleDriveConfigured,
  organizeDriveFile,
  removeEmptyQuotationFolderChain,
} from "../../../../lib/google-drive-storage";
import { quotationInstitutionFolderSegments } from "../../../../lib/quotation-file-name";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// A reference quotation can include up to 40 preview images, so move one
// document per request to keep every Drive batch within the function timeout.
const BATCH_SIZE = 1;

async function regionFor(
  d1: Awaited<ReturnType<typeof ensureQuotationDocumentsReady>>,
  row: QuotationDocumentRow,
) {
  const match = await d1.prepare(`SELECT region FROM activities
    WHERE organization = ? AND business_round = ? AND TRIM(region) <> ''
    ORDER BY updated_at DESC, id DESC LIMIT 1`)
    .bind(row.organization, Math.max(1, Number(row.business_round) || 1))
    .first<{ region: string }>();
  return String(match?.region || "");
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
    const d1 = await ensureQuotationDocumentsReady();
    const rows = await d1.prepare(`SELECT * FROM quotation_documents
      WHERE id > ?
      ORDER BY id
      LIMIT ?`)
      .bind(afterId, BATCH_SIZE)
      .all<QuotationDocumentRow>();
    const oldParentIds = new Set<string>();
    const failures: Array<{ quotationId: number; kind: string; error: string }> = [];
    let referenceFiles = 0;
    let checked = 0;
    let moved = 0;

    for (const row of rows.results) {
      const region = await regionFor(d1, row);
      const folderSegments = quotationInstitutionFolderSegments({
        region,
        organization: row.organization,
        businessRound: row.business_round,
        quoteDate: row.quote_date,
      });
      const files = [
        { kind: "original", id: driveFileIdFromKey(row.original_key), requestedName: row.original_name },
        ...parseStoredStringList(row.page_keys_json).map((key, index) => ({
          kind: `preview-${index + 1}`,
          id: driveFileIdFromKey(key),
          requestedName: `preview-${String(index + 1).padStart(3, "0")}.webp`,
        })),
      ].filter((file): file is { kind: string; id: string; requestedName: string } => Boolean(file.id));
      referenceFiles += files.length;

      for (const file of files) {
        try {
          const metadata = await getDriveFileMetadata(file.id);
          checked += 1;
          for (const parent of metadata.parents || []) oldParentIds.add(parent);
          if (dryRun) continue;
          const organized = await organizeDriveFile(
            file.id,
            folderSegments,
            file.kind === "original" ? file.requestedName : String(metadata.name || file.requestedName),
          );
          if (!organized.previousParents.includes(organized.destinationFolderId)) moved += 1;
        } catch (error) {
          failures.push({
            quotationId: row.id,
            kind: file.kind,
            error: `${row.organization} · ${Math.max(1, Number(row.business_round) || 1)}차 · ${row.original_name} · ${error instanceof Error ? error.message : "외부 참고 견적 파일 정리 실패"}`.slice(0, 300),
          });
        }
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
      quotations: 0,
      referenceDocuments: rows.results.length,
      files: 0,
      referenceFiles,
      checked,
      moved,
      renamed: 0,
      mirrored: 0,
      removedFolders,
      failures,
      folder: "01_기관자료/지역/기관/견적서/사업 차수/연도",
      nextAfterId,
      done: rows.results.length < BATCH_SIZE,
    }, { status: failures.length ? 207 : 200 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
