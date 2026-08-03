"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildOwnerPerformance,
  type OwnerPerformanceAward,
  type OwnerPerformanceManager,
  type OwnerPerformanceProduct,
} from "../lib/owner-performance";

type PeriodMode = "year" | "quarter" | "month" | "custom";
type SortKey = "margin" | "sales" | "quantity" | "orders";

function todayInKorea() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatRate(value: number) {
  return `${(value * 100).toLocaleString("ko-KR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function rangeForPeriod(
  mode: PeriodMode,
  year: string,
  quarter: number,
  month: string,
  customStart: string,
  customEnd: string,
) {
  if (mode === "custom") {
    return {
      startDate: customStart || `${year}-01-01`,
      endDate: customEnd || `${year}-12-31`,
    };
  }
  if (mode === "month") {
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    return {
      startDate: `${year}-${month}-01`,
      endDate: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
    };
  }
  if (mode === "quarter") {
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(Number(year), endMonth, 0).getDate();
    return {
      startDate: `${year}-${String(startMonth).padStart(2, "0")}-01`,
      endDate: `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    };
  }
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

function rankingValue(row: OwnerPerformanceManager, key: SortKey) {
  if (key === "sales") return row.salesAmount;
  if (key === "quantity") return row.quantity;
  if (key === "orders") return row.orderCount;
  return row.margin;
}

export default function OwnerPerformancePage({
  onOpenOrganization,
}: {
  onOpenOrganization?: (organization: string, businessRound: number) => void;
}) {
  const today = todayInKorea();
  const [awards, setAwards] = useState<OwnerPerformanceAward[]>([]);
  const [products, setProducts] = useState<OwnerPerformanceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("year");
  const [selectedYear, setSelectedYear] = useState(today.slice(0, 4));
  const [selectedQuarter, setSelectedQuarter] = useState(
    Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1,
  );
  const [selectedMonth, setSelectedMonth] = useState(today.slice(5, 7));
  const [customStart, setCustomStart] = useState(`${today.slice(0, 4)}-01-01`);
  const [customEnd, setCustomEnd] = useState(today);
  const [sortKey, setSortKey] = useState<SortKey>("margin");
  const [selectedManagerName, setSelectedManagerName] = useState("");

  async function loadPerformance() {
    try {
      setLoading(true);
      const response = await fetch("/api/accounting?mode=owner-performance", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        awards?: OwnerPerformanceAward[];
        products?: OwnerPerformanceProduct[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "경영 실적을 불러오지 못했습니다.");
      }
      setAwards(payload.awards ?? []);
      setProducts(payload.products ?? []);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "경영 실적을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // 대표관리자 전용 원격 데이터는 화면 진입 시 한 번 동기화합니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPerformance();
  }, []);

  const years = useMemo(
    () =>
      [...new Set([today.slice(0, 4), ...awards.map((row) => row.activityDate.slice(0, 4))])]
        .filter(Boolean)
        .sort((left, right) => right.localeCompare(left)),
    [awards, today],
  );
  const range = rangeForPeriod(
    periodMode,
    selectedYear,
    selectedQuarter,
    selectedMonth,
    customStart,
    customEnd,
  );
  const performance = useMemo(
    () =>
      buildOwnerPerformance(
        awards,
        products,
        range.startDate,
        range.endDate,
      ),
    [awards, products, range.endDate, range.startDate],
  );
  const rankedManagers = useMemo(
    () =>
      [...performance.managers].sort((left, right) => {
        const leftUnassigned = left.name === "담당자 미정" ? 1 : 0;
        const rightUnassigned = right.name === "담당자 미정" ? 1 : 0;
        return (
          leftUnassigned - rightUnassigned ||
          rankingValue(right, sortKey) - rankingValue(left, sortKey) ||
          right.margin - left.margin
        );
      }),
    [performance.managers, sortKey],
  );
  const selectedManager =
    rankedManagers.find((row) => row.name === selectedManagerName) ??
    rankedManagers[0] ??
    null;
  const totalMarginRate =
    performance.totals.salesAmount > 0
      ? performance.totals.margin / performance.totals.salesAmount
      : 0;

  return (
    <section className="owner-performance-page">
      <article className="panel owner-performance-toolbar">
        <div>
          <span className="section-kicker">OWNER PERFORMANCE</span>
          <h2>담당자별 경영 실적</h2>
          <p>납품 완료된 위즈업 수주만 집계하며 협력사·타업체 수주는 제외합니다.</p>
        </div>
        <div className="owner-period-controls">
          <div className="owner-period-mode" role="group" aria-label="실적 기간 단위">
            {(["year", "quarter", "month", "custom"] as PeriodMode[]).map(
              (mode) => (
                <button
                  type="button"
                  className={periodMode === mode ? "active" : ""}
                  key={mode}
                  onClick={() => setPeriodMode(mode)}
                >
                  {{ year: "연도", quarter: "분기", month: "월", custom: "직접 지정" }[mode]}
                </button>
              ),
            )}
          </div>
          {periodMode !== "custom" ? (
            <select
              aria-label="실적 연도"
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.target.value)}
            >
              {years.map((year) => (
                <option key={year} value={year}>{year}년</option>
              ))}
            </select>
          ) : (
            <div className="owner-custom-range">
              <input
                type="date"
                aria-label="실적 시작일"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
              />
              <span>~</span>
              <input
                type="date"
                aria-label="실적 종료일"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
              />
            </div>
          )}
          {periodMode === "quarter" && (
            <select
              aria-label="실적 분기"
              value={selectedQuarter}
              onChange={(event) => setSelectedQuarter(Number(event.target.value))}
            >
              {[1, 2, 3, 4].map((quarter) => (
                <option key={quarter} value={quarter}>{quarter}분기</option>
              ))}
            </select>
          )}
          {periodMode === "month" && (
            <select
              aria-label="실적 월"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
            >
              {Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0")).map(
                (month) => <option key={month} value={month}>{Number(month)}월</option>,
              )}
            </select>
          )}
        </div>
      </article>

      {error && (
        <div className="error-banner">
          <div><strong>경영 실적을 불러오지 못했습니다.</strong><span>{error}</span></div>
          <button type="button" onClick={() => void loadPerformance()}>다시 시도</button>
        </div>
      )}

      <div className="owner-performance-summary">
        <article><span>총 수주액</span><strong>{formatMoney(performance.totals.salesAmount)}</strong><small>{performance.totals.orderCount.toLocaleString("ko-KR")}건</small></article>
        <article><span>최종 마진</span><strong>{formatMoney(performance.totals.margin)}</strong><small>마진율 {formatRate(totalMarginRate)}</small></article>
        <article><span>총 판매량</span><strong>{performance.totals.quantity.toLocaleString("ko-KR")}개</strong><small>등록 품목 수량 합계</small></article>
        <article><span>실적 담당자</span><strong>{performance.totals.managerCount.toLocaleString("ko-KR")}명</strong><small>미지정 담당자 제외</small></article>
      </div>

      <article className="panel owner-ranking-card">
        <div className="owner-ranking-heading">
          <div>
            <span className="section-kicker">RANKING</span>
            <h3>담당자별 순위</h3>
            <p>{range.startDate} ~ {range.endDate}</p>
          </div>
          <label>
            <span>정렬 기준</span>
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              <option value="margin">최종 마진</option>
              <option value="sales">수주액</option>
              <option value="quantity">판매량</option>
              <option value="orders">수주 건수</option>
            </select>
          </label>
        </div>
        {loading ? (
          <div className="loading-state owner-performance-loading"><span className="access-spinner" />실적을 계산하는 중입니다.</div>
        ) : rankedManagers.length ? (
          <div className="owner-ranking-table-wrap">
            <table className="owner-ranking-table">
              <colgroup>
                <col className="owner-ranking-col-rank" />
                <col className="owner-ranking-col-manager" />
                <col className="owner-ranking-col-orders" />
                <col className="owner-ranking-col-sales" />
                <col className="owner-ranking-col-margin" />
                <col className="owner-ranking-col-rate" />
                <col className="owner-ranking-col-quantity" />
              </colgroup>
              <thead><tr><th>순위</th><th>담당자</th><th>수주 건수</th><th>총 수주액</th><th>최종 마진</th><th>마진율</th><th>총 판매량</th></tr></thead>
              <tbody>
                {rankedManagers.map((manager, index) => (
                  <tr
                    key={manager.name}
                    className={selectedManager?.name === manager.name ? "selected" : ""}
                    onClick={() => setSelectedManagerName(manager.name)}
                  >
                    <td><b>{manager.name === "담당자 미정" ? "-" : index + 1}</b></td>
                    <td><button type="button" onClick={() => setSelectedManagerName(manager.name)}>{manager.name}</button></td>
                    <td>{manager.orderCount.toLocaleString("ko-KR")}건</td>
                    <td>{formatMoney(manager.salesAmount)}</td>
                    <td className="owner-margin-cell">{formatMoney(manager.margin)}</td>
                    <td>{formatRate(manager.marginRate)}</td>
                    <td>{manager.quantity.toLocaleString("ko-KR")}개</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">선택한 기간에 완료된 위즈업 수주가 없습니다.</div>
        )}
      </article>

      {selectedManager && (
        <article className="panel owner-manager-detail">
          <div className="owner-manager-detail-heading">
            <div><span className="section-kicker">DETAIL</span><h3>{selectedManager.name} 상세 실적</h3></div>
            <strong>{formatMoney(selectedManager.margin)}</strong>
          </div>
          <div className="owner-institution-list">
            {selectedManager.institutions.map((institution) => (
              <button
                type="button"
                className="owner-institution-row"
                key={institution.businessKey}
                onClick={() => onOpenOrganization?.(institution.organization, institution.businessRound)}
              >
                <span className="owner-institution-name"><strong>{institution.organization}</strong><small>{institution.region || "지역 미등록"} · {institution.businessRound}차 사업 · {institution.activityDate}</small></span>
                <span><small>수주액</small><strong>{formatMoney(institution.salesAmount)}</strong></span>
                <span><small>최종 마진</small><strong>{formatMoney(institution.margin)}</strong></span>
                <span><small>판매량</small><strong>{institution.quantity.toLocaleString("ko-KR")}개</strong></span>
                <span className="owner-product-summary"><small>판매 제품</small><strong>{institution.products.length ? institution.products.map((product) => `${product.name} ${product.quantity.toLocaleString("ko-KR")}개`).join(" · ") : "품목 미등록"}</strong></span>
              </button>
            ))}
          </div>
        </article>
      )}

      <p className="owner-performance-footnote">
        ※ 현재 기관·사업 차수에 저장된 진행 담당자를 기준으로 집계합니다. 담당자 변경 시 과거 기간의 담당자별 합계도 함께 변경됩니다.
      </p>
    </section>
  );
}
