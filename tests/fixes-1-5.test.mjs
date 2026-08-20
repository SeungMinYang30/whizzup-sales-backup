import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [crm, schedule, products, comparisonApi, xlsx, styles] = await Promise.all([
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/construction-schedule-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/product-catalog-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/product-comparison-documents/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/xlsx-preview.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("표준 예산명 관리는 예산별 기관 안으로 이동하고 관리자 점검 탭에서 빠진다", () => {
  assert.match(crm, /view === "budget-institutions"/);
  assert.match(crm, /표준 예산명 관리/);
  assert.match(crm, /budgetWorkspaceSection === "names"[\s\S]{0,180}<BudgetNameManager/);
  assert.doesNotMatch(crm, /managerAdminSection/);
});

test("시공 일정표는 전체 화면 확대와 내부 가로 스크롤을 제공한다", () => {
  assert.match(schedule, /expanded \? "기본 보기" : "크게 보기"/);
  assert.match(schedule, /document\.body\.style\.overflow = "hidden"/);
  assert.match(schedule, /title=\{project\.sourceProductNames/);
  assert.match(styles, /\.construction-schedule-workspace\.is-expanded \{[\s\S]*height: 100dvh/);
  assert.match(styles, /\.construction-schedule-workspace\.is-expanded \.construction-timeline[\s\S]*overflow/);
});

test("내 기록 점검은 기관 정보와 버튼을 읽기 좋은 크기로 표시한다", () => {
  assert.match(styles, /\.protection-review-item strong \{[\s\S]*font-size: 16px/);
  assert.match(styles, /\.protection-review-item small \{[\s\S]*font-size: 12px/);
  assert.match(styles, /\.protection-review-actions button \{[\s\S]*min-height: 42px/);
});

test("물품 비교표는 PDF·Excel 읽기 전용 미리보기와 미지원 형식 안내를 제공한다", () => {
  assert.match(products, />미리보기<\/button>/);
  assert.match(products, /preview=1#zoom=/);
  assert.match(products, /parseXlsxPreview/);
  assert.match(products, /이 파일 형식은 화면 미리보기를 지원하지 않습니다/);
  assert.match(comparisonApi, /isPreview/);
  assert.match(comparisonApi, /isPreview \? "inline" : "attachment"/);
  assert.match(xlsx, /MAX_ROWS = 120/);
  assert.equal(xlsx.includes("xl\\/media"), true);
});

test("조달 제품 체크 영역은 일반 체크박스와 지정 문구를 사용한다", () => {
  assert.match(products, /나라장터·학교장터 등 조달 제품으로 관리/);
  assert.match(products, /className="product-procurement-toggle"/);
  assert.match(styles, /\.product-procurement-toggle input\[type="checkbox"\][\s\S]*width: 18px/);
});
