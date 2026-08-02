import { getD1 } from "../db";
import { ensureRecordsReady } from "./records-store";
import { getPostgresObjectStorage } from "./postgres-object-storage";

export const AWARD_VENDOR_MAX_FILE_BYTES = 12 * 1024 * 1024;

const schema = [
  `CREATE TABLE IF NOT EXISTS award_vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    business_number TEXT NOT NULL DEFAULT '',
    representative_name TEXT NOT NULL DEFAULT '',
    business_type TEXT NOT NULL DEFAULT '',
    business_item TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    bank_name TEXT NOT NULL DEFAULT '',
    account_number TEXT NOT NULL DEFAULT '',
    account_holder TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    contact_title TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL,
    updated_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS award_vendors_company_idx
   ON award_vendors (company_name COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS award_vendor_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER NOT NULL,
    document_type TEXT NOT NULL,
    original_name TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    extracted_json TEXT NOT NULL DEFAULT '{}',
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS award_vendor_documents_vendor_idx
   ON award_vendor_documents (vendor_id, document_type, created_at)`,
  `CREATE TABLE IF NOT EXISTS award_vendor_migrations (
    migration_key TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

const PARTNER_ACTIVITY_MIGRATION_KEY =
  "2026-07-23-partner-activities-to-award-vendors";

export type AwardVendorRow = Record<string, unknown> & {
  id: number;
  company_name: string;
};

export type AwardVendorDocumentRow = {
  id: number;
  vendor_id: number;
  document_type: string;
  original_name: string;
  object_key: string;
  content_type: string;
  size_bytes: number;
  extracted_json: string;
  created_at: string;
};

type VendorBucket = {
  put(key: string, value: Blob | ArrayBuffer | ArrayBufferView | ReadableStream, options?: {
    httpMetadata?: { contentType?: string; contentDisposition?: string };
    customMetadata?: Record<string, string>;
  }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; size: number; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string | string[]): Promise<void>;
};

let awardVendorsReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function migrateLegacyPartnerActivities(
  d1: ReturnType<typeof getD1>,
) {
  const migrated = await d1
    .prepare(
      "SELECT 1 AS found FROM award_vendor_migrations WHERE migration_key = ? LIMIT 1",
    )
    .bind(PARTNER_ACTIVITY_MIGRATION_KEY)
    .first();
  if (migrated) return;

  await d1.batch([
    d1.prepare(
      `INSERT OR IGNORE INTO award_vendors (
         company_name, phone, email, contact_name, contact_phone, contact_email,
         notes, created_by, updated_by, created_at, updated_at
       )
       SELECT
         current.organization,
         current.contact_phone,
         current.contact_email,
         current.contact_name,
         current.contact_phone,
         current.contact_email,
         current.notes,
         1,
         1,
         current.created_at,
         current.updated_at
       FROM activities AS current
       INNER JOIN (
         SELECT organization, MAX(id) AS latest_id
         FROM activities
         WHERE source_chat = '수주업체 관리'
           AND activity_type IN ('협력사 등록', '협력사 등록 해제')
         GROUP BY organization
       ) AS latest ON latest.latest_id = current.id
       WHERE current.activity_type = '협력사 등록'
         AND current.organization <> ''`,
    ),
    d1.prepare(
      `DELETE FROM activities
       WHERE source_chat = '수주업체 관리'
         AND activity_type IN ('협력사 등록', '협력사 등록 해제')`,
    ),
    d1
      .prepare(
        "INSERT INTO award_vendor_migrations (migration_key) VALUES (?)",
      )
      .bind(PARTNER_ACTIVITY_MIGRATION_KEY),
  ]);
}

async function ensureAwardVendorActiveColumn(
  d1: ReturnType<typeof getD1>,
) {
  const columns = await d1
    .prepare("PRAGMA table_info(award_vendors)")
    .all<{ name: string }>();
  if (
    !columns.results.some(
      (column: { name: string }) => column.name === "is_active",
    )
  ) {
    await d1
      .prepare(
        "ALTER TABLE award_vendors ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
      )
      .run();
  }
}

export function ensureAwardVendorsReady() {
  if (!awardVendorsReadyPromise) {
    awardVendorsReadyPromise = ensureRecordsReady()
      .then(async (d1) => {
        await d1.batch(schema.map((statement) => d1.prepare(statement)));
        await ensureAwardVendorActiveColumn(d1);
        await migrateLegacyPartnerActivities(d1);
        return d1;
      })
      .catch((error) => {
        awardVendorsReadyPromise = null;
        throw error;
      });
  }
  return awardVendorsReadyPromise;
}

export function getAwardVendorBucket() {
  return getPostgresObjectStorage() as VendorBucket;
}

export function awardVendorDocumentJson(row: AwardVendorDocumentRow) {
  let extracted: Record<string, unknown> = {};
  try { extracted = JSON.parse(row.extracted_json || "{}"); } catch { /* ignore malformed legacy data */ }
  return {
    id: Number(row.id),
    vendorId: Number(row.vendor_id),
    documentType: row.document_type,
    originalName: row.original_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    extracted,
    createdAt: row.created_at,
    url: `/api/award-vendors/documents?id=${row.id}&file=1`,
  };
}

export function awardVendorJson(row: Record<string, unknown>, documents: AwardVendorDocumentRow[] = []) {
  const field = (name: string) => String(row[name] ?? "");
  return {
    id: Number(row.id), companyName: field("company_name"), businessNumber: field("business_number"),
    representativeName: field("representative_name"), businessType: field("business_type"),
    businessItem: field("business_item"), address: field("address"), phone: field("phone"), email: field("email"),
    bankName: field("bank_name"), accountNumber: field("account_number"), accountHolder: field("account_holder"),
    contactName: field("contact_name"), contactTitle: field("contact_title"), contactPhone: field("contact_phone"),
    contactEmail: field("contact_email"), notes: field("notes"), updatedAt: field("updated_at"),
    documents: documents.map(awardVendorDocumentJson),
  };
}
