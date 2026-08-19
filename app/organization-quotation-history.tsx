"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AuthoredQuotation } from "../lib/authored-quotations";
import { quotationDownloadName } from "../lib/quotation-file-name";
import { createAuthoredQuotationPdf } from "./authored-quotation-pdf";
import { createAuthoredQuotationWorkbookFile, storedQuotationFile } from "./authored-quotation-downloads";
import { createFieldInspectionPdfFile, createFieldInspectionWorkbookFile } from "./field-inspection-documents";
import { resolveInspectionVisitorName, useAutoCloseQuotationOutputMenus, useInspectionVisitorName } from "./quotation-output-menu-behavior";

const won = new Intl.NumberFormat("ko-KR");

function downloadGeneratedFile(file: Blob, name = file instanceof File ? file.name : "download") {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function reservePdfTab() {
  const tab = window.open(`/pdf-opening.html?request=${Date.now()}`, "_blank");
  if (tab) tab.opener = null;
  return tab;
}

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
  onOpen?: (quotation: AuthoredQuotation, mode: "edit") => void;
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
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [inspectionAction, setInspectionAction] = useState("");
  const [quotationFileAction, setQuotationFileAction] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [inspectionPdfFallback, setInspectionPdfFallback] = useState<{ url: string; name: string } | null>(null);
  const inspectionPdfFallbackRef = useRef("");
  const [inspectionVisitorName, setInspectionVisitorName] = useInspectionVisitorName();
  useAutoCloseQuotationOutputMenus();
  useEffect(() => () => {
    if (inspectionPdfFallbackRef.current) URL.revokeObjectURL(inspectionPdfFallbackRef.current);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`/api/quotations?organization=${encodeURIComponent(organization)}&businessRound=${businessRound}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as { quotations?: AuthoredQuotation[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "견적서를 불러오지 못했습니다.");
        return payload;
      })
      .then((payload) => {
        setQuotes((payload.quotations ?? []).filter((quote) => quote.organization === organization && quote.businessRound === businessRound));
        onLoaded?.();
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setQuotes([]);
        setError(loadError instanceof Error ? loadError.message : "견적서를 불러오지 못했습니다.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [businessRound, organization, reloadVersion]);
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
  const viewQuotationPdf = async (quote: AuthoredQuotation) => {
    const tab = reservePdfTab();
    if (!tab) {
      setActionMessage("새 탭이 차단되었습니다. 팝업 허용 후 PDF 보기를 다시 눌러 주세요.");
      return;
    }
    setQuotationFileAction(`${quote.id}:pdf-view`);
    setActionMessage("");
    try {
      let file: Blob;
      let regenerated = false;
      try {
        if (!quote.pdfUrl) throw new Error("저장된 PDF 파일이 없습니다.");
        file = await storedQuotationFile(quote.pdfUrl, "저장된 PDF를 불러오지 못했습니다.");
      } catch {
        file = await createAuthoredQuotationPdf(quote);
        regenerated = true;
      }
      const url = URL.createObjectURL(file);
      tab.location.replace(url);
      tab.focus();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (regenerated) setActionMessage("저장소 연결이 원활하지 않아 현재 최종 견적 내용으로 PDF를 다시 만들었습니다.");
    } catch (actionError) {
      tab.close();
      setActionMessage(actionError instanceof Error ? actionError.message : "견적서 PDF를 열지 못했습니다.");
    } finally {
      setQuotationFileAction("");
    }
  };
  const downloadQuotationPdf = async (quote: AuthoredQuotation) => {
    setQuotationFileAction(`${quote.id}:pdf-download`);
    setActionMessage("");
    try {
      try {
        if (!quote.pdfUrl) throw new Error("저장된 PDF 파일이 없습니다.");
        downloadGeneratedFile(
          await storedQuotationFile(quote.pdfUrl, "저장된 PDF를 내려받지 못했습니다."),
          quote.drivePdfName || quotationDownloadName(quote, "pdf"),
        );
      } catch {
        downloadGeneratedFile(await createAuthoredQuotationPdf(quote));
        setActionMessage("저장소 연결이 원활하지 않아 현재 최종 견적 내용으로 PDF를 다시 만들어 다운로드했습니다.");
      }
    } catch (actionError) {
      setActionMessage(actionError instanceof Error ? actionError.message : "견적서 PDF를 만들지 못했습니다.");
    } finally {
      setQuotationFileAction("");
    }
  };
  const downloadQuotationExcel = async (quote: AuthoredQuotation) => {
    setQuotationFileAction(`${quote.id}:xlsx-download`);
    setActionMessage("");
    try {
      try {
        if (!quote.excelUrl) throw new Error("저장된 Excel 파일이 없습니다.");
        downloadGeneratedFile(
          await storedQuotationFile(quote.excelUrl, "저장된 Excel을 내려받지 못했습니다."),
          quote.driveXlsxName || quotationDownloadName(quote, "xlsx"),
        );
      } catch {
        downloadGeneratedFile(await createAuthoredQuotationWorkbookFile(quote));
        setActionMessage("저장소 연결이 원활하지 않아 현재 최종 견적 내용으로 Excel을 다시 만들어 다운로드했습니다.");
      }
    } catch (actionError) {
      setActionMessage(actionError instanceof Error ? actionError.message : "견적서 Excel을 만들지 못했습니다.");
    } finally {
      setQuotationFileAction("");
    }
  };
  const viewInspectionPdf = async (quote: AuthoredQuotation) => {
    const tab = window.open(`/pdf-opening.html?request=${Date.now()}`, "_blank");
    if (tab) tab.opener = null;
    const action = `${quote.id}:view`;
    setInspectionAction(action);
    if (inspectionPdfFallbackRef.current) URL.revokeObjectURL(inspectionPdfFallbackRef.current);
    inspectionPdfFallbackRef.current = "";
    setInspectionPdfFallback(null);
    setActionMessage("");
    try {
      const visitorName = await resolveInspectionVisitorName(inspectionVisitorName, quote.updatedByName);
      const file = await createFieldInspectionPdfFile(quote, "", visitorName);
      const url = URL.createObjectURL(file);
      inspectionPdfFallbackRef.current = url;
      if (!tab) {
        setInspectionPdfFallback({ url, name: file.name });
        setActionMessage("새 탭이 차단되었습니다. PDF 열기를 눌러 검수서류를 확인해 주세요.");
      } else {
        try {
          tab.location.replace(url);
          tab.focus();
          window.setTimeout(() => tab.focus(), 120);
          setActionMessage("");
        } catch {
          tab.close();
          setInspectionPdfFallback({ url, name: file.name });
          setActionMessage("새 탭에서 PDF를 열지 못했습니다. PDF 열기를 눌러 검수서류를 확인해 주세요.");
        }
      }
    } catch (actionError) {
      tab?.close();
      setActionMessage(actionError instanceof Error ? actionError.message : "현장 검수서류 PDF를 만들지 못했습니다.");
    } finally {
      setInspectionAction("");
    }
  };
  const downloadInspectionPdf = async (quote: AuthoredQuotation) => {
    const action = `${quote.id}:pdf`;
    setInspectionAction(action);
    setActionMessage("");
    try {
      const visitorName = await resolveInspectionVisitorName(inspectionVisitorName, quote.updatedByName);
      downloadGeneratedFile(await createFieldInspectionPdfFile(quote, "", visitorName));
    }
    catch (actionError) { setActionMessage(actionError instanceof Error ? actionError.message : "현장 검수서류 PDF를 만들지 못했습니다."); }
    finally { setInspectionAction(""); }
  };
  const downloadInspectionExcel = async (quote: AuthoredQuotation) => {
    const action = `${quote.id}:xlsx`;
    setInspectionAction(action);
    setActionMessage("");
    try {
      const visitorName = await resolveInspectionVisitorName(inspectionVisitorName, quote.updatedByName);
      downloadGeneratedFile(await createFieldInspectionWorkbookFile(quote, "", visitorName));
    }
    catch (actionError) { setActionMessage(actionError instanceof Error ? actionError.message : "현장 검수서류 Excel을 만들지 못했습니다."); }
    finally { setInspectionAction(""); }
  };
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
    {actionMessage && <p className="quotation-history-action-message" role="status">{actionMessage}{inspectionPdfFallback ? <span className="quotation-pdf-fallback-actions"><a href={inspectionPdfFallback.url} target="_blank" rel="noreferrer">PDF 열기</a><button type="button" onClick={() => setInspectionPdfFallback(null)}>닫기</button></span> : null}</p>}
    {error ? <div className="quotation-history-empty" role="alert"><p>{error}</p><button className="quotation-history-action primary" type="button" onClick={() => setReloadVersion((version) => version + 1)}>다시 불러오기</button></div> : loading ? <p>견적서를 불러오는 중입니다.</p> : visibleQuotes.length ? <div>{visibleQuotes.map((quote) => <article key={quote.id}>
      <span className="quotation-history-main"><b>{quote.quoteNumber}</b><small>{quote.quoteDate} · {quote.status === "final" ? "현재 최종본" : "작성 중"}</small>{displayedBudgets(quote).length > 0 ? <small>연결 예산 · {displayedBudgets(quote).map((budget) => `${budget.name} ${won.format(budget.allocatedAmount)}원`).join(" · ")}</small> : <small>예산 연결 필요</small>}</span>
      <div className="quotation-history-summary"><strong>{won.format(quote.totalAmount)}원</strong><small>품목 {quote.items.filter((item) => item.productId !== "__construction_cost__").length}개{quote.items.some((item) => item.productId === "__construction_cost__") ? ` · 공사비 ${won.format(quote.items.filter((item) => item.productId === "__construction_cost__").reduce((sum, item) => sum + item.amount, 0))}원` : ""}</small><em>{quote.status === "final" ? "최종" : "임시"}</em></div>
      <div className="quotation-history-actions">
        {quote.status === "final" && <details className="quotation-output-menu">
          <summary>PDF</summary>
          <div className="quotation-output-menu-panel">
            <button type="button" disabled={quotationFileAction.startsWith(`${quote.id}:`) || !quote.items.length} onClick={() => void viewQuotationPdf(quote)}>보기</button>
            <button type="button" disabled={quotationFileAction.startsWith(`${quote.id}:`) || !quote.items.length} onClick={() => void downloadQuotationPdf(quote)}>다운로드</button>
          </div>
        </details>}
        {quote.status === "final" && <button className="quotation-history-action" type="button" disabled={quotationFileAction.startsWith(`${quote.id}:`) || !quote.items.length} onClick={() => void downloadQuotationExcel(quote)}>Excel 다운로드</button>}
        {quote.status === "final" && <details className="quotation-output-menu quotation-output-menu-inspection">
          <summary>현장 검수서류</summary>
          <div className="quotation-output-menu-panel">
            <label className="quotation-inspection-visitor-field"><span>검수 방문자</span><input value={inspectionVisitorName} onChange={(event) => setInspectionVisitorName(event.target.value)} placeholder={quote.updatedByName || "방문자 이름"} /></label>
            <button type="button" disabled={inspectionAction.startsWith(`${quote.id}:`)} onClick={() => void viewInspectionPdf(quote)}>PDF 보기·인쇄</button>
            <button type="button" disabled={inspectionAction.startsWith(`${quote.id}:`)} onClick={() => void downloadInspectionPdf(quote)}>PDF 다운로드</button>
            <button type="button" disabled={inspectionAction.startsWith(`${quote.id}:`)} onClick={() => void downloadInspectionExcel(quote)}>Excel 통합 다운로드</button>
          </div>
        </details>}
        {quote.status === "final" && quote.sourceOriginalUrl && fileAction(quote.sourceOriginalUrl, "참고 원본")}
        {onOpen && (canEdit || !readOnly) ? <button className="quotation-history-action primary" type="button" onClick={() => onOpen(quote, "edit")}>{quote.status === "draft" ? "이어서 작성" : "견적 수정"}</button> : null}
      </div>
    </article>)}</div> : <div className="quotation-history-empty"><p>이 사업 차수에 최종 저장된 견적서가 없습니다.</p>{onCreate && canEdit ? <button className="quotation-history-action primary" type="button" onClick={onCreate}>이 기관 견적서 만들기</button> : null}</div>}
    </section>
  </>;
}
