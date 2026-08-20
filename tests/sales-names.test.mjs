import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRegisteredSalesName,
  salesNameAliasKey,
} from "../lib/sales-names.ts";

test("직책 없는 기존 담당자명을 등록된 영업 담당자명으로 연결한다", () => {
  const registered = [
    "김동훈 과장",
    "안재용 사원",
    "양승민 이사",
    "이준상 본부장",
  ];

  assert.equal(resolveRegisteredSalesName("김동훈", registered), "김동훈 과장");
  assert.equal(resolveRegisteredSalesName("이준상", registered), "이준상 본부장");
  assert.equal(
    resolveRegisteredSalesName("  양승민   이사 ", registered),
    "양승민 이사",
  );
});

test("동명이인이면 직책 없는 기존값을 임의로 연결하지 않는다", () => {
  const registered = ["김동훈 과장", "김동훈 부장"];

  assert.equal(resolveRegisteredSalesName("김동훈", registered), null);
  assert.equal(salesNameAliasKey("김동훈 과장"), "김동훈");
  assert.equal(salesNameAliasKey("김동훈 부장"), "김동훈");
});
