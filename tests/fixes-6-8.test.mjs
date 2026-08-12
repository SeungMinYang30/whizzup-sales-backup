import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { googleCalendarTitle } from "../lib/google-calendar-title.ts";
import { procurementContractWarnings } from "../lib/procurement-contract-warning.ts";

test("조달 계약 경고는 공급처별 합계와 1억원 경계를 정확히 적용한다", () => {
  const base = { contractType: "g2b", quantity: 1, supplierVendorId: 7, supplierVendorName: "공급사 A" };
  assert.equal(procurementContractWarnings([{ ...base, unitPrice: 99_999_999 }]).length, 0);
  assert.deepEqual(procurementContractWarnings([{ ...base, unitPrice: 100_000_000 }]).map(({ vendorName, totalAmount, itemCount }) => ({ vendorName, totalAmount, itemCount })), [
    { vendorName: "공급사 A", totalAmount: 100_000_000, itemCount: 1 },
  ]);
  assert.equal(procurementContractWarnings([
    { ...base, unitPrice: 60_000_000 },
    { ...base, unitPrice: 40_000_000 },
    { ...base, supplierVendorId: 8, supplierVendorName: "공급사 B", unitPrice: 90_000_000 },
    { ...base, contractType: "s2b", unitPrice: 200_000_000 },
    { ...base, contractType: "direct", unitPrice: 200_000_000 },
  ]).length, 1);
});

test("공급처 미지정 조달 계약은 금액과 무관하게 별도 경고한다", () => {
  const [warning] = procurementContractWarnings([{ contractType: "g2b", quantity: 1, unitPrice: 1 }]);
  assert.equal(warning.unspecified, true);
  assert.equal(warning.vendorName, "공급처 미지정");
});

test("Google 일정 제목은 유형별 규칙을 적용하고 기관명 중복을 제거한다", () => {
  assert.equal(googleCalendarTitle({ organization: "선영어린이집", label: "영업 · 인제 선영어린이집", category: "general" }).summary, "[영업] 선영어린이집 방문");
  assert.equal(googleCalendarTitle({ organization: "A학교", label: "회의 · 예산 협의", category: "meeting" }).summary, "[회의] A학교 회의");
  assert.equal(googleCalendarTitle({ organization: "A학교", label: "착공", category: "construction", productSummary: "VR실 구축" }).summary, "[시공] A학교 · VR실 구축");
  assert.equal(googleCalendarTitle({ organization: "A학교", label: "쇼룸 · 방문", category: "showroom" }).summary, "[쇼룸] A학교 방문");
  assert.equal(googleCalendarTitle({ organization: "A학교", label: "기타 · 설명회", category: "other" }).summary, "[기타] A학교 · 설명회");
});

test("복수 예산은 최종 저장 시 화면과 서버에서 합계 일치를 검증한다", async () => {
  const [page, store] = await Promise.all([
    readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/authored-quotations.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /mergeInstitutionRounds/);
  assert.match(page, /예산 배분 합계[\s\S]*견적 최종 합계와 정확히 일치해야/);
  assert.match(store, /value\.validateFinal === true/);
  assert.match(store, /allocatedTotal !== totalAmount/);
});

test("Google 가져오기는 고유 담당자 ID가 있으면 이름을 덮어쓰지 않는다", async () => {
  const sync = await readFile(new URL("../lib/google-calendar-sync.ts", import.meta.url), "utf8");
  assert.match(sync, /assignee_name = CASE WHEN assignee_member_id IS NULL/);
  assert.match(sync, /resolveScheduleAssignee/);
});
