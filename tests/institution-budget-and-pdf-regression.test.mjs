import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [records, institutions, crm, budgetNames, activityBudgets, quotePdf, settlementPdf, quotationPage, vercelSchema] = await Promise.all([
  read("../app/api/records/route.ts"),
  read("../app/api/institutions/route.ts"),
  read("../app/crm-app.tsx"),
  read("../lib/budget-names.ts"),
  read("../lib/activity-budgets.ts"),
  read("../app/authored-quotation-pdf.ts"),
  read("../app/consortium-settlement-pdf.ts"),
  read("../app/quotation-management-page.tsx"),
  read("../db/vercel-schema.ts"),
]);

test("master-only institutions save budgets without creating a contact activity", () => {
  assert.match(crm, /savesMasterInstitutionBudget = field === "budget" && record\.id < 1/);
  assert.match(crm, /action: "save-institution-budgets"/);
  assert.match(records, /saveInstitutionBudgetsWithoutActivity/);
  assert.match(records, /activity_id, created_by\s*\) VALUES[\s\S]*NULL, \?\)/);
  assert.match(records, /RETURNING id[\s\S]*\.first<\{ id: number \}>\(\)/);
  assert.match(records, /budget_request_id = \?/);
  assert.match(records, /budget_group_id = \?/);
  assert.match(institutions, /WHERE activity_id IS NULL/);
  assert.match(institutions, /budgetsJson: serializeActivityBudgets/);
  assert.match(vercelSchema, /202608160001_institution_business_budgets/);
  assert.match(vercelSchema, /ADD COLUMN IF NOT EXISTS budget_amount_source text NOT NULL DEFAULT 'missing'/);
});

test("request retries are reused and approvals only affect the selected request id", () => {
  assert.match(budgetNames, /requester_member_id = \?[\s\S]*organization = \?[\s\S]*status IN \('pending', 'hold'\)/);
  assert.match(budgetNames, /const requestIds = \[request\.id\]/);
  assert.doesNotMatch(budgetNames, /const duplicates = await d1[\s\S]{0,300}requested_key = \?/);
});

test("unknown and pending budgets remain selectable and amount zero is not missing", () => {
  const detailSelector = crm.match(/organization=\{detailInlineDraft\.organization\}[\s\S]{0,500}<\/div>/)?.[0] ?? "";
  assert.doesNotMatch(detailSelector, /standardOnly/);
  assert.match(crm, /return "0원"/);
  assert.match(activityBudgets, /storedAmount !== "" && budget\.budgetAmountSource !== "missing"/);
  assert.match(crm, /institution-budget-line/);
});

test("quotation and settlement PDFs paginate by measured height and reserve the signature block", () => {
  assert.match(quotePdf, /measuredItemRowHeight/);
  assert.match(quotePdf, /const finalCapacity = isFirstPage \? 600 : 930/);
  assert.match(quotePdf, /!isFinalPage && index === items\.length - 1/);
  assert.match(settlementPdf, /paginateSettlementRows/);
  assert.match(settlementPdf, /PAGE_HEIGHT - 72 - startY - 450/);
  assert.match(settlementPdf, /!isFinalPage && rowIndex === rows\.length - 1/);
  assert.doesNotMatch(settlementPdf, /index < rows\.length; index \+= 22/);
});

test("all generated PDF view and print actions open the finished blob in a browser tab", () => {
  assert.match(quotationPage, /function openPdfBlobInNewTab/);
  assert.match(quotationPage, /window\.open\(url, "_blank"\)/);
  assert.match(quotationPage, /완성된 견적서 PDF를 새 탭/);
  assert.match(quotationPage, /완성된 정산서 PDF를 새 탭/);
  assert.match(quotationPage, /새 탭이 차단되었습니다/);
  assert.doesNotMatch(quotationPage, /window\.print\(\)/);
  assert.doesNotMatch(quotationPage, /popup=yes/);
});
