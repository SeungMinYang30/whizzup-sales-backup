import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./typescript-resolver.mjs", import.meta.url));
register(
  new URL("./accounting-entries-d1-test-resolver.mjs", import.meta.url),
);

const { GET, PUT, POST, PATCH, DELETE } = await import(
  "../app/api/accounting/entries/route.ts"
);

const D1_BIND_VARIABLE_LIMIT = 100;

class BindLimitedStatement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    this.database.maxBindings = Math.max(
      this.database.maxBindings,
      bindings.length,
    );
    if (bindings.length > D1_BIND_VARIABLE_LIMIT) {
      throw new Error(
        `D1_ERROR: too many SQL variables (${bindings.length} > ${D1_BIND_VARIABLE_LIMIT})`,
      );
    }
    return new BindLimitedStatement(this.database, this.sql, bindings);
  }

  async all() {
    return { results: this.database.rowsFor(this.sql) };
  }

  async first() {
    if (this.sql.includes("FROM accounting_collection_receipts")) {
      return {
        collected_amount: 0,
        latest_collection_date: null,
      };
    }
    return null;
  }

  async run() {
    this.database.executedSql.push(this.sql);
    return { success: true, meta: { changes: 1 } };
  }
}

class BindLimitedD1 {
  constructor({ activities, entries, receipts = [], projects = [] }) {
    this.activities = activities;
    this.entries = entries;
    this.receipts = receipts;
    this.projects = projects;
    this.maxBindings = 0;
    this.executedSql = [];
  }

  prepare(sql) {
    return new BindLimitedStatement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  rowsFor(sql) {
    if (sql.includes("FROM accounting_collection_receipts")) {
      return this.receipts;
    }
    if (sql.includes("FROM equipment_projects ep")) return this.projects;
    if (sql.includes("FROM accounting_commission_entries e")) {
      return this.entries;
    }
    if (sql.includes("FROM activities a")) return this.activities;
    return [];
  }
}

function activity(id, organization) {
  return {
    activity_id: id,
    activity_date: "2026-07-01",
    award_completed_date: "2026-07-02",
    award_status: "위즈업 수주",
    award_stage: "납품 완료",
    organization,
    business_round: 1,
    region: "서울",
    budget_type: "테스트",
    budget_amount: 0,
    progress_manager: "회계 테스트",
    execution_type: "직영",
    consortium_company: "",
  };
}

function entry(id, activityId, workflowExcluded = false) {
  return {
    id,
    activity_id: activityId,
    manufacturer_key: "award-total",
    manufacturer_name: "수주 전체",
    workflow_excluded: workflowExcluded ? 1 : 0,
    workflow_excluded_at: workflowExcluded
      ? "2026-07-29 00:00:00"
      : null,
    workflow_excluded_by: workflowExcluded ? 1 : null,
    workflow_excluded_by_name: workflowExcluded ? "회계 테스트" : null,
    updated_at: "2026-07-03 00:00:00",
  };
}

function receipt(id, entryId, activityId, amount = 10000) {
  return {
    id,
    entry_id: entryId,
    activity_id: activityId,
    amount,
    collection_date: "2026-07-10",
    note: "기존 수금",
    legacy_source_entry_id: null,
    created_at: "2026-07-10 00:00:00",
    updated_at: "2026-07-10 00:00:00",
  };
}

function constructionProject({
  projectId,
  activityId,
  organization,
  constructionAmount,
  actualConstructionCost,
  unitPrice,
  commissionRate,
}) {
  return {
    project_id: projectId,
    project_activity_id: activityId,
    organization,
    business_round: 1,
    project_name: "공사 포함 사업",
    construction_amount: constructionAmount,
    actual_construction_cost: actualConstructionCost,
    item_id: projectId,
    product_name: "협력사 제품",
    specification: "",
    proposed_qty: 1,
    awarded_qty: 0,
    installed_qty: 0,
    catalog_unit_price: unitPrice,
    price_status: "입력 완료",
    procurement_fee_rate: 0,
    item_execution_type: "직영",
    commission_input_type: "rate",
    commission_rate: commissionRate,
    supply_type: "partner",
    margin_rate: null,
    consortium_commission_rate: null,
    consortium_payment_amount: null,
    supplier_vendor_id: 1,
    supplier_vendor_name: "에어패스",
    project_award_status: "위즈업 수주",
  };
}

test("대량 납품 완료 목록 동기화도 쿼리당 D1 바인드 변수 100개 이하를 유지한다", async () => {
  const fixtureCount = D1_BIND_VARIABLE_LIMIT + 37;
  const activities = Array.from({ length: fixtureCount }, (_, index) =>
    activity(index + 1, `대량 기관 ${index + 1}`),
  );
  const entries = activities.map((row, index) =>
    entry(index + 1, row.activity_id),
  );
  const d1 = new BindLimitedD1({ activities, entries });
  globalThis.__accountingEntriesD1 = d1;

  const response = await GET(
    new Request("http://localhost/api/accounting/entries"),
  );

  assert.equal(response.status, 200, await response.text());
  assert.ok(d1.maxBindings <= D1_BIND_VARIABLE_LIMIT);
});

test("한 사업에 활동 이력이 많아도 원장 통합 쿼리는 D1 바인드 한도를 넘지 않는다", async () => {
  const fixtureCount = D1_BIND_VARIABLE_LIMIT + 37;
  const activities = Array.from({ length: fixtureCount }, (_, index) =>
    activity(index + 1, "동일 기관"),
  );
  const entries = activities.map((row, index) =>
    entry(index + 1, row.activity_id),
  );
  const d1 = new BindLimitedD1({ activities, entries });
  globalThis.__accountingEntriesD1 = d1;

  const response = await GET(
    new Request("http://localhost/api/accounting/entries"),
  );

  assert.equal(response.status, 200, await response.text());
  assert.ok(d1.maxBindings <= D1_BIND_VARIABLE_LIMIT);
});

test("수금 작업목록 대량 제외도 D1 바인드 한도 안에서 나눠 처리한다", async () => {
  const fixtureCount = D1_BIND_VARIABLE_LIMIT + 37;
  const activities = Array.from({ length: fixtureCount }, (_, index) =>
    activity(index + 1, `제외 기관 ${index + 1}`),
  );
  const entries = activities.map((row, index) =>
    entry(index + 1, row.activity_id),
  );
  const d1 = new BindLimitedD1({ activities, entries });
  globalThis.__accountingEntriesD1 = d1;

  const response = await PUT(
    new Request("http://localhost/api/accounting/entries", {
      method: "PUT",
      body: JSON.stringify({
        action: "exclude",
        entryIds: entries.map((row) => row.id),
      }),
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(response.status, 200, await response.text());
  assert.ok(d1.maxBindings <= D1_BIND_VARIABLE_LIMIT);
});

test("수주 목록 배지 조회에서는 회계 관리 제외 기록을 노출하지 않는다", async () => {
  const activities = [
    activity(1, "표시 기관"),
    activity(2, "제외 기관"),
  ];
  const entries = [
    entry(1, 1),
    entry(2, 2, true),
  ];
  const d1 = new BindLimitedD1({ activities, entries });
  globalThis.__accountingEntriesD1 = d1;

  const response = await GET(
    new Request("http://localhost/api/accounting/entries?scope=visible"),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    payload.entries.map((row) => row.organization),
    ["표시 기관"],
  );
});

test("기존 실수금은 보존하고 공사 손실을 정산 후 입금 예정액에 소급 반영한다", async () => {
  const activities = [activity(1, "명천유치원")];
  const entries = [entry(1, 1)];
  const receipts = [receipt(10, 1, 1, 5_384_130)];
  const projects = [
    constructionProject({
      projectId: 1,
      activityId: 1,
      organization: "명천유치원",
      constructionAmount: 2_273_580,
      actualConstructionCost: 7_900_000,
      unitPrice: 42_726_420,
      commissionRate: 11_010_550 / 42_726_420,
    }),
  ];
  const d1 = new BindLimitedD1({
    activities,
    entries,
    receipts,
    projects,
  });
  globalThis.__accountingEntriesD1 = d1;

  const response = await GET(
    new Request("http://localhost/api/accounting/entries"),
  );
  const payload = await response.json();
  const [result] = payload.entries;

  assert.equal(response.status, 200);
  assert.equal(result.expectedPartnerCommission, 11_010_550);
  assert.equal(result.contractAmountReference, 45_000_000);
  assert.equal(result.quoteStatus, "complete");
  assert.equal(result.expectedConstructionMargin, -5_626_420);
  assert.equal(result.expectedCollectionTotal, 5_384_130);
  assert.equal(result.expectedSettlementDeficit, 0);
  assert.equal(result.expectedProfit, 5_384_130);
  assert.equal(result.commissionCollectedAmount, 5_384_130);
  assert.equal(result.receivableBalance, 0);
  assert.equal(result.receipts[0].amount, 5_384_130);
  assert.equal(
    d1.executedSql.some((sql) =>
      /^\s*UPDATE accounting_collection_receipts/.test(sql),
    ),
    false,
  );
});

test("회계 관리 제외 기록은 복원 전 수금 추가를 거부한다", async () => {
  const activities = [activity(1, "제외 기관")];
  const entries = [entry(1, 1, true)];
  const d1 = new BindLimitedD1({ activities, entries });
  globalThis.__accountingEntriesD1 = d1;

  const response = await POST(
    new Request("http://localhost/api/accounting/entries", {
      method: "POST",
      body: JSON.stringify({
        entryId: 1,
        amount: 10000,
        collectionDate: "2026-07-29",
        note: "추가 시도",
      }),
      headers: { "content-type": "application/json" },
    }),
  );
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.match(payload.error, /먼저 작업목록에 복원/);
  assert.equal(
    d1.executedSql.some((sql) =>
      /^\s*INSERT INTO accounting_collection_receipts/.test(sql),
    ),
    false,
  );
});

test("회계 관리 제외 기록은 복원 전 기존 수금 수정과 삭제를 거부한다", async () => {
  for (const method of ["PATCH", "DELETE"]) {
    const activities = [activity(1, "제외 기관")];
    const entries = [entry(1, 1, true)];
    const receipts = [receipt(10, 1, 1)];
    const d1 = new BindLimitedD1({ activities, entries, receipts });
    globalThis.__accountingEntriesD1 = d1;
    const handler = method === "PATCH" ? PATCH : DELETE;
    const body =
      method === "PATCH"
        ? {
            receiptId: 10,
            amount: 20000,
            collectionDate: "2026-07-29",
            note: "수정 시도",
          }
        : { receiptId: 10 };

    const response = await handler(
      new Request("http://localhost/api/accounting/entries", {
        method,
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
    );
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.match(payload.error, /먼저 작업목록에 복원/);
    assert.equal(
      d1.executedSql.some((sql) =>
        method === "PATCH"
          ? /^\s*UPDATE accounting_collection_receipts/.test(sql)
          : /^\s*DELETE FROM accounting_collection_receipts/.test(sql),
      ),
      false,
    );
  }
});
