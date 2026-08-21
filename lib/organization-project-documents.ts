import { getD1 } from "../db";

// Files are streamed to Google Drive in Vercel-safe chunks, so combined
// drawings no longer need to stay below the old single-request 50 MiB limit.
export const ORGANIZATION_PROJECT_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export type OrganizationProjectDocumentRow = {
  id: number;
  organization: string;
  business_round: number;
  document_type: string;
  original_name: string;
  drive_file_id: string;
  drive_folder_id: string;
  mime_type: string;
  size_bytes: number;
  created_by: number | null;
  created_by_name: string;
  created_at: string;
  archived_at: string | null;
};

let readyPromise: Promise<ReturnType<typeof getD1>> | null = null;

export function ensureOrganizationProjectDocumentsReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d1 = getD1();
      await d1.prepare(
        `CREATE TABLE IF NOT EXISTS organization_project_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          organization TEXT NOT NULL,
          business_round INTEGER NOT NULL DEFAULT 1,
          document_type TEXT NOT NULL DEFAULT '기타',
          original_name TEXT NOT NULL,
          drive_file_id TEXT NOT NULL UNIQUE,
          drive_folder_id TEXT NOT NULL DEFAULT '',
          mime_type TEXT NOT NULL DEFAULT '',
          size_bytes INTEGER NOT NULL DEFAULT 0,
          created_by INTEGER,
          created_by_name TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          archived_at TEXT
        )`,
      ).run();
      await d1.prepare(
        `CREATE INDEX IF NOT EXISTS idx_organization_project_documents_scope
         ON organization_project_documents(organization, business_round, archived_at)`,
      ).run();
      return d1;
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}
