import { accessErrorResponse, requireApprovedMember } from "../../../lib/collaboration";
import {
  ORGANIZATION_PROJECT_DOCUMENT_MAX_BYTES,
  ensureOrganizationProjectDocumentsReady,
  type OrganizationProjectDocumentRow,
} from "../../../lib/organization-project-documents";
import {
  createDriveResumableUpload,
  downloadDriveFile,
  getDriveFileMetadata,
  GoogleDriveStorageError,
  googleDriveStorageErrorResponse,
  moveDriveFile,
  rollbackDriveMoves,
  safeDriveFolderName,
  uploadDriveFile,
  uploadDriveResumableChunk,
} from "../../../lib/google-drive-storage";
import { RESOURCE_UPLOAD_CHUNK_BYTES } from "../../../lib/resource-upload-config";

export const dynamic = "force-dynamic";

const allowedKinds = new Set(["도면", "조감도", "통합본", "기타"]);
const allowedExtensions = new Set(["pdf", "jpg", "jpeg", "png", "webp", "dwg", "dxf", "zip", "ppt", "pptx"]);

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function scopedText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function extensionOf(name: string) {
  return name.toLowerCase().split(".").pop() || "";
}

function uploadErrorResponse(error: unknown) {
  if (error instanceof GoogleDriveStorageError) {
    const status = error.code === "DRIVE_SESSION_EXPIRED" ? 410 : error.status;
    return Response.json({ error: error.message, code: error.code }, { status });
  }
  return googleDriveStorageErrorResponse(error) ?? accessErrorResponse(error);
}

function validUploadMetadata(input: Record<string, unknown>) {
  const organization = scopedText(input.organization, 200);
  const businessRound = positiveInteger(input.businessRound);
  const documentType = scopedText(input.documentType, 20);
  const fileName = scopedText(input.fileName, 240);
  const mimeType = scopedText(input.mimeType, 160) || "application/octet-stream";
  const sizeBytes = Number(input.sizeBytes);
  const valid = Boolean(
    organization
    && businessRound
    && allowedKinds.has(documentType)
    && fileName
    && allowedExtensions.has(extensionOf(fileName))
    && Number.isSafeInteger(sizeBytes)
    && sizeBytes > 0
    && sizeBytes <= ORGANIZATION_PROJECT_DOCUMENT_MAX_BYTES,
  );
  return { valid, organization, businessRound, documentType, fileName, mimeType, sizeBytes };
}

async function findDocument(id: number) {
  const d1 = await ensureOrganizationProjectDocumentsReady();
  const row = await d1.prepare(
    "SELECT * FROM organization_project_documents WHERE id = ? LIMIT 1",
  ).bind(id).first<OrganizationProjectDocumentRow>();
  return { d1, row };
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const params = new URL(request.url).searchParams;
    const id = positiveInteger(params.get("id"));
    const isDownload = params.get("download") === "1";
    const isPreview = params.get("preview") === "1";
    if (id && (isDownload || isPreview)) {
      const { row } = await findDocument(id);
      if (!row || row.archived_at) {
        return Response.json({ error: "도면·조감도 파일을 찾지 못했습니다." }, { status: 404 });
      }
      const stored = await downloadDriveFile(row.drive_file_id);
      const previewable = row.mime_type === "application/pdf" || row.mime_type.startsWith("image/");
      return new Response(stored.body, {
        headers: {
          "Content-Type": stored.headers.get("Content-Type") || row.mime_type || "application/octet-stream",
          "Content-Length": stored.headers.get("Content-Length") || String(row.size_bytes),
          "Content-Disposition": `${isPreview && previewable ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const organization = scopedText(params.get("organization"), 200);
    const businessRound = positiveInteger(params.get("businessRound"));
    if (!organization || !businessRound) return Response.json({ documents: [] });
    const d1 = await ensureOrganizationProjectDocumentsReady();
    const result = await d1.prepare(
      `SELECT * FROM organization_project_documents
       WHERE organization = ? AND business_round = ? AND archived_at IS NULL
       ORDER BY id DESC`,
    ).bind(organization, businessRound).all<OrganizationProjectDocumentRow>();
    return Response.json({ documents: result.results ?? [] });
  } catch (error) {
    return googleDriveStorageErrorResponse(error) ?? accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let uploadedFileId = "";
  try {
    const member = await requireApprovedMember();
    if (request.headers.get("content-type")?.includes("application/json")) {
      const metadata = validUploadMetadata(await request.json() as Record<string, unknown>);
      if (!metadata.valid) {
        return Response.json({ error: "PDF, 이미지, DWG, DXF, ZIP, PPT 파일을 50MB 이하로 올려 주세요." }, { status: 400 });
      }
      const session = await createDriveResumableUpload({
        fileName: metadata.fileName,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
        folderSegments: [
          "01_기관자료",
          safeDriveFolderName(metadata.organization),
          `${metadata.businessRound}차 사업`,
          "도면·조감도",
        ],
        contextType: "organization-project-document",
        contextId: `${metadata.organization}|${metadata.businessRound}|${metadata.documentType}`,
        createdBy: member.id,
      });
      return Response.json(session, { status: 201 });
    }
    const form = await request.formData();
    const organization = scopedText(form.get("organization"), 200);
    const businessRound = positiveInteger(form.get("businessRound"));
    const documentType = scopedText(form.get("documentType"), 20);
    const file = form.get("file");
    if (!organization || !businessRound || !allowedKinds.has(documentType)) {
      return Response.json({ error: "기관·사업 차수와 자료 종류를 확인해 주세요." }, { status: 400 });
    }
    if (!(file instanceof File) || file.size < 1 || file.size > ORGANIZATION_PROJECT_DOCUMENT_MAX_BYTES || !allowedExtensions.has(extensionOf(file.name))) {
      return Response.json({ error: "PDF, 이미지, DWG, DXF, ZIP, PPT 파일을 50MB 이하로 올려 주세요." }, { status: 400 });
    }

    const uploaded = await uploadDriveFile({
      file,
      folderSegments: [
        "01_기관자료",
        safeDriveFolderName(organization),
        `${businessRound}차 사업`,
        "도면·조감도",
      ],
      contextType: "organization-project-document",
      contextId: `${organization}|${businessRound}|${documentType}`,
    });
    uploadedFileId = uploaded.fileId;
    const d1 = await ensureOrganizationProjectDocumentsReady();
    const row = await d1.prepare(
      `INSERT INTO organization_project_documents
       (organization, business_round, document_type, original_name, drive_file_id, drive_folder_id,
        mime_type, size_bytes, created_by, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    ).bind(
      organization,
      businessRound,
      documentType,
      file.name.slice(0, 240),
      uploaded.fileId,
      uploaded.folderId,
      uploaded.mimeType,
      uploaded.sizeBytes,
      member.id,
      member.displayName,
    ).first<OrganizationProjectDocumentRow>();
    if (!row) throw new Error("도면·조감도 정보를 저장하지 못했습니다.");
    return Response.json({ document: row }, { status: 201 });
  } catch (error) {
    if (uploadedFileId) {
      await moveDriveFile(uploadedFileId, ["99_보관", "기관자료", "업로드 실패"]).catch(() => undefined);
    }
    return uploadErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireApprovedMember();
    const uploadUrl = request.headers.get("x-drive-upload-url") || "";
    const contentRange = request.headers.get("content-range") || "";
    const mimeType = request.headers.get("content-type") || "application/octet-stream";
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
    if (!uploadUrl || !range) return Response.json({ error: "업로드 조각 정보가 올바르지 않습니다." }, { status: 400 });
    const declaredBytes = Number(range[2]) - Number(range[1]) + 1;
    const totalBytes = Number(range[3]);
    if (
      !Number.isSafeInteger(declaredBytes)
      || declaredBytes <= 0
      || declaredBytes > RESOURCE_UPLOAD_CHUNK_BYTES
      || !Number.isSafeInteger(totalBytes)
      || totalBytes <= 0
      || totalBytes > ORGANIZATION_PROJECT_DOCUMENT_MAX_BYTES
    ) {
      return Response.json({ code: "VERCEL_PAYLOAD_LIMIT", error: "업로드 조각 크기를 확인해 주세요." }, { status: 413 });
    }
    const body = await request.arrayBuffer();
    if (body.byteLength !== declaredBytes || body.byteLength > RESOURCE_UPLOAD_CHUNK_BYTES) {
      return Response.json({ code: "VERCEL_PAYLOAD_LIMIT", error: "업로드 조각이 Vercel 요청 용량 제한을 초과했습니다." }, { status: 413 });
    }
    const result = await uploadDriveResumableChunk({ uploadUrl, contentRange, mimeType, body });
    return Response.json(result, { status: result.complete ? 201 : 200 });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  let completedFileId = "";
  try {
    const member = await requireApprovedMember();
    const input = await request.json() as Record<string, unknown>;
    const metadata = validUploadMetadata(input);
    const fileId = scopedText(input.fileId, 180);
    const folderId = scopedText(input.folderId, 180);
    if (!metadata.valid || !fileId || !folderId) {
      return Response.json({ error: "업로드 완료 정보를 확인해 주세요." }, { status: 400 });
    }
    completedFileId = fileId;
    const d1 = await ensureOrganizationProjectDocumentsReady();
    const existing = await d1.prepare(
      "SELECT * FROM organization_project_documents WHERE drive_file_id = ? LIMIT 1",
    ).bind(fileId).first<OrganizationProjectDocumentRow>();
    if (existing) return Response.json({ document: existing });

    const driveFile = await getDriveFileMetadata(fileId);
    const expectedContextId = `${metadata.organization}|${metadata.businessRound}|${metadata.documentType}`;
    if (
      driveFile.appProperties?.contextType !== "organization-project-document"
      || driveFile.appProperties?.contextId !== expectedContextId
      || driveFile.appProperties?.createdBy !== String(member.id)
      || !driveFile.parents?.includes(folderId)
      || Number(driveFile.size || 0) !== metadata.sizeBytes
    ) {
      return Response.json({ error: "Google Drive 업로드 파일 정보가 일치하지 않습니다." }, { status: 400 });
    }
    const row = await d1.prepare(
      `INSERT INTO organization_project_documents
       (organization, business_round, document_type, original_name, drive_file_id, drive_folder_id,
        mime_type, size_bytes, created_by, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    ).bind(
      metadata.organization,
      metadata.businessRound,
      metadata.documentType,
      metadata.fileName,
      fileId,
      folderId,
      driveFile.mimeType || metadata.mimeType,
      metadata.sizeBytes,
      member.id,
      member.displayName,
    ).first<OrganizationProjectDocumentRow>();
    if (!row) throw new Error("도면·조감도 정보를 저장하지 못했습니다.");
    completedFileId = "";
    return Response.json({ document: row }, { status: 201 });
  } catch (error) {
    if (completedFileId) {
      await moveDriveFile(completedFileId, ["99_보관", "기관자료", "업로드 실패"]).catch(() => undefined);
    }
    return uploadErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireApprovedMember();
    const id = positiveInteger(new URL(request.url).searchParams.get("id"));
    const { d1, row } = await findDocument(id);
    if (!row || row.archived_at) {
      return Response.json({ error: "도면·조감도 파일을 찾지 못했습니다." }, { status: 404 });
    }
    const snapshot = await moveDriveFile(row.drive_file_id, [
      "99_보관",
      "기관자료",
      safeDriveFolderName(row.organization),
      `${row.business_round}차 사업`,
      "도면·조감도",
      new Date().getFullYear().toString(),
    ]);
    try {
      await d1.prepare(
        "UPDATE organization_project_documents SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL",
      ).bind(id).run();
    } catch (error) {
      await rollbackDriveMoves([snapshot]).catch(() => undefined);
      throw error;
    }
    return Response.json({ ok: true });
  } catch (error) {
    return googleDriveStorageErrorResponse(error) ?? accessErrorResponse(error);
  }
}
