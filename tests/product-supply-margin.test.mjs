import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

test("직접 공급 마이그레이션은 확정 전 터치테이블만 안전하게 전환한다", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE product_vendor_links (
      product_id TEXT PRIMARY KEY,
      vendor_id INTEGER NOT NULL,
      vendor_name_snapshot TEXT NOT NULL DEFAULT '',
      updated_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE equipment_items (
      id INTEGER PRIMARY KEY,
      catalog_item_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '제안',
      commission_rate REAL,
      supplier_vendor_id INTEGER,
      supplier_vendor_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO product_vendor_links (
      product_id, vendor_id, vendor_name_snapshot, updated_by
    ) VALUES ('quote-62', 1, '기존 협력사', 1);
    INSERT INTO equipment_items VALUES
      (1, 'quote-62', '견적', 0.5545454545454546, 1, '기존 협력사', CURRENT_TIMESTAMP),
      (2, 'quote-62', '수주', 0.5545454545454546, 1, '기존 협력사', CURRENT_TIMESTAMP),
      (3, 'quote-62', '설치 완료', 0.5545454545454546, 1, '기존 협력사', CURRENT_TIMESTAMP),
      (4, 'quote-63', '견적', 0.3, 1, '기존 협력사', CURRENT_TIMESTAMP);
  `);

  const migration = await source(
    "../drizzle/0049_product_supply_and_margin.sql",
  );
  migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .forEach((statement) => db.exec(statement));

  const supply = db
    .prepare(
      "SELECT supply_type, margin_rate FROM product_supply_settings WHERE product_id = 'quote-62'",
    )
    .get();
  assert.equal(supply.supply_type, "direct");
  assert.equal(supply.margin_rate, 0.5545454545454546);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM product_vendor_links WHERE product_id = 'quote-62'",
      )
      .get().count,
    0,
  );

  const proposal = db
    .prepare("SELECT * FROM equipment_items WHERE id = 1")
    .get();
  assert.equal(proposal.supply_type, "direct");
  assert.equal(proposal.margin_rate, 0.5545454545454546);
  assert.equal(proposal.commission_rate, null);
  assert.equal(proposal.supplier_vendor_id, null);
  assert.equal(proposal.supplier_vendor_name, "");

  for (const id of [2, 3]) {
    const finalized = db
      .prepare("SELECT * FROM equipment_items WHERE id = ?")
      .get(id);
    assert.equal(finalized.supply_type, "partner");
    assert.equal(finalized.margin_rate, null);
    assert.equal(finalized.commission_rate, 0.5545454545454546);
    assert.equal(finalized.supplier_vendor_name, "기존 협력사");
  }

  const otherProduct = db
    .prepare("SELECT * FROM equipment_items WHERE id = 4")
    .get();
  assert.equal(otherProduct.supply_type, "partner");
  assert.equal(otherProduct.commission_rate, 0.3);
});

test("제품 저장은 제품·공급 설정·협력사 연결을 같은 D1 배치로 처리한다", async () => {
  const route = await source("../app/api/product-catalog/route.ts");
  assert.match(route, /const statements:[\s\S]*INSERT INTO app_settings/);
  assert.match(route, /INSERT INTO product_supply_settings/);
  assert.match(route, /INSERT INTO product_vendor_links/);
  assert.match(route, /await d1\.batch\(statements\)/);
  assert.match(
    route,
    /WHERE catalog_item_id = \?[\s\S]*status IN \('제안 예정', '제안', '견적'\)/,
  );
});

test("기관 품목 API는 공급 구분과 마진율 스냅샷을 저장한다", async () => {
  const route = await source("../app/api/equipment/route.ts");
  const postItemStart = route.indexOf('if (kind === "item")');
  const putStart = route.indexOf("export async function PUT");
  const postItemRoute = route.slice(postItemStart, putStart);
  assert.match(route, /commission_rate, supply_type, margin_rate/);
  assert.match(route, /requestedProvided: hasRequestedMarginRate/);
  assert.match(route, /requestedProvided: hasRequestedCommissionRate/);
  assert.match(route, /supplierLink\?\.supplierVendorId \?\? null/);
  assert.doesNotMatch(postItemRoute, /existingItem/);
  assert.match(
    route,
    /preservesExistingCatalog[\s\S]*clean\(existingItem\.catalog_item_id\) === catalogItemId/,
  );
  assert.match(
    route,
    /settlement\.supplyType === "partner"[\s\S]*supplierLink\?\.supplierVendorId \?\? null/,
  );
});

test("기관 품목 편집은 표시용 두 자리 비율과 별도로 정밀 원율을 보존한다", async () => {
  const crm = await source("../app/crm-app.tsx");
  assert.match(crm, /sourceRate: number \| null/);
  assert.match(
    crm,
    /function resolvedSettlementRate[\s\S]*!draft\.rateEdited[\s\S]*draft\.sourceRate \?\? fallback/,
  );
  assert.match(
    crm,
    /function applyCatalogProductToEdit[\s\S]*sourceRate: catalogSupplyRate\(product\),[\s\S]*rateEdited: false/,
  );
});

test("구버전 백업 복원은 확정 전 직접공급 품목만 공급 설정과 다시 맞춘다", async () => {
  const backupStore = await source("../lib/backup-store.ts");
  assert.match(
    backupStore,
    /restoresLegacySchema[\s\S]*UPDATE equipment_items[\s\S]*SET supply_type = 'direct'[\s\S]*status IN \('제안 예정', '제안', '견적'\)[\s\S]*product_supply_settings[\s\S]*supply_type = 'direct'/,
  );
});
