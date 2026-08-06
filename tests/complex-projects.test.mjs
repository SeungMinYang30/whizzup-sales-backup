import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("complex projects reuse canonical budgets and items across accounting and analytics", async () => {
  const [store, page, crm] = await Promise.all([
    read("../lib/complex-projects.ts"),
    read("../app/complex-project-page.tsx"),
    read("../app/crm-app.tsx"),
  ]);

  assert.match(store, /JOIN equipment_projects ep ON ep\.id = link\.equipment_project_id/);
  assert.match(store, /JOIN equipment_items item ON item\.id = detail\.equipment_item_id/);
  assert.match(store, /linkBudgetNameEntity/);
  assert.match(store, /INSERT OR IGNORE INTO complex_project_item_details[\s\S]*JOIN equipment_items item/);
  assert.match(page, /기존 표준 예산과 품목 카드를 그대로 사용해 통계·회계 이중 집계를 막습니다/);
  assert.match(crm, /id: "complex-projects", label: "복합사업 관리"/);
});

test("partial delivery changes stay linked to the schedule board and remain editable", async () => {
  const [store, page, schema] = await Promise.all([
    read("../lib/complex-projects.ts"),
    read("../app/complex-project-page.tsx"),
    read("../db/schema.ts"),
  ]);

  assert.match(store, /complex_delivery_id/);
  assert.match(store, /sync_status = 'pending', sync_operation = 'upsert'/);
  assert.match(store, /refreshOrganizationScheduleMirror/);
  assert.match(store, /plannedQty < awardedQty[\s\S]*"수량 미배정"/);
  assert.match(store, /plannedQty > awardedQty[\s\S]*"수량 초과"/);
  assert.match(store, /refreshDeliveredQuantity/);
  assert.match(page, /deliveryId: editDelivery\?\.id/);
  assert.match(page, />수정<\/button><button type="button" onClick=\{\(\) => void removeEntity\("delivery"/);
  assert.match(schema, /complexDeliveryId: integer\("complex_delivery_id"\)/);
});

test("merge and full backup preserve every complex-project relation", async () => {
  const [merge, backup] = await Promise.all([
    read("../lib/institution-merge.ts"),
    read("../lib/backup-store.ts"),
  ]);
  for (const table of [
    "complex_projects",
    "complex_project_budget_links",
    "complex_project_zones",
    "complex_project_item_details",
    "complex_project_deliveries",
    "complex_project_events",
  ]) {
    assert.match(backup, new RegExp(table));
  }
  assert.match(backup, /2026-08-07-complex-projects/);
  assert.match(backup, /"complex_delivery_id"/);
  assert.match(merge, /UPDATE complex_project_zones SET complex_project_id/);
  assert.match(merge, /UPDATE complex_project_item_details SET complex_project_id/);
  assert.match(merge, /UPDATE complex_project_deliveries SET complex_project_id/);
  assert.match(merge, /UPDATE complex_project_events SET complex_project_id/);
});
