export type CollectionStatus =
  | "기준금액 미확정"
  | "지급 검토"
  | "미수"
  | "일부 수금"
  | "수금 완료";

export type CollectionReceiptLike = {
  id?: number | string;
  amount: number;
  collectionDate: string;
};

export type CollectionEntryLike<
  TReceipt extends CollectionReceiptLike = CollectionReceiptLike,
> = {
  id: number;
  businessKey?: string;
  businessRound: number;
  activityDate?: string;
  organization: string;
  expectedCommission: number;
  expectedSettlementDeficit?: number;
  commissionCollectedAmount?: number;
  receipts: TReceipt[];
};

export type AwardCollectionSummary<
  TEntry extends CollectionEntryLike = CollectionEntryLike,
> = {
  entry: TEntry;
  expectedRevenue: number;
  settlementDeficit: number;
  basisConfirmed: boolean;
  periodCollected: number;
  cumulativeCollected: number;
  outstandingExpected: number | null;
  lastCollectionDate: string;
  status: CollectionStatus;
};

export type CounterpartyCollectionSummary<
  TEntry extends CollectionEntryLike = CollectionEntryLike,
> = {
  key: string;
  organization: string;
  expectedRevenue: number;
  settlementDeficit: number;
  periodCollected: number;
  cumulativeCollected: number;
  outstandingExpected: number | null;
  lastCollectionDate: string;
  status: CollectionStatus;
  awards: AwardCollectionSummary<TEntry>[];
  unknownBasisCount: number;
};

function counterpartyKey(entry: CollectionEntryLike) {
  const businessInstitutionKey = String(entry.businessKey ?? "").split(
    "\u001f",
  )[0];
  if (businessInstitutionKey) return businessInstitutionKey;
  return entry.organization
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function safeMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function receiptIdentity(receipt: CollectionReceiptLike, index: number) {
  const id = String(receipt.id ?? "").trim();
  return id
    ? `id:${id}`
    : `fallback:${receipt.collectionDate}:${safeMoney(receipt.amount)}:${index}`;
}

/**
 * 같은 입금 행이 조인 결과 등에 중복 포함되어도 한 번만 집계한다.
 * 정상 저장 행은 receipt id를 기준으로 중복을 제거한다.
 */
export function uniqueCollectionReceipts<
  TReceipt extends CollectionReceiptLike,
>(receipts: TReceipt[]) {
  const unique = new Map<string, TReceipt>();
  receipts.forEach((receipt, index) => {
    const key = receiptIdentity(receipt, index);
    if (!unique.has(key)) unique.set(key, receipt);
  });
  return [...unique.values()];
}

export function sumReceiptsForPeriod(
  receipts: CollectionReceiptLike[],
  periodPrefix = "",
) {
  return uniqueCollectionReceipts(receipts).reduce(
    (total, receipt) =>
      !periodPrefix || receipt.collectionDate.startsWith(periodPrefix)
        ? total + safeMoney(receipt.amount)
        : total,
    0,
  );
}

export function automaticCollectionStatus(
  expectedRevenue: number,
  cumulativeCollected: number,
  basisConfirmed = expectedRevenue > 0,
): CollectionStatus {
  if (!basisConfirmed || safeMoney(expectedRevenue) === 0) {
    return "기준금액 미확정";
  }
  const expected = safeMoney(expectedRevenue);
  const collected = safeMoney(cumulativeCollected);
  if (collected === 0) return "미수";
  if (collected < expected) return "일부 수금";
  return "수금 완료";
}

export function expectedOutstandingAmount(
  expectedRevenue: number,
  cumulativeCollected: number,
  basisConfirmed = expectedRevenue > 0,
) {
  if (!basisConfirmed || safeMoney(expectedRevenue) === 0) return null;
  return Math.max(
    0,
    safeMoney(expectedRevenue) - safeMoney(cumulativeCollected),
  );
}

export function summarizeAwardCollection<
  TEntry extends CollectionEntryLike,
>(entry: TEntry, periodPrefix = ""): AwardCollectionSummary<TEntry> {
  const receipts = uniqueCollectionReceipts(entry.receipts);
  const cumulativeFromReceipts = sumReceiptsForPeriod(receipts);
  const cumulativeCollected =
    receipts.length > 0
      ? cumulativeFromReceipts
      : safeMoney(entry.commissionCollectedAmount);
  const expectedRevenue = safeMoney(entry.expectedCommission);
  const settlementDeficit = safeMoney(entry.expectedSettlementDeficit);
  const requiresSettlementPayment = settlementDeficit > 0;
  const basisConfirmed = expectedRevenue > 0 || requiresSettlementPayment;
  return {
    entry,
    expectedRevenue,
    settlementDeficit,
    basisConfirmed,
    periodCollected: sumReceiptsForPeriod(receipts, periodPrefix),
    cumulativeCollected,
    outstandingExpected: requiresSettlementPayment
      ? 0
      : expectedOutstandingAmount(
          expectedRevenue,
          cumulativeCollected,
          basisConfirmed,
        ),
    lastCollectionDate: receipts.reduce(
      (latest, receipt) =>
        receipt.collectionDate > latest ? receipt.collectionDate : latest,
      "",
    ),
    status: requiresSettlementPayment
      ? "지급 검토"
      : automaticCollectionStatus(
          expectedRevenue,
          cumulativeCollected,
          basisConfirmed,
        ),
  };
}

export function aggregateCounterpartyCollections<
  TEntry extends CollectionEntryLike,
>(entries: TEntry[], periodPrefix = "") {
  const grouped = new Map<
    string,
    {
      label: string;
      labelDate: string;
      awards: AwardCollectionSummary<TEntry>[];
    }
  >();

  entries.forEach((entry) => {
    const key = counterpartyKey(entry) || String(entry.id);
    const summary = summarizeAwardCollection(entry, periodPrefix);
    const current = grouped.get(key) ?? {
      label: entry.organization.trim(),
      labelDate: "",
      awards: [],
    };
    const activityDate = String(entry.activityDate ?? "");
    if (activityDate >= current.labelDate) {
      current.label = entry.organization.trim();
      current.labelDate = activityDate;
    }
    current.awards.push(summary);
    grouped.set(key, current);
  });

  return [...grouped.entries()].map(([key, group]) => {
    const expectedRevenue = group.awards.reduce(
      (total, award) => total + award.expectedRevenue,
      0,
    );
    const periodCollected = group.awards.reduce(
      (total, award) => total + award.periodCollected,
      0,
    );
    const cumulativeCollected = group.awards.reduce(
      (total, award) => total + award.cumulativeCollected,
      0,
    );
    const settlementDeficit = group.awards.reduce(
      (total, award) => total + award.settlementDeficit,
      0,
    );
    const unknownBasisCount = group.awards.filter(
      (award) => !award.basisConfirmed,
    ).length;
    const basisConfirmed = unknownBasisCount === 0;
    const outstandingExpected = basisConfirmed
      ? Math.max(0, expectedRevenue - cumulativeCollected)
      : null;
    return {
      key,
      organization: group.label,
      expectedRevenue,
      settlementDeficit,
      periodCollected,
      cumulativeCollected,
      outstandingExpected,
      lastCollectionDate: group.awards.reduce(
        (latest, award) =>
          award.lastCollectionDate > latest
            ? award.lastCollectionDate
            : latest,
        "",
      ),
      status: !basisConfirmed
        ? "기준금액 미확정"
        : settlementDeficit > 0
          ? "지급 검토"
          : automaticCollectionStatus(
              expectedRevenue,
              cumulativeCollected,
              basisConfirmed,
            ),
      awards: group.awards.sort(
        (left, right) =>
          right.entry.businessRound - left.entry.businessRound ||
          String(right.entry.activityDate ?? "").localeCompare(
            String(left.entry.activityDate ?? ""),
          ),
      ),
      unknownBasisCount,
    } satisfies CounterpartyCollectionSummary<TEntry>;
  });
}

export function receiptsFromEntries(entries: CollectionEntryLike[]) {
  return uniqueCollectionReceipts(entries.flatMap((entry) => entry.receipts));
}

export function monthlyCollectionTrend(
  receipts: CollectionReceiptLike[],
  year: string,
) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    const period = `${year}-${month}`;
    return {
      period,
      label: `${index + 1}월`,
      amount: sumReceiptsForPeriod(receipts, period),
    };
  });
}

export function annualCollectionTrend(receipts: CollectionReceiptLike[]) {
  const years = [
    ...new Set(
      uniqueCollectionReceipts(receipts)
        .map((receipt) => receipt.collectionDate.slice(0, 4))
        .filter(Boolean),
    ),
  ].sort();
  return years.map((year) => ({
    period: year,
    label: `${year}년`,
    amount: sumReceiptsForPeriod(receipts, year),
  }));
}
