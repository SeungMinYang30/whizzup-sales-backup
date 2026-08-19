import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import { unzipSync } from "fflate";

register(new URL("./typescript-resolver.mjs", import.meta.url));
const { createAirpassEquipmentKit } = await import("../lib/airpass-equipment-kit.ts");
const { createFieldInspectionWorkbook } = await import("../lib/quotation-xlsx.ts");

const decode = (value) => new TextDecoder().decode(value);

function sampleInput(withEquipment = true) {
  const equipmentKit = withEquipment ? createAirpassEquipmentKit("one") : undefined;
  return {
    customerName: "매화초등학교",
    quoteDate: "2026-08-17",
    quoteNumber: "WZ-MAEHWA-001",
    projectTitle: "가상현실 스포츠실 구축",
    visitorName: "양승민 이사",
    equipmentKit,
    equipmentKitComplimentary: true,
    lines: [
      {
        productId: "vr-1", name: "가상현실 스포츠시스템", specification: "터치스크린형 시스템", quantity: 1, unit: "대", unitPrice: 27_000_000, note: "",
        supplyType: "partner", supplierVendorName: "에어패스 주식회사",
      },
      {
        productId: "display-1", name: "전자칠판", specification: "멀티미디어 학습장치", quantity: 2, unit: "대", unitPrice: 8_000_000, note: "",
        supplyType: "partner", supplierVendorName: "삼성전자",
      },
      ...(equipmentKit ? [{
        productId: "equipment-1", name: "교구 세트", specification: "별첨 교구 세부견적", quantity: 1, unit: "SET", unitPrice: 1_500_000, note: "", equipmentKit: true, equipmentKitData: equipmentKit, complimentary: true,
        supplyType: "partner", supplierVendorName: "에어패스 주식회사",
      }] : []),
    ],
  };
}

test("현장 검수 Excel은 일반 제품을 확인서에 합치고 교구 목록만 별도 시트로 둔다", () => {
  const files = unzipSync(createFieldInspectionWorkbook(sampleInput(true)));
  const workbook = decode(files["xl/workbook.xml"]);
  assert.match(workbook, /name="견적서"/);
  assert.match(workbook, /name="교구 세부견적"/);
  assert.match(workbook, /name="현장 확인서"/);
  assert.doesNotMatch(workbook, /name="제품 확인 목록"/);
  assert.match(workbook, /name="교구 확인 목록"/);

  const summary = decode(files["xl/worksheets/sheet3.xml"]);
  assert.match(summary, /매화초등학교/);
  assert.match(summary, /WZ-MAEHWA-001/);
  assert.match(summary, /에어패스 주식회사 \/ 삼성전자/);
  assert.match(summary, /현장 지원사/);
  assert.match(summary, /주식회사 위즈업/);
  assert.match(summary, /양승민 이사/);
  assert.match(summary, /제품 상태·작동/);
  assert.match(summary, /상태·작동/);
  assert.doesNotMatch(summary, /제품 기본 작동|작동 확인/);
  assert.match(summary, /견적 제품 현장 확인 목록/);
  assert.match(summary, /가상현실 스포츠시스템/);
  assert.match(summary, /전자칠판/);
  assert.match(summary, /교구 세트/);
  assert.match(summary, /성명: 양승민 이사/);
  assert.doesNotMatch(summary, /계약상 공식 검사·검수 완료/);
  assert.doesNotMatch(summary, /drawing/);

  const equipment = decode(files["xl/worksheets/sheet4.xml"]);
  assert.match(equipment, /축구공 4호/);
  assert.match(equipment, /□ 일치  □ 부족/);
});

test("교구가 없는 견적에는 교구 관련 두 시트를 만들지 않는다", () => {
  const files = unzipSync(createFieldInspectionWorkbook(sampleInput(false)));
  const workbook = decode(files["xl/workbook.xml"]);
  assert.doesNotMatch(workbook, /name="교구 세부견적"/);
  assert.doesNotMatch(workbook, /name="교구 확인 목록"/);
  assert.match(workbook, /name="현장 확인서"/);
  assert.doesNotMatch(workbook, /name="제품 확인 목록"/);
  assert.ok(files["xl/worksheets/sheet2.xml"]);
  assert.equal(files["xl/worksheets/sheet3.xml"], undefined);
});

test("제품이 많은 현장 확인서는 메모·서명 블록 앞에서 수동 페이지를 나눈다", () => {
  const input = sampleInput(false);
  input.lines = Array.from({ length: 10 }, (_, index) => ({
    productId: `product-${index + 1}`,
    name: `현장 확인 제품 ${index + 1}`,
    specification: "긴 규격도 자동 줄바꿈되는 현장 확인용 제품 규격",
    quantity: index + 1,
    unit: "대",
    unitPrice: 1_000_000,
    note: "",
    supplyType: "direct",
    supplierVendorName: "주식회사 위즈업",
  }));
  const files = unzipSync(createFieldInspectionWorkbook(input));
  const summary = decode(files["xl/worksheets/sheet2.xml"]);
  assert.match(summary, /<rowBreaks count="1" manualBreakCount="1">/);
  assert.match(summary, /이상·누락 및 요청사항/);
  assert.match(summary, /확인자 서명/);
});

test("견적 목록·수정 화면·기관 상세에 동일한 현장 검수서류 메뉴와 방문자 입력이 있다", async () => {
  const [page, history, pdf, menuBehavior] = await Promise.all([
    readFile(new URL("../app/quotation-management-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/organization-quotation-history.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/authored-quotation-pdf.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/quotation-output-menu-behavior.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [page, history]) {
    assert.match(source, /현장 검수서류/);
    assert.match(source, /PDF 보기·인쇄/);
    assert.match(source, /PDF 다운로드/);
    assert.match(source, /Excel 통합 다운로드/);
    assert.match(source, /검수 방문자/);
    assert.match(source, /resolveInspectionVisitorName\(inspectionVisitorName, quote\.updatedByName\)/);
  }
  assert.match(pdf, /renderPages\(quote\)/);
  assert.match(pdf, /제품 상태·작동/);
  assert.match(pdf, /상태·작동/);
  assert.doesNotMatch(pdf, /제품 기본 작동|작동 확인/);
  assert.match(pdf, /renderFieldInspectionPages\(quote, visitorName\.trim\(\)/);
  assert.match(pdf, /inspectionSignatureBox\(context, 620, y, 548, 140, visitorName\)/);
  assert.match(pdf, /renderProductInspectionPages\(quote, summary\.renderedProductCount\)/);
  assert.doesNotMatch(pdf, /FIELD_INSPECTION_NOTICE/);
  assert.match(pdf, /function inspectionSection[\s\S]*context\.textAlign = "left"/);
  assert.match(pdf, /function inspectionSignatureBox[\s\S]*context\.textAlign = "left"/);
  assert.match(page, /PDF 열기/);
  assert.match(history, /PDF 열기/);
  assert.doesNotMatch(page, /현장 검수서류 PDF가 준비됐습니다/);
  assert.doesNotMatch(history, /검수서류 PDF가 준비됐습니다/);
  assert.match(page, /새 탭이 차단되었습니다\. PDF 열기를 눌러/);
  assert.match(history, /새 탭이 차단되었습니다\. PDF 열기를 눌러/);
  assert.match(menuBehavior, /pointerdown/);
  assert.match(menuBehavior, /scroll/);
  assert.match(menuBehavior, /Escape/);
  assert.match(menuBehavior, /fetch\("\/api\/session"/);
  assert.match(menuBehavior, /jobTitle\?: string/);
  assert.match(menuBehavior, /personDisplayLabel\(payload\.member \?\? \{\}\)/);
});

test("모바일 시공 일정은 직접 크게 보기와 전체화면·가로보기 안전 대체 동작을 쓴다", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/construction-schedule-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /construction-mobile-expand-button/);
  assert.doesNotMatch(page, /<summary>업무 메뉴<\/summary>/);
  assert.match(page, /requestFullscreen/);
  assert.match(page, /lock\?\.\("landscape"\)/);
  assert.match(page, /history\.pushState/);
  assert.match(page, /window\.addEventListener\("popstate"/);
  assert.match(page, /is-mobile-expanded/);
  assert.match(page, /construction-mobile-row-meta/);
  assert.match(page, /setHideCompleted\(key !== "completed"\)/);
  assert.match(page, /useState<14 \| 31>\(14\)/);
  assert.match(page, /기관명·지역/);
  assert.match(css, /\.construction-mobile-expand-button/);
  assert.match(css, /--construction-fixed-width: 440px/);
  assert.match(css, /\.construction-schedule-workspace\.is-expanded \.construction-mobile-summary \{ display: none; \}/);
  assert.match(css, /\.construction-schedule-workspace\.is-expanded\.is-mobile-expanded/);
  assert.match(css, /--construction-fixed-width: 190px/);
  assert.match(css, /grid-template-columns: 190px/);
});
