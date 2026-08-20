import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [styles, menuBehavior, inspectionPdf] = await Promise.all([
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/quotation-output-menu-behavior.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/authored-quotation-pdf.ts", import.meta.url), "utf8"),
]);

test("초광폭 제품 화면은 읽기 폭과 견적 행 간격을 제한한다", () => {
  assert.match(styles, /@media \(min-width: 1800px\)[\s\S]*\.content\.content-wide:has\(> \.product-workspace-tabs\)[\s\S]*max-width: 1840px/);
  assert.match(styles, /@media \(min-width: 1800px\)[\s\S]*\.quotation-list-row[\s\S]*minmax\(660px, 1\.55fr\)/);
});

test("현장 검수 메뉴는 카드 밖으로 나오고 화면 하단에서는 위로 열린다", () => {
  assert.match(menuBehavior, /positionOpenMenu/);
  assert.match(menuBehavior, /panelRect\.bottom > window\.innerHeight - 12/);
  assert.match(menuBehavior, /quotation-output-menu-upward/);
  assert.match(menuBehavior, /quotation-workspace-menu-open/);
  assert.match(styles, /\.quotation-workspace\.quotation-workspace-menu-open \{ overflow: visible; \}/);
  assert.match(styles, /\.quotation-output-menu\.quotation-output-menu-upward > \.quotation-output-menu-panel/);
});

test("등록 업체 목록은 남은 화면 높이 안에서만 스크롤하고 마지막 줄 여백을 둔다", () => {
  assert.match(styles, /\.award-vendor-directory[\s\S]*height: calc\(100dvh - 112px\)/);
  assert.match(styles, /\.award-vendor-list[\s\S]*min-height: 0[\s\S]*padding-bottom: 24px[\s\S]*scroll-padding-bottom: 24px/);
});

test("현장 확인서가 첫 장이고 기존 견적서는 첨부 순서로 뒤에 붙는다", () => {
  assert.match(inspectionPdf, /jpegPagesToPdf\(\[\.\.\.inspectionPages, \.\.\.quotationPages\]\)/);
  assert.doesNotMatch(inspectionPdf, /fontSize: columnIndex >= 6 \? 11 : 13/);
});
