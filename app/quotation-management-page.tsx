"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductCatalogItem } from "../lib/product-catalog";
import type { AuthoredQuotation, AuthoredQuotationItem } from "../lib/authored-quotations";

type InstitutionOption = { organization: string; businessRound: number; budgetType: string };
type DraftItem = Omit<AuthoredQuotationItem, "amount" | "expectedEarning">;
type Draft = {
  id?: number; quoteNumber?: string; organization: string; businessRound: number;
  projectTitle: string; quoteDate: string; validUntil: string; status: "draft" | "final";
  executionType: "직영" | "컨소"; consortiumCompany: string; consortiumRate: number;
  discountAmount: number; extraAmount: number; includeStamp: boolean; memo: string; items: DraftItem[];
};

const won = new Intl.NumberFormat("ko-KR");
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const emptyDraft = (): Draft => ({ organization: "", businessRound: 1, projectTitle: "", quoteDate: today(), validUntil: "", status: "draft", executionType: "직영", consortiumCompany: "", consortiumRate: 0, discountAmount: 0, extraAmount: 0, includeStamp: false, memo: "", items: [] });

export default function QuotationManagementPage({ institutions }: { institutions: InstitutionOption[] }) {
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
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const filteredQuotes = useMemo(() => {
    const key = query.trim().toLocaleLowerCase("ko-KR");
    if (!key) return quotes;
    return quotes.filter((quote) => `${quote.organization} ${quote.projectTitle} ${quote.quoteNumber}`.toLocaleLowerCase("ko-KR").includes(key));
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
    return { subtotal, supply, tax: Math.floor(supply * 0.1), total: supply + Math.floor(supply * 0.1), earning, consortium, margin, marginRate: subtotal ? margin / subtotal : 0 };
  }, [draft]);

  function edit(quote: AuthoredQuotation) {
    setDraft({ id: quote.id, quoteNumber: quote.quoteNumber, organization: quote.organization, businessRound: quote.businessRound, projectTitle: quote.projectTitle, quoteDate: quote.quoteDate, validUntil: quote.validUntil, status: quote.status, executionType: quote.executionType, consortiumCompany: quote.consortiumCompany, consortiumRate: quote.consortiumRate, discountAmount: quote.discountAmount, extraAmount: quote.extraAmount, includeStamp: quote.includeStamp, memo: quote.memo, items: quote.items.map(({ amount: _amount, expectedEarning: _earning, ...item }) => item) });
  }

  function addProduct(product: ProductCatalogItem) {
    if (!draft) return;
    const existing = draft.items.find((item) => item.productId === product.id);
    if (existing) {
      setDraft({ ...draft, items: draft.items.map((item) => item.id === existing.id ? { ...item, quantity: item.quantity + 1 } : item) });
      return;
    }
    const earningRate = product.supplyType === "direct" ? product.marginRate ?? 0 : product.commissionRate ?? 0;
    setDraft({ ...draft, items: [...draft.items, { id: crypto.randomUUID(), productId: product.id, name: product.name, specification: product.specification, quantity: 1, unit: "대", unitPrice: product.unitPrice ?? 0, note: "", supplyType: product.supplyType, earningRate }] });
  }

  async function save(status: "draft" | "final") {
    if (!draft || saving) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/quotations", { method: draft.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, status }) });
      const payload = await response.json() as { quotation?: AuthoredQuotation; error?: string };
      if (!response.ok || !payload.quotation) throw new Error(payload.error || "견적서를 저장하지 못했습니다.");
      setDraft(null); setMessage(status === "final" ? "최종 견적서를 저장했습니다." : "임시 저장했습니다.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "견적서를 저장하지 못했습니다."); }
    finally { setSaving(false); }
  }

  function printQuote(quote: AuthoredQuotation) {
    edit(quote);
    window.setTimeout(() => window.print(), 80);
  }

  return <section className="quotation-workspace">
    <header className="quotation-workspace-header">
      <div><span className="section-kicker">OFFICIAL QUOTATION</span><h2>견적서 관리</h2><p>제품 기준정보를 불러와 작성하고, 내부 수익은 고객용 출력에서 자동으로 숨깁니다.</p></div>
      <button className="primary-button" type="button" onClick={() => setDraft(emptyDraft())}>+ 새 견적서</button>
    </header>
    {message && <div className="quotation-workspace-message">{message}</div>}
    <div className="quotation-list-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="기관명·사업명·견적번호 검색"/><span>{filteredQuotes.length.toLocaleString()}건</span></div>
    <div className="quotation-list">
      <div className="quotation-list-head"><span>견적일</span><span>기관·사업</span><span>견적번호</span><span>금액</span><span>작성자</span><span>상태</span><span>관리</span></div>
      {loading ? <div className="empty-state">견적서를 불러오는 중입니다.</div> : filteredQuotes.map((quote) => <article className="quotation-list-row" key={quote.id}>
        <span>{quote.quoteDate}</span><span><strong>{quote.organization}</strong><small>{quote.projectTitle || `${quote.businessRound}차 사업`}</small></span><span>{quote.quoteNumber}</span><span><strong>{won.format(quote.totalAmount)}원</strong></span><span>{quote.updatedByName}</span><span><b className={`quotation-status ${quote.status}`}>{quote.status === "final" ? "최종" : "임시"}</b></span><span><button type="button" onClick={() => edit(quote)}>열기</button><button type="button" onClick={() => printQuote(quote)}>PDF·인쇄</button></span>
      </article>)}
      {!loading && !filteredQuotes.length && <div className="empty-state">저장된 견적서가 없습니다.</div>}
    </div>

    {draft && <div className="quotation-editor-shell" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setDraft(null); }}>
      <div className="quotation-editor" role="dialog" aria-modal="true">
        <header className="quotation-editor-header no-print"><div><span className="section-kicker">QUOTATION EDITOR</span><h3>{draft.id ? "견적서 수정" : "새 견적서"}</h3></div><button type="button" onClick={() => setDraft(null)} aria-label="닫기">×</button></header>
        <div className="quotation-editor-layout">
          <main className="quotation-paper">
            <div className="quotation-paper-title"><strong>견 적 서</strong><small>{draft.quoteNumber || "저장하면 견적번호가 생성됩니다"}</small></div>
            <div className="quotation-parties">
              <div><label>수신 기관</label><input list="quotation-institutions" value={draft.organization} onChange={(e) => { const match = institutions.find((item) => item.organization === e.target.value); setDraft({ ...draft, organization: e.target.value, businessRound: match?.businessRound ?? draft.businessRound, projectTitle: draft.projectTitle || match?.budgetType || "" }); }} placeholder="기관명을 입력하거나 선택"/><datalist id="quotation-institutions">{institutions.map((item) => <option key={`${item.organization}-${item.businessRound}`} value={item.organization}>{item.businessRound}차 · {item.budgetType}</option>)}</datalist>
                <div className="quotation-inline-fields"><label>견적일<input type="date" value={draft.quoteDate} onChange={(e) => setDraft({ ...draft, quoteDate: e.target.value })}/></label><label>유효기간<input type="date" value={draft.validUntil} onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })}/></label><label>차수<input type="number" min="1" value={draft.businessRound} onChange={(e) => setDraft({ ...draft, businessRound: Math.max(1, Number(e.target.value) || 1) })}/></label></div>
                <label>사업명<input value={draft.projectTitle} onChange={(e) => setDraft({ ...draft, projectTitle: e.target.value })} placeholder="예: 가상현실 스포츠실 구축"/></label>
              </div>
              <div className="quotation-supplier"><strong>공급자</strong><dl><dt>상호</dt><dd>주식회사 위즈업</dd><dt>대표자</dt><dd className="quotation-representative">양승민 {draft.includeStamp && <img src="/whizzup-seal.png" alt="위즈업 직인"/>}</dd><dt>주소</dt><dd>경기도 하남시 하남대로 947 하남테크노밸리 U1 CENTER</dd></dl></div>
            </div>
            <section className="quotation-product-picker no-print"><div><strong>제품 불러오기</strong><input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="제품명·규격 검색"/></div><div>{filteredProducts.map((product) => <button type="button" key={product.id} onClick={() => addProduct(product)}><span><b>{product.name}</b><small>{product.specification || "규격 미등록"}</small></span><em>{product.unitPrice === null ? "금액 미등록" : `${won.format(product.unitPrice)}원`}</em></button>)}</div></section>
            <div className="quotation-items-table"><div className="quotation-items-head"><span>품명</span><span>규격</span><span>수량</span><span>단위</span><span>단가</span><span>금액</span><span className="no-print">관리</span></div>{draft.items.map((item) => <div className="quotation-item-row" key={item.id}><input value={item.name} onChange={(e) => setDraft({ ...draft, items: draft.items.map((line) => line.id === item.id ? { ...line, name: e.target.value } : line) })}/><input value={item.specification} onChange={(e) => setDraft({ ...draft, items: draft.items.map((line) => line.id === item.id ? { ...line, specification: e.target.value } : line) })}/><input type="number" min="1" value={item.quantity} onChange={(e) => setDraft({ ...draft, items: draft.items.map((line) => line.id === item.id ? { ...line, quantity: Math.max(1, Number(e.target.value) || 1) } : line) })}/><input value={item.unit} onChange={(e) => setDraft({ ...draft, items: draft.items.map((line) => line.id === item.id ? { ...line, unit: e.target.value } : line) })}/><input type="number" min="0" value={item.unitPrice} onChange={(e) => setDraft({ ...draft, items: draft.items.map((line) => line.id === item.id ? { ...line, unitPrice: Math.max(0, Number(e.target.value) || 0) } : line) })}/><strong>{won.format(item.quantity * item.unitPrice)}원</strong><button className="no-print" type="button" onClick={() => setDraft({ ...draft, items: draft.items.filter((line) => line.id !== item.id) })}>삭제</button></div>)}{!draft.items.length && <div className="quotation-items-empty">제품을 검색해 견적 품목을 추가해 주세요.</div>}</div>
            <div className="quotation-customer-summary"><label className="no-print">할인<input type="number" min="0" value={draft.discountAmount} onChange={(e) => setDraft({ ...draft, discountAmount: Number(e.target.value) || 0 })}/></label><label className="no-print">추가비용<input type="number" min="0" value={draft.extraAmount} onChange={(e) => setDraft({ ...draft, extraAmount: Number(e.target.value) || 0 })}/></label><dl><dt>공급가액</dt><dd>{won.format(numbers.supply)}원</dd><dt>부가세</dt><dd>{won.format(numbers.tax)}원</dd><dt>합계 금액</dt><dd>{won.format(numbers.total)}원</dd></dl></div>
            <label className="quotation-memo">견적조건·메모<textarea value={draft.memo} onChange={(e) => setDraft({ ...draft, memo: e.target.value })} placeholder="납기, 설치 조건, 유효기간 등을 적어 주세요."/></label>
          </main>
          <aside className="quotation-profit-panel no-print"><span className="section-kicker">INTERNAL ONLY</span><h4>내부 수익 분석</h4><label>사업방식<select value={draft.executionType} onChange={(e) => setDraft({ ...draft, executionType: e.target.value === "컨소" ? "컨소" : "직영" })}><option>직영</option><option>컨소</option></select></label>{draft.executionType === "컨소" && <><label>컨소 업체<input value={draft.consortiumCompany} onChange={(e) => setDraft({ ...draft, consortiumCompany: e.target.value })}/></label><label>컨소 지급률<input type="number" min="0" max="100" step="0.1" value={Number((draft.consortiumRate * 100).toFixed(2))} onChange={(e) => setDraft({ ...draft, consortiumRate: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}/></label></>}
            <div className="quotation-profit-cards"><div><span>제품 기준 예상 수익</span><strong>{won.format(numbers.earning)}원</strong></div><div><span>컨소 지급</span><strong>{won.format(numbers.consortium)}원</strong></div><div className="highlight"><span>최종 마진</span><strong>{won.format(numbers.margin)}원</strong><small>{(numbers.marginRate * 100).toFixed(1)}%</small></div></div>
            <label className="quotation-stamp-toggle"><input type="checkbox" checked={draft.includeStamp} onChange={(e) => setDraft({ ...draft, includeStamp: e.target.checked })}/><span>최종 출력에 직인 포함</span></label><p>내부 수익과 수수료는 고객용 PDF·인쇄 화면에 표시되지 않습니다.</p>
            <div className="quotation-editor-actions"><button type="button" onClick={() => void save("draft")} disabled={saving}>임시 저장</button><button type="button" onClick={() => void save("final")} disabled={saving}>최종 저장</button><button type="button" onClick={() => window.print()} disabled={!draft.items.length}>PDF·인쇄</button></div>
          </aside>
        </div>
      </div>
    </div>}
  </section>;
}
