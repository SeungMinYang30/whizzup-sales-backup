"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  aggregateCounterpartyCollections,
  annualCollectionTrend,
  automaticCollectionStatus,
  monthlyCollectionTrend,
  receiptsFromEntries,
  sumReceiptsForPeriod,
  type CounterpartyCollectionSummary,
} from "../lib/collection-analytics";

type SourceItem = {
  id: number;
  projectId: number;
  projectName: string;
  productName: string;
  specification: string;
  quantity: number;
  unitPrice: number;
  supplyType?: "partner" | "direct";
  commissionRate: number | null;
  marginRate?: number | null;
  expectedPartnerCommission?: number;
  expectedDirectSalesCollection?: number;
  expectedDirectMargin?: number;
  expectedCommission: number;
  expectedConsortiumSettlement: number;
  executionType: "직영" | "컨소";
  supplierVendorId: number | null;
  supplierVendorName: string;
};

type SourceProject = {
  id: number;
  name: string;
  constructionAmount: number;
  actualConstructionCost: number;
  constructionMargin: number;
};

type Receipt = {
  id: number;
  entryId: number;
  amount: number;
  collectionDate: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  legacy: boolean;
};

type RegisteredQuoteStatus = "complete" | "partial" | "missing";

export type AccountingEntry = {
  id: number;
  activityId: number;
  businessKey: string;
  businessRound: number;
  groupedActivityIds: number[];
  activityDate: string;
  organization: string;
  region: string;
  budgetType: string;
  progressManager: string;
  contractAmountReference: number;
  quoteStatus: RegisteredQuoteStatus;
  quoteItemCount: number;
  quoteMissingAmountItemCount: number;
  executionType: "직영" | "컨소";
  consortiumCompany: string;
  sourceItems: SourceItem[];
  sourceProjects: SourceProject[];
  expectedPartnerCommission?: number;
  expectedDirectSalesCollection?: number;
  expectedDirectMargin?: number;
  expectedConstructionMargin?: number;
  expectedCollectionTotal?: number;
  expectedSettlementDeficit?: number;
  expectedProfit?: number;
  expectedCommission: number;
  expectedConsortiumSettlement: number;
  expectedContributionMargin: number;
  commissionCollectedAmount: number;
  receivableBalance: number;
  collectionDate: string;
  workflowExcluded: boolean;
  workflowExcludedAt: string;
  confirmed: boolean;
  accountingStatus: string;
  needsCollection: boolean;
  receipts: Receipt[];
};

type UpcomingAccountingEntry = {
  activityId: number;
  businessKey: string;
  businessRound: number;
  activityDate: string;
  organization: string;
  region: string;
  budgetType: string;
  progressManager: string;
  awardStage: string;
  contractAmountReference: number;
  quoteStatus: RegisteredQuoteStatus;
  quoteItemCount: number;
  quoteMissingAmountItemCount: number;
  expectedPartnerCommission: number;
  expectedDirectSalesCollection: number;
  expectedDirectMargin: number;
  expectedConstructionMargin: number;
  expectedConsortiumSettlement: number;
  expectedProfit: number;
  expectedCollectionTotal: number;
  expectedSettlementDeficit: number;
  sourceItems: SourceItem[];
  sourceProjects: SourceProject[];
};

type UpcomingAccountingSummary = {
  organizationCount: number;
  businessCount: number;
  expectedPartnerCommission: number;
  expectedDirectSalesCollection: number;
  expectedDirectMargin: number;
  expectedConstructionMargin: number;
  expectedConsortiumSettlement: number;
  expectedProfit: number;
  expectedCollectionTotal: number;
  expectedSettlementDeficit: number;
};

type Focus = "all" | "needsCollection" | "collected" | "receivable" | "margin";
export type AccountingWorkspaceTab =
  | "upcoming"
  | "collections"
  | "counterparties"
  | "analysis";

const focusLabels: Record<Focus, string> = {
  all: "전체 보기",
  needsCollection: "수금 확인 필요",
  collected: "누적 수금액",
  receivable: "미수수익 예상액",
  margin: "예상 공헌이익",
};

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatRate(value: number | null | undefined) {
  if (value === null || value === undefined) return "미입력";
  return `${(value * 100).toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  })}%`;
}

function rawAmount(value: string) {
  return value.replace(/[^\d]/g, "");
}

function displayAmount(value: string) {
  const parsed = Number(rawAmount(value));
  return value && Number.isFinite(parsed) ? parsed.toLocaleString("ko-KR") : "";
}

function today() {
  return new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul",
  });
}

function currentYear() {
  return today().slice(0, 4);
}

function matchesFocus(entry: AccountingEntry, focus: Focus) {
  if (focus === "needsCollection") return entry.needsCollection;
  if (focus === "collected") return entry.commissionCollectedAmount > 0;
  if (focus === "receivable") return entry.receivableBalance > 0;
  if (focus === "margin") return entry.expectedContributionMargin !== 0;
  return true;
}

function collectionTarget(entry: AccountingEntry) {
  return entry.expectedCollectionTotal ?? entry.expectedCommission;
}

function settlementDeficit(entry: AccountingEntry) {
  return Math.max(0, entry.expectedSettlementDeficit ?? 0);
}

function collectionTargetLabel(entry: AccountingEntry) {
  if (settlementDeficit(entry) > 0) return formatMoney(collectionTarget(entry));
  return collectionTarget(entry) > 0
    ? formatMoney(collectionTarget(entry))
    : "기준금액 미확정";
}

function receivableLabel(entry: AccountingEntry) {
  if (settlementDeficit(entry) > 0) return formatMoney(entry.receivableBalance);
  return collectionTarget(entry) > 0
    ? formatMoney(entry.receivableBalance)
    : "기준금액 미확정";
}

function collectionStatusLabel(entry: AccountingEntry) {
  if (entry.workflowExcluded) return "숨긴 기록";
  if (settlementDeficit(entry) > 0) return "지급 검토";
  return automaticCollectionStatus(
    collectionTarget(entry),
    entry.commissionCollectedAmount,
  );
}

function expectedProfit(entry: AccountingEntry) {
  return entry.expectedProfit ?? entry.expectedContributionMargin;
}

function directSupplyCostBasis(entry: AccountingEntry) {
  return Math.max(
    0,
    (entry.expectedDirectSalesCollection ?? 0) -
      (entry.expectedDirectMargin ?? 0),
  );
}

function isCollectionComplete(entry: AccountingEntry) {
  const target = collectionTarget(entry);
  return target > 0 && entry.commissionCollectedAmount >= target;
}

function contributionMarginView(entry: AccountingEntry) {
  if (!isCollectionComplete(entry)) {
    return {
      amount: expectedProfit(entry),
      label: "예상 공헌이익",
      detail: "수금 완료 전 예상치",
      actual: false,
    };
  }
  return {
    amount:
      entry.commissionCollectedAmount -
      directSupplyCostBasis(entry) -
      entry.expectedConsortiumSettlement,
    label: "수금 기준 공헌이익",
    detail: "실제 수금액에서 직접 공급 원가와 컨소 정산 기준액 차감",
    actual: true,
  };
}

function latestCollectionDate(entry: AccountingEntry) {
  return (
    entry.receipts
      .map((receipt) => receipt.collectionDate)
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))[0] || "—"
  );
}

function RegisteredQuoteContractAmount({
  entry,
}: {
  entry: Pick<
    AccountingEntry | UpcomingAccountingEntry,
    | "contractAmountReference"
    | "quoteStatus"
    | "quoteMissingAmountItemCount"
  >;
}) {
  if (entry.quoteStatus === "missing") {
    return (
      <>
        <strong>견적 미등록</strong>
        <small>품목·공사비 견적을 등록해 주세요.</small>
      </>
    );
  }

  if (entry.quoteStatus === "partial") {
    return (
      <>
        <strong>견적 금액 확인 필요</strong>
        <small>
          현재 입력 합계 {formatMoney(entry.contractAmountReference)}
          {entry.quoteMissingAmountItemCount > 0
            ? ` · ${entry.quoteMissingAmountItemCount.toLocaleString("ko-KR")}개 품목 확인`
            : ""}
        </small>
      </>
    );
  }

  return <strong>{formatMoney(entry.contractAmountReference)}</strong>;
}

function MoneyField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="accounting-money-input">
      <input
        inputMode="numeric"
        aria-label="실제 수금액"
        value={displayAmount(value)}
        onChange={(event) => onChange(rawAmount(event.target.value))}
        placeholder="0"
      />
      <b>원</b>
    </div>
  );
}
export default function AccountingPage({
  onSaved,
  initialTab = "collections",
}: {
  onSaved?: (entry: AccountingEntry) => void;
  initialTab?: AccountingWorkspaceTab;
}) {
  const [entries, setEntries] = useState<AccountingEntry[]>([]);
  const [upcomingEntries, setUpcomingEntries] = useState<
    UpcomingAccountingEntry[]
  >([]);
  const [upcomingSummary, setUpcomingSummary] =
    useState<UpcomingAccountingSummary | null>(null);
  const [tab, setTab] = useState<AccountingWorkspaceTab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [upcomingSearch, setUpcomingSearch] = useState("");
  const [counterpartySearch, setCounterpartySearch] = useState("");
  const [yearFilter, setYearFilter] = useState("전체 연도");
  const [analysisYear, setAnalysisYear] = useState(currentYear);
  const [focus, setFocus] = useState<Focus>("all");
  const [showExcluded, setShowExcluded] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<number>>(
    new Set(),
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedCounterpartyKey, setSelectedCounterpartyKey] = useState("");
  const [editingReceiptId, setEditingReceiptId] = useState<number | null>(null);
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState(today());
  const [receiptNote, setReceiptNote] = useState("");
  const listRef = useRef<HTMLElement | null>(null);

  async function loadEntries() {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
    try {
      setLoading(true);
      const [response, upcomingResponse] = await Promise.all([
        fetch("/api/accounting/entries", {
          cache: "no-store",
          signal: controller.signal,
        }),
        fetch("/api/accounting/entries?scope=upcoming", {
          cache: "no-store",
          signal: controller.signal,
        }),
      ]);
      const payload = (await response.json()) as {
        entries?: AccountingEntry[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "수금 목록을 불러오지 못했습니다.");
      }
      setEntries(payload.entries ?? []);
      const upcomingPayload = (await upcomingResponse.json()) as {
        upcomingEntries?: UpcomingAccountingEntry[];
        upcomingSummary?: UpcomingAccountingSummary;
        error?: string;
      };
      if (upcomingResponse.ok) {
        setUpcomingEntries(upcomingPayload.upcomingEntries ?? []);
        setUpcomingSummary(upcomingPayload.upcomingSummary ?? null);
        setError("");
      } else {
        setUpcomingEntries([]);
        setUpcomingSummary(null);
        setError(
          upcomingPayload.error || "입금 예정 목록을 불러오지 못했습니다.",
        );
      }
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === "AbortError"
          ? "수금 목록 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
          : caught instanceof Error
            ? caught.message
            : "수금 목록을 불러오지 못했습니다.",
      );
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  useEffect(() => {
    // Initial remote data synchronization is intentionally performed once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEntries();
  }, []);

  const selectedEntry =
    entries.find((entry) => entry.id === selectedId) ?? null;
  const years = useMemo(
    () =>
      [
        ...new Set([
          currentYear(),
          ...entries
            .map((entry) => entry.activityDate.slice(0, 4))
            .filter(Boolean),
        ]),
      ]
        .sort((left, right) => right.localeCompare(left)),
    [entries],
  );
  const collectionYears = useMemo(
    () =>
      [
        ...new Set([
          currentYear(),
          ...entries.flatMap((entry) =>
            entry.receipts
              .map((receipt) => receipt.collectionDate.slice(0, 4))
              .filter(Boolean),
          ),
        ]),
      ].sort((left, right) => right.localeCompare(left)),
    [entries],
  );
  const activeEntries = useMemo(
    () => entries.filter((entry) => !entry.workflowExcluded),
    [entries],
  );
  const collectionAnalysisEntries = useMemo(
    () =>
      activeEntries.map((entry) => ({
        ...entry,
        expectedCommission: collectionTarget(entry),
      })),
    [activeEntries],
  );
  const filteredUpcomingEntries = useMemo(() => {
    const keyword = upcomingSearch.trim().toLocaleLowerCase("ko-KR");
    return upcomingEntries
      .filter(
        (entry) =>
          !keyword ||
          `${entry.organization} ${entry.region} ${entry.budgetType} ${entry.progressManager} ${entry.awardStage}`
            .toLocaleLowerCase("ko-KR")
            .includes(keyword),
      )
      .sort(
        (left, right) =>
          left.activityDate.localeCompare(right.activityDate) ||
          left.organization.localeCompare(right.organization, "ko-KR"),
      );
  }, [upcomingEntries, upcomingSearch]);
  const upcomingTotals = useMemo<UpcomingAccountingSummary>(() => {
    if (upcomingSummary) return upcomingSummary;
    const total = (field: keyof UpcomingAccountingEntry) =>
      upcomingEntries.reduce((sum, entry) => {
        const value = entry[field];
        return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
      }, 0);
    return {
      organizationCount: new Set(
        upcomingEntries.map((entry) => entry.organization.trim()).filter(Boolean),
      ).size,
      businessCount: upcomingEntries.length,
      expectedPartnerCommission: total("expectedPartnerCommission"),
      expectedDirectSalesCollection: total("expectedDirectSalesCollection"),
      expectedDirectMargin: total("expectedDirectMargin"),
      expectedConstructionMargin: total("expectedConstructionMargin"),
      expectedConsortiumSettlement: total("expectedConsortiumSettlement"),
      expectedProfit: total("expectedProfit"),
      expectedCollectionTotal: total("expectedCollectionTotal"),
      expectedSettlementDeficit: total("expectedSettlementDeficit"),
    };
  }, [upcomingEntries, upcomingSummary]);
  const periodEntries = useMemo(
    () =>
      activeEntries.filter(
        (entry) =>
          yearFilter === "전체 연도" ||
          entry.activityDate.startsWith(yearFilter),
      ),
    [activeEntries, yearFilter],
  );
  const filteredEntries = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("ko-KR");
    return (showExcluded ? entries : activeEntries)
      .filter((entry) => {
        if (
          keyword &&
          !`${entry.organization} ${entry.region} ${entry.budgetType} ${entry.progressManager} ${entry.consortiumCompany}`
            .toLocaleLowerCase("ko-KR")
            .includes(keyword)
        ) {
          return false;
        }
        if (
          yearFilter !== "전체 연도" &&
          !entry.activityDate.startsWith(yearFilter)
        ) {
          return false;
        }
        return matchesFocus(entry, focus);
      })
      .sort((left, right) =>
        focus === "needsCollection"
          ? left.activityDate.localeCompare(right.activityDate) ||
            left.organization.localeCompare(right.organization, "ko-KR")
          : right.activityDate.localeCompare(left.activityDate),
      );
  }, [activeEntries, entries, focus, search, showExcluded, yearFilter]);

  const summary = useMemo(
    () => ({
      needsCollection: periodEntries.filter((entry) => entry.needsCollection).length,
      collected: sumReceiptsForPeriod(
        receiptsFromEntries(activeEntries),
        analysisYear,
      ),
      receivable: aggregateCounterpartyCollections(
        collectionAnalysisEntries,
      ).reduce((total, row) => total + (row.outstandingExpected ?? 0), 0),
      margin: periodEntries.reduce(
        (total, entry) => total + expectedProfit(entry),
        0,
      ),
    }),
    [activeEntries, analysisYear, collectionAnalysisEntries, periodEntries],
  );

  const allReceipts = useMemo(
    () => receiptsFromEntries(activeEntries),
    [activeEntries],
  );
  const counterpartyRows = useMemo(
    () =>
      aggregateCounterpartyCollections(
        collectionAnalysisEntries,
        analysisYear,
      ).sort(
        (left, right) =>
          (right.outstandingExpected ?? -1) -
            (left.outstandingExpected ?? -1) ||
          right.expectedRevenue - left.expectedRevenue ||
          left.organization.localeCompare(right.organization, "ko-KR"),
      ),
    [analysisYear, collectionAnalysisEntries],
  );
  const filteredCounterpartyRows = useMemo(() => {
    const keyword = counterpartySearch.trim().toLocaleLowerCase("ko-KR");
    if (!keyword) return counterpartyRows;
    return counterpartyRows.filter((row) =>
      row.organization.toLocaleLowerCase("ko-KR").includes(keyword),
    );
  }, [counterpartyRows, counterpartySearch]);
  const selectedCounterparty =
    counterpartyRows.find((row) => row.key === selectedCounterpartyKey) ?? null;
  const periodCollectionAmount = useMemo(
    () => sumReceiptsForPeriod(allReceipts, analysisYear),
    [allReceipts, analysisYear],
  );
  const monthlyTrend = useMemo(
    () => monthlyCollectionTrend(allReceipts, analysisYear),
    [allReceipts, analysisYear],
  );
  const annualTrend = useMemo(
    () => annualCollectionTrend(allReceipts),
    [allReceipts],
  );
  const topCollectedCounterparties = useMemo(
    () =>
      counterpartyRows
        .filter((row) => row.periodCollected > 0)
        .sort(
          (left, right) =>
            right.periodCollected - left.periodCollected ||
            right.cumulativeCollected - left.cumulativeCollected,
        ),
    [counterpartyRows],
  );
  const topOutstandingCounterparties = useMemo(
    () =>
      counterpartyRows
        .filter((row) => (row.outstandingExpected ?? 0) > 0)
        .sort(
          (left, right) =>
            (right.outstandingExpected ?? 0) -
            (left.outstandingExpected ?? 0),
        ),
    [counterpartyRows],
  );
  const statusCounterparties = useMemo(
    () => ({
      complete: counterpartyRows.filter((row) => row.status === "수금 완료"),
      partial: counterpartyRows.filter((row) => row.status === "일부 수금"),
      unpaid: counterpartyRows.filter((row) => row.status === "미수"),
      paymentReview: counterpartyRows.filter(
        (row) => row.status === "지급 검토",
      ),
      unknown: counterpartyRows.filter(
        (row) => row.status === "기준금액 미확정",
      ),
    }),
    [counterpartyRows],
  );

  const selectedEntries = entries.filter((entry) =>
    selectedEntryIds.has(entry.id),
  );
  const allFilteredSelected =
    filteredEntries.length > 0 &&
    filteredEntries.every((entry) => selectedEntryIds.has(entry.id));

  function toggleEntrySelection(entryId: number) {
    setSelectedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  function toggleFilteredSelection() {
    setSelectedEntryIds((current) => {
      const next = new Set(current);
      filteredEntries.forEach((entry) => {
        if (allFilteredSelected) next.delete(entry.id);
        else next.add(entry.id);
      });
      return next;
    });
  }

  async function updateWorkflowExclusion() {
    if (!selectedEntries.length || saving) return;
    const allExcluded = selectedEntries.every(
      (entry) => entry.workflowExcluded,
    );
    const allActive = selectedEntries.every(
      (entry) => !entry.workflowExcluded,
    );
    if (!allExcluded && !allActive) {
      setError("표시 중인 기록과 숨긴 기록을 나누어 선택해 주세요.");
      return;
    }
    const action = allExcluded ? "restore" : "exclude";
    const message =
      action === "exclude"
        ? `선택한 ${selectedEntries.length.toLocaleString()}건을 사이트 도입 전 기록으로 숨길까요?\n원본과 실수금 내역은 그대로 보존되고, 회계 기본 작업목록과 요약 합계에서만 제외됩니다.`
        : `선택한 ${selectedEntries.length.toLocaleString()}건을 회계 작업목록과 요약 합계에 다시 표시할까요?`;
    if (!window.confirm(message)) return;
    try {
      setSaving(true);
      const response = await fetch("/api/accounting/entries", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          entryIds: selectedEntries.map((entry) => entry.id),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "선택한 항목을 처리하지 못했습니다.");
      }
      setSelectedEntryIds(new Set());
      await loadEntries();
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "선택한 항목을 처리하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  function resetReceiptForm() {
    setEditingReceiptId(null);
    setReceiptAmount("");
    setReceiptDate(today());
    setReceiptNote("");
  }

  function openEditor(entry: AccountingEntry) {
    setSelectedId(entry.id);
    resetReceiptForm();
  }

  function applyFocus(nextFocus: Focus) {
    setTab("collections");
    setSearch("");
    setFocus(nextFocus);
    setSelectedId(null);
    window.requestAnimationFrame(() =>
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  function openCollections() {
    setTab("collections");
    setSearch("");
    setYearFilter("전체 연도");
    setFocus("all");
    setSelectedId(null);
  }

  function openUpcoming() {
    setTab("upcoming");
    setSelectedId(null);
    window.requestAnimationFrame(() =>
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  function openCounterparty(
    row: CounterpartyCollectionSummary<AccountingEntry>,
  ) {
    setSelectedCounterpartyKey(row.key);
  }

  function editReceipt(receipt: Receipt) {
    setEditingReceiptId(receipt.id);
    setReceiptAmount(String(receipt.amount));
    setReceiptDate(receipt.collectionDate);
    setReceiptNote(receipt.note);
  }

  async function saveReceipt() {
    if (!selectedEntry || saving) return;
    if (!receiptAmount || !receiptDate) {
      setError("실제 수금액과 수금일을 입력해 주세요.");
      return;
    }
    try {
      setSaving(true);
      const response = await fetch("/api/accounting/entries", {
        method: editingReceiptId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: selectedEntry.id,
          receiptId: editingReceiptId,
          amount: Number(receiptAmount),
          collectionDate: receiptDate,
          note: receiptNote,
        }),
      });
      const payload = (await response.json()) as {
        entry?: AccountingEntry;
        error?: string;
      };
      if (!response.ok || !payload.entry) {
        throw new Error(payload.error || "수금 내역을 저장하지 못했습니다.");
      }
      const nextEntries = entries.map((entry) =>
        entry.id === payload.entry?.id ? payload.entry : entry,
      );
      setEntries(nextEntries);
      onSaved?.(payload.entry);
      resetReceiptForm();
      setSelectedId(null);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "수금 내역을 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveFullReceipt() {
    if (!selectedEntry || saving || selectedEntry.receivableBalance <= 0) {
      return;
    }
    try {
      setSaving(true);
      const response = await fetch("/api/accounting/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: selectedEntry.id,
          amount: selectedEntry.receivableBalance,
          collectionDate: today(),
          note: "남은 금액 전액 입금",
        }),
      });
      const payload = (await response.json()) as {
        entry?: AccountingEntry;
        error?: string;
      };
      if (!response.ok || !payload.entry) {
        throw new Error(payload.error || "전액 입금 내역을 저장하지 못했습니다.");
      }
      setEntries((current) =>
        current.map((entry) =>
          entry.id === payload.entry?.id ? payload.entry : entry,
        ),
      );
      onSaved?.(payload.entry);
      resetReceiptForm();
      setSelectedId(null);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "전액 입금 내역을 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteReceipt(receipt: Receipt) {
    if (!selectedEntry || saving) return;
    if (
      !window.confirm(
        `${formatMoney(receipt.amount)} 수금 내역을 삭제할까요?\n삭제 후 누적 수금액과 미수수익 예상액이 다시 계산됩니다.`,
      )
    ) {
      return;
    }
    try {
      setSaving(true);
      const response = await fetch("/api/accounting/entries", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptId: receipt.id }),
      });
      const payload = (await response.json()) as {
        entry?: AccountingEntry;
        error?: string;
      };
      if (!response.ok || !payload.entry) {
        throw new Error(payload.error || "수금 내역을 삭제하지 못했습니다.");
      }
      setEntries((current) =>
        current.map((entry) =>
          entry.id === payload.entry?.id ? payload.entry : entry,
        ),
      );
      onSaved?.(payload.entry);
      if (editingReceiptId === receipt.id) resetReceiptForm();
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "수금 내역을 삭제하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="accounting-page">
      <div className="accounting-summary-grid">
        <button
          type="button"
          className={`accounting-summary-card info ${
            tab === "upcoming" ? "active" : ""
          }`}
          style={{ gridColumn: "1 / -1" }}
          disabled={loading}
          onClick={openUpcoming}
        >
          <span>진행 중 총 입금 예정액</span>
          <strong>{formatMoney(upcomingTotals.expectedCollectionTotal)}</strong>
          <small>
            {upcomingTotals.organizationCount.toLocaleString()}개 거래처 ·{" "}
            {upcomingTotals.businessCount.toLocaleString()}건의 납품 완료 전 위즈업
            수주
            {upcomingTotals.expectedSettlementDeficit > 0
              ? ` · 지급 검토 ${formatMoney(
                  upcomingTotals.expectedSettlementDeficit,
                )}`
              : ""}
          </small>
        </button>
        <button
          type="button"
          className={`accounting-summary-card warning ${
            tab === "collections" && focus === "needsCollection" ? "active" : ""
          }`}
          disabled={loading}
          onClick={() => applyFocus("needsCollection")}
        >
          <span>수금 확인 필요</span>
          <strong>{summary.needsCollection.toLocaleString()}건</strong>
          <small>클릭하면 확인할 수금 목록만 모아봅니다</small>
        </button>
        <button
          type="button"
          className={`accounting-summary-card success ${tab === "analysis" ? "active" : ""}`}
          disabled={loading}
          onClick={() => setTab("analysis")}
        >
          <span>{analysisYear}년 당기 수금액</span>
          <strong>{formatMoney(summary.collected)}</strong>
          <small>실제 입금일과 입금액만 자동 합산합니다</small>
        </button>
        <button
          type="button"
          className={`accounting-summary-card danger ${tab === "counterparties" ? "active" : ""}`}
          disabled={loading}
          onClick={() => setTab("counterparties")}
        >
          <span>미수수익 예상액</span>
          <strong>{formatMoney(summary.receivable)}</strong>
          <small>총 입금 예정액에서 누적 수금액을 뺀 관리용 예상치입니다</small>
        </button>
        <button
          type="button"
          className={`accounting-summary-card info ${
            tab === "collections" && focus === "margin" ? "active" : ""
          }`}
          disabled={loading}
          onClick={() => applyFocus("margin")}
        >
          <span>예상 공헌이익</span>
          <strong>{formatMoney(summary.margin)}</strong>
          <small>
            수수료·직접 공급 마진·공사 마진에서 컨소 정산 기준액을 뺀
            값입니다
          </small>
        </button>
      </div>

      <article className="panel accounting-list-panel" ref={listRef}>
        <div className="accounting-panel-heading">
          <div>
            <span className="section-kicker">COLLECTION CONTROL</span>
            <h2>수금·채권 관리</h2>
            <p>
              진행 중인 위즈업 수주의 총 입금 예정액을 확인하고, 납품
              완료 후에는 회계 담당자가 실제 수금액만 등록합니다.
            </p>
          </div>
          <button type="button" onClick={() => void loadEntries()} disabled={loading}>
            새로고침
          </button>
        </div>

        <div className="accounting-workspace-tabs" role="tablist">
          <button
            type="button"
            className={tab === "upcoming" ? "active" : ""}
            onClick={() => setTab("upcoming")}
          >
            입금 예정
          </button>
          <button
            type="button"
            className={tab === "collections" ? "active" : ""}
            onClick={openCollections}
          >
            수금·채권 관리
          </button>
          <button
            type="button"
            className={tab === "counterparties" ? "active" : ""}
            onClick={() => setTab("counterparties")}
          >
            거래처별 채권
          </button>
          <button
            type="button"
            className={tab === "analysis" ? "active" : ""}
            onClick={() => setTab("analysis")}
          >
            수금 분석
          </button>
        </div>

        {error && <p className="notice error accounting-error">{error}</p>}

        {tab === "upcoming" && (
          <div className="accounting-subview accounting-analysis">
            <header>
              <div>
                <h3>입금 예정</h3>
                <p>
                  납품 완료 전인 위즈업 수주만 보여줍니다. 협력사 수주는 포함하지
                  않으며, 이 화면에서는 수금액을 입력하지 않습니다.
                </p>
              </div>
              <div className="accounting-subview-controls">
                <input
                  aria-label="입금 예정 거래처 검색"
                  value={upcomingSearch}
                  onChange={(event) => setUpcomingSearch(event.target.value)}
                  placeholder="거래처명·지역·담당자·진행 상태 검색"
                />
                <strong>
                  {filteredUpcomingEntries.length.toLocaleString()}건
                </strong>
              </div>
            </header>

            <div className="accounting-analysis-summary">
              <span>
                <small>입금 예정 거래처</small>
                <strong>
                  {upcomingTotals.organizationCount.toLocaleString()}곳
                </strong>
              </span>
              <span>
                <small>협력사 제품 수수료 예정</small>
                <strong>
                  {formatMoney(upcomingTotals.expectedPartnerCommission)}
                </strong>
              </span>
              <span>
                <small>직접 공급 판매대금 예정</small>
                <strong>
                  {formatMoney(upcomingTotals.expectedDirectSalesCollection)}
                </strong>
              </span>
              <span>
                <small>공사 마진</small>
                <strong>
                  {formatMoney(upcomingTotals.expectedConstructionMargin)}
                </strong>
              </span>
              <span>
                <small>총 입금 예정액</small>
                <strong>
                  {formatMoney(upcomingTotals.expectedCollectionTotal)}
                </strong>
              </span>
              {upcomingTotals.expectedSettlementDeficit > 0 && (
                <span>
                  <small>정산 부족액 · 지급 검토</small>
                  <strong>
                    {formatMoney(upcomingTotals.expectedSettlementDeficit)}
                  </strong>
                </span>
              )}
            </div>

            <section className="accounting-analysis-table-card">
              <header>
                <div>
                  <h4>진행 중인 위즈업 수주</h4>
                  <p>
                    진행이 끝난 뒤 받을 금액을 거래처와 사업 차수별로 확인합니다.
                  </p>
                </div>
                <strong>
                  예상 공헌이익 {formatMoney(upcomingTotals.expectedProfit)}
                </strong>
              </header>
              <div className="accounting-table-wrap accounting-upcoming-table-wrap">
                <table className="accounting-table accounting-upcoming-table">
                  <colgroup>
                    <col className="col-upcoming-date" />
                    <col className="col-upcoming-organization" />
                    <col className="col-upcoming-status" />
                    <col className="col-upcoming-manager" />
                    <col className="col-upcoming-contract" />
                    <col className="col-upcoming-money" />
                    <col className="col-upcoming-money" />
                    <col className="col-upcoming-total" />
                    <col className="col-upcoming-profit" />
                  </colgroup>
                  <thead>
                    <tr className="accounting-column-group-row">
                      <th className="accounting-group-info" colSpan={4}>
                        수주 정보
                      </th>
                      <th className="accounting-group-expected" colSpan={4}>
                        입금 예정
                      </th>
                      <th className="accounting-group-status">예상 수익</th>
                    </tr>
                    <tr className="accounting-column-label-row">
                      <th>수주일</th>
                      <th>거래처·수주</th>
                      <th>진행 상태</th>
                      <th>담당자</th>
                      <th>등록 견적 기준 계약금액</th>
                      <th>협력사 제품 수수료</th>
                      <th>직접 공급 판매대금</th>
                      <th>총 입금 예정액</th>
                      <th>예상 공헌이익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUpcomingEntries.map((entry) => (
                      <tr key={entry.businessKey}>
                        <td className="accounting-date-cell">
                          {entry.activityDate || "—"}
                        </td>
                        <td className="accounting-organization-cell">
                          <strong>{entry.organization}</strong>
                          <small>
                            {entry.region || "지역 미등록"} ·{" "}
                            {entry.businessRound}차 사업
                          </small>
                        </td>
                        <td>
                          <span className="accounting-status-pill">
                            {entry.awardStage || "미정"}
                          </span>
                        </td>
                        <td className="accounting-manager-cell">
                          {entry.progressManager || "미등록"}
                        </td>
                        <td className="accounting-money-cell">
                          <RegisteredQuoteContractAmount entry={entry} />
                        </td>
                        <td className="accounting-money-cell">
                          {formatMoney(entry.expectedPartnerCommission)}
                        </td>
                        <td className="accounting-money-cell">
                          {formatMoney(entry.expectedDirectSalesCollection)}
                        </td>
                        <td className="accounting-money-cell">
                          <strong>
                            {formatMoney(entry.expectedCollectionTotal)}
                          </strong>
                          <small>
                            공사 마진{" "}
                            {formatMoney(entry.expectedConstructionMargin)}
                          </small>
                          {entry.expectedSettlementDeficit > 0 && (
                            <small>
                              지급 검토{" "}
                              {formatMoney(entry.expectedSettlementDeficit)}
                            </small>
                          )}
                        </td>
                        <td className="accounting-money-cell">
                          <strong>{formatMoney(entry.expectedProfit)}</strong>
                          {entry.expectedDirectMargin > 0 && (
                            <small>
                              직접 공급 예상 마진{" "}
                              {formatMoney(entry.expectedDirectMargin)}
                            </small>
                          )}
                          {entry.expectedConsortiumSettlement > 0 && (
                            <small>
                              컨소 정산 예정{" "}
                              {formatMoney(entry.expectedConsortiumSettlement)}
                            </small>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="accounting-upcoming-mobile-list">
                  {filteredUpcomingEntries.map((entry) => (
                    <article
                      className="accounting-upcoming-mobile-card"
                      key={`mobile-${entry.businessKey}`}
                      aria-label={`${entry.organization} 입금 예정`}
                    >
                      <header>
                        <div>
                          <h3>{entry.organization}</h3>
                          <small>
                            {entry.activityDate || "날짜 미등록"} ·{" "}
                            {entry.region || "지역 미등록"} · {entry.businessRound}차 사업
                          </small>
                        </div>
                        <span className="accounting-status-pill">
                          {entry.awardStage || "미정"}
                        </span>
                      </header>
                      <dl>
                        <div className="wide">
                          <dt>담당자</dt>
                          <dd>{entry.progressManager || "미등록"}</dd>
                        </div>
                        <div className="wide">
                          <dt>등록 견적 기준 계약금액</dt>
                          <dd>
                            <RegisteredQuoteContractAmount entry={entry} />
                          </dd>
                        </div>
                        <div>
                          <dt>협력사 제품 수수료</dt>
                          <dd>{formatMoney(entry.expectedPartnerCommission)}</dd>
                        </div>
                        <div>
                          <dt>직접 공급 판매대금</dt>
                          <dd>{formatMoney(entry.expectedDirectSalesCollection)}</dd>
                        </div>
                        <div className="emphasis">
                          <dt>총 입금 예정액</dt>
                          <dd>{formatMoney(entry.expectedCollectionTotal)}</dd>
                        </div>
                        <div className="emphasis">
                          <dt>예상 공헌이익</dt>
                          <dd>{formatMoney(entry.expectedProfit)}</dd>
                        </div>
                      </dl>
                      <footer>
                        <span
                          className={
                            entry.expectedConstructionMargin < 0 ? "loss" : ""
                          }
                        >
                          공사 마진 {formatMoney(entry.expectedConstructionMargin)}
                        </span>
                        {entry.expectedDirectMargin !== 0 && (
                          <span
                            className={entry.expectedDirectMargin < 0 ? "loss" : ""}
                          >
                            직접 공급 예상 마진{" "}
                            {formatMoney(entry.expectedDirectMargin)}
                          </span>
                        )}
                        {entry.expectedConsortiumSettlement > 0 && (
                          <span>
                            컨소 정산 예정{" "}
                            {formatMoney(entry.expectedConsortiumSettlement)}
                          </span>
                        )}
                        {entry.expectedSettlementDeficit > 0 && (
                          <span className="loss">
                            지급 검토{" "}
                            {formatMoney(entry.expectedSettlementDeficit)}
                          </span>
                        )}
                      </footer>
                    </article>
                  ))}
                </div>
                {!loading && !filteredUpcomingEntries.length && (
                  <div className="empty-state accounting-empty-state">
                    <strong>입금 예정인 위즈업 수주가 없습니다.</strong>
                  </div>
                )}
                {loading && (
                  <div className="empty-state">
                    입금 예정 목록을 불러오는 중입니다.
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {tab === "collections" && (
          <>
            <div className="accounting-filter-row accounting-filter-row-simple">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="거래처명·담당자·컨소 업체명 검색"
              />
              <select
                value={yearFilter}
                onChange={(event) => setYearFilter(event.target.value)}
              >
                <option>전체 연도</option>
                {years.map((year) => (
                  <option key={year}>{year}</option>
                ))}
              </select>
              <span className={focus === "all" ? "" : "accounting-active-filter"}>
                {focusLabels[focus]} · {filteredEntries.length.toLocaleString()}건
                {focus !== "all" && (
                  <button type="button" onClick={() => applyFocus("all")}>
                    전체 보기
                  </button>
                )}
              </span>
            </div>
            <div className="accounting-bulk-row">
              <label>
                <input
                  type="checkbox"
                  checked={showExcluded}
                  onChange={(event) => {
                    setShowExcluded(event.target.checked);
                    setSelectedEntryIds(new Set());
                  }}
                />
                사이트 도입 전 숨긴 기록 포함
              </label>
              <div>
                <span>{selectedEntries.length.toLocaleString()}건 선택</span>
                <button
                  type="button"
                  disabled={!selectedEntries.length || saving}
                  onClick={() => void updateWorkflowExclusion()}
                >
                  {selectedEntries.length > 0 &&
                  selectedEntries.every((entry) => entry.workflowExcluded)
                    ? "다시 표시"
                    : "사이트 도입 전 기록 숨기기"}
                </button>
              </div>
            </div>
            <div className="accounting-table-wrap">
              <table className="accounting-table accounting-collection-table">
                <colgroup>
                  <col className="col-select" />
                  <col className="col-date" />
                  <col className="col-organization" />
                  <col className="col-manager" />
                  <col className="col-money" />
                  <col className="col-consortium" />
                  <col className="col-money" />
                  <col className="col-money" />
                  <col className="col-date" />
                  <col className="col-status" />
                </colgroup>
                <thead>
                  <tr className="accounting-column-group-row">
                    <th
                      className="accounting-select-cell accounting-group-info"
                      rowSpan={2}
                    >
                      <input
                        type="checkbox"
                        aria-label="현재 목록 전체 선택"
                        checked={allFilteredSelected}
                        onChange={toggleFilteredSelection}
                      />
                    </th>
                    <th className="accounting-group-info" colSpan={3}>수주 정보</th>
                    <th className="accounting-group-collected">실제 수금</th>
                    <th className="accounting-group-expected" colSpan={2}>정산·공헌이익</th>
                    <th className="accounting-group-outstanding">남은 예상액</th>
                    <th className="accounting-group-collected">수금 일자</th>
                    <th className="accounting-group-status">관리 상태</th>
                  </tr>
                  <tr className="accounting-column-label-row">
                    <th>수주일</th>
                    <th>거래처·수주</th>
                    <th>담당자</th>
                    <th>누적 실제 수금액</th>
                    <th>컨소 정산 기준액</th>
                    <th>공헌이익</th>
                    <th>미수수익 예상액</th>
                    <th>최종 수금일</th>
                    <th>수금 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr
                      key={entry.id}
                      className={entry.workflowExcluded ? "workflow-excluded" : ""}
                      onClick={() => openEditor(entry)}
                    >
                      <td
                        className="accounting-select-cell"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`${entry.organization} 선택`}
                          checked={selectedEntryIds.has(entry.id)}
                          onChange={() => toggleEntrySelection(entry.id)}
                        />
                      </td>
                      <td className="accounting-date-cell">{entry.activityDate || "—"}</td>
                      <td className="accounting-organization-cell">
                        <strong>{entry.organization}</strong>
                        <small>{entry.businessRound}차 사업 · {entry.executionType}</small>
                      </td>
                      <td className="accounting-manager-cell">{entry.progressManager || "미등록"}</td>
                      <td className="accounting-money-cell">
                        <strong>{formatMoney(entry.commissionCollectedAmount)}</strong>
                        <small>{entry.receipts.length.toLocaleString()}회 수금</small>
                      </td>
                      <td className="accounting-money-cell accounting-consortium-cell">
                        {entry.executionType === "컨소" ? (
                          <>
                            <strong>{formatMoney(entry.expectedConsortiumSettlement)}</strong>
                            <small>영업담당자 등록 조건 기준</small>
                            {entry.consortiumCompany && (
                              <small title={entry.consortiumCompany}>
                                {entry.consortiumCompany}
                              </small>
                            )}
                          </>
                        ) : (
                          <small>해당 없음</small>
                        )}
                      </td>
                      <td className="accounting-money-cell">
                        <strong>
                          {formatMoney(contributionMarginView(entry).amount)}
                        </strong>
                        <small>{contributionMarginView(entry).label}</small>
                      </td>
                      <td className="accounting-money-cell">
                        <strong>{receivableLabel(entry)}</strong>
                      </td>
                      <td className="accounting-date-cell">
                        {latestCollectionDate(entry)}
                      </td>
                      <td>
                        <span className="accounting-status-pill">
                          {collectionStatusLabel(entry)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && !filteredEntries.length && (
                <div className="empty-state accounting-empty-state">
                  <strong>해당 조건의 납품 완료 수주가 없습니다.</strong>
                  {focus !== "all" && (
                    <button type="button" onClick={() => applyFocus("all")}>
                      전체 보기
                    </button>
                  )}
                </div>
              )}
              {loading && (
                <div className="empty-state">납품 완료 수금 목록을 불러오는 중입니다.</div>
              )}
            </div>
          </>
        )}

        {tab === "counterparties" && (
          <div className="accounting-subview">
            <header>
              <div>
                <h3>거래처별 채권</h3>
                <p>
                  같은 거래처의 여러 수주를 기관명 별칭과 합치기 결과에 따라
                  자동 합산합니다. 행을 누르면 수주 차수별 수금 내역을 볼 수
                  있습니다.
                </p>
              </div>
              <div className="accounting-subview-controls">
                <input
                  aria-label="거래처별 채권 검색"
                  value={counterpartySearch}
                  onChange={(event) => setCounterpartySearch(event.target.value)}
                  placeholder="거래처명 검색"
                />
                <strong>{filteredCounterpartyRows.length.toLocaleString()}곳</strong>
              </div>
            </header>
            <div className="accounting-table-wrap">
              <table className="accounting-table accounting-counterparty-table">
                <colgroup>
                  <col className="col-counterparty-name" />
                  <col className="col-counterparty-money" />
                  <col className="col-counterparty-money" />
                  <col className="col-counterparty-date" />
                  <col className="col-counterparty-money" />
                  <col className="col-counterparty-status" />
                </colgroup>
                <thead>
                  <tr className="accounting-column-group-row">
                    <th className="accounting-group-info">거래처 정보</th>
                    <th className="accounting-group-expected">예정 금액</th>
                    <th className="accounting-group-collected" colSpan={2}>실제 수금</th>
                    <th className="accounting-group-outstanding">남은 예상액</th>
                    <th className="accounting-group-status">관리 상태</th>
                  </tr>
                  <tr className="accounting-column-label-row">
                    <th>거래처명</th>
                    <th>총 입금 예정액</th>
                    <th>누적 수금액</th>
                    <th>최종 수금일</th>
                    <th>미수수익 예상액</th>
                    <th>수금 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCounterpartyRows.map((row) => (
                    <tr key={row.key} onClick={() => openCounterparty(row)}>
                      <td className="accounting-organization-cell">
                        <strong>{row.organization}</strong>
                        <small>{row.awards.length.toLocaleString()}개 수주 차수</small>
                      </td>
                      <td className="accounting-money-cell">
                        {row.unknownBasisCount > 0 ? (
                          <>
                            <strong>기준금액 미확정</strong>
                            <small>{row.unknownBasisCount}건의 예정 금액 확인 필요</small>
                          </>
                        ) : (
                          <>
                            <strong>{formatMoney(row.expectedRevenue)}</strong>
                            {row.settlementDeficit > 0 && (
                              <small>
                                정산 부족 {formatMoney(row.settlementDeficit)}
                              </small>
                            )}
                          </>
                        )}
                      </td>
                      <td className="accounting-money-cell">
                        <strong>{formatMoney(row.cumulativeCollected)}</strong>
                      </td>
                      <td className="accounting-date-cell">
                        {row.lastCollectionDate || "—"}
                      </td>
                      <td className="accounting-money-cell">
                        <strong>
                          {row.outstandingExpected === null
                            ? "기준금액 미확정"
                            : formatMoney(row.outstandingExpected)}
                        </strong>
                      </td>
                      <td>
                        <span className="accounting-status-pill">
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && !filteredCounterpartyRows.length && (
                <div className="empty-state">표시할 거래처가 없습니다.</div>
              )}
            </div>
          </div>
        )}

        {tab === "analysis" && (
          <div className="accounting-subview accounting-analysis">
            <header>
              <div>
                <h3>수금 분석</h3>
                <p>
                  계약일이나 납품일이 아닌 실제 입금일과 입금액을 기준으로
                  집계합니다.
                </p>
              </div>
              <div className="accounting-subview-controls">
                <select
                  aria-label="수금 분석 연도"
                  value={analysisYear}
                  onChange={(event) => setAnalysisYear(event.target.value)}
                >
                  {collectionYears.map((year) => <option key={year}>{year}년</option>)}
                </select>
                <strong>입금일 기준</strong>
              </div>
            </header>

            <div className="accounting-analysis-summary">
              <span>
                <small>{analysisYear}년 당기 수금액</small>
                <strong>{formatMoney(periodCollectionAmount)}</strong>
              </span>
              <span>
                <small>미수수익 예상액</small>
                <strong>{formatMoney(summary.receivable)}</strong>
              </span>
              <span>
                <small>수금 완료 거래처</small>
                <strong>{statusCounterparties.complete.length.toLocaleString()}곳</strong>
              </span>
              <span>
                <small>일부 수금·미수 거래처</small>
                <strong>
                  {(statusCounterparties.partial.length +
                    statusCounterparties.unpaid.length).toLocaleString()}곳
                </strong>
              </span>
            </div>

            <div className="accounting-analysis-grid">
              <section className="accounting-analysis-card">
                <header>
                  <h4>{analysisYear}년 월별 수금 추이</h4>
                  <small>실제 입금일 기준</small>
                </header>
                <div className="accounting-trend-list">
                  {monthlyTrend.map((row) => (
                    <div key={row.period}>
                      <span>{row.label}</span>
                      <i>
                        <b
                          style={{
                            width: row.amount > 0
                              ? `${Math.max(
                                  2,
                                  row.amount /
                                    Math.max(
                                      1,
                                      ...monthlyTrend.map((item) => item.amount),
                                    ) *
                                    100,
                                )}%`
                              : "0%",
                          }}
                        />
                      </i>
                      <strong>{formatMoney(row.amount)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="accounting-analysis-card">
                <header>
                  <h4>연간 수금 추이</h4>
                  <small>등록된 입금 연도 전체</small>
                </header>
                <div className="accounting-trend-list annual">
                  {annualTrend.map((row) => (
                    <div key={row.period}>
                      <span>{row.label}</span>
                      <i>
                        <b
                          style={{
                            width: row.amount > 0
                              ? `${Math.max(
                                  2,
                                  row.amount /
                                    Math.max(
                                      1,
                                      ...annualTrend.map((item) => item.amount),
                                    ) *
                                    100,
                                )}%`
                              : "0%",
                          }}
                        />
                      </i>
                      <strong>{formatMoney(row.amount)}</strong>
                    </div>
                  ))}
                  {!annualTrend.length && <p>등록된 수금 내역이 없습니다.</p>}
                </div>
              </section>
            </div>

            <section className="accounting-analysis-table-card">
              <header>
                <div>
                  <h4>수금액 상위 거래처</h4>
                  <p>
                    같은 거래처의 여러 수주를 합산하고, 선택 연도에 실제 수금액이
                    있는 거래처만 표시합니다. 행을 누르면 차수별로 구분합니다.
                  </p>
                </div>
              </header>
              <div className="accounting-table-wrap">
                <table className="accounting-table accounting-ranking-table">
                  <colgroup className="accounting-ranking-columns">
                    <col className="accounting-ranking-col-rank" />
                    <col className="accounting-ranking-col-organization" />
                    <col className="accounting-ranking-col-period" />
                    <col className="accounting-ranking-col-cumulative" />
                    <col className="accounting-ranking-col-date" />
                    <col className="accounting-ranking-col-outstanding" />
                    <col className="accounting-ranking-col-status" />
                  </colgroup>
                  <thead>
                    <tr className="accounting-column-group-row">
                      <th className="accounting-group-info" colSpan={2}>순위·거래처</th>
                      <th className="accounting-group-collected" colSpan={3}>실제 수금</th>
                      <th className="accounting-group-outstanding">남은 예상액</th>
                      <th className="accounting-group-status">관리 상태</th>
                    </tr>
                    <tr className="accounting-column-label-row">
                      <th>순위</th>
                      <th>거래처</th>
                      <th>당기 수금액</th>
                      <th>누적 수금액</th>
                      <th>최종 수금일</th>
                      <th>미수수익 예상액</th>
                      <th>수금 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCollectedCounterparties.slice(0, 20).map((row, index) => (
                      <tr key={row.key} onClick={() => openCounterparty(row)}>
                        <td><strong>{index + 1}</strong></td>
                        <td className="accounting-organization-cell">
                          <strong>{row.organization}</strong>
                          <small>{row.awards.length.toLocaleString()}개 수주 차수</small>
                        </td>
                        <td className="accounting-money-cell">
                          <strong>{formatMoney(row.periodCollected)}</strong>
                        </td>
                        <td className="accounting-money-cell">{formatMoney(row.cumulativeCollected)}</td>
                        <td>{row.lastCollectionDate || "—"}</td>
                        <td className="accounting-money-cell">
                          {row.outstandingExpected === null
                            ? "기준금액 미확정"
                            : formatMoney(row.outstandingExpected)}
                        </td>
                        <td><span className="accounting-status-pill">{row.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="accounting-analysis-table-card">
              <header>
                <div>
                  <h4>미수수익 예상액 상위 거래처</h4>
                  <p>
                    총 입금 예정액에서 누적 수금액을 뺀 관리용
                    예상치입니다.
                  </p>
                </div>
              </header>
              <div className="accounting-table-wrap compact">
                <table className="accounting-table accounting-outstanding-table">
                  <thead>
                    <tr className="accounting-column-group-row">
                      <th className="accounting-group-info">거래처 정보</th>
                      <th className="accounting-group-expected">예정 금액</th>
                      <th className="accounting-group-collected">실제 수금</th>
                      <th className="accounting-group-outstanding">남은 예상액</th>
                      <th className="accounting-group-status">관리 상태</th>
                    </tr>
                    <tr className="accounting-column-label-row">
                      <th>거래처</th>
                      <th>총 입금 예정액</th>
                      <th>누적 수금액</th>
                      <th>미수수익 예상액</th>
                      <th>수금 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topOutstandingCounterparties.slice(0, 20).map((row) => (
                      <tr key={row.key} onClick={() => openCounterparty(row)}>
                        <td className="accounting-organization-cell">
                          <strong>{row.organization}</strong>
                        </td>
                        <td>{formatMoney(row.expectedRevenue)}</td>
                        <td>{formatMoney(row.cumulativeCollected)}</td>
                        <td><strong>{formatMoney(row.outstandingExpected ?? 0)}</strong></td>
                        <td><span className="accounting-status-pill">{row.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!topOutstandingCounterparties.length && (
                  <div className="empty-state">표시할 미수수익 예상액이 없습니다.</div>
                )}
              </div>
            </section>

            <div className="accounting-status-groups">
              {[
                ["수금 완료 거래처", statusCounterparties.complete],
                ["일부 수금 거래처", statusCounterparties.partial],
                ["미수 거래처", statusCounterparties.unpaid],
                ["지급 검토 거래처", statusCounterparties.paymentReview],
                ["기준금액 미확정", statusCounterparties.unknown],
              ].map(([label, rows]) => {
                const typedRows = rows as CounterpartyCollectionSummary<AccountingEntry>[];
                return (
                  <section key={String(label)}>
                    <header>
                      <h4>{String(label)}</h4>
                      <strong>{typedRows.length.toLocaleString()}곳</strong>
                    </header>
                    <div>
                      {typedRows.slice(0, 6).map((row) => (
                        <button
                          type="button"
                          key={row.key}
                          onClick={() => openCounterparty(row)}
                        >
                          <span>{row.organization}</span>
                          <b>
                            {row.outstandingExpected === null
                              ? "기준 미확정"
                              : formatMoney(row.outstandingExpected)}
                          </b>
                        </button>
                      ))}
                      {!typedRows.length && <p>해당 거래처가 없습니다.</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </article>

      {selectedCounterparty && (
        <div
          className="accounting-editor-layer"
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedCounterparty.organization} 거래처별 수금 상세`}
        >
          <button
            className="accounting-editor-backdrop"
            aria-label="거래처별 수금 상세 닫기"
            onClick={() => setSelectedCounterpartyKey("")}
          />
          <aside className="accounting-editor accounting-counterparty-detail">
            <header>
              <div>
                <span className="section-kicker">COUNTERPARTY DETAILS</span>
                <h2>{selectedCounterparty.organization}</h2>
                <p>수주 차수별 예정 수익과 실제 입금 내역입니다.</p>
              </div>
              <button
                type="button"
                aria-label="닫기"
                onClick={() => setSelectedCounterpartyKey("")}
              >
                ×
              </button>
            </header>
            <div className="accounting-editor-body">
              <section>
                <h3>거래처 합계</h3>
                <div className="accounting-reference-grid">
                  <span>
                    <small>총 입금 예정액</small>
                    <strong>{formatMoney(selectedCounterparty.expectedRevenue)}</strong>
                  </span>
                  <span>
                    <small>{analysisYear}년 당기 수금액</small>
                    <strong>{formatMoney(selectedCounterparty.periodCollected)}</strong>
                  </span>
                  <span>
                    <small>누적 수금액</small>
                    <strong>{formatMoney(selectedCounterparty.cumulativeCollected)}</strong>
                  </span>
                  <span>
                    <small>미수수익 예상액</small>
                    <strong>
                      {selectedCounterparty.outstandingExpected === null
                        ? "기준금액 미확정"
                        : formatMoney(selectedCounterparty.outstandingExpected)}
                    </strong>
                  </span>
                  {selectedCounterparty.settlementDeficit > 0 && (
                    <span>
                      <small>정산 부족액 · 지급 검토</small>
                      <strong>
                        {formatMoney(selectedCounterparty.settlementDeficit)}
                      </strong>
                    </span>
                  )}
                  <span>
                    <small>최종 수금일</small>
                    <strong>{selectedCounterparty.lastCollectionDate || "—"}</strong>
                  </span>
                  <span>
                    <small>자동 수금 상태</small>
                    <strong>{selectedCounterparty.status}</strong>
                  </span>
                </div>
              </section>
              <section className="accounting-counterparty-awards">
                <h3>수주 차수별 수금 내역</h3>
                {selectedCounterparty.awards.map((award) => (
                  <article key={award.entry.id}>
                    <header>
                      <div>
                        <strong>{award.entry.businessRound}차 사업</strong>
                        <span>{award.entry.activityDate || "수주일 미등록"}</span>
                      </div>
                      <span className="accounting-status-pill">{award.status}</span>
                    </header>
                    <div className="accounting-counterparty-award-summary">
                      <span>
                        <small>총 입금 예정액</small>
                        <b>{formatMoney(award.expectedRevenue)}</b>
                      </span>
                      <span>
                        <small>누적 수금액</small>
                        <b>{formatMoney(award.cumulativeCollected)}</b>
                      </span>
                      <span>
                        <small>미수수익 예상액</small>
                        <b>
                          {award.outstandingExpected === null
                            ? "기준금액 미확정"
                            : formatMoney(award.outstandingExpected)}
                        </b>
                      </span>
                      {award.settlementDeficit > 0 && (
                        <span>
                          <small>정산 부족액 · 지급 검토</small>
                          <b>{formatMoney(award.settlementDeficit)}</b>
                        </span>
                      )}
                    </div>
                    <div className="accounting-counterparty-receipts">
                      {award.entry.receipts.map((receipt) => (
                        <div key={receipt.id}>
                          <span>
                            <strong>{receipt.collectionDate}</strong>
                            <small>{receipt.note || "수금 메모 없음"}</small>
                          </span>
                          <b>{formatMoney(receipt.amount)}</b>
                        </div>
                      ))}
                      {!award.entry.receipts.length && (
                        <p>등록된 수금 내역이 없습니다.</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCounterpartyKey("");
                        openEditor(award.entry);
                      }}
                    >
                      이 수주의 수금 관리 열기
                    </button>
                  </article>
                ))}
              </section>
            </div>
          </aside>
        </div>
      )}

      {selectedEntry && (
        <div
          className="accounting-editor-layer"
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedEntry.organization} 실제 수금 등록`}
        >
          <button
            className="accounting-editor-backdrop"
            aria-label="수금 등록 닫기"
            onClick={() => setSelectedId(null)}
          />
          <aside className="accounting-editor commission-voucher-editor">
            <header>
              <div>
                <span className="section-kicker">COLLECTION ENTRY</span>
                <h2>실제 수금 등록</h2>
                <p>
                  {selectedEntry.organization}
                </p>
              </div>
              <button type="button" aria-label="닫기" onClick={() => setSelectedId(null)}>
                ×
              </button>
            </header>
            <div className="accounting-source-notice">
              <strong>납품 완료 처리된 위즈업 수주의 계산값을 자동 연결했습니다.</strong>
              <span>회계 담당자는 실제로 받은 금액과 날짜만 입력하면 됩니다.</span>
            </div>
            <div className="accounting-editor-body">
              <section>
                <h3>자동 연동 정보</h3>
                <div className="accounting-reference-grid">
                  <span><small>거래처명</small><strong>{selectedEntry.organization}</strong></span>
                  <span><small>수주일</small><strong>{selectedEntry.activityDate || "미등록"}</strong></span>
                  <span><small>담당자</small><strong>{selectedEntry.progressManager || "미등록"}</strong></span>
                  <span>
                    <small>등록 견적 기준 계약금액</small>
                    <RegisteredQuoteContractAmount entry={selectedEntry} />
                  </span>
                  <span>
                    <small>총 입금 예정액</small>
                    <strong>{collectionTargetLabel(selectedEntry)}</strong>
                  </span>
                  <span>
                    <small>협력사 제품 수수료 예정</small>
                    <strong>
                      {formatMoney(
                        selectedEntry.expectedPartnerCommission ??
                          selectedEntry.expectedCommission,
                      )}
                    </strong>
                  </span>
                  <span>
                    <small>직접 공급 판매대금 예정</small>
                    <strong>
                      {formatMoney(
                        selectedEntry.expectedDirectSalesCollection ?? 0,
                      )}
                    </strong>
                  </span>
                  <span>
                    <small>직접 공급 예상 마진</small>
                    <strong>
                      {formatMoney(selectedEntry.expectedDirectMargin ?? 0)}
                    </strong>
                  </span>
                  <span>
                    <small>공사 마진</small>
                    <strong>
                      {formatMoney(
                        selectedEntry.expectedConstructionMargin ?? 0,
                      )}
                    </strong>
                  </span>
                  {settlementDeficit(selectedEntry) > 0 && (
                    <span>
                      <small>정산 부족액 · 지급 검토</small>
                      <strong>
                        {formatMoney(settlementDeficit(selectedEntry))}
                      </strong>
                    </span>
                  )}
                  <span><small>직영·컨소</small><strong>{selectedEntry.executionType}</strong></span>
                  {selectedEntry.executionType === "컨소" && (
                    <>
                      <span><small>컨소 업체명</small><strong>{selectedEntry.consortiumCompany || "미등록"}</strong></span>
                      <span><small>컨소 정산 기준액</small><strong>{formatMoney(selectedEntry.expectedConsortiumSettlement)}</strong></span>
                    </>
                  )}
                  <span>
                    <small>{contributionMarginView(selectedEntry).label}</small>
                    <strong>{formatMoney(contributionMarginView(selectedEntry).amount)}</strong>
                    <small>{contributionMarginView(selectedEntry).detail}</small>
                  </span>
                </div>
                <div className="accounting-source-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>품목·공사</th>
                        <th>공급 구분</th>
                        <th>방식</th>
                        <th>수량·금액</th>
                        <th>수수료율 / 마진율</th>
                        <th>입금 예정 / 예상 공헌이익</th>
                        <th>예상 컨소 정산</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEntry.sourceItems.map((item) => (
                        <tr key={item.id}>
                          <td><strong>{item.productName}</strong><small>{item.projectName}</small></td>
                          <td>
                            {item.supplyType === "direct"
                              ? "위즈업 직접 공급"
                              : item.supplierVendorName || "미연결"}
                          </td>
                          <td>{item.executionType}</td>
                          <td>{item.quantity.toLocaleString()}개 · {formatMoney(item.unitPrice)}</td>
                          <td>
                            {formatRate(
                              item.supplyType === "direct"
                                ? item.marginRate
                                : item.commissionRate,
                            )}
                            <small>
                              {item.supplyType === "direct"
                                ? "마진율"
                                : "수수료율"}
                            </small>
                          </td>
                          <td>
                            {item.supplyType === "direct" ? (
                              <>
                                <strong>
                                  입금{" "}
                                  {formatMoney(
                                    item.expectedDirectSalesCollection ?? 0,
                                  )}
                                </strong>
                                <small>
                                  예상 마진{" "}
                                  {formatMoney(item.expectedDirectMargin ?? 0)}
                                </small>
                              </>
                            ) : (
                              formatMoney(
                                item.expectedPartnerCommission ??
                                  item.expectedCommission,
                              )
                            )}
                          </td>
                          <td>
                            {item.executionType === "컨소"
                              ? formatMoney(item.expectedConsortiumSettlement)
                              : ""}
                          </td>
                        </tr>
                      ))}
                      {selectedEntry.sourceProjects
                        .filter(
                          (project) =>
                            project.constructionAmount !== 0 ||
                            project.actualConstructionCost !== 0,
                        )
                        .map((project) => (
                          <tr key={`construction-${project.id}`}>
                            <td><strong>{project.name || "공사비"}</strong><small>자동 연동 공사비</small></td>
                            <td>—</td>
                            <td>공사</td>
                            <td>{formatMoney(project.constructionAmount)}</td>
                            <td>실공사비 {formatMoney(project.actualConstructionCost)}</td>
                            <td>공사 마진 {formatMoney(project.constructionMargin)}</td>
                            <td>—</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="accounting-receipt-entry-section">
                <h3>{editingReceiptId ? "수금 내역 수정" : "실제 수금 입력"}</h3>
                <div className="accounting-form-grid">
                  <label className="accounting-field">
                    <span>실제 수금액</span>
                    <MoneyField value={receiptAmount} onChange={setReceiptAmount} />
                  </label>
                  <label className="accounting-field">
                    <span>수금일</span>
                    <input
                      type="date"
                      value={receiptDate}
                      onChange={(event) => setReceiptDate(event.target.value)}
                    />
                  </label>
                </div>
                <label className="accounting-field accounting-note-field">
                  <span>차이 메모 (선택)</span>
                  <textarea
                    value={receiptNote}
                    onChange={(event) => setReceiptNote(event.target.value)}
                    maxLength={500}
                    placeholder="예상 금액과 다를 때만 사유를 적어 주세요."
                  />
                </label>
                <div className="accounting-calculation-strip">
                  <span><small>누적 수금액</small><strong>{formatMoney(selectedEntry.commissionCollectedAmount)}</strong></span>
                  <span>
                    <small>미수수익 예상액</small>
                    <strong>{receivableLabel(selectedEntry)}</strong>
                  </span>
                </div>
                <div className="accounting-receipt-actions">
                  {!editingReceiptId && selectedEntry.receivableBalance > 0 && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving}
                      onClick={() => void saveFullReceipt()}
                    >
                      남은 금액 전액 입금
                    </button>
                  )}
                  {editingReceiptId && (
                    <button type="button" onClick={resetReceiptForm}>
                      수정 취소
                    </button>
                  )}
                  <button
                    type="button"
                    className="primary-button"
                    disabled={saving}
                    onClick={() => void saveReceipt()}
                  >
                    {saving
                      ? "저장 중…"
                      : editingReceiptId
                        ? "수금 내역 수정"
                        : "수금 내역 추가"}
                  </button>
                </div>
              </section>

              <section className="accounting-receipt-history">
                <h3>수금 내역</h3>
                {selectedEntry.receipts.length ? (
                  selectedEntry.receipts.map((receipt) => (
                    <div key={receipt.id} className="accounting-receipt-item">
                      <div>
                        <strong>{formatMoney(receipt.amount)}</strong>
                        <span>{receipt.collectionDate}</span>
                        {receipt.note && <p>{receipt.note}</p>}
                      </div>
                      <div className="accounting-receipt-item-actions">
                        <button type="button" onClick={() => editReceipt(receipt)}>
                          수정
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={saving}
                          onClick={() => void deleteReceipt(receipt)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p>아직 등록된 수금 내역이 없습니다.</p>
                )}
              </section>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
