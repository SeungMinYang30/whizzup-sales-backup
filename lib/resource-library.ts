import { getD1 } from "../db";

export const RESOURCE_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const RESOURCE_TOTAL_MAX_BYTES = 100 * 1024 * 1024;
export const RESOURCE_MAX_FILES = 10;
export const PRODUCT_RESOURCE_MAX_FILES = 300;

const statements = [
  `CREATE TABLE IF NOT EXISTS resource_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL DEFAULT '기타',
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at TEXT,
    archived_by INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS resource_posts_active_idx
   ON resource_posts (archived_at, created_at, id)`,
  `CREATE TABLE IF NOT EXISTS resource_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    drive_file_id TEXT NOT NULL UNIQUE,
    drive_folder_id TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    source_fingerprint TEXT NOT NULL DEFAULT '',
    source_relative_path TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES resource_posts(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS resource_attachments_post_idx
   ON resource_attachments (post_id, created_at, id)`,
];

let readyPromise: Promise<ReturnType<typeof getD1>> | null = null;

export type ResourcePostRow = {
  id: number;
  category: string;
  title: string;
  content: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: number | null;
};

export type ResourceAttachmentRow = {
  id: number;
  post_id: number;
  original_name: string;
  drive_file_id: string;
  drive_folder_id: string;
  mime_type: string;
  size_bytes: number;
  source_fingerprint: string;
  source_relative_path: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
};

export async function ensureResourceLibraryReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d1 = getD1();
      await d1.batch(statements.map((statement) => d1.prepare(statement)));
      const attachmentColumns = await d1
        .prepare("PRAGMA table_info(resource_attachments)")
        .all<{ name: string }>();
      if (!attachmentColumns.results.some((column: { name: string }) => column.name === "source_fingerprint")) {
        await d1.prepare(
          "ALTER TABLE resource_attachments ADD COLUMN source_fingerprint TEXT NOT NULL DEFAULT ''",
        ).run();
      }
      if (!attachmentColumns.results.some((column: { name: string }) => column.name === "source_relative_path")) {
        await d1.prepare(
          "ALTER TABLE resource_attachments ADD COLUMN source_relative_path TEXT NOT NULL DEFAULT ''",
        ).run();
      }
      await d1.prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS resource_attachments_source_fingerprint_idx
         ON resource_attachments (source_fingerprint)
         WHERE source_fingerprint <> ''`,
      ).run();
      return d1;
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

export function resourceAttachmentJson(row: ResourceAttachmentRow) {
  return {
    id: Number(row.id),
    postId: Number(row.post_id),
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes) || 0,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    downloadUrl: `/api/resources?downloadId=${row.id}`,
  };
}

export function resourcePostJson(
  row: ResourcePostRow,
  attachments: ResourceAttachmentRow[],
) {
  return {
    id: Number(row.id),
    category: row.category,
    title: row.title,
    content: row.content,
    createdBy: Number(row.created_by),
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments: attachments.map(resourceAttachmentJson),
  };
}
