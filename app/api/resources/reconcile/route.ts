import {
  accessErrorResponse,
  requireAdminMember,
} from "../../../../lib/collaboration";
import {
  ensureDrivePath,
  isDriveFolder,
  listDriveChildren,
  type DriveFile,
} from "../../../../lib/google-drive-storage";
import {
  ensureResourceLibraryReady,
  type ResourcePostRow,
} from "../../../../lib/resource-library";
import { isVideoResourceFile } from "../../../../lib/resource-library-categories";

export const dynamic = "force-dynamic";

const productVideoCategory = "제품 소개·시연";

async function filesBelow(folderId: string, depth = 0): Promise<DriveFile[]> {
  const children = await listDriveChildren(folderId);
  if (depth >= 2) return children.filter((file) => !isDriveFolder(file));
  const nested = await Promise.all(children.map((file) =>
    isDriveFolder(file) ? filesBelow(file.id, depth + 1) : Promise.resolve([file]),
  ));
  return nested.flat();
}

export async function POST() {
  try {
    const member = await requireAdminMember();
    const d1 = await ensureResourceLibraryReady();
    const libraryFolderId = await ensureDrivePath(["03_자료실게시판"]);
    const categoryFolders = (await listDriveChildren(libraryFolderId))
      .filter((file) => isDriveFolder(file) && String(file.name ?? "") === productVideoCategory);

    let recovered = 0;
    const recoveredTitles = new Set<string>();
    for (const categoryFolder of categoryFolders) {
      for (const file of await filesBelow(categoryFolder.id)) {
        const fileName = String(file.name ?? "").trim();
        if (!file.id || !fileName || !isVideoResourceFile(fileName, file.mimeType)) continue;
        const exists = await d1
          .prepare("SELECT id FROM resource_attachments WHERE drive_file_id = ? LIMIT 1")
          .bind(file.id)
          .first<{ id: number }>();
        if (exists) continue;

        const title = fileName.replace(/\.[^.]+$/u, "").trim().slice(0, 160);
        const createdBy = Math.max(1, Number(file.appProperties?.createdBy) || member.id);
        const creator = await d1
          .prepare("SELECT display_name FROM members WHERE id = ? LIMIT 1")
          .bind(createdBy)
          .first<{ display_name: string }>();
        let post = await d1
          .prepare(`SELECT * FROM resource_posts
            WHERE archived_at IS NULL AND category = ? AND title = ?
            ORDER BY id DESC LIMIT 1`)
          .bind(productVideoCategory, title)
          .first<ResourcePostRow>();
        if (!post) {
          post = await d1
            .prepare(`INSERT INTO resource_posts (category, title, content, created_by, created_by_name)
              VALUES (?, ?, ?, ?, ?) RETURNING *`)
            .bind(
              productVideoCategory,
              title,
              "Google Drive 제품 소개·시연 폴더에서 자동 등록된 영상입니다.",
              createdBy,
              creator?.display_name || member.displayName,
            )
            .first<ResourcePostRow>();
        }
        if (!post) continue;
        const inserted = await d1
          .prepare(`INSERT OR IGNORE INTO resource_attachments (
            post_id, original_name, drive_file_id, drive_folder_id, mime_type,
            size_bytes, created_by, created_by_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            post.id,
            fileName.slice(0, 240),
            file.id,
            file.parents?.[0] || categoryFolder.id,
            file.mimeType || "application/octet-stream",
            Number(file.size) || 0,
            createdBy,
            creator?.display_name || member.displayName,
          )
          .run();
        if (Number(inserted.meta.changes) === 1) {
          recovered += 1;
          recoveredTitles.add(title);
        }
      }
    }
    return Response.json({ recovered, titles: [...recoveredTitles].slice(0, 30) });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
