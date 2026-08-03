"use client";

import { useEffect, useMemo, useState } from "react";
import type { AuthoredQuotation, AuthoredQuotationItem } from "../lib/authored-quotations";
import type { ProductCatalogItem } from "../lib/product-catalog";
import { createQuotationWorkbook } from "../lib/quotation-xlsx";

export type QuotationInstitutionOption = {
  organization: string;
  businessRound: number;
  budgetType: string;
};

type DraftItem = Omit<AuthoredQuotationItem, "amount" | "expectedEarning">;
type Draft = {
  id?: number;
  quoteNumber?: string;
  organization: string;
  businessRound: number;
  projectTitle: string;
  quoteDate: string;
  validUntil: string;
  status: "draft" | "final";
  executionType: "직영" | "컨소";
  consortiumCompany: string;
  consortiumRate: number;
  discountAmount: number;
  extraAmount: number;
  includeStamp: boolean;
  memo: string;
  items: DraftItem[];
};

const won = new Intl.NumberFormat("ko-KR");
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const emptyDraft = (): Draft => ({
  organization: "",
  businessRound: 1,
  projectTitle: "",
  quoteDate: today(),
  validUntil: "",
  status: "draft",
  executionType: "직영",
  consortiumCompany: "",
  consortiumRate: 0,
  discountAmount: 0,
  extraAmount: 0,
  includeStamp: true,
  memo: "",
  items: [],
});

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, "_") || "미지정";
}

function downloadBytes(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export default function QuotationManagementPage({ institutions }: { institutions: QuotationInstitutionOption[] }) {
  const [quotes, setQuotes] = useState<AuthoredQuotation[]>([]);
  const [products, setProducts] = useState<ProductCatalogItem[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [quoteResponse, productResponse] = await Promise.all([
        fetch("/api/quotations", { cache: "no-store" }),
        fetch("/api/product-catalog", { cache: "no-store" }),
      ]);
      const quotePayload = await quoteResponse.json() as { quotations?: AuthoredQuotation[]; error?: string };
      const productPayload = await productResponse.json() as { products?: ProductCatalogItem[]; error?: string };
      if (!quoteResponse.ok) throw new Error(quotePayload.error || "견적서를 불러오지 못했습니다.");
      if (!productResponse.ok) throw new Error(productPayload.error || "제품을 불러오지 못했습니다.");
      setQuotes(quotePayload.quotations ?? []);
      setProducts(productPayload.products ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filteredQuotes = useMemo(() => {
    const key = query.trim().toLocaleLowerCase("ko-KR");
    return key
      ? quotes.filter((quote) => `${quote.organization} ${quote.projectTitle} ${quote.quoteNumber}`.toLocaleLowerCase("ko-KR").includes(key))
      : quotes;
  }, [query, quotes]);

  const filteredProducts = useMemo(() => {
    const key = productQuery.trim().toLocaleLowerCase("ko-KR").replace(/\s/g, "");
    return products.filter((product) => !key || `${product.name}${product.specification}${product.note}`.toLocaleLowerCase("ko-KR").replace(/\s/g, "").includes(key)).slice(0, 80);
  }, [productQuery, products]);

  const numbers = useMemo(() => {
    if (!draft) return { subtotal: 0, supply: 0, tax: 0, total: 0, earning: 0, consortium: 0, margin: 0, marginRate: 0 };
    const subtotal = draft.items.reduce((sum, item) => sum + Math.max(0, item.quantity) * Math.max(0, item.unitPrice), 0);
    const supply = Math.max(0, subtotal - Math.max(0, draft.discountAmount) + Math.max(0, draft.extraAmount));
    const earning = draft.items.reduce((sum, item) => sum + Math.floor(item.quantity * item.unitPrice * item.earningRate / 10) * 10, 0);
    const consortium = draft.executionType === "컨소" ? Math.min(earning, Math.floor(subtotal * draft.consortiumRate / 10) * 10) : 0;
    const margin = Math.max(0, earning - consortium);
    const tax = Math.floor(supply * 0.1);
    return { subtotal, supply, tax, total: supply + tax, earning, consortium, margin, marginRate: subtotal ? margin / subtotal : 0 };
  }, [draft]);

  function edit(quote: AuthoredQuotation) {
    setProductQuery("");
    setDraft({
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      organization: quote.organization,
      businessRound: quote.businessRound,
      projectTitle: quote.projectTitle,
      quoteDate: quote.quoteDate,
      validUntil: quote.validUntil,
      status: quote.status,
      executionType: quote.executionType,
      consortiumCompany: quote.consortiumCompany,
      consortiumRate: quote.consortiumRate,
      discountAmount: quote.discountAmount,
      extraAmount: quote.extraAmount,
      includeStamp: quote.includeStamp,
      memo: quote.memo,
      items: quote.items.map(({ amount: _amount, expectedEarning: _earning, ...item }) => item),
    });
  }

  function updateItem(id: string, changes: Partial<DraftItem>) {
    if (!draft) return;
    setDraft({ ...draft, items: draft.items.map((item) => item.id === id ? { ...item, ...changes } : item) });
  }

  function addProduct(product: ProductCatalogItem) {
    if (!draft) return;
    const existing = draft.items.find((item) => item.productId === product.id);
    if (existing) {
      updateItem(existing.id, { quantity: existing.quantity + 1 });
      return;
    }
    const earningRate = product.supplyType === "direct" ? product.marginRate ?? 0 : product.commissionRate ?? 0;
    setDraft({
      ...draft,
      items: [...draft.items, {
        id: crypto.randomUUID(),
        productId: product.id,
        name: product.name,
        specification: product.specification,
        quantity: 1,
        unit: "대",
        unitPrice: product.unitPrice ?? 0,
        note: "",
        supplyType: product.supplyType,
        earningRate,
      }],
    });
  }

  function addBlankItem() {
    if (!draft) return;
    setDraft({
      ...draft,
      items: [...draft.items, {
        id: crypto.randomUUID(), productId: "", name: "", specification: "", quantity: 1,
        unit: "EA", unitPrice: 0, note: "", supplyType: "direct", earningRate: 0,
      }],
    });
  }

  async function save(status: "draft" | "final") {
    if (!draft || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/quotations", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, status }),
      });
      const payload = await response.json() as { quotation?: AuthoredQuotation; error?: string };
      if (!response.ok || !payload.quotation) throw new Error(payload.error || "견적서를 저장하지 못했습니다.");
      setDraft(null);
      setMessage(status === "final" ? "최종 견적서를 저장했습니다." : "임시 저장했습니다.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "견적서를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function exportExcel() {
    if (!draft || !draft.items.length) return;
    const bytes = createQuotationWorkbook({
      customerName: draft.organization,
      quoteDate: draft.quoteDate,
      projectTitle: draft.projectTitle,
      lines: draft.items.map((item) => ({
        name: item.name,
        specification: item.specification,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        note: item.note,
      })),
    });
    downloadBytes(bytes, `견적서_${safeFileName(draft.organization)}_${draft.quoteDate}.xlsx`);
  }

  function printQuote(quote?: AuthoredQuotation) {
    if (quote) edit(quote);
    window.setTimeout(() => window.print(), quote ? 120 : 20);
  }

  return <section className="quotation-workspace">
    <header className="quotation-workspace-header">
      <div>
        <span className="section-kicker">OFFICIAL QUOTATION</span>
        <h2>견적서 작성·보관</h2>
        <p>제품 기준정보로 견적서를 만들고 저장·Excel·PDF 출력을 한곳에서 처리합니다.</p>
      </div>
      <button className="primary-button" type="button" onClick={() => { setProductQuery(""); setDraft(emptyDraft()); }}>견적서 만들기</button>
    </header>
    {message && <div className="quotation-workspace-message">{message}</div>}
    <div className="quotation-list-toolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="기관명·사업명·견적번호 검색" />
      <span>{filteredQuotes.length.toLocaleString()}건</span>
    </div>
    <div className="quotation-list">
      <div className="quotation-list-head"><span>견적일</span><span>기관·사업</span><span>견적번호</span><span>금액</span><span>작성자</span><span>상태</span><span>관리</span></div>
      {loading ? <div className="empty-state">견적서를 불러오는 중입니다.</div> : filteredQuotes.map((quote) => <article className="quotation-list-row" key={quote.id}>
        <span>{quote.quoteDate}</span>
        <span><strong>{quote.organization}</strong><small>{quote.projectTitle || `${quote.businessRound}차 사업`}</small></span>
        <span>{quote.quoteNumber}</span>
        <span><strong>{won.format(quote.totalAmount)}원</strong></span>
        <span>{quote.updatedByName}</span>
        <span><b className={`quotation-status ${quote.status}`}>{quote.status === "final" ? "최종" : "임시"}</b></span>
        <span><button type="button" onClick={() => edit(quote)}>열기</button><button type="button" onClick={() => printQuote(quote)}>PDF·인쇄</button></span>
      </article>)}
      {!loading && !filteredQuotes.length && <div className="empty-state">저장된 견적서가 없습니다.</div>}
    </div>

    {draft && <div className="quotation-editor-shell" role="presentation">
      <div className="quotation-editor quote-studio" role="dialog" aria-modal="true" aria-label="견적서 작성">
        <header className="quote-studio-topbar no-print">
          <div><span>{`${draft.quoteDate.slice(0, 4)}년 ${draft.quoteDate.slice(5, 7)}월 ${draft.quoteDate.slice(8, 10)}일`}</span><h3>견적 작성</h3></div>
          <nav>
            <button type="button" onClick={() => window.print()} disabled={!draft.items.length}>인쇄</button>
            <button type="button" onClick={exportExcel} disabled={!draft.items.length}>Excel</button>
            <button type="button" onClick={() => window.print()} disabled={!draft.items.length}>PDF</button>
            <button type="button" onClick={() => setDraft(null)}>취소</button>
            <button className="primary" type="button" onClick={() => void save("final")} disabled={saving}>{saving ? "저장 중…" : "견적서 저장"}</button>
          </nav>
        </header>

        <div className="quotation-editor-layout quote-studio-layout">
          <main className="quotation-paper quote-document">
            <div className="quotation-paper-title"><strong>견 적 서</strong></div>
            <section className="quote-document-info">
              <div className="quote-recipient">
                <h4>견 적 정 보</h4>
                <label><span>견적일자</span><input type="date" value={draft.quoteDate} onChange={(event) => setDraft({ ...draft, quoteDate: event.target.value })} /></label>
                <label><span>수신 기관명 *</span><input list="quotation-institutions" value={draft.organization} onChange={(event) => { const match = institutions.find((item) => item.organization === event.target.value); setDraft({ ...draft, organization: event.target.value, businessRound: match?.businessRound ?? draft.businessRound, projectTitle: draft.projectTitle || match?.budgetType || "" }); }} placeholder="기관명 검색 또는 신규 입력" /></label>
                <datalist id="quotation-institutions">{institutions.map((item) => <option key={`${item.organization}-${item.businessRound}`} value={item.organization}>{item.businessRound}차 · {item.budgetType}</option>)}</datalist>
                <label><span>견적명</span><input value={draft.projectTitle} onChange={(event) => setDraft({ ...draft, projectTitle: event.target.value })} placeholder="예: 가상현실 스포츠실 구축" /></label>
              </div>
              <div className="quote-supplier">
                <h4>공 급 자</h4>
                <dl>
                  <dt>상호</dt><dd>주식회사 위즈업</dd>
                  <dt>사업자번호</dt><dd>286-86-03454</dd>
                  <dt>대표자</dt><dd className="quotation-representative">박원석 {draft.includeStamp && <img src="/whizzup-seal.png" alt="위즈업 직인" />}</dd>
                  <dt>주소</dt><dd>경기도 하남시 하남대로 947, D동 1208호(풍산동)</dd>
                  <dt>업태</dt><dd>도매 및 소매업 · 정보통신업</dd>
                  <dt>종목</dt><dd>컴퓨터 및 주변장치 공급 · 소프트웨어 개발 및 공급</dd>
                </dl>
              </div>
            </section>
            <div className="quote-total-banner"><span>합계 금액 (VAT 포함)</span><strong>{won.format(numbers.total)}원</strong></div>

            <section className="quotation-product-picker no-print">
              <div><strong>{draft.items.length}개 품목</strong><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder={`물품 검색 (${products.length.toLocaleString()}개)`} /><button type="button" onClick={addBlankItem}>+ 행 추가</button></div>
              {productQuery && <div>{filteredProducts.map((product) => <button type="button" key={product.id} onClick={() => addProduct(product)}><span><b>{product.name}</b><small>{product.specification || "규격 미등록"}</small></span><em>{product.unitPrice === null ? "금액 미등록" : `${won.format(product.unitPrice)}원`}</em></button>)}</div>}
            </section>

            <div className="quotation-items-table quote-grid">
              <div className="quotation-items-head"><span>No</span><span>품명</span><span>규격</span><span>수량</span><span>단위</span><span>단가</span><span>금액</span><span>비고</span><span className="no-print">관리</span></div>
              {draft.items.map((item, index) => <div className="quotation-item-row" key={item.id}>
                <b>{index + 1}</b>
                <input value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} placeholder="품명" />
                <input value={item.specification} onChange={(event) => updateItem(item.id, { specification: event.target.value })} placeholder="규격/모델명" />
                <input type="number" min="1" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} />
                <input value={item.unit} onChange={(event) => updateItem(item.id, { unit: event.target.value })} />
                <input type="number" min="0" value={item.unitPrice} onChange={(event) => updateItem(item.id, { unitPrice: Math.max(0, Number(event.target.value) || 0) })} />
                <strong>{won.format(item.quantity * item.unitPrice)}원</strong>
                <input value={item.note} onChange={(event) => updateItem(item.id, { note: event.target.value })} placeholder="비고" />
                <button className="no-print" type="button" onClick={() => setDraft({ ...draft, items: draft.items.filter((line) => line.id !== item.id) })}>×</button>
              </div>)}
              {!draft.items.length && <div className="quotation-items-empty">물품을 검색하거나 행을 추가해 견적을 작성해 주세요.</div>}
            </div>

            <section className="quote-bottom-row">
              <div className="quote-adjust no-print">
                <strong>금액 조정</strong>
                <label>할인 <input type="number" min="0" value={draft.discountAmount} onChange={(event) => setDraft({ ...draft, discountAmount: Number(event.target.value) || 0 })} /></label>
                <label>추가 <input type="number" min="0" value={draft.extraAmount} onChange={(event) => setDraft({ ...draft, extraAmount: Number(event.target.value) || 0 })} /></label>
              </div>
              <dl><dt>공급가액 (VAT 제외)</dt><dd>{won.format(numbers.supply)}원</dd><dt>부가세 (10%)</dt><dd>{won.format(numbers.tax)}원</dd><dt>합계 금액 (VAT 포함)</dt><dd>{won.format(numbers.total)}원</dd></dl>
            </section>
            <label className="quotation-memo">특기사항 / 메모<textarea value={draft.memo} onChange={(event) => setDraft({ ...draft, memo: event.target.value })} placeholder="견적 관련 특기사항이나 메모를 입력해 주세요." /></label>
          </main>

          <aside className="quotation-profit-panel quote-internal no-print">
            <div><span className="section-kicker">SALES INFO</span><h4>영업 정보</h4></div>
            <label>협업 구분<select value={draft.executionType} onChange={(event) => setDraft({ ...draft, executionType: event.target.value === "컨소" ? "컨소" : "직영" })}><option>직영</option><option>컨소</option></select></label>
            {draft.executionType === "컨소" && <><label>컨소 업체<input value={draft.consortiumCompany} onChange={(event) => setDraft({ ...draft, consortiumCompany: event.target.value })} placeholder="업체명" /></label><label>컨소 지급률<input type="number" min="0" max="100" step="0.1" value={Number((draft.consortiumRate * 100).toFixed(2))} onChange={(event) => setDraft({ ...draft, consortiumRate: Math.min(1, Math.max(0, Number(event.target.value) / 100)) })} /></label></>}
            <section className="quote-profit-box"><header><strong>수익 분석</strong><small>내부용</small></header><dl><dt>예상 수익</dt><dd>{won.format(numbers.earning)}원</dd><dt>컨소 지급</dt><dd>{won.format(numbers.consortium)}원</dd><dt>총이익</dt><dd>{won.format(numbers.margin)}원</dd><dt>마진%</dt><dd>{(numbers.marginRate * 100).toFixed(1)}%</dd></dl></section>
            <label className="quotation-stamp-toggle"><input type="checkbox" checked={draft.includeStamp} onChange={(event) => setDraft({ ...draft, includeStamp: event.target.checked })} /><span>출력물에 직인 포함</span></label>
            <p>내부 수익·수수료 정보는 인쇄 및 PDF 화면에 표시되지 않습니다.</p>
            <div className="quotation-editor-actions"><button type="button" onClick={() => void save("draft")} disabled={saving}>임시 저장</button><button type="button" onClick={() => void save("final")} disabled={saving}>최종 저장</button></div>
          </aside>
        </div>
      </div>
    </div>}
  </section>;
}
