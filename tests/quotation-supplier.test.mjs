import assert from "node:assert/strict";
import test from "node:test";

import { applyCatalogSuppliers, findCatalogSupplier } from "../lib/quotation-supplier.ts";

const products = [
  {
    id: "quote-15",
    name: "가상스포츠시스템 (터치스크린)",
    specification: "에어패스 AP-EDUVR-01",
    supplyType: "partner",
    supplierVendorId: 7,
    supplierVendorName: "(주)에어패스",
    procurementNumber: "24563902",
  },
  {
    id: "quote-62",
    name: "터치테이블",
    specification: "위즈업 직접 공급",
    supplyType: "direct",
    supplierVendorId: null,
    supplierVendorName: "",
    procurementNumber: "",
  },
];

function item(overrides = {}) {
  return {
    productId: "",
    name: "과거 품목",
    specification: "과거 규격",
    procurementNumber: "",
    supplyType: "partner",
    supplierVendorId: null,
    supplierVendorName: "",
    ...overrides,
  };
}

test("제품 ID가 연결된 기존 견적은 현재 공급 구분의 협력사를 소급 적용한다", () => {
  const [result] = applyCatalogSuppliers([item({ productId: "quote-15" })], products);
  assert.equal(result.supplyType, "partner");
  assert.equal(result.supplierVendorId, 7);
  assert.equal(result.supplierVendorName, "(주)에어패스");
});

test("과거 견적은 조달 식별번호 또는 유일한 품명·규격으로도 안전하게 연결한다", () => {
  assert.equal(findCatalogSupplier(item({ procurementNumber: "G2B 24563902" }), products)?.id, "quote-15");
  assert.equal(findCatalogSupplier(item({ name: "가상스포츠시스템 (터치스크린)", specification: "에어패스 AP-EDUVR-01" }), products)?.id, "quote-15");
});

test("위즈업 직접 공급과 제품 미연결 품목은 협력사를 임의 지정하지 않는다", () => {
  const [direct, unmatched] = applyCatalogSuppliers([
    item({ productId: "quote-62", supplierVendorId: 7, supplierVendorName: "잘못된 협력사" }),
    item({ supplierVendorName: "기존 수동 공급처" }),
  ], products);
  assert.equal(direct.supplyType, "direct");
  assert.equal(direct.supplierVendorId, null);
  assert.equal(direct.supplierVendorName, "");
  assert.equal(unmatched.supplierVendorName, "기존 수동 공급처");
});
