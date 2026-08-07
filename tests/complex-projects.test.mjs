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
  assert.match(store, /JOIN equipment_items item ON item\.project_id = link\.equipment_project_id/);
  assert.match(store, /LEFT JOIN complex_project_item_details detail ON detail\.equipment_item_id = item\.id/);
  assert.match(store, /linkBudgetNameEntity/);
  assert.match(store, /INSERT OR IGNORE INTO complex_project_item_details[\s\S]*JOIN equipment_items item/);
  assert.match(page, /기존 표준 예산과 품목 카드를 그대로 사용해 통계·회계 이중 집계를 막습니다/);
  assert.match(crm, /id: "complex-projects", label: "공간재구조화 사업 관리"/);
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
  assert.match(store, /plannedQty < settlementQuantity[\s\S]*"수량 미배정"/);
  assert.match(store, /plannedQty > settlementQuantity[\s\S]*"수량 초과"/);
  assert.match(store, /completedQty >= settlementQuantity[\s\S]*"납품 완료"/);
  assert.match(store, /proposedQty > 0[\s\S]*"기관 품목 수량"[\s\S]*awardedQty > 0[\s\S]*"수주 수량"[\s\S]*installedQty > 0[\s\S]*"설치 수량"/);
  assert.match(page, /String\(item\.quantity_source\) === "기본 수량"[\s\S]*원본 수량 미입력/);
  assert.match(store, /refreshDeliveredQuantity/);
  assert.match(page, /deliveryId: editDelivery\?\.id/);
  assert.match(page, />수정<\/button><button type="button" onClick=\{\(\) => void removeEntity\("delivery"/);
  assert.match(schema, /complexDeliveryId: integer\("complex_delivery_id"\)/);
});

test("complex project activation uses searched institution rounds and approved sales managers", async () => {
  const [store, page, crm, records] = await Promise.all([
    read("../lib/complex-projects.ts"),
    read("../app/complex-project-page.tsx"),
    read("../app/crm-app.tsx"),
    read("../app/api/records/route.ts"),
  ]);

  assert.match(store, /query\.replace\(\/\\s\+\/g, ""\)\.length < 2/);
  assert.match(store, /a\.award_status = '위즈업 수주'/);
  assert.doesNotMatch(store, /\)\s*\)\s*\), project_finance AS/);
  assert.match(store, /clean\(payload\.sourceType, 30\) === "external"/);
  assert.match(page, /외부 사업 수기 등록/);
  assert.match(page, /수금·수주 통계에는 포함되지 않습니다/);
  assert.match(store, /status = 'approved'/);
  assert.match(store, /is_sales = 1/);
  assert.match(store, /role = 'admin'/);
  assert.match(store, /manager_member_id = COALESCE\(excluded\.manager_member_id, complex_projects\.manager_member_id\)/);
  assert.match(store, /TRIM\(construction_schedule_projects\.work_summary\)/);
  assert.match(store, /ELSE construction_schedule_projects\.work_summary/);
  assert.match(page, /두 글자부터 검색합니다/);
  assert.match(page, /whizzup\.complexProjectTarget/);
  assert.match(crm, /공간재구조화 사업으로 관리/);
  assert.match(crm, /operationScope: "pre_awards"/);
  assert.match(crm, /attempt <= 2/);
  assert.match(records, /existingActivityChangeItemIds/);
});

test("complex project activation carries existing budgets items and financial totals without duplicating them", async () => {
  const [store, page] = await Promise.all([
    read("../lib/complex-projects.ts"),
    read("../app/complex-project-page.tsx"),
  ]);
  assert.match(store, /readCanonicalBusinessRoundBudgets/);
  assert.match(store, /activityBudgetsFromRecord/);
  assert.match(store, /INSERT INTO complex_project_budget_links/);
  assert.match(store, /ON CONFLICT\(complex_project_id, equipment_project_id\) DO NOTHING/);
  assert.match(store, /item_quote_amount/);
  assert.match(store, /construction_amount/);
  assert.match(store, /export async function cancelComplexProject/);
  assert.match(store, /const updatedNotes = \[previousNotes, reasonLine\]\.filter\(Boolean\)\.join\("\\n"\)/);
  assert.doesNotMatch(store, /notes \|\| CHAR\(10\) \|\|/);
  assert.match(store, /equipmentSettlementQuantity/);
  assert.match(store, /calculateEquipmentFinance/);
  assert.match(store, /supplier_display_name/);
  assert.match(page, /원본 수량 미입력/);
  assert.match(page, /제품 기준/);
  assert.match(page, /공간재구조화 사업 취소/);
  assert.match(page, /연결 품목 금액/);
  assert.match(page, /연결 공사비/);
});

test("complex project writes are atomic and refresh failures cannot be mistaken for failed writes", async () => {
  const [store, page, route] = await Promise.all([
    read("../lib/complex-projects.ts"),
    read("../app/complex-project-page.tsx"),
    read("../app/api/complex-projects/route.ts"),
  ]);

  for (const action of [
    "createComplexProject",
    "updateComplexProject",
    "addComplexBudget",
    "saveComplexZone",
    "saveComplexItem",
    "saveComplexDelivery",
    "deleteComplexEntity",
  ]) {
    const start = store.indexOf(`export async function ${action}`);
    assert.ok(start >= 0, `${action} must exist`);
    const end = store.indexOf("\nexport async function ", start + 1);
    const block = store.slice(start, end >= 0 ? end : undefined);
    assert.match(block, /\.transaction\(async \(transaction\) =>/);
    assert.doesNotMatch(block, /return listComplexProjects\(\)/);
  }
  assert.match(store, /const \[projectResult,[\s\S]*= await d1\.batch\(/);
  assert.doesNotMatch(store, /syncAllWhizzupBudgetLinks/);
  assert.match(page, /resilientFetch\("\/api\/complex-projects"/);
  assert.match(page, /최신 화면 갱신이 지연되고 있어/);
  assert.match(route, /isDatabaseUnavailableError/);
});

test("complex project items preserve selection protection and site requirements", async () => {
  const [store, page, schema] = await Promise.all([
    read("../lib/complex-projects.ts"),
    read("../app/complex-project-page.tsx"),
    read("../db/schema.ts"),
  ]);
  for (const field of [
    "selection_round",
    "selection_status",
    "change_reason",
    "electrical_requirements",
    "network_requirements",
    "protection_vendor_name",
    "protection_state",
    "protection_expires_at",
  ]) {
    assert.match(store, new RegExp(field));
  }
  assert.match(page, /나라장터·학교장터·수의계약/);
  assert.match(page, /전기·배선 요구사항/);
  assert.match(page, /네트워크 요구사항/);
  assert.match(schema, /protectionExpiresAt: text\("protection_expires_at"\)/);
});

test("complex project items always expose shared comparison-document management", async () => {
  const [store, page, route] = await Promise.all([
    read("../lib/complex-projects.ts"),
    read("../app/complex-project-page.tsx"),
    read("../app/api/product-comparison-documents/route.ts"),
  ]);

  assert.match(store, /comparison_document_key/);
  assert.match(store, /equipment-item:\$\{integer\(row\.equipment_item_id\)\}/);
  assert.match(page, /\+ 비교표 등록/);
  assert.match(page, /물품 비교표/);
  assert.match(page, /uploadComparisonDocument/);
  assert.match(page, /deleteComparisonDocument/);
  assert.match(route, /PDF, Excel 또는 Word 비교표/);
});

test("space restructuring projects export the selected institution data to a styled workbook", async () => {
  const [page, workbook] = await Promise.all([
    read("../app/complex-project-page.tsx"),
    read("../app/complex-project-xlsx.ts"),
  ]);

  assert.match(page, /downloadComplexProjectWorkbook\(selected\)/);
  assert.match(page, /엑셀 내보내기/);
  assert.match(workbook, /집행계획 총괄/);
  assert.match(workbook, /예산별 집행/);
  assert.match(workbook, /공간·품목/);
  assert.match(workbook, /물품선정표/);
  assert.match(workbook, /분할 납품 일정/);
  assert.match(workbook, /영업보호 현황/);
  assert.match(workbook, /fullCalcOnLoad="1"/);
  assert.match(workbook, /Print_Area/);
  assert.match(workbook, /fitToWidth="1"/);
  assert.match(workbook, /project\.items\.flatMap/);
  assert.match(workbook, /item\.deliveries/);
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
  assert.match(backup, /2026-08-07-complex-project-controls/);
  assert.match(backup, /"complex_delivery_id"/);
  assert.match(backup, /"manager_member_id"/);
  assert.match(backup, /"source_type"/);
  assert.match(backup, /row\[column\] \?\? "whizzup"/);
  assert.match(backup, /"protection_expires_at"/);
  assert.match(merge, /UPDATE complex_project_zones SET complex_project_id/);
  assert.match(merge, /UPDATE complex_project_item_details SET complex_project_id/);
  assert.match(merge, /UPDATE complex_project_deliveries SET complex_project_id/);
  assert.match(merge, /UPDATE complex_project_events SET complex_project_id/);
});
