import {
  accessErrorResponse,
  requireAdminMember,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import {
  authoredQuotationFromRow,
  ensureAuthoredQuotationsReady,
} from "../../../../lib/authored-quotations";
import {
  downloadDriveFile,
  isGoogleDriveConfigured,
  removeDriveFile,
  safeDriveFolderName,
  uploadDriveFile,
} from "../../../../lib/google-drive-storage";
import { quotationDownloadName } from "../../../../lib/quotation-file-name";

export const dynamic = "force-dynamic";

function quotationId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function cleanError(error: unknown) {
  return (error instanceof Error ? error.message : "Google Drive에 견적서를 저장하지 못했습니다.")
    .trim()
    .slice(0, 500);
}

async function findRow(id: number) {
  const d1 = await ensureAuthoredQuotationsReady();
  const row = await d1
    .prepare("SELECT * FROM authored_quotations WHERE id=? AND deleted_at = ''")
    .bind(id)
    .first<Record<string, unknown>>();
  return { d1, row };
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const params = new URL(request.url).searchParams;
    const id = quotationId(params.get("id"));
    const requestedKind = params.get("kind");
    const kind = requestedKind === "xlsx" || requestedKind === "source" ? requestedKind : "pdf";
    if (!id) return Response.json({ error: "올바른 견적서 ID가 필요합니다." }, { status: 400 });
    const { row } = await findRow(id);
    if (!row) return Response.json({ error: "견적서를 찾지 못했습니다." }, { status: 404 });
    const idColumn = kind === "pdf" ? "drive_pdf_file_id" : kind === "xlsx" ? "drive_xlsx_file_id" : "source_file_id";
    const nameColumn = kind === "pdf" ? "drive_pdf_name" : kind === "xlsx" ? "drive_xlsx_name" : "source_file_name";
    const fileId = String(row[idColumn] ?? "");
    const storedFileName = String(row[nameColumn] ?? "")
      || `${String(row.quote_number ?? "견적서")}.${kind === "pdf" ? "pdf" : "xlsx"}`;
    const fileName = kind === "source" ? storedFileName : quotationDownloadName({
      organization: row.organization,
      projectTitle: row.project_title,
      quoteDate: row.quote_date,
      quoteNumber: row.quote_number,
      revisionNumber: row.revision_number,
    }, kind);
    if (!fileId) return Response.json({ error: "Google Drive에 저장된 견적서 파일이 없습니다." }, { status: 404 });
    const stored = await downloadDriveFile(fileId);
    const contentType = kind === "pdf"
      ? "application/pdf"
      : kind === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : String(row.source_file_type ?? "") || (fileName.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return new Response(stored.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${kind === "pdf" ? "inline" : "attachment"}; filename="quotation.${kind === "pdf" ? "pdf" : "xlsx"}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const uploadedFileIds: string[] = [];
  let id = 0;
  try {
    await requireApprovedMember();
    if (!isGoogleDriveConfigured()) {
      return Response.json({ error: "Google Drive 자료실 연결 정보가 등록되지 않았습니다." }, { status: 503 });
    }
    const formData = await request.formData();
    id = quotationId(formData.get("quotationId"));
    const pdf = formData.get("pdf");
    const xlsx = formData.get("xlsx");
    const sourceCandidate = formData.get("sourceFile");
    const sourceFile = sourceCandidate instanceof File && sourceCandidate.size > 0 ? sourceCandidate : null;
    const replaceExisting = formData.get("replaceExisting") === "true";
    if (replaceExisting) await requireAdminMember();
    if (!id) return Response.json({ error: "올바른 견적서 ID가 필요합니다." }, { status: 400 });
    if (!(pdf instanceof File) || !pdf.name.toLowerCase().endsWith(".pdf") || pdf.size < 1 || pdf.size > 20 * 1024 * 1024) {
      return Response.json({ error: "PDF 견적서는 20MB 이하 파일만 저장할 수 있습니다." }, { status: 400 });
    }
    if (!(xlsx instanceof File) || !xlsx.name.toLowerCase().endsWith(".xlsx") || xlsx.size < 1 || xlsx.size > 20 * 1024 * 1024) {
      return Response.json({ error: "Excel 견적서는 20MB 이하 XLSX 파일만 저장할 수 있습니다." }, { status: 400 });
    }
    if (await pdf.slice(0, 5).text() !== "%PDF-") {
      return Response.json({ error: "생성된 PDF 견적서 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const xlsxSignature = new Uint8Array(await xlsx.slice(0, 2).arrayBuffer());
    if (xlsxSignature[0] !== 0x50 || xlsxSignature[1] !== 0x4b) {
      return Response.json({ error: "생성된 Excel 견적서 형식이 올바르지 않습니다." }, { status: 400 });
    }
    if (sourceFile) {
      const sourceName = sourceFile.name.toLowerCase();
      if ((!sourceName.endsWith(".pdf") && !sourceName.endsWith(".xlsx")) || sourceFile.size > 20 * 1024 * 1024) {
        return Response.json({ error: "참고 원본은 20MB 이하 PDF 또는 XLSX 파일만 저장할 수 있습니다." }, { status: 400 });
      }
      if (sourceName.endsWith(".pdf") && await sourceFile.slice(0, 5).text() !== "%PDF-") {
        return Response.json({ error: "참고 원본 PDF 형식이 올바르지 않습니다." }, { status: 400 });
      }
      if (sourceName.endsWith(".xlsx")) {
        const signature = new Uint8Array(await sourceFile.slice(0, 2).arrayBuffer());
        if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
          return Response.json({ error: "참고 원본 Excel 형식이 올바르지 않습니다." }, { status: 400 });
        }
      }
    }

    const { d1, row } = await findRow(id);
    if (!row) return Response.json({ error: "견적서를 찾지 못했습니다." }, { status: 404 });
    const existingPdfId = String(row.drive_pdf_file_id ?? "");
    const existingXlsxId = String(row.drive_xlsx_file_id ?? "");
    const existingSourceId = String(row.source_file_id ?? "");
    if (!replaceExisting && row.status === "final" && existingPdfId && existingXlsxId && !sourceFile) {
      return Response.json({ quotation: authoredQuotationFromRow(row) });
    }
    const lock = await d1.prepare(`UPDATE authored_quotations
      SET drive_sync_status='uploading', drive_sync_error='', updated_at=CURRENT_TIMESTAMP
      WHERE id=?
        AND (drive_sync_status <> 'uploading' OR updated_at < datetime('now', '-10 minutes'))`)
      .bind(id)
      .run();
    if (Number(lock.meta.changes) !== 1) {
      const latest = await d1
        .prepare("SELECT * FROM authored_quotations WHERE id=?")
        .bind(id)
        .first<Record<string, unknown>>();
      if (latest?.status === "final" && latest.drive_pdf_file_id && latest.drive_xlsx_file_id) {
        return Response.json({ quotation: authoredQuotationFromRow(latest) });
      }
      return Response.json(
        { error: "같은 견적서 파일을 이미 저장하고 있습니다. 잠시 후 목록을 새로고침해 주세요." },
        { status: 409 },
      );
    }

    const regionRow = await d1
      .prepare(`SELECT region FROM activities
        WHERE organization = ? AND business_round = ? AND TRIM(region) <> ''
        ORDER BY updated_at DESC, id DESC LIMIT 1`)
      .bind(String(row.organization ?? ""), Math.max(1, Number(row.business_round) || 1))
      .first<{ region: string }>();
    const folderSegments = [
      "01_기관자료",
      safeDriveFolderName(regionRow?.region, "지역 미분류"),
      safeDriveFolderName(row.organization, "기관 미분류"),
      "견적서",
      String(row.quote_date ?? new Date().getFullYear()).slice(0, 4),
    ];
    const contextId = `${String(row.organization ?? "")}|${Math.max(1, Number(row.business_round) || 1)}|${id}`;
    const storedPdf = await uploadDriveFile({
      file: pdf,
      folderSegments,
      contextType: "authored-quotation-pdf",
      contextId,
    });
    uploadedFileIds.push(storedPdf.fileId);
    const storedXlsx = await uploadDriveFile({
      file: xlsx,
      folderSegments,
      contextType: "authored-quotation-xlsx",
      contextId,
    });
    uploadedFileIds.push(storedXlsx.fileId);
    const storedSource = sourceFile ? await uploadDriveFile({
      file: sourceFile,
      folderSegments: [...folderSegments, "참고 원본"],
      contextType: "authored-quotation-source",
      contextId,
    }) : null;
    if (storedSource) uploadedFileIds.push(storedSource.fileId);

    await d1.prepare(`UPDATE authored_quotations
      SET status='final', drive_pdf_file_id=?, drive_pdf_name=?,
          drive_xlsx_file_id=?, drive_xlsx_name=?, source_file_id=?, source_file_name=?, source_file_type=?, drive_sync_status='ready',
          drive_sync_error='', updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .bind(
        storedPdf.fileId,
        pdf.name.slice(0, 240),
        storedXlsx.fileId,
        xlsx.name.slice(0, 240),
        storedSource?.fileId || existingSourceId,
        sourceFile?.name.slice(0, 240) || String(row.source_file_name ?? ""),
        sourceFile?.type || String(row.source_file_type ?? ""),
        id,
      )
      .run();
    for (const oldId of [existingPdfId, existingXlsxId, ...(storedSource ? [existingSourceId] : [])]) {
      if (oldId && !uploadedFileIds.includes(oldId)) await removeDriveFile(oldId).catch(() => undefined);
    }
    uploadedFileIds.length = 0;
    const saved = await d1
      .prepare("SELECT * FROM authored_quotations WHERE id=?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!saved) throw new Error("저장한 견적서를 다시 불러오지 못했습니다.");
    return Response.json({ quotation: authoredQuotationFromRow(saved) });
  } catch (error) {
    for (const fileId of uploadedFileIds) await removeDriveFile(fileId).catch(() => undefined);
    if (id) {
      const message = cleanError(error);
      await ensureAuthoredQuotationsReady()
        .then((d1) => d1.prepare("UPDATE authored_quotations SET drive_sync_status='error', drive_sync_error=? WHERE id=?").bind(message, id).run())
        .catch(() => undefined);
    }
    return accessErrorResponse(error);
  }
}
