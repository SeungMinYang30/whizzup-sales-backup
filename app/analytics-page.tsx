"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyticsProductBucket,
  isMissingAnalyticsPrice,
} from "../lib/analytics-performance";
import { groupAnalyticsProductsByBusiness } from "../lib/analytics-drilldowns";
import { sumReceiptsForPeriod } from "../lib/collection-analytics";
import {
  buildExecutionTrend,
  type ExecutionTrendMetric,
} from "../lib/analytics-execution-trends";

type AnalyticsAward = {
  activityId: number;
  businessKey: string;
  businessRound: number;
  activityDate: string;
  organization: string;
  region: string;
  budgetType: string;
  budgets?: Array<{ name: string; enteredAmount: number }>;
  executionType: "직영" | "컨소";
  awardStage: string;
  progressManager: string;
  summary: string;
  nextAction: string;
  progressSchedule: string;
  updatedAt: string;
  confirmed: boolean;
  confirmedAmount: number;
  expectedCommission: number;
  expectedPartnerCommission?: number;
  expectedDirectSalesCollection?: number;
  expectedDirectMargin?: number;
  expectedConstructionMargin?: number;
  expectedCollectionTotal?: number;
  consortiumPaymentPaid: number;
  netRevenue: number;
};

type AnalyticsReceipt = {
  id: number;
  activityId: number;
  businessKey: string;
  businessRound: number;
  organization: string;
  region: string;
  budgetType: string;
  collectionDate: string;
  amount: number;
  note: string;
};

type AnalyticsProduct = {
  activityId: number;
  businessKey: string;
  businessRound: number;
  activityDate: string;
  projectId: number;
  itemId: number;
  organization: string;
  projectName: string;
  budgetGroupId: string;
  budgetName: string;
  budgetOriginalName: string;
  budgetMatchStatus: string;
  productName: string;
  sourceProductName: string;
  catalogItemId: string;
  isCatalogProduct: boolean;
  quantity: number;
  unitPrice: number;
  amount: number;
  priceStatus: string;
  supplyType?: "partner" | "direct";
  estimatedCommission: number;
  estimatedPartnerCommission?: number;
  estimatedDirectSalesCollection?: number;
  estimatedDirectMargin?: number;
  estimatedRevenue?: number;
  estimatedMargin: number;
  supplierVendorId: number | null;
  supplierVendorName: string;
  progressManager: string;
  createdByName: string;
  updatedByName: string;
  updatedAt: string;
  commissionMissing: boolean;
};

type AggregatedItem = {
  label: string;
  count: number;
  amount: number;
  margin: number;
};

type ProductGroup = {
  key: string;
  label: string;
  quantity: number;
  amount: number;
  commission: number;
  directSalesCollection: number;
  directMargin: number;
  revenue: number;
  margin: number;
};

type VendorGroup = ProductGroup & {
  institutionCount: number;
  productCount: number;
};

type AnalyticsDetailRow = {
  key: string;
  activityId: number;
  businessKey: string;
  businessRound: number;
  organization: string;
  activityDate: string;
  primaryMeta: string;
  secondaryMeta: string;
  amount: number;
  quantity?: number;
  countLabel?: string;
  product?: AnalyticsProduct;
};

type AnalyticsDrilldown = {
  title: string;
  description: string;
  rows: AnalyticsDetailRow[];
  kind: "award" | "product" | "vendor" | "missing" | "progress";
  scope?: {
    supplierVendorName?: string;
    productKey?: string;
    missingOnly?: boolean;
    detailAmountLabel?: string;
  };
};

function formatMoney(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 100_000_000) {
    return `${(value / 100_000_000).toLocaleString("ko-KR", {
      maximumFractionDigits: 1,
    })}억원`;
  }
  if (absolute >= 10_000) {
    return `${(value / 10_000).toLocaleString("ko-KR", {
      maximumFractionDigits: 0,
    })}만원`;
  }
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function productPartnerCommission(row: AnalyticsProduct) {
  if (row.supplyType === "direct") return 0;
  return row.estimatedPartnerCommission ?? row.estimatedCommission;
}

function productDirectMargin(row: AnalyticsProduct) {
  if (row.supplyType !== "direct") return row.estimatedDirectMargin ?? 0;
  return row.estimatedDirectMargin ?? row.estimatedMargin;
}

function productDirectSalesCollection(row: AnalyticsProduct) {
  if (row.supplyType !== "direct") return 0;
  return row.estimatedDirectSalesCollection ?? row.amount;
}

function productExpectedRevenue(row: AnalyticsProduct) {
  return (
    row.estimatedRevenue ??
    productPartnerCommission(row) + productDirectMargin(row)
  );
}

function formatTrendValue(value: number, metric: ExecutionTrendMetric) {
  return metric === "count"
    ? `${Math.round(value).toLocaleString("ko-KR")}건`
    : formatMoney(value);
}

function formatTrendAxisValue(value: number, metric: ExecutionTrendMetric) {
  if (metric === "count") return `${Math.round(value).toLocaleString("ko-KR")}건`;
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (absolute >= 100_000_000) {
    return `${sign}${(absolute / 100_000_000).toFixed(1).replace(/\.0$/, "")}억`;
  }
  if (absolute >= 10_000) {
    return `${sign}${(absolute / 10_000).toFixed(1).replace(/\.0$/, "")}만`;
  }
  return formatMoney(value);
}

function aggregateAwards(
  rows: AnalyticsAward[],
  key: (row: AnalyticsAward) => string,
) {
  const result = new Map<string, AggregatedItem>();
  rows.forEach((row) => {
    const label = key(row) || "미분류";
    const current = result.get(label) ?? {
      label,
      count: 0,
      amount: 0,
      margin: 0,
    };
    current.count += 1;
    current.amount += row.confirmedAmount;
    current.margin += row.netRevenue;
    result.set(label, current);
  });
  return [...result.values()].sort(
    (left, right) =>
      right.amount - left.amount || right.count - left.count,
  );
}

function awardBudgetAllocations(row: AnalyticsAward) {
  const source = row.budgets?.length
    ? row.budgets
    : [{ name: row.budgetType || "미분류", enteredAmount: 0 }];
  const totalEntered = source.reduce(
    (sum, budget) => sum + Math.max(0, Number(budget.enteredAmount) || 0),
    0,
  );
  return source.map((budget, index) => {
    const ratio =
      totalEntered > 0
        ? Math.max(0, Number(budget.enteredAmount) || 0) / totalEntered
        : index === 0
          ? 1
          : 0;
    return {
      label: budget.name || "미분류",
      amount: row.confirmedAmount * ratio,
      margin: row.netRevenue * ratio,
    };
  });
}

function aggregateAwardsByBudget(rows: AnalyticsAward[]) {
  const result = new Map<string, AggregatedItem>();
  rows.forEach((row) => {
    awardBudgetAllocations(row).forEach((allocation) => {
      const current = result.get(allocation.label) ?? {
        label: allocation.label,
        count: 0,
        amount: 0,
        margin: 0,
      };
      current.count += 1;
      current.amount += allocation.amount;
      current.margin += allocation.margin;
      result.set(allocation.label, current);
    });
  });
  return [...result.values()].sort(
    (left, right) =>
      right.amount - left.amount || right.count - left.count,
  );
}

function deliveryCheckAction(row: AnalyticsAward) {
  if (row.nextAction.trim()) return row.nextAction.trim();
  if (/설치|공사/.test(row.awardStage)) return "설치·공사 완료 여부를 확인해 주세요.";
  if (/발주|계약|수주/.test(row.awardStage)) return "납품 일정과 발주 진행 상태를 확인해 주세요.";
  return "실제 납품 여부와 납품 완료 처리를 확인해 주세요.";
}

function BarList({
  items,
  valueLabel = "계약금액",
  onSelect,
}: {
  items: AggregatedItem[];
  valueLabel?: string;
  onSelect?: (item: AggregatedItem) => void;
}) {
  const max = Math.max(1, ...items.map((item) => item.amount));
  return (
    <div className="analytics-bar-list">
      {items.map((item) => (
        <button
          className="analytics-bar-row"
          key={item.label}
          type="button"
          onClick={() => onSelect?.(item)}
          disabled={!onSelect || item.count < 1}
          aria-label={`${item.label} 관련 기관 ${item.count.toLocaleString()}건 보기`}
        >
          <div>
            <strong>{item.label}</strong>
            <span>{item.count.toLocaleString()}건</span>
          </div>
          <div className="analytics-bar-track">
            <i
              style={{
                width: item.amount > 0
                  ? `${Math.max(3, (item.amount / max) * 100)}%`
                  : "0%",
              }}
            />
          </div>
          <div>
            <strong>{formatMoney(item.amount)}</strong>
            <span>{valueLabel}</span>
          </div>
        </button>
      ))}
      {!items.length && (
        <div className="empty-state">선택한 기간에 집계할 자료가 없습니다.</div>
      )}
    </div>
  );
}

export default function AnalyticsPage({
  onOpenAwards,
  onOpenOrganization,
  onOpenCollectionAnalysis,
  canRequestCorrections = false,
}: {
  onOpenAwards?: () => void;
  onOpenOrganization?: (organization: string, businessRound: number) => void;
  onOpenCollectionAnalysis?: () => void;
  canRequestCorrections?: boolean;
}) {
  const [awards, setAwards] = useState<AnalyticsAward[]>([]);
  const [receipts, setReceipts] = useState<AnalyticsReceipt[]>([]);
  const [products, setProducts] = useState<AnalyticsProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [periodMode, setPeriodMode] = useState<"year" | "month">("year");
  const currentYear = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul",
  }).slice(0, 4);
  const currentMonth = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul",
  }).slice(5, 7);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [trendMetric, setTrendMetric] =
    useState<ExecutionTrendMetric>("amount");
  const [trendFilter, setTrendFilter] = useState<"all" | "direct" | "consortium">("all");
  const [showProfitGuide, setShowProfitGuide] = useState(false);
  const [tvMode, setTvMode] = useState(false);
  const [productMode, setProductMode] = useState<"product" | "vendor">("product");
  const [productLimit, setProductLimit] = useState(20);
  const [drilldown, setDrilldown] = useState<AnalyticsDrilldown | null>(null);
  const [drilldownLimit, setDrilldownLimit] = useState(50);
  const [selectedDetail, setSelectedDetail] =
    useState<AnalyticsDetailRow | null>(null);
  const [correctionRequestKey, setCorrectionRequestKey] = useState("");
  const [correctionRequestBusy, setCorrectionRequestBusy] = useState(false);
  const [correctionRequestMessage, setCorrectionRequestMessage] = useState("");
  const productRef = useRef<HTMLElement | null>(null);
  const oversightRef = useRef<HTMLElement | null>(null);
  const analyticsPageRef = useRef<HTMLElement | null>(null);

  async function loadAnalytics() {
    try {
      setLoading(true);
      const response = await fetch("/api/accounting?mode=analytics", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        awards?: AnalyticsAward[];
        receipts?: AnalyticsReceipt[];
        products?: AnalyticsProduct[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "통계를 불러오지 못했습니다.");
      }
      setAwards(payload.awards ?? []);
      setReceipts(payload.receipts ?? []);
      setProducts(payload.products ?? []);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "통계를 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Initial remote data synchronization is intentionally performed once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAnalytics();
  }, []);

  useEffect(() => {
    if (!drilldown) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (selectedDetail) setSelectedDetail(null);
        else setDrilldown(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drilldown, selectedDetail]);

  useEffect(() => {
    const syncFullscreen = () => setTvMode(document.fullscreenElement === analyticsPageRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  async function toggleTvMode() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await analyticsPageRef.current?.requestFullscreen();
  }

  const years = useMemo(() => {
    const source = [
      ...awards.map((row) => row.activityDate),
      ...receipts.map((row) => row.collectionDate),
      ...products.map((row) => row.activityDate),
    ];
    return [
      ...new Set([
        currentYear,
        ...source.map((date) => date.slice(0, 4)).filter(Boolean),
      ]),
    ].sort((left, right) => right.localeCompare(left));
  }, [awards, currentYear, products, receipts]);

  const periodPrefix =
    periodMode === "year"
      ? selectedYear
      : `${selectedYear}-${selectedMonth}`;
  const periodAwards = useMemo(
    () => awards.filter((row) => row.activityDate.startsWith(periodPrefix)),
    [awards, periodPrefix],
  );
  const periodProducts = useMemo(
    () => products.filter((row) => row.activityDate.startsWith(periodPrefix)),
    [periodPrefix, products],
  );
  const confirmedAwards = useMemo(
    () => periodAwards.filter((row) => row.confirmed),
    [periodAwards],
  );
  const executionTrend = useMemo(
    () => buildExecutionTrend(awards, selectedYear, trendMetric),
    [awards, selectedYear, trendMetric],
  );
  const executionTrendMax = Math.max(
    1,
    ...executionTrend.months.map(
      (month) => Math.abs(month.direct) + Math.abs(month.consortium),
    ),
  );
  const totals = confirmedAwards.reduce(
    (current, row) => ({
      amount: current.amount + row.confirmedAmount,
      commission:
        current.commission +
        (row.expectedPartnerCommission ?? row.expectedCommission),
      directSalesCollection:
        current.directSalesCollection +
        (row.expectedDirectSalesCollection ?? 0),
      directMargin:
        current.directMargin + (row.expectedDirectMargin ?? 0),
      constructionMargin:
        current.constructionMargin +
        (row.expectedConstructionMargin ?? 0),
      margin: current.margin + row.netRevenue,
    }),
    {
      amount: 0,
      commission: 0,
      directSalesCollection: 0,
      directMargin: 0,
      constructionMargin: 0,
      margin: 0,
    },
  );
  const actualReceiptTotal = sumReceiptsForPeriod(receipts, periodPrefix);

  const regionItems = aggregateAwards(
    confirmedAwards,
    (row) => row.region || "지역 미등록",
  );
  const budgetItems = aggregateAwardsByBudget(confirmedAwards);

  const allProductItems = useMemo(() => {
    const grouped = new Map<string, ProductGroup>();
    periodProducts.forEach((row) => {
      const bucket = analyticsProductBucket(row);
      const { key, label } = bucket;
      const current = grouped.get(key) ?? {
        key,
        label,
        quantity: 0,
        amount: 0,
        commission: 0,
        directSalesCollection: 0,
        directMargin: 0,
        revenue: 0,
        margin: 0,
      };
      current.quantity += row.quantity;
      current.amount += row.amount;
      current.commission += productPartnerCommission(row);
      current.directSalesCollection += productDirectSalesCollection(row);
      current.directMargin += productDirectMargin(row);
      current.revenue += productExpectedRevenue(row);
      current.margin += row.estimatedMargin;
      grouped.set(key, current);
    });
    return [...grouped.values()].sort(
      (left, right) =>
        right.amount - left.amount || right.quantity - left.quantity,
    );
  }, [periodProducts]);
  const productItems = allProductItems.slice(0, productLimit);
  const productTotals = allProductItems.reduce(
    (current, item) => ({
      quantity: current.quantity + item.quantity,
      amount: current.amount + item.amount,
      commission: current.commission + item.commission,
      directSalesCollection:
        current.directSalesCollection + item.directSalesCollection,
      directMargin: current.directMargin + item.directMargin,
      revenue: current.revenue + item.revenue,
      margin: current.margin + item.margin,
    }),
    {
      quantity: 0,
      amount: 0,
      commission: 0,
      directSalesCollection: 0,
      directMargin: 0,
      revenue: 0,
      margin: 0,
    },
  );
  const vendorItems = useMemo(() => {
    const grouped = new Map<
      string,
      VendorGroup & { institutions: Set<string>; productKeys: Set<string> }
    >();
    periodProducts
      .filter((row) => row.supplyType !== "direct")
      .forEach((row) => {
      const label = row.supplierVendorName.trim() || "공급처 미지정";
      const current = grouped.get(label) ?? {
        key: label,
        label,
        quantity: 0,
        amount: 0,
        commission: 0,
        directSalesCollection: 0,
        directMargin: 0,
        revenue: 0,
        margin: 0,
        institutionCount: 0,
        productCount: 0,
        institutions: new Set<string>(),
        productKeys: new Set<string>(),
      };
      current.quantity += row.quantity;
      current.amount += row.amount;
      current.commission += productPartnerCommission(row);
      current.directSalesCollection += 0;
      current.directMargin += 0;
      current.revenue += productExpectedRevenue(row);
      current.margin += row.estimatedMargin;
      current.institutions.add(row.businessKey);
      current.productKeys.add(
        row.isCatalogProduct
          ? `catalog:${row.catalogItemId}`
          : `direct:${row.sourceProductName}`,
      );
      grouped.set(label, current);
    });
    return [...grouped.values()]
      .map((item) => ({
        ...item,
        institutionCount: item.institutions.size,
        productCount: item.productKeys.size,
      }))
      .sort(
        (left, right) =>
          right.amount - left.amount || right.quantity - left.quantity,
      );
  }, [periodProducts]);
  const missingPriceRows = useMemo(
    () =>
      periodProducts
        .filter(isMissingAnalyticsPrice)
        .sort((left, right) =>
          right.activityDate.localeCompare(left.activityDate),
        ),
    [periodProducts],
  );
  const missingPriceInstitutionCount = useMemo(
    () => new Set(missingPriceRows.map((row) => row.businessKey)).size,
    [missingPriceRows],
  );
  const reviewRows = useMemo(
    () =>
      periodAwards
        .filter((row) => !row.confirmed)
        .sort((left, right) =>
          right.activityDate.localeCompare(left.activityDate),
        )
        .slice(0, 6),
    [periodAwards],
  );

  function openDrilldown(next: AnalyticsDrilldown) {
    setSelectedDetail(null);
    setCorrectionRequestKey("");
    setCorrectionRequestMessage("");
    setDrilldownLimit(50);
    setDrilldown(next);
  }

  function awardDetailRow(row: AnalyticsAward, amount = row.confirmedAmount) {
    return {
      key: `award-${row.businessKey}`,
      activityId: row.activityId,
      businessKey: row.businessKey,
      businessRound: row.businessRound,
      organization: row.organization,
      activityDate: row.activityDate,
      primaryMeta: row.region || "지역 미등록",
      secondaryMeta: row.budgetType || "예산 미분류",
      amount,
    } satisfies AnalyticsDetailRow;
  }

  function showAwardDrilldown(
    title: string,
    description: string,
    rows: AnalyticsAward[],
  ) {
    openDrilldown({
      title,
      description,
      kind: "award",
      rows: [...rows]
        .sort((left, right) =>
          right.activityDate.localeCompare(left.activityDate),
        )
        .map((row) => awardDetailRow(row)),
    });
  }

  function showRegionDrilldown(item: AggregatedItem) {
    showAwardDrilldown(
      `${item.label} 납품 기관`,
      "선택한 지역의 납품 완료 기관과 계약금액을 표시합니다.",
      confirmedAwards.filter(
        (row) => (row.region || "지역 미등록") === item.label,
      ),
    );
  }

  function showBudgetDrilldown(item: AggregatedItem) {
    const rows = confirmedAwards.flatMap((row) => {
      const allocation = awardBudgetAllocations(row).find(
        (budget) => budget.label === item.label,
      );
      return allocation
        ? [
            {
              ...awardDetailRow(row, allocation.amount),
              secondaryMeta: item.label,
            },
          ]
        : [];
    });
    openDrilldown({
      title: `${item.label} 예산 기관`,
      description:
        "해당 예산명과 연결된 별칭을 합쳐 표시합니다. 복수 예산 사업은 입력한 예산금액 비율로 계약금액을 한 번만 나눠 집계합니다.",
      kind: "award",
      rows: rows.sort((left, right) =>
        right.activityDate.localeCompare(left.activityDate),
      ),
    });
  }

  function productRowsFor(group: ProductGroup) {
    return periodProducts.filter((row) =>
      group.key === "other"
        ? !row.isCatalogProduct
        : `catalog:${row.catalogItemId}` === group.key,
    );
  }

  function groupProductDetailRows(
    rows: AnalyticsProduct[],
    prefix: string,
    countMode: "quantity" | "items",
  ) {
    return groupAnalyticsProductsByBusiness(rows).map((entry) => {
      const representative = entry.rows[0];
      const budgetNames = [
        ...new Set(
          entry.rows
            .map((row) => (row.budgetName || row.projectName).trim())
            .filter(Boolean),
        ),
      ];
      const itemNames = [
        ...new Set(
          entry.rows
            .map((row) => row.sourceProductName.trim())
            .filter(Boolean),
        ),
      ];
      const count =
        countMode === "items"
          ? entry.rows.length
          : entry.rows.reduce((sum, row) => sum + row.quantity, 0);
      return {
        key: `${prefix}-${entry.businessKey}`,
        activityId: representative.activityId,
        businessKey: entry.businessKey,
        businessRound: representative.businessRound,
        organization: representative.organization,
        activityDate: entry.activityDate,
        primaryMeta: budgetNames.join(" · ") || "예산 미지정",
        secondaryMeta: itemNames.join(" · "),
        amount: entry.rows.reduce((sum, row) => sum + row.amount, 0),
        quantity: count,
        countLabel:
          countMode === "items"
            ? `${count.toLocaleString()}종`
            : `${count.toLocaleString()}개`,
        product: representative,
      } satisfies AnalyticsDetailRow;
    });
  }

  function showProductDrilldown(group: ProductGroup) {
    const rows = groupProductDetailRows(
      productRowsFor(group),
      "product",
      "quantity",
    );
    openDrilldown({
      title: `${group.label} 납품 내역`,
      description:
        group.key === "other"
          ? "기관 상세에서 직접 등록했거나 현재 제품 목록과 연결되지 않은 품목입니다. 원래 품목명과 납품 기관을 표시합니다."
          : "제품·견적 관리의 제품 ID를 기준으로 같은 제품을 합산했습니다.",
      kind: "product",
      scope: {
        productKey: group.key,
        detailAmountLabel: "제품 납품금액",
      },
      rows: rows.sort((left, right) =>
        right.activityDate.localeCompare(left.activityDate),
      ),
    });
  }

  function showVendorDrilldown(group: VendorGroup) {
    const matchingRows = periodProducts.filter(
      (row) =>
        row.supplyType !== "direct" &&
        (row.supplierVendorName.trim() || "공급처 미지정") === group.label,
    );
    openDrilldown({
      title: `${group.label} 납품 내역`,
      description:
        "공급 협력사에 연결된 납품 기관과 제품을 표시합니다. 공급처 미지정 품목은 별도로 모았습니다.",
      kind: "vendor",
      scope: {
        supplierVendorName: group.label,
        detailAmountLabel: "협력사 납품금액",
      },
      rows: groupProductDetailRows(matchingRows, "vendor", "items")
        .sort((left, right) =>
          right.activityDate.localeCompare(left.activityDate),
        ),
    });
  }

  function showMissingPrices() {
    const groupedRows = groupProductDetailRows(
      missingPriceRows,
      "missing",
      "items",
    ).map((row) => {
      const matchingRows = missingPriceRows.filter(
        (product) => product.businessKey === row.businessKey,
      );
      const managers = [
        ...new Set(
          matchingRows
            .map((product) => product.progressManager.trim())
            .filter(Boolean),
        ),
      ];
      const creators = [
        ...new Set(
          matchingRows
            .map((product) => product.createdByName.trim())
            .filter(Boolean),
        ),
      ];
      return {
        ...row,
        secondaryMeta: [
          row.secondaryMeta,
          managers.length ? `담당 ${managers.join(", ")}` : "담당자 미지정",
          creators.length ? `등록 ${creators.join(", ")}` : "등록자 확인 불가",
        ].join(" · "),
      };
    });
    openDrilldown({
      title: `금액 미입력 ${missingPriceRows.length.toLocaleString()}건 · ${missingPriceInstitutionCount.toLocaleString()}개 기관`,
      description:
        "실제 단가가 비어 있고 무상·계약 포함·서비스 품목으로 구분되지 않은 항목입니다. 기관을 열어 관리자가 바로 수정할 수 있습니다.",
      kind: "missing",
      scope: {
        missingOnly: true,
        detailAmountLabel: "미입력 품목 금액",
      },
      rows: groupedRows,
    });
  }

  function showProgressDrilldown(row: AnalyticsAward) {
    openDrilldown({
      title: `${row.organization} 납품 진행 확인`,
      description: deliveryCheckAction(row),
      kind: "progress",
      rows: [
        {
          ...awardDetailRow(row, 0),
          primaryMeta: `${row.awardStage || "단계 미정"} · ${
            row.progressManager || "담당자 미지정"
          }`,
          secondaryMeta:
            row.progressSchedule || row.summary || "진행 메모가 없습니다.",
        },
      ],
    });
  }

  const selectedProducts = selectedDetail
    ? products
        .filter((row) => row.businessKey === selectedDetail.businessKey)
        .filter((row) => {
          if (drilldown?.scope?.missingOnly) {
            return isMissingAnalyticsPrice(row);
          }
          if (drilldown?.scope?.supplierVendorName) {
            return (
              row.supplyType !== "direct" &&
              (row.supplierVendorName.trim() || "공급처 미지정") ===
              drilldown.scope.supplierVendorName
            );
          }
          if (drilldown?.scope?.productKey) {
            return drilldown.scope.productKey === "other"
              ? !row.isCatalogProduct
              : `catalog:${row.catalogItemId}` === drilldown.scope.productKey;
          }
          return true;
        })
    : [];
  async function requestCorrectionTask(row: AnalyticsDetailRow) {
    if (correctionRequestBusy) return;
    const missingItems = selectedProducts.filter(isMissingAnalyticsPrice);
    if (!missingItems.length) return;
    try {
      setCorrectionRequestBusy(true);
      setCorrectionRequestMessage("");
      const response = await fetch("/api/correction-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId: row.activityId,
          businessRound: row.businessRound,
          itemIds: missingItems.map((item) => item.itemId),
          itemNames: missingItems.map((item) => item.sourceProductName),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        task?: { assigneeName?: string };
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "담당자 업무를 등록하지 못했습니다.");
      }
      setCorrectionRequestKey(row.key);
      setCorrectionRequestMessage(
        `${payload.task?.assigneeName || "담당자"}님의 확인할 업무에 등록했습니다.`,
      );
    } catch (caught) {
      setCorrectionRequestMessage(
        caught instanceof Error
          ? caught.message
          : "담당자 업무를 등록하지 못했습니다.",
      );
    } finally {
      setCorrectionRequestBusy(false);
    }
  }

  function openOrganization(row: AnalyticsDetailRow) {
    if (!onOpenOrganization) return;
    setDrilldown(null);
    setSelectedDetail(null);
    onOpenOrganization(row.organization, row.businessRound);
  }

  function scrollTo(section: "product" | "oversight") {
    const target =
      section === "product" ? productRef.current : oversightRef.current;
    window.requestAnimationFrame(() =>
      target?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  return (
    <section ref={analyticsPageRef} className={`analytics-page ${tvMode ? "analytics-tv-mode" : ""}`}>
      <div className="analytics-toolbar panel">
        <div>
          <span className="section-kicker">BUSINESS PERFORMANCE</span>
          <h2>수주·제품 통계</h2>
          <p>
            위즈업 수주의 수주·납품과 제품·협력사 성과를 분석합니다. 실제
            수금은 상단 참고 금액에서 회계 기준 화면으로 연결됩니다.
          </p>
        </div>
        <div className="analytics-period-controls">
          <div className="analytics-mode-switch">
            <button
              type="button"
              className={periodMode === "year" ? "active" : ""}
              onClick={() => setPeriodMode("year")}
            >
              연간
            </button>
            <button
              type="button"
              className={periodMode === "month" ? "active" : ""}
              onClick={() => setPeriodMode("month")}
            >
              월간
            </button>
          </div>
          <select
            aria-label="통계 연도"
            value={selectedYear}
            onChange={(event) => setSelectedYear(event.target.value)}
          >
            {years.map((year) => (
              <option key={year} value={year}>{year}년</option>
            ))}
          </select>
          {periodMode === "month" && (
            <select
              aria-label="통계 월"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
            >
              {Array.from({ length: 12 }, (_, index) =>
                String(index + 1).padStart(2, "0"),
              ).map((month) => (
                <option key={month} value={month}>{Number(month)}월</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => void loadAnalytics()}
            disabled={loading}
          >
            새로고침
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <strong>통계를 불러오지 못했습니다.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="analytics-summary-grid">
        <button type="button" className="orders" onClick={onOpenAwards}>
          <span>수주 건수</span>
          <strong>{periodAwards.length.toLocaleString()}건</strong>
          <small>선택 기간의 수주 흐름입니다.</small>
        </button>
        <button type="button" className="sales" onClick={onOpenAwards}>
          <span>수주액</span>
          <strong>{formatMoney(totals.amount)}</strong>
          <small>납품 완료 처리된 계약금액 합계입니다.</small>
        </button>
        <button type="button" className="collection" onClick={onOpenCollectionAnalysis}>
          <span>당기 수금액</span>
          <strong>{formatMoney(actualReceiptTotal)}</strong>
          <small>입금일 기준 · 누르면 수금 분석으로 이동합니다.</small>
        </button>
        <button
          type="button"
          className="direct-sales"
          onClick={onOpenCollectionAnalysis}
        >
          <span>직접 공급 수금대상</span>
          <strong>{formatMoney(totals.directSalesCollection)}</strong>
          <small>납품 완료된 직접 공급 품목의 판매대금입니다.</small>
        </button>
        <button
          type="button"
          className="commission"
          onClick={() => scrollTo("product")}
        >
          <span>협력사 예상 수수료</span>
          <strong>{formatMoney(totals.commission)}</strong>
          <small>협력사 공급 품목의 판매금액 × 수수료율입니다.</small>
        </button>
        <button
          type="button"
          className="direct"
          onClick={() => scrollTo("product")}
        >
          <span>직접 공급 예상 마진</span>
          <strong>{formatMoney(totals.directMargin)}</strong>
          <small>위즈업 직접 공급 품목의 등록 마진율 기준입니다.</small>
        </button>
        <button
          type="button"
          className={`construction ${
            totals.constructionMargin < 0 ? "loss" : ""
          }`}
          onClick={onOpenAwards}
        >
          <span>공사 마진</span>
          <strong>{formatMoney(totals.constructionMargin)}</strong>
          <small>견적 공사비에서 실제 공사비를 뺀 금액입니다.</small>
        </button>
        <button
          type="button"
          className="net"
          onClick={() => setShowProfitGuide((value) => !value)}
          aria-expanded={showProfitGuide}
        >
          <span>정산 후 예상수익</span>
          <strong>{formatMoney(totals.margin)}</strong>
          <small>제품 수익과 공사 마진에서 컨소 정산액을 뺀 값입니다.</small>
          <em>{showProfitGuide ? "계산 기준 닫기" : "계산 기준 보기"}</em>
        </button>
      </div>

      {showProfitGuide && <div className="analytics-profit-guide" aria-label="예상 수익 계산 기준">
        <span className="commission">
          <small>협력사 예상 수수료</small>
          <strong>협력사 공급 판매금액 × 수수료율</strong>
        </span>
        <i aria-hidden="true">+</i>
        <span className="direct">
          <small>직접 공급 예상 마진</small>
          <strong>직접 공급 판매금액 × 마진율</strong>
        </span>
        <i aria-hidden="true">+</i>
        <span className="construction">
          <small>공사 마진</small>
          <strong>견적 공사비 − 실제 공사비</strong>
        </span>
        <i aria-hidden="true">−</i>
        <span className="consortium">
          <small>예상 컨소 정산액</small>
          <strong>컨소 업체에 지급할 예상액</strong>
        </span>
        <i aria-hidden="true">=</i>
        <span className="net">
          <small>정산 후 예상수익</small>
          <strong>기타 비용 차감 전 관리용 예상치</strong>
        </span>
      </div>}

      <article className="panel analytics-execution-card">
        <header>
          <div>
            <span className="section-kicker">DIRECT · CONSORTIUM TREND</span>
            <h3>월별 직영·컨소 수주 비교</h3>
            <p>
              {selectedYear}년 납품 완료 수주를 기준으로 월별 실적과 연간 비율을
              한 번에 비교합니다.
            </p>
          </div>
          <div className="analytics-execution-controls">
            <button type="button" onClick={() => void toggleTvMode()}>
              {tvMode ? "전체화면 종료" : "전체화면"}
            </button>
            <select
              aria-label="비교 지표"
              value={trendMetric}
              onChange={(event) =>
                setTrendMetric(event.target.value as ExecutionTrendMetric)
              }
            >
              <option value="amount">수주금액</option>
              <option value="margin">최종수익</option>
              <option value="count">수주 건수</option>
            </select>
          </div>
        </header>

        <div className="analytics-execution-layout">
          <div className="analytics-execution-ratio">
            <div
              className="analytics-execution-donut"
              style={{
                background: `conic-gradient(#4f67e8 0 ${executionTrend.directRatio * 100}%, #f39a62 ${executionTrend.directRatio * 100}% 100%)`,
              }}
              role="img"
              aria-label={`직영 ${(executionTrend.directRatio * 100).toFixed(1)}%, 컨소 ${(executionTrend.consortiumRatio * 100).toFixed(1)}%`}
            >
              <span>
                <small>연간 합계</small>
                <strong>{formatTrendValue(executionTrend.totals.total, trendMetric)}</strong>
                <small>{executionTrend.totalCount.toLocaleString("ko-KR")}건</small>
              </span>
            </div>
            <div className="analytics-execution-ratio-legend">
              <button type="button" className={`direct ${trendFilter === "direct" ? "active" : ""}`} onClick={() => setTrendFilter((value) => value === "direct" ? "all" : "direct")}>
                <i />
                <small>직영 {(executionTrend.directRatio * 100).toFixed(1)}%</small>
                <strong>{formatTrendValue(executionTrend.totals.direct, trendMetric)}</strong>
              </button>
              <button type="button" className={`consortium ${trendFilter === "consortium" ? "active" : ""}`} onClick={() => setTrendFilter((value) => value === "consortium" ? "all" : "consortium")}>
                <i />
                <small>컨소 {(executionTrend.consortiumRatio * 100).toFixed(1)}%</small>
                <strong>{formatTrendValue(executionTrend.totals.consortium, trendMetric)}</strong>
              </button>
            </div>
          </div>

          <div className="analytics-execution-chart-wrap">
            <div className="analytics-execution-chart" aria-label="월별 직영·컨소 비교 그래프">
              {executionTrend.months.map((month) => {
                const directValue = trendFilter === "consortium" ? 0 : month.direct;
                const consortiumValue = trendFilter === "direct" ? 0 : month.consortium;
                const directHeight = (Math.abs(directValue) / executionTrendMax) * 100;
                const consortiumHeight = (Math.abs(consortiumValue) / executionTrendMax) * 100;
                const displayedTotal = directValue + consortiumValue;
                const previousTotal = executionTrend.months[Number(month.month) - 2]?.total ?? 0;
                const change = Number(month.month) === 1 || previousTotal === 0
                  ? "비교 기준 없음"
                  : `전월 대비 ${(((month.total - previousTotal) / Math.abs(previousTotal)) * 100).toFixed(1)}%`;
                const active =
                  periodMode === "month" && selectedMonth === month.month;
                return (
                  <button
                    type="button"
                    className={active ? "active" : ""}
                    key={month.month}
                    onClick={() => {
                      setSelectedMonth(month.month);
                      setPeriodMode("month");
                    }}
                    aria-label={`${Number(month.month)}월 ${formatTrendValue(displayedTotal, trendMetric)}. 월간 통계로 보기`}
                    title={`직영 ${formatMoney(month.directAmount)} · ${month.directCount}건\n컨소 ${formatMoney(month.consortiumAmount)} · ${month.consortiumCount}건\n월 합계 ${formatTrendValue(month.total, trendMetric)}\n${change}`}
                  >
                    <strong>
                      {displayedTotal === 0 ? "–" : formatTrendAxisValue(displayedTotal, trendMetric)}
                    </strong>
                    <span className="analytics-execution-stack">
                      <i
                        className="consortium"
                        style={{ height: `${consortiumHeight}%` }}
                      />
                      <i
                        className="direct"
                        style={{ height: `${directHeight}%` }}
                      />
                    </span>
                    <small>{Number(month.month)}월</small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <footer>
          <span><i className="direct" /> 직영</span>
          <span><i className="consortium" /> 컨소</span>
          <small>월 막대를 누르면 아래 통계도 해당 월 기준으로 전환됩니다.</small>
        </footer>
      </article>

      {loading && (
        <div className="loading-state analytics-loading">
          <i />
          <span>수주·제품 통계를 계산하는 중입니다</span>
        </div>
      )}

      {!loading && (
        <div className="analytics-grid">
          <article className="panel analytics-breakdown-card">
            <header>
              <div>
                <span className="section-kicker">REGION</span>
                <h3>지역별 수주 현황</h3>
              </div>
              <small>{regionItems.length}개 지역</small>
            </header>
            <BarList
              items={regionItems.slice(0, 12)}
              onSelect={showRegionDrilldown}
            />
          </article>

          <article className="panel analytics-breakdown-card">
            <header>
              <div>
                <span className="section-kicker">BUDGET</span>
                <h3>예산 종류별 현황</h3>
              </div>
              <small>{budgetItems.length}개 분류</small>
            </header>
            <BarList
              items={budgetItems.slice(0, 12)}
              onSelect={showBudgetDrilldown}
            />
          </article>

          <article className="panel analytics-product-card" ref={productRef}>
            <header>
              <div>
                <span className="section-kicker">SALES BREAKDOWN</span>
                <h3>
                  {productMode === "product"
                    ? "제품별 판매 성과"
                    : "공급 협력사별 판매 성과"}
                </h3>
              </div>
              <div className="analytics-product-mode-switch">
                <button
                  type="button"
                  className={productMode === "product" ? "active" : ""}
                  onClick={() => setProductMode("product")}
                >
                  제품별 성과
                </button>
                <button
                  type="button"
                  className={productMode === "vendor" ? "active" : ""}
                  onClick={() => setProductMode("vendor")}
                >
                  공급 협력사별 성과
                </button>
              </div>
            </header>
            <p className="analytics-product-note">
              제품별 성과는 ‘제품·견적 관리’에 등록된 제품을 기준으로 개별
              표시합니다. 기관 상세에서 직접 추가했거나 현재 제품 목록과
              연결되지 않은 품목은 ‘기타 물품’으로 합산하며, 클릭하면 세부
              품목과 납품 기관을 확인할 수 있습니다. 공사 마진은 제품이나
              공급 협력사에 임의로 배분하지 않습니다.
            </p>
            <div className="analytics-product-summary">
              <span>
                <small>{productMode === "product" ? "제품" : "공급 협력사"}</small>
                <strong>
                  {(productMode === "product"
                    ? allProductItems.length
                    : vendorItems.length
                  ).toLocaleString()}종
                </strong>
              </span>
              <span><small>판매 수량</small><strong>{productTotals.quantity.toLocaleString()}개</strong></span>
              <span><small>판매 금액</small><strong>{formatMoney(productTotals.amount)}</strong></span>
              <span>
                <small>협력사 수수료</small>
                <strong>{formatMoney(productTotals.commission)}</strong>
              </span>
              <span>
                <small>직접 공급 수금대상</small>
                <strong>
                  {formatMoney(productTotals.directSalesCollection)}
                </strong>
              </span>
              <span>
                <small>직접 공급 마진</small>
                <strong>{formatMoney(productTotals.directMargin)}</strong>
              </span>
              <span><small>품목 정산 후 예상수익</small><strong>{formatMoney(productTotals.margin)}</strong></span>
              <button
                type="button"
                className={missingPriceRows.length ? "needs-attention" : ""}
                onClick={showMissingPrices}
                disabled={!missingPriceRows.length}
              >
                <small>금액 미입력</small>
                <strong>{missingPriceRows.length.toLocaleString()}건</strong>
                <small>{missingPriceInstitutionCount.toLocaleString()}개 기관</small>
              </button>
            </div>
            <div className="analytics-product-table-wrap">
              {productMode === "product" ? (
                <table className="analytics-product-performance-table">
                  <colgroup>
                    <col className="col-product-name" />
                    <col className="col-product-number" />
                    <col className="col-product-money" />
                    <col className="col-product-money" />
                    <col className="col-product-money" />
                    <col className="col-product-rate" />
                  </colgroup>
                  <thead>
                    <tr className="analytics-column-group-row">
                      <th className="analytics-group-info">품목 정보</th>
                      <th className="analytics-group-sales" colSpan={2}>판매 실적</th>
                      <th className="analytics-group-profit" colSpan={3}>예상 수익</th>
                    </tr>
                    <tr className="analytics-column-label-row">
                      <th>제품명</th>
                      <th>판매 수량</th>
                      <th>판매 금액</th>
                      <th>예상 품목수익</th>
                      <th>품목 정산 후 예상수익</th>
                      <th>예상수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productItems.map((item) => (
                      <tr key={item.key}>
                        <td>
                          <button
                            type="button"
                            className="analytics-product-link"
                            onClick={() => showProductDrilldown(item)}
                          >
                            {item.label}
                          </button>
                          <small>
                            {item.directMargin > 0 && item.commission === 0
                              ? "위즈업 직접 공급"
                              : item.directMargin > 0
                                ? "공급 방식 혼합"
                                : "협력사 공급"}
                          </small>
                        </td>
                        <td>{item.quantity.toLocaleString()}개</td>
                        <td>{formatMoney(item.amount)}</td>
                        <td>{formatMoney(item.revenue)}</td>
                        <td><strong>{formatMoney(item.margin)}</strong></td>
                        <td>
                          {item.amount > 0
                            ? `${(item.margin / item.amount * 100).toLocaleString(
                                "ko-KR",
                                { maximumFractionDigits: 1 },
                              )}%`
                            : "0%"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="analytics-vendor-performance-table">
                  <colgroup>
                    <col className="col-vendor-name" />
                    <col className="col-vendor-number" />
                    <col className="col-vendor-number" />
                    <col className="col-vendor-number" />
                    <col className="col-vendor-money" />
                    <col className="col-vendor-money" />
                  </colgroup>
                  <thead>
                    <tr className="analytics-column-group-row">
                      <th className="analytics-group-info">공급 협력사</th>
                      <th className="analytics-group-sales" colSpan={3}>판매 범위</th>
                      <th className="analytics-group-profit" colSpan={2}>금액</th>
                    </tr>
                    <tr className="analytics-column-label-row">
                      <th>공급 협력사</th>
                      <th>납품 기관</th>
                      <th>제품 종류</th>
                      <th>판매 수량</th>
                      <th>판매 금액</th>
                      <th>품목 정산 후 예상수익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorItems.map((item) => (
                      <tr key={item.key}>
                        <td>
                          <button
                            type="button"
                            className="analytics-product-link"
                            onClick={() => showVendorDrilldown(item)}
                          >
                            {item.label}
                          </button>
                        </td>
                        <td>{item.institutionCount.toLocaleString()}곳</td>
                        <td>{item.productCount.toLocaleString()}종</td>
                        <td>{item.quantity.toLocaleString()}개</td>
                        <td>{formatMoney(item.amount)}</td>
                        <td><strong>{formatMoney(item.margin)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {productMode === "product" &&
                productLimit < allProductItems.length && (
                  <button
                    type="button"
                    className="analytics-product-more"
                    onClick={() => setProductLimit((current) => current + 20)}
                  >
                    다음 제품 20개 보기
                  </button>
                )}
              {!(productMode === "product"
                ? allProductItems.length
                : vendorItems.length) && (
                <div className="empty-state">
                  선택한 기간에 납품 수량이 입력된 제품이 없습니다.
                </div>
              )}
            </div>
          </article>

          <article className="panel analytics-oversight-card" ref={oversightRef}>
            <header>
              <div>
                <span className="section-kicker">MANAGEMENT CHECK</span>
                <h3>납품 진행 확인</h3>
              </div>
              {onOpenAwards && (
                <button type="button" onClick={onOpenAwards}>
                  기관별 관리에서 전체 보기
                </button>
              )}
            </header>
            <div className="analytics-review-grid delivery-only">
              <section>
                <div className="analytics-review-heading">
                  <strong>납품 진행 확인</strong>
                  <span>{reviewRows.length.toLocaleString()}건 표시</span>
                </div>
                <div className="analytics-review-list">
                  {reviewRows.map((row) => (
                    <button
                      type="button"
                      key={row.businessKey}
                      onClick={() => showProgressDrilldown(row)}
                    >
                      <span>
                        <strong>{row.organization}</strong>
                        <small>
                          {row.awardStage || "단계 미정"} ·{" "}
                          {row.progressManager || "담당자 미지정"} ·{" "}
                          {row.activityDate || "날짜 미정"}
                        </small>
                      </span>
                      <b>{deliveryCheckAction(row)}</b>
                    </button>
                  ))}
                  {!reviewRows.length && (
                    <p>선택한 기간에 납품 진행 확인이 필요한 수주가 없습니다.</p>
                  )}
                </div>
              </section>
            </div>
          </article>
        </div>
      )}

      <p className="analytics-footnote">
        ※ 모든 통계는 위즈업 수주만 대상으로 하며 협력사·타업체 수주는
        제외합니다. 지역·예산·제품 성과는 납품 완료 기록을 기준으로 하고,
        당기 수금액은 회계에 등록한 실제 입금일과 입금액만 사용합니다. 상세
        수금 추이와 미수금 예상액은 회계의 수금 분석에서 확인합니다.
        직접 공급 판매대금은 수금액에 포함하지만 수익에는 마진만 반영합니다.
        정산 후 예상수익은 협력사 수수료와 직접 공급 예상 마진, 공사 마진을
        합한 뒤 예상 컨소 정산액을 뺀 관리용 예상치입니다. 제품별·공급
        협력사별 성과표는 품목 성과만 표시하므로 공사 마진을 배분하지
        않습니다. 인건비·세금·운영비 등을 모두 차감한 순이익이나 확정
        재무제표 금액은 아닙니다.
      </p>

      {drilldown && (
        <div
          className="analytics-drilldown-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setSelectedDetail(null);
              setDrilldown(null);
            }
          }}
        >
          <aside
            className="analytics-drilldown"
            role="dialog"
            aria-modal="true"
            aria-labelledby="analytics-drilldown-title"
          >
            <header>
              <div>
                <span className="section-kicker">
                  {selectedDetail ? "INSTITUTION DETAILS" : "RELATED INSTITUTIONS"}
                </span>
                <h3 id="analytics-drilldown-title">
                  {selectedDetail ? selectedDetail.organization : drilldown.title}
                </h3>
                <p>
                  {selectedDetail
                    ? `${selectedDetail.businessRound}차 사업의 수주·납품 상세입니다.`
                    : drilldown.description}
                </p>
              </div>
              <button
                type="button"
                className="analytics-drilldown-close"
                aria-label="관련 기관 목록 닫기"
                onClick={() => {
                  setSelectedDetail(null);
                  setDrilldown(null);
                }}
              >
                ×
              </button>
            </header>

            {selectedDetail ? (
              <div className="analytics-institution-detail">
                <button
                  type="button"
                  className="analytics-drilldown-back"
                  onClick={() => setSelectedDetail(null)}
                >
                  ← 목록으로
                </button>
                <div className="analytics-detail-summary">
                  <span>
                    <small>
                      {drilldown.scope?.detailAmountLabel || "계약·납품금액"}
                    </small>
                    <strong>{formatMoney(selectedDetail.amount)}</strong>
                  </span>
                </div>
                <section>
                  <h4>납품 품목</h4>
                  <div className="analytics-detail-lines products">
                    {selectedProducts.map((product) => (
                      <div key={product.itemId}>
                        <span>
                          <strong>{product.sourceProductName}</strong>
                          <small>
                            {product.quantity.toLocaleString()}개 ·{" "}
                            {product.priceStatus === "금액 미입력"
                              ? "금액 미입력"
                              : product.unitPrice > 0
                                ? `단가 ${formatMoney(product.unitPrice)}`
                                : product.priceStatus}
                            {" · "}
                            {product.supplyType === "direct"
                              ? "위즈업 직접 공급"
                              : product.supplierVendorName || "공급처 미지정"}
                          </small>
                        </span>
                        <b>{formatMoney(product.amount)}</b>
                      </div>
                    ))}
                    {!selectedProducts.length && <p>등록된 납품 품목이 없습니다.</p>}
                  </div>
                </section>
                {drilldown.kind === "missing" &&
                  selectedProducts.some(isMissingAnalyticsPrice) && (
                  <div className="analytics-correction-actions">
                    {canRequestCorrections && (
                      <button
                        type="button"
                        disabled={
                          correctionRequestBusy ||
                          correctionRequestKey === selectedDetail.key
                        }
                        onClick={() =>
                          void requestCorrectionTask(selectedDetail)
                        }
                      >
                        {correctionRequestBusy
                          ? "업무 등록 중…"
                          : correctionRequestKey === selectedDetail.key
                            ? "담당자 확인 업무 등록됨"
                            : "담당자 확인 업무로 보내기"}
                      </button>
                    )}
                    <small>
                      {correctionRequestMessage ||
                        `미입력 ${selectedProducts
                          .filter(isMissingAnalyticsPrice)
                          .length.toLocaleString()}건을 담당자에게 요청할 수 있습니다.`}
                    </small>
                  </div>
                )}
                {onOpenOrganization && (
                  <button
                    type="button"
                    className="primary analytics-open-institution"
                    onClick={() => openOrganization(selectedDetail)}
                  >
                    기관 상세에서 품목 수정
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="analytics-drilldown-summary">
                  <strong>{drilldown.rows.length.toLocaleString()}곳</strong>
                  <span>한 번에 50곳씩 표시</span>
                </div>
                <div className="analytics-drilldown-list">
                  {drilldown.rows.slice(0, drilldownLimit).map((row) => (
                    <button
                      type="button"
                      className="analytics-drilldown-row"
                      key={row.key}
                      onClick={() => setSelectedDetail(row)}
                    >
                      <div>
                        <strong>{row.organization}</strong>
                        <span>
                          {row.primaryMeta}
                          {row.secondaryMeta ? ` · ${row.secondaryMeta}` : ""}
                        </span>
                      </div>
                      <div>
                        <strong>
                          {row.countLabel
                            ? row.countLabel
                            : row.quantity !== undefined
                            ? `${row.quantity.toLocaleString()}개`
                            : formatMoney(row.amount)}
                        </strong>
                        <span>{row.activityDate || "날짜 미정"}</span>
                        {row.quantity !== undefined && (
                          <small>{formatMoney(row.amount)}</small>
                        )}
                      </div>
                    </button>
                  ))}
                  {!drilldown.rows.length && (
                    <p className="empty-state">표시할 기관이 없습니다.</p>
                  )}
                </div>
                <footer>
                  {drilldownLimit < drilldown.rows.length && (
                    <button
                      type="button"
                      onClick={() =>
                        setDrilldownLimit((current) => current + 50)
                      }
                    >
                      다음 50곳 보기
                    </button>
                  )}
                  {onOpenAwards && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setDrilldown(null);
                        onOpenAwards();
                      }}
                    >
                      기관별 관리 열기
                    </button>
                  )}
                </footer>
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
