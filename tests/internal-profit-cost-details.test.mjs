import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { register } from "node:module";

register(new URL("./typescript-resolver.mjs", import.meta.url));
const { internalProfitCostCategoryLabel } = await import("../lib/internal-profit-cost-details.ts");

const page = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");
const pdf = await readFile(new URL("../app/consortium-settlement-pdf.ts", import.meta.url), "utf8");
const xlsx = await readFile(new URL("../lib/internal-profit-report-xlsx.ts", import.meta.url), "utf8");

test("내부 수익 상세 분류에는 한글 표시명을 사용한다", () => {
  assert.equal(internalProfitCostCategoryLabel("support"), "교구 할인·지원");
  assert.equal(internalProfitCostCategoryLabel("internal-cost"), "내부 비용");
  assert.equal(internalProfitCostCategoryLabel("bypass"), "콘텐츠 대체");
  assert.match(pdf, /context\.fillText\(fitText\(context, detail\.label/);
  assert.match(pdf, /\[detail\.itemName \|\| "공통", detail\.note\]/);
});

test("바이패스 잔액이 없으면 잔액 수수료 문구를 표시하지 않는다", () => {
  assert.match(page, /const remainingAmount = [\s\S]*?note: remainingAmount > 0/);
  assert.match(page, /: "대체 비용 반영"/);
});

test("추가 공사비는 사업명이 아닌 공사비 항목으로 출력한다", () => {
  assert.match(page, /label: "추가 공사비",\s*itemName: "추가 공사비",\s*amount: constructionCost,\s*note: "내부 수익 차감"/);
  assert.doesNotMatch(page, /label: "추가 공사 원가"/);
  assert.doesNotMatch(page, /itemName: draft\?\.projectTitle \|\| "견적 공통"/);
  assert.doesNotMatch(page, /추가 내부 공사 원가/);
  assert.match(xlsx, /detail\.itemName && detail\.itemName !== detail\.label/);
  assert.match(xlsx, /const costDetails = input\.costDetails \?\? \[\]/);
});

test("화면과 Excel 상세 제목에 영문 또는 바이패스 문구를 노출하지 않는다", () => {
  assert.match(page, /내부 비용·지원·콘텐츠 대체 상세/);
  assert.match(pdf, /내부 비용·지원·콘텐츠 대체 상세/);
  assert.match(xlsx, /내부 비용·지원·콘텐츠 대체 상세/);
  assert.doesNotMatch(page, /내부 비용·지원·바이패스 상세/);
  assert.doesNotMatch(pdf, /내부 비용·지원·바이패스 상세/);
  assert.doesNotMatch(xlsx, /내부 비용·지원·바이패스 상세/);
});
