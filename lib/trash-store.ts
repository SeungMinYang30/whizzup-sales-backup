import { getD1 } from "../db";
import type { Member } from "./collaboration";
import {
  getQuotationBucket,
  parseStoredStringList,
  type QuotationDocumentRow,
} from "./quotation-documents";

export const TRASH_RETENTION_DAYS = 30;

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
  "activities",
  "activity_authors",
  "activity_assignment_history",
  "activity_review_acknowledgements",
  "ai_recommendations",
  "organization_locations",
  "sales_campaign_targets",
  "equipment_projects",
  "equipment_items",
  "quotation_documents",
]);

const restoreOrder = [
  "activities",
  "activity_authors",
  "activity_assignment_history",
  "activity_review_acknowledgements",
  "ai_recommendations",
  "organization_locations",
  "sales_campaign_targets",
  "equipment_projects",
  "equipment_items",
  "quotation_documents",
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
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    restored_at TIMESTAMPTZ,
    restored_by_member_id BIGINT
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP + INTERVAL '${TRASH_RETENTION_DAYS} days')`,
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
  if (keys.length) {
    await getQuotationBucket().delete(keys);
  }
  await d1.prepare("DELETE FROM deletion_batches WHERE id = ?").bind(row.id).run();
}

export async function purgeExpiredTrash(d1: ReturnType<typeof getD1>) {
  const expired = await d1
    .prepare(
      `SELECT id, snapshot_json
       FROM deletion_batches
       WHERE restored_at IS NULL AND expires_at <= CURRENT_TIMESTAMP
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
            `INSERT INTO ${quotedIdentifier(table)}
             (${columns.map(quotedIdentifier).join(", ")})
             VALUES (${placeholders})
             ON CONFLICT DO NOTHING`,
          )
          .bind(...columns.map((column) => record[column] ?? null)),
      );
    }
  }
  statements.push(
    d1
      .prepare(
        `UPDATE deletion_batches
         SET restored_at = CURRENT_TIMESTAMP, restored_by_member_id = ?
         WHERE id = ? AND restored_at IS NULL`,
      )
      .bind(memberId, row.id),
  );
  await d1.batch(statements);
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
