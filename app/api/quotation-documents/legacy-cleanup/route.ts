import { accessErrorResponse, requirePrimaryOwner } from "../../../../lib/collaboration";
import {
  ensureQuotationDocumentsReady,
  getQuotationBucket,
  parseStoredStringList,
  quotationStorageStats,
  type QuotationDocumentRow,
} from "../../../../lib/quotation-documents";
import {
  driveFileIdFromKey,
  removeDriveFile,
} from "../../../../lib/google-drive-storage";

export const dynamic = "force-dynamic";

async function loadLegacyDocuments() {
  const d1 = await ensureQuotationDocumentsReady();
  const result = await d1
    .prepare(
      `SELECT * FROM quotation_documents
       ORDER BY organization ASC, business_round ASC, quote_date DESC, id DESC`,
    )
    .all<QuotationDocumentRow>();
  return { d1, rows: result.results };
}

export async function GET() {
  try {
    await requirePrimaryOwner();
    const { rows } = await loadLegacyDocuments();
    return Response.json({
      count: rows.length,
      documents: rows.map((row) => ({
        id: row.id,
        organization: row.organization,
        businessRound: row.business_round,
        originalName: row.original_name,
        quoteDate: row.quote_date,
        driveBacked: Boolean(driveFileIdFromKey(row.original_key)),
      })),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    await requirePrimaryOwner();
    const { d1, rows } = await loadLegacyDocuments();
    const bucket = getQuotationBucket();
    const failures: Array<{ id: number; organization: string; error: string }> = [];
    let deleted = 0;

    for (const row of rows) {
      try {
        const driveFileId = driveFileIdFromKey(row.original_key);
        if (driveFileId) {
          await removeDriveFile(driveFileId);
        }

        const objectKeys = [
          ...(!driveFileId && row.original_key ? [row.original_key] : []),
          ...parseStoredStringList(row.page_keys_json),
        ];
        if (objectKeys.length) await bucket.delete(objectKeys);

        await d1.prepare("DELETE FROM quotation_documents WHERE id = ?").bind(row.id).run();
        deleted += 1;
      } catch (error) {
        failures.push({
          id: row.id,
          organization: row.organization,
          error: error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.",
        });
      }
    }

    return Response.json({
      ok: failures.length === 0,
      requested: rows.length,
      deleted,
      failures,
      storage: await quotationStorageStats(d1),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
