"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AuthoredQuotation, AuthoredQuotationBudget, AuthoredQuotationItem } from "../lib/authored-quotations";
import type { ProductCatalogItem } from "../lib/product-catalog";
import { parseBudgetMoney } from "../lib/activity-budgets";
import { createQuotationWorkbook } from "../lib/quotation-xlsx";
import { hasProcurementSignal, procurementNumbersFromText } from "../lib/procurement-product";
import { createAuthoredQuotationPdf, quotationFileStem } from "./authored-quotation-pdf";
import { quotationInternalCostDefaults, quotationInternalCostKind } from "../lib/quotation-internal-costs";
import {
  airpassEquipmentKitOutputLines,
  airpassEquipmentKitTotal,
  createAirpassEquipmentKit,
  isAirpassEquipmentKitProduct,
  type AirpassEquipmentKit,
} from "../lib/airpass-equipment-kit";
import QuotationImportDialog, {
  type ExternalQuotationImportResult,
  type QuotationImportMode,
} from "./quotation-import-dialog";
import { parseQuotationXlsxData } from "./quotation-xlsx";

export type QuotationInstitutionOption = {
  organization: string;
  businessRound: number;
  budgetType: string;
  region?: string;
  contactName?: string;
  budgets?: Array<{
    budgetType: string;
    budgetOriginalName?: string;
    budgetGroupId?: number | null;
    budgetAmount?: string;
    budgetInstitutionAmount?: string;
    budgetAmountOverride?: string;
  }>;
};

type QuotationScope = QuotationInstitutionOption;

type QuotationManagementPageProps = {
  institutions: QuotationInstitutionOption[];
  scope?: QuotationScope;
  embedded?: boolean;
  equipmentRefreshVersion?: number;
  /** @deprecated 기관 상세 직접 반영 UI는 제거되었습니다. 호환용으로만 유지합니다. */
  canSyncDirectEquipment?: boolean;
  onOpenOrganization?: (organization: string, businessRound: number) => void;
  onCountChange?: (counts: { active: number; trash: number }) => void;
};

const QUOTATION_PAGE_SIZE = 25;

type EquipmentQuoteItem = {
  id: number;
  catalogItemId: string;
  productName: string;
  specification: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  note: string;
  supplyType: "partner" | "direct";
  earningRate: number;
  procurement: boolean;
  procurementChannel: string;
  procurementNumber: string;
  procurementFeeRate: number;
};

type EquipmentQuoteProject = {
  id: number;
  name: string;
  budgetType: string;
  constructionAmount: number;
  actualConstructionCost: number;
  items: EquipmentQuoteItem[];
};

type DraftItem = Omit<AuthoredQuotationItem, "amount" | "expectedEarning" | "procurementFee" | "consortiumPayment">;
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
  additionalInternalConstructionCost: number;
  includeStamp: boolean;
  memo: string;
  items: DraftItem[];
  budgets: AuthoredQuotationBudget[];
};

type EquipmentKitEditor = {
  item: DraftItem;
  editingItemId?: string;
};

const won = new Intl.NumberFormat("ko-KR");
const CONSTRUCTION_PRODUCT_ID = "__construction_cost__";

function isConstructionItem(item: Pick<DraftItem, "productId">) {
  return item.productId === CONSTRUCTION_PRODUCT_ID;
}

function isS2BChannel(value: string) {
  return /^S\s*2\s*B$/iu.test(value.trim());
}

function appliesProcurementFee(item: Pick<DraftItem, "procurement" | "procurementChannel">) {
  return item.procurement && !isS2BChannel(item.procurementChannel);
}

function contractLabel(item: DraftItem) {
  if (isConstructionItem(item)) return "공사비";
  if (!item.procurement) return "수의계약";
  if (isS2BChannel(item.procurementChannel)) return "학교장터";
  return "조달 계약";
}

function outputNote(item: DraftItem) {
  return contractLabel(item);
}

function constructionDraftItem(amount = 0, projectTitle = "") : DraftItem {
  return {
    id: crypto.randomUUID(),
    productId: CONSTRUCTION_PRODUCT_ID,
    name: "설치·공사비",
    specification: projectTitle ? `${projectTitle} 설치공사` : "공간재구조화 설치공사",
    quantity: 1,
    unit: "식",
    unitPrice: Math.max(0, Math.round(amount)),
    note: "공사비",
    supplyType: "direct",
    earningRate: 0,
    contractType: "direct",
    procurement: false,
    procurementChannel: "",
    procurementNumber: "",
    procurementFeeRate: 0,
    consortiumRate: 0,
    internalCostEnabled: false,
    internalCostAmount: 0,
  };
}

function normalizedInstitutionName(value: string) {
  return value.replace(/\s/g, "").toLocaleLowerCase("ko-KR");
}

function internalCostFields(name: string, specification = "") {
  const defaults = quotationInternalCostDefaults(name, specification);
  return {
    internalCostEnabled: defaults.enabled,
    internalCostAmount: defaults.amount,
  };
}

function normalizedEquipmentKitName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function procurementChannelFromText(...values: string[]) {
  const text = values.join(" ");
  if (/S\s*2\s*B/iu.test(text)) return "S2B";
  if (/디지털서비스몰/iu.test(text)) return "디지털서비스몰";
  if (/혁신장터/iu.test(text)) return "혁신장터";
  return "G2B";
}
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
function amountInKoreanLabel(value: number) {
  const small = ["", "십", "백", "천"];
  const large = ["", "만", "억", "조"];
  const digit = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  let remaining = Math.max(0, Math.round(value));
  if (!remaining) return "금 영원정";
  let result = "";
  let group = 0;
  while (remaining) {
    const part = remaining % 10_000;
    if (part) {
      let block = "";
      for (let position = 3; position >= 0; position -= 1) {
        const current = Math.floor(part / (10 ** position)) % 10;
        if (!current) continue;
        if (!(current === 1 && position > 0)) block += digit[current];
        block += small[position];
      }
      result = `${block}${large[group]}${result}`;
    }
    remaining = Math.floor(remaining / 10_000);
    group += 1;
  }
  return `금 ${result}원정`;
}

function procurementDisplay(item: DraftItem) {
  if (!item.procurement) return "-";
  return [item.procurementChannel || "G2B", item.procurementNumber].filter(Boolean).join(" · ") || "-";
}
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
  additionalInternalConstructionCost: 0,
  includeStamp: true,
  memo: "",
  items: [],
  budgets: [],
});

function budgetOptionsForInstitution(option?: QuotationInstitutionOption): AuthoredQuotationBudget[] {
  if (!option) return [];
  const source = option.budgets?.length
    ? option.budgets
    : option.budgetType
      ? [{ budgetType: option.budgetType }]
      : [];
  const seen = new Set<string>();
  return source.flatMap((budget, index) => {
    const name = String(budget.budgetType || budget.budgetOriginalName || "").trim();
    if (!name) return [];
    const groupId = Number(budget.budgetGroupId);
    const budgetGroupId = Number.isSafeInteger(groupId) && groupId > 0 ? groupId : null;
    const key = budgetGroupId
      ? `group:${budgetGroupId}`
      : `name:${name.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, "")}:${index}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      key,
      budgetGroupId,
      name,
      institutionAmount: parseBudgetMoney(budget.budgetAmountOverride || budget.budgetInstitutionAmount || budget.budgetAmount || ""),
      allocatedAmount: 0,
    }];
  });
}

function draftForScope(scope?: QuotationScope): Draft {
  const budgetOptions = budgetOptionsForInstitution(scope);
  return {
    ...emptyDraft(),
    organization: scope?.organization ?? "",
    businessRound: scope?.businessRound ?? 1,
    projectTitle: scope?.budgetType ?? "",
    budgets: budgetOptions.length === 1 ? budgetOptions : [],
  };
}

function draftFromQuotation(quote: AuthoredQuotation): Draft {
  return {
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
    additionalInternalConstructionCost: quote.additionalInternalConstructionCost,
    includeStamp: quote.includeStamp,
    memo: quote.memo,
    budgets: quote.budgets,
    items: quote.items.map(({ amount: _amount, expectedEarning: _earning, ...item }) => ({
      ...item,
      id: item.id,
    })),
  };
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, "_") || "미지정";
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function EditableRateInput({ value, onChange, max = 100, step = 0.1, disabled = false, label }: { value: number; onChange: (value: number) => void; max?: number; step?: number; disabled?: boolean; label: string }) {
  const displayValue = (rate: number) => String(Number((Math.max(0, rate) * 100).toFixed(2)));
  const [text, setText] = useState(() => displayValue(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(displayValue(value));
  }, [editing, value]);

  const apply = (raw: string, commitEmpty = false) => {
    const normalized = raw.replace(",", ".");
    if (normalized !== "" && !/^\d{0,3}(?:\.\d{0,2})?$/.test(normalized)) return;
    setText(normalized);
    if (normalized === "" && !commitEmpty) return;
    const parsed = normalized === "" ? 0 : Number(normalized);
    if (!Number.isFinite(parsed)) return;
    const nextPercent = Math.min(Math.max(0, max), Math.max(0, parsed));
    onChange(nextPercent / 100);
    if (commitEmpty || nextPercent !== parsed) setText(String(Number(nextPercent.toFixed(2))));
  };

  return <input
    type="text"
    inputMode="decimal"
    data-min="0"
    data-max={Math.max(0, max)}
    data-step={step}
    disabled={disabled}
    value={text}
    aria-label={label}
    onFocus={(event) => {
      setEditing(true);
      event.currentTarget.select();
    }}
    onChange={(event) => apply(event.target.value)}
    onBlur={() => {
      apply(text, true);
      setEditing(false);
    }}
  />;
}

function FormattedMoneyInput({ value, onChange, label, disabled = false }: { value: number; onChange: (value: number) => void; label: string; disabled?: boolean }) {
  const [text, setText] = useState(() => won.format(Math.max(0, Math.round(value))));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(won.format(Math.max(0, Math.round(value))));
  }, [editing, value]);

  const apply = (raw: string, commitEmpty = false) => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      setText("");
      if (commitEmpty) onChange(0);
      return;
    }
    const parsed = Math.max(0, Number(digits) || 0);
    setText(won.format(parsed));
    onChange(parsed);
  };

  return <input
    type="text"
    inputMode="numeric"
    disabled={disabled}
    value={text}
    aria-label={label}
    onFocus={(event) => {
      setEditing(true);
      event.currentTarget.select();
    }}
    onChange={(event) => apply(event.target.value)}
    onBlur={() => {
      apply(text, true);
      setEditing(false);
    }}
  />;
}

export default function QuotationManagementPage({
  institutions,
  scope,
  embedded = false,
  equipmentRefreshVersion = 0,
  canSyncDirectEquipment = false,
  onOpenOrganization,
  onCountChange,
}: QuotationManagementPageProps) {
  const [quotes, setQuotes] = useState<AuthoredQuotation[]>([]);
  const [trashedQuotes, setTrashedQuotes] = useState<AuthoredQuotation[]>([]);
  const [products, setProducts] = useState<ProductCatalogItem[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [quotationPage, setQuotationPage] = useState(1);
  const [productQuery, setProductQuery] = useState("");
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
  const [productListMode, setProductListMode] = useState<"all" | "favorites" | null>(null);
  const [productResultsOpen, setProductResultsOpen] = useState(false);
  const [outputBlankRows, setOutputBlankRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [loadedInstitutionKey, setLoadedInstitutionKey] = useState("");
  const [message, setMessage] = useState("");
  const [institutionQuery, setInstitutionQuery] = useState("");
  const [newInstitution, setNewInstitution] = useState({ region: "", contactName: "", contactPhone: "", contactEmail: "" });
  const [printPortalReady, setPrintPortalReady] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [quotationActionId, setQuotationActionId] = useState(0);
  const [equipmentKitEditor, setEquipmentKitEditor] = useState<EquipmentKitEditor | null>(null);
  const [equipmentKitHideZero, setEquipmentKitHideZero] = useState(false);
  const [equipmentKitRecoveryId, setEquipmentKitRecoveryId] = useState("");
  const [dragOverItemId, setDragOverItemId] = useState("");
  const [importMode, setImportMode] = useState<QuotationImportMode | null>(null);
  const [importSourceFile, setImportSourceFile] = useState<File | null>(null);
  const [internalReportOpen, setInternalReportOpen] = useState(false);
  const draftRef = useRef<Draft | null>(null);
  const draggedItemIdRef = useRef("");
  const editorHistoryActiveRef = useRef(false);
  const duplicateFileReconcileRef = useRef(false);
  const productSearchRef = useRef<HTMLDivElement | null>(null);
  const productSearchResultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { draftRef.current = draft; }, [draft]);

  useEffect(() => {
    if (!productResultsOpen) return;
    const closeProductList = () => setProductResultsOpen(false);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (productSearchRef.current?.contains(target) || productSearchResultsRef.current?.contains(target))) return;
      if (window.matchMedia("(max-width: 720px)").matches) return;
      closeProductList();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeProductList();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [productResultsOpen]);

  function beginEditor(nextDraft: Draft) {
    if (!draftRef.current && !editorHistoryActiveRef.current) {
      window.history.pushState({ ...(window.history.state ?? {}), whizzupQuotationEditor: true }, "");
      editorHistoryActiveRef.current = true;
    }
    setDraft(nextDraft);
  }

  function clearEditorState() {
    setDraft(null);
    setProductQuery("");
    setProductListMode(null);
    setOutputBlankRows(0);
    setLoadedInstitutionKey("");
    setEquipmentKitEditor(null);
    setEquipmentKitHideZero(false);
    draggedItemIdRef.current = "";
    setDragOverItemId("");
    setImportMode(null);
    setImportSourceFile(null);
  }

  function closeEditor() {
    clearEditorState();
    if (editorHistoryActiveRef.current) {
      editorHistoryActiveRef.current = false;
      window.history.back();
    }
  }

  useEffect(() => {
    const handleBack = () => {
      if (!editorHistoryActiveRef.current) return;
      editorHistoryActiveRef.current = false;
      clearEditorState();
    };
    window.addEventListener("popstate", handleBack);
    return () => window.removeEventListener("popstate", handleBack);
  }, []);

  useEffect(() => {
    setPrintPortalReady(true);
    const preparePrint = () => {
      if (document.querySelector(".quotation-print-portal")) {
        document.body.classList.add("quotation-printing");
      }
    };
    const finishPrint = () => document.body.classList.remove("quotation-printing");
    window.addEventListener("beforeprint", preparePrint);
    window.addEventListener("afterprint", finishPrint);
    return () => {
      finishPrint();
      window.removeEventListener("beforeprint", preparePrint);
      window.removeEventListener("afterprint", finishPrint);
    };
  }, []);

  function printQuotation() {
    if (!draft?.items.length) return;
    document.body.classList.add("quotation-printing");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        try {
          window.print();
        } catch (error) {
          document.body.classList.remove("quotation-printing");
          throw error;
        }
      });
    });
  }

  function startQuotation() {
    setProductQuery("");
    setProductListMode(null);
    setOutputBlankRows(0);
    setInstitutionQuery("");
    setNewInstitution({ region: "", contactName: "", contactPhone: "", contactEmail: "" });
    setLoadedInstitutionKey("");
    beginEditor(emptyDraft());
  }

  async function load() {
    setLoading(true);
    try {
      const quoteParams = new URLSearchParams();
      if (scope?.organization) {
        quoteParams.set("organization", scope.organization);
        quoteParams.set("businessRound", String(scope.businessRound));
      }
      const quoteUrl = `/api/quotations${quoteParams.size ? `?${quoteParams}` : ""}`;
      const trashParams = new URLSearchParams(quoteParams);
      trashParams.set("deleted", "only");
      const [quoteResponse, trashResponse, productResponse] = await Promise.all([
        fetch(quoteUrl, { cache: "no-store" }),
        fetch(`/api/quotations?${trashParams}`, { cache: "no-store" }),
        fetch("/api/product-catalog", { cache: "no-store" }),
      ]);
      const quotePayload = await quoteResponse.json() as { quotations?: AuthoredQuotation[]; error?: string };
      const trashPayload = await trashResponse.json() as { quotations?: AuthoredQuotation[]; error?: string };
      const productPayload = await productResponse.json() as { products?: ProductCatalogItem[]; favoriteProductIds?: unknown[]; error?: string };
      if (!quoteResponse.ok) throw new Error(quotePayload.error || "견적서를 불러오지 못했습니다.");
      if (!trashResponse.ok) throw new Error(trashPayload.error || "삭제된 견적서를 불러오지 못했습니다.");
      if (!productResponse.ok) throw new Error(productPayload.error || "제품을 불러오지 못했습니다.");
      setQuotes(quotePayload.quotations ?? []);
      setTrashedQuotes(trashPayload.quotations ?? []);
      setProducts(productPayload.products ?? []);
      setFavoriteProductIds((productPayload.favoriteProductIds ?? []).map(String));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [scope?.businessRound, scope?.organization, equipmentRefreshVersion]);

  useEffect(() => {
    if (duplicateFileReconcileRef.current || !quotes.some((quote) => quote.canPurge)) return;
    duplicateFileReconcileRef.current = true;
    void fetch("/api/quotations/reconcile", { method: "POST" })
      .then(async (response) => {
        const payload = await response.json() as { archived?: number; error?: string };
        if (!response.ok) throw new Error(payload.error || "중복 견적 파일을 확인하지 못했습니다.");
        if (payload.archived) setMessage(`Google Drive의 중복 견적 파일 ${payload.archived.toLocaleString()}개를 보관함으로 이동했습니다.`);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "중복 견적 파일을 확인하지 못했습니다."));
  }, [quotes]);

  useEffect(() => {
    if (draftRef.current) closeEditor();
    setQuery("");
    setMessage("");
    setLoadedInstitutionKey("");
  }, [scope?.businessRound, scope?.organization]);

  useEffect(() => {
    const openComposer = () => {
      if (window.sessionStorage.getItem("whizzup.openQuotationComposer") !== "1") return;
      window.sessionStorage.removeItem("whizzup.openQuotationComposer");
      startQuotation();
    };
    openComposer();
    window.addEventListener("whizzup:open-quotation-composer", openComposer);
    return () => window.removeEventListener("whizzup:open-quotation-composer", openComposer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentQuotes = useMemo(() => {
    const latest = new Map<number, AuthoredQuotation>();
    quotes.forEach((quote) => {
      const rootId = quote.revisionRootId || quote.id;
      const current = latest.get(rootId);
      if (!current || quote.revisionNumber > current.revisionNumber || (quote.revisionNumber === current.revisionNumber && quote.id > current.id)) {
        latest.set(rootId, quote);
      }
    });
    return Array.from(latest.values()).sort((left, right) => right.quoteDate.localeCompare(left.quoteDate) || right.id - left.id);
  }, [quotes]);

  function displayedBudgetsForQuote(quote: AuthoredQuotation) {
    if (quote.budgets.length) return quote.budgets;
    const exact = institutions.find((item) => normalizedInstitutionName(item.organization) === normalizedInstitutionName(quote.organization) && item.businessRound === quote.businessRound);
    const options = budgetOptionsForInstitution(exact);
    return options.length === 1 ? [{ ...options[0], allocatedAmount: quote.totalAmount }] : [];
  }

  const filteredQuotes = useMemo(() => {
    const key = query.trim().toLocaleLowerCase("ko-KR");
    return key
      ? currentQuotes.filter((quote) => `${quote.organization} ${quote.projectTitle} ${quote.quoteNumber} ${displayedBudgetsForQuote(quote).map((budget) => budget.name).join(" ")}`.toLocaleLowerCase("ko-KR").includes(key))
      : currentQuotes;
  // displayedBudgetsForQuote intentionally derives from the current institution records.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuotes, institutions, query]);

  const quotationPageCount = Math.max(1, Math.ceil(filteredQuotes.length / QUOTATION_PAGE_SIZE));
  const pagedQuotes = useMemo(() => {
    const offset = (quotationPage - 1) * QUOTATION_PAGE_SIZE;
    return filteredQuotes.slice(offset, offset + QUOTATION_PAGE_SIZE);
  }, [filteredQuotes, quotationPage]);

  useEffect(() => { setQuotationPage(1); }, [query, scope?.businessRound, scope?.organization]);
  useEffect(() => { setQuotationPage((current) => Math.min(current, quotationPageCount)); }, [quotationPageCount]);
  useEffect(() => {
    onCountChange?.({ active: currentQuotes.length, trash: trashedQuotes.length });
  }, [currentQuotes.length, onCountChange, trashedQuotes.length]);

  const filteredProducts = useMemo(() => {
    const key = productQuery.trim().toLocaleLowerCase("ko-KR").replace(/\s/g, "");
    const favorites = new Set(favoriteProductIds);
    return products.filter((product) => {
      if (productListMode === "favorites" && !favorites.has(product.id)) return false;
      return !key || `${product.name}${product.specification}${product.note}`.toLocaleLowerCase("ko-KR").replace(/\s/g, "").includes(key);
    }).slice(0, 80);
  }, [favoriteProductIds, productListMode, productQuery, products]);

  const favoriteProductsOnly = productListMode === "favorites";

  function toggleProductList(mode: "all" | "favorites") {
    const closing = productListMode === mode;
    setProductListMode(closing ? null : mode);
    setProductResultsOpen(!closing);
    if (closing) setProductQuery("");
  }

  const institutionRounds = useMemo(
    () => Array.from(
      new Map(
        institutions
          .filter((item) => normalizedInstitutionName(item.organization) === normalizedInstitutionName(draft?.organization ?? ""))
          .sort((left, right) => left.businessRound - right.businessRound)
          .map((item) => [item.businessRound, item]),
      ).values(),
    ),
    [draft?.organization, institutions],
  );

  const availableBudgets = useMemo(() => {
    const exact = institutionRounds.find((item) => item.businessRound === draft?.businessRound);
    return budgetOptionsForInstitution(exact);
  }, [draft?.businessRound, institutionRounds]);

  useEffect(() => {
    if (availableBudgets.length !== 1) return;
    setDraft((current) => current && current.budgets.length === 0
      ? { ...current, budgets: availableBudgets }
      : current);
  }, [availableBudgets]);

  const institutionOptions = useMemo(() => {
    const options = new Map<string, QuotationInstitutionOption>();
    institutions.forEach((item) => {
      const key = normalizedInstitutionName(item.organization);
      const current = options.get(key);
      if (!current || item.businessRound > current.businessRound) options.set(key, item);
    });
    return Array.from(options.values()).sort((left, right) => left.organization.localeCompare(right.organization, "ko-KR"));
  }, [institutions]);

  const nextInstitutionRound = Math.max(0, ...institutionRounds.map((item) => item.businessRound)) + 1;

  const editingTargetLabel = draft?.id ? "현재 견적" : "";

  const numbers = useMemo(() => {
    if (!draft) return { subtotal: 0, adjusted: 0, supply: 0, tax: 0, procurementFee: 0, total: 0, earning: 0, consortium: 0, projectorInstallationCost: 0, yogaMatServiceCost: 0, itemInternalCost: 0, additionalConstructionCost: 0, internalCost: 0, margin: 0, marginRate: 0 };
    const subtotal = draft.items.reduce((sum, item) => sum + Math.max(0, item.quantity) * Math.max(0, item.unitPrice), 0);
    const adjusted = Math.max(0, subtotal - Math.max(0, draft.discountAmount) + Math.max(0, draft.extraAmount));
    const supply = Math.round(adjusted / 1.1);
    const tax = adjusted - supply;
    const procurementFee = draft.items.reduce((sum, item) => sum + (appliesProcurementFee(item) ? Math.floor(item.quantity * item.unitPrice * item.procurementFeeRate / 10) * 10 : 0), 0);
    const earning = draft.items.reduce((sum, item) => sum + Math.floor(item.quantity * item.unitPrice * item.earningRate / 10) * 10, 0);
    const consortium = draft.executionType === "컨소" ? draft.items.reduce((sum, item) => {
      const lineAmount = item.quantity * item.unitPrice;
      const lineEarning = Math.floor(lineAmount * item.earningRate / 10) * 10;
      return sum + Math.min(lineEarning, Math.floor(lineAmount * item.consortiumRate / 10) * 10);
    }, 0) : 0;
    const projectorInstallationCost = draft.items.reduce((sum, item) => sum + (
      quotationInternalCostKind(item.name, item.specification) === "projector-installation" && item.internalCostEnabled
        ? Math.max(0, item.internalCostAmount)
        : 0
    ), 0);
    const yogaMatServiceCost = draft.items.reduce((sum, item) => sum + (
      quotationInternalCostKind(item.name, item.specification) === "aifit-yoga-mat" && item.internalCostEnabled
        ? Math.max(0, item.internalCostAmount)
        : 0
    ), 0);
    const itemInternalCost = draft.items.reduce((sum, item) => sum + (item.internalCostEnabled ? Math.max(0, item.internalCostAmount) : 0), 0);
    const additionalConstructionCost = Math.max(0, draft.additionalInternalConstructionCost);
    const internalCost = itemInternalCost + additionalConstructionCost;
    const margin = Math.max(0, earning - consortium - internalCost);
    return { subtotal, adjusted, supply, tax, procurementFee, total: adjusted + procurementFee, earning, consortium, projectorInstallationCost, yogaMatServiceCost, itemInternalCost, additionalConstructionCost, internalCost, margin, marginRate: subtotal ? margin / subtotal : 0 };
  }, [draft]);

  const internalReportRows = useMemo(() => (draft?.items ?? []).map((item, index) => {
    const lineAmount = Math.max(0, item.quantity) * Math.max(0, item.unitPrice);
    const earning = Math.floor(lineAmount * Math.max(0, item.earningRate) / 10) * 10;
    const consortium = draft?.executionType === "컨소"
      ? Math.min(earning, Math.floor(lineAmount * Math.max(0, item.consortiumRate) / 10) * 10)
      : 0;
    const internalCost = item.internalCostEnabled ? Math.max(0, item.internalCostAmount) : 0;
    return {
      number: index + 1,
      name: item.name || "미등록 품목",
      amount: lineAmount,
      earning,
      consortium,
      internalCost,
      netProfit: Math.max(0, earning - consortium - internalCost),
    };
  }), [draft]);

  function internalProfitReportText() {
    if (!draft) return "";
    return [
      `[위즈업 내부 수익 보고] ${draft.organization || "기관 미지정"} · ${draft.projectTitle || `${draft.businessRound}차 사업`}`,
      `견적번호: ${draft.quoteNumber || "저장 전"}`,
      `견적금액: ${won.format(numbers.total)}원`,
      `협업 구분: ${draft.executionType}${draft.executionType === "컨소" && draft.consortiumCompany ? ` · ${draft.consortiumCompany}` : ""}`,
      `예상 수익: ${won.format(numbers.earning)}원`,
      `컨소 지급: -${won.format(numbers.consortium)}원`,
      `내부 원가: -${won.format(numbers.internalCost)}원`,
      `최종 총이익: ${won.format(numbers.margin)}원 (${(numbers.marginRate * 100).toFixed(1)}%)`,
    ].join("\n");
  }

  async function copyInternalProfitReport() {
    const text = internalProfitReportText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setMessage("내부 수익 보고 내용을 복사했습니다.");
  }

  function downloadInternalProfitCsv() {
    if (!draft) return;
    const rows = [
      ["기관", draft.organization],
      ["사업·견적명", draft.projectTitle],
      ["견적번호", draft.quoteNumber || "저장 전"],
      ["견적금액", numbers.total],
      ["협업 구분", draft.executionType],
      ["컨소 업체", draft.consortiumCompany],
      [],
      ["No", "품목", "견적금액", "예상 수익", "컨소 지급", "내부 원가", "품목 순이익"],
      ...internalReportRows.map((row) => [row.number, row.name, row.amount, row.earning, row.consortium, row.internalCost, row.netProfit]),
      [],
      ["최종 총이익", numbers.margin],
      ["마진율", `${(numbers.marginRate * 100).toFixed(1)}%`],
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(draft.organization)}_${draft.quoteNumber || "견적"}_내부수익표.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function printInternalProfitReport() {
    if (!draft) return;
    const popup = window.open("", "_blank");
    if (!popup) {
      setMessage("내부 수익표 인쇄 창이 차단되었습니다. 브라우저 팝업을 허용해 주세요.");
      return;
    }
    popup.opener = null;
    const rows = internalReportRows.map((row) => `<tr><td>${row.number}</td><td>${escapeHtml(row.name)}</td><td>${won.format(row.amount)}원</td><td>${won.format(row.earning)}원</td><td>-${won.format(row.consortium)}원</td><td>-${won.format(row.internalCost)}원</td><td>${won.format(row.netProfit)}원</td></tr>`).join("");
    popup.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>내부 수익표</title><style>body{font-family:Arial,'Noto Sans KR',sans-serif;margin:32px;color:#17233d}h1{font-size:24px;margin:0 0 8px}p{margin:4px 0 20px;color:#52617a}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px;border:1px solid #cfd8ea;text-align:right}th:nth-child(2),td:nth-child(2){text-align:left}section{margin-top:18px;padding:16px;background:#f4f7ff;border-radius:10px}section b{font-size:20px;color:#244eea}@media print{body{margin:12mm}}</style></head><body><h1>내부 수익표</h1><p>${escapeHtml(draft.organization)} · ${escapeHtml(draft.projectTitle)} · ${escapeHtml(draft.quoteNumber || "저장 전")}</p><table><thead><tr><th>No</th><th>품목</th><th>견적금액</th><th>예상 수익</th><th>컨소 지급</th><th>내부 원가</th><th>품목 순이익</th></tr></thead><tbody>${rows}</tbody></table><section>견적금액 ${won.format(numbers.total)}원 · 최종 총이익 <b>${won.format(numbers.margin)}원</b> · 마진율 ${(numbers.marginRate * 100).toFixed(1)}%</section><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  }

  const effectiveBudgets = useMemo(() => {
    if (!draft?.budgets.length) return [];
    if (draft.budgets.length === 1) {
      return [{ ...draft.budgets[0], allocatedAmount: numbers.total }];
    }
    const enteredTotal = draft.budgets.reduce((sum, budget) => sum + Math.max(0, budget.allocatedAmount), 0);
    if (enteredTotal > 0 || numbers.total <= 0) return draft.budgets;
    const institutionTotal = draft.budgets.reduce((sum, budget) => sum + Math.max(0, budget.institutionAmount), 0);
    let allocated = 0;
    return draft.budgets.map((budget, index) => {
      const allocatedAmount = index === draft.budgets.length - 1
        ? Math.max(0, numbers.total - allocated)
        : institutionTotal > 0
          ? Math.round(numbers.total * Math.max(0, budget.institutionAmount) / institutionTotal)
          : Math.floor(numbers.total / draft.budgets.length);
      allocated += allocatedAmount;
      return { ...budget, allocatedAmount };
    });
  }, [draft?.budgets, numbers.total]);

  const budgetAllocationTotal = effectiveBudgets.reduce((sum, budget) => sum + budget.allocatedAmount, 0);

  function toggleBudget(option: AuthoredQuotationBudget) {
    if (!draft) return;
    const selected = draft.budgets.some((budget) => budget.key === option.key);
    setDraft({
      ...draft,
      budgets: selected
        ? draft.budgets.filter((budget) => budget.key !== option.key)
        : [...draft.budgets, option],
    });
  }

  function updateBudgetAllocation(key: string, allocatedAmount: number) {
    if (!draft) return;
    setDraft({
      ...draft,
      budgets: draft.budgets.map((budget) => budget.key === key
        ? { ...budget, allocatedAmount: Math.max(0, Math.round(allocatedAmount)) }
        : budget),
    });
  }

  const printItemPages = useMemo(() => {
    if (!draft) return [] as (DraftItem | null)[][];
    const rows: (DraftItem | null)[] = [...draft.items, ...Array.from({ length: outputBlankRows }, () => null)];
    const pages: (DraftItem | null)[][] = [];
    for (let index = 0; index < rows.length; index += 6) pages.push(rows.slice(index, index + 6));
    return pages.length ? pages : [[]];
  }, [draft, outputBlankRows]);

  const equipmentKitPrintPages = useMemo(() => {
    if (!draft) return [] as Array<{ item: DraftItem; lines: NonNullable<DraftItem["equipmentKit"]>["lines"]; page: number; pages: number }>;
    return draft.items.flatMap((item) => {
      const lines = airpassEquipmentKitOutputLines(item.equipmentKit);
      if (!lines.length) return [];
      const chunks = Array.from({ length: Math.ceil(lines.length / 15) }, (_, index) => lines.slice(index * 15, (index + 1) * 15));
      return chunks.map((chunk, index) => ({ item, lines: chunk, page: index + 1, pages: chunks.length }));
    });
  }, [draft]);

  function openQuotation(quote: AuthoredQuotation) {
    setProductQuery("");
    setProductListMode(null);
    setOutputBlankRows(0);
    setLoadedInstitutionKey("");
    beginEditor(draftFromQuotation(quote));
    setInstitutionQuery(quote.organization);
    setMessage(
      quote.status === "final"
        ? `${quote.quoteNumber} 견적을 직접 수정합니다. 저장하면 같은 견적번호의 PDF·Excel도 새 내용으로 교체됩니다.`
        : "",
    );
  }

  async function loadInstitutionItems(
    targetDraft: Draft,
    options: { confirmReplace?: boolean; force?: boolean } = {},
  ) {
    const organization = targetDraft.organization.trim();
    const businessRound = Math.max(1, targetDraft.businessRound);
    if (!organization || equipmentLoading) return false;
    const targetKey = `${normalizedInstitutionName(organization)}:${businessRound}`;
    if (!options.force && loadedInstitutionKey === targetKey && draft?.items.length) {
      setMessage(`${organization} ${businessRound}차 품목은 이미 불러온 상태입니다.`);
      return true;
    }
    if (
      options.confirmReplace !== false
      && draft?.items.length
      && loadedInstitutionKey !== targetKey
      && !window.confirm("현재 작성한 품목을 선택한 기관·차수의 기존 품목으로 교체할까요?")
    ) {
      return false;
    }
    setEquipmentLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/equipment?organization=${encodeURIComponent(organization)}&businessRound=${businessRound}`,
        { cache: "no-store" },
      );
      const payload = await response.json() as {
        projects?: Record<string, unknown>[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "기관 상세 품목을 불러오지 못했습니다.");
      }
      const projects: EquipmentQuoteProject[] = (payload.projects ?? []).map((project) => {
        const value = (camel: string, snake: string) => project[camel] ?? project[snake] ?? "";
        const rawItems = Array.isArray(project.items) ? project.items : [];
        return {
          id: Number(project.id),
          name: String(project.name ?? ""),
          budgetType: String(value("budgetType", "budget_type")),
          constructionAmount: Math.max(0, Number(value("constructionAmount", "construction_amount")) || 0),
          actualConstructionCost: Math.max(0, Number(value("actualConstructionCost", "actual_construction_cost")) || 0),
          items: rawItems.flatMap((rawItem) => {
            if (!rawItem || typeof rawItem !== "object") return [];
            const item = rawItem as Record<string, unknown>;
            const itemValue = (camel: string, snake: string) => item[camel] ?? item[snake] ?? "";
            const productName = String(itemValue("productName", "product_name")).trim();
            if (!productName) return [];
            const proposedQty = Number(itemValue("proposedQty", "proposed_qty")) || 0;
            const awardedQty = Number(itemValue("awardedQty", "awarded_qty")) || 0;
            const installedQty = Number(itemValue("installedQty", "installed_qty")) || 0;
            const supplyType = itemValue("supplyType", "supply_type") === "direct" ? "direct" as const : "partner" as const;
            const earningRateValue = supplyType === "direct"
              ? itemValue("marginRate", "margin_rate")
              : itemValue("commissionRate", "commission_rate");
            const specification = String(item.specification ?? "");
            const catalogNote = String(itemValue("catalogNote", "catalog_note"));
            const notes = String(item.notes ?? "");
            const explicitProcurementNumber = String(itemValue("procurementNumber", "procurement_number")).trim();
            const procurementNumber = explicitProcurementNumber
              || procurementNumbersFromText(catalogNote, specification, notes)[0]
              || "";
            const explicitProcurementChannel = String(itemValue("procurementChannel", "procurement_channel")).trim();
            const procurementFeeRate = Math.min(1, Math.max(0, Number(itemValue("procurementFeeRate", "procurement_fee_rate")) || 0));
            const procurement = Boolean(procurementNumber || procurementFeeRate || hasProcurementSignal(catalogNote, specification, notes));
            const procurementChannel = procurement ? explicitProcurementChannel || procurementChannelFromText(catalogNote, specification, notes) : "";
            return [{
              id: Number(item.id),
              catalogItemId: String(itemValue("catalogItemId", "catalog_item_id")),
              productName,
              specification,
              quantity: Math.max(1, awardedQty || proposedQty || installedQty || 1),
              unit: String(item.unit ?? "").trim() || "대",
              unitPrice: Math.max(0, Number(itemValue("catalogUnitPrice", "catalog_unit_price")) || 0),
              note: catalogNote || notes,
              supplyType,
              earningRate: Math.min(1, Math.max(0, Number(earningRateValue) || 0)),
              procurement,
              procurementChannel,
              procurementNumber: procurement ? procurementNumber : "",
              procurementFeeRate: procurement && !isS2BChannel(procurementChannel) ? procurementFeeRate || 0.0054 : 0,
            }];
          }),
        };
      });
      const itemMap = new Map<string, DraftItem>();
      projects.forEach((project) => project.items.forEach((item) => {
        const fallbackKey = `${item.productName}|${item.specification}`.replace(/\s/g, "").toLocaleLowerCase("ko-KR");
        const itemKey = item.catalogItemId ? `catalog:${item.catalogItemId}` : `manual:${fallbackKey}`;
        const existing = itemMap.get(itemKey);
        if (existing) {
          itemMap.set(itemKey, { ...existing, quantity: existing.quantity + item.quantity });
          return;
        }
        itemMap.set(itemKey, {
          id: crypto.randomUUID(),
          productId: item.catalogItemId,
          name: item.productName,
          specification: item.specification,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          note: item.note,
          supplyType: item.supplyType,
          earningRate: item.earningRate,
          contractType: isS2BChannel(item.procurementChannel) ? "s2b" : item.procurement ? "g2b" : "direct",
          procurement: item.procurement,
          procurementChannel: item.procurementChannel,
          procurementNumber: item.procurementNumber,
          procurementFeeRate: item.procurementFeeRate,
          consortiumRate: 0,
          ...internalCostFields(item.productName, item.specification),
        });
      }));
      const institutionMatch = institutions.find((item) =>
        normalizedInstitutionName(item.organization) === normalizedInstitutionName(organization)
        && item.businessRound === businessRound,
      );
      const projectTitle = institutionMatch?.budgetType
        || projects.find((project) => project.budgetType)?.budgetType
        || projects.find((project) => project.name)?.name
        || targetDraft.projectTitle;
      const equipmentItems = Array.from(itemMap.values());
      const constructionAmount = projects.reduce((sum, project) => sum + project.constructionAmount, 0);
      const items = constructionAmount > 0
        ? [...equipmentItems, constructionDraftItem(constructionAmount, projectTitle)]
        : equipmentItems;
      if (!items.length) {
        setProductQuery("");
        setDraft({ ...targetDraft, organization, businessRound, projectTitle, items: [] });
        setLoadedInstitutionKey(targetKey);
        setMessage(`${organization} ${businessRound}차에는 등록된 품목이 없습니다.`);
        return true;
      }
      setProductQuery("");
      setDraft({ ...targetDraft, organization, businessRound, projectTitle, items });
      setLoadedInstitutionKey(targetKey);
      setMessage(`${organization} ${businessRound}차 품목 ${equipmentItems.length}개${constructionAmount > 0 ? `와 공사비 ${won.format(constructionAmount)}원` : ""}를 불러왔습니다.`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기관 상세 품목을 불러오지 못했습니다.");
      return false;
    } finally {
      setEquipmentLoading(false);
    }
  }

  async function startFromInstitutionItems() {
    if (!scope?.organization) return;
    const target = draft ?? draftForScope(scope);
    if (!draft) beginEditor(target);
    await loadInstitutionItems(target, { force: true });
  }

  async function selectInstitution(option: QuotationInstitutionOption) {
    if (!draft) return;
    const rounds = institutions.filter((item) => normalizedInstitutionName(item.organization) === normalizedInstitutionName(option.organization));
    const selectedRound = rounds.reduce((latest, item) => item.businessRound > latest.businessRound ? item : latest, option);
      const targetDraft = {
      ...draft,
      organization: selectedRound.organization,
      businessRound: selectedRound.businessRound,
      projectTitle: selectedRound.budgetType || draft.projectTitle,
      budgets: budgetOptionsForInstitution(selectedRound).length === 1 ? budgetOptionsForInstitution(selectedRound) : [],
    };
    if (await loadInstitutionItems(targetDraft)) setInstitutionQuery(selectedRound.organization);
  }

  async function selectBusinessRound(businessRound: number) {
    if (!draft) return;
    const match = institutionRounds.find((item) => item.businessRound === businessRound);
    if (!match) {
      if (draft.items.length && !window.confirm("현재 작성한 품목을 비우고 새 사업 차수의 견적을 만들까요?")) return;
      setDraft({ ...draft, businessRound, projectTitle: "", items: [], budgets: [] });
      setLoadedInstitutionKey("");
      setMessage(`${draft.organization} ${businessRound}차 새 견적을 시작합니다.`);
      return;
    }
    await loadInstitutionItems({
      ...draft,
      organization: match.organization,
      businessRound,
      projectTitle: match.budgetType || draft.projectTitle,
      budgets: budgetOptionsForInstitution(match).length === 1 ? budgetOptionsForInstitution(match) : [],
    });
  }

  useEffect(() => {
    if (loading) return;
    const raw = window.sessionStorage.getItem("whizzup.quotationTarget");
    if (!raw) return;
    window.sessionStorage.removeItem("whizzup.quotationTarget");
    try {
      const target = JSON.parse(raw) as { id?: number; mode?: string; scope?: QuotationScope };
      if (target.id) {
        const quote = quotes.find((item) => item.id === Number(target.id));
        if (quote) openQuotation(quote);
        return;
      }
      if (target.scope?.organization) {
        setProductQuery("");
        beginEditor(draftForScope(target.scope));
      }
    } catch { /* 잘못된 임시 이동 정보는 무시합니다. */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, quotes]);

  function updateItem(id: string, changes: Partial<DraftItem>) {
    if (!draft) return;
    setDraft({ ...draft, items: draft.items.map((item) => item.id === id ? { ...item, ...changes } : item) });
  }

  function reorderItem(sourceId: string, targetId: string) {
    if (!sourceId || sourceId === targetId) return;
    setDraft((current) => {
      if (!current) return current;
      const regularItems = current.items.filter((item) => !isConstructionItem(item));
      const sourceIndex = regularItems.findIndex((item) => item.id === sourceId);
      const targetIndex = regularItems.findIndex((item) => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const nextItems = [...regularItems];
      const [moved] = nextItems.splice(sourceIndex, 1);
      nextItems.splice(targetIndex, 0, moved);
      return {
        ...current,
        items: [...nextItems, ...current.items.filter(isConstructionItem)],
      };
    });
  }

  function moveItem(id: string, direction: -1 | 1) {
    if (!draft) return;
    const regularItems = draft.items.filter((item) => !isConstructionItem(item));
    const currentIndex = regularItems.findIndex((item) => item.id === id);
    const target = regularItems[currentIndex + direction];
    if (target) reorderItem(id, target.id);
  }

  function setItemContractType(id: string, type: "direct" | "g2b" | "s2b") {
    const item = draft?.items.find((line) => line.id === id);
    if (!item) return;
    if (type === "direct") {
      updateItem(id, { contractType: "direct", procurement: false, procurementChannel: "", procurementNumber: "", procurementFeeRate: 0 });
      return;
    }
    updateItem(id, {
      contractType: type,
      procurement: true,
      procurementChannel: type === "s2b" ? "S2B" : "G2B",
      procurementFeeRate: type === "g2b" ? item.procurementFeeRate || 0.0054 : 0,
    });
  }

  function setConstructionIncluded(included: boolean) {
    if (!draft) return;
    const regularItems = draft.items.filter((item) => !isConstructionItem(item));
    const existing = draft.items.find(isConstructionItem);
    setDraft({
      ...draft,
      items: included
        ? [...regularItems, existing ?? constructionDraftItem(0, draft.projectTitle)]
        : regularItems,
    });
  }

  function addProduct(product: ProductCatalogItem) {
    if (!draft) return;
    setProductResultsOpen(true);
    const existing = draft.items.find((item) => item.productId === product.id);
    if (existing) {
      if (existing.equipmentKit || isAirpassEquipmentKitProduct(existing.name)) {
        void openEquipmentKitEditor(existing);
        return;
      }
      updateItem(existing.id, { quantity: existing.quantity + 1 });
      return;
    }
    const earningRate = product.supplyType === "direct" ? product.marginRate ?? 0 : product.commissionRate ?? 0;
    const procurement = product.procurement === true || hasProcurementSignal(product.note, product.specification);
    const procurementChannel = procurement ? product.procurementChannel || (/S\s*2\s*B/iu.test(product.note) ? "S2B" : /디지털서비스몰/iu.test(product.note) ? "디지털서비스몰" : /혁신장터/iu.test(product.note) ? "혁신장터" : "G2B") : "";
    const nextItem: DraftItem = {
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
        contractType: isS2BChannel(procurementChannel) ? "s2b" : procurement ? "g2b" : "direct",
        procurement,
        procurementChannel,
        procurementNumber: procurement ? product.procurementNumber || procurementNumbersFromText(product.note, product.specification)[0] || "" : "",
        procurementFeeRate: procurement && !isS2BChannel(procurementChannel) ? product.procurementFeeRate ?? 0.0054 : 0,
        consortiumRate: 0,
        ...internalCostFields(product.name, product.specification),
      };
    if (isAirpassEquipmentKitProduct(product.name)) {
      const equipmentKit = createAirpassEquipmentKit("one");
      setEquipmentKitEditor({
        item: {
          ...nextItem,
          quantity: 1,
          unit: "SET",
          unitPrice: airpassEquipmentKitTotal(equipmentKit),
          specification: "가상현실스포츠실 운영 물품 · 별첨 교구 세부견적",
          note: "",
          equipmentKit,
        },
      });
      setEquipmentKitHideZero(false);
      return;
    }
    const construction = draft.items.find(isConstructionItem);
    setDraft({
      ...draft,
      items: [...draft.items.filter((item) => !isConstructionItem(item)), nextItem, ...(construction ? [construction] : [])],
    });
  }

  async function openEquipmentKitEditor(item: DraftItem) {
    let equipmentKit = item.equipmentKit
      ? { ...item.equipmentKit, lines: item.equipmentKit.lines.map((line) => ({ ...line })) }
      : undefined;
    const savedQuoteId = draft?.id;
    const savedQuote = savedQuoteId ? quotes.find((quote) => quote.id === savedQuoteId) : undefined;
    if (!equipmentKit && savedQuote) {
      if (!savedQuote.excelUrl) {
        setMessage("이 견적에는 저장된 교구 세부내역과 Excel 파일이 없어 자동 복구할 수 없습니다. 교구 견적서 불러오기로 원본을 선택해 주세요.");
        return;
      }
      if (equipmentKitRecoveryId) return;
      setEquipmentKitRecoveryId(item.id);
      setMessage("저장된 Excel에서 교구 세부견적을 복구하고 있습니다…");
      try {
        const response = await fetch(savedQuote.excelUrl, { cache: "no-store" });
        if (!response.ok) throw new Error("저장된 Excel 파일을 불러오지 못했습니다.");
        const blob = await response.blob();
        const file = new File([blob], savedQuote.driveXlsxName || `${savedQuote.quoteNumber}.xlsx`, {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const parsed = await parseQuotationXlsxData(file, {
          mode: "teaching-aids",
          requireEquipmentKitSheet: true,
        });
        const plan = parsed.equipmentKitPlan ?? "one";
        const standard = createAirpassEquipmentKit(plan);
        const recoveredKeys = new Set(parsed.items.map((line) => normalizedEquipmentKitName(line.productName)));
        equipmentKit = {
          kind: "airpass-equipment",
          plan,
          lines: [
            ...parsed.items.map((line, index) => {
              const standardLine = standard.lines.find((candidate) => normalizedEquipmentKitName(candidate.name) === normalizedEquipmentKitName(line.productName));
              return {
                id: standardLine?.id ?? `recovered-${index + 1}-${crypto.randomUUID()}`,
                name: line.productName,
                quantity: Math.max(0, Math.round(line.quantity)),
                unit: line.unit || "EA",
                unitPrice: Math.max(0, Math.round(line.unitPrice)),
                ...(!standardLine ? { custom: true as const } : {}),
              };
            }),
            ...standard.lines.filter((line) => !recoveredKeys.has(normalizedEquipmentKitName(line.name))).map((line) => ({ ...line, quantity: 0 })),
          ],
        };
        setMessage(`저장된 Excel의 ${parsed.sheetName || "교구 세부견적"} 시트에서 ${parsed.items.filter((line) => line.quantity > 0).length}개 품목을 복구했습니다. 확인 후 ‘이 구성으로 견적에 적용’을 눌러 주세요.`);
      } catch (error) {
        setMessage(error instanceof Error
          ? `${error.message} 기본 구성으로 초기화하지 않았습니다. 교구 견적서 불러오기로 원본을 선택해 주세요.`
          : "교구 세부견적을 복구하지 못했습니다. 기본 구성으로 초기화하지 않았습니다.");
        return;
      } finally {
        setEquipmentKitRecoveryId("");
      }
    }
    equipmentKit ??= createAirpassEquipmentKit("one");
    setEquipmentKitEditor({
      item: {
        ...item,
        quantity: 1,
        unit: "SET",
        unitPrice: airpassEquipmentKitTotal(equipmentKit),
        specification: item.specification || "가상현실스포츠실 운영 물품 · 별첨 교구 세부견적",
        equipmentKit,
      },
      editingItemId: item.id,
    });
    setEquipmentKitHideZero(false);
  }

  function updateEquipmentKitLine(id: string, changes: Partial<NonNullable<DraftItem["equipmentKit"]>["lines"][number]>) {
    if (!equipmentKitEditor?.item.equipmentKit) return;
    const equipmentKit = {
      ...equipmentKitEditor.item.equipmentKit,
      lines: equipmentKitEditor.item.equipmentKit.lines.map((line) => line.id === id ? { ...line, ...changes } : line),
    };
    setEquipmentKitEditor({
      ...equipmentKitEditor,
      item: { ...equipmentKitEditor.item, unitPrice: airpassEquipmentKitTotal(equipmentKit), equipmentKit },
    });
  }

  function selectEquipmentKitPlan(plan: "one" | "two") {
    if (!equipmentKitEditor?.item.equipmentKit) return;
    const customLines = equipmentKitEditor.item.equipmentKit.lines.filter((line) => line.custom);
    const equipmentKit = createAirpassEquipmentKit(plan);
    equipmentKit.lines.push(...customLines.map((line) => ({ ...line })));
    setEquipmentKitEditor({
      ...equipmentKitEditor,
      item: { ...equipmentKitEditor.item, unitPrice: airpassEquipmentKitTotal(equipmentKit), equipmentKit },
    });
  }

  function addEquipmentKitLine() {
    if (!equipmentKitEditor?.item.equipmentKit) return;
    const line = { id: crypto.randomUUID(), name: "", quantity: 1, unit: "EA", unitPrice: 0, custom: true as const };
    const equipmentKit = { ...equipmentKitEditor.item.equipmentKit, lines: [...equipmentKitEditor.item.equipmentKit.lines, line] };
    setEquipmentKitEditor({
      ...equipmentKitEditor,
      item: { ...equipmentKitEditor.item, equipmentKit },
    });
  }

  function applyEquipmentKit() {
    if (!draft || !equipmentKitEditor?.item.equipmentKit) return;
    const invalid = equipmentKitEditor.item.equipmentKit.lines.some((line) => line.custom && !line.name.trim());
    if (invalid) {
      setMessage("추가한 교구 품목명을 입력해 주세요.");
      return;
    }
    const item = {
      ...equipmentKitEditor.item,
      quantity: 1,
      unit: "SET",
      unitPrice: airpassEquipmentKitTotal(equipmentKitEditor.item.equipmentKit),
      specification: "가상현실스포츠실 운영 물품 · 별첨 교구 세부견적",
      note: "",
    };
    const construction = draft.items.find(isConstructionItem);
    const regularItems = equipmentKitEditor.editingItemId
      ? draft.items.filter((line) => !isConstructionItem(line)).map((line) => line.id === equipmentKitEditor.editingItemId ? item : line)
      : [...draft.items.filter((line) => !isConstructionItem(line)), item];
    setDraft({ ...draft, items: [...regularItems, ...(construction ? [construction] : [])] });
    setEquipmentKitEditor(null);
    setEquipmentKitHideZero(false);
  }

  function addBlankItem() {
    if (!draft) return;
    const construction = draft.items.find(isConstructionItem);
    setDraft({
      ...draft,
      items: [...draft.items.filter((item) => !isConstructionItem(item)), {
        id: crypto.randomUUID(), productId: "", name: "", specification: "", quantity: 1,
        unit: "EA", unitPrice: 0, note: "", supplyType: "direct", earningRate: 0, contractType: "direct",
        procurement: false, procurementChannel: "", procurementNumber: "", procurementFeeRate: 0, consortiumRate: 0,
        internalCostEnabled: false, internalCostAmount: 0,
      }, ...(construction ? [construction] : [])],
    });
  }

  async function syncConstructionCost(targetDraft: Draft) {
    if (!canSyncDirectEquipment) return;
    const construction = targetDraft.items.find(isConstructionItem);
    if (!construction || !targetDraft.organization.trim()) return;
    const response = await fetch(`/api/equipment?organization=${encodeURIComponent(targetDraft.organization.trim())}&businessRound=${Math.max(1, targetDraft.businessRound)}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { projects?: Record<string, unknown>[] };
    const projects = (payload.projects ?? []).map((project) => ({
      id: Number(project.id),
      constructionAmount: Math.max(0, Number(project.construction_amount ?? project.constructionAmount) || 0),
      actualConstructionCost: Math.max(0, Number(project.actual_construction_cost ?? project.actualConstructionCost) || 0),
    })).filter((project) => Number.isInteger(project.id) && project.id > 0);
    const currentAmount = projects.reduce((sum, project) => sum + project.constructionAmount, 0);
    const nextAmount = Math.max(0, Math.round(construction.unitPrice));
    if (!projects.length || currentAmount === nextAmount) return;
    if (!window.confirm(`견적 공사비 ${won.format(nextAmount)}원을 기관 상세 공사비에도 반영할까요?`)) return;
    const positiveProjects = projects.filter((project) => project.constructionAmount > 0);
    const target = positiveProjects.length === 1 ? positiveProjects[0] : projects.length === 1 ? projects[0] : null;
    if (!target) {
      window.alert("기관 상세의 여러 사업에 공사비가 나뉘어 있어 자동 변경하지 않았습니다. 견적서 공사비만 저장합니다.");
      return;
    }
    const updateResponse = await fetch("/api/equipment", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "project-costs", id: target.id, constructionAmount: nextAmount, actualConstructionCost: target.actualConstructionCost }),
    });
    if (!updateResponse.ok) {
      const updatePayload = await updateResponse.json() as { error?: string };
      throw new Error(updatePayload.error || "기관 상세 공사비를 변경하지 못했습니다.");
    }
  }

  function applyExternalQuotation(result: ExternalQuotationImportResult) {
    if (!draft) return;
    if (result.mode === "teaching-aids" && equipmentKitEditor?.item.equipmentKit) {
      // 교구 견적서 불러오기는 현재 구성에 더하는 동작이 아니라 파일의
      // 수량으로 전체 구성을 교체한다. 파일에 없는 기존 품목은 0개로 둔다.
      const lines = equipmentKitEditor.item.equipmentKit.lines.map((line) => ({
        ...line,
        quantity: 0,
      }));
      result.items.forEach((source) => {
        const imported = {
          id: crypto.randomUUID(),
          name: source.productName.trim() || source.specification.trim() || "교구 품목",
          quantity: Math.max(0, Math.round(source.quantity || 0)),
          unit: source.unit.trim() || "EA",
          unitPrice: Math.max(0, Math.round(source.unitPrice || 0)),
          custom: true as const,
        };
        // 교구 표의 행 번호가 아니라 품목 문구를 정규화해 표준 구성과 연결한다.
        const existingIndex = lines.findIndex((line) => normalizedEquipmentKitName(line.name) === normalizedEquipmentKitName(imported.name));
        if (existingIndex < 0) {
          lines.push(imported);
        } else {
          lines[existingIndex] = {
            ...lines[existingIndex],
            quantity: imported.quantity,
            unit: imported.unit,
            unitPrice: imported.unitPrice,
            id: lines[existingIndex].id,
            custom: lines[existingIndex].custom || undefined,
          };
        }
      });
      const equipmentKit = { ...equipmentKitEditor.item.equipmentKit, lines };
      setEquipmentKitEditor({
        ...equipmentKitEditor,
        item: { ...equipmentKitEditor.item, unitPrice: airpassEquipmentKitTotal(equipmentKit), equipmentKit },
      });
      setImportSourceFile(result.sourceFile);
      setImportMode(null);
      setMessage(`교구 견적서의 ${result.items.length}개 품목을 교구 세부견적에 불러왔습니다. 교구 창에서 확인한 뒤 견적에 적용해 주세요.`);
      return;
    }
    let nextItems = [...draft.items.filter((item) => !isConstructionItem(item))];
    const importedItems: DraftItem[] = result.items.map((item) => ({
      id: crypto.randomUUID(),
      productId: item.productId,
      name: item.productName.trim(),
      specification: item.specification.trim(),
      quantity: Math.max(1, Math.round(item.quantity || 1)),
      unit: item.unit.trim() || "개",
      unitPrice: Math.max(0, Math.round(item.unitPrice || 0)),
      note: item.procurement
        ? (isS2BChannel(item.procurementChannel) ? "학교장터" : "조달 계약")
        : "수의계약",
      supplyType: item.supplyType,
      earningRate: item.earningRate,
      contractType: item.procurement ? (isS2BChannel(item.procurementChannel) ? "s2b" : "g2b") : "direct",
      procurement: item.procurement,
      procurementChannel: item.procurement ? item.procurementChannel : "",
      procurementNumber: item.procurement ? item.procurementNumber : "",
      procurementFeeRate: item.procurement && !isS2BChannel(item.procurementChannel) ? item.procurementFeeRate : 0,
      consortiumRate: 0,
      ...internalCostFields(item.productName.trim(), item.specification.trim()),
    }));
    result.items.forEach((source, index) => {
      const imported = importedItems[index];
      const existingIndex = nextItems.findIndex((item) =>
        Boolean(source.productId && item.productId && source.productId === item.productId)
        || Boolean(source.procurementNumber.replace(/\D/g, "").length >= 6
          && source.procurementNumber.replace(/\D/g, "") === item.procurementNumber.replace(/\D/g, ""))
        || Boolean(normalizedInstitutionName(source.productName) === normalizedInstitutionName(item.name)
          && normalizedInstitutionName(source.specification) === normalizedInstitutionName(item.specification)),
      );
      if (existingIndex < 0 || source.duplicateAction === "keep") {
        nextItems.push(imported);
      } else if (source.duplicateAction === "merge") {
        nextItems[existingIndex] = { ...nextItems[existingIndex], quantity: nextItems[existingIndex].quantity + imported.quantity };
      } else if (source.duplicateAction === "replace") {
        nextItems[existingIndex] = imported;
      } else {
        nextItems.push(imported);
      }
    });
    const existingConstruction = draft.items.find(isConstructionItem);
    const construction = result.constructionAmount > 0
      ? constructionDraftItem(result.constructionAmount, draft.projectTitle)
      : existingConstruction;
    setDraft({
      ...draft,
      items: [...nextItems, ...(construction ? [construction] : [])],
      discountAmount: result.discountAmount,
      extraAmount: result.extraAmount,
    });
    setImportSourceFile(result.sourceFile);
    setImportMode(null);
    const target = editingTargetLabel || "현재 견적 초안";
    const sourceKind = result.mode === "teaching-aids" ? "교구 견적서" : "외부 견적서";
    const feeNotice = result.procurementFee > 0 ? ` 조달수수료 ${won.format(result.procurementFee)}원도 함께 반영했습니다.` : "";
    setMessage(`${sourceKind}의 ${result.items.length}개 품목을 ${target}에 불러왔습니다.${feeNotice} 기관 상세 데이터는 변경하지 않았습니다.`);
  }

  async function syncQuotationItems(targetQuote: AuthoredQuotation) {
    const items = targetQuote.items.filter((item) => !isConstructionItem(item));
    if (!canSyncDirectEquipment || !targetQuote.organization.trim() || !items.length) {
      return { added: 0, skipped: 0 };
    }
    const projectsResponse = await fetch(
      `/api/equipment?organization=${encodeURIComponent(targetQuote.organization.trim())}&businessRound=${Math.max(1, targetQuote.businessRound)}`,
      { cache: "no-store" },
    );
    const projectsPayload = await projectsResponse.json() as { projects?: Record<string, unknown>[]; error?: string };
    if (!projectsResponse.ok) {
      throw new Error(projectsPayload.error || "기관 품목 정보를 불러오지 못했습니다.");
    }
    const projects = projectsPayload.projects ?? [];
    const normalizedTitle = targetQuote.projectTitle.replace(/\s/g, "").toLocaleLowerCase("ko-KR");
    let project = projects.find((item) => {
      const name = String(item.name ?? "").replace(/\s/g, "").toLocaleLowerCase("ko-KR");
      const budgetType = String(item.budget_type ?? item.budgetType ?? "").replace(/\s/g, "").toLocaleLowerCase("ko-KR");
      return Boolean(normalizedTitle) && (name === normalizedTitle || budgetType === normalizedTitle);
    }) ?? projects[0];
    if (!project) {
      const projectResponse = await fetch("/api/equipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "project",
          organization: targetQuote.organization,
          businessRound: targetQuote.businessRound,
          name: targetQuote.projectTitle || "견적 품목",
          budgetType: targetQuote.projectTitle,
          status: "견적",
          notes: `${targetQuote.quoteNumber} 견적서에서 생성`,
        }),
      });
      const projectPayload = await projectResponse.json() as { project?: Record<string, unknown>; error?: string };
      if (!projectResponse.ok || !projectPayload.project) {
        throw new Error(projectPayload.error || "견적 품목을 담을 기관 사업을 만들지 못했습니다.");
      }
      project = projectPayload.project;
    }
    const projectId = Number(project.id);
    if (!Number.isInteger(projectId) || projectId < 1) {
      throw new Error("견적 품목을 연결할 기관 사업을 찾지 못했습니다.");
    }
    const response = await fetch("/api/equipment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "catalog-items",
        projectId,
        items: items.map((item) => ({
          catalogItemId: item.productId,
          productName: item.name,
          specification: item.specification,
          proposedQty: item.quantity,
          unit: item.unit,
          status: "견적",
          catalogUnitPrice: item.unitPrice,
          priceStatus: item.unitPrice > 0 ? "입력 완료" : "금액 미입력",
          catalogNote: [
            item.note,
            item.procurement
              ? `${item.procurementChannel || "G2B"}${item.procurementNumber ? ` : ${item.procurementNumber}` : ""}`
              : "",
          ].filter(Boolean).join(" · "),
          supplyType: item.supplyType,
          commissionRate: item.supplyType === "partner" ? item.earningRate : null,
          marginRate: item.supplyType === "direct" ? item.earningRate : null,
          procurementFeeRate: item.procurementFeeRate,
          executionType: targetQuote.executionType,
          consortiumCommissionRate: targetQuote.executionType === "컨소" ? item.consortiumRate : null,
        })),
      }),
    });
    const payload = await response.json() as { added?: number; skipped?: number; error?: string };
    if (!response.ok) throw new Error(payload.error || "견적 품목을 기관 품목 관리에 반영하지 못했습니다.");
    return { added: Number(payload.added) || 0, skipped: Number(payload.skipped) || 0 };
  }

  async function syncSavedQuotationItems(targetQuote: AuthoredQuotation) {
    if (quotationActionId) return;
    setQuotationActionId(targetQuote.id);
    setMessage("");
    try {
      const result = await syncQuotationItems(targetQuote);
      setMessage(result.added > 0
        ? `${targetQuote.quoteNumber}의 품목 ${result.added}개를 기관 품목 관리에 추가했습니다.`
        : `${targetQuote.quoteNumber}의 품목은 이미 기관 품목 관리에 반영되어 있습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "견적 품목을 기관 품목 관리에 반영하지 못했습니다.");
    } finally {
      setQuotationActionId(0);
    }
  }

  async function quotationWorkbookFile(quote: AuthoredQuotation) {
    const [logoResponse, sealResponse] = await Promise.all([
      fetch("/whizzup-logo.png"),
      quote.includeStamp ? fetch("/whizzup-seal.png") : Promise.resolve(null),
    ]);
    const logoData = logoResponse.ok ? new Uint8Array(await logoResponse.arrayBuffer()) : undefined;
    const sealData = sealResponse?.ok ? new Uint8Array(await sealResponse.arrayBuffer()) : undefined;
    const bytes = createQuotationWorkbook({
      customerName: quote.organization,
      quoteDate: quote.quoteDate,
      projectTitle: quote.projectTitle,
      quoteNumber: quote.quoteNumber,
      validUntil: quote.validUntil,
      includeStamp: quote.includeStamp,
      discountAmount: quote.discountAmount,
      extraAmount: quote.extraAmount,
      memo: quote.memo,
      logoData,
      sealData,
      equipmentKit: quote.items.find((item) => item.equipmentKit)?.equipmentKit,
      lines: quote.items.map((item) => ({
        name: item.name,
        specification: item.specification,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        note: item.note,
        procurement: item.procurement,
        procurementChannel: item.procurementChannel,
        procurementNumber: item.procurementNumber,
        procurementFeeRate: item.procurementFeeRate,
      })),
    });
    const workbookBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new File([workbookBuffer], `${quotationFileStem(quote)}.xlsx`, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  async function storeQuotationFiles(quote: AuthoredQuotation) {
    if (quote.pdfUrl && quote.excelUrl && quote.driveSyncStatus === "ready" && !importSourceFile) return quote;
    const [pdf, xlsx] = await Promise.all([
      createAuthoredQuotationPdf(quote),
      quotationWorkbookFile(quote),
    ]);
    const formData = new FormData();
    formData.set("quotationId", String(quote.id));
    formData.set("pdf", pdf);
    formData.set("xlsx", xlsx);
    if (importSourceFile) formData.set("sourceFile", importSourceFile);
    const response = await fetch("/api/quotations/files", { method: "POST", body: formData });
    const payload = await response.json() as { quotation?: AuthoredQuotation; error?: string };
    if (!response.ok || !payload.quotation) {
      throw new Error(payload.error || "PDF·Excel을 Google Drive에 저장하지 못했습니다.");
    }
    setQuotes((current) => current.map((item) => item.id === payload.quotation?.id ? payload.quotation : item));
    window.dispatchEvent(new CustomEvent("whizzup:quotation-files-updated", {
      detail: {
        organization: payload.quotation.organization,
        businessRound: payload.quotation.businessRound,
      },
    }));
    return payload.quotation;
  }

  async function viewSavedPdf(quote: AuthoredQuotation) {
    if (!quote.pdfUrl) {
      setMessage("저장된 PDF 파일이 없습니다. 견적 수정에서 최종 저장하면 현재 PDF가 생성됩니다.");
      return;
    }
    const popup = window.open(quote.pdfUrl, "_blank", "noopener,noreferrer");
    if (!popup) setMessage("팝업이 차단되었습니다. PDF 보기를 다시 눌러 주세요.");
  }

  async function downloadSavedExcel(quote: AuthoredQuotation) {
    if (!quote.excelUrl) {
      setMessage("저장된 Excel 파일이 없습니다. 견적 수정에서 최종 저장하면 현재 Excel이 생성됩니다.");
      return;
    }
    try {
      const response = await fetch(quote.excelUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("저장된 Excel을 내려받지 못했습니다.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${quotationFileStem(quote)}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장된 Excel을 내려받지 못했습니다.");
    }
  }

  async function deleteQuotation(quote: AuthoredQuotation) {
    if (quotationActionId || !window.confirm(
      `${quote.quoteNumber}\n${quote.quoteDate} · ${won.format(quote.totalAmount)}원\n\n이 견적서를 휴지통으로 이동할까요?`,
    )) return;
    setQuotationActionId(quote.id);
    try {
      const response = await fetch("/api/quotations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: quote.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "견적서를 삭제하지 못했습니다.");
      if (draft?.id === quote.id) closeEditor();
      setMessage(`${quote.quoteNumber} 견적서를 휴지통으로 이동했습니다.`);
      window.dispatchEvent(new CustomEvent("whizzup:quotation-files-updated"));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "견적서를 삭제하지 못했습니다.");
    } finally {
      setQuotationActionId(0);
    }
  }

  async function restoreQuotation(quote: AuthoredQuotation) {
    if (quotationActionId) return;
    setQuotationActionId(quote.id);
    try {
      const response = await fetch("/api/quotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: quote.id, action: "restore" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "견적서를 복원하지 못했습니다.");
      setMessage(`${quote.quoteNumber} 견적서를 복원했습니다.`);
      window.dispatchEvent(new CustomEvent("whizzup:quotation-files-updated"));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "견적서를 복원하지 못했습니다.");
    } finally {
      setQuotationActionId(0);
    }
  }

  async function purgeQuotation(quote: AuthoredQuotation) {
    if (quotationActionId || !window.confirm(
      `${quote.quoteNumber} 견적서와 연결된 PDF·Excel을 Google Drive에서도 영구 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`,
    )) return;
    setQuotationActionId(quote.id);
    try {
      const response = await fetch("/api/quotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: quote.id, action: "purge" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "견적서를 영구 삭제하지 못했습니다.");
      setMessage(`${quote.quoteNumber} 견적서를 영구 삭제했습니다.`);
      window.dispatchEvent(new CustomEvent("whizzup:quotation-files-updated"));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "견적서를 영구 삭제하지 못했습니다.");
    } finally {
      setQuotationActionId(0);
    }
  }

  async function save(status: "draft" | "final") {
    if (!draft || saving) return;
    if (
      status === "final"
      && draft.id
      && draft.status === "final"
      && !window.confirm("현재 견적을 같은 견적번호로 수정할까요? 기존 PDF·Excel도 새 내용으로 교체됩니다.")
    ) return;
    setSaving(true);
    setMessage("");
    try {
      const exactInstitution = institutions.find((item) => item.organization.replace(/\s/g, "").toLocaleLowerCase("ko-KR") === draft.organization.replace(/\s/g, "").toLocaleLowerCase("ko-KR") && item.businessRound === draft.businessRound);
      const institutionBudgets = budgetOptionsForInstitution(exactInstitution);
      if (status === "final" && institutionBudgets.length > 0 && effectiveBudgets.length === 0) {
        throw new Error("이 견적에 사용할 예산을 한 개 이상 선택해 주세요.");
      }
      if (status === "final" && !exactInstitution && draft.status !== "final") {
        const createResponse = await fetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: draft.quoteDate, activityType: "기타", contactMethod: "기타", organization: draft.organization, confirmedOrganization: draft.organization, businessRound: draft.businessRound, region: newInstitution.region, contactName: newInstitution.contactName, contactPhone: newInstitution.contactPhone, contactEmail: newInstitution.contactEmail, topic: "견적 기관 등록", summary: `${draft.projectTitle || "견적서"} 작성과 함께 기관을 등록했습니다.`, sourceChat: "견적서", skipRelatedWrites: true }) });
        const createPayload = await createResponse.json() as { error?: string };
        if (!createResponse.ok) throw new Error(createPayload.error || "새 기관을 등록하지 못했습니다.");
      }
      const response = await fetch("/api/quotations", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, budgets: effectiveBudgets, status: "draft" }),
      });
      const payload = await response.json() as { quotation?: AuthoredQuotation; error?: string };
      if (!response.ok || !payload.quotation) throw new Error(payload.error || "견적서를 저장하지 못했습니다.");
      if (status === "final") {
        let finalizedQuotation: AuthoredQuotation;
        try {
          finalizedQuotation = await storeQuotationFiles(payload.quotation);
        } catch (fileError) {
          setDraft(draftFromQuotation(payload.quotation));
          throw new Error(`견적은 임시 저장했지만 최종 파일 보관을 완료하지 못했습니다. ${fileError instanceof Error ? fileError.message : "다시 최종 저장해 주세요."}`);
        }
        setMessage(importSourceFile
          ? "최종 견적서와 PDF·Excel, 외부 참고 원본을 연결해 저장했습니다."
          : "최종 견적서와 PDF·Excel을 Google Drive에 저장했습니다.");
      } else {
        setMessage("임시 저장했습니다.");
      }
      if (status === "final") {
        closeEditor();
      } else {
        setDraft(draftFromQuotation(payload.quotation));
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "견적서를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function exportExcel() {
    if (!draft || !draft.items.length) return;
    const [logoResponse, sealResponse] = await Promise.all([
      fetch("/whizzup-logo.png"),
      draft.includeStamp ? fetch("/whizzup-seal.png") : Promise.resolve(null),
    ]);
    const logoData = logoResponse.ok ? new Uint8Array(await logoResponse.arrayBuffer()) : undefined;
    const sealData = sealResponse?.ok ? new Uint8Array(await sealResponse.arrayBuffer()) : undefined;
    const bytes = createQuotationWorkbook({
      customerName: draft.organization,
      quoteDate: draft.quoteDate,
      projectTitle: draft.projectTitle,
      quoteNumber: draft.quoteNumber,
      validUntil: draft.validUntil,
      includeStamp: draft.includeStamp,
      discountAmount: draft.discountAmount,
      extraAmount: draft.extraAmount,
      memo: draft.memo,
      logoData,
      sealData,
      extraBlankRows: outputBlankRows,
      equipmentKit: draft.items.find((item) => item.equipmentKit)?.equipmentKit,
      lines: draft.items.map((item) => ({
        name: item.name,
        specification: item.specification,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        note: item.note,
        procurement: item.procurement,
        procurementChannel: item.procurementChannel,
        procurementNumber: item.procurementNumber,
        procurementFeeRate: item.procurementFeeRate,
      })),
    });
    downloadBytes(bytes, `견적서_${safeFileName(draft.organization)}_${draft.quoteDate}.xlsx`);
  }

  const regularDraftItems = draft?.items.filter((item) => !isConstructionItem(item)) ?? [];
  const constructionItem = draft?.items.find(isConstructionItem);

  return <section className={`quotation-workspace${embedded ? " quotation-workspace-embedded" : ""}`}>
    <header className="quotation-workspace-header">
      <div>
        <span className="section-kicker">{embedded ? "INSTITUTION QUOTATIONS" : "OFFICIAL QUOTATION"}</span>
        <h2>{embedded ? "견적서 내역" : "견적서 작성·보관"}</h2>
        <p>{embedded
          ? `${scope?.businessRound ?? 1}차 사업의 현재 최종 견적과 PDF·Excel을 바로 확인합니다.`
          : "제품 기준정보로 견적서를 만들고 최종 PDF·Excel을 Google Drive에 함께 보관합니다."}</p>
      </div>
      <div className="quotation-workspace-header-actions">
        {scope && <button className="app-button app-button-primary" type="button" onClick={() => void startFromInstitutionItems()} disabled={equipmentLoading}>
          {equipmentLoading ? "품목 불러오는 중…" : "등록 품목으로 견적 만들기"}
        </button>}
        <button className="app-button app-button-secondary" type="button" onClick={() => { setProductQuery(""); beginEditor(draftForScope(scope)); }}>{scope ? "현재 기관 빈 견적 만들기" : "새 견적 만들기"}</button>
      </div>
    </header>
    {message && <div className="quotation-workspace-message">{message}</div>}
    <div className="quotation-list-toolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="기관명·사업명·견적번호 검색" />
      <span>{filteredQuotes.length.toLocaleString()}건</span>
    </div>
    <div className="quotation-list">
      {loading ? <div className="empty-state">견적서를 불러오는 중입니다.</div> : pagedQuotes.map((quote) => <article className="quotation-list-row" key={quote.id}>
        <div className="quotation-row-main">
          <div className="quotation-row-institution">
            <strong>{quote.organization}</strong>
            <small>{quote.projectTitle || `${quote.businessRound}차 사업`}</small>
          </div>
          <div className="quotation-row-number">
            <strong>{quote.quoteNumber}</strong>
            <small>{quote.status === "final" ? "현재 최종본" : "작성 중"}</small>
          </div>
          <div className="quotation-row-budgets">
            <strong>{displayedBudgetsForQuote(quote).length ? displayedBudgetsForQuote(quote).map((budget) => budget.name).join(" + ") : "예산 연결 필요"}</strong>
            {displayedBudgetsForQuote(quote).length > 0 && <small>{displayedBudgetsForQuote(quote).map((budget) => `${budget.name} ${won.format(budget.allocatedAmount)}원`).join(" · ")}</small>}
          </div>
        </div>
        <dl className="quotation-row-facts">
          <div><dt>견적일</dt><dd>{quote.quoteDate}</dd></div>
          <div><dt>금액</dt><dd><strong>{won.format(quote.totalAmount)}원</strong></dd></div>
          <div className="quotation-row-authors">
            <div><dt>작성자</dt><dd>{quote.createdByName || "미등록"}</dd></div>
            <div><dt>수정자</dt><dd>{quote.updatedByName || quote.createdByName || "미등록"}</dd></div>
          </div>
          <div><dt>상태</dt><dd><b className={`quotation-status ${quote.status}`}>{quote.status === "final" ? "최종" : "임시"}</b></dd></div>
        </dl>
        <div className="quotation-row-actions">
          {quote.status === "final" ? <>
            {!embedded && <button className="app-button app-button-secondary app-button-small" type="button" disabled={!quote.pdfUrl} onClick={() => void viewSavedPdf(quote)}>PDF 보기</button>}
            {!embedded && <button className="app-button app-button-secondary app-button-small" type="button" disabled={!quote.excelUrl} onClick={() => void downloadSavedExcel(quote)}>Excel 다운로드</button>}
            <button className="app-button app-button-primary app-button-small" type="button" onClick={() => openQuotation(quote)}>견적 수정</button>
          </> : <button className="app-button app-button-primary app-button-small" type="button" onClick={() => openQuotation(quote)}>이어서 작성</button>}
          {quote.canDelete && <button className="app-button app-button-danger app-button-small" type="button" disabled={quotationActionId === quote.id} onClick={() => void deleteQuotation(quote)}>{quotationActionId === quote.id ? "처리 중…" : "삭제"}</button>}
        </div>
      </article>)}
      {!loading && !filteredQuotes.length && <div className="empty-state">저장된 견적서가 없습니다.</div>}
    </div>
    {!embedded && filteredQuotes.length > QUOTATION_PAGE_SIZE && <nav className="data-list-pagination quotation-list-pagination" aria-label="견적서 목록 페이지">
      <button type="button" disabled={quotationPage === 1} onClick={() => setQuotationPage((current) => Math.max(1, current - 1))}>이전</button>
      <span>{quotationPage.toLocaleString()} / {quotationPageCount.toLocaleString()} 페이지<small>총 {filteredQuotes.length.toLocaleString()}건 · 페이지당 {QUOTATION_PAGE_SIZE}건</small></span>
      <button type="button" disabled={quotationPage === quotationPageCount} onClick={() => setQuotationPage((current) => Math.min(quotationPageCount, current + 1))}>다음</button>
    </nav>}

    <section className="quotation-trash no-print">
      <button className="app-button app-button-neutral" type="button" onClick={() => setTrashOpen((open) => !open)} aria-expanded={trashOpen}>
        휴지통 {trashedQuotes.length.toLocaleString()}건 {trashOpen ? "접기" : "보기"}
      </button>
      {trashOpen && <div className="quotation-trash-list">
        {trashedQuotes.map((quote) => <article key={quote.id}>
          <div><strong>{quote.quoteNumber}</strong><span>{quote.organization} · {quote.quoteDate} · {won.format(quote.totalAmount)}원</span></div>
          <div>
            {quote.canDelete && <button className="app-button app-button-secondary app-button-small" type="button" disabled={quotationActionId === quote.id} onClick={() => void restoreQuotation(quote)}>복원</button>}
            {quote.canPurge && <button className="app-button app-button-danger app-button-small" type="button" disabled={quotationActionId === quote.id} onClick={() => void purgeQuotation(quote)}>영구 삭제</button>}
          </div>
        </article>)}
        {!trashedQuotes.length && <p>휴지통이 비어 있습니다.</p>}
      </div>}
    </section>

    {draft && <div className="quotation-editor-shell" role="presentation">
      <div className="quotation-editor quote-studio" role="dialog" aria-modal="true" aria-label="견적서 작성">
        <header className="quote-studio-topbar no-print">
          <div><span>{`${draft.quoteDate.slice(0, 4)}년 ${draft.quoteDate.slice(5, 7)}월 ${draft.quoteDate.slice(8, 10)}일`}</span><h3>{draft.id && draft.status === "final" ? "최종 견적 보기" : "견적 작성"}{draft.organization ? ` · ${draft.organization}` : ""}</h3></div>
          <nav aria-label="견적서 작업">
            <div className="quote-topbar-action-group quote-topbar-output-actions">
              <button type="button" onClick={exportExcel} disabled={!draft.items.length}>Excel 출력</button>
              <button type="button" onClick={printQuotation} disabled={!draft.items.length}>PDF 출력</button>
            </div>
            <div className="quote-topbar-action-group quote-topbar-navigation-actions">
              {institutions.some((item) => item.organization === draft.organization && item.businessRound === draft.businessRound) && <button className="app-button app-button-secondary" type="button" onClick={() => { closeEditor(); onOpenOrganization?.(draft.organization, draft.businessRound); }}>기관 상세 보기</button>}
              <button className="app-button app-button-neutral" type="button" onClick={closeEditor}>취소</button>
            </div>
            <div className="quote-topbar-action-group quote-topbar-save-actions">
              {draft.id && draft.status === "final"
                ? <button className="app-button app-button-primary" type="button" onClick={() => void save("final")} disabled={saving}>{saving ? "저장 중…" : "견적 수정 저장"}</button>
                : <button className="app-button app-button-primary" type="button" onClick={() => void save("final")} disabled={saving}>{saving ? "저장 중…" : "견적서 저장"}</button>}
            </div>
          </nav>
        </header>

        <div className="quotation-editor-layout quote-studio-layout">
          <main className="quotation-paper quote-document">
            <div className="quotation-paper-title"><img src="/whizzup-logo.png" alt="WHIZZUP" /><strong>견 적 서</strong><span>{draft.quoteNumber || "저장 시 견적번호 발급"}<br />{draft.quoteDate}</span></div>
            <section className="quote-document-info">
              <div className="quote-recipient">
                <h4>견 적 정 보</h4>
                <label><span>견적일자</span><input type="date" value={draft.quoteDate} onChange={(event) => setDraft({ ...draft, quoteDate: event.target.value })} /></label>
                <label><span>수신 기관명 *</span><input readOnly={Boolean(scope)} value={scope ? draft.organization : institutionQuery} onChange={(event) => { setInstitutionQuery(event.target.value); setDraft({ ...draft, organization: event.target.value }); }} placeholder="기관명 또는 지역 검색" /></label>
                {!scope && institutionQuery.trim().length >= 2 && <div className="quotation-institution-results no-print">{institutionOptions.filter((item) => `${item.organization} ${item.region || ""}`.includes(institutionQuery.trim())).slice(0, 8).map((item) => <button type="button" key={normalizedInstitutionName(item.organization)} disabled={equipmentLoading} onClick={() => void selectInstitution(item)}><b>{item.organization}</b><small>{item.region || "지역 미입력"} · 기관 선택 후 사업 차수 선택</small></button>)}{!institutions.some((item) => normalizedInstitutionName(item.organization) === normalizedInstitutionName(institutionQuery)) && <div className="quotation-new-institution"><strong>새 기관으로 등록 후 견적 연결</strong><input value={newInstitution.region} onChange={(event) => setNewInstitution({ ...newInstitution, region: event.target.value })} placeholder="지역 (선택)" /><input value={newInstitution.contactName} onChange={(event) => setNewInstitution({ ...newInstitution, contactName: event.target.value })} placeholder="담당자 (선택)" /></div>}</div>}
                <label><span>사업 차수 *</span><select disabled={Boolean(scope) || equipmentLoading} value={draft.businessRound} onChange={(event) => void selectBusinessRound(Math.max(1, Number(event.target.value) || 1))}>
                  {institutionRounds.map((item) => <option key={item.businessRound} value={item.businessRound}>{item.businessRound}차{item.budgetType ? ` · ${item.budgetType}` : ""}</option>)}
                  {!scope && <option value={institutionRounds.length ? nextInstitutionRound : Math.max(1, draft.businessRound)}>{institutionRounds.length ? nextInstitutionRound : Math.max(1, draft.businessRound)}차 · 새 차수 만들기</option>}
                </select></label>
                {availableBudgets.length > 0 && <section className="quotation-budget-linker no-print">
                  <header><strong>연결 예산</strong><small>{availableBudgets.length === 1 ? "기관 예산이 자동 연결됩니다." : "이 견적에 사용할 예산을 한 개 이상 선택하세요."}</small></header>
                  <div className="quotation-budget-options">{availableBudgets.map((budget) => {
                    const selected = draft.budgets.some((item) => item.key === budget.key);
                    const linked = effectiveBudgets.find((item) => item.key === budget.key);
                    return <div className={selected ? "selected" : ""} key={budget.key}>
                      <label><input type="checkbox" checked={selected} onChange={() => toggleBudget(budget)} /><span><b>{budget.name}</b><small>{budget.institutionAmount > 0 ? `기관 예산 ${won.format(budget.institutionAmount)}원` : "기관 예산액 미입력"}</small></span></label>
                      {selected && draft.budgets.length > 1 && <span className="quotation-money-input"><FormattedMoneyInput value={linked?.allocatedAmount ?? 0} onChange={(allocatedAmount) => updateBudgetAllocation(budget.key, allocatedAmount)} label={`${budget.name} 배분 금액`} /><b>원</b></span>}
                    </div>;
                  })}</div>
                  {draft.budgets.length > 0 && <footer className={budgetAllocationTotal !== numbers.total ? "warning" : ""}><span>예산 배분 합계 {won.format(budgetAllocationTotal)}원</span><span>견적 최종 합계 {won.format(numbers.total)}원</span>{budgetAllocationTotal !== numbers.total && <small>공사비·수수료·추가비용 차이를 확인해 주세요. 저장은 가능합니다.</small>}</footer>}
                </section>}
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
            <div className="quote-total-banner"><span>견적금액 (VAT 및 수수료 포함)</span><em>{amountInKoreanLabel(numbers.total)}</em><strong>{won.format(numbers.total)}원</strong></div>

            <section className="quotation-item-card-section no-print">
              <header>
                <div><h4>견적 품목 {draft.items.length}개</h4><p>제품 DB의 조달정보와 품목별 수수료율을 자동 적용합니다.</p></div>
                <div className="quotation-item-toolbar">
                  <div className="quotation-product-search" ref={productSearchRef}>
                    <input value={productQuery} onFocus={() => { if (productQuery) setProductResultsOpen(true); }} onChange={(event) => { setProductQuery(event.target.value); setProductResultsOpen(Boolean(event.target.value)); }} placeholder={`물품 검색 (${favoriteProductsOnly ? favoriteProductIds.length : products.length}개)`} aria-label="견적에 추가할 물품 검색" />
                    <div className="quotation-product-filters" role="group" aria-label="견적 제품 표시 범위">
                      <button className={productListMode === "all" ? "active" : ""} type="button" aria-pressed={productListMode === "all"} onClick={() => toggleProductList("all")}>전체 제품</button>
                      <button className={productListMode === "favorites" ? "active" : ""} type="button" aria-pressed={productListMode === "favorites"} onClick={() => toggleProductList("favorites")}>★ 즐겨찾기 {favoriteProductIds.length}</button>
                    </div>
                  </div>
                  <div className="quotation-item-toolbar-actions">
                    <button type="button" onClick={addBlankItem}>+ 직접 입력</button>
                    <button type="button" className="quotation-external-import-button" onClick={() => setImportMode("general")}>외부 견적 불러오기</button>
                  </div>
                </div>
              </header>
              {productResultsOpen && <div className="quotation-item-search-results" ref={productSearchResultsRef}><header><span>물품을 연속으로 선택할 수 있습니다.</span><button type="button" onClick={() => setProductResultsOpen(false)}>선택 완료</button></header>{filteredProducts.map((product) => <button type="button" key={product.id} onClick={() => addProduct(product)}><span><b>{favoriteProductIds.includes(product.id) ? "★ " : ""}{product.name}</b><small>{product.specification || "규격 미등록"}</small></span><em>{product.unitPrice === null ? "금액 미등록" : `${won.format(product.unitPrice)}원`}</em></button>)}{!filteredProducts.length && <p className="quotation-product-empty">표시할 {favoriteProductsOnly ? "즐겨찾기 " : ""}제품이 없습니다.</p>}</div>}
              <div className="quotation-item-card-guide">제품 기준정보 연계 · 수의계약/G2B/S2B 선택 · 식별번호 · G2B 조달수수료율 0.54%</div>
              <div className="quotation-item-cards">
                {regularDraftItems.map((item, index) => {
                  const productAmount = Math.max(0, item.quantity) * Math.max(0, item.unitPrice);
                  const procurementFee = appliesProcurementFee(item) ? Math.floor(productAmount * item.procurementFeeRate / 10) * 10 : 0;
                  const quotationAmount = productAmount + procurementFee;
                  const expectedEarning = Math.floor(productAmount * item.earningRate / 10) * 10;
                  const consortiumPayment = draft.executionType === "컨소" ? Math.min(expectedEarning, Math.floor(productAmount * item.consortiumRate / 10) * 10) : 0;
                  const internalCost = item.internalCostEnabled ? Math.max(0, item.internalCostAmount) : 0;
                  const internalCostDefaults = quotationInternalCostDefaults(item.name, item.specification);
                  const companyMargin = Math.max(0, expectedEarning - consortiumPayment - internalCost);
                  return <article
                    className={`quotation-item-card${dragOverItemId === item.id ? " drag-over" : ""}`}
                    key={item.id}
                    onDragOver={(event) => {
                      if (!draggedItemIdRef.current || draggedItemIdRef.current === item.id) return;
                      event.preventDefault();
                      setDragOverItemId(item.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      reorderItem(draggedItemIdRef.current, item.id);
                      draggedItemIdRef.current = "";
                      setDragOverItemId("");
                    }}
                  >
                    <header>
                      <div className="quotation-item-order-controls">
                        <span className="quotation-item-number">{index + 1}</span>
                        <button
                          className="quotation-item-drag-handle"
                          type="button"
                          draggable
                          aria-label={`${item.name || `${index + 1}번 품목`} 순서 끌어서 이동`}
                          title="끌어서 순서 변경"
                          onDragStart={(event) => {
                            draggedItemIdRef.current = item.id;
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", item.id);
                          }}
                          onDragEnd={() => {
                            draggedItemIdRef.current = "";
                            setDragOverItemId("");
                          }}
                        >⋮⋮</button>
                        <button type="button" disabled={index === 0} aria-label={`${item.name || `${index + 1}번 품목`} 위로 이동`} onClick={() => moveItem(item.id, -1)}>↑</button>
                        <button type="button" disabled={index === regularDraftItems.length - 1} aria-label={`${item.name || `${index + 1}번 품목`} 아래로 이동`} onClick={() => moveItem(item.id, 1)}>↓</button>
                      </div>
                      <div className="quotation-item-card-title"><input value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} placeholder="품명" /><input value={item.specification} onChange={(event) => updateItem(item.id, { specification: event.target.value })} placeholder="규격/모델명" /></div>
                      <em className={item.procurement ? "" : "general"}>{contractLabel(item)}{item.procurementNumber ? ` · ${item.procurementNumber}` : ""}</em>
                      <button type="button" aria-label={`${item.name || `${index + 1}번 품목`} 삭제`} onClick={() => setDraft({ ...draft, items: draft.items.filter((line) => line.id !== item.id) })}>×</button>
                    </header>
                    {(item.equipmentKit || isAirpassEquipmentKitProduct(item.name)) && <div className="quotation-equipment-kit-summary">
                      <div><strong>교구 세부견적</strong><span>{item.equipmentKit ? `${item.equipmentKit.plan === "two" ? "표준 2세트" : "표준 1세트"} · 출력 ${airpassEquipmentKitOutputLines(item.equipmentKit).length}개 품목` : "아직 세부 품목이 입력되지 않았습니다."}</span></div>
                      <button type="button" disabled={equipmentKitRecoveryId === item.id} onClick={() => void openEquipmentKitEditor(item)}>{equipmentKitRecoveryId === item.id ? "저장본 복구 중…" : item.equipmentKit ? "세부견적 수정" : "교구 세부견적 열기"}</button>
                    </div>}
                    <div className="quotation-item-card-summary">
                      <label><span>수량</span><div><input type="number" min="1" value={item.quantity} disabled={Boolean(item.equipmentKit)} onChange={(event) => updateItem(item.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} /><input value={item.unit} disabled={Boolean(item.equipmentKit)} onChange={(event) => updateItem(item.id, { unit: event.target.value })} aria-label="단위" /></div></label>
                      <label><span>단가</span><div><span className="quotation-money-input"><FormattedMoneyInput value={item.unitPrice} disabled={Boolean(item.equipmentKit)} onChange={(unitPrice) => updateItem(item.id, { unitPrice })} label="단가" /><b>원</b></span><strong>합계 {won.format(productAmount)}원</strong></div></label>
                      <div><span>조달수수료</span><strong>{won.format(procurementFee)}원</strong></div>
                      <div><span>견적금액</span><strong>{won.format(quotationAmount)}원</strong></div>
                    </div>
                    <div className="quotation-item-card-controls">
                      <div className="quotation-contract-type"><span>계약 구분</span><div><button type="button" className={!item.procurement ? "active" : ""} onClick={() => setItemContractType(item.id, "direct")}>수의계약</button><button type="button" className={item.procurement && !isS2BChannel(item.procurementChannel) ? "active" : ""} onClick={() => setItemContractType(item.id, "g2b")}>조달 계약</button><button type="button" className={item.procurement && isS2BChannel(item.procurementChannel) ? "active" : ""} onClick={() => setItemContractType(item.id, "s2b")}>학교장터</button></div></div>
                      {item.procurement ? <label><span>식별번호</span><input value={item.procurementNumber} onChange={(event) => updateItem(item.id, { procurementNumber: event.target.value.replace(/[^0-9-]/g, "") })} placeholder={isS2BChannel(item.procurementChannel) ? "S2B 번호" : "G2B 물품식별번호"} /></label> : null}
                      <label><span>조달 수수료율</span><div className="quotation-rate-input"><EditableRateInput label="조달 수수료율" value={item.procurementFeeRate} step={0.01} disabled={!appliesProcurementFee(item)} onChange={(procurementFeeRate) => updateItem(item.id, { procurementFeeRate })} /><b>%</b></div></label>
                      <label><span>당사 수수료율</span><div className="quotation-rate-input"><EditableRateInput label="당사 수수료율" value={item.earningRate} onChange={(earningRate) => updateItem(item.id, { earningRate, consortiumRate: Math.min(item.consortiumRate, earningRate) })} /><b>%</b></div></label>
                      {draft.executionType === "컨소" ? <label><span>컨소 지급률</span><div className="quotation-rate-input"><EditableRateInput label="컨소 지급률" value={item.consortiumRate} max={item.earningRate * 100} onChange={(consortiumRate) => updateItem(item.id, { consortiumRate })} /><b>%</b></div></label> : null}
                      <div className="quotation-item-margin"><span>당사 마진</span><strong>{won.format(companyMargin)}원</strong>{internalCost > 0 ? <small>내부 원가 {won.format(internalCost)}원 차감</small> : draft.executionType === "컨소" ? <small>컨소 지급 {won.format(consortiumPayment)}원 차감</small> : <small>예상 수익 기준</small>}</div>
                      {internalCostDefaults.kind && <div className="quotation-item-internal-cost">
                        <label><input type="checkbox" checked={item.internalCostEnabled} onChange={(event) => updateItem(item.id, { internalCostEnabled: event.target.checked })} /><span>{internalCostDefaults.label} 차감</span></label>
                        <span className="quotation-money-input"><FormattedMoneyInput value={item.internalCostAmount} onChange={(internalCostAmount) => updateItem(item.id, { internalCostAmount })} label={`${internalCostDefaults.label} 내부 원가`} /><b>원</b></span>
                        <small>내부 총이익에서만 차감되며 고객 견적·PDF·Excel 금액에는 반영되지 않습니다.</small>
                      </div>}
                    </div>
                    <label className="quotation-item-card-note"><span>비고</span><input value={item.note} onChange={(event) => updateItem(item.id, { note: event.target.value })} placeholder="품목별 비고" /></label>
                  </article>;
                })}
                {!regularDraftItems.length && <div className="quotation-items-empty">물품을 검색하거나 행을 추가해 견적을 작성해 주세요.</div>}
              </div>
              <section className="quotation-construction-cost">
                <header><div><strong>설치·공사비</strong><small>기관 상세에 등록된 공사비와 연동되며 견적서에는 별도 품목으로 표시됩니다.</small></div><label><input type="checkbox" checked={Boolean(constructionItem)} onChange={(event) => setConstructionIncluded(event.target.checked)} /> 공사비 포함</label></header>
                <div className="quotation-construction-cost-fields">
                  {constructionItem && <><label><span>품명</span><input value={constructionItem.name} onChange={(event) => updateItem(constructionItem.id, { name: event.target.value })} /></label><label><span>공사 내용</span><input value={constructionItem.specification} onChange={(event) => updateItem(constructionItem.id, { specification: event.target.value })} /></label><label><span>고객 견적 공사비</span><span className="quotation-money-input"><FormattedMoneyInput value={constructionItem.unitPrice} onChange={(unitPrice) => updateItem(constructionItem.id, { unitPrice })} label="공사비" /><b>원</b></span></label></>}
                  <label className="quotation-additional-internal-cost"><span>추가 내부 공사 원가</span><span className="quotation-money-input"><FormattedMoneyInput value={draft.additionalInternalConstructionCost} onChange={(additionalInternalConstructionCost) => setDraft({ ...draft, additionalInternalConstructionCost })} label="추가 내부 공사 원가" /><b>원</b></span><small>내부 총이익에서만 차감됩니다.</small></label>
                </div>
              </section>
            </section>

            <section className="quote-bottom-row">
              <div className="quote-adjust no-print">
                <strong>금액 조정</strong>
                <label>할인 <span className="quotation-money-input"><FormattedMoneyInput value={draft.discountAmount} onChange={(discountAmount) => setDraft({ ...draft, discountAmount })} label="할인 금액" /><b>원</b></span></label>
                <label>추가 <span className="quotation-money-input"><FormattedMoneyInput value={draft.extraAmount} onChange={(extraAmount) => setDraft({ ...draft, extraAmount })} label="추가비용" /><b>원</b></span></label>
              </div>
              <dl><dt>품목 합계 (VAT 포함)</dt><dd>{won.format(numbers.subtotal)}원</dd>{numbers.procurementFee > 0 && <><dt>조달 수수료</dt><dd>{won.format(numbers.procurementFee)}원</dd></>}<dt>공급가액</dt><dd>{won.format(numbers.supply)}원</dd><dt>부가가치세</dt><dd>{won.format(numbers.tax)}원</dd><dt>최종 합계</dt><dd>{won.format(numbers.total)}원</dd></dl>
            </section>
            <label className="quotation-memo">특기사항 / 메모<textarea value={draft.memo} onChange={(event) => setDraft({ ...draft, memo: event.target.value })} placeholder="견적 관련 특기사항이나 메모를 입력해 주세요." /></label>
          </main>

          <aside className="quotation-profit-panel quote-internal no-print">
            <div><span className="section-kicker">SALES INFO</span><h4>영업 정보</h4></div>
            <label>협업 구분<select value={draft.executionType} onChange={(event) => setDraft({ ...draft, executionType: event.target.value === "컨소" ? "컨소" : "직영" })}><option>직영</option><option>컨소</option></select></label>
            {draft.executionType === "컨소" && <><label>컨소 업체<input value={draft.consortiumCompany} onChange={(event) => setDraft({ ...draft, consortiumCompany: event.target.value })} placeholder="업체명" /></label><p>컨소 지급률은 품목마다 다르게 입력합니다. 각 품목의 지급률은 위즈업 수수료율을 넘을 수 없습니다.</p></>}
            <section className="quote-profit-box"><header><strong>수익 분석</strong><small>내부용</small></header><dl><dt>예상 수익</dt><dd>{won.format(numbers.earning)}원</dd><dt>컨소 지급</dt><dd>{numbers.consortium > 0 ? `-${won.format(numbers.consortium)}원` : "0원"}</dd>{numbers.projectorInstallationCost > 0 && <><dt>빔프로젝터 설치</dt><dd className="deduction">-{won.format(numbers.projectorInstallationCost)}원</dd></>}{numbers.yogaMatServiceCost > 0 && <><dt>요가매트 제공</dt><dd className="deduction">-{won.format(numbers.yogaMatServiceCost)}원</dd></>}{numbers.additionalConstructionCost > 0 && <><dt>추가 공사 원가</dt><dd className="deduction">-{won.format(numbers.additionalConstructionCost)}원</dd></>}{numbers.internalCost > 0 && <><dt>내부 원가 합계</dt><dd className="deduction">-{won.format(numbers.internalCost)}원</dd></>}<dt>최종 총이익</dt><dd>{won.format(numbers.margin)}원</dd><dt>마진%</dt><dd>{(numbers.marginRate * 100).toFixed(1)}%</dd></dl></section>
            <div className="quote-internal-report-actions"><button type="button" onClick={() => void copyInternalProfitReport()}>수익 보고 복사</button><button type="button" onClick={() => setInternalReportOpen(true)}>내부 수익표 보기</button></div>
            <label className="quotation-stamp-toggle"><input type="checkbox" checked={draft.includeStamp} onChange={(event) => setDraft({ ...draft, includeStamp: event.target.checked })} /><span>출력물에 직인 포함</span></label>
            <section className="quotation-output-spacing">
              <div><strong>출력 빈 행</strong><small>Excel·PDF 공통 · 기본 빈 행은 자동 제거</small></div>
              <div><button type="button" aria-label="출력 빈 행 줄이기" disabled={outputBlankRows === 0} onClick={() => setOutputBlankRows((current) => Math.max(0, current - 1))}>−</button><b>{outputBlankRows}행</b><button type="button" aria-label="출력 빈 행 늘리기" disabled={outputBlankRows >= 5} onClick={() => setOutputBlankRows((current) => Math.min(5, current + 1))}>＋</button></div>
            </section>
            <p>내부 수익·수수료 정보는 인쇄 및 PDF 화면에 표시되지 않습니다.</p>
            <div className="quotation-editor-actions">{draft.id && draft.status === "final"
              ? <button className="app-button app-button-primary" type="button" onClick={() => void save("final")} disabled={saving}>{saving ? "저장 중…" : "견적 수정 저장"}</button>
              : <><button className="app-button app-button-secondary" type="button" onClick={() => void save("draft")} disabled={saving}>임시 저장</button><button className="app-button app-button-primary" type="button" onClick={() => void save("final")} disabled={saving}>최종 저장</button></>}
            </div>
          </aside>
        </div>

        {internalReportOpen && <div className="quote-internal-report-shell no-print" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setInternalReportOpen(false); }}>
          <section className="quote-internal-report-dialog" role="dialog" aria-modal="true" aria-labelledby="internal-profit-report-title">
            <header><div><span className="section-kicker">INTERNAL PROFIT REPORT</span><h3 id="internal-profit-report-title">내부 수익표</h3><p>{draft.organization} · {draft.projectTitle || `${draft.businessRound}차 사업`} · {draft.quoteNumber || "저장 전"}</p></div><button type="button" aria-label="닫기" onClick={() => setInternalReportOpen(false)}>×</button></header>
            <div className="quote-internal-report-summary"><span>견적금액 <b>{won.format(numbers.total)}원</b></span><span>최종 총이익 <b>{won.format(numbers.margin)}원</b></span><span>마진율 <b>{(numbers.marginRate * 100).toFixed(1)}%</b></span></div>
            <div className="quote-internal-report-table"><table><thead><tr><th>No</th><th>품목</th><th>견적금액</th><th>예상 수익</th><th>컨소 지급</th><th>내부 원가</th><th>품목 순이익</th></tr></thead><tbody>{internalReportRows.map((row) => <tr key={`${row.number}-${row.name}`}><td>{row.number}</td><td>{row.name}</td><td>{won.format(row.amount)}원</td><td>{won.format(row.earning)}원</td><td>{row.consortium ? `-${won.format(row.consortium)}원` : "0원"}</td><td>{row.internalCost ? `-${won.format(row.internalCost)}원` : "0원"}</td><td>{won.format(row.netProfit)}원</td></tr>)}</tbody></table></div>
            {numbers.additionalConstructionCost > 0 && <p className="quote-internal-report-deduction">별도 추가 공사 원가 -{won.format(numbers.additionalConstructionCost)}원은 최종 총이익에 반영되었습니다.</p>}
            <footer><button type="button" onClick={downloadInternalProfitCsv}>Excel용 CSV</button><button type="button" onClick={printInternalProfitReport}>인쇄·PDF</button><button className="primary" type="button" onClick={() => setInternalReportOpen(false)}>닫기</button></footer>
          </section>
        </div>}

        {importMode && createPortal(<QuotationImportDialog
          mode={importMode}
          revisionLabel={editingTargetLabel}
          products={products}
          equipmentKitPlan={equipmentKitEditor?.item.equipmentKit?.plan}
          existingItems={(importMode === "teaching-aids" && equipmentKitEditor?.item.equipmentKit ? equipmentKitEditor.item.equipmentKit.lines.map((line) => ({
            id: line.id,
            productId: "",
            name: line.name,
            specification: "",
            procurementNumber: "",
          })) : draft.items.filter((item) => !isConstructionItem(item)).map((item) => ({
            id: item.id,
            productId: item.productId,
            name: item.name,
            specification: item.specification,
            procurementNumber: item.procurementNumber,
          })))}
          onClose={() => setImportMode(null)}
          onApply={applyExternalQuotation}
        />, document.body)}

        {equipmentKitEditor?.item.equipmentKit && <div className="equipment-kit-editor-shell no-print" role="presentation">
          <section className="equipment-kit-editor" role="dialog" aria-modal="true" aria-labelledby="equipment-kit-title">
            <header>
              <div><h3 id="equipment-kit-title">교구 세트 구성</h3><p>기본안을 불러온 뒤 수량·단위·단가를 조정하고 필요한 품목을 추가합니다.</p></div>
              <button type="button" aria-label="교구 세트 구성 닫기" onClick={() => setEquipmentKitEditor(null)}>×</button>
            </header>
            <div className="equipment-kit-plan">
              <strong>기본 구성안</strong>
              <div>
                {(["one", "two"] as const).map((plan) => <button key={plan} type="button" className={equipmentKitEditor.item.equipmentKit?.plan === plan ? "active" : ""} onClick={() => {
                  if (equipmentKitEditor.item.equipmentKit?.plan === plan) return;
                  if (window.confirm("기본 품목의 수정값을 선택한 구성안으로 다시 불러올까요? 직접 추가한 품목은 유지됩니다.")) selectEquipmentKitPlan(plan);
                }}>{plan === "one" ? "표준 1세트" : "표준 2세트"}</button>)}
              </div>
              <span>기본값 자동 입력 · 모든 수량·단위·단가 수정 가능</span>
            </div>
            <div className="equipment-kit-guide">수량이 0인 품목은 입력창에는 유지되고, 견적 합계와 Excel·PDF 별첨에서는 자동 제외됩니다.</div>
            <div className="equipment-kit-toolbar">
              <strong>세부 품목 {equipmentKitEditor.item.equipmentKit.lines.length}개</strong>
              <div><label><input type="checkbox" checked={equipmentKitHideZero} onChange={(event) => setEquipmentKitHideZero(event.target.checked)} /> 수량 0 숨기기</label><button type="button" onClick={() => setImportMode("teaching-aids")}>교구 견적서 불러오기</button><button type="button" onClick={addEquipmentKitLine}>+ 품목 추가</button></div>
            </div>
            <div className="equipment-kit-table-wrap">
              <table>
                <thead><tr><th>No</th><th>품명</th><th>수량</th><th>단위</th><th>단가</th><th>금액</th><th>출력</th><th>관리</th></tr></thead>
                <tbody>{equipmentKitEditor.item.equipmentKit.lines.map((line, index) => {
                  if (equipmentKitHideZero && line.quantity === 0) return null;
                  return <tr key={line.id} className={line.quantity === 0 ? "zero" : line.custom ? "custom" : ""}>
                    <td>{index + 1}</td>
                    <td>{line.custom ? <input value={line.name} onChange={(event) => updateEquipmentKitLine(line.id, { name: event.target.value })} placeholder="품목명 입력" aria-label={`${index + 1}번 추가 품목명`} /> : line.name}</td>
                    <td><input type="number" min="0" step="1" value={line.quantity} onChange={(event) => updateEquipmentKitLine(line.id, { quantity: Math.max(0, Math.round(Number(event.target.value) || 0)) })} aria-label={`${line.name || `${index + 1}번 품목`} 수량`} /></td>
                    <td><select value={line.unit} onChange={(event) => updateEquipmentKitLine(line.id, { unit: event.target.value })} aria-label={`${line.name || `${index + 1}번 품목`} 단위`}><option>EA</option><option>SET</option><option>개</option><option>식</option><option>대</option></select></td>
                    <td><FormattedMoneyInput value={line.unitPrice} onChange={(unitPrice) => updateEquipmentKitLine(line.id, { unitPrice })} label={`${line.name || `${index + 1}번 품목`} 단가`} /></td>
                    <td>{won.format(line.quantity * line.unitPrice)}원</td>
                    <td>{line.quantity > 0 ? "포함" : "제외"}</td>
                    <td>{line.custom ? <button type="button" className="remove" onClick={() => {
                      const equipmentKit: AirpassEquipmentKit = { ...equipmentKitEditor.item.equipmentKit!, lines: equipmentKitEditor.item.equipmentKit!.lines.filter((item) => item.id !== line.id) };
                      setEquipmentKitEditor({ ...equipmentKitEditor, item: { ...equipmentKitEditor.item, unitPrice: airpassEquipmentKitTotal(equipmentKit), equipmentKit } });
                    }}>삭제</button> : "—"}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div className="equipment-kit-total"><span>견적·별첨에 포함되는 교구 합계</span><strong>{won.format(airpassEquipmentKitTotal(equipmentKitEditor.item.equipmentKit))}원</strong></div>
            <footer><button type="button" onClick={() => setEquipmentKitEditor(null)}>취소</button><button type="button" className="primary" onClick={applyEquipmentKit}>이 구성으로 견적에 적용</button></footer>
          </section>
        </div>}

        {printPortalReady ? createPortal(<section className="quotation-print-stack quotation-print-portal print-only" aria-label="관공서 제출용 견적서 인쇄본">
          {printItemPages.map((pageItems, pageIndex) => {
            const isFirstPage = pageIndex === 0;
            const isLastPage = pageIndex === printItemPages.length - 1;
            return <article className="quotation-print-sheet" key={`print-page-${pageIndex}`}>
              {isFirstPage ? <>
                <header className="quotation-print-header">
                  <img src="/whizzup-logo.png" alt="WHIZZUP" />
                  <h1>견 적 서</h1>
                  <dl><dt>견적번호</dt><dd>{draft.quoteNumber || "저장 시 발급"}</dd><dt>작성일</dt><dd>{draft.quoteDate}</dd></dl>
                </header>
                <div className="quotation-print-parties">
                  <section><h2>받는 분</h2><dl><dt>수신</dt><dd>{draft.organization || "미지정"}</dd><dt>담당자</dt><dd>담당자 귀하</dd><dt>견적명</dt><dd>{draft.projectTitle || "제품 공급"}</dd><dt>유효기간</dt><dd>{draft.validUntil ? `${draft.validUntil}까지` : "견적일로부터 30일"}</dd><dt>납품조건</dt><dd>발주 후 일정 협의</dd></dl></section>
                  <section><h2>공급자</h2><dl><dt>상호</dt><dd>주식회사 위즈업</dd><dt>사업자번호</dt><dd>286-86-03454</dd><dt>대표자</dt><dd>박원석</dd><dt>주소</dt><dd>경기도 하남시 하남대로 947, D동 1208호(풍산동)</dd><dt>업태·종목</dt><dd>도매 및 소매업 · 정보통신업 / 컴퓨터 및 주변장치 공급</dd></dl></section>
                </div>
                <div className="quotation-print-total"><span>견적금액 (VAT 포함 · 조달수수료 반영)</span><b>{amountInKoreanLabel(numbers.total)}</b><strong>{won.format(numbers.total)}원</strong></div>
              </> : <header className="quotation-print-continuation"><img src="/whizzup-logo.png" alt="WHIZZUP" /><div><h1>견적서 품목 계속</h1><p>{draft.organization} · {draft.businessRound}차</p></div><span>{pageIndex + 1} / {printItemPages.length}</span></header>}
              <table className="quotation-print-items">
                <colgroup><col className="no" /><col className="name" /><col className="spec" /><col className="procurement" /><col className="quantity" /><col className="unit" /><col className="price" /><col className="amount" /><col className="note" /></colgroup>
                <thead><tr><th>No</th><th>품명</th><th>규격</th><th>식별번호</th><th>수량</th><th>단위</th><th>단가</th><th>금액</th><th>비고</th></tr></thead>
                <tbody>{pageItems.map((item, rowIndex) => {
                  const itemIndex = pageIndex * 6 + rowIndex;
                  return <tr key={item?.id || `empty-${itemIndex}`}><td>{item ? itemIndex + 1 : ""}</td><td>{item?.name || ""}</td><td>{item?.specification || ""}</td><td>{item ? procurementDisplay(item) : ""}</td><td>{item?.quantity || ""}</td><td>{item?.unit || ""}</td><td>{item ? `${won.format(item.unitPrice)}원` : ""}</td><td>{item ? `${won.format(item.quantity * item.unitPrice)}원` : ""}</td><td>{item ? outputNote(item) : ""}</td></tr>;
                })}</tbody>
              </table>
              {isLastPage ? <div className="quotation-print-closing">
                <div className="quotation-print-bottom">
                  <section><h2>견적 조건 및 특이사항</h2><dl><dt>견적 유효기간</dt><dd>{draft.validUntil ? `${draft.validUntil}까지` : "견적일로부터 30일"}</dd><dt>납품 및 설치</dt><dd>발주기관과 일정 협의 후 진행</dd><dt>대금 지급</dt><dd>발주기관의 지급 조건에 따름</dd><dt>하자보증</dt><dd>납품 완료일로부터 1년</dd><dt>비고</dt><dd>표시 단가는 VAT·일반 수수료 포함, 조달수수료는 합계에 별도 반영</dd><dt>담당</dt><dd>위즈업 영업팀</dd><dt>안내</dt><dd>{draft.memo || "본 견적서는 관공서 제출용입니다."}</dd></dl></section>
                  <section><h2>금액 요약</h2><dl><dt>품목 합계 (VAT 포함)</dt><dd>{won.format(numbers.subtotal)}원</dd><dt>조달수수료</dt><dd>{won.format(numbers.procurementFee)}원</dd><dt>할인</dt><dd>{draft.discountAmount ? `${won.format(draft.discountAmount)}원` : "-"}</dd><dt>추가비용</dt><dd>{draft.extraAmount ? `${won.format(draft.extraAmount)}원` : "-"}</dd><dt>공급가액</dt><dd>{won.format(numbers.supply)}원</dd><dt>부가가치세</dt><dd>{won.format(numbers.tax)}원</dd><dt>최종 합계</dt><dd>{won.format(numbers.total)}원</dd></dl></section>
                </div>
                <footer className="quotation-print-signature"><div>위와 같이 견적합니다.<br /><b>{draft.quoteDate.replace(/-(0?\d+)-(0?\d+)$/, "년 $1월 $2일")}</b></div><div><strong>주식회사 위즈업<br />대표이사&nbsp;&nbsp;박 원 석</strong>{draft.includeStamp && <img src="/whizzup-seal.png" alt="위즈업 직인" />}</div></footer>
              </div> : <footer className="quotation-print-page-more">다음 페이지에 품목이 계속됩니다.</footer>}
            </article>;
          })}
          {equipmentKitPrintPages.map((kitPage, kitPageIndex) => <article className="quotation-print-sheet equipment-kit-print-sheet" key={`kit-print-${kitPage.item.id}-${kitPage.page}`}>
            <header className="equipment-kit-print-header">
              <img src="/whizzup-logo.png" alt="WHIZZUP" />
              <div><h1>교 구 세 부 견 적</h1><p>{draft.organization || "미지정"} · {kitPage.item.equipmentKit?.plan === "two" ? "표준 2세트" : "표준 1세트"} 기준안</p></div>
              <dl><dt>견적번호</dt><dd>{draft.quoteNumber || "저장 시 발급"}</dd><dt>작성일</dt><dd>{draft.quoteDate}</dd></dl>
            </header>
            <div className="equipment-kit-print-band">에어패스 교구 세부내역 · 수량 0 품목 제외</div>
            <table className="equipment-kit-print-table">
              <colgroup><col className="no" /><col className="name" /><col className="quantity" /><col className="unit" /><col className="price" /><col className="amount" /><col className="note" /></colgroup>
              <thead><tr><th>No</th><th>품명</th><th>수량</th><th>단위</th><th>단가</th><th>금액</th><th>비고</th></tr></thead>
              <tbody>{kitPage.lines.map((line, lineIndex) => <tr key={line.id}><td>{(kitPage.page - 1) * 15 + lineIndex + 1}</td><td>{line.name}</td><td>{line.quantity}</td><td>{line.unit}</td><td>{won.format(line.unitPrice)}원</td><td>{won.format(line.quantity * line.unitPrice)}원</td><td /></tr>)}</tbody>
            </table>
            {kitPage.page === kitPage.pages && <div className="equipment-kit-print-total"><span>합계금액 (VAT 포함)</span><strong>{won.format(airpassEquipmentKitTotal(kitPage.item.equipmentKit))}원</strong></div>}
            <footer className="equipment-kit-print-footer"><span>주식회사 위즈업 · 본 세부견적은 본 견적서와 함께 제출됩니다.</span><b>별첨 {kitPageIndex + 1}</b></footer>
          </article>)}
        </section>, document.body) : null}
      </div>
    </div>}
  </section>;
}
