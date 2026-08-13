import { getD1, isPostgresDatabase } from "../db";
import type { Member } from "./collaboration";
import { ensureRecordsReady } from "./records-store";

export const ACTIVITY_CHANGE_SCOPE_AWARDS = "awards";
export const ACTIVITY_CHANGE_SCOPE_PRE_AWARDS = "pre_awards";
export const ACTIVITY_CHANGE_SCOPES = [
  ACTIVITY_CHANGE_SCOPE_AWARDS,
  ACTIVITY_CHANGE_SCOPE_PRE_AWARDS,
] as const;
export type ActivityChangeScope = (typeof ACTIVITY_CHANGE_SCOPES)[number];
export const ACTIVITY_CHANGE_MAX_OPERATION_ID_LENGTH = 100;
export const ACTIVITY_CHANGE_WRITE_CHUNK_SIZE = 8;
export const ACTIVITY_CHANGE_UNDO_CHUNK_SIZE = 10;
export const ACTIVITY_CHANGE_ID_QUERY_CHUNK_SIZE = 99;

export const ACTIVITY_CHANGE_TRACKED_COLUMNS = [
  "activity_date",
  "date_confidence",
  "budget_type",
  "budget_amount",
  "progress_manager",
  "contact_name",
  "follow_up_date",
  "follow_up_required",
  "next_action",
  "status",
  "award_status",
  "award_company",
  "execution_type",
  "consortium_company",
  "award_stage",
  "award_completed_date",
] as const;

export type ActivityChangeTrackedColumn =
  (typeof ACTIVITY_CHANGE_TRACKED_COLUMNS)[number];

export function isActivityChangeScope(
  value: unknown,
): value is ActivityChangeScope {
  return ACTIVITY_CHANGE_SCOPES.includes(value as ActivityChangeScope);
}

export type ActivityChangeBatchRow = {
  id: string;
  scope: string;
  operation_label: string;
  operation_total: number;
  requested_fields_json: string;
  actor_member_id: number;
  actor_name: string;
  item_count: number;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  undone_at: string | null;
  undone_by_member_id: number | null;
  undone_by_name: string;
  undo_result_json: string;
};

export type ActivityChangeItemRow = {
  id: number;
  batch_id: string;
  activity_id: number;
  organization: string;
  requested_fields_json: string;
  changed_fields_json: string;
  before_json: string;
  after_json: string;
  created_at: string;
  undone_at: string | null;
  undone_by_member_id: number | null;
  undone_by_name: string;
  undo_status: string;
  undo_result_json: string;
};

const createBatchTableSql = `
  CREATE TABLE IF NOT EXISTS activity_change_batches (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'awards',
    operation_label TEXT NOT NULL DEFAULT '',
    operation_total INTEGER NOT NULL DEFAULT 0,
    requested_fields_json TEXT NOT NULL DEFAULT '[]',
    actor_member_id INTEGER NOT NULL,
    actor_name TEXT NOT NULL DEFAULT '',
    item_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'in_progress',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    undone_at TEXT,
    undone_by_member_id INTEGER,
    undone_by_name TEXT NOT NULL DEFAULT '',
    undo_result_json TEXT NOT NULL DEFAULT '{}'
  )
`;

const createItemTableSql = `
  CREATE TABLE IF NOT EXISTS activity_change_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    activity_id INTEGER NOT NULL,
    organization TEXT NOT NULL DEFAULT '',
    requested_fields_json TEXT NOT NULL DEFAULT '[]',
    changed_fields_json TEXT NOT NULL DEFAULT '[]',
    before_json TEXT NOT NULL DEFAULT '{}',
    after_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    undone_at TEXT,
    undone_by_member_id INTEGER,
    undone_by_name TEXT NOT NULL DEFAULT '',
    undo_status TEXT NOT NULL DEFAULT 'pending',
    undo_result_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (batch_id, activity_id)
  )
`;

let activityChangeLedgerReadyPromise:
  | Promise<ReturnType<typeof getD1>>
  | null = null;

async function initializeActivityChangeLedger() {
  await ensureRecordsReady();
  const d1 = getD1();
  await d1.batch([
    d1.prepare(createBatchTableSql),
    d1.prepare(createItemTableSql),
    d1.prepare(
      `CREATE INDEX IF NOT EXISTS activity_change_batches_scope_created_idx
       ON activity_change_batches (scope, created_at DESC)`,
    ),
    d1.prepare(
      `CREATE INDEX IF NOT EXISTS activity_change_items_batch_idx
       ON activity_change_items (batch_id, id)`,
    ),
  ]);
  return d1;
}

export function ensureActivityChangeLedgerReady() {
  if (!activityChangeLedgerReadyPromise) {
    activityChangeLedgerReadyPromise = initializeActivityChangeLedger().catch(
      (error) => {
        activityChangeLedgerReadyPromise = null;
        throw error;
      },
    );
  }
  return activityChangeLedgerReadyPromise;
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parseChangedFields(value: unknown) {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter((field): field is ActivityChangeTrackedColumn =>
          ACTIVITY_CHANGE_TRACKED_COLUMNS.includes(
            field as ActivityChangeTrackedColumn,
          ),
        ),
      ),
    ];
  } catch {
    return [];
  }
}

export function valuesEqual(left: unknown, right: unknown) {
  return Object.is(left ?? null, right ?? null);
}

function fullSnapshotSql(alias: string) {
  if (!isPostgresDatabase()) {
    return `json_object(${ACTIVITY_CHANGE_TRACKED_COLUMNS.flatMap((column) => [
      `'${column}'`,
      `${alias}.${column}`,
    ]).join(", ")})`;
  }
  return `jsonb_build_object(${ACTIVITY_CHANGE_TRACKED_COLUMNS.flatMap((column) => [
    `'${column}'`,
    `${alias}.${column}`,
  ]).join(", ")})::text`;
}

function currentValueSql(column: ActivityChangeTrackedColumn) {
  return `(SELECT ${column} FROM current_activity)`;
}

function valueChangedSql(column: ActivityChangeTrackedColumn) {
  if (!isPostgresDatabase()) {
    return `json_extract(before_json, '$.${column}') IS NOT ${currentValueSql(column)}`;
  }
  return `(before_json::jsonb -> '${column}') IS DISTINCT FROM to_jsonb(${currentValueSql(column)})`;
}

function actualSnapshotSql(useBeforeValue: boolean) {
  if (!isPostgresDatabase()) {
    const snapshotEntries = ACTIVITY_CHANGE_TRACKED_COLUMNS.flatMap((column) => [
      `'${column}'`,
      useBeforeValue
        ? `json_extract(before_json, '$.${column}')`
        : currentValueSql(column),
    ]);
    const unchangedPaths = ACTIVITY_CHANGE_TRACKED_COLUMNS.map(
      (column) =>
        `CASE WHEN ${valueChangedSql(column)}
         THEN '$.__keep_${column}'
         ELSE '$.${column}' END`,
    );
    return `json_remove(
      json_object(${snapshotEntries.join(", ")}),
      ${unchangedPaths.join(", ")}
    )`;
  }
  const entries = ACTIVITY_CHANGE_TRACKED_COLUMNS.map((column) =>
    `('${column}', ${
      useBeforeValue
        ? `before_json::jsonb -> '${column}'`
        : `to_jsonb(${currentValueSql(column)})`
    }, ${valueChangedSql(column)})`,
  ).join(", ");
  return `(SELECT COALESCE(
      jsonb_object_agg(entry_key, entry_value) FILTER (WHERE changed),
      '{}'::jsonb
    )::text
    FROM (VALUES ${entries}) AS entries(entry_key, entry_value, changed))`;
}

function changedFieldsSql() {
  if (!isPostgresDatabase()) {
    const legacyValues = ACTIVITY_CHANGE_TRACKED_COLUMNS.map(
      (column) =>
        `CASE WHEN ${valueChangedSql(column)} THEN '${column}' ELSE NULL END`,
    ).join(", ");
    return `(SELECT COALESCE(json_group_array(value), '[]')
      FROM json_each(json_array(${legacyValues}))
      WHERE value IS NOT NULL)`;
  }
  const values = ACTIVITY_CHANGE_TRACKED_COLUMNS.map(
    (column) =>
      `(CASE WHEN ${valueChangedSql(column)} THEN '${column}' ELSE NULL END)`,
  ).join(", ");
  return `(SELECT COALESCE(
      jsonb_agg(value) FILTER (WHERE value IS NOT NULL),
      '[]'::jsonb
    )::text
    FROM (VALUES ${values}) AS changed(value))`;
}

export function prepareActivityChangeBatchUpsert(
  d1: ReturnType<typeof getD1>,
  input: {
    operationId: string;
    operationLabel: string;
    operationTotal: number;
    requestedFieldsJson: string;
    scope?: ActivityChangeScope;
    member: Pick<Member, "id" | "displayName">;
  },
) {
  return d1
    .prepare(
      `INSERT INTO activity_change_batches (
         id, scope, operation_label, operation_total, requested_fields_json,
         actor_member_id, actor_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         operation_total = GREATEST(activity_change_batches.operation_total, excluded.operation_total),
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      input.operationId,
      input.scope ?? ACTIVITY_CHANGE_SCOPE_AWARDS,
      input.operationLabel,
      input.operationTotal,
      input.requestedFieldsJson,
      input.member.id,
      input.member.displayName,
    );
}

export function prepareActivityChangeSnapshot(
  d1: ReturnType<typeof getD1>,
  input: {
    operationId: string;
    activityId: number;
    requestedFieldsJson: string;
  },
) {
  return d1
    .prepare(
      `INSERT OR IGNORE INTO activity_change_items (
         batch_id, activity_id, organization, requested_fields_json,
         changed_fields_json, before_json, after_json
       )
       SELECT ?, a.id, a.organization, ?, '[]', ${fullSnapshotSql("a")}, '{}'
       FROM activities a
       WHERE a.id = ?`,
    )
    .bind(
      input.operationId,
      input.requestedFieldsJson,
      input.activityId,
    );
}

export function prepareActivityChangeFinalization(
  d1: ReturnType<typeof getD1>,
  operationId: string,
  activityId: number,
) {
  return d1
    .prepare(
      `WITH current_activity AS (
         SELECT *
         FROM activities
         WHERE id = ?
       )
       UPDATE activity_change_items
       SET changed_fields_json = ${changedFieldsSql()},
           before_json = ${actualSnapshotSql(true)},
           after_json = ${actualSnapshotSql(false)}
       WHERE batch_id = ? AND activity_id = ?`,
    )
    .bind(activityId, operationId, activityId);
}

export function prepareActivityChangeBatchProgress(
  d1: ReturnType<typeof getD1>,
  operationId: string,
) {
  return d1
    .prepare(
      `UPDATE activity_change_batches
       SET item_count = (
             SELECT COUNT(*)
             FROM activity_change_items
             WHERE batch_id = activity_change_batches.id
           ),
           status = CASE
             WHEN (
               SELECT COUNT(*)
               FROM activity_change_items
               WHERE batch_id = activity_change_batches.id
             ) >= operation_total
             THEN 'applied'
             ELSE 'in_progress'
           END,
           completed_at = CASE
             WHEN (
               SELECT COUNT(*)
               FROM activity_change_items
               WHERE batch_id = activity_change_batches.id
             ) >= operation_total
             THEN CAST(CURRENT_TIMESTAMP AS TEXT)
             ELSE completed_at
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(operationId);
}

export async function getActivityChangeBatch(
  d1: ReturnType<typeof getD1>,
  operationId: string,
) {
  return d1
    .prepare("SELECT * FROM activity_change_batches WHERE id = ?")
    .bind(operationId)
    .first<ActivityChangeBatchRow>();
}

export async function existingActivityChangeItemIds(
  d1: ReturnType<typeof getD1>,
  operationId: string,
  ids: number[],
) {
  const existing = new Set<number>();
  for (
    let start = 0;
    start < ids.length;
    start += ACTIVITY_CHANGE_ID_QUERY_CHUNK_SIZE
  ) {
    const chunk = ids.slice(
      start,
      start + ACTIVITY_CHANGE_ID_QUERY_CHUNK_SIZE,
    );
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await d1
      .prepare(
        `SELECT activity_id
         FROM activity_change_items
         WHERE batch_id = ? AND activity_id IN (${placeholders})`,
      )
      .bind(operationId, ...chunk)
      .all<{ activity_id: number }>();
    result.results.forEach((row) => existing.add(Number(row.activity_id)));
  }
  return existing;
}
