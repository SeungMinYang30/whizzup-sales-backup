import {
  AccessError,
  accessErrorResponse,
  requireAdminMember,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  archiveDriveFile,
  downloadDriveFile,
  getDriveFileMetadata,
  isResourceStorageConfigured,
  moveDriveFilesTransaction,
  pruneDriveMoveSources,
  removeDriveFile,
  rollbackDriveMoves,
  safeDriveFolderName,
  uploadDriveFile,
} from "../../../lib/google-drive-storage";
import {
  ensureResourceLibraryReady,
  RESOURCE_MAX_FILES,
  resourcePostJson,
  type ResourceAttachmentRow,
  type ResourcePostRow,
} from "../../../lib/resource-library";
import {
  isResourceCategoryForKind,
  isVideoResourceFile,
  RESOURCE_CATEGORIES,
} from "../../../lib/resource-library-categories";

export const dynamic = "force-dynamic";

const categories = new Set<string>(RESOURCE_CATEGORIES);
const blockedExtensions = new Set([
  "exe", "dll", "bat", "cmd", "com", "msi", "ps1", "vbs", "js", "html", "htm",
]);

function clean(value: unknown, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function positiveId(value: unknown) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function normalizedCategory(value: unknown) {
  const category = clean(value, 40);
  return categories.has(category) ? category : "기타";
}

async function removeUnreferencedResourceFiles(fileIds: string[]) {
  if (!fileIds.length) return;
  const d1 = await ensureResourceLibraryReady().catch(() => null);
  for (const fileId of fileIds) {
    const linked = d1
      ? await d1.prepare("SELECT id FROM resource_attachments WHERE drive_file_id = ? LIMIT 1")
        .bind(fileId).first<{ id: number }>().catch(() => null)
      : null;
    if (!linked) await removeDriveFile(fileId).catch(() => undefined);
  }
}

async function attachmentById(id: number) {
  const d1 = await ensureResourceLibraryReady();
  const row = await d1
    .prepare("SELECT * FROM resource_attachments WHERE id = ? LIMIT 1")
    .bind(id)
    .first<ResourceAttachmentRow>();
  return { d1, row };
}

async function serveDownload(id: number) {
  await requireApprovedMember();
  const { row } = await attachmentById(id);
  if (!row) return Response.json({ error: "첨부 파일을 찾지 못했습니다." }, { status: 404 });
  const stored = await downloadDriveFile(row.drive_file_id);
  const headers = new Headers({
    "Content-Type": row.mime_type || stored.headers.get("Content-Type") || "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const length = stored.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);
  return new Response(stored.body, { headers });
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const search = new URL(request.url).searchParams;
    const downloadId = positiveId(search.get("downloadId"));
    if (downloadId) return await serveDownload(downloadId);

    const q = clean(search.get("q"), 120);
    const category = clean(search.get("category"), 40);
    const d1 = await ensureResourceLibraryReady();
    const clauses = ["archived_at IS NULL"];
    const bindings: string[] = [];
    if (category && categories.has(category)) {
      clauses.push("category = ?");
      bindings.push(category);
    }
    if (q) {
      clauses.push("(title LIKE ? OR content LIKE ? OR created_by_name LIKE ?)");
      const pattern = `%${q.replace(/[%_]/g, "")}%`;
      bindings.push(pattern, pattern, pattern);
    }
    const posts = await d1
      .prepare(
        `SELECT * FROM resource_posts
         WHERE ${clauses.join(" AND ")}
         ORDER BY CASE category
           WHEN '제안서' THEN 0
           WHEN '매뉴얼' THEN 1
           WHEN '계약·공문' THEN 2
           WHEN '제품자료' THEN 3
           WHEN '교육자료' THEN 4
           WHEN '서식' THEN 5
           WHEN '제품 소개·시연' THEN 10
           WHEN '설치·사용법' THEN 11
           WHEN '현장·납품 사례' THEN 12
           WHEN '회사·홍보' THEN 13
           WHEN '기타' THEN 20
           ELSE 99 END,
           title COLLATE NOCASE ASC, id ASC
         LIMIT 300`,
      )
      .bind(...bindings)
      .all<ResourcePostRow>();
    const postIds = posts.results.map((row) => Number(row.id)).filter(Boolean);
    let attachments: ResourceAttachmentRow[] = [];
    if (postIds.length) {
      attachments = (
        await d1
          .prepare(
            `SELECT * FROM resource_attachments
             WHERE post_id IN (${postIds.map(() => "?").join(",")})
             ORDER BY created_at ASC, id ASC`,
          )
          .bind(...postIds)
          .all<ResourceAttachmentRow>()
      ).results;
    }
    const byPost = new Map<number, ResourceAttachmentRow[]>();
    attachments.forEach((attachment) => {
      const current = byPost.get(Number(attachment.post_id)) ?? [];
      current.push(attachment);
      byPost.set(Number(attachment.post_id), current);
    });
    return Response.json({
      configured: isResourceStorageConfigured(),
      categories: [...categories],
      posts: posts.results.map((post) => resourcePostJson(post, byPost.get(Number(post.id)) ?? [])),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const uploadedFileIds: string[] = [];
  try {
    const member = await requireApprovedMember();
    if (!isResourceStorageConfigured()) {
      return Response.json({ error: "자료실 파일 저장소 연결 정보가 등록되지 않았습니다." }, { status: 503 });
    }
    if ((request.headers.get("content-type") || "").includes("application/json")) {
      const input = (await request.json()) as Record<string, unknown>;
      const title = clean(input.title, 160);
      const category = normalizedCategory(input.category);
      const content = clean(input.content, 4000);
      const rawFiles = Array.isArray(input.files) ? input.files : [];
      if (!title) return Response.json({ error: "자료 제목을 입력해 주세요." }, { status: 400 });
      if (!rawFiles.length) return Response.json({ error: "첨부 파일을 선택해 주세요." }, { status: 400 });
      if (rawFiles.length > RESOURCE_MAX_FILES) {
        return Response.json({ error: `한 번에 ${RESOURCE_MAX_FILES}개까지 첨부할 수 있습니다.` }, { status: 400 });
      }
      const verified = [] as Array<{
        originalName: string;
        fileId: string;
        folderId: string;
        mimeType: string;
        sizeBytes: number;
      }>;
      for (const raw of rawFiles) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        const fileId = clean(item.fileId, 180);
        const originalName = clean(item.originalName, 240);
        const folderId = clean(item.folderId, 180);
        if (!fileId || !originalName || !folderId) continue;
        const metadata = await getDriveFileMetadata(fileId);
        if (
          metadata.appProperties?.whizzup !== "1" ||
          metadata.appProperties?.contextType !== "resource-library" ||
          metadata.appProperties?.createdBy !== String(member.id) ||
          metadata.appProperties?.contextId !== title ||
          !metadata.parents?.includes(folderId)
        ) {
          throw new AccessError(`${originalName} 파일의 업로드 정보를 확인하지 못했습니다.`, 400);
        }
        uploadedFileIds.push(fileId);
        verified.push({
          originalName,
          fileId,
          folderId,
          mimeType: metadata.mimeType || "application/octet-stream",
          sizeBytes: Number(metadata.size) || 0,
        });
      }
      if (verified.length !== rawFiles.length) {
        throw new AccessError("첨부 파일 정보를 다시 확인해 주세요.", 400);
      }
      const fileKinds = new Set(
        verified.map((file) => isVideoResourceFile(file.originalName, file.mimeType)),
      );
      if (fileKinds.size !== 1) {
        throw new AccessError("문서와 영상은 한 게시물에 함께 등록할 수 없습니다.", 400);
      }
      const isVideo = fileKinds.has(true);
      if (!isResourceCategoryForKind(category, isVideo)) {
        throw new AccessError(
          isVideo ? "영상 자료 분류를 선택해 주세요." : "문서 자료 분류를 선택해 주세요.",
          400,
        );
      }
      const d1 = await ensureResourceLibraryReady();
      const linked = verified.length
        ? await d1
          .prepare(`SELECT * FROM resource_attachments WHERE drive_file_id IN (${verified.map(() => "?").join(",")})`)
          .bind(...verified.map((file) => file.fileId))
          .all<ResourceAttachmentRow>()
        : { results: [] as ResourceAttachmentRow[] };
      if (linked.results.length) {
        const postIds = [...new Set(linked.results.map((file) => Number(file.post_id)))];
        if (linked.results.length === verified.length && postIds.length === 1) {
          const existingPost = await d1
            .prepare("SELECT * FROM resource_posts WHERE id = ? AND archived_at IS NULL")
            .bind(postIds[0])
            .first<ResourcePostRow>();
          if (existingPost) {
            uploadedFileIds.length = 0;
            const existingAttachments = await d1
              .prepare("SELECT * FROM resource_attachments WHERE post_id = ? ORDER BY created_at ASC, id ASC")
              .bind(postIds[0])
              .all<ResourceAttachmentRow>();
            return Response.json({ post: resourcePostJson(existingPost, existingAttachments.results) });
          }
        }
        throw new AccessError("이미 등록된 파일과 새 파일이 섞여 있습니다. 자료실을 새로고침한 뒤 다시 확인해 주세요.", 409);
      }
      const post = await d1
        .prepare(
          `INSERT INTO resource_posts (category, title, content, created_by, created_by_name)
           VALUES (?, ?, ?, ?, ?) RETURNING *`,
        )
        .bind(category, title, content, member.id, member.displayName)
        .first<ResourcePostRow>();
      if (!post) throw new Error("자료 게시글을 저장하지 못했습니다.");
      const attachments: ResourceAttachmentRow[] = [];
      try {
        for (const item of verified) {
          const row = await d1
            .prepare(
              `INSERT INTO resource_attachments (
                 post_id, original_name, drive_file_id, drive_folder_id, mime_type,
                 size_bytes, created_by, created_by_name
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
            )
            .bind(
              post.id, item.originalName, item.fileId, item.folderId, item.mimeType,
              item.sizeBytes, member.id, member.displayName,
            )
            .first<ResourceAttachmentRow>();
          if (!row) throw new Error("첨부 파일 정보를 저장하지 못했습니다.");
          attachments.push(row);
        }
      } catch (error) {
        await d1.prepare("DELETE FROM resource_posts WHERE id = ?").bind(post.id).run().catch(() => undefined);
        throw error;
      }
      uploadedFileIds.length = 0;
      return Response.json({ post: resourcePostJson(post, attachments) }, { status: 201 });
    }

    const formData = await request.formData();
    const title = clean(formData.get("title"), 160);
    const category = normalizedCategory(formData.get("category"));
    const content = clean(formData.get("content"), 4000);
    const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (!title) return Response.json({ error: "자료 제목을 입력해 주세요." }, { status: 400 });
    if (!files.length) return Response.json({ error: "첨부 파일을 선택해 주세요." }, { status: 400 });
    if (files.length > RESOURCE_MAX_FILES) {
      return Response.json({ error: `한 번에 ${RESOURCE_MAX_FILES}개까지 첨부할 수 있습니다.` }, { status: 400 });
    }
    const blocked = files.find((file) => blockedExtensions.has(file.name.toLowerCase().split(".").pop() || ""));
    if (blocked) return Response.json({ error: `${blocked.name} 파일 형식은 첨부할 수 없습니다.` }, { status: 400 });
    const fileKinds = new Set(
      files.map((file) => isVideoResourceFile(file.name, file.type)),
    );
    if (fileKinds.size !== 1) {
      return Response.json({ error: "문서와 영상은 한 게시물에 함께 등록할 수 없습니다." }, { status: 400 });
    }
    const isVideo = fileKinds.has(true);
    if (!isResourceCategoryForKind(category, isVideo)) {
      return Response.json(
        { error: isVideo ? "영상 자료 분류를 선택해 주세요." : "문서 자료 분류를 선택해 주세요." },
        { status: 400 },
      );
    }

    const uploaded = [] as Array<{
      file: File;
      fileId: string;
      folderId: string;
      mimeType: string;
      sizeBytes: number;
    }>;
    for (const file of files) {
      const stored = await uploadDriveFile({
        file,
        folderSegments: ["03_자료실게시판", safeDriveFolderName(category), new Date().toISOString().slice(0, 4)],
        contextType: "resource-library",
        contextId: title,
      });
      uploadedFileIds.push(stored.fileId);
      uploaded.push({ file, ...stored });
    }

    const d1 = await ensureResourceLibraryReady();
    const post = await d1
      .prepare(
        `INSERT INTO resource_posts (category, title, content, created_by, created_by_name)
         VALUES (?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(category, title, content, member.id, member.displayName)
      .first<ResourcePostRow>();
    if (!post) throw new Error("자료 게시글을 저장하지 못했습니다.");
    const attachments: ResourceAttachmentRow[] = [];
    try {
      for (const item of uploaded) {
        const row = await d1
          .prepare(
            `INSERT INTO resource_attachments (
               post_id, original_name, drive_file_id, drive_folder_id, mime_type,
               size_bytes, created_by, created_by_name
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          )
          .bind(
            post.id,
            item.file.name.slice(0, 240),
            item.fileId,
            item.folderId,
            item.mimeType,
            item.sizeBytes,
            member.id,
            member.displayName,
          )
          .first<ResourceAttachmentRow>();
        if (!row) throw new Error("첨부 파일 정보를 저장하지 못했습니다.");
        attachments.push(row);
      }
    } catch (error) {
      await d1.prepare("DELETE FROM resource_posts WHERE id = ?").bind(post.id).run().catch(() => undefined);
      throw error;
    }
    return Response.json({ post: resourcePostJson(post, attachments) }, { status: 201 });
  } catch (error) {
    await removeUnreferencedResourceFiles(uploadedFileIds);
    return accessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  let driveMoves: Awaited<ReturnType<typeof moveDriveFilesTransaction>> = [];
  try {
    await requireApprovedMember();
    const input = (await request.json()) as Record<string, unknown>;
    const id = positiveId(input.id);
    if (!id) return Response.json({ error: "올바른 자료 ID가 필요합니다." }, { status: 400 });
    const d1 = await ensureResourceLibraryReady();
    const existing = await d1.prepare("SELECT * FROM resource_posts WHERE id = ? AND archived_at IS NULL").bind(id).first<ResourcePostRow>();
    if (!existing) return Response.json({ error: "자료를 찾지 못했습니다." }, { status: 404 });
    const title = clean(input.title, 160);
    const content = clean(input.content, 4000);
    const category = normalizedCategory(input.category);
    if (!title) return Response.json({ error: "자료 제목을 입력해 주세요." }, { status: 400 });
    const attachments = await d1
      .prepare("SELECT * FROM resource_attachments WHERE post_id = ? ORDER BY id")
      .bind(id)
      .all<ResourceAttachmentRow>();
    if (category !== existing.category && attachments.results.length) {
      const fileKinds = new Set(
        attachments.results.map((file) =>
          isVideoResourceFile(file.original_name, file.mime_type),
        ),
      );
      if (fileKinds.size !== 1) {
        return Response.json(
          { error: "문서와 영상이 함께 있는 기존 자료는 분류를 변경할 수 없습니다." },
          { status: 400 },
        );
      }
      if (!isResourceCategoryForKind(category, fileKinds.has(true))) {
        return Response.json(
          { error: fileKinds.has(true) ? "영상 자료 분류를 선택해 주세요." : "문서 자료 분류를 선택해 주세요." },
          { status: 400 },
        );
      }
    }
    if (category !== existing.category && attachments.results.length) {
      const year = String(existing.created_at || new Date().toISOString()).slice(0, 4);
      driveMoves = await moveDriveFilesTransaction(
        attachments.results.map((attachment) => ({
          fileId: attachment.drive_file_id,
          folderSegments: ["03_자료실게시판", safeDriveFolderName(category), year],
        })),
      );
    }
    try {
      const statements = [
        d1
          .prepare("UPDATE resource_posts SET title = ?, category = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(title, category, content, id),
        ...driveMoves.map((move) => d1
          .prepare("UPDATE resource_attachments SET drive_folder_id = ? WHERE post_id = ? AND drive_file_id = ?")
          .bind(move.destinationFolderId, id, move.fileId)),
      ];
      await d1.batch(statements);
      if (driveMoves.length) await pruneDriveMoveSources(driveMoves).catch(() => undefined);
    } catch (error) {
      if (driveMoves.length) await rollbackDriveMoves(driveMoves).catch(() => undefined);
      throw error;
    }
    return Response.json({ ok: true });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const member = await requireAdminMember();
    const input = (await request.json()) as Record<string, unknown>;
    const id = positiveId(input.id);
    if (!id) return Response.json({ error: "올바른 자료 ID가 필요합니다." }, { status: 400 });
    const d1 = await ensureResourceLibraryReady();
    const post = await d1.prepare("SELECT * FROM resource_posts WHERE id = ? AND archived_at IS NULL").bind(id).first<ResourcePostRow>();
    if (!post) return Response.json({ error: "자료를 찾지 못했습니다." }, { status: 404 });
    const attachments = await d1.prepare("SELECT * FROM resource_attachments WHERE post_id = ?").bind(id).all<ResourceAttachmentRow>();
    for (const attachment of attachments.results) {
      await archiveDriveFile(attachment.drive_file_id, post.category);
    }
    await d1
      .prepare("UPDATE resource_posts SET archived_at = CURRENT_TIMESTAMP, archived_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(member.id, id)
      .run();
    return Response.json({ ok: true });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
