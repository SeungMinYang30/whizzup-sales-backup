import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  analyticsProductBucket,
  isMissingAnalyticsPrice,
  summarizeActualReceipts,
} from "../lib/analytics-performance.ts";

test("actual receipts stay in their own collection months", () => {
  const receipts = [
    {
      businessKey: "기관A\u001f1",
      collectionDate: "2026-05-17",
      amount: 10_000_000,
    },
    {
      businessKey: "기관A\u001f1",
      collectionDate: "2026-07-22",
      amount: 40_000_000,
    },
    {
      businessKey: "기관B\u001f1",
      collectionDate: "2026-07-23",
      amount: 5_000_000,
    },
  ];

  assert.deepEqual(summarizeActualReceipts(receipts, "2026-05"), {
    amount: 10_000_000,
    businessCount: 1,
  });
  assert.deepEqual(summarizeActualReceipts(receipts, "2026-07"), {
    amount: 45_000_000,
    businessCount: 2,
  });
});

test("catalog products keep stable IDs while direct items share the other bucket", () => {
  assert.deepEqual(
    analyticsProductBucket({
      catalogItemId: "product-15",
      isCatalogProduct: true,
      productName: "가상스포츠시스템",
      priceStatus: "입력 완료",
    }),
    { key: "catalog:product-15", label: "가상스포츠시스템" },
  );
  assert.deepEqual(
    analyticsProductBucket({
      catalogItemId: "",
      isCatalogProduct: false,
      productName: "직접 등록 의자",
      priceStatus: "금액 미입력",
    }),
    { key: "other", label: "기타 물품(직접 등록)" },
  );
});

test("intentional zero-price items are not reported as missing", () => {
  assert.equal(isMissingAnalyticsPrice({ priceStatus: "금액 미입력" }), true);
  assert.equal(isMissingAnalyticsPrice({ priceStatus: "무상 제공" }), false);
  assert.equal(isMissingAnalyticsPrice({ priceStatus: "계약금액에 포함" }), false);
  assert.equal(isMissingAnalyticsPrice({ priceStatus: "서비스 품목" }), false);
});

test("analytics UI keeps one receipt summary and routes detailed collection analysis to accounting", async () => {
  const [page, accountingRoute, equipmentRoute, performance, collection, migration] =
    await Promise.all([
    readFile(new URL("../app/analytics-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/accounting/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/equipment/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/analytics-performance.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/collection-analytics.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0047_equipment_price_status.sql", import.meta.url),
      "utf8",
    ),
    ]);

  assert.match(accountingRoute, /r\.collection_date/);
  assert.match(accountingRoute, /receipts,/);
  assert.match(page, /<span>당기 수금액<\/span>/);
  assert.match(page, /onOpenCollectionAnalysis/);
  assert.doesNotMatch(page, /월별 실제 수금 흐름/);
  assert.doesNotMatch(page, /매출채권 상위 건/);
  assert.match(collection, /sumReceiptsForPeriod/);
  assert.match(performance, /기타 물품\(직접 등록\)/);
  assert.match(page, /공급 협력사별 판매 성과/);
  assert.match(page, /기관 상세에서 품목 수정/);
  assert.match(equipmentRoute, /cleanPriceStatus/);
  assert.match(migration, /price_status/);
});
