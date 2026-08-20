import {
  AccessError,
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import {
  archiveDriveFile,
  getDriveFileMetadata,
  removeDriveFile,
} from "../../../../lib/google-drive-storage";
import {
  ensureResourceLibraryReady,
  RESOURCE_MAX_FILES,
  resourceAttachmentJson,
  type ResourceAttachmentRow,
  type ResourcePostRow,
} from "../../../../lib/resource-library";

export const dynamic = "force-dynamic";

function clean(value: unknown, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

async function editablePost(postId: number) {
  const member = await requireApprovedMember();
  const d1 = await ensureResourceLibraryReady();
  const post = await d1
    .prepare("SELECT * FROM resource_posts WHERE id = ? AND archived_at IS NULL")
    .bind(postId)
    .first<ResourcePostRow>();
  if (!post) throw new AccessError("자료를 찾지 못했습니다.", 404);
  return { d1, member, post };
}

type UploadedInput = {
  fileId: string;
  folderId: string;
  originalName: string;
};

async function verifyUploadedFiles(
  rawFiles: unknown,
  memberId: number,
  expectedTitle: string,
) {
  const items = Array.isArray(rawFiles) ? rawFiles : [];
  const verified: Array<UploadedInput & { mimeType: string; sizeBytes: number }> = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const input = raw as Record<string, unknown>;
    const fileId = clean(input.fileId, 180);
    const folderId = clean(input.folderId, 180);
    const originalName = clean(input.originalName, 240);
    if (!fileId || !folderId || !originalName) continue;
    const metadata = await getDriveFileMetadata(fileId);
    if (
      metadata.appProperties?.whizzup !== "1" ||
      metadata.appProperties?.contextType !== "resource-library" ||
      metadata.appProperties?.createdBy !== String(memberId) ||
      metadata.appProperties?.contextId !== expectedTitle ||
      !metadata.parents?.includes(folderId)
    ) {
      throw new AccessError(`${originalName} 파일의 업로드 정보를 확인하지 못했습니다.`, 400);
    }
    verified.push({
      fileId,
      folderId,
      originalName,
      mimeType: metadata.mimeType || "application/octet-stream",
      sizeBytes: Number(metadata.size) || 0,
    });
  }
  if (!verified.length || verified.length !== items.length) {
    throw new AccessError("새 파일의 업로드 정보를 확인하지 못했습니다.", 400);
  }
  return verified;
}

export async function POST(request: Request) {
  const newDriveFileIds: string[] = [];
  try {
    const input = (await request.json()) as Record<string, unknown>;
    const postId = positiveId(input.postId);
    const mode = input.mode === "replace" ? "replace" : "add";
    const attachmentId = positiveId(input.attachmentId);
    if (!postId) throw new AccessError("올바른 자료 ID가 필요합니다.", 400);
    const { d1, member, post } = await editablePost(postId);
    const verified = await verifyUploadedFiles(input.files, member.id, post.title);
    newDriveFileIds.push(...verified.map((file) => file.fileId));
    if (mode === "replace" && (verified.length !== 1 || !attachmentId)) {
      throw new AccessError("교체할 파일 한 개를 선택해 주세요.", 400);
    }
    const count = await d1
      .prepare("SELECT COUNT(*) AS count FROM resource_attachments WHERE post_id = ?")
      .bind(postId)
      .first<{ count: number }>();
    const resultingCount = (Number(count?.count) || 0) + verified.length - (mode === "replace" ? 1 : 0);
    if (resultingCount > RESOURCE_MAX_FILES) {
      throw new AccessError(`자료 한 건에 ${RESOURCE_MAX_FILES}개까지 첨부할 수 있습니다.`, 400);
    }
    let oldAttachment: ResourceAttachmentRow | null = null;
    if (mode === "replace") {
      oldAttachment = await d1
        .prepare("SELECT * FROM resource_attachments WHERE id = ? AND post_id = ?")
        .bind(attachmentId, postId)
        .first<ResourceAttachmentRow>();
      if (!oldAttachment) throw new AccessError("교체할 기존 파일을 찾지 못했습니다.", 404);
    }

    const insertStatement = (file: (typeof verified)[number]) =>
      d1
        .prepare(
          `INSERT INTO resource_attachments (
             post_id, original_name, drive_file_id, drive_folder_id, mime_type,
             size_bytes, created_by, created_by_name
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          postId,
          file.originalName,
          file.fileId,
          file.folderId,
          file.mimeType,
          file.sizeBytes,
          member.id,
          member.displayName,
        );

    if (oldAttachment) {
      const newFile = verified[0];
      await d1.batch([
        insertStatement(newFile),
        d1.prepare("DELETE FROM resource_attachments WHERE id = ?").bind(oldAttachment.id),
      ]);
      try {
        await archiveDriveFile(oldAttachment.drive_file_id, post.category);
      } catch (error) {
        await d1.batch([
          d1.prepare("DELETE FROM resource_attachments WHERE drive_file_id = ?").bind(newFile.fileId),
          d1
            .prepare(
              `INSERT OR REPLACE INTO resource_attachments (
                 id, post_id, original_name, drive_file_id, drive_folder_id, mime_type,
                 size_bytes, created_by, created_by_name, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              oldAttachment.id,
              oldAttachment.post_id,
              oldAttachment.original_name,
              oldAttachment.drive_file_id,
              oldAttachment.drive_folder_id,
              oldAttachment.mime_type,
              oldAttachment.size_bytes,
              oldAttachment.created_by,
              oldAttachment.created_by_name,
              oldAttachment.created_at,
            ),
        ]);
        throw error;
      }
    } else {
      await d1.batch(verified.map(insertStatement));
    }
    newDriveFileIds.length = 0;
    const attachments = await d1
      .prepare("SELECT * FROM resource_attachments WHERE post_id = ? ORDER BY created_at ASC, id ASC")
      .bind(postId)
      .all<ResourceAttachmentRow>();
    return Response.json({ attachments: attachments.results.map(resourceAttachmentJson) });
  } catch (error) {
    if (newDriveFileIds.length) {
      await Promise.all(newDriveFileIds.map((id) => removeDriveFile(id).catch(() => undefined)));
    }
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const input = (await request.json()) as Record<string, unknown>;
    const postId = positiveId(input.postId);
    const attachmentId = positiveId(input.attachmentId);
    if (!postId || !attachmentId) throw new AccessError("삭제할 파일 정보가 필요합니다.", 400);
    const { d1, post } = await editablePost(postId);
    const attachment = await d1
      .prepare("SELECT * FROM resource_attachments WHERE id = ? AND post_id = ?")
      .bind(attachmentId, postId)
      .first<ResourceAttachmentRow>();
    if (!attachment) throw new AccessError("삭제할 파일을 찾지 못했습니다.", 404);
    await archiveDriveFile(attachment.drive_file_id, post.category);
    await d1.prepare("DELETE FROM resource_attachments WHERE id = ?").bind(attachmentId).run();
    return Response.json({ ok: true });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
