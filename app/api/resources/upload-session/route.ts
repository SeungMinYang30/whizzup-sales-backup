import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import {
  createDriveResumableUpload,
  GoogleDriveStorageError,
  getDriveFileMetadata,
  isResourceStorageConfigured,
  removeDriveFile,
  safeDriveFolderName,
  uploadDriveResumableChunk,
} from "../../../../lib/google-drive-storage";
import { RESOURCE_UPLOAD_CHUNK_BYTES } from "../../../../lib/resource-upload-config";
import { ensureResourceLibraryReady } from "../../../../lib/resource-library";
import {
  isResourceCategoryForKind,
  isVideoResourceFile,
  RESOURCE_CATEGORIES,
} from "../../../../lib/resource-library-categories";

export const dynamic = "force-dynamic";

const categories = new Set<string>(RESOURCE_CATEGORIES);
const blockedExtensions = new Set([
  "exe", "dll", "bat", "cmd", "com", "msi", "ps1", "vbs", "js", "html", "htm",
]);

const clean = (value: unknown, maxLength = 240) =>
  String(value ?? "").trim().slice(0, maxLength);

function uploadErrorResponse(error: unknown) {
  if (error instanceof GoogleDriveStorageError) {
    const status = error.code === "DRIVE_SESSION_EXPIRED" ? 410 : error.status;
    return Response.json({ error: error.message, code: error.code }, { status });
  }
  return accessErrorResponse(error);
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as Record<string, unknown>;
    const member = await requireApprovedMember();
    if (!isResourceStorageConfigured()) {
      return Response.json(
        { error: "자료실 파일 저장소 연결 정보가 등록되지 않았습니다." },
        { status: 503 },
      );
    }
    const fileName = clean(input.fileName);
    const mimeType = clean(input.mimeType, 160) || "application/octet-stream";
    const sizeBytes = Number(input.sizeBytes);
    const title = clean(input.title, 160);
    const categoryText = clean(input.category, 40);
    const category = categories.has(categoryText) ? categoryText : "기타";
    const extension = fileName.toLowerCase().split(".").pop() || "";
    if (!fileName || !title || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      return Response.json({ error: "업로드할 파일 정보를 확인해 주세요." }, { status: 400 });
    }
    if (blockedExtensions.has(extension)) {
      return Response.json({ error: `${fileName} 파일 형식은 첨부할 수 없습니다.` }, { status: 400 });
    }
    const isVideo = isVideoResourceFile(fileName, mimeType);
    if (!isResourceCategoryForKind(category, isVideo)) {
      return Response.json(
        { error: isVideo ? "영상 자료 분류를 선택해 주세요." : "문서 자료 분류를 선택해 주세요." },
        { status: 400 },
      );
    }
    const session = await createDriveResumableUpload({
      fileName,
      mimeType,
      sizeBytes,
      folderSegments: [
        "03_자료실게시판",
        safeDriveFolderName(category),
        new Date().toISOString().slice(0, 4),
      ],
      contextType: "resource-library",
      contextId: title,
      contextCategory: category,
      createdBy: member.id,
    });
    return Response.json(session, { status: 201 });
  } catch (error) {
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
    if (!uploadUrl || !range) {
      return Response.json({ error: "업로드 조각 정보가 올바르지 않습니다." }, { status: 400 });
    }
    const declaredBytes = Number(range[2]) - Number(range[1]) + 1;
    const contentLength = Number(request.headers.get("content-length") || declaredBytes);
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes <= 0 ||
      declaredBytes > RESOURCE_UPLOAD_CHUNK_BYTES ||
      contentLength > RESOURCE_UPLOAD_CHUNK_BYTES
    ) {
      return Response.json(
        {
          code: "VERCEL_PAYLOAD_LIMIT",
          error: "업로드 청크가 Vercel 요청 용량 제한을 초과했습니다.",
        },
        { status: 413 },
      );
    }
    const body = await request.arrayBuffer();
    if (body.byteLength !== declaredBytes || body.byteLength > RESOURCE_UPLOAD_CHUNK_BYTES) {
      return Response.json(
        {
          code: "VERCEL_PAYLOAD_LIMIT",
          error: "업로드 청크가 Vercel 요청 용량 제한을 초과했거나 크기가 올바르지 않습니다.",
        },
        { status: 413 },
      );
    }
    const result = await uploadDriveResumableChunk({
      uploadUrl,
      contentRange,
      mimeType,
      body,
    });
    return Response.json(result, { status: result.complete ? 201 : 200 });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const member = await requireApprovedMember();
    const input = (await request.json().catch(() => ({}))) as { fileIds?: unknown };
    const fileIds = Array.isArray(input.fileIds)
      ? [...new Set(input.fileIds.map((value) => clean(value, 180)).filter(Boolean))].slice(0, 10)
      : [];
    for (const fileId of fileIds) {
      const metadata = await getDriveFileMetadata(fileId).catch(() => null);
      if (
        metadata?.appProperties?.whizzup === "1" &&
        ["resource-library", "resource-product-import"].includes(
          metadata.appProperties.contextType || "",
        ) &&
        metadata.appProperties.createdBy === String(member.id)
      ) {
        const d1 = await ensureResourceLibraryReady();
        const linked = await d1
          .prepare("SELECT id FROM resource_attachments WHERE drive_file_id = ? LIMIT 1")
          .bind(fileId)
          .first<{ id: number }>();
        if (!linked) await removeDriveFile(fileId).catch(() => undefined);
      }
    }
    return Response.json({ ok: true });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
