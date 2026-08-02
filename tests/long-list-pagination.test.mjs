import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const crm = await readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8");
const products = await readFile(new URL("../app/product-catalog-page.tsx", import.meta.url), "utf8");
const vendors = await readFile(new URL("../app/award-vendor-page.tsx", import.meta.url), "utf8");

test("기관별 관리와 관리자 점검은 현재 페이지와 검색 결과 전체 선택을 구분한다", () => {
  assert.match(crm, /aria-label="현재 페이지 기관 전체 선택"/);
  assert.match(crm, /selectAllFilteredInstitutions/);
  assert.match(crm, /selectAllFilteredManagerOrganizations/);
  assert.match(crm, /검색 결과 \{managerOrganizations\.length\.toLocaleString\(\)\}곳 전체 선택/);
  assert.match(crm, /검색 결과 \{followupRows\.length\.toLocaleString\(\)\}곳 전체 선택/);
});

test("기관·관리자·팀 상세 목록은 50건 단위 페이지를 사용한다", () => {
  assert.match(crm, /const DATA_LIST_PAGE_SIZE = 50/);
  assert.match(crm, /label="기관별 관리 페이지"/);
  assert.match(crm, /label="관리자 점검 기관 페이지"/);
  assert.match(crm, /label="팀 업무 상세 기록 페이지"/);
});

test("제품과 협력사 목록은 견적서 작성과 독립적으로 페이지 처리한다", () => {
  assert.match(products, /const PRODUCT_PAGE_SIZE = 50/);
  assert.match(products, /visibleProducts\.slice\(offset, offset \+ PRODUCT_PAGE_SIZE\)/);
  assert.match(products, /aria-label="제품 목록 페이지"/);
  assert.match(vendors, /const VENDOR_PAGE_SIZE = 30/);
  assert.match(vendors, /filtered\.slice\(offset, offset \+ VENDOR_PAGE_SIZE\)/);
  assert.match(vendors, /aria-label="협력사 목록 페이지"/);
});
