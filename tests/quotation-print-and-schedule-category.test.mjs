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

test("내부 수익표는 모바일 인쇄 DOM 대신 실제 PDF 파일을 새 탭에 연다", () => {
  const openFunction = quotationPage.match(/async function openInternalProfitPdf\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(openFunction, /createInternalProfitReportPdf\(input\)/);
  assert.match(openFunction, /URL\.createObjectURL\(file\)/);
  assert.match(openFunction, /popup\.location\.replace\(url\)/);
  assert.doesNotMatch(openFunction, /window\.print|internal-profit-printing/);
  assert.match(quotationPage, />PDF 보기·인쇄</);
});

test("모바일 내부 수익표는 세로 스크롤과 고정 하단 작업 버튼을 제공한다", () => {
  assert.match(styles, /\.quote-internal-report-dialog \{ display: flex; flex-direction: column; max-height: calc\(100dvh - 16px\); overflow-x: hidden; overflow-y: auto;/);
  assert.match(styles, /-webkit-overflow-scrolling: touch/);
  assert.match(styles, /\.quote-internal-report-dialog > footer \{ position: sticky; bottom: 0;/);
  assert.match(styles, /\.quote-internal-report-summary \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.history-layer \{ overflow: hidden; \}/);
  assert.match(styles, /\.history-drawer \{ width: 100%; max-width: 100%; min-width: 0; \}/);
  assert.match(quotationPage, /window\.matchMedia\("\(max-width: 700px\)"\)\.matches/);
});
