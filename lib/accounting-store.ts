import { getD1 } from "../db";
import { ensureEquipmentReady } from "./equipment-store";
import { ensureRecordsReady } from "./records-store";
import {
  analyticsBusinessRoundKey,
  groupLatestAuthoritativeAwardRows,
  isCompletedWhizzupAwardRow,
} from "./analytics-business-rounds";

const ACCOUNTING_TOTAL_KEY = "award-total";
const D1_SAFE_IN_CHUNK_SIZE = 50;
const LEGACY_RECEIPT_LEDGER_MIGRATION_KEY =
  "accounting_legacy_settlement_receipts_migrated_v1";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS accounting_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL UNIQUE,
    confirmed_contract_amount INTEGER,
    deposit_amount INTEGER NOT NULL DEFAULT 0,
    interim_amount INTEGER NOT NULL DEFAULT 0,
    balance_amount INTEGER NOT NULL DEFAULT 0,
    paid_amount INTEGER NOT NULL DEFAULT 0,
    actual_cost INTEGER,
    confirmed_commission INTEGER,
    confirmed_margin INTEGER,
    manufacturer_commission_expected INTEGER,
    manufacturer_commission_received INTEGER NOT NULL DEFAULT 0,
    manufacturer_commission_received_date TEXT,
    consortium_payment_expected INTEGER,
    consortium_payment_paid INTEGER NOT NULL DEFAULT 0,
    consortium_payment_date TEXT,
    other_cost INTEGER NOT NULL DEFAULT 0,
    commission_receivable INTEGER NOT NULL DEFAULT 0,
    consortium_payable INTEGER NOT NULL DEFAULT 0,
    net_revenue INTEGER,
    recognized_date TEXT,
    invoice_status TEXT NOT NULL DEFAULT '미발행',
    invoice_date TEXT,
    settlement_status TEXT NOT NULL DEFAULT '확인 필요',
    accounting_note TEXT NOT NULL DEFAULT '',
    confirmed INTEGER NOT NULL DEFAULT 0,
    updated_by INTEGER NOT NULL,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS accounting_settlements_recognized_idx ON accounting_settlements (recognized_date, settlement_status)",
  `CREATE TABLE IF NOT EXISTS accounting_settlement_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settlement_id INTEGER NOT NULL,
    activity_id INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    changed_fields_json TEXT NOT NULL DEFAULT '[]',
    changed_by INTEGER NOT NULL,
    changed_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS accounting_history_activity_idx ON accounting_settlement_history (activity_id, created_at)",
  `CREATE TABLE IF NOT EXISTS accounting_commission_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL,
    manufacturer_key TEXT NOT NULL,
    manufacturer_name TEXT NOT NULL,
    commission_sales_amount INTEGER,
    revenue_recognition_date TEXT,
    invoice_status TEXT NOT NULL DEFAULT '미발행',
    invoice_date TEXT,
    commission_collected_amount INTEGER NOT NULL DEFAULT 0,
    collection_date TEXT,
    direct_cost INTEGER NOT NULL DEFAULT 0,
    consortium_settlement_confirmed INTEGER,
    consortium_paid_amount INTEGER NOT NULL DEFAULT 0,
    consortium_paid_date TEXT,
    receivable_balance INTEGER NOT NULL DEFAULT 0,
    consortium_payable INTEGER NOT NULL DEFAULT 0,
    contribution_margin INTEGER,
    accounting_status TEXT NOT NULL DEFAULT '확인 필요',
    voucher_note TEXT NOT NULL DEFAULT '',
    confirmed INTEGER NOT NULL DEFAULT 0,
    workflow_excluded INTEGER DEFAULT 0,
    workflow_excluded_at TEXT,
    workflow_excluded_by INTEGER,
    workflow_excluded_by_name TEXT,
    legacy_source_settlement_id INTEGER,
    updated_by INTEGER NOT NULL DEFAULT 0,
    updated_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(activity_id, manufacturer_key),
    UNIQUE(legacy_source_settlement_id)
  )`,
  "CREATE INDEX IF NOT EXISTS accounting_commission_entries_activity_idx ON accounting_commission_entries (activity_id, manufacturer_name)",
  "CREATE INDEX IF NOT EXISTS accounting_commission_entries_period_idx ON accounting_commission_entries (revenue_recognition_date, accounting_status)",
  `CREATE TABLE IF NOT EXISTS accounting_commission_entry_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    activity_id INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    changed_fields_json TEXT NOT NULL DEFAULT '[]',
    changed_by INTEGER NOT NULL,
    changed_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS accounting_commission_history_entry_idx ON accounting_commission_entry_history (entry_id, created_at)",
  `CREATE TABLE IF NOT EXISTS accounting_collection_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    activity_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    collection_date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    legacy_source_entry_id INTEGER,
    created_by INTEGER NOT NULL DEFAULT 0,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(legacy_source_entry_id)
  )`,
  "CREATE INDEX IF NOT EXISTS accounting_collection_receipts_entry_idx ON accounting_collection_receipts (entry_id, collection_date, id)",
  "CREATE INDEX IF NOT EXISTS accounting_collection_receipts_activity_idx ON accounting_collection_receipts (activity_id, collection_date)",
] as const;

let accountingReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function initializeAccounting() {
  await ensureRecordsReady();
  await ensureEquipmentReady();
  const d1 = getD1();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
  const columns = await d1
    .prepare("PRAGMA table_info(accounting_settlements)")
    .all<{ name: string }>();
  const existing = new Set(
    columns.results.map((column: { name: string }) => column.name),
  );
  const upgrades = [
    ["manufacturer_commission_expected", "ALTER TABLE accounting_settlements ADD COLUMN manufacturer_commission_expected INTEGER"],
    ["manufacturer_commission_received", "ALTER TABLE accounting_settlements ADD COLUMN manufacturer_commission_received INTEGER NOT NULL DEFAULT 0"],
    ["manufacturer_commission_received_date", "ALTER TABLE accounting_settlements ADD COLUMN manufacturer_commission_received_date TEXT"],
    ["consortium_payment_expected", "ALTER TABLE accounting_settlements ADD COLUMN consortium_payment_expected INTEGER"],
    ["consortium_payment_paid", "ALTER TABLE accounting_settlements ADD COLUMN consortium_payment_paid INTEGER NOT NULL DEFAULT 0"],
    ["consortium_payment_date", "ALTER TABLE accounting_settlements ADD COLUMN consortium_payment_date TEXT"],
    ["other_cost", "ALTER TABLE accounting_settlements ADD COLUMN other_cost INTEGER NOT NULL DEFAULT 0"],
    ["commission_receivable", "ALTER TABLE accounting_settlements ADD COLUMN commission_receivable INTEGER NOT NULL DEFAULT 0"],
    ["consortium_payable", "ALTER TABLE accounting_settlements ADD COLUMN consortium_payable INTEGER NOT NULL DEFAULT 0"],
    ["net_revenue", "ALTER TABLE accounting_settlements ADD COLUMN net_revenue INTEGER"],
  ] as const;
  const pending = upgrades
    .filter(([column]) => !existing.has(column))
    .map(([, statement]) => d1.prepare(statement));
  if (pending.length) await d1.batch(pending);
  const entryColumns = await d1
    .prepare("PRAGMA table_info(accounting_commission_entries)")
    .all<{ name: string }>();
  const existingEntryColumns = new Set(
    entryColumns.results.map((column: { name: string }) => column.name),
  );
  const entryUpgrades = [
    [
      "legacy_source_settlement_id",
      "ALTER TABLE accounting_commission_entries ADD COLUMN legacy_source_settlement_id INTEGER",
    ],
    [
      "workflow_excluded",
      "ALTER TABLE accounting_commission_entries ADD COLUMN workflow_excluded INTEGER DEFAULT 0",
    ],
    [
      "workflow_excluded_at",
      "ALTER TABLE accounting_commission_entries ADD COLUMN workflow_excluded_at TEXT",
    ],
    [
      "workflow_excluded_by",
      "ALTER TABLE accounting_commission_entries ADD COLUMN workflow_excluded_by INTEGER",
    ],
    [
      "workflow_excluded_by_name",
      "ALTER TABLE accounting_commission_entries ADD COLUMN workflow_excluded_by_name TEXT",
    ],
  ] as const;
  const pendingEntryUpgrades = entryUpgrades
    .filter(([column]) => !existingEntryColumns.has(column))
    .map(([, statement]) => d1.prepare(statement));
  if (pendingEntryUpgrades.length) await d1.batch(pendingEntryUpgrades);
  await d1
    .prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS accounting_commission_entries_legacy_unique
      ON accounting_commission_entries (legacy_source_settlement_id)
    `)
    .run();
  return d1;
}

export async function linkEquipmentProjectsToWhizzupAwards(
  d1: ReturnType<typeof getD1>,
) {
  const [projectResult, awardResult] = await Promise.all([
    d1
      .prepare(`
        SELECT
          ep.id,
          ep.activity_id,
          ep.organization,
          ep.business_round
        FROM equipment_projects ep
      `)
      .all<Record<string, unknown>>(),
    d1
      .prepare(`
        SELECT
          id AS activity_id,
          activity_date,
          award_completed_date,
          award_status,
          award_stage,
          organization,
          business_round
        FROM activities
        WHERE award_status IN ('위즈업 수주', '협력사 수주', '타업체 수주')
        ORDER BY activity_date DESC, id DESC
      `)
      .all<Record<string, unknown>>(),
  ]);
  const latestAwards = groupLatestAuthoritativeAwardRows(awardResult.results);
  const authoritativeActivityIdsByBusiness = new Map<string, number[]>();
  for (const row of awardResult.results) {
    const businessKey = analyticsBusinessRoundKey(
      row.organization,
      row.business_round,
    );
    const activityIds =
      authoritativeActivityIdsByBusiness.get(businessKey) ?? [];
    activityIds.push(Number(row.activity_id));
    authoritativeActivityIdsByBusiness.set(businessKey, activityIds);
  }
  const completedAwardByBusiness = new Map(
    latestAwards.filter(isCompletedWhizzupAwardRow).map((row) => [
        String(row.business_key ?? ""),
        row,
      ]),
  );
  const updates: ReturnType<typeof d1.prepare>[] = [];
  for (const project of projectResult.results) {
    const businessKey = analyticsBusinessRoundKey(
      project.organization,
      project.business_round,
    );
    const completedAward = completedAwardByBusiness.get(businessKey);
    if (completedAward) {
      const representativeActivityId = Number(completedAward.activity_id);
      const linkedActivityId = Number(project.activity_id);
      if (linkedActivityId === representativeActivityId) continue;
      const groupedActivityIds = new Set(
        Array.isArray(completedAward.grouped_activity_ids)
          ? completedAward.grouped_activity_ids.map(Number)
          : [representativeActivityId],
      );
      const hasAuthorityBoundary =
        (authoritativeActivityIdsByBusiness.get(businessKey)?.length ?? 0) >
        groupedActivityIds.size;
      if (
        (linkedActivityId === 0 && hasAuthorityBoundary) ||
        (linkedActivityId > 0 && !groupedActivityIds.has(linkedActivityId))
      ) {
        continue;
      }
      updates.push(
        d1
          .prepare(
            "UPDATE equipment_projects SET activity_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          )
          .bind(representativeActivityId, Number(project.id)),
      );
    }
  }
  for (let index = 0; index < updates.length; index += 100) {
    await d1.batch(updates.slice(index, index + 100));
  }
}

export function ensureAccountingReady() {
  if (!accountingReadyPromise) {
    accountingReadyPromise = initializeAccounting().catch((error) => {
      accountingReadyPromise = null;
      throw error;
    });
  }
  return accountingReadyPromise;
}

function migratedCollectionDate(row: Record<string, unknown>) {
  for (const value of [
    row.manufacturer_commission_received_date,
    row.recognized_date,
    row.updated_at,
    row.activity_date,
    row.created_at,
  ]) {
    const date = String(value ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  }
  return "1970-01-01";
}

async function insertAwardTotalEntries(
  d1: ReturnType<typeof getD1>,
  activityIds: number[],
) {
  const uniqueIds = [...new Set(activityIds)].filter(
    (activityId) => Number.isInteger(activityId) && activityId > 0,
  );
  for (
    let index = 0;
    index < uniqueIds.length;
    index += D1_SAFE_IN_CHUNK_SIZE
  ) {
    const batchIds = uniqueIds.slice(
      index,
      index + D1_SAFE_IN_CHUNK_SIZE,
    );
    await d1
      .prepare(`
        INSERT OR IGNORE INTO accounting_commission_entries (
          activity_id, manufacturer_key, manufacturer_name
        )
        SELECT id, ?, '수주 전체'
        FROM activities
        WHERE id IN (${batchIds.map(() => "?").join(", ")})
      `)
      .bind(ACCOUNTING_TOTAL_KEY, ...batchIds)
      .run();
  }
}

/**
 * 구형 정산/수수료 스냅샷의 실수금액을 신규 receipt 원장으로 한 번만 이관한다.
 * 신규 원장에 수금 내역이 이미 있으면 그것을 우선하고, 최신 수주 결정이
 * 협력사/타업체인 사업의 과거 자료는 이동·삭제하지 않아 화면에 재노출되지 않는다.
 */
export async function ensureLegacyReceiptLedgerMigration(
  d1: ReturnType<typeof getD1>,
) {
  const marker = await d1
    .prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1")
    .bind(LEGACY_RECEIPT_LEDGER_MIGRATION_KEY)
    .first<{ value: string }>();
  if (marker?.value === "done") return;

  const [
    activityResult,
    settlementResult,
    legacyEntryResult,
    settlementLinkResult,
  ] =
    await Promise.all([
      d1
        .prepare(`
          SELECT
            id AS activity_id,
            activity_date,
            award_completed_date,
            award_status,
            award_stage,
            organization,
            business_round
          FROM activities
          ORDER BY activity_date DESC, id DESC
        `)
        .all<Record<string, unknown>>(),
      d1
        .prepare(`
          SELECT
            s.id AS settlement_id,
            s.activity_id,
            s.manufacturer_commission_received,
            s.manufacturer_commission_received_date,
            s.recognized_date,
            s.accounting_note,
            s.updated_by,
            s.updated_by_name,
            s.created_at,
            s.updated_at,
            a.activity_date,
            a.organization,
            a.business_round
          FROM accounting_settlements s
          JOIN activities a ON a.id = s.activity_id
          WHERE s.manufacturer_commission_received > 0
            AND a.award_status = '위즈업 수주'
          ORDER BY s.updated_at DESC, s.id DESC
        `)
        .all<Record<string, unknown>>(),
      d1
        .prepare(`
          SELECT
            e.id,
            e.activity_id,
            e.manufacturer_key,
            e.commission_collected_amount,
            e.collection_date,
            e.voucher_note,
            e.legacy_source_settlement_id,
            e.updated_by,
            e.updated_by_name,
            e.created_at,
            e.updated_at,
            a.activity_date,
            a.organization,
            a.business_round
          FROM accounting_commission_entries e
          JOIN activities a ON a.id = e.activity_id
          WHERE e.commission_collected_amount > 0
            AND a.award_status = '위즈업 수주'
          ORDER BY e.updated_at DESC, e.id DESC
        `)
        .all<Record<string, unknown>>(),
      d1
        .prepare(`
          SELECT e.id, e.legacy_source_settlement_id
          FROM accounting_commission_entries e
          JOIN activities a ON a.id = e.activity_id
          WHERE e.legacy_source_settlement_id IS NOT NULL
            AND a.award_status = '위즈업 수주'
        `)
        .all<Record<string, unknown>>(),
    ]);

  const activityBusinessKey = new Map<number, string>();
  for (const row of activityResult.results) {
    activityBusinessKey.set(
      Number(row.activity_id),
      analyticsBusinessRoundKey(row.organization, row.business_round),
    );
  }

  const latestAwards = groupLatestAuthoritativeAwardRows(
    activityResult.results,
  );
  const eligibleTargetByBusiness = new Map(
    latestAwards.filter(isCompletedWhizzupAwardRow).map((row) => [
      String(row.business_key ?? ""),
      Number(row.activity_id),
    ]),
  );
  const latestAuthoritativeByBusiness = new Map(
    latestAwards.map((row) => [String(row.business_key ?? ""), row]),
  );
  const currentActivityIdsByBusiness = new Map(
    latestAwards.map((row) => [
      String(row.business_key ?? ""),
      new Set(
        Array.isArray(row.grouped_activity_ids)
          ? row.grouped_activity_ids.map(Number)
          : [Number(row.activity_id)],
      ),
    ]),
  );

  const settlementByBusiness = new Map<string, Record<string, unknown>>();
  for (const row of settlementResult.results) {
    const businessKey = analyticsBusinessRoundKey(
      row.organization,
      row.business_round,
    );
    const latestAward = latestAuthoritativeByBusiness.get(businessKey);
    if (
      !latestAward ||
      !isCompletedWhizzupAwardRow(latestAward) ||
      !currentActivityIdsByBusiness
        .get(businessKey)
        ?.has(Number(row.activity_id))
    ) {
      continue;
    }
    if (!settlementByBusiness.has(businessKey)) {
      settlementByBusiness.set(businessKey, row);
    }
  }
  const legacyEntriesByBusiness = new Map<
    string,
    Record<string, unknown>[]
  >();
  const legacyEntryBySettlementId = new Map<number, number>();
  for (const row of settlementLinkResult.results) {
    const settlementId = Number(row.legacy_source_settlement_id);
    if (settlementId > 0 && !legacyEntryBySettlementId.has(settlementId)) {
      legacyEntryBySettlementId.set(settlementId, Number(row.id));
    }
  }
  for (const row of legacyEntryResult.results) {
    const businessKey = analyticsBusinessRoundKey(
      row.organization,
      row.business_round,
    );
    const latestAward = latestAuthoritativeByBusiness.get(businessKey);
    if (
      !latestAward ||
      !isCompletedWhizzupAwardRow(latestAward) ||
      !currentActivityIdsByBusiness
        .get(businessKey)
        ?.has(Number(row.activity_id))
    ) {
      continue;
    }
    const entries = legacyEntriesByBusiness.get(businessKey) ?? [];
    entries.push(row);
    legacyEntriesByBusiness.set(businessKey, entries);
    const settlementId = Number(row.legacy_source_settlement_id);
    if (settlementId > 0 && !legacyEntryBySettlementId.has(settlementId)) {
      legacyEntryBySettlementId.set(settlementId, Number(row.id));
    }
  }

  const migrationBusinesses = new Set([
    ...settlementByBusiness.keys(),
    ...legacyEntriesByBusiness.keys(),
  ]);
  const targetActivityByBusiness = new Map<string, number>();
  for (const businessKey of migrationBusinesses) {
    const eligibleTarget = eligibleTargetByBusiness.get(businessKey);
    if (eligibleTarget) {
      targetActivityByBusiness.set(businessKey, eligibleTarget);
    }
  }
  await insertAwardTotalEntries(d1, [...targetActivityByBusiness.values()]);

  const totalEntryResult = await d1
    .prepare(`
      SELECT id, activity_id
      FROM accounting_commission_entries
      WHERE manufacturer_key = ?
    `)
    .bind(ACCOUNTING_TOTAL_KEY)
    .all<Record<string, unknown>>();
  const totalEntryByActivity = new Map<number, number>(
    totalEntryResult.results.map((row: Record<string, unknown>) => [
      Number(row.activity_id),
      Number(row.id),
    ] as const),
  );

  const settlementLinkUpdates: ReturnType<typeof d1.prepare>[] = [];
  for (const [businessKey, settlement] of settlementByBusiness) {
    const settlementId = Number(settlement.settlement_id);
    if (legacyEntryBySettlementId.has(settlementId)) continue;
    const targetActivityId = targetActivityByBusiness.get(businessKey);
    const targetEntryId = targetActivityId
      ? totalEntryByActivity.get(targetActivityId)
      : undefined;
    if (!targetEntryId || settlementId < 1) continue;
    settlementLinkUpdates.push(
      d1
        .prepare(`
          UPDATE accounting_commission_entries
          SET legacy_source_settlement_id = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND legacy_source_settlement_id IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM accounting_commission_entries linked
              WHERE linked.legacy_source_settlement_id = ?
            )
        `)
        .bind(settlementId, targetEntryId, settlementId),
    );
    legacyEntryBySettlementId.set(settlementId, targetEntryId);
  }
  for (let index = 0; index < settlementLinkUpdates.length; index += 100) {
    await d1.batch(settlementLinkUpdates.slice(index, index + 100));
  }

  const receiptResult = await d1
    .prepare(`
      SELECT r.id, r.entry_id, r.activity_id, e.activity_id AS entry_activity_id
      FROM accounting_collection_receipts r
      JOIN accounting_commission_entries e ON e.id = r.entry_id
      JOIN activities a ON a.id = e.activity_id
      JOIN activities receipt_activity ON receipt_activity.id = r.activity_id
      WHERE a.award_status = '위즈업 수주'
        AND receipt_activity.award_status = '위즈업 수주'
      ORDER BY r.id
    `)
    .all<Record<string, unknown>>();
  const businessesWithReceipts = new Set<string>();
  const receiptMoves: ReturnType<typeof d1.prepare>[] = [];
  for (const row of receiptResult.results) {
    const receiptActivityId = Number(row.activity_id);
    const entryActivityId = Number(row.entry_activity_id);
    const businessKey =
      activityBusinessKey.get(receiptActivityId) ??
      activityBusinessKey.get(entryActivityId);
    if (!businessKey) continue;

    // 최신 확정 상태가 위즈업 납품 완료인 사업만 대표 수주 원장으로 모은다.
    // 협력사/타업체로 바뀐 사업의 과거 원장은 그대로 보존한다.
    const latestAward = latestAuthoritativeByBusiness.get(businessKey);
    if (!latestAward || !isCompletedWhizzupAwardRow(latestAward)) {
      businessesWithReceipts.add(businessKey);
      continue;
    }
    const currentActivityIds = currentActivityIdsByBusiness.get(businessKey);
    if (
      !currentActivityIds?.has(receiptActivityId) ||
      !currentActivityIds.has(entryActivityId)
    ) {
      continue;
    }
    businessesWithReceipts.add(businessKey);
    const targetActivityId = eligibleTargetByBusiness.get(businessKey);
    const targetEntryId = targetActivityId
      ? totalEntryByActivity.get(targetActivityId)
      : undefined;
    if (
      !targetActivityId ||
      !targetEntryId ||
      (Number(row.entry_id) === targetEntryId &&
        receiptActivityId === targetActivityId)
    ) {
      continue;
    }
    receiptMoves.push(
      d1
        .prepare(`
          UPDATE accounting_collection_receipts
          SET entry_id = ?,
              activity_id = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(targetEntryId, targetActivityId, Number(row.id)),
    );
  }
  for (let index = 0; index < receiptMoves.length; index += 100) {
    await d1.batch(receiptMoves.slice(index, index + 100));
  }

  const receiptInserts: ReturnType<typeof d1.prepare>[] = [];
  for (const businessKey of migrationBusinesses) {
    if (businessesWithReceipts.has(businessKey)) continue;
    const targetActivityId = targetActivityByBusiness.get(businessKey);
    const targetEntryId = targetActivityId
      ? totalEntryByActivity.get(targetActivityId)
      : undefined;
    if (!targetActivityId || !targetEntryId) continue;

    const settlement = settlementByBusiness.get(businessKey);
    if (settlement) {
      const settlementId = Number(settlement.settlement_id);
      const legacySourceEntryId =
        legacyEntryBySettlementId.get(settlementId) ?? targetEntryId;
      const legacyNote = String(settlement.accounting_note ?? "").trim();
      receiptInserts.push(
        d1
          .prepare(`
            INSERT OR IGNORE INTO accounting_collection_receipts (
              entry_id, activity_id, amount, collection_date, note,
              legacy_source_entry_id, created_by, created_by_name,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(
            targetEntryId,
            targetActivityId,
            Math.max(
              0,
              Math.round(
                Number(settlement.manufacturer_commission_received ?? 0),
              ),
            ),
            migratedCollectionDate(settlement),
            legacyNote
              ? `기존 회계 실수금 이관 · ${legacyNote}`
              : "기존 회계 실수금 이관",
            legacySourceEntryId,
            Number(settlement.updated_by ?? 0),
            String(settlement.updated_by_name ?? ""),
            String(settlement.updated_at ?? settlement.created_at ?? ""),
            String(settlement.updated_at ?? settlement.created_at ?? ""),
          ),
      );
      continue;
    }

    for (const entry of legacyEntriesByBusiness.get(businessKey) ?? []) {
      receiptInserts.push(
        d1
          .prepare(`
            INSERT OR IGNORE INTO accounting_collection_receipts (
              entry_id, activity_id, amount, collection_date, note,
              legacy_source_entry_id, created_by, created_by_name,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(
            targetEntryId,
            targetActivityId,
            Math.max(
              0,
              Math.round(Number(entry.commission_collected_amount ?? 0)),
            ),
            migratedCollectionDate(entry),
            String(entry.voucher_note ?? "").trim() ||
              "기존 회계 입력 이관",
            Number(entry.id),
            Number(entry.updated_by ?? 0),
            String(entry.updated_by_name ?? ""),
            String(entry.updated_at ?? entry.created_at ?? ""),
            String(entry.updated_at ?? entry.created_at ?? ""),
          ),
      );
    }
  }
  for (let index = 0; index < receiptInserts.length; index += 100) {
    await d1.batch(receiptInserts.slice(index, index + 100));
  }

  await d1
    .prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, 'done', CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(LEGACY_RECEIPT_LEDGER_MIGRATION_KEY)
    .run();
}

function parseKoreanNumber(value: string) {
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  let total = 0;
  let remainder = value;
  const units = [
    ["천", 1_000],
    ["백", 100],
    ["십", 10],
  ] as const;
  units.forEach(([label, multiplier]) => {
    const matched = remainder.match(new RegExp(`(\\d+(?:\\.\\d+)?)${label}`));
    if (!matched) return;
    total += Number(matched[1]) * multiplier;
    remainder = remainder.replace(matched[0], "");
  });
  const plain = Number(remainder);
  return total + (Number.isFinite(plain) ? plain : 0);
}

export function parseStoredMoney(value: unknown) {
  const source = String(value ?? "").trim();
  if (!source || source === "미정") return 0;
  let remainder = source.replaceAll(",", "").replace(/\s+/g, "").replace(/원/g, "");
  let total = 0;
  let hasUnit = false;
  const eok = remainder.match(/^(.+?)억/);
  if (eok) {
    total += parseKoreanNumber(eok[1]) * 100_000_000;
    remainder = remainder.slice(eok[0].length);
    hasUnit = true;
  }
  const man = remainder.match(/^(.+?)만/);
  if (man) {
    total += parseKoreanNumber(man[1]) * 10_000;
    remainder = remainder.slice(man[0].length);
    hasUnit = true;
  }
  if (hasUnit) return Math.round(total);
  const numeric = Number(remainder.replace(/[^\d.\-]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(Math.abs(numeric) > 0 && Math.abs(numeric) < 1_000_000 ? numeric * 10_000 : numeric);
}
