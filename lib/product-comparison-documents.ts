import { getD1 } from "../db";
import { getPostgresObjectStorage } from "./postgres-object-storage";

export const PRODUCT_COMPARISON_MAX_BYTES = 20 * 1024 * 1024;

const createTableSql = `
  CREATE TABLE IF NOT EXISTS product_comparison_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

let readyPromise: Promise<ReturnType<typeof getD1>> | null = null;

export type ProductComparisonDocumentRow = {
  id: number;
  product_id: string;
  original_name: string;
  object_key: string;
  mime_type: string;
  size_bytes: number;
  created_by: number;
  created_by_name: string;
  created_at: string;
};

export async function ensureProductComparisonDocumentsReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d1 = getD1();
      await d1.prepare(createTableSql).run();
      await d1
        .prepare(
          `CREATE INDEX IF NOT EXISTS product_comparison_documents_product_idx
           ON product_comparison_documents (product_id, created_at)`,
        )
        .run();
      return d1;
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

export function getProductComparisonBucket() {
  return getPostgresObjectStorage();
}

export function productComparisonDocumentJson(
  row: ProductComparisonDocumentRow,
) {
  return {
    id: Number(row.id),
    productId: row.product_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes) || 0,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}
