import {
  accessErrorResponse,
  requireAdminMember,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import {
  authoredQuotationFromRowForMember,
  ensureAuthoredQuotationsReady,
} from "../../../../lib/authored-quotations";
import {
  downloadDriveFile,
  isGoogleDriveConfigured,
  organizeDriveFile,
  removeDriveFile,
  replaceDriveFile,
  syncDriveFileCopyFromSource,
  upsertDriveFileByContext,
  uploadDriveFile,
} from "../../../../lib/google-drive-storage";
import {
  QUOTATION_LIBRARY_FOLDER_SEGMENTS,
  quotationInstitutionFolderSegments,
  quotationDownloadName,
  quotationSourceFileName,
} from "../../../../lib/quotation-file-name";

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

async function quotationRegion(
  d1: Awaited<ReturnType<typeof ensureAuthoredQuotationsReady>>,
  row: Record<string, unknown>,
) {
  const match = await d1
    .prepare(`SELECT region FROM activities
      WHERE organization = ? AND business_round = ? AND TRIM(region) <> ''
      ORDER BY updated_at DESC, id DESC LIMIT 1`)
    .bind(String(row.organization ?? ""), Math.max(1, Number(row.business_round) || 1))
    .first<{ region: string }>();
  return String(match?.region || "");
}

function namingInput(row: Record<string, unknown>, region: string) {
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

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const params = new URL(request.url).searchParams;
    const id = quotationId(params.get("id"));
    const requestedKind = params.get("kind");
    const kind = requestedKind === "xlsx" || requestedKind === "source" ? requestedKind : "pdf";
    if (!id) return Response.json({ error: "올바른 견적서 ID가 필요합니다." }, { status: 400 });
    const { d1, row } = await findRow(id);
    if (!row) return Response.json({ error: "견적서를 찾지 못했습니다." }, { status: 404 });
    const idColumn = kind === "pdf" ? "drive_pdf_file_id" : kind === "xlsx" ? "drive_xlsx_file_id" : "source_file_id";
    const nameColumn = kind === "pdf" ? "drive_pdf_name" : kind === "xlsx" ? "drive_xlsx_name" : "source_file_name";
    const fileId = String(row[idColumn] ?? "");
    const storedFileName = String(row[nameColumn] ?? "");
    const region = await quotationRegion(d1, row);
    const fileName = kind === "source"
      ? quotationSourceFileName(namingInput(row, region), storedFileName || "원본.xlsx")
      : quotationDownloadName(namingInput(row, region), kind);
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
  let replaceExisting = false;
  let syncToken = "";
  let originalUpdatedAt = "";
  try {
    const member = await requireApprovedMember();
    if (!isGoogleDriveConfigured()) {
      return Response.json({ error: "Google Drive 자료실 연결 정보가 등록되지 않았습니다." }, { status: 503 });
    }
    const formData = await request.formData();
    id = quotationId(formData.get("quotationId"));
    const pdf = formData.get("pdf");
    const xlsx = formData.get("xlsx");
    const sourceCandidate = formData.get("sourceFile");
    const sourceFile = sourceCandidate instanceof File && sourceCandidate.size > 0 ? sourceCandidate : null;
    const requestedSyncToken = String(formData.get("syncToken") ?? "").trim();
    replaceExisting = formData.get("replaceExisting") === "true";
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
    originalUpdatedAt = String(row.updated_at ?? "");
    syncToken = requestedSyncToken;
    if (replaceExisting) {
      syncToken = crypto.randomUUID();
      await d1.prepare("UPDATE authored_quotations SET drive_sync_status='queued', drive_sync_error='', drive_sync_token=? WHERE id=?")
        .bind(syncToken, id)
        .run();
    } else if (!syncToken || syncToken !== String(row.drive_sync_token ?? "")) {
      return Response.json({ error: "더 최신 견적 저장 작업이 있어 이전 파일 작업을 중단했습니다." }, { status: 409 });
    }
    const staleUploadBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const lock = await d1.prepare(`UPDATE authored_quotations
      SET drive_sync_status='uploading', drive_sync_error='', updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND drive_sync_token=?
        AND (drive_sync_status IN ('queued', 'error') OR (drive_sync_status='uploading' AND updated_at < ?))`)
      .bind(id, syncToken, staleUploadBefore)
      .run();
    if (Number(lock.meta.changes) !== 1) {
      const latest = await d1
        .prepare("SELECT * FROM authored_quotations WHERE id=?")
        .bind(id)
        .first<Record<string, unknown>>();
      if (latest?.drive_sync_token === syncToken && latest.drive_sync_status === "ready") {
        return Response.json({ quotation: authoredQuotationFromRowForMember(latest, member) });
      }
      return Response.json(
        { error: "같은 견적서 파일을 이미 저장하고 있습니다. 잠시 후 목록을 새로고침해 주세요." },
        { status: 409 },
      );
    }

    const region = await quotationRegion(d1, row);
    const nameInput = namingInput(row, region);
    const pdfName = quotationDownloadName(nameInput, "pdf");
    const xlsxName = quotationDownloadName(nameInput, "xlsx");
    const sourceName = sourceFile ? quotationSourceFileName(nameInput, sourceFile.name) : "";
    const folderSegments = quotationInstitutionFolderSegments(nameInput);
    const contextId = `${String(row.organization ?? "")}|${Math.max(1, Number(row.business_round) || 1)}|${id}`;
    async function storeFile(input: { file: File; contextType: string }) {
      const stored = await uploadDriveFile({
        file: input.file,
        folderSegments,
        contextType: input.contextType,
        contextId,
      });
      uploadedFileIds.push(stored.fileId);
      return stored;
    }
    async function validateStagedFile(fileId: string, kind: "pdf" | "xlsx", expectedSize: number) {
      const response = await downloadDriveFile(fileId);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const validSignature = kind === "pdf"
        ? new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
        : bytes[0] === 0x50 && bytes[1] === 0x4b;
      if (!validSignature || bytes.length !== expectedSize) {
        throw new Error(`${kind === "pdf" ? "PDF" : "Excel"} 교체 파일의 Google Drive 검증에 실패했습니다.`);
      }
    }
    async function removeStagedFile(fileId: string) {
      await removeDriveFile(fileId);
      const index = uploadedFileIds.indexOf(fileId);
      if (index >= 0) uploadedFileIds.splice(index, 1);
    }
    const pdfFile = new File([pdf], pdfName, { type: pdf.type || "application/pdf" });
    const xlsxFile = new File([xlsx], xlsxName, { type: xlsx.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const [stagedPdf, stagedXlsx] = replaceExisting ? await Promise.all([
      existingPdfId ? storeFile({ file: pdfFile, contextType: "authored-quotation-pdf-replacement-temp" }) : null,
      existingXlsxId ? storeFile({ file: xlsxFile, contextType: "authored-quotation-xlsx-replacement-temp" }) : null,
    ]) : [null, null];
    await Promise.all([
      stagedPdf ? validateStagedFile(stagedPdf.fileId, "pdf", pdfFile.size) : Promise.resolve(),
      stagedXlsx ? validateStagedFile(stagedXlsx.fileId, "xlsx", xlsxFile.size) : Promise.resolve(),
    ]);
    const [storedPdf, storedXlsx] = await Promise.all([
      replaceExisting && existingPdfId ? replaceDriveFile({
        fileId: existingPdfId,
        file: pdfFile,
        folderSegments,
        contextType: "authored-quotation-pdf",
        contextId,
      }) : storeFile({ file: pdfFile, contextType: "authored-quotation-pdf" }),
      replaceExisting && existingXlsxId ? replaceDriveFile({
        fileId: existingXlsxId,
        file: xlsxFile,
        folderSegments,
        contextType: "authored-quotation-xlsx",
        contextId,
      }) : storeFile({ file: xlsxFile, contextType: "authored-quotation-xlsx" }),
    ]);
    await Promise.all([
      stagedPdf ? removeStagedFile(stagedPdf.fileId) : Promise.resolve(),
      stagedXlsx ? removeStagedFile(stagedXlsx.fileId) : Promise.resolve(),
    ]);
    const desiredSourceName = sourceFile
      ? sourceName
      : existingSourceId
        ? quotationSourceFileName(nameInput, row.source_file_name || "원본.xlsx")
        : "";
    const storedSource = sourceFile ? await storeFile({
      file: new File([sourceFile], sourceName, { type: sourceFile.type || "application/octet-stream" }),
      contextType: "authored-quotation-source",
    }) : null;
    const mirrorInputs = [
      { file: new File([pdf], pdfName, { type: pdf.type || "application/pdf" }), contextType: "authored-quotation-pdf-mirror" },
      { file: new File([xlsx], xlsxName, { type: xlsx.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), contextType: "authored-quotation-xlsx-mirror" },
      ...(sourceFile ? [{
        file: new File([sourceFile], sourceName, { type: sourceFile.type || "application/octet-stream" }),
        contextType: "authored-quotation-source-mirror",
      }] : []),
    ];
    const finalize = await d1.prepare(`UPDATE authored_quotations
      SET status='final', drive_pdf_file_id=?, drive_pdf_name=?,
          drive_xlsx_file_id=?, drive_xlsx_name=?, source_file_id=?, source_file_name=?, source_file_type=?, drive_sync_status='ready',
          drive_sync_error='', updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND drive_sync_token=?`)
      .bind(
        storedPdf.fileId,
        pdfName,
        storedXlsx.fileId,
        xlsxName,
        storedSource?.fileId || existingSourceId,
        desiredSourceName || String(row.source_file_name ?? ""),
        sourceFile?.type || String(row.source_file_type ?? ""),
        id,
        syncToken,
      )
      .run();
    if (Number(finalize.meta.changes) !== 1) {
      throw new Error("더 최신 견적 저장 작업이 시작되어 이전 파일 반영을 중단했습니다.");
    }
    if (replaceExisting && originalUpdatedAt) {
      await d1.prepare("UPDATE authored_quotations SET updated_at=? WHERE id=? AND drive_sync_token=?")
        .bind(originalUpdatedAt, id, syncToken)
        .run();
    }
    uploadedFileIds.length = 0;
    if (!sourceFile && existingSourceId && desiredSourceName) {
      await organizeDriveFile(existingSourceId, folderSegments, desiredSourceName);
    }
    await Promise.all(mirrorInputs.map((mirror) => upsertDriveFileByContext({
      file: mirror.file,
      folderSegments: [...QUOTATION_LIBRARY_FOLDER_SEGMENTS],
      contextType: mirror.contextType,
      contextId,
    })));
    if (existingSourceId && !sourceFile) {
      await syncDriveFileCopyFromSource({
        sourceFileId: existingSourceId,
        name: desiredSourceName,
        folderSegments: [...QUOTATION_LIBRARY_FOLDER_SEGMENTS],
        contextType: "authored-quotation-source-mirror",
        contextId,
      });
    }
    for (const [oldId, currentId] of [
      [existingPdfId, storedPdf.fileId],
      [existingXlsxId, storedXlsx.fileId],
      ...(storedSource ? [[existingSourceId, storedSource.fileId]] : []),
    ]) {
      if (oldId && oldId !== currentId) await removeDriveFile(oldId).catch(() => undefined);
    }
    uploadedFileIds.length = 0;
    const saved = await d1
      .prepare("SELECT * FROM authored_quotations WHERE id=?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!saved) throw new Error("저장한 견적서를 다시 불러오지 못했습니다.");
    return Response.json({ quotation: authoredQuotationFromRowForMember(saved, member) });
  } catch (error) {
    for (const fileId of uploadedFileIds) await removeDriveFile(fileId).catch(() => undefined);
    if (id) {
      const message = cleanError(error);
      await ensureAuthoredQuotationsReady()
        .then(async (d1) => {
          await d1.prepare("UPDATE authored_quotations SET drive_sync_status='error', drive_sync_error=? WHERE id=? AND (?='' OR drive_sync_token=?)")
            .bind(message, id, syncToken, syncToken)
            .run();
          if (replaceExisting && originalUpdatedAt) {
            await d1.prepare("UPDATE authored_quotations SET updated_at=? WHERE id=? AND (?='' OR drive_sync_token=?)")
              .bind(originalUpdatedAt, id, syncToken, syncToken)
              .run();
          }
        })
        .catch(() => undefined);
    }
    if (replaceExisting) {
      console.error("Quotation file replacement failed", { id, error });
      return Response.json({ error: cleanError(error) }, { status: 500 });
    }
    return accessErrorResponse(error);
  }
}
