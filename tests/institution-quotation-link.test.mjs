import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../app/quotation-management-page.tsx", import.meta.url),
  "utf8",
);
const api = await readFile(
  new URL("../app/api/quotations/route.ts", import.meta.url),
  "utf8",
);
const store = await readFile(
  new URL("../lib/authored-quotations.ts", import.meta.url),
  "utf8",
);
const crm = await readFile(
  new URL("../app/crm-app.tsx", import.meta.url),
  "utf8",
);

test("institution detail keeps quotations separated by institution and business round", () => {
  assert.match(api, /organization/);
  assert.match(api, /businessRound/);
  assert.match(store, /organization = \?/);
  assert.match(store, /business_round = \?/);
  assert.match(page, /scope\.organization/);
  assert.match(page, /scope\.businessRound/);
  assert.match(crm, /<OrganizationQuotationHistory[\s\S]*?readOnly/);
  assert.match(crm, /<OrganizationQuotationHistory[\s\S]*?onCreate=/);
  assert.match(crm, /whizzup\.quotationTarget/);
  assert.match(crm, /JSON\.stringify\(\{ id: quotation\.id, mode: "edit", quotation \}\)[\s\S]*?selectView\("quotations"\)/);
  assert.match(page, /const transferredQuote = target\.quotation\?\.id === Number\(target\.id\)/);
  assert.match(page, /openQuotation\(transferredQuote\)/);
  assert.match(page, /const quote = quotes\.find\(\(item\) => item\.id === Number\(target\.id\)\)/);
  assert.match(page, /if \(quote\) openQuotation\(quote\)/);
  assert.match(page, /target\.scope\?\.organization/);
});

test("institution items can seed a quotation and saved quotations use the same workbook", () => {
  assert.match(page, /등록 품목으로 견적 만들기/);
  assert.match(page, /\/api\/equipment\?organization=/);
  assert.match(page, /catalogUnitPrice/);
  assert.match(page, /quotationWorkbookFile/);
  assert.match(page, /downloadSavedExcel/);
  assert.match(page, /createQuotationWorkbook/);
});

test("quotation quick action uses a plain text label without a currency symbol", () => {
  assert.match(crm, />\s*견적서 만들기\s*<\/button>/);
  assert.doesNotMatch(crm, /<span>₩<\/span>\s*견적서 만들기/);
});

test("general quotation selection shows each institution once and auto-loads the selected round", () => {
  assert.match(page, /institutionOptions/);
  assert.match(page, /normalizedInstitutionName/);
  assert.match(page, /selectInstitution/);
  assert.match(page, /selectBusinessRound/);
  assert.match(page, /loadInstitutionItems/);
  assert.match(page, /현재 작성한 품목을 선택한 기관·차수의 기존 품목으로 교체할까요/);
  assert.match(page, /품목 \$\{equipmentItems\.length\}개/);
  assert.match(page, /constructionAmount/);
  assert.match(page, /constructionDraftItem/);
  assert.match(page, /새 차수 만들기/);
  assert.doesNotMatch(page, /key=\{`\$\{item\.organization\}-\$\{item\.businessRound\}`\}/);
});

test("institution item loading carries catalog settlement and procurement fields without duplicate rows", () => {
  assert.match(page, /const itemMap = new Map/);
  assert.match(page, /catalogItemId \? `catalog:/);
  assert.match(page, /quantity: existing\.quantity \+ item\.quantity/);
  assert.match(page, /procurementNumbersFromText/);
  assert.match(page, /procurementChannelFromText/);
  assert.match(page, /procurementFeeRate/);
});

test("final quotations use same-number editing without a separate revision action", () => {
  assert.doesNotMatch(page, /원본 보존 후 수정/);
  assert.match(page, /견적 수정 저장/);
  assert.doesNotMatch(page, /mode === "revision"/);
  assert.doesNotMatch(page, /revisionSourceId/);
  assert.match(store, /revision_number/);
  assert.match(store, /drive_sync_status='none', drive_sync_error=''/);
  assert.doesNotMatch(store, /최종 견적서는 덮어쓸 수 없습니다/);
});
