import { getD1, isPostgresDatabase } from "../db";
import { getPostgresObjectStorage } from "./postgres-object-storage";

export type ProductComparisonDocumentRow = {
  id: number;
  equipment_item_id: number;
  catalog_product_id: string;
  product_name: string;
  original_name: string;
  drive_file_id: string;
  drive_folder_id: string;
  mime_type: string;
  size_bytes: number;
  created_by_name: string;
  created_at: string;
  archived_at: string | null;
  product_id?: string;
  object_key?: string;
};

let readyPromise: Promise<ReturnType<typeof getD1>> | null = null;

export function ensureProductComparisonDocumentsReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const d1 = getD1();
      await d1.prepare(
        `CREATE TABLE IF NOT EXISTS product_comparison_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          equipment_item_id INTEGER NOT NULL DEFAULT 0,
          catalog_product_id TEXT NOT NULL DEFAULT '',
          product_name TEXT NOT NULL DEFAULT '',
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
      const columns = await d1.prepare(
        "PRAGMA table_info(product_comparison_documents)",
      ).all<{ name: string }>();
      const columnNames = new Set(columns.results.map((column: { name: string }) => column.name));
      const upgrades = [
        ["equipment_item_id", "INTEGER NOT NULL DEFAULT 0"],
        ["catalog_product_id", "TEXT NOT NULL DEFAULT ''"],
        ["product_name", "TEXT NOT NULL DEFAULT ''"],
        ["drive_file_id", "TEXT NOT NULL DEFAULT ''"],
        ["drive_folder_id", "TEXT NOT NULL DEFAULT ''"],
        ["mime_type", "TEXT NOT NULL DEFAULT ''"],
        ["size_bytes", "INTEGER NOT NULL DEFAULT 0"],
        ["created_by", "INTEGER"],
        ["created_by_name", "TEXT NOT NULL DEFAULT ''"],
        ["created_at", "TEXT NOT NULL DEFAULT ''"],
        ["archived_at", "TEXT"],
      ] as const;
      for (const [name, definition] of upgrades) {
        if (columnNames.has(name)) continue;
        await d1.prepare(
          `ALTER TABLE product_comparison_documents ADD COLUMN ${name} ${definition}`,
        ).run();
      }
      if (isPostgresDatabase()) {
        const legacyRelaxations = [];
        if (columnNames.has("product_id")) {
          legacyRelaxations.push(
            d1.prepare(
              "ALTER TABLE product_comparison_documents ALTER COLUMN product_id DROP NOT NULL",
            ),
          );
        }
        if (columnNames.has("object_key")) {
          legacyRelaxations.push(
            d1.prepare(
              "ALTER TABLE product_comparison_documents ALTER COLUMN object_key DROP NOT NULL",
            ),
          );
        }
        if (legacyRelaxations.length) await d1.batch(legacyRelaxations);
      }
      await d1.prepare(
        "CREATE INDEX IF NOT EXISTS idx_product_comparison_documents_item ON product_comparison_documents(equipment_item_id, archived_at)",
      ).run();
      await d1.prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_product_comparison_documents_catalog_active
         ON product_comparison_documents(catalog_product_id)
         WHERE catalog_product_id <> '' AND archived_at IS NULL`,
      ).run();
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
