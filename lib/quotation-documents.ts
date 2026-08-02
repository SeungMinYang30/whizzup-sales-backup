import { getD1 } from "../db";
import { getPostgresObjectStorage } from "./postgres-object-storage";

export const QUOTATION_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;
export const QUOTATION_MAX_PDF_BYTES = 20 * 1024 * 1024;
export const QUOTATION_MAX_PAGES = 40;

const createTableSql = `
  CREATE TABLE IF NOT EXISTS quotation_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization TEXT NOT NULL,
    business_round INTEGER NOT NULL DEFAULT 1,
    company_name TEXT NOT NULL DEFAULT '',
    quote_amount TEXT NOT NULL DEFAULT '',
    quote_date TEXT NOT NULL DEFAULT '',
    original_name TEXT NOT NULL,
    original_key TEXT NOT NULL UNIQUE,
    original_size INTEGER NOT NULL DEFAULT 0,
    page_keys_json TEXT NOT NULL DEFAULT '[]',
    page_sizes_json TEXT NOT NULL DEFAULT '[]',
    page_count INTEGER NOT NULL DEFAULT 0,
    total_size INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

type QuotationBucket = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream,
    options?: {
      httpMetadata?: { contentType?: string; contentDisposition?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: ArrayBuffer;
    size: number;
    httpMetadata?: { contentType?: string };
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
  delete(keys: string | string[]): Promise<void>;
};

export type QuotationDocumentRow = {
  id: number;
  organization: string;
  business_round: number;
  company_name: string;
  quote_amount: string;
  quote_date: string;
  original_name: string;
  original_key: string;
  original_size: number;
  page_keys_json: string;
  page_sizes_json: string;
  page_count: number;
  total_size: number;
  created_by: number;
  created_by_name: string;
  created_at: string;
};

export function getQuotationBucket() {
  return getPostgresObjectStorage() as QuotationBucket;
}

export async function ensureQuotationDocumentsReady() {
  const d1 = getD1();
  await d1.prepare(createTableSql).run();
  const columns = await d1
    .prepare("PRAGMA table_info(quotation_documents)")
    .all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "business_round")) {
    await d1
      .prepare(
        "ALTER TABLE quotation_documents ADD COLUMN business_round INTEGER NOT NULL DEFAULT 1",
      )
      .run();
  }
  await d1
    .prepare(
      `CREATE INDEX IF NOT EXISTS quotation_documents_organization_idx
       ON quotation_documents (organization, created_at)`,
    )
    .run();
  return d1;
}

export function parseStoredStringList(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export async function quotationStorageStats(
  d1: Awaited<ReturnType<typeof ensureQuotationDocumentsReady>>,
) {
  const row = await d1
    .prepare(
      `SELECT
         COALESCE(SUM(total_size), 0) AS used_bytes,
         COUNT(*) AS document_count,
         COALESCE(SUM(page_count), 0) AS page_count
       FROM quotation_documents`,
    )
    .first<{
      used_bytes: number;
      document_count: number;
      page_count: number;
    }>();
  const trashTable = await d1
    .prepare(
      `SELECT COUNT(*) AS count
       FROM sqlite_master
       WHERE type = 'table' AND name = 'deletion_batches'`,
    )
    .first<{ count: number }>();
  const trashed = Number(trashTable?.count)
    ? await d1
        .prepare(
          `SELECT COALESCE(SUM(stored_bytes), 0) AS stored_bytes
           FROM deletion_batches
           WHERE restored_at IS NULL`,
        )
        .first<{ stored_bytes: number }>()
    : null;
  const trashedBytes = Math.max(0, Number(trashed?.stored_bytes) || 0);
  const usedBytes = Math.max(0, Number(row?.used_bytes) || 0) + trashedBytes;
  const remainingBytes = Math.max(
    0,
    QUOTATION_STORAGE_LIMIT_BYTES - usedBytes,
  );
  return {
    usedBytes,
    remainingBytes,
    limitBytes: QUOTATION_STORAGE_LIMIT_BYTES,
    usedPercent: Math.min(
      100,
      (usedBytes / QUOTATION_STORAGE_LIMIT_BYTES) * 100,
    ),
    remainingPercent: Math.max(
      0,
      (remainingBytes / QUOTATION_STORAGE_LIMIT_BYTES) * 100,
    ),
    documentCount: Number(row?.document_count) || 0,
    pageCount: Number(row?.page_count) || 0,
    trashedBytes,
  };
}

export function quotationDocumentJson(row: QuotationDocumentRow) {
  const pageKeys = parseStoredStringList(row.page_keys_json);
  return {
    id: row.id,
    organization: row.organization,
    businessRound: Math.max(1, Number(row.business_round) || 1),
    companyName: row.company_name,
    quoteAmount: row.quote_amount,
    quoteDate: row.quote_date,
    originalName: row.original_name,
    originalSize: Number(row.original_size) || 0,
    pageCount: Number(row.page_count) || pageKeys.length,
    totalSize: Number(row.total_size) || 0,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    originalUrl: `/api/quotation-documents?id=${row.id}&file=original`,
    downloadUrl: `/api/quotation-documents?id=${row.id}&file=original&download=1`,
    pageUrls: pageKeys.map(
      (_, index) =>
        `/api/quotation-documents?id=${row.id}&file=page&page=${index + 1}`,
    ),
  };
}
