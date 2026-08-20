import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

register(new URL("./typescript-resolver.mjs", import.meta.url));
register(new URL("./accounting-store-test-resolver.mjs", import.meta.url));

const {
  ensureLegacyReceiptLedgerMigration,
  linkEquipmentProjectsToWhizzupAwards,
} = await import(
  "../lib/accounting-store.ts"
);

const source = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const D1_BIND_VARIABLE_LIMIT = 100;

class SqliteD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    if (bindings.length > D1_BIND_VARIABLE_LIMIT) {
      throw new Error(
        `D1_ERROR: too many SQL variables (${bindings.length} > ${D1_BIND_VARIABLE_LIMIT})`,
      );
    }
    return new SqliteD1Statement(this.database, this.sql, bindings);
  }

  async all() {
    return {
      results: this.database.prepare(this.sql).all(...this.bindings),
    };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }
}

class SqliteD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createMigrationDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE activities (
      id INTEGER PRIMARY KEY,
      activity_date TEXT NOT NULL,
      award_completed_date TEXT,
      award_status TEXT NOT NULL,
      award_stage TEXT NOT NULL,
      organization TEXT NOT NULL,
      business_round INTEGER NOT NULL
    );
    CREATE TABLE accounting_settlements (
      id INTEGER PRIMARY KEY,
      activity_id INTEGER NOT NULL,
      manufacturer_commission_received INTEGER NOT NULL DEFAULT 0,
      manufacturer_commission_received_date TEXT,
      recognized_date TEXT,
      accounting_note TEXT NOT NULL DEFAULT '',
      updated_by INTEGER NOT NULL DEFAULT 0,
      updated_by_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE accounting_commission_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      manufacturer_key TEXT NOT NULL,
      manufacturer_name TEXT NOT NULL,
      commission_collected_amount INTEGER NOT NULL DEFAULT 0,
      collection_date TEXT,
      voucher_note TEXT NOT NULL DEFAULT '',
      legacy_source_settlement_id INTEGER,
      updated_by INTEGER NOT NULL DEFAULT 0,
      updated_by_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(activity_id, manufacturer_key),
      UNIQUE(legacy_source_settlement_id)
    );
    CREATE TABLE accounting_collection_receipts (
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
    );
    CREATE TABLE equipment_projects (
      id INTEGER PRIMARY KEY,
      activity_id INTEGER,
      organization TEXT NOT NULL,
      business_round INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return { database, d1: new SqliteD1(database) };
}

test("구형 settlement 실수금은 별도 표식으로 신규 receipt 원장에 한 번만 이관한다", () => {
  const store = source("../lib/accounting-store.ts");
  const migration = store.slice(
    store.indexOf("export async function ensureLegacyReceiptLedgerMigration"),
    store.indexOf("function parseKoreanNumber"),
  );

  assert.match(
    store,
    /accounting_legacy_settlement_receipts_migrated_v1/,
  );
  assert.doesNotMatch(
    store,
    /accounting_award_total_receipts_migrated_v1/,
  );
  assert.match(migration, /s\.manufacturer_commission_received > 0/);
  assert.match(migration, /s\.manufacturer_commission_received_date/);
  assert.match(migration, /INSERT OR IGNORE INTO accounting_collection_receipts/);
  assert.match(migration, /businessesWithReceipts\.has\(businessKey\)/);
  assert.match(migration, /legacy_source_entry_id/);
  assert.match(migration, /marker\?\.value === "done"/);
  assert.match(
    migration,
    /VALUES \(\?, 'done', CURRENT_TIMESTAMP\)/,
  );
  assert.doesNotMatch(migration, /DELETE FROM/);
});

test("기존 운영 DB에도 settlement 연결 컬럼과 고유 인덱스를 보강한다", () => {
  const store = source("../lib/accounting-store.ts");
  const initialization = store.slice(
    store.indexOf("async function initializeAccounting"),
    store.indexOf("export async function linkEquipmentProjectsToWhizzupAwards"),
  );

  assert.match(
    initialization,
    /PRAGMA table_info\(accounting_commission_entries\)/,
  );
  assert.match(
    initialization,
    /ALTER TABLE accounting_commission_entries ADD COLUMN legacy_source_settlement_id INTEGER/,
  );
  assert.match(
    initialization,
    /CREATE UNIQUE INDEX IF NOT EXISTS accounting_commission_entries_legacy_unique/,
  );
});

test("대량의 구형 수금 이관도 D1 쿼리당 바인드 변수 100개를 넘지 않는다", async () => {
  const { database, d1 } = createMigrationDatabase();
  const fixtureCount = D1_BIND_VARIABLE_LIMIT + 37;

  for (let id = 1; id <= fixtureCount; id += 1) {
    database
      .prepare(`
        INSERT INTO activities (
          id, activity_date, award_completed_date, award_status,
          award_stage, organization, business_round
        ) VALUES (?, '2026-07-01', '2026-07-02', '위즈업 수주',
          '납품 완료', ?, 1)
      `)
      .run(id, `D1 한도 기관 ${id}`);
    database
      .prepare(`
        INSERT INTO accounting_settlements (
          id, activity_id, manufacturer_commission_received,
          manufacturer_commission_received_date
        ) VALUES (?, ?, 10000, '2026-07-03')
      `)
      .run(id, id);
  }

  await assert.doesNotReject(() =>
    ensureLegacyReceiptLedgerMigration(d1),
  );
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS count FROM accounting_collection_receipts")
      .get().count,
    fixtureCount,
  );
});

test("대표 total entry에 settlement 출처를 기록하고 기존 receipt를 우선한다", () => {
  const store = source("../lib/accounting-store.ts");
  const migration = store.slice(
    store.indexOf("export async function ensureLegacyReceiptLedgerMigration"),
    store.indexOf("function parseKoreanNumber"),
  );

  assert.match(
    migration,
    /SET legacy_source_settlement_id = \?/,
  );
  assert.match(
    migration,
    /legacyEntryBySettlementId\.get\(settlementId\) \?\? targetEntryId/,
  );
  assert.match(
    migration,
    /if \(businessesWithReceipts\.has\(businessKey\)\) continue/,
  );
  assert.ok(
    migration.indexOf("businessesWithReceipts.has(businessKey)") <
      migration.indexOf("const settlement = settlementByBusiness.get"),
  );
});

test("최신 위즈업 완료 사업만 대표 원장으로 모으고 협력사·타업체 과거 자료는 보존한다", () => {
  const store = source("../lib/accounting-store.ts");
  const migration = store.slice(
    store.indexOf("export async function ensureLegacyReceiptLedgerMigration"),
    store.indexOf("function parseKoreanNumber"),
  );
  const entries = source("../app/api/accounting/entries/route.ts");
  const analytics = source("../app/api/accounting/route.ts");

  assert.match(
    migration,
    /latestAwards\.filter\(isCompletedWhizzupAwardRow\)/,
  );
  assert.match(
    migration,
    /if \(!latestAward \|\| !isCompletedWhizzupAwardRow\(latestAward\)\) \{/,
  );
  assert.doesNotMatch(migration, /DELETE FROM/);
  assert.match(entries, /completedWhizzupAwardRows\(activityResult\.results\)/);
  assert.match(analytics, /completedWhizzupAwardRows\(awardResult\.results\)/);
});

test("과거 협력사 회계 원본은 같은 기관의 최신 위즈업 원장으로 이동하거나 합산하지 않는다", () => {
  const store = source("../lib/accounting-store.ts");
  const entries = source("../app/api/accounting/entries/route.ts");
  const analytics = source("../app/api/accounting/route.ts");
  const migration = store.slice(
    store.indexOf("export async function ensureLegacyReceiptLedgerMigration"),
    store.indexOf("function parseKoreanNumber"),
  );

  assert.match(
    migration,
    /accounting_settlements s[\s\S]*s\.manufacturer_commission_received > 0[\s\S]*a\.award_status = '위즈업 수주'/,
  );
  assert.match(
    migration,
    /accounting_commission_entries e[\s\S]*e\.commission_collected_amount > 0[\s\S]*a\.award_status = '위즈업 수주'/,
  );
  assert.match(
    migration,
    /accounting_collection_receipts r[\s\S]*JOIN activities a ON a\.id = e\.activity_id[\s\S]*JOIN activities receipt_activity ON receipt_activity\.id = r\.activity_id[\s\S]*a\.award_status = '위즈업 수주'[\s\S]*receipt_activity\.award_status = '위즈업 수주'/,
  );
  assert.match(
    entries,
    /accounting_collection_receipts r[\s\S]*JOIN activities a ON a\.id = e\.activity_id[\s\S]*JOIN activities receipt_activity ON receipt_activity\.id = r\.activity_id[\s\S]*a\.award_status = '위즈업 수주'[\s\S]*receipt_activity\.award_status = '위즈업 수주'/,
  );
  assert.match(
    entries,
    /UPDATE accounting_collection_receipts[\s\S]*receipt_activity\.id = accounting_collection_receipts\.activity_id[\s\S]*receipt_activity\.award_status = '위즈업 수주'/,
  );
  assert.match(
    analytics,
    /JOIN activities entry_activity ON entry_activity\.id = e\.activity_id[\s\S]*entry_activity\.award_status = '위즈업 수주'/,
  );
  assert.match(
    analytics,
    /LEFT JOIN accounting_collection_receipts r[\s\S]*receipt_activity\.id = r\.activity_id[\s\S]*receipt_activity\.award_status = '위즈업 수주'/,
  );
});

test("회계와 통계는 같은 공용 migration을 먼저 실행하고 actual은 receipt만 사용한다", () => {
  const entries = source("../app/api/accounting/entries/route.ts");
  const analytics = source("../app/api/accounting/route.ts");
  const readEntries = entries.slice(
    entries.indexOf("async function readEntries"),
    entries.indexOf("async function readVisibleEntries"),
  );
  const readVisible = entries.slice(
    entries.indexOf("async function readVisibleEntries"),
    entries.indexOf("async function readUpcomingEntries"),
  );
  const analyticsResponse = analytics.slice(
    analytics.indexOf("async function analyticsResponse"),
    analytics.indexOf("export async function GET"),
  );

  assert.match(readEntries, /ensureLegacyReceiptLedgerMigration\(d1\)/);
  assert.match(readVisible, /ensureLegacyReceiptLedgerMigration\(d1\)/);
  assert.match(analyticsResponse, /ensureLegacyReceiptLedgerMigration\(d1\)/);
  assert.ok(
    analyticsResponse.indexOf("ensureLegacyReceiptLedgerMigration(d1)") <
      analyticsResponse.indexOf("const ["),
  );
  assert.match(
    analyticsResponse,
    /manufacturerCommissionReceived: confirmed\s*\? Number\(row\.commission_collected_amount \?\? 0\)/,
  );
  assert.doesNotMatch(
    analyticsResponse,
    /legacy_commission_collected_amount/,
  );
  assert.match(analyticsResponse, /LEFT JOIN accounting_collection_receipts/);
  assert.match(analyticsResponse, /legacy_contract_amount/);
});

test("과거 협력사 settlement와 receipt는 최신 위즈업 수주로 이관되지 않는다", async () => {
  const { database, d1 } = createMigrationDatabase();
  database.exec(`
    INSERT INTO activities VALUES
      (52, '2026-07-01', '2026-07-03', '협력사 수주', '납품 완료', '기관 D-2', 1),
      (53, '2026-07-20', '2026-07-20', '위즈업 수주', '납품 완료', '기관 D-2', 1);
    INSERT INTO accounting_settlements (
      id, activity_id, manufacturer_commission_received,
      manufacturer_commission_received_date
    ) VALUES (7, 52, 4000000, '2026-07-05');
    INSERT INTO accounting_commission_entries (
      id, activity_id, manufacturer_key, manufacturer_name
    ) VALUES
      (11, 52, 'award-total', '수주 전체'),
      (12, 53, 'award-total', '수주 전체');
    INSERT INTO accounting_collection_receipts (
      entry_id, activity_id, amount, collection_date, note
    ) VALUES (11, 52, 4000000, '2026-07-05', '협력사 과거 입력');
  `);

  await ensureLegacyReceiptLedgerMigration(d1);

  const receipts = database
    .prepare(
      "SELECT entry_id, activity_id, amount FROM accounting_collection_receipts ORDER BY id",
    )
    .all();
  assert.deepEqual(receipts.map((row) => ({ ...row })), [
    { entry_id: 11, activity_id: 52, amount: 4_000_000 },
  ]);
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM accounting_collection_receipts WHERE entry_id = 12",
      )
      .get().count,
    0,
  );
});

test("최신 협력사 수주에는 과거 위즈업 settlement의 신규 원장과 receipt를 만들지 않는다", async () => {
  const { database, d1 } = createMigrationDatabase();
  database.exec(`
    INSERT INTO activities VALUES
      (57, '2026-07-01', '2026-07-03', '위즈업 수주', '납품 완료', '기관 협력최신', 1),
      (58, '2026-07-20', '2026-07-20', '협력사 수주', '납품 완료', '기관 협력최신', 1);
    INSERT INTO accounting_settlements (
      id, activity_id, manufacturer_commission_received,
      manufacturer_commission_received_date
    ) VALUES (10, 57, 4200000, '2026-07-05');
  `);

  await ensureLegacyReceiptLedgerMigration(d1);

  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS count FROM accounting_commission_entries")
      .get().count,
    0,
  );
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS count FROM accounting_collection_receipts")
      .get().count,
    0,
  );
});

test("과거 위즈업 settlement는 신규 receipt 원장으로 한 번만 이관한다", async () => {
  const { database, d1 } = createMigrationDatabase();
  database.exec(`
    INSERT INTO activities VALUES
      (61, '2026-07-10', '2026-07-15', '위즈업 수주', '납품 완료', '기관 W', 1);
    INSERT INTO accounting_settlements (
      id, activity_id, manufacturer_commission_received,
      manufacturer_commission_received_date, accounting_note,
      updated_by, updated_by_name
    ) VALUES (8, 61, 2500000, '2026-07-18', '기존 메모', 3, '회계 담당');
  `);

  await ensureLegacyReceiptLedgerMigration(d1);
  await ensureLegacyReceiptLedgerMigration(d1);

  const receipt = database
    .prepare(
      `SELECT r.activity_id, r.amount, r.collection_date, r.note
       FROM accounting_collection_receipts r`,
    )
    .get();
  assert.deepEqual({ ...receipt }, {
    activity_id: 61,
    amount: 2_500_000,
    collection_date: "2026-07-18",
    note: "기존 회계 실수금 이관 · 기존 메모",
  });
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS count FROM accounting_collection_receipts")
      .get().count,
    1,
  );
});

test("수주 주체 변경 경계 이전의 위즈업 receipt는 최신 위즈업 원장으로 이관하지 않는다", async () => {
  const { database, d1 } = createMigrationDatabase();
  database.exec(`
    INSERT INTO activities VALUES
      (71, '2026-07-01', '2026-07-02', '위즈업 수주', '납품 완료', '기관 경계', 1),
      (72, '2026-07-10', '2026-07-11', '협력사 수주', '납품 완료', '기관 경계', 1),
      (73, '2026-07-20', '2026-07-21', '위즈업 수주', '납품 완료', '기관 경계', 1);
    INSERT INTO accounting_settlements (
      id, activity_id, manufacturer_commission_received,
      manufacturer_commission_received_date
    ) VALUES (9, 71, 3000000, '2026-07-05');
    INSERT INTO accounting_commission_entries (
      id, activity_id, manufacturer_key, manufacturer_name
    ) VALUES
      (21, 71, 'award-total', '수주 전체'),
      (23, 73, 'award-total', '수주 전체');
    INSERT INTO accounting_collection_receipts (
      entry_id, activity_id, amount, collection_date, note
    ) VALUES (21, 71, 3000000, '2026-07-05', '경계 이전 수금');
  `);

  await ensureLegacyReceiptLedgerMigration(d1);

  const receipts = database
    .prepare(
      `SELECT entry_id, activity_id, amount
       FROM accounting_collection_receipts
       ORDER BY id`,
    )
    .all();
  assert.deepEqual(receipts.map((row) => ({ ...row })), [
    { entry_id: 21, activity_id: 71, amount: 3_000_000 },
  ]);
});

test("협력사 연결 품목은 유지하고 현재 위즈업 구간의 미연결 품목만 대표 수주에 연결한다", async () => {
  const { database, d1 } = createMigrationDatabase();
  database.exec(`
    INSERT INTO activities VALUES
      (81, '2026-07-01', '2026-07-02', '위즈업 수주', '납품 완료', '기관 품목경계', 1),
      (82, '2026-07-10', '2026-07-11', '협력사 수주', '납품 완료', '기관 품목경계', 1),
      (83, '2026-07-20', '2026-07-21', '위즈업 수주', '납품 완료', '기관 품목경계', 1),
      (84, '2026-07-20', '2026-07-21', '위즈업 수주', '납품 완료', '기관 단일수주', 1);
    INSERT INTO equipment_projects (
      id, activity_id, organization, business_round
    ) VALUES
      (31, 81, '기관 품목경계', 1),
      (32, 82, '기관 품목경계', 1),
      (33, NULL, '기관 품목경계', 1),
      (34, NULL, '기관 단일수주', 1);
  `);

  await linkEquipmentProjectsToWhizzupAwards(d1);

  const projects = database
    .prepare(
      "SELECT id, activity_id FROM equipment_projects ORDER BY id",
    )
    .all();
  assert.deepEqual(projects.map((row) => ({ ...row })), [
    { id: 31, activity_id: 81 },
    { id: 32, activity_id: 82 },
    { id: 33, activity_id: null },
    { id: 34, activity_id: 84 },
  ]);
});
