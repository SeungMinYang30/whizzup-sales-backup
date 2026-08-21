import { accessErrorResponse, requireApprovedMember } from "../../../lib/collaboration";
import {
  ORGANIZATION_PROJECT_DOCUMENT_MAX_BYTES,
  ensureOrganizationProjectDocumentsReady,
  type OrganizationProjectDocumentRow,
} from "../../../lib/organization-project-documents";
import {
  downloadDriveFile,
  googleDriveStorageErrorResponse,
  moveDriveFile,
  rollbackDriveMoves,
  safeDriveFolderName,
  uploadDriveFile,
} from "../../../lib/google-drive-storage";

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
    return googleDriveStorageErrorResponse(error) ?? accessErrorResponse(error);
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
