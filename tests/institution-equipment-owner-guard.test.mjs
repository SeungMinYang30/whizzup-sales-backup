import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const crm = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const equipmentRoute = await readFile(new URL("../app/api/equipment/route.ts", import.meta.url), "utf8");
const quotationDocuments = await readFile(new URL("../app/quotation-documents.tsx", import.meta.url), "utf8");
const quotationDocumentsRoute = await readFile(new URL("../app/api/quotation-documents/route.ts", import.meta.url), "utf8");

test("기관 상세는 과거 품목 대신 최종 견적 품목과 공사비를 조회 전용으로 표시한다", () => {
  assert.match(crm, /<OrganizationEquipmentManager[\s\S]*?readOnly/);
  const detailEquipment = crm.slice(crm.indexOf("<OrganizationEquipmentManager", crm.indexOf("organization-current-schedule")) - 100, crm.indexOf("<OrganizationEquipmentManager", crm.indexOf("organization-current-schedule")) + 500);
  assert.doesNotMatch(detailEquipment, /isPrimaryOwner/);
  assert.match(crm, /<OrganizationQuotationHistory[\s\S]*?readOnly/);
  assert.match(crm, /<QuotationDocuments[\s\S]*?canManageExternalQuotations=\{false\}/);
  assert.match(crm, /if \(readOnly\) \{[\s\S]*?견적 품목·공사비/);
  assert.match(crm, /quoteSummary=\{detailQuoteSummary\}/);
  assert.doesNotMatch(crm, /PREVIOUS EQUIPMENT DATA/);
  assert.doesNotMatch(crm, /과거 방식으로 저장된 자료/);
});

test("기존 기관 품목 데이터는 읽을 수 있고 복구용 직접 수정 API 권한은 유지한다", () => {
  assert.match(equipmentRoute, /export async function GET[\s\S]*?await requireApprovedMember\(\)/);
  assert.match(equipmentRoute, /export async function POST[\s\S]*?await requirePrimaryOwner\(\)/);
  assert.match(equipmentRoute, /export async function PUT[\s\S]*?await requirePrimaryOwner\(\)/);
  assert.match(equipmentRoute, /export async function DELETE[\s\S]*?await requirePrimaryOwner\(\)/);
});

test("기존 외부 첨부 견적서는 삭제 없이 기관 상세에서 조회만 한다", () => {
  assert.match(quotationDocuments, /canManageExternalQuotations && uploadOpen/);
  assert.match(quotationDocumentsRoute, /export async function GET[\s\S]*?requireApprovedMember/);
  assert.match(quotationDocumentsRoute, /export async function POST[\s\S]*?requirePrimaryOwner/);
});
