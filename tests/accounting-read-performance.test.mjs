import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("기관 품목 상세 조회는 데이터 정리 작업 없이 즉시 읽는다", () => {
  const route = source("../app/api/equipment/route.ts");
  const lookup = route.slice(
    route.indexOf("const organization = clean(searchParams.get"),
    route.indexOf("export async function POST"),
  );
  assert.doesNotMatch(lookup, /removeUnselectedLegacyAiEquipment/);
  assert.doesNotMatch(lookup, /syncOrganizationEquipmentSchedule/);
  assert.match(
    lookup,
    /projects: await readProjects\(organization, businessRound\)/,
  );
});

test("납품 완료 수금 목록 조회는 건별 DB 갱신 루프를 실행하지 않는다", () => {
  const route = source("../app/api/accounting/entries/route.ts");
  const store = source("../lib/accounting-store.ts");
  const readEntries = route.slice(
    route.indexOf("async function readEntries"),
    route.indexOf("function errorResponse"),
  );
  assert.match(route, /INSERT OR IGNORE INTO accounting_commission_entries[\s\S]*SELECT a\.id/);
  assert.match(store, /accounting_legacy_settlement_receipts_migrated_v1/);
  assert.match(route, /ensureLegacyReceiptLedgerMigration\(d1\)/);
  assert.match(route, /JOIN accounting_commission_entries e ON e\.id = r\.entry_id/);
  assert.doesNotMatch(readEntries, /for \(const row of result\.results\)/);
  assert.doesNotMatch(readEntries, /syncEntryAggregate/);
});

test("품목 연결과 통계 수금 합계는 묶음 처리와 수금 원장을 사용한다", () => {
  const store = source("../lib/accounting-store.ts");
  const analytics = source("../app/api/accounting/route.ts");
  assert.match(store, /await d1\.batch\(updates\.slice/);
  assert.match(
    analytics,
    /LEFT JOIN accounting_collection_receipts r\s+ON r\.entry_id = e\.id/,
  );
  assert.match(analytics, /COALESCE\(SUM\(r\.amount\), 0\)/);
});
