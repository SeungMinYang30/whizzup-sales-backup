import {
  accessErrorResponse,
  requireAdminMember,
} from "../../../../lib/collaboration";
import { ensureAuthoredQuotationsReady } from "../../../../lib/authored-quotations";
import {
  ensureDrivePath,
  getDriveFileMetadata,
  isGoogleDriveConfigured,
  listDriveChildren,
  moveDriveFilesTransaction,
  pruneEmptyDriveFolderTree,
  pruneDriveMoveSources,
  removeDriveFile,
  renameDriveFile,
  safeDriveFolderName,
} from "../../../../lib/google-drive-storage";
import { quotationFileStem } from "../../../../lib/quotation-file-name";

export const dynamic = "force-dynamic";

type QuotationFileRow = {
  id: number;
  organization: string;
  business_round: number;
  quote_date: string;
  quote_number: string;
  revision_number: number;
  drive_pdf_file_id: string;
  drive_pdf_name: string;
  drive_xlsx_file_id: string;
  drive_xlsx_name: string;
  source_file_id: string;
  region: string;
};

const authoredFileTypes = new Set([
  "authored-quotation-pdf",
  "authored-quotation-xlsx",
  "authored-quotation-source",
]);

export async function POST() {
  try {
    await requireAdminMember();
    if (!isGoogleDriveConfigured()) {
      return Response.json({ error: "Google Drive 자료실 연결 정보가 등록되지 않았습니다." }, { status: 503 });
    }

    const d1 = await ensureAuthoredQuotationsReady();
    const rows = await d1.prepare(`SELECT q.id, q.organization, q.business_round, q.quote_date,
        q.quote_number, q.revision_number,
        q.drive_pdf_file_id, q.drive_pdf_name, q.drive_xlsx_file_id, q.drive_xlsx_name,
        q.source_file_id,
        COALESCE((SELECT region FROM activities a
          WHERE a.organization=q.organization AND a.business_round=q.business_round AND TRIM(a.region) <> ''
          ORDER BY a.updated_at DESC, a.id DESC LIMIT 1), '') AS region
      FROM authored_quotations q
      WHERE q.drive_pdf_file_id <> '' OR q.drive_xlsx_file_id <> '' OR q.source_file_id <> ''`)
      .all<QuotationFileRow>();

    const referencedFileIds = new Set<string>();
    const foldersToScan = new Map<string, string>();
    let moved = 0;
    let renamed = 0;

    for (const row of rows.results) {
      const folderSegments = [
        "01_기관자료",
        safeDriveFolderName(row.region, "지역 미분류"),
        safeDriveFolderName(row.organization, "기관 미분류"),
        "견적서",
        String(row.quote_date || new Date().getFullYear()).slice(0, 4),
      ];
      const sourceFolderSegments = [...folderSegments, "참고 원본"];
      const folderId = await ensureDrivePath(folderSegments);
      foldersToScan.set(folderSegments.join("/"), folderId);
      if (row.source_file_id) {
        const sourceFolderId = await ensureDrivePath(sourceFolderSegments);
        foldersToScan.set(sourceFolderSegments.join("/"), sourceFolderId);
      }

      const stem = quotationFileStem({
        organization: row.organization,
        businessRound: row.business_round,
        quoteNumber: row.quote_number,
        revisionNumber: row.revision_number,
      });
      const files = [
        { id: row.drive_pdf_file_id, folderSegments, expectedName: `${stem}.pdf`, nameColumn: "drive_pdf_name" },
        { id: row.drive_xlsx_file_id, folderSegments, expectedName: `${stem}.xlsx`, nameColumn: "drive_xlsx_name" },
        { id: row.source_file_id, folderSegments: sourceFolderSegments, expectedName: "", nameColumn: "" },
      ].filter((file) => file.id);

      for (const file of files) {
        referencedFileIds.add(file.id);
        if (file.id.startsWith("postgres-object:")) continue;
        const metadata = await getDriveFileMetadata(file.id).catch(() => null);
        if (!metadata) continue;
        const destinationFolderId = await ensureDrivePath(file.folderSegments);
        if (!(metadata.parents ?? []).includes(destinationFolderId)) {
          const snapshots = await moveDriveFilesTransaction([{ fileId: file.id, folderSegments: file.folderSegments }]);
          moved += snapshots.length;
          await pruneDriveMoveSources(snapshots).catch(() => undefined);
        }
        if (file.expectedName && metadata.name !== file.expectedName) {
          await renameDriveFile(file.id, file.expectedName);
          await d1.prepare(`UPDATE authored_quotations SET ${file.nameColumn}=? WHERE id=?`)
            .bind(file.expectedName, row.id)
            .run();
          renamed += 1;
        }
      }
    }

    let removed = 0;
    for (const folderId of foldersToScan.values()) {
      const files = await listDriveChildren(folderId);
      for (const file of files) {
        if (referencedFileIds.has(file.id)) continue;
        if (file.appProperties?.whizzup !== "1") continue;
        if (!authoredFileTypes.has(file.appProperties?.contextType || "")) continue;
        await removeDriveFile(file.id);
        removed += 1;
      }
    }
    const unclassifiedFolderId = await ensureDrivePath(["01_기관자료", "지역 미분류"]);
    const emptyFoldersRemoved = await pruneEmptyDriveFolderTree(unclassifiedFolderId).catch(() => 0);
    return Response.json({ moved, renamed, removed, emptyFoldersRemoved });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
