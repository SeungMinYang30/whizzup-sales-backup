import {
  accessErrorResponse,
  requireAdminMember,
} from "../../../../lib/collaboration";
import { ensureAuthoredQuotationsReady } from "../../../../lib/authored-quotations";
import {
  archiveDriveFile,
  ensureDrivePath,
  isGoogleDriveConfigured,
  listDriveChildren,
  safeDriveFolderName,
} from "../../../../lib/google-drive-storage";

export const dynamic = "force-dynamic";

type QuotationFileRow = {
  id: number;
  organization: string;
  business_round: number;
  quote_date: string;
  drive_pdf_file_id: string;
  drive_xlsx_file_id: string;
  region: string;
};

export async function POST() {
  try {
    await requireAdminMember();
    if (!isGoogleDriveConfigured()) {
      return Response.json({ error: "Google Drive 자료실 연결 정보가 등록되지 않았습니다." }, { status: 503 });
    }

    const d1 = await ensureAuthoredQuotationsReady();
    const rows = await d1.prepare(`SELECT q.id, q.organization, q.business_round, q.quote_date,
        q.drive_pdf_file_id, q.drive_xlsx_file_id,
        COALESCE((SELECT region FROM activities a
          WHERE a.organization=q.organization AND a.business_round=q.business_round AND TRIM(a.region) <> ''
          ORDER BY a.updated_at DESC, a.id DESC LIMIT 1), '') AS region
      FROM authored_quotations q
      WHERE q.drive_pdf_file_id <> '' OR q.drive_xlsx_file_id <> ''`)
      .all<QuotationFileRow>();

    const folderFiles = new Map<string, Awaited<ReturnType<typeof listDriveChildren>>>();
    let archived = 0;
    for (const row of rows.results) {
      const folderSegments = [
        "01_기관자료",
        safeDriveFolderName(row.region, "지역 미분류"),
        safeDriveFolderName(row.organization, "기관 미분류"),
        "견적서",
        String(row.quote_date || new Date().getFullYear()).slice(0, 4),
      ];
      const folderKey = folderSegments.join("/");
      let files = folderFiles.get(folderKey);
      if (!files) {
        const folderId = await ensureDrivePath(folderSegments);
        files = await listDriveChildren(folderId);
        folderFiles.set(folderKey, files);
      }
      const contextId = `${row.organization}|${Math.max(1, Number(row.business_round) || 1)}|${row.id}`;
      for (const file of files) {
        if (file.appProperties?.contextId !== contextId) continue;
        const type = file.appProperties?.contextType;
        const expectedId = type === "authored-quotation-pdf"
          ? row.drive_pdf_file_id
          : type === "authored-quotation-xlsx"
            ? row.drive_xlsx_file_id
            : "";
        if (!expectedId || file.id === expectedId) continue;
        await archiveDriveFile(file.id, "중복 견적서");
        archived += 1;
      }
    }
    return Response.json({ archived });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
