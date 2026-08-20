import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8");
const dialog = await readFile(new URL("../app/quotation-import-dialog.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/quotations/import/route.ts", import.meta.url), "utf8");
const filesRoute = await readFile(new URL("../app/api/quotations/files/route.ts", import.meta.url), "utf8");
const store = await readFile(new URL("../lib/authored-quotations.ts", import.meta.url), "utf8");
const equipmentKit = await readFile(new URL("../lib/airpass-equipment-kit.ts", import.meta.url), "utf8");
const xlsx = await readFile(new URL("../app/quotation-xlsx.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const profitPdf = await readFile(new URL("../app/consortium-settlement-pdf.ts", import.meta.url), "utf8");

test("승인된 직원은 PDF·XLSX 외부 견적을 분석하되 기관 데이터에는 쓰지 않는다", () => {
  assert.match(route, /await requireApprovedMember\(\)/);
  assert.match(route, /20 \* 1024 \* 1024/);
  assert.doesNotMatch(route, /\/api\/equipment|authored_quotations|product_catalog/);
  assert.match(dialog, /parseQuotationXlsxData/);
  assert.match(dialog, /fetch\("\/api\/quotations\/import"/);
  assert.doesNotMatch(dialog, /\/api\/equipment/);
});

test("분석 결과는 확인·수정·중복 선택 뒤 현재 초안에만 반영한다", () => {
  assert.match(page, />외부 견적 불러오기</);
  assert.match(page, />교구 견적서 불러오기</);
  assert.match(page, /function applyExternalQuotation/);
  assert.match(page, /기관 상세 데이터는 변경하지 않았습니다/);
  assert.match(dialog, /수량 합치기/);
  assert.match(dialog, /별도 품목으로 유지/);
  assert.match(dialog, /기존 품목 교체/);
  assert.match(dialog, /동일 품목 \{duplicateCount\}건 일괄 처리/);
  assert.match(dialog, /중복 품목 모두 제외/);
  assert.match(dialog, /function applyDuplicateBatch/);
  assert.match(dialog, /수수료 포함 최종 합계/);
  assert.match(dialog, /원본 견적 총액에는 조달수수료가 포함되지 않은 것으로 보입니다/);
  assert.match(dialog, /matched\?\.procurementFeeRate \?\? item\.procurementFeeRate \?\? 0\.0054/);
  assert.match(dialog, /function normalizeProcurementFeeRate/);
  assert.match(dialog, /if \(rate > 0\.05\) rate \/= 100/);
  assert.match(route, /0\.54%는 0\.54/);
  assert.match(route, /normalizeExtractedProcurementFeeRate\(item\.procurementFeeRate\)/);
  assert.match(dialog, /현재 견적에 불러오기/);
});

test("견적 인쇄는 별도 창에서 열고 화면 공급자 글자만 확대한다", () => {
  assert.match(page, /window\.open\("", "whizzup-quotation-print"/);
  assert.match(page, /popup\.print\(\)/);
  assert.match(page, /popup\.addEventListener\("afterprint", \(\) => popup\.close\(\)/);
  assert.match(styles, /@media screen[\s\S]*\.quote-studio \.quote-supplier dt \{ font-size: 11px/);
  assert.match(styles, /@media screen[\s\S]*\.quote-studio \.quote-supplier dd \{ font-size: 12px/);
});

test("내부 수익표 PDF는 품목과 비용 상세가 한 장에 들어가면 같은 페이지에 배치한다", () => {
  assert.match(profitPdf, /firstPageCombinedHeight/);
  assert.match(profitPdf, /combineCostsOnFirstPage/);
  assert.match(profitPdf, /page\.costRows\?\.length/);
});

test("교구 견적은 별도 불러오기 창으로 구분하고 현재 견적에 반영한다", () => {
  assert.match(dialog, /mode === "teaching-aids" \? "교구 견적서 불러오기"/);
  assert.match(dialog, /교구 견적 전용/);
  assert.match(dialog, /교구 세부견적에 불러오기/);
  assert.match(page, /result\.mode === "teaching-aids" && equipmentKitEditor/);
  assert.match(page, /교구 세부견적 열기/);
  assert.match(equipmentKit, /compact\.endsWith\("교구세트"\)/);
  assert.match(page, /const editingTargetLabel = draft\?\.id \? "현재 견적" : ""/);
  assert.match(page, /revisionLabel=\{editingTargetLabel\}/);
  assert.match(page, /견적 수정 저장/);
});

test("품목 검색 목록은 바깥 클릭과 Esc로 닫고 목록 내부 동작은 유지한다", () => {
  assert.match(page, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(page, /event\.key !== "Escape"/);
  assert.match(page, /productSearchRef\.current\?\.contains\(target\)/);
  assert.match(page, /productSearchResultsRef\.current\?\.contains\(target\)/);
  assert.match(page, /setProductResultsOpen\(false\)/);
  assert.match(page, /\{productResultsOpen && <div className="quotation-item-search-results"/);
});

test("외부 원본은 최종 파일 저장 때만 견적과 연결된다", () => {
  assert.match(page, /formData\.set\("sourceFile", importSourceFile\)/);
  assert.match(filesRoute, /contextType: "authored-quotation-source"/);
  assert.match(filesRoute, /source_file_id=\?/);
  assert.match(store, /sourceOriginalUrl/);
  assert.match(store, /kind=source/);
});

test("교구 표준 견적서는 시트명과 표 머리글로 1세트·2세트를 구분한다", () => {
  assert.match(xlsx, /function parseWorksheets/);
  assert.ok(xlsx.includes('new RegExp(`교구\\\\s*${planNumber}\\\\s*세트`, "u")'));
  assert.match(xlsx, /\["품명", "품목명", "품목"\]/);
  assert.match(xlsx, /find\(\["수량"\]\)/);
  assert.match(xlsx, /find\(\["단위"\]\)/);
  assert.match(xlsx, /find\(\["단가"\]\)/);
  assert.match(xlsx, /find\(\["금액"\]\)/);
  assert.match(dialog, /parseQuotationXlsxData\(file, \{ mode, equipmentKitPlan \}\)/);
});

test("저장된 교구 세부내역이 없으면 Excel의 전용 시트에서 복구하고 임의 초기화하지 않는다", () => {
  assert.match(page, /fetch\(savedQuote\.excelUrl, \{ cache: "no-store" \}\)/);
  assert.match(page, /requireEquipmentKitSheet: true/);
  assert.match(page, /저장된 Excel의 \$\{parsed\.sheetName/);
  assert.match(page, /기본 구성으로 초기화하지 않았습니다/);
  assert.match(xlsx, /저장된 Excel에 교구 세부견적 시트가 없습니다/);
  assert.match(store, /normalizeAirpassEquipmentKit\(item\.equipmentKit\)/);
});
