import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [crm, accounting, styles] = await Promise.all([
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/accounting/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("공동사업 대표 행은 설치기관별 견적을 합산해 표시한다", () => {
  assert.match(crm, /jointMembers: Activity\[\] = \[record\]/);
  assert.match(crm, /member\.jointProjectRole !== "sponsor"/);
  assert.match(crm, /설치기관 \$\{quotes\.length\.toLocaleString/);
  assert.match(crm, /awardPageGroupByPrimaryId\.get\(record\.id\)\?\.members/);
});

test("통계는 저장된 최신 최종 견적서를 계약금액과 마진 기준으로 사용한다", () => {
  assert.match(accounting, /latestFinalQuotationByBusiness/);
  assert.match(accounting, /finalQuotation\.totalAmount/);
  assert.match(accounting, /finalQuotation\?\.marginAmount \?\? projection\.expectedProfit/);
  assert.match(accounting, /WHERE status = 'final' AND deleted_at = ''/);
});

test("통계 전체화면은 스크롤 없이 요약과 두 그래프를 압축 배치한다", () => {
  assert.match(styles, /\.analytics-tv-mode\{height:100vh;overflow:hidden/);
  assert.match(styles, /grid-template-columns:repeat\(8,minmax\(0,1fr\)\)/);
  assert.match(styles, /grid-template-rows:auto minmax\(0,\.95fr\) minmax\(0,\.8fr\) auto/);
});
