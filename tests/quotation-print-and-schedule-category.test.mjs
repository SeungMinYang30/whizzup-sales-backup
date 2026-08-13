import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [quotationPage, quotationPdf, crmPage, schedules, styles] = await Promise.all([
  readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/authored-quotation-pdf.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/organization-schedules.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("기관 상세 일정 분류를 통합 일정 저장값으로 보존한다", () => {
  assert.match(crmPage, /ORGANIZATION_SCHEDULE_CATEGORIES[\s\S]*?영업[\s\S]*?회의[\s\S]*?시공[\s\S]*?쇼룸[\s\S]*?기타[\s\S]*?내 일정/);
  assert.match(crmPage, /aria-label=\{`\$\{index \+ 1\}번째 일정 분류`\}/);
  assert.match(crmPage, /category: schedule\.category/);
  assert.match(schedules, /category\?: string/);
  assert.match(schedules, /const category = normalizeScheduleCategory\(input\.category\)/);
  assert.match(schedules, /SET label = \?, scheduled_date = \?, start_time = \?, end_time = \?, end_date = \?, category = \?/);
  assert.match(schedules, /COALESCE\(category, 'general'\) <> 'construction' OR TRIM\(COALESCE\(stage, ''\)\) = ''/);
});

test("기본 교구 세부견적 13개 품목은 PDF와 인쇄에서 한 장에 배치한다", () => {
  assert.match(quotationPdf, /const detailItemsPerPage = 16/);
  assert.match(quotationPdf, /const rowHeight = pageLines\.length > 13 \? 48 : 54/);
  assert.match(quotationPage, /const itemsPerPage = 16/);
  assert.match(quotationPage, /startIndex: index \* itemsPerPage/);
  assert.doesNotMatch(quotationPage, /Math\.ceil\(lines\.length \/ 10\)/);
});

test("내부 수익표는 별도 창 없이 현재 문서의 전용 인쇄 영역을 한 번만 사용한다", () => {
  const printFunction = quotationPage.match(/function printInternalProfitReport\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(printFunction, /document\.body\.classList\.add\("internal-profit-printing"\)/);
  assert.match(printFunction, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => window\.print\(\)\)\)/);
  assert.doesNotMatch(printFunction, /window\.open|document\.write/);
  assert.match(quotationPage, /className="internal-profit-print-portal print-only"/);
  assert.match(quotationPage, /품목별 수익 내역/);
  assert.match(styles, /body\.internal-profit-printing > \*:not\(\.internal-profit-print-portal\)/);
  assert.match(styles, /\.internal-profit-print-summary[\s\S]*?grid-template-columns: repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.internal-profit-print-items > article[\s\S]*?break-inside: avoid/);
});
