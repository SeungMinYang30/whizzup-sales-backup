"use client";

import { useEffect, useMemo, useState } from "react";
import type { AuthoredQuotation } from "../lib/authored-quotations";

const won = new Intl.NumberFormat("ko-KR");

export default function OrganizationQuotationHistory({
  organization,
  businessRound,
  onOpen,
  onCreate,
  onLoaded,
  readOnly = false,
  canEdit = false,
  availableBudgets = [],
}: {
  organization: string;
  businessRound: number;
  onOpen?: (id: number, mode: "edit") => void;
  onCreate?: () => void;
  onLoaded?: () => void;
  readOnly?: boolean;
  canEdit?: boolean;
  availableBudgets?: Array<{
    budgetType: string;
    budgetOriginalName?: string;
    budgetGroupId?: number | null;
  }>;
}) {
  const [quotes, setQuotes] = useState<AuthoredQuotation[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetch(`/api/quotations?q=${encodeURIComponent(organization)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((payload: { quotations?: AuthoredQuotation[] }) => {
        setQuotes((payload.quotations ?? []).filter((quote) => quote.organization === organization && quote.businessRound === businessRound));
        onLoaded?.();
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [businessRound, organization]);
  const visibleQuotes = useMemo(() => {
    const latestByRoot = new Map<number, AuthoredQuotation>();
    quotes.forEach((quote) => {
      const rootId = quote.revisionRootId || quote.id;
      const current = latestByRoot.get(rootId);
      if (!current || quote.revisionNumber > current.revisionNumber || (quote.revisionNumber === current.revisionNumber && quote.id > current.id)) latestByRoot.set(rootId, quote);
    });
    const current = Array.from(latestByRoot.values()).sort((left, right) => right.quoteDate.localeCompare(left.quoteDate) || right.id - left.id);
    return readOnly ? current.filter((quote) => quote.status === "final") : current;
  }, [quotes, readOnly]);
  const displayedBudgets = (quote: AuthoredQuotation) => {
    if (quote.budgets.length) return quote.budgets;
    if (availableBudgets.length !== 1) return [];
    const budget = availableBudgets[0];
    const name = budget.budgetType || budget.budgetOriginalName || "예산";
    return [{ key: budget.budgetGroupId ? `group:${budget.budgetGroupId}` : `name:${name}`, budgetGroupId: budget.budgetGroupId ?? null, name, institutionAmount: 0, allocatedAmount: quote.totalAmount }];
  };
  const currentItems = useMemo(() => {
    const items = new Map<string, AuthoredQuotation["items"][number]>();
    visibleQuotes.forEach((quote) => {
      quote.items
        .filter((item) => item.productId !== "__construction_cost__")
        .forEach((item) => {
          const key = [
            item.productId || item.name,
            item.specification,
            item.unit,
            item.unitPrice,
            item.note,
          ].join("\u001f");
          const current = items.get(key);
          items.set(
            key,
            current
              ? {
                  ...current,
                  quantity: current.quantity + item.quantity,
                  amount: current.amount + item.amount,
                }
              : { ...item },
          );
        });
    });
    return [...items.values()];
  }, [visibleQuotes]);
  const constructionAmount = useMemo(
    () =>
      visibleQuotes.reduce(
        (total, quote) =>
          total +
          quote.items
            .filter((item) => item.productId === "__construction_cost__")
            .reduce((sum, item) => sum + item.amount, 0),
        0,
      ),
    [visibleQuotes],
  );
  const linkedBudgetNames = useMemo(
    () =>
      [...new Set(visibleQuotes.flatMap((quote) => displayedBudgets(quote).map((budget) => budget.name)).filter(Boolean))],
    [visibleQuotes, availableBudgets],
  );
  const currentQuotationTotal = useMemo(
    () => visibleQuotes.reduce((total, quote) => total + quote.totalAmount, 0),
    [visibleQuotes],
  );
  const fileAction = (url: string | null | undefined, label: string, external = false) =>
    url ? (
      <a className="quotation-history-action" href={url} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{label}</a>
    ) : (
      <button className="quotation-history-action" type="button" disabled>{label}</button>
    );
  return <>
    {readOnly && (loading || currentItems.length > 0 || constructionAmount > 0) ? <section className="equipment-section equipment-section-readonly">
      <div className="history-section-heading equipment-section-heading">
        <div>
          <span className="section-kicker">QUOTATION ITEMS</span>
          <h3>견적 품목·공사비</h3>
          <p>현재 최종 견적서에 실제 저장된 품목과 공사비입니다.</p>
        </div>
        <span className="equipment-readonly-badge">최종 견적 연계</span>
      </div>
      {loading ? <p className="equipment-quotation-loading">견적 품목을 불러오는 중입니다.</p> : <>
        <div className="equipment-readonly-totals">
          {currentItems.length > 0 && <span>견적 품목 <b>{currentItems.length}개</b></span>}
          {constructionAmount > 0 && <span>견적 공사비 <b>{won.format(constructionAmount)}원</b></span>}
          <span>최종 견적 합계 <b>{won.format(currentQuotationTotal)}원</b></span>
        </div>
        <div className="equipment-readonly-projects">
          <article>
            <header>
              <strong>{linkedBudgetNames.join(" · ") || "최종 견적"}</strong>
              <span>{currentItems.length}개 품목{constructionAmount > 0 ? ` · 공사비 ${won.format(constructionAmount)}원` : ""}</span>
            </header>
            <ul>
              {currentItems.map((item, index) => <li key={`${item.id}-${index}`}><span><b>{item.name}</b><small>{item.specification || item.note || "규격 미등록"}</small></span><em>{won.format(item.quantity)}{item.unit || "개"} · {won.format(item.amount)}원</em></li>)}
              {constructionAmount > 0 && <li className="equipment-readonly-construction"><span><b>설치·공사비</b><small>현재 최종 견적서에 포함된 공사비</small></span><em>{won.format(constructionAmount)}원</em></li>}
            </ul>
          </article>
        </div>
      </>}
    </section> : null}
    <section className="organization-quotation-history">
    <header><div><span className="section-kicker">QUOTATION HISTORY</span><h3>견적서 내역</h3>{readOnly && <p>최종 저장된 견적서와 PDF·Excel 파일을 확인합니다.</p>}</div><span>{visibleQuotes.length}건</span></header>
    {loading ? <p>견적서를 불러오는 중입니다.</p> : visibleQuotes.length ? <div>{visibleQuotes.map((quote) => <article key={quote.id}>
      <span className="quotation-history-main"><b>{quote.quoteNumber}</b><small>{quote.quoteDate} · {quote.status === "final" ? "현재 최종본" : "작성 중"}</small>{displayedBudgets(quote).length > 0 ? <small>연결 예산 · {displayedBudgets(quote).map((budget) => `${budget.name} ${won.format(budget.allocatedAmount)}원`).join(" · ")}</small> : <small>예산 연결 필요</small>}</span>
      <div className="quotation-history-summary"><strong>{won.format(quote.totalAmount)}원</strong><small>품목 {quote.items.filter((item) => item.productId !== "__construction_cost__").length}개{quote.items.some((item) => item.productId === "__construction_cost__") ? ` · 공사비 ${won.format(quote.items.filter((item) => item.productId === "__construction_cost__").reduce((sum, item) => sum + item.amount, 0))}원` : ""}</small><em>{quote.status === "final" ? "최종" : "임시"}</em></div>
      <div className="quotation-history-actions">
        {quote.status === "final" && fileAction(quote.pdfUrl, "PDF 보기", true)}
        {quote.status === "final" && fileAction(quote.excelUrl, "Excel 다운로드")}
        {quote.status === "final" && quote.sourceOriginalUrl && fileAction(quote.sourceOriginalUrl, "참고 원본")}
        {onOpen && (canEdit || !readOnly) ? <button className="quotation-history-action primary" type="button" onClick={() => onOpen(quote.id, "edit")}>{quote.status === "draft" ? "이어서 작성" : "견적 수정"}</button> : null}
      </div>
    </article>)}</div> : <div className="quotation-history-empty"><p>이 사업 차수에 최종 저장된 견적서가 없습니다.</p>{onCreate && canEdit ? <button className="quotation-history-action primary" type="button" onClick={onCreate}>이 기관 견적서 만들기</button> : null}</div>}
    </section>
  </>;
}
