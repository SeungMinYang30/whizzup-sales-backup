"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type MovementType = "in" | "out" | "adjust";

type InventoryProduct = {
  id: number;
  name: string;
  specification: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  lastTransactionAt: string;
  updatedAt: string;
};

type InventoryTransaction = {
  id: number;
  productId: number;
  productName: string;
  unit: string;
  type: MovementType;
  quantityDelta: number;
  resultingStock: number;
  reference: string;
  note: string;
  transactionDate: string;
  createdByName: string;
  createdAt: string;
};

type InventoryPayload = {
  products: InventoryProduct[];
  transactions: InventoryTransaction[];
  summary: {
    productCount: number;
    totalStock: number;
    lowStockCount: number;
    monthlyInbound: number;
    monthlyOutbound: number;
  };
  error?: string;
};

type ProductDraft = {
  name: string;
  specification: string;
  unit: string;
  lowStockThreshold: string;
  initialStock: string;
};

const emptySummary: InventoryPayload["summary"] = {
  productCount: 0,
  totalStock: 0,
  lowStockCount: 0,
  monthlyInbound: 0,
  monthlyOutbound: 0,
};

const movementLabels: Record<MovementType, string> = {
  in: "입고",
  out: "출고",
  adjust: "재고 조정",
};

function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

async function readResponse(response: Response) {
  const data = (await response.json()) as InventoryPayload;
  if (!response.ok) throw new Error(data.error || "재고 정보를 처리하지 못했습니다.");
  return data;
}

function stockState(product: InventoryProduct) {
  if (product.currentStock <= 0) return { label: "재고 없음", tone: "danger" };
  if (product.currentStock <= product.lowStockThreshold) {
    return { label: "보충 필요", tone: "warning" };
  }
  return { label: "정상", tone: "ok" };
}

export default function InventoryPage() {
  const [data, setData] = useState<InventoryPayload>({
    products: [],
    transactions: [],
    summary: emptySummary,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"all" | MovementType>("all");
  const [movementProduct, setMovementProduct] = useState<InventoryProduct | null>(null);
  const [movementType, setMovementType] = useState<MovementType>("in");
  const [movementQuantity, setMovementQuantity] = useState("1");
  const [movementDate, setMovementDate] = useState(today());
  const [movementReference, setMovementReference] = useState("");
  const [movementNote, setMovementNote] = useState("");
  const [productDialog, setProductDialog] = useState<"new" | "edit" | null>(null);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>({
    name: "",
    specification: "",
    unit: "대",
    lowStockThreshold: "1",
    initialStock: "0",
  });

  async function loadInventory() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/inventory", { cache: "no-store" });
      setData(await readResponse(response));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "재고 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInventory();
  }, []);

  const visibleTransactions = useMemo(
    () =>
      historyFilter === "all"
        ? data.transactions
        : data.transactions.filter((item) => item.type === historyFilter),
    [data.transactions, historyFilter],
  );

  function openMovement(product: InventoryProduct, type: MovementType) {
    setMovementProduct(product);
    setMovementType(type);
    setMovementQuantity(type === "adjust" ? String(product.currentStock) : "1");
    setMovementDate(today());
    setMovementReference("");
    setMovementNote("");
    setError("");
  }

  function openNewProduct() {
    setEditingProductId(null);
    setProductDraft({
      name: "",
      specification: "",
      unit: "대",
      lowStockThreshold: "1",
      initialStock: "0",
    });
    setProductDialog("new");
    setError("");
  }

  function openEditProduct(product: InventoryProduct) {
    setEditingProductId(product.id);
    setProductDraft({
      name: product.name,
      specification: product.specification,
      unit: product.unit,
      lowStockThreshold: String(product.lowStockThreshold),
      initialStock: "0",
    });
    setProductDialog("edit");
    setError("");
  }

  async function submitMovement(event: FormEvent) {
    event.preventDefault();
    if (!movementProduct) return;
    const quantity = Number(movementQuantity);
    if (!Number.isFinite(quantity) || quantity < 0 || (movementType !== "adjust" && quantity < 1)) {
      setError("수량을 정확히 입력해 주세요.");
      return;
    }
    if (movementType === "out" && quantity > movementProduct.currentStock) {
      setError(`현재 재고 ${movementProduct.currentStock}${movementProduct.unit}보다 많이 출고할 수 없습니다.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "movement",
          productId: movementProduct.id,
          type: movementType,
          quantity,
          transactionDate: movementDate,
          reference: movementReference,
          note: movementNote,
        }),
      });
      setData(await readResponse(response));
      setMovementProduct(null);
      setNotice(`${movementProduct.name} ${movementLabels[movementType]} 처리를 완료했습니다.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "재고를 변경하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function submitProduct(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: productDialog === "edit" ? "update-product" : "product",
          productId: editingProductId,
          name: productDraft.name,
          specification: productDraft.specification,
          unit: productDraft.unit,
          lowStockThreshold: Number(productDraft.lowStockThreshold),
          initialStock: Number(productDraft.initialStock),
        }),
      });
      setData(await readResponse(response));
      setProductDialog(null);
      setNotice(productDialog === "edit" ? "품목 정보를 수정했습니다." : "새 재고 품목을 등록했습니다.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "품목을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="inventory-page" aria-label="물류·재고 관리">
      {(error || notice) && (
        <div className={`inventory-message ${error ? "is-error" : "is-success"}`} role="status">
          <span>{error || notice}</span>
          <button type="button" onClick={() => { setError(""); setNotice(""); }} aria-label="메시지 닫기">×</button>
        </div>
      )}

      <div className="inventory-summary-grid">
        <article className="inventory-summary-card">
          <span>등록 품목</span><strong>{data.summary.productCount}<small>종</small></strong>
          <p>현재 관리 중인 재고 품목</p>
        </article>
        <article className="inventory-summary-card accent-blue">
          <span>총 재고</span><strong>{data.summary.totalStock.toLocaleString("ko-KR")}<small>대</small></strong>
          <p>전체 품목의 현재 수량</p>
        </article>
        <article className="inventory-summary-card accent-orange">
          <span>보충 확인</span><strong>{data.summary.lowStockCount}<small>종</small></strong>
          <p>안전 재고 이하인 품목</p>
        </article>
        <article className="inventory-summary-card accent-green">
          <span>이번 달 입고 · 출고</span>
          <strong>{data.summary.monthlyInbound}<small>입고</small> / {data.summary.monthlyOutbound}<small>출고</small></strong>
          <p>이번 달 재고 이동 합계</p>
        </article>
      </div>

      <article className="inventory-panel">
        <header className="inventory-panel-header">
          <div><span className="section-kicker">STOCK STATUS</span><h2>현재 재고</h2><p>입고·출고·실사 조정을 품목별로 바로 기록합니다.</p></div>
          <button type="button" className="primary-button" onClick={openNewProduct}>+ 품목 추가</button>
        </header>
        {loading ? (
          <div className="inventory-empty">재고 정보를 불러오고 있습니다.</div>
        ) : data.products.length === 0 ? (
          <div className="inventory-empty">등록된 품목이 없습니다. 품목을 먼저 추가해 주세요.</div>
        ) : (
          <div className="inventory-product-list">
            {data.products.map((product) => {
              const state = stockState(product);
              return (
                <div className="inventory-product-row" key={product.id}>
                  <div className="inventory-product-name"><strong>{product.name}</strong><span>{product.specification || "규격 미입력"}</span></div>
                  <div className="inventory-stock-count"><span>현재 재고</span><strong>{product.currentStock.toLocaleString("ko-KR")}<small>{product.unit}</small></strong></div>
                  <div className="inventory-threshold"><span>안전 재고</span><strong>{product.lowStockThreshold}{product.unit}</strong></div>
                  <div><span className={`inventory-status ${state.tone}`}>{state.label}</span></div>
                  <div className="inventory-last-date"><span>최근 변동</span><strong>{product.lastTransactionAt ? product.lastTransactionAt.slice(0, 10) : "기록 없음"}</strong></div>
                  <div className="inventory-row-actions">
                    <button type="button" className="inventory-action in" onClick={() => openMovement(product, "in")}>입고</button>
                    <button type="button" className="inventory-action out" onClick={() => openMovement(product, "out")}>출고</button>
                    <button type="button" className="inventory-action" onClick={() => openMovement(product, "adjust")}>재고 조정</button>
                    <button type="button" className="inventory-icon-button" onClick={() => openEditProduct(product)} aria-label={`${product.name} 설정`}>설정</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>

      <article className="inventory-panel">
        <header className="inventory-panel-header inventory-history-header">
          <div><span className="section-kicker">MOVEMENT LOG</span><h2>최근 입출고 이력</h2><p>누가 언제 어떤 이유로 수량을 바꿨는지 남습니다.</p></div>
          <div className="inventory-filter-tabs" aria-label="입출고 이력 필터">
            {(["all", "in", "out", "adjust"] as const).map((filter) => (
              <button key={filter} type="button" className={historyFilter === filter ? "active" : ""} onClick={() => setHistoryFilter(filter)}>
                {filter === "all" ? "전체" : movementLabels[filter]}
              </button>
            ))}
          </div>
        </header>
        <div className="inventory-history-list">
          {visibleTransactions.length === 0 ? (
            <div className="inventory-empty">아직 입출고 이력이 없습니다.</div>
          ) : visibleTransactions.map((item) => (
            <div className="inventory-history-row" key={item.id}>
              <time>{item.transactionDate}</time>
              <strong>{item.productName}</strong>
              <span className={`inventory-movement-badge ${item.type}`}>{movementLabels[item.type]}</span>
              <b className={item.quantityDelta > 0 ? "positive" : "negative"}>{item.quantityDelta > 0 ? "+" : ""}{item.quantityDelta}{item.unit}</b>
              <span>잔여 {item.resultingStock}{item.unit}</span>
              <p>{[item.reference, item.note].filter(Boolean).join(" · ") || "내용 없음"}</p>
              <small>{item.createdByName || "담당자 미정"}</small>
            </div>
          ))}
        </div>
      </article>

      {movementProduct && (
        <div className="inventory-dialog-backdrop" role="presentation" onMouseDown={() => !saving && setMovementProduct(null)}>
          <form className="inventory-dialog" onSubmit={submitMovement} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span className="section-kicker">STOCK MOVEMENT</span><h2>{movementProduct.name} 재고 처리</h2><p>현재 {movementProduct.currentStock}{movementProduct.unit}</p></div><button type="button" onClick={() => setMovementProduct(null)} aria-label="닫기">×</button></header>
            <div className="inventory-movement-selector">
              {(["in", "out", "adjust"] as const).map((type) => <button key={type} type="button" className={movementType === type ? "active" : ""} onClick={() => { setMovementType(type); setMovementQuantity(type === "adjust" ? String(movementProduct.currentStock) : "1"); }}>{movementLabels[type]}</button>)}
            </div>
            <label>{movementType === "adjust" ? "조정 후 수량" : `${movementLabels[movementType]} 수량`}<div className="inventory-number-field"><input type="number" min={movementType === "adjust" ? 0 : 1} max={movementType === "out" ? movementProduct.currentStock : undefined} value={movementQuantity} onChange={(event) => setMovementQuantity(event.target.value)} required /><span>{movementProduct.unit}</span></div></label>
            <label>처리일<input type="date" value={movementDate} onChange={(event) => setMovementDate(event.target.value)} required /></label>
            <label>관련 기관·현장 <small>선택</small><input value={movementReference} onChange={(event) => setMovementReference(event.target.value)} placeholder="예: 명천유치원 설치" /></label>
            <label>메모 <small>선택</small><textarea value={movementNote} onChange={(event) => setMovementNote(event.target.value)} placeholder="입고처, 출고 사유, 실사 내용 등을 적어 주세요." /></label>
            <footer><button type="button" className="secondary-button" onClick={() => setMovementProduct(null)}>취소</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "저장 중…" : `${movementLabels[movementType]} 저장`}</button></footer>
          </form>
        </div>
      )}

      {productDialog && (
        <div className="inventory-dialog-backdrop" role="presentation" onMouseDown={() => !saving && setProductDialog(null)}>
          <form className="inventory-dialog" onSubmit={submitProduct} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span className="section-kicker">STOCK ITEM</span><h2>{productDialog === "edit" ? "품목 설정" : "새 품목 추가"}</h2><p>품목명과 안전 재고를 관리합니다.</p></div><button type="button" onClick={() => setProductDialog(null)} aria-label="닫기">×</button></header>
            <label>품목명<input value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} placeholder="예: 3D모션" required /></label>
            <label>규격·설명 <small>선택</small><input value={productDraft.specification} onChange={(event) => setProductDraft({ ...productDraft, specification: event.target.value })} placeholder="예: 3D 모션 스포츠 장비" /></label>
            <div className="inventory-form-grid"><label>단위<input value={productDraft.unit} onChange={(event) => setProductDraft({ ...productDraft, unit: event.target.value })} maxLength={20} required /></label><label>안전 재고<input type="number" min="0" value={productDraft.lowStockThreshold} onChange={(event) => setProductDraft({ ...productDraft, lowStockThreshold: event.target.value })} required /></label></div>
            {productDialog === "new" && <label>현재 보유 수량<input type="number" min="0" value={productDraft.initialStock} onChange={(event) => setProductDraft({ ...productDraft, initialStock: event.target.value })} required /></label>}
            <footer><button type="button" className="secondary-button" onClick={() => setProductDialog(null)}>취소</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "저장 중…" : "품목 저장"}</button></footer>
          </form>
        </div>
      )}
    </section>
  );
}
