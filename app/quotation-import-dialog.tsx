"use client";

import { useMemo, useRef, useState } from "react";
import type { ProductCatalogItem } from "../lib/product-catalog";
import { hasProcurementSignal, procurementNumbersFromText } from "../lib/procurement-product";
import { parseQuotationXlsxData } from "./quotation-xlsx";

type DuplicateAction = "" | "merge" | "keep" | "replace";
type DuplicateBatchAction = DuplicateAction | "exclude";
export type QuotationImportMode = "general" | "teaching-aids";

type AnalysisItem = {
  id: string;
  included: boolean;
  productName: string;
  specification: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  note: string;
  procurement: boolean;
  procurementChannel: string;
  procurementNumber: string;
  procurementFeeRate: number;
  productId: string;
  supplyType: "partner" | "direct";
  earningRate: number;
  supplierName: string;
  linkStatus: "linked" | "review";
  duplicateAction: DuplicateAction;
  duplicateItemId: string;
  reviewNote: string;
};

type AnalysisDraft = {
  sourceName: string;
  sourceType: "pdf" | "xlsx";
  originalTotal: number;
  constructionAmount: number;
  discountAmount: number;
  extraAmount: number;
  items: AnalysisItem[];
};

export type ImportedQuotationItem = Omit<AnalysisItem, "included" | "linkStatus" | "duplicateItemId" | "reviewNote">;

export type ExternalQuotationImportResult = {
  mode: QuotationImportMode;
  sourceFile: File;
  items: ImportedQuotationItem[];
  constructionAmount: number;
  discountAmount: number;
  extraAmount: number;
  procurementFee: number;
};

type ExistingItem = {
  id: string;
  productId: string;
  name: string;
  specification: string;
  procurementNumber: string;
};

type RawItem = {
  id: string;
  productName: string;
  specification: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount?: number;
  note?: string;
  procurement?: boolean;
  isProcurement?: boolean;
  procurementChannel?: string;
  procurementNumber?: string;
  procurementFeeRate?: number;
  reviewNote?: string;
};

const won = new Intl.NumberFormat("ko-KR");

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/g, "");
}

function numberKey(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeRate(value: number | null | undefined) {
  const rate = Number(value) || 0;
  return Math.min(1, Math.max(0, rate > 1 ? rate / 100 : rate));
}

function normalizeProcurementFeeRate(value: number | null | undefined) {
  let rate = Math.max(0, Number(value) || 0);
  if (!rate) return 0;
  if (rate > 1) rate /= 100;
  if (rate > 0.05) rate /= 100;
  return Math.min(0.05, rate);
}

function productNumbers(product: ProductCatalogItem) {
  return new Set([
    numberKey(product.procurementNumber ?? ""),
    ...procurementNumbersFromText(product.name, product.specification, product.note, product.reference),
  ].filter((value) => value.length >= 6));
}

function exactProduct(item: RawItem, products: ProductCatalogItem[]) {
  const procurementNumber = numberKey(item.procurementNumber ?? "");
  if (procurementNumber.length >= 6) {
    const matches = products.filter((product) => productNumbers(product).has(procurementNumber));
    if (matches.length === 1) return matches[0];
  }
  const name = normalized(item.productName);
  const specification = normalized(item.specification);
  const matches = products.filter((product) => {
    if (normalized(product.name) !== name) return false;
    const productSpecification = normalized(product.specification);
    return specification ? productSpecification === specification : !productSpecification;
  });
  return matches.length === 1 ? matches[0] : null;
}

function duplicateOf(item: Pick<AnalysisItem, "productId" | "productName" | "specification" | "procurementNumber">, existing: ExistingItem[]) {
  const procurementNumber = numberKey(item.procurementNumber);
  return existing.find((current) =>
    Boolean(item.productId && current.productId && item.productId === current.productId)
    || Boolean(procurementNumber.length >= 6 && procurementNumber === numberKey(current.procurementNumber))
    || Boolean(normalized(item.productName) && normalized(item.productName) === normalized(current.name)
      && normalized(item.specification) === normalized(current.specification)),
  ) ?? null;
}

function editableMoney(value: number) {
  return value ? won.format(Math.max(0, Math.round(value))) : "";
}

export default function QuotationImportDialog({
  mode,
  revisionLabel,
  products,
  existingItems,
  equipmentKitPlan,
  onClose,
  onApply,
}: {
  mode: QuotationImportMode;
  revisionLabel?: string;
  products: ProductCatalogItem[];
  existingItems: ExistingItem[];
  equipmentKitPlan?: "one" | "two";
  onClose: () => void;
  onApply: (result: ExternalQuotationImportResult) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<AnalysisDraft | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [duplicateBatchAction, setDuplicateBatchAction] = useState<DuplicateBatchAction>("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const duplicateCount = useMemo(() => draft?.items.filter((item) => item.included && item.duplicateItemId).length ?? 0, [draft]);

  const totals = useMemo(() => {
    if (!draft) return { items: 0, adjusted: 0, procurementFee: 0, calculated: 0, difference: 0, feeOnlyDifference: false };
    const included = draft.items.filter((item) => item.included);
    const items = included.reduce((sum, item) => sum + Math.max(0, item.quantity) * Math.max(0, item.unitPrice), 0);
    const procurementFee = included.reduce((sum, item) => sum + (item.procurement && !/^S\s*2\s*B$/iu.test(item.procurementChannel)
      ? Math.floor(item.quantity * item.unitPrice * item.procurementFeeRate / 10) * 10
      : 0), 0);
    const adjusted = Math.max(0, items + draft.constructionAmount - draft.discountAmount + draft.extraAmount);
    const calculated = adjusted + procurementFee;
    const difference = calculated - draft.originalTotal;
    return {
      items,
      adjusted,
      procurementFee,
      calculated,
      difference,
      feeOnlyDifference: procurementFee > 0 && adjusted === draft.originalTotal && difference === procurementFee,
    };
  }, [draft]);

  function prepare(raw: {
    sourceName: string;
    sourceType: "pdf" | "xlsx";
    quoteAmount: number;
    constructionAmount?: number;
    discountAmount?: number;
    extraAmount?: number;
    items: RawItem[];
  }) {
    setDuplicateBatchAction("");
    let extractedConstruction = Math.max(0, Number(raw.constructionAmount) || 0);
    const usableItems = raw.items.filter((item) => {
      if (/설치(?:비|공사)|시공비|공사비/u.test(`${item.productName} ${item.specification}`)) {
        extractedConstruction += Math.max(0, Number(item.amount) || item.quantity * item.unitPrice);
        return false;
      }
      return true;
    });
    const items = usableItems.map((item, index) => {
      const matched = exactProduct(item, products);
      const sourceProcurement = Boolean(item.procurement ?? item.isProcurement)
        || hasProcurementSignal(item.productName, item.specification, item.note, item.procurementNumber);
      const procurement = sourceProcurement || matched?.procurement === true;
      const procurementNumber = item.procurementNumber
        || (matched ? matched.procurementNumber || procurementNumbersFromText(matched.note, matched.specification)[0] || "" : "");
      const procurementChannel = procurement
        ? item.procurementChannel || matched?.procurementChannel || (/S\s*2\s*B/iu.test(`${item.note ?? ""} ${matched?.note ?? ""}`) ? "S2B" : "G2B")
        : "";
      const analyzed: AnalysisItem = {
        id: item.id || `import-${index + 1}`,
        included: true,
        productName: item.productName,
        specification: item.specification,
        quantity: mode === "teaching-aids"
          ? Math.max(0, Math.round(Number(item.quantity) || 0))
          : Math.max(1, Math.round(Number(item.quantity) || 1)),
        unit: item.unit || "개",
        unitPrice: Math.max(0, Math.round(Number(item.unitPrice) || (item.amount ? item.amount / Math.max(1, item.quantity) : 0))),
        note: item.note ?? "",
        procurement,
        procurementChannel,
        procurementNumber,
        procurementFeeRate: procurement && !/^S\s*2\s*B$/iu.test(procurementChannel)
          ? normalizeProcurementFeeRate(matched?.procurementFeeRate ?? item.procurementFeeRate ?? 0.0054)
          : 0,
        productId: matched?.id ?? "",
        supplyType: matched?.supplyType === "partner" ? "partner" : "direct",
        earningRate: matched ? normalizeRate(matched.supplyType === "direct" ? matched.marginRate : matched.commissionRate) : 0,
        supplierName: matched?.supplierVendorName ?? "",
        linkStatus: matched ? "linked" : "review",
        duplicateAction: "",
        duplicateItemId: "",
        reviewNote: item.reviewNote ?? "",
      };
      const duplicate = duplicateOf(analyzed, existingItems);
      return duplicate ? { ...analyzed, duplicateItemId: duplicate.id } : analyzed;
    });
    setDraft({
      sourceName: raw.sourceName,
      sourceType: raw.sourceType,
      originalTotal: Math.max(0, Math.round(Number(raw.quoteAmount) || 0)),
      constructionAmount: extractedConstruction,
      discountAmount: Math.max(0, Math.round(Number(raw.discountAmount) || 0)),
      extraAmount: Math.max(0, Math.round(Number(raw.extraAmount) || 0)),
      items,
    });
  }

  async function analyze() {
    if (!file || analyzing) return;
    setAnalyzing(true);
    setError("");
    try {
      if (file.name.toLocaleLowerCase().endsWith(".xlsx")) {
        const parsed = await parseQuotationXlsxData(file, { mode, equipmentKitPlan });
        prepare({ ...parsed, sourceType: "xlsx" });
      } else {
        const body = new FormData();
        body.set("file", file);
        const response = await fetch("/api/quotations/import", { method: "POST", body });
        const payload = await response.json() as { analysis?: Parameters<typeof prepare>[0]; error?: string };
        if (!response.ok || !payload.analysis) throw new Error(payload.error || "외부 견적서를 분석하지 못했습니다.");
        prepare(payload.analysis);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "외부 견적서를 분석하지 못했습니다.");
    } finally {
      setAnalyzing(false);
    }
  }

  function updateItem(id: string, patch: Partial<AnalysisItem>) {
    setDraft((current) => current ? { ...current, items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item) } : current);
  }

  function applyDuplicateBatch() {
    if (!duplicateBatchAction) {
      setError("동일 품목의 일괄 처리 방법을 선택해 주세요.");
      return;
    }
    setDraft((current) => current ? {
      ...current,
      items: current.items.map((item) => {
        if (!item.included || !item.duplicateItemId) return item;
        if (duplicateBatchAction === "exclude") return { ...item, included: false, duplicateAction: "" };
        return { ...item, duplicateAction: duplicateBatchAction };
      }),
    } : current);
    setError("");
  }

  function apply() {
    if (!draft || !file) return;
    const selected = draft.items.filter((item) => item.included && item.productName.trim());
    const unresolved = selected.find((item) => item.duplicateItemId && !item.duplicateAction);
    if (mode !== "teaching-aids" && unresolved) {
      setError(`${unresolved.productName} 중복 품목 처리 방법을 선택해 주세요.`);
      return;
    }
    if (!selected.length && !draft.constructionAmount) {
      setError("현재 견적에 불러올 품목이나 공사비를 선택해 주세요.");
      return;
    }
    onApply({
      mode,
      sourceFile: file,
      constructionAmount: draft.constructionAmount,
      discountAmount: draft.discountAmount,
      extraAmount: draft.extraAmount,
      procurementFee: totals.procurementFee,
      items: selected.map(({ included: _included, linkStatus: _status, duplicateItemId: _duplicateId, reviewNote: _review, ...item }) => item),
    });
  }

  return <div className="quotation-import-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="quotation-import-dialog" role="dialog" aria-modal="true" aria-labelledby="quotation-import-title">
      <header><div><span className="section-kicker">{mode === "teaching-aids" ? "TEACHING AIDS QUOTATION" : "EXTERNAL QUOTATION"}</span><h3 id="quotation-import-title">{mode === "teaching-aids" ? "교구 견적서 불러오기" : "외부 견적 불러오기"}</h3><p>{mode === "teaching-aids" ? "교구 세부 품목을 확인한 뒤 현재 교구 세트에 반영합니다." : revisionLabel ? `${revisionLabel} 견적 초안에 반영됩니다.` : "분석 결과를 확인한 뒤 현재 견적 초안에 반영합니다."}</p></div><button type="button" aria-label="닫기" onClick={onClose}>×</button></header>
      <div className="quotation-import-scroll">
        <div className={`quotation-import-mode ${mode}`}>
          <strong>{mode === "teaching-aids" ? "교구 견적 전용" : "제품·공사 견적"}</strong>
          <span>{mode === "teaching-aids" ? "교구 업체 견적의 품목·수량·단가를 확인해 교구 세부견적에 불러옵니다." : "외부 견적의 품목과 공사비를 확인해 현재 수정본에 추가합니다."}</span>
        </div>
        <section className="quotation-import-file">
          <input ref={inputRef} type="file" accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => {
            const next = event.target.files?.[0] ?? null;
            if (next && next.size > 20 * 1024 * 1024) { setError("PDF·XLSX는 20MB 이하 파일만 불러올 수 있습니다."); setFile(null); return; }
            setFile(next); setDraft(null); setDuplicateBatchAction(""); setError("");
          }} />
          <button type="button" onClick={() => inputRef.current?.click()}>PDF·Excel 선택</button>
          <span>{file?.name || "선택된 파일 없음"}</span>
          <button type="button" disabled={!file || analyzing} onClick={() => void analyze()}>{analyzing ? "분석 중…" : draft ? "다시 분석" : "분석하기"}</button>
        </section>
        {error && <p className="quotation-import-error">{error}</p>}
        {draft && <>
          <section className="quotation-import-summary">
            <div><span>원본 견적서 총액</span><strong>{won.format(draft.originalTotal)}원</strong></div>
            <div><span>추출된 품목 합계</span><strong>{won.format(totals.items)}원</strong></div>
            <div className="fee"><span>조달수수료</span><strong>{won.format(totals.procurementFee)}원</strong><small>G2B 품목만 별도 반영</small></div>
            <label><span>설치·공사비</span><input inputMode="numeric" value={editableMoney(draft.constructionAmount)} onChange={(event) => setDraft({ ...draft, constructionAmount: Number(event.target.value.replace(/\D/g, "")) || 0 })} /></label>
            <label><span>할인</span><input inputMode="numeric" value={editableMoney(draft.discountAmount)} onChange={(event) => setDraft({ ...draft, discountAmount: Number(event.target.value.replace(/\D/g, "")) || 0 })} /></label>
            <label><span>추가비용</span><input inputMode="numeric" value={editableMoney(draft.extraAmount)} onChange={(event) => setDraft({ ...draft, extraAmount: Number(event.target.value.replace(/\D/g, "")) || 0 })} /></label>
            <div className="total"><span>수수료 포함 최종 합계</span><strong>{won.format(totals.calculated)}원</strong></div>
            <div className={totals.difference && !totals.feeOnlyDifference ? "warning" : "matched"}><span>계산 합계 − 원본 총액</span><strong>{totals.difference > 0 ? "+" : ""}{won.format(totals.difference)}원</strong></div>
          </section>
          {totals.feeOnlyDifference && <p className="quotation-import-fee-notice">원본 견적 총액에는 조달수수료가 포함되지 않은 것으로 보입니다. 불러온 견적에는 조달수수료 {won.format(totals.procurementFee)}원이 별도로 반영됩니다.</p>}
          {Boolean(totals.difference) && !totals.feeOnlyDifference && <p className="quotation-import-warning">원본 총액과 수수료 포함 계산 합계가 다릅니다. 할인·추가비용·공사비를 확인해 주세요.</p>}
          {mode === "general" && duplicateCount > 0 && <section className="quotation-import-duplicate-batch" aria-label="동일 품목 일괄 처리">
            <div><strong>동일 품목 {duplicateCount}건 일괄 처리</strong><span>선택한 방법을 현재 포함된 중복 품목에 한 번에 적용합니다. 품목별 선택은 아래에서 다시 바꿀 수 있습니다.</span></div>
            <select aria-label="동일 품목 일괄 처리 방법" value={duplicateBatchAction} onChange={(event) => setDuplicateBatchAction(event.target.value as DuplicateBatchAction)}>
              <option value="">처리 방법 선택</option><option value="merge">수량 합치기</option><option value="keep">별도 품목으로 유지</option><option value="replace">기존 품목 교체</option><option value="exclude">중복 품목 모두 제외</option>
            </select>
            <button type="button" onClick={applyDuplicateBatch}>일괄 적용</button>
          </section>}
          <div className="quotation-import-items">{draft.items.map((item, index) => <article key={item.id} className={!item.included ? "excluded" : ""}>
            <header><label><input type="checkbox" checked={item.included} onChange={(event) => updateItem(item.id, { included: event.target.checked })} /> 포함</label><strong>{index + 1}번 품목</strong><em className={item.linkStatus}>{item.linkStatus === "linked" ? `제품 연결 · ${item.supplierName || "기준정보 적용"}` : "제품 연결 확인 필요"}</em><button type="button" onClick={() => setDraft({ ...draft, items: draft.items.filter((line) => line.id !== item.id) })}>삭제</button></header>
            <div className="quotation-import-grid">
              <label><span>품명</span><input value={item.productName} onChange={(event) => updateItem(item.id, { productName: event.target.value })} /></label>
              <label><span>규격·모델명</span><input value={item.specification} onChange={(event) => updateItem(item.id, { specification: event.target.value })} /></label>
              <label><span>수량</span><input type="number" min={mode === "teaching-aids" ? 0 : 1} value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: mode === "teaching-aids" ? Math.max(0, Number(event.target.value) || 0) : Math.max(1, Number(event.target.value) || 1) })} /></label>
              <label><span>단위</span><input value={item.unit} onChange={(event) => updateItem(item.id, { unit: event.target.value })} /></label>
              <label><span>단가</span><input inputMode="numeric" value={editableMoney(item.unitPrice)} onChange={(event) => updateItem(item.id, { unitPrice: Number(event.target.value.replace(/\D/g, "")) || 0 })} /></label>
              <label><span>조달 구분</span><select value={item.procurement ? (/^S\s*2\s*B$/iu.test(item.procurementChannel) ? "s2b" : "g2b") : "direct"} onChange={(event) => {
                const value = event.target.value;
                updateItem(item.id, { procurement: value !== "direct", procurementChannel: value === "s2b" ? "S2B" : value === "g2b" ? "G2B" : "", procurementFeeRate: value === "direct" || value === "s2b" ? 0 : item.procurementFeeRate || 0.0054 });
              }}><option value="direct">수의계약</option><option value="g2b">조달·G2B</option><option value="s2b">학교장터·S2B</option></select></label>
              <label><span>조달번호</span><input disabled={!item.procurement} value={item.procurementNumber} onChange={(event) => updateItem(item.id, { procurementNumber: event.target.value })} /></label>
              <label><span>조달수수료율(%)</span><input type="number" min="0" max="100" step="0.01" disabled={!item.procurement || /^S\s*2\s*B$/iu.test(item.procurementChannel)} value={Number((item.procurementFeeRate * 100).toFixed(2))} onChange={(event) => updateItem(item.id, { procurementFeeRate: Math.min(1, Math.max(0, Number(event.target.value) / 100 || 0)) })} /></label>
              <label className="wide"><span>비고</span><input value={item.note} onChange={(event) => updateItem(item.id, { note: event.target.value })} /></label>
            </div>
            {item.reviewNote && <p>{item.reviewNote}</p>}
            {item.duplicateItemId && <label className="quotation-import-duplicate"><span>현재 견적에 같은 품목이 있습니다.</span><select value={item.duplicateAction} onChange={(event) => updateItem(item.id, { duplicateAction: event.target.value as DuplicateAction })}><option value="">처리 방법 선택</option><option value="merge">수량 합치기</option><option value="keep">별도 품목으로 유지</option><option value="replace">기존 품목 교체</option></select></label>}
          </article>)}</div>
        </>}
      </div>
      <footer><button type="button" onClick={onClose}>취소</button><button type="button" disabled={!file || analyzing} onClick={() => void analyze()}>다시 분석</button><button type="button" className="primary" disabled={!draft || analyzing} onClick={apply}>{mode === "teaching-aids" ? "교구 세부견적에 불러오기" : revisionLabel ? `${revisionLabel}에 불러오기` : "현재 견적에 불러오기"}</button></footer>
    </section>
  </div>;
}
