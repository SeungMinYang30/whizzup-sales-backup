export type ActualReceiptLike = {
  businessKey: string;
  collectionDate: string;
  amount: number;
};

export type AnalyticsProductLike = {
  catalogItemId: string;
  isCatalogProduct: boolean;
  productName: string;
  priceStatus: string;
};

export function receiptsForDatePrefix<T extends ActualReceiptLike>(
  rows: T[],
  datePrefix: string,
) {
  return rows.filter(
    (row) =>
      row.amount > 0 &&
      Boolean(row.collectionDate) &&
      row.collectionDate.startsWith(datePrefix),
  );
}

export function summarizeActualReceipts<T extends ActualReceiptLike>(
  rows: T[],
  datePrefix: string,
) {
  const matching = receiptsForDatePrefix(rows, datePrefix);
  return {
    amount: matching.reduce((sum, row) => sum + row.amount, 0),
    businessCount: new Set(matching.map((row) => row.businessKey)).size,
  };
}

export function analyticsProductBucket(row: AnalyticsProductLike) {
  return row.isCatalogProduct && row.catalogItemId
    ? {
        key: `catalog:${row.catalogItemId}`,
        label: row.productName,
      }
    : {
        key: "other",
        label: "기타 물품(직접 등록)",
      };
}

export function isMissingAnalyticsPrice(row: Pick<AnalyticsProductLike, "priceStatus">) {
  return row.priceStatus === "금액 미입력";
}
