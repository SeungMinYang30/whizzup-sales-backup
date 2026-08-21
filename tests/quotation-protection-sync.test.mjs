import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const syncSource = await readFile(
  new URL("../lib/quotation-protection-sync.ts", import.meta.url),
  "utf8",
);
const quotationRoute = await readFile(
  new URL("../app/api/quotations/route.ts", import.meta.url),
  "utf8",
);
const equipmentRoute = await readFile(
  new URL("../app/api/equipment/route.ts", import.meta.url),
  "utf8",
);
const quotationPage = await readFile(
  new URL("../app/quotation-management-page.tsx", import.meta.url),
  "utf8",
);
const vercelSchema = await readFile(
  new URL("../db/vercel-schema.ts", import.meta.url),
  "utf8",
);

test("protection candidates include products and kits but exclude service-cost rows", () => {
  assert.match(syncSource, /cleanText\(item\.productId, 180\) \|\| item\.equipmentKit/);
  assert.match(syncSource, /item\.productId === CONSTRUCTION_PRODUCT_ID/);
  assert.match(syncSource, /공사비\|시공비\|설치비\|철거비\|운송비\|배송비/);
});

test("quotation item keys remain stable and disambiguate repeated manual rows", () => {
  assert.match(syncSource, /cleanText\(item\.id, 200\)/);
  assert.match(syncSource, /occurrences\.get\(base\) \?\? 0/);
  assert.match(syncSource, /occurrence === 1 \? base : `\$\{base\}#\$\{occurrence\}`/);
});

test("only final saves run server-side protection sync and report partial failure", () => {
  assert.match(quotationRoute, /if \(quotation\.status === "final"\)/);
  assert.match(quotationRoute, /syncFinalQuotationProtectionItems\(quotation, member\)/);
  assert.match(quotationRoute, /견적은 저장됐지만 영업보호 품목 반영을 완료하지 못했습니다/);
  assert.match(syncSource, /quotation\.status !== "final"/);
  assert.match(quotationPage, /protectionSync\?\.warning/);
});

test("idempotent link reservation prevents retry duplicates and preserves existing protection state", () => {
  assert.match(syncSource, /PRIMARY KEY \(quotation_id, quotation_item_key\)/);
  assert.match(syncSource, /ON CONFLICT \(quotation_id, quotation_item_key\) DO NOTHING/);
  assert.match(syncSource, /SELECT id FROM equipment_items/);
  assert.doesNotMatch(syncSource, /UPDATE equipment_items/);
  assert.match(syncSource, /'신청 필요'/);
  assert.match(vercelSchema, /202608210002_quotation_protection_links/);
});

test("protection list uses the same business round and item creator fallback", () => {
  assert.match(equipmentRoute, /PARTITION BY organization, business_round/);
  assert.match(equipmentRoute, /a\.business_round = p\.business_round/);
  assert.match(equipmentRoute, /COALESCE\(i\.created_by, p\.created_by\) = \?/);
});

test("multiple institution projects never fall back to an unrelated first project", () => {
  assert.match(syncSource, /projects\.results\.length === 1 \? projects\.results\[0\] : undefined/);
  assert.match(syncSource, /ON CONFLICT \(organization, business_round, name\) DO NOTHING/);
});
