import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("재고 관리는 별도 구성원 권한과 화면 접근 제한을 사용한다", () => {
  const collaboration = source("../lib/collaboration.ts");
  const crm = source("../app/crm-app.tsx");
  const route = source("../app/api/inventory/route.ts");

  assert.match(collaboration, /"inventory:manage"/);
  assert.match(crm, /id: "inventory:manage"[\s\S]*label: "물류·재고 관리"/);
  assert.match(crm, /canManageInventory && \{[\s\S]*id: "inventory"/);
  assert.match(crm, /nextView === "inventory" && !canManageInventory/);
  assert.equal(
    (route.match(/requireMemberPermission\("inventory:manage"\)/g) || []).length,
    2,
  );
});

test("기본 재고 품목과 입출고 원장을 D1에 영구 저장한다", () => {
  const store = source("../lib/inventory-store.ts");
  const route = source("../app/api/inventory/route.ts");
  const migration = source("../drizzle/0064_inventory_ledger.sql");

  for (const token of [
    "inventory_products",
    "inventory_transactions",
    "3D모션",
    "터치테이블",
    "PRAGMA optimize",
  ]) {
    assert.match(store, new RegExp(token));
    assert.match(migration, new RegExp(token));
  }
  assert.match(route, /\["in", "out", "adjust"\]/);
  assert.match(route, /current_stock \+ \? >= 0/);
  assert.match(route, /d1\.batch\(statements\)/);
});

test("재고 화면은 요약, 품목 작업, 최근 이력을 한 화면에 제공한다", () => {
  const page = source("../app/inventory-page.tsx");
  const crm = source("../app/crm-app.tsx");

  for (const label of [
    "등록 품목",
    "총 재고",
    "보충 확인",
    "이번 달 입고 · 출고",
    "현재 재고",
    "최근 입출고 이력",
    "재고 조정",
  ]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /fetch\("\/api\/inventory"/);
  assert.match(crm, /<InventoryPage \/>/);
});

test("전체 DB 백업과 복원에 재고 품목과 원장을 함께 포함한다", () => {
  const backup = source("../lib/backup-store.ts");

  assert.match(backup, /BACKUP_SCHEMA_VERSION = "2026-08-03-inventory-ledger"/);
  assert.match(backup, /name: "inventory_products"/);
  assert.match(backup, /name: "inventory_transactions"/);
  assert.match(backup, /DELETE FROM inventory_transactions/);
  assert.match(backup, /DELETE FROM inventory_products/);
  assert.match(backup, /await ensureInventoryReady\(\)/);
});
