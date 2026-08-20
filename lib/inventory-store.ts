import { getD1 } from "../db";
import { ensureCollaborationReady } from "./collaboration";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS inventory_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specification TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '대',
    current_stock INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_by_name TEXT NOT NULL DEFAULT '',
    updated_by INTEGER,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inventory_products_name_idx
   ON inventory_products (name)`,
  `CREATE TABLE IF NOT EXISTS inventory_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL,
    quantity_delta INTEGER NOT NULL,
    resulting_stock INTEGER NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    transaction_date TEXT NOT NULL,
    created_by INTEGER,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS inventory_transactions_product_date_idx
   ON inventory_transactions (product_id, transaction_date, id)`,
  `CREATE INDEX IF NOT EXISTS inventory_transactions_date_idx
   ON inventory_transactions (transaction_date, id)`,
];

let inventoryReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function initializeInventory() {
  const d1 = getD1();
  await ensureCollaborationReady();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
  await d1.batch([
    d1
      .prepare(
        `INSERT OR IGNORE INTO inventory_products
         (name, specification, unit, low_stock_threshold)
         VALUES (?, ?, '대', 1)`,
      )
      .bind("3D모션", "3D 모션 스포츠 장비"),
    d1
      .prepare(
        `INSERT OR IGNORE INTO inventory_products
         (name, specification, unit, low_stock_threshold)
         VALUES (?, ?, '대', 1)`,
      )
      .bind("터치테이블", "터치형 테이블 장비"),
  ]);
  await d1.prepare("PRAGMA optimize").run();
  return d1;
}

export function ensureInventoryReady() {
  if (!inventoryReadyPromise) {
    inventoryReadyPromise = initializeInventory().catch((error) => {
      inventoryReadyPromise = null;
      throw error;
    });
  }
  return inventoryReadyPromise;
}

export function inventoryProductJson(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    name: String(row.name ?? ""),
    specification: String(row.specification ?? ""),
    unit: String(row.unit ?? "대"),
    currentStock: Number(row.current_stock ?? 0),
    lowStockThreshold: Number(row.low_stock_threshold ?? 0),
    lastTransactionAt: String(row.last_transaction_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function inventoryTransactionJson(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    productName: String(row.product_name ?? ""),
    unit: String(row.unit ?? "대"),
    type: String(row.transaction_type ?? ""),
    quantityDelta: Number(row.quantity_delta ?? 0),
    resultingStock: Number(row.resulting_stock ?? 0),
    reference: String(row.reference ?? ""),
    note: String(row.note ?? ""),
    transactionDate: String(row.transaction_date ?? ""),
    createdByName: String(row.created_by_name ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}
