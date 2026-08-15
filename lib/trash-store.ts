import { getD1 } from "../db";
import type { Member } from "./collaboration";
import {
  getQuotationBucket,
  parseStoredStringList,
  type QuotationDocumentRow,
} from "./quotation-documents";
import { chunkValues } from "./d1-bulk";

export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RESTORE_STATEMENT_CHUNK_SIZE = 40;
export const TRASH_OBJECT_DELETE_CHUNK_SIZE = 50;

export type TrashEntityType = "record" | "institution" | "quotation";

export type TrashSnapshot = {
  tables: Record<string, Record<string, unknown>[]>;
};

export type TrashBatchRow = {
  id: string;
  entity_type: TrashEntityType;
  display_name: string;
  item_count: number;
  snapshot_json: string;
  stored_bytes: number;
  deleted_by_member_id: number;
  deleted_by_name: string;
  deleted_at: string;
  expires_at: string;
  restored_at: string | null;
  restored_by_member_id: number | null;
};

const allowedRestoreTables = new Set([
  "institution_registry",
  "activities",
  "organization_schedules",
  "activity_authors",
  "activity_assignment_history",
  "activity_review_acknowledgements",
  "manager_alert_acknowledgements",
  "ai_recommendations",
  "organization_locations",
  "sales_campaign_targets",
  "equipment_projects",
  "equipment_items",
  "quotation_documents",
  "accounting_settlements",
  "accounting_settlement_history",
  "accounting_commission_entries",
  "accounting_commission_entry_history",
  "accounting_collection_receipts",
]);

const restoreOrder = [
  "institution_registry",
  "activities",
  "organization_schedules",
  "activity_authors",
  "activity_assignment_history",
  "activity_review_acknowledgements",
  "manager_alert_acknowledgements",
  "ai_recommendations",
  "organization_locations",
  "sales_campaign_targets",
  "equipment_projects",
  "equipment_items",
  "quotation_documents",
  "accounting_settlements",
  "accounting_settlement_history",
  "accounting_commission_entries",
  "accounting_commission_entry_history",
  "accounting_collection_receipts",
];

const createTableSql = `
  CREATE TABLE IF NOT EXISTS deletion_batches (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    item_count INTEGER NOT NULL DEFAULT 0,
    snapshot_json TEXT NOT NULL,
    stored_bytes INTEGER NOT NULL DEFAULT 0,
    deleted_by_member_id INTEGER NOT NULL,
    deleted_by_name TEXT NOT NULL DEFAULT '',
    deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    restored_at TEXT,
    restored_by_member_id INTEGER
  )
`;

export async function ensureTrashReady() {
  const d1 = getD1();
  await d1.prepare(createTableSql).run();
  await d1
    .prepare(
      `CREATE INDEX IF NOT EXISTS deletion_batches_active_idx
       ON deletion_batches (restored_at, expires_at, deleted_at)`,
    )
    .run();
  return d1;
}

function parseSnapshot(value: string): TrashSnapshot {
  try {
    const parsed = JSON.parse(value) as TrashSnapshot;
    return parsed && typeof parsed === "object" && parsed.tables
      ? parsed
      : { tables: {} };
  } catch {
    return { tables: {} };
  }
}

export function trashSnapshotStoredBytes(snapshot: TrashSnapshot) {
  return (snapshot.tables.quotation_documents || []).reduce(
    (total, row) => total + Math.max(0, Number(row.total_size) || 0),
    0,
  );
}

export async function createTrashBatch(
  d1: ReturnType<typeof getD1>,
  member: Pick<Member, "id" | "displayName">,
  entityType: TrashEntityType,
  displayName: string,
  itemCount: number,
  snapshot: TrashSnapshot,
) {
  const id = crypto.randomUUID();
  await d1
    .prepare(
      `INSERT INTO deletion_batches (
        id, entity_type, display_name, item_count, snapshot_json, stored_bytes,
        deleted_by_member_id, deleted_by_name, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATETIME('now', '+${TRASH_RETENTION_DAYS} days'))`,
    )
    .bind(
      id,
      entityType,
      displayName.slice(0, 300),
      Math.max(0, itemCount),
      JSON.stringify(snapshot),
      trashSnapshotStoredBytes(snapshot),
      member.id,
      member.displayName,
    )
    .run();
  return id;
}

function quotationKeys(snapshot: TrashSnapshot) {
  return (snapshot.tables.quotation_documents || []).flatMap((rawRow) => {
    const row = rawRow as unknown as QuotationDocumentRow;
    return [row.original_key, ...parseStoredStringList(row.page_keys_json)].filter(
      Boolean,
    );
  });
}

export async function permanentlyDeleteTrashBatch(
  d1: ReturnType<typeof getD1>,
  row: Pick<TrashBatchRow, "id" | "snapshot_json">,
) {
  const snapshot = parseSnapshot(row.snapshot_json);
  const keys = quotationKeys(snapshot);
  for (const chunk of chunkValues(keys, TRASH_OBJECT_DELETE_CHUNK_SIZE)) {
    await getQuotationBucket().delete(chunk);
  }
  await d1.prepare("DELETE FROM deletion_batches WHERE id = ?").bind(row.id).run();
}

export async function purgeExpiredTrash(d1: ReturnType<typeof getD1>) {
  const expired = await d1
    .prepare(
      `SELECT id, snapshot_json
       FROM deletion_batches
       WHERE restored_at IS NULL AND DATETIME(expires_at) <= DATETIME('now')
       ORDER BY expires_at ASC
       LIMIT 25`,
    )
    .all<Pick<TrashBatchRow, "id" | "snapshot_json">>();
  for (const row of expired.results) {
    await permanentlyDeleteTrashBatch(d1, row);
  }
}

function quotedIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function restoreTrashBatch(
  d1: ReturnType<typeof getD1>,
  row: TrashBatchRow,
  memberId: number,
) {
  const snapshot = parseSnapshot(row.snapshot_json);
  for (const table of restoreOrder) {
    if (!allowedRestoreTables.has(table)) continue;
    const records = snapshot.tables[table] || [];
    if (!records.length) continue;
    const tableInfo = await d1
      .prepare(`PRAGMA table_info(${quotedIdentifier(table)})`)
      .all<{ name: string; pk: number }>();
    const primaryKeys = tableInfo.results
      .filter((column) => Number(column.pk) > 0)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map((column) => column.name);
    if (!primaryKeys.length) continue;
    for (const record of records) {
      if (primaryKeys.some((column) => record[column] === undefined)) continue;
      const existing = await d1
        .prepare(
          `SELECT 1 AS found FROM ${quotedIdentifier(table)} WHERE ${primaryKeys
            .map((column) => `${quotedIdentifier(column)} = ?`)
            .join(" AND ")} LIMIT 1`,
        )
        .bind(...primaryKeys.map((column) => record[column] ?? null))
        .first<{ found: number }>();
      if (existing?.found) {
        throw new Error(
          "같은 자료가 이미 존재해 자동으로 덮어쓰지 않았습니다. 기존 자료를 확인한 뒤 다시 복원해 주세요.",
        );
      }
    }
  }
  const statements = [];
  for (const table of restoreOrder) {
    if (!allowedRestoreTables.has(table)) continue;
    for (const record of snapshot.tables[table] || []) {
      const columns = Object.keys(record);
      if (!columns.length) continue;
      const placeholders = columns.map(() => "?").join(", ");
      statements.push(
        d1
          .prepare(
            `INSERT OR IGNORE INTO ${quotedIdentifier(table)}
             (${columns.map(quotedIdentifier).join(", ")})
             VALUES (${placeholders})`,
          )
          .bind(...columns.map((column) => record[column] ?? null)),
      );
    }
  }
  for (const chunk of chunkValues(
    statements,
    TRASH_RESTORE_STATEMENT_CHUNK_SIZE,
  )) {
    await d1.batch(chunk);
  }
  await d1
    .prepare(
      `UPDATE deletion_batches
       SET restored_at = CURRENT_TIMESTAMP, restored_by_member_id = ?
       WHERE id = ? AND restored_at IS NULL`,
    )
    .bind(memberId, row.id)
    .run();
}

export function trashBatchJson(row: TrashBatchRow) {
  return {
    id: row.id,
    entityType: row.entity_type,
    displayName: row.display_name,
    itemCount: Number(row.item_count) || 0,
    storedBytes: Number(row.stored_bytes) || 0,
    deletedByName: row.deleted_by_name,
    deletedAt: row.deleted_at,
    expiresAt: row.expires_at,
  };
}
