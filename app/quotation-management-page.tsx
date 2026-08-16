"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
const PDF_WORKER_URL = "/pdf.worker.min.mjs";
import type {
  AuthoredQuotation,
  AuthoredQuotationBudget,
  AuthoredQuotationItem,
  AuthoredQuotationSettlementAdjustment,
} from "../lib/authored-quotations";
import type { ProductCatalogItem } from "../lib/product-catalog";
import { parseBudgetMoney } from "../lib/activity-budgets";
import { createQuotationWorkbook } from "../lib/quotation-xlsx";
import { AIRPASS_COMPANY, AIRPASS_EQUIPMENT_CONTRACT_NOTE } from "../lib/airpass-company";
import { calculateConsortiumSettlement } from "../lib/consortium-settlement";
import { createConsortiumSettlementWorkbook, type ConsortiumSettlementWorkbookInput } from "../lib/consortium-settlement-xlsx";
import { createInternalProfitReportWorkbook, type InternalProfitReportWorkbookInput } from "../lib/internal-profit-report-xlsx";
import { createConsortiumSettlementPdf, createInternalProfitReportPdf } from "./consortium-settlement-pdf";
import { hasProcurementSignal, procurementNumbersFromText } from "../lib/procurement-product";
import { createAuthoredQuotationPdf } from "./authored-quotation-pdf";
import { quotationDownloadName } from "../lib/quotation-file-name";
import { originalQuotationDateByRoot, quotationListDateLabels } from "../lib/quotation-list-dates";
import {
  contentSubstitutionBaseEarningRate,
  contentSubstitutionMargin,
  quotationInternalCostDefaults,
  quotationInternalCostKind,
} from "../lib/quotation-internal-costs";
import { directPurchaseLimitWarning, procurementContractWarnings } from "../lib/procurement-contract-warning";
import { applyCatalogSuppliers } from "../lib/quotation-supplier";
import {
  airpassEquipmentKitOutputLines,
  airpassEquipmentKitTotal,
  createAirpassEquipmentKit,
  createAirpassEquipmentKitFromPlan,
  defaultAirpassEquipmentKitPlans,
  isAirpassEquipmentKitProduct,
  type AirpassEquipmentKit,
  type AirpassEquipmentKitPlan,
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
  executionType?: string;
  consortiumCompany?: string;
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
  supplierVendorId: number | null;
  supplierVendorName: string;
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
  projectTitleTouched?: boolean;
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
  settlementAdjustments: AuthoredQuotationSettlementAdjustment[];
};

type EquipmentKitEditor = {
  item: DraftItem;
  editingItemId?: string;
};

type RecentConsortiumRate = {
  rate: number;
  quoteNumber: string;
  quoteDate: string;
};

const won = new Intl.NumberFormat("ko-KR");
const CONSTRUCTION_PRODUCT_ID = "__construction_cost__";

function isConstructionItem(item: Pick<DraftItem, "productId">) {
  return item.productId === CONSTRUCTION_PRODUCT_ID;
}

function supportsTeachingAidDiscount(item: Pick<DraftItem, "name" | "specification" | "equipmentKit">) {
  const text = `${item.name} ${item.specification}`.replace(/\s/g, "").toLocaleLowerCase("ko-KR");
  return Boolean(item.equipmentKit) || isAirpassEquipmentKitProduct(item.name) || text.includes("교구");
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
  if (item.complimentary) return "무상 제공";
  if (item.equipmentKit) return AIRPASS_EQUIPMENT_CONTRACT_NOTE;
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
    internalCostBearer: "consortium",
  };
}

function normalizedInstitutionName(value: string) {
  return value.replace(/\s/g, "").toLocaleLowerCase("ko-KR");
}

function internalCostFields(name: string, specification = "", quantity = 1) {
  const defaults = quotationInternalCostDefaults(name, specification, quantity);
  return {
    internalCostEnabled: defaults.enabled,
    internalCostAmount: defaults.amount,
    internalCostBearer: "consortium" as const,
    internalCostQuantity: defaults.quantity,
    internalCostUnitAmount: defaults.unitAmount,
    internalCostAutoQuantity: defaults.autoQuantity,
  };
}

function isContentSubstitutionItem(item: Pick<DraftItem, "name" | "specification" | "internalCostEnabled">) {
  return item.internalCostEnabled && quotationInternalCostKind(item.name, item.specification) === "content-substitution";
}

function draftItemExpectedEarning(item: DraftItem) {
  const lineAmount = Math.max(0, item.quantity) * Math.max(0, item.unitPrice);
  return isContentSubstitutionItem(item)
    ? contentSubstitutionMargin(lineAmount, item.internalCostAmount, contentSubstitutionBaseEarningRate(item))
    : Math.floor(lineAmount * Math.max(0, item.earningRate) / 10) * 10;
}

function normalizedEquipmentKitName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function draftItemLookupKeys(item: Pick<DraftItem, "productId" | "procurementNumber" | "name" | "specification">) {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/g, "");
  return [
    item.productId && item.productId !== CONSTRUCTION_PRODUCT_ID ? `product:${item.productId}` : "",
    item.procurementNumber ? `procurement:${normalize(item.procurementNumber)}` : "",
    item.name ? `item:${normalize(item.name)}|${normalize(item.specification)}` : "",
  ].filter(Boolean);
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
  projectTitleTouched: false,
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
  settlementAdjustments: [],
});

function budgetOptionsForInstitution(option?: QuotationInstitutionOption): AuthoredQuotationBudget[] {
  if (!option) return [];
  const source = option.budgets?.length
    ? option.budgets
    : option.budgetType
      ? [{ budgetType: option.budgetType }]
      : [];
  const seen = new Set<string>();
  return source.flatMap((budget) => {
    const name = String(budget.budgetType || budget.budgetOriginalName || "").trim();
    if (!name) return [];
    const groupId = Number(budget.budgetGroupId);
    const budgetGroupId = Number.isSafeInteger(groupId) && groupId > 0 ? groupId : null;
    const key = budgetGroupId
      ? `group:${budgetGroupId}`
      : `name:${name.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, "")}`;
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

function mergeInstitutionRounds(options: QuotationInstitutionOption[]) {
  const rounds = new Map<number, QuotationInstitutionOption>();
  options.forEach((option) => {
    const current = rounds.get(option.businessRound);
    if (!current) {
      rounds.set(option.businessRound, { ...option, budgets: [...(option.budgets ?? [])] });
      return;
    }
    const combined = [...(current.budgets?.length ? current.budgets : current.budgetType ? [{ budgetType: current.budgetType }] : []),
      ...(option.budgets?.length ? option.budgets : option.budgetType ? [{ budgetType: option.budgetType }] : [])];
    rounds.set(option.businessRound, {
      ...current,
      budgetType: "",
      budgets: combined,
      executionType: current.executionType === "컨소" || option.executionType === "컨소" ? "컨소" : current.executionType,
      consortiumCompany: current.consortiumCompany?.trim() || option.consortiumCompany?.trim() || "",
    });
  });
  return Array.from(rounds.values()).sort((left, right) => left.businessRound - right.businessRound);
}

function institutionCollaborationDefaults(option?: QuotationInstitutionOption) {
  const consortiumCompany = String(option?.consortiumCompany ?? "").trim();
  if (option?.executionType === "컨소" && consortiumCompany) {
    return { executionType: "컨소" as const, consortiumCompany };
  }
  return { executionType: "직영" as const, consortiumCompany: "" };
}

function draftForScope(scope?: QuotationScope): Draft {
  const budgetOptions = budgetOptionsForInstitution(scope);
  const collaboration = institutionCollaborationDefaults(scope);
  return {
    ...emptyDraft(),
    organization: scope?.organization ?? "",
    businessRound: scope?.businessRound ?? 1,
    projectTitle: scope?.budgetType ?? "",
    budgets: budgetOptions.length === 1 ? budgetOptions : [],
    ...collaboration,
  };
}

function draftFromQuotation(quote: AuthoredQuotation): Draft {
  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    organization: quote.organization,
    businessRound: quote.businessRound,
    projectTitle: quote.projectTitle,
    projectTitleTouched: true,
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
    settlementAdjustments: quote.settlementAdjustments,
    items: quote.items.map(({ amount: _amount, expectedEarning: _earning, ...item }) => ({
      ...item,
      id: item.id,
    })),
  };
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, "_") || "미지정";
}

function downloadBytes(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  downloadBlob(blob, name);
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function renderGeneratedPdfPages(file: File) {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  const source = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: source }).promise;
  const pageUrls: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(4, 2800 / Math.max(natural.width, natural.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("PDF 미리보기 화면을 준비하지 못했습니다.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PDF 페이지 이미지를 만들지 못했습니다.")), "image/png"));
      pageUrls.push(URL.createObjectURL(blob));
      page.cleanup();
      canvas.width = 1;
      canvas.height = 1;
    }
    return pageUrls;
  } catch (error) {
    pageUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  } finally {
    await pdf.destroy();
  }
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
  const [recentConsortiumRates, setRecentConsortiumRates] = useState<Record<string, RecentConsortiumRate>>({});
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
  const [equipmentKitPlans, setEquipmentKitPlans] = useState<AirpassEquipmentKitPlan[]>(defaultAirpassEquipmentKitPlans());
  const [canManageEquipmentKitPlans, setCanManageEquipmentKitPlans] = useState(false);
  const [equipmentKitPlansSaving, setEquipmentKitPlansSaving] = useState(false);
  const [equipmentKitHideZero, setEquipmentKitHideZero] = useState(false);
  const [equipmentKitRecoveryId, setEquipmentKitRecoveryId] = useState("");
  const [dragOverItemId, setDragOverItemId] = useState("");
  const [importMode, setImportMode] = useState<QuotationImportMode | null>(null);
  const [importSourceFile, setImportSourceFile] = useState<File | null>(null);
  const [internalReportOpen, setInternalReportOpen] = useState(false);
  const [settlementPrintPages, setSettlementPrintPages] = useState<string[]>([]);
  const [settlementPrintPreparing, setSettlementPrintPreparing] = useState(false);
  const draftRef = useRef<Draft | null>(null);
  const collaborationTouchedRef = useRef(false);
  const draggedItemIdRef = useRef("");
  const editorHistoryActiveRef = useRef(false);
  const duplicateFileReconcileRef = useRef(false);
  const quotationFileJobsRef = useRef(new Set<number>());
  const productSearchRef = useRef<HTMLDivElement | null>(null);
  const productSearchResultsRef = useRef<HTMLDivElement | null>(null);

  function quotationRegion(quote: Pick<Draft, "organization" | "businessRound">) {
    return institutions.find((item) =>
      normalizedInstitutionName(item.organization) === normalizedInstitutionName(quote.organization)
      && item.businessRound === quote.businessRound
    )?.region || newInstitution.region || "";
  }

  useEffect(() => { draftRef.current = draft; }, [draft]);

  useEffect(() => () => settlementPrintPages.forEach((url) => URL.revokeObjectURL(url)), [settlementPrintPages]);

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
    collaborationTouchedRef.current = Boolean(nextDraft.id);
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
      if (document.body.classList.contains("settlement-printing") || document.body.classList.contains("internal-profit-printing")) return;
      if (document.querySelector(".quotation-print-portal")) {
        document.body.classList.add("quotation-printing");
      }
    };
    const finishPrint = () => {
      const settlementPrinting = document.body.classList.contains("settlement-printing");
      document.body.classList.remove("quotation-printing", "settlement-printing", "internal-profit-printing");
      if (settlementPrinting) setSettlementPrintPages([]);
    };
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
    const portal = document.querySelector<HTMLElement>(".quotation-print-portal");
    const popup = window.open("", "whizzup-quotation-print", "popup=yes,width=1100,height=900");
    if (!portal || !popup) {
      popup?.close();
      window.print();
      setMessage("팝업이 차단되어 현재 창에서 인쇄 화면을 열었습니다.");
      return;
    }
    const styles = Array.from(document.head.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style'))
      .map((node) => node.outerHTML)
      .join("");
    let printStarted = false;
    const startPrint = () => {
      if (printStarted || popup.closed) return;
      printStarted = true;
      popup.focus();
      popup.print();
    };
    popup.addEventListener("afterprint", () => popup.close(), { once: true });
    const printTitle = quotationDownloadName({
      ...draft,
      region: quotationRegion(draft),
    }, "pdf").replace(/\.pdf$/iu, "");
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><base href="${window.location.origin}/"><title>${printTitle}</title>${styles}</head><body class="quotation-printing">${portal.outerHTML}</body></html>`);
    popup.document.close();
    popup.addEventListener("load", () => window.setTimeout(startPrint, 250), { once: true });
    window.setTimeout(startPrint, 800);
    setMessage("견적서 인쇄 전용 창을 열었습니다. 닫아도 영업관리 화면은 유지됩니다.");
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
      const [quoteResponse, trashResponse, productResponse, equipmentKitPlansResponse] = await Promise.all([
        fetch(quoteUrl, { cache: "no-store" }),
        fetch(`/api/quotations?${trashParams}`, { cache: "no-store" }),
        fetch("/api/product-catalog", { cache: "no-store" }),
        fetch("/api/equipment-kit-plans", { cache: "no-store" }),
      ]);
      const quotePayload = await quoteResponse.json() as { quotations?: AuthoredQuotation[]; recentConsortiumRates?: Record<string, RecentConsortiumRate>; error?: string };
      const trashPayload = await trashResponse.json() as { quotations?: AuthoredQuotation[]; error?: string };
      const productPayload = await productResponse.json() as { products?: ProductCatalogItem[]; favoriteProductIds?: unknown[]; error?: string };
      const equipmentKitPlansPayload = await equipmentKitPlansResponse.json() as { plans?: AirpassEquipmentKitPlan[]; canManage?: boolean; error?: string };
      if (!quoteResponse.ok) throw new Error(quotePayload.error || "견적서를 불러오지 못했습니다.");
      if (!trashResponse.ok) throw new Error(trashPayload.error || "삭제된 견적서를 불러오지 못했습니다.");
      if (!productResponse.ok) throw new Error(productPayload.error || "제품을 불러오지 못했습니다.");
      setQuotes(quotePayload.quotations ?? []);
      setRecentConsortiumRates(quotePayload.recentConsortiumRates ?? {});
      setTrashedQuotes(trashPayload.quotations ?? []);
      setProducts(productPayload.products ?? []);
      setFavoriteProductIds((productPayload.favoriteProductIds ?? []).map(String));
      if (equipmentKitPlansResponse.ok && equipmentKitPlansPayload.plans?.length) {
        setEquipmentKitPlans(equipmentKitPlansPayload.plans);
        setCanManageEquipmentKitPlans(Boolean(equipmentKitPlansPayload.canManage));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [scope?.businessRound, scope?.organization, equipmentRefreshVersion]);

  useEffect(() => {
    quotes
      .filter((quote) => quote.driveSyncStatus === "queued" && !quotationFileJobsRef.current.has(quote.id))
      .forEach((quote) => { void processQuotationFiles(quote); });
  // File processing is resumed from durable queued rows whenever the list is refreshed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes]);

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

  const originalQuoteDates = useMemo(() => originalQuotationDateByRoot(quotes), [quotes]);

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
    if (loading) return;
    onCountChange?.({ active: currentQuotes.length, trash: trashedQuotes.length });
  }, [currentQuotes.length, loading, onCountChange, trashedQuotes.length]);

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
    () => mergeInstitutionRounds(institutions.filter((item) => normalizedInstitutionName(item.organization) === normalizedInstitutionName(draft?.organization ?? ""))),
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
    if (!draft) return { subtotal: 0, adjusted: 0, supply: 0, tax: 0, procurementFee: 0, total: 0, earning: 0, consortiumGross: 0, consortiumCost: 0, consortiumAdjustmentAdditions: 0, consortiumAdjustmentDeductions: 0, consortium: 0, projectorInstallationCost: 0, yogaMatServiceCost: 0, teachingAidSupportCost: 0, itemInternalCost: 0, additionalConstructionCost: 0, internalCost: 0, margin: 0, marginRate: 0 };
    const subtotal = draft.items.reduce((sum, item) => sum + (item.complimentary ? 0 : Math.max(0, item.quantity) * Math.max(0, item.unitPrice)), 0);
    const adjusted = Math.max(0, subtotal - Math.max(0, draft.discountAmount) + Math.max(0, draft.extraAmount));
    const supply = Math.round(adjusted / 1.1);
    const tax = adjusted - supply;
    const procurementFee = draft.items.reduce((sum, item) => sum + (!item.complimentary && appliesProcurementFee(item) ? Math.floor(item.quantity * item.unitPrice * item.procurementFeeRate / 10) * 10 : 0), 0);
    const earning = draft.items.reduce((sum, item) => sum + (item.complimentary ? 0 : draftItemExpectedEarning(item)), 0);
    const settlement = calculateConsortiumSettlement(draft.items, draft.executionType, draft.settlementAdjustments);
    const consortiumGross = settlement.grossPayment;
    const consortiumCost = settlement.consortiumCost;
    const consortium = settlement.finalPayment;
    const projectorInstallationCost = draft.items.reduce((sum, item) => sum + (
      quotationInternalCostKind(item.name, item.specification) === "projector-installation" && item.internalCostEnabled
        && (draft.executionType !== "컨소" || item.internalCostBearer === "whizzup")
        ? Math.max(0, item.internalCostAmount)
        : 0
    ), 0);
    const yogaMatServiceCost = draft.items.reduce((sum, item) => sum + (
      quotationInternalCostKind(item.name, item.specification) === "aifit-yoga-mat" && item.internalCostEnabled
        && (draft.executionType !== "컨소" || item.internalCostBearer === "whizzup")
        ? Math.max(0, item.internalCostAmount)
        : 0
    ), 0);
    const itemInternalCost = settlement.whizzupCost;
    const teachingAidSupportCost = draft.items.reduce((sum, item) => sum + Math.max(0, item.teachingAidSupportAmount ?? 0), 0);
    const additionalConstructionCost = Math.max(0, draft.additionalInternalConstructionCost);
    const internalCost = itemInternalCost + teachingAidSupportCost + additionalConstructionCost;
    const margin = earning - consortium - internalCost;
    return { subtotal, adjusted, supply, tax, procurementFee, total: adjusted + procurementFee, earning, consortiumGross, consortiumCost, consortiumAdjustmentAdditions: settlement.adjustmentAdditions, consortiumAdjustmentDeductions: settlement.adjustmentDeductions, consortium, projectorInstallationCost, yogaMatServiceCost, teachingAidSupportCost, itemInternalCost, additionalConstructionCost, internalCost, margin, marginRate: subtotal ? margin / subtotal : 0 };
  }, [draft]);

  const internalReportRows = useMemo(() => (draft?.items ?? []).map((item, index) => {
    const lineAmount = item.complimentary ? 0 : Math.max(0, item.quantity) * Math.max(0, item.unitPrice);
    const contentSubstitution = isContentSubstitutionItem(item);
    const baseRate = contentSubstitution ? contentSubstitutionBaseEarningRate(item) : Math.max(0, item.earningRate);
    const baseEarning = Math.floor(lineAmount * baseRate / 10) * 10;
    const earning = item.complimentary ? 0 : draftItemExpectedEarning(item);
    const grossConsortium = draft?.executionType === "컨소" && !contentSubstitution
      ? Math.min(earning, Math.floor(lineAmount * Math.max(0, item.consortiumRate) / 10) * 10)
      : 0;
    const consortiumCost = draft?.executionType === "컨소" && item.internalCostEnabled && item.internalCostBearer === "consortium"
      ? Math.max(0, item.internalCostAmount)
      : 0;
    const consortium = grossConsortium - consortiumCost;
    const teachingAidSupportCost = Math.max(0, item.teachingAidSupportAmount ?? 0);
    const internalCostDisplay = (item.internalCostEnabled ? Math.max(0, item.internalCostAmount) : 0) + teachingAidSupportCost;
    const internalCost = (!contentSubstitution && item.internalCostEnabled && (draft?.executionType !== "컨소" || item.internalCostBearer === "whizzup")
      ? Math.max(0, item.internalCostAmount)
      : 0) + teachingAidSupportCost;
    const remaining = lineAmount - internalCostDisplay;
    const formula = contentSubstitution
      ? remaining > 0
        ? `(${won.format(lineAmount)} - ${won.format(internalCostDisplay)}) × ${(baseRate * 100).toFixed(2).replace(/\.00$/, "")}%`
        : `${won.format(lineAmount)} - ${won.format(internalCostDisplay)} (초과 비용 전액 반영)`
      : `${won.format(baseEarning)} - ${won.format(consortium)} - ${won.format(internalCost)}`;
    return {
      number: index + 1,
      name: item.name || "미등록 품목",
      specification: item.specification,
      quantity: Math.max(0, item.quantity),
      unit: item.unit,
      unitPrice: Math.max(0, item.unitPrice),
      earningRate: Math.max(0, item.earningRate),
      consortiumRate: Math.max(0, item.consortiumRate),
      complimentary: Boolean(item.complimentary),
      amount: lineAmount,
      baseRate,
      baseEarning,
      earning,
      consortium,
      internalCost,
      internalCostDisplay,
      netProfit: earning - consortium - internalCost,
      formula,
      status: contentSubstitution ? "콘텐츠 대체" : teachingAidSupportCost > 0 ? "교구 할인·지원" : internalCostDisplay > 0 ? "내부 비용 반영" : "일반",
    };
  }), [draft]);

  const internalCostDetails = useMemo<NonNullable<InternalProfitReportWorkbookInput["costDetails"]>>(() => {
    const details: NonNullable<InternalProfitReportWorkbookInput["costDetails"]> = [];
    for (const item of draft?.items ?? []) {
      const costKind = quotationInternalCostKind(item.name, item.specification);
      const contentSubstitution = isContentSubstitutionItem(item);
      const itemCost = item.internalCostEnabled ? Math.max(0, item.internalCostAmount) : 0;
      if (contentSubstitution && itemCost > 0) {
        const baseRate = contentSubstitutionBaseEarningRate(item);
        const remainingAmount = (item.complimentary ? 0 : Math.max(0, item.quantity) * Math.max(0, item.unitPrice)) - itemCost;
        details.push({
          label: "콘텐츠 대체(바이패스)",
          itemName: item.name,
          amount: itemCost,
          note: remainingAmount > 0
            ? `대체 비용 반영 · 남은 금액에 ${(baseRate * 100).toFixed(1)}% 수수료 적용`
            : "대체 비용 반영",
          category: "bypass",
        });
      } else if (itemCost > 0 && (draft?.executionType !== "컨소" || item.internalCostBearer === "whizzup")) {
        details.push({
          label: costKind === "projector-installation"
            ? "빔·비디오프로젝터 설치비"
            : costKind === "aifit-yoga-mat"
              ? "요가매트 제공 비용"
              : "품목 내부 원가",
          itemName: item.name,
          amount: itemCost,
          note: "최종 총이익 차감",
          category: "internal-cost",
        });
      }
      const teachingAidSupport = Math.max(0, item.teachingAidSupportAmount ?? 0);
      if (teachingAidSupport > 0) {
        details.push({
          label: "교구 할인·지원 차감",
          itemName: item.name,
          amount: teachingAidSupport,
          note: "내부 마진 차감",
          category: "support",
        });
      }
    }
    const constructionCost = Math.max(0, draft?.additionalInternalConstructionCost ?? 0);
    if (constructionCost > 0) {
      details.push({
        label: "추가 공사비",
        itemName: "추가 공사비",
        amount: constructionCost,
        note: "내부 수익 차감",
        category: "internal-cost",
      });
    }
    return details;
  }, [draft]);

  function internalProfitReportText() {
    if (!draft) return "";
    return [
      `[위즈업 내부 수익 보고] ${draft.organization || "기관 미지정"} · ${draft.projectTitle || `${draft.businessRound}차 사업`}`,
      `견적번호: ${draft.quoteNumber || "저장 전"}`,
      `견적금액: ${won.format(numbers.total)}원`,
      `협업 구분: ${draft.executionType}${draft.executionType === "컨소" && draft.consortiumCompany ? ` · ${draft.consortiumCompany}` : ""}`,
      `예상 수익: ${won.format(numbers.earning)}원`,
      `컨소 지급: ${numbers.consortium < 0 ? "+" : "-"}${won.format(Math.abs(numbers.consortium))}원`,
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

  function internalProfitExportInput(compactView = false) {
    if (!draft) return null;
    return {
      compactView,
      organization: draft.organization,
      projectTitle: draft.projectTitle,
      quoteNumber: draft.quoteNumber || "저장 전",
      quoteDate: draft.quoteDate,
      executionType: draft.executionType,
      consortiumCompany: draft.consortiumCompany,
      total: numbers.total,
      earning: numbers.earning,
      consortium: numbers.consortium,
      internalCost: numbers.internalCost,
      margin: numbers.margin,
      marginRate: numbers.marginRate,
      costDetails: internalCostDetails,
      rows: internalReportRows.map((row) => ({ ...row, specification: row.specification ?? "" })),
    };
  }

  async function downloadInternalProfitExcel() {
    const input = internalProfitExportInput(window.matchMedia("(max-width: 700px)").matches);
    if (!input || !draft) return;
    const logoResponse = await fetch("/whizzup-logo.png");
    const logoData = logoResponse.ok ? new Uint8Array(await logoResponse.arrayBuffer()) : undefined;
    const bytes = createInternalProfitReportWorkbook({ ...input, logoData });
    downloadBytes(bytes, `${safeFileName(draft.organization)}_${draft.quoteNumber || "견적"}_내부수익표.xlsx`);
    setMessage("PDF와 같은 구성의 내부 수익표 Excel을 만들었습니다.");
  }

  async function openInternalProfitPdf() {
    const input = internalProfitExportInput();
    if (!input) return;
    const popup = window.open("", "_blank");
    try {
      const file = await createInternalProfitReportPdf(input);
      const url = URL.createObjectURL(file);
      if (popup) {
        popup.location.replace(url);
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        downloadBlob(file, file.name);
        setMessage("팝업이 차단되어 내부 수익표 PDF를 내려받았습니다.");
      }
    } catch (error) {
      popup?.close();
      setMessage(error instanceof Error ? error.message : "내부 수익표 PDF를 만들지 못했습니다.");
    }
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
  const budgetAllocationMatches = effectiveBudgets.length === 0 || budgetAllocationTotal === numbers.total;
  const procurementWarnings = useMemo(() => procurementContractWarnings(draft?.items ?? []), [draft?.items]);
  const directPurchaseWarning = useMemo(() => directPurchaseLimitWarning(draft?.items ?? []), [draft?.items]);

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
      budgets: effectiveBudgets.map((budget) => budget.key === key
        ? { ...budget, allocatedAmount: Math.max(0, Math.round(allocatedAmount)) }
        : budget),
    });
  }

  const printItemPages = useMemo(() => {
    if (!draft) return [] as Array<{ rows: (DraftItem | null)[]; startIndex: number }>;
    const rows: (DraftItem | null)[] = [...draft.items, ...Array.from({ length: outputBlankRows }, () => null)];
    const rowHeight = (item: DraftItem | null) => {
      if (!item) return 9;
      const textLines = Math.max(1, Math.ceil(item.name.length / 19), Math.ceil(item.specification.length / 28), Math.ceil(procurementDisplay(item).length / 14));
      return 9 + Math.min(3, textLines - 1) * 3;
    };
    const pages: Array<{ rows: (DraftItem | null)[]; startIndex: number }> = [];
    let cursor = 0;
    while (cursor < rows.length) {
      const first = pages.length === 0;
      const remaining = rows.slice(cursor);
      const finalCapacity = first ? 82 : 154;
      const continuationCapacity = first ? 150 : 198;
      const capacity = remaining.reduce((sum, item) => sum + rowHeight(item), 0) <= finalCapacity ? finalCapacity : continuationCapacity;
      const pageRows: (DraftItem | null)[] = [];
      let used = 0;
      for (let index = cursor; index < rows.length; index += 1) {
        const height = rowHeight(rows[index]);
        if (pageRows.length && used + height > capacity) break;
        pageRows.push(rows[index]);
        used += height;
      }
      pages.push({ rows: pageRows, startIndex: cursor });
      cursor += pageRows.length;
    }
    return pages.length ? pages : [{ rows: [], startIndex: 0 }];
  }, [draft, outputBlankRows]);

  const equipmentKitPrintPages = useMemo(() => {
    if (!draft) return [] as Array<{ item: DraftItem; lines: NonNullable<DraftItem["equipmentKit"]>["lines"]; page: number; pages: number; startIndex: number }>;
    const itemsPerPage = 16;
    return draft.items.flatMap((item) => {
      const lines = airpassEquipmentKitOutputLines(item.equipmentKit);
      if (!lines.length) return [];
      const chunks = Array.from({ length: Math.ceil(lines.length / itemsPerPage) }, (_, index) => lines.slice(index * itemsPerPage, (index + 1) * itemsPerPage));
      return chunks.map((chunk, index) => ({ item, lines: chunk, page: index + 1, pages: chunks.length, startIndex: index * itemsPerPage }));
    });
  }, [draft]);

  function openQuotation(quote: AuthoredQuotation) {
    setProductQuery("");
    setProductListMode(null);
    setOutputBlankRows(0);
    setLoadedInstitutionKey("");
    const nextDraft = draftFromQuotation(quote);
    beginEditor({
      ...nextDraft,
      items: applyCatalogSuppliers(nextDraft.items, products),
    });
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
            const supplierVendorIdValue = Number(itemValue("supplierVendorId", "supplier_vendor_id"));
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
              supplierVendorId: Number.isSafeInteger(supplierVendorIdValue) && supplierVendorIdValue > 0 ? supplierVendorIdValue : null,
              supplierVendorName: String(itemValue("supplierVendorName", "supplier_vendor_name")),
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
          supplierVendorId: item.supplierVendorId,
          supplierVendorName: item.supplierVendorName,
          earningRate: item.earningRate,
          contractType: isS2BChannel(item.procurementChannel) ? "s2b" : item.procurement ? "g2b" : "direct",
          procurement: item.procurement,
          procurementChannel: item.procurementChannel,
          procurementNumber: item.procurementNumber,
          procurementFeeRate: item.procurementFeeRate,
          consortiumRate: 0,
          ...internalCostFields(item.productName, item.specification, item.quantity),
        });
      }));
      const institutionMatch = institutions.find((item) =>
        normalizedInstitutionName(item.organization) === normalizedInstitutionName(organization)
        && item.businessRound === businessRound,
      );
      const projectTitle = targetDraft.projectTitleTouched
        ? targetDraft.projectTitle
        : targetDraft.projectTitle.trim()
          || institutionMatch?.budgetType
          || projects.find((project) => project.budgetType)?.budgetType
          || projects.find((project) => project.name)?.name
          || "";
      const equipmentItems = applyCatalogSuppliers(Array.from(itemMap.values()), products);
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
    const rounds = mergeInstitutionRounds(institutions.filter((item) => normalizedInstitutionName(item.organization) === normalizedInstitutionName(option.organization)));
    const selectedRound = rounds.reduce((latest, item) => item.businessRound > latest.businessRound ? item : latest, option);
    const collaboration = !draft.id && !collaborationTouchedRef.current
      ? institutionCollaborationDefaults(selectedRound)
      : null;
    const targetDraft = {
      ...draft,
      organization: selectedRound.organization,
      businessRound: selectedRound.businessRound,
      projectTitle: draft.projectTitleTouched ? draft.projectTitle : draft.projectTitle.trim() || selectedRound.budgetType,
      budgets: budgetOptionsForInstitution(selectedRound).length === 1 ? budgetOptionsForInstitution(selectedRound) : [],
      ...(collaboration ?? {}),
    };
    setInstitutionQuery(selectedRound.organization);
    setDraft(targetDraft);
    await loadInstitutionItems(targetDraft);
  }

  async function selectBusinessRound(businessRound: number) {
    if (!draft) return;
    const match = institutionRounds.find((item) => item.businessRound === businessRound);
    if (!match) {
      if (draft.items.length && !window.confirm("현재 작성한 품목을 비우고 새 사업 차수의 견적을 만들까요?")) return;
      setDraft({ ...draft, businessRound, items: [], budgets: [] });
      setLoadedInstitutionKey("");
      setMessage(`${draft.organization} ${businessRound}차 새 견적을 시작합니다.`);
      return;
    }
    const collaboration = !draft.id && !collaborationTouchedRef.current
      ? institutionCollaborationDefaults(match)
      : null;
    await loadInstitutionItems({
      ...draft,
      organization: match.organization,
      businessRound,
      projectTitle: draft.projectTitleTouched ? draft.projectTitle : draft.projectTitle.trim() || match.budgetType,
      budgets: budgetOptionsForInstitution(match).length === 1 ? budgetOptionsForInstitution(match) : [],
      ...(collaboration ?? {}),
    });
  }

  useEffect(() => {
    const openTransferredTarget = () => {
      const raw = window.sessionStorage.getItem("whizzup.quotationTarget");
      if (!raw) return;
      try {
        const target = JSON.parse(raw) as { id?: number; mode?: string; scope?: QuotationScope; quotation?: AuthoredQuotation };
        if (target.id) {
          const transferredQuote = target.quotation?.id === Number(target.id) ? target.quotation : undefined;
          if (transferredQuote) {
            window.sessionStorage.removeItem("whizzup.quotationTarget");
            openQuotation(transferredQuote);
            return;
          }
          if (loading) return;
          window.sessionStorage.removeItem("whizzup.quotationTarget");
          const quote = quotes.find((item) => item.id === Number(target.id));
          if (quote) openQuotation(quote);
          return;
        }
        if (target.scope?.organization) {
          window.sessionStorage.removeItem("whizzup.quotationTarget");
          setProductQuery("");
          setInstitutionQuery(target.scope.organization);
          beginEditor(draftForScope(target.scope));
        }
      } catch { /* 잘못된 임시 이동 정보는 무시합니다. */ }
    };
    openTransferredTarget();
    window.addEventListener("whizzup:quotation-target", openTransferredTarget);
    return () => window.removeEventListener("whizzup:quotation-target", openTransferredTarget);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, quotes]);

  function updateItem(id: string, changes: Partial<DraftItem>) {
    if (!draft) return;
    setDraft({
      ...draft,
      items: draft.items.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...changes };
        if (
          changes.quantity !== undefined
          && quotationInternalCostKind(next.name, next.specification) === "aifit-yoga-mat"
          && item.internalCostAutoQuantity !== false
        ) {
          const defaults = quotationInternalCostDefaults(next.name, next.specification, next.quantity);
          next.internalCostQuantity = defaults.quantity;
          next.internalCostUnitAmount = defaults.unitAmount;
          next.internalCostAmount = defaults.amount;
          next.internalCostAutoQuantity = true;
        }
        return next;
      }),
    });
  }

  function addSettlementAdjustment() {
    if (!draft) return;
    setDraft({
      ...draft,
      settlementAdjustments: [
        ...draft.settlementAdjustments,
        { id: crypto.randomUUID(), type: "deduction", label: "", amount: 0, note: "" },
      ],
    });
  }

  function updateSettlementAdjustment(id: string, changes: Partial<AuthoredQuotationSettlementAdjustment>) {
    if (!draft) return;
    setDraft({
      ...draft,
      settlementAdjustments: draft.settlementAdjustments.map((item) => item.id === id ? { ...item, ...changes } : item),
    });
  }

  function removeSettlementAdjustment(id: string) {
    if (!draft) return;
    setDraft({ ...draft, settlementAdjustments: draft.settlementAdjustments.filter((item) => item.id !== id) });
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
      procurementChannel: type === "s2b"
        ? "S2B"
        : item.contractType === "g2b" && !isS2BChannel(item.procurementChannel)
          ? item.procurementChannel || "G2B"
          : "G2B",
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
    const consortiumSuggestion = draftItemLookupKeys({
      productId: product.id,
      procurementNumber: product.procurementNumber || procurementNumbersFromText(product.note, product.specification)[0] || "",
      name: product.name,
      specification: product.specification,
    }).map((key) => recentConsortiumRates[key]).find(Boolean);
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
        supplierVendorId: product.supplierVendorId ?? null,
        supplierVendorName: product.supplierVendorName ?? "",
        earningRate,
        contractType: isS2BChannel(procurementChannel) ? "s2b" : procurement ? "g2b" : "direct",
        procurement,
        procurementChannel,
        procurementNumber: procurement ? product.procurementNumber || procurementNumbersFromText(product.note, product.specification)[0] || "" : "",
        procurementFeeRate: procurement && !isS2BChannel(procurementChannel) ? product.procurementFeeRate ?? 0.0054 : 0,
        consortiumRate: draft.executionType === "컨소"
          ? Math.min(earningRate, consortiumSuggestion?.rate ?? 0)
          : 0,
        ...internalCostFields(product.name, product.specification, 1),
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

  function setExecutionType(executionType: Draft["executionType"]) {
    if (!draft) return;
    collaborationTouchedRef.current = true;
    setDraft({
      ...draft,
      executionType,
      items: executionType === "컨소"
        ? draft.items.map((item) => {
            if (isConstructionItem(item) || item.consortiumRate > 0) return item;
            const suggestion = draftItemLookupKeys(item)
              .map((key) => recentConsortiumRates[key])
              .find(Boolean);
            return suggestion
              ? { ...item, consortiumRate: Math.min(item.earningRate, suggestion.rate) }
              : item;
          })
        : draft.items,
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
    if (!equipmentKit) {
      const defaultPlan = equipmentKitPlans.find((plan) => plan.active) ?? equipmentKitPlans[0];
      equipmentKit = defaultPlan ? createAirpassEquipmentKitFromPlan(defaultPlan) : createAirpassEquipmentKit("one");
    }
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

  function selectEquipmentKitPlan(plan: AirpassEquipmentKitPlan) {
    if (!equipmentKitEditor?.item.equipmentKit) return;
    const customLines = equipmentKitEditor.item.equipmentKit.lines.filter((line) => line.custom);
    const equipmentKit = createAirpassEquipmentKitFromPlan(plan);
    const plannedNames = new Set(equipmentKit.lines.map((line) => normalizedEquipmentKitName(line.name)));
    equipmentKit.lines.push(...customLines
      .filter((line) => !plannedNames.has(normalizedEquipmentKitName(line.name)))
      .map((line) => ({ ...line })));
    setEquipmentKitEditor({
      ...equipmentKitEditor,
      item: { ...equipmentKitEditor.item, unitPrice: airpassEquipmentKitTotal(equipmentKit), equipmentKit },
    });
  }

  async function persistEquipmentKitPlans(plans: AirpassEquipmentKitPlan[], successMessage: string) {
    setEquipmentKitPlansSaving(true);
    try {
      const response = await fetch("/api/equipment-kit-plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plans }),
      });
      const payload = await response.json() as { plans?: AirpassEquipmentKitPlan[]; error?: string };
      if (!response.ok || !payload.plans) throw new Error(payload.error || "교구 기본안을 저장하지 못했습니다.");
      setEquipmentKitPlans(payload.plans);
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "교구 기본안을 저장하지 못했습니다.");
    } finally {
      setEquipmentKitPlansSaving(false);
    }
  }

  function saveCurrentEquipmentKitAsPlan() {
    const equipmentKit = equipmentKitEditor?.item.equipmentKit;
    if (!equipmentKit) return;
    const name = window.prompt("새 기본안 이름을 입력해 주세요.", `교구 기본안 ${equipmentKitPlans.length + 1}`)?.trim();
    if (!name) return;
    const plan: AirpassEquipmentKitPlan = {
      id: crypto.randomUUID(),
      name: name.slice(0, 120),
      active: true,
      sortOrder: equipmentKitPlans.length,
      lines: equipmentKit.lines.map((line) => ({ ...line, custom: undefined })),
    };
    setEquipmentKitEditor({
      ...equipmentKitEditor!,
      item: {
        ...equipmentKitEditor!.item,
        equipmentKit: { ...equipmentKit, templateId: plan.id, templateName: plan.name },
      },
    });
    void persistEquipmentKitPlans([...equipmentKitPlans, plan], `‘${plan.name}’ 교구 기본안을 저장했습니다.`);
  }

  function overwriteCurrentEquipmentKitPlan() {
    const equipmentKit = equipmentKitEditor?.item.equipmentKit;
    const selectedId = equipmentKit?.templateId;
    if (!equipmentKit || !selectedId) return;
    const selected = equipmentKitPlans.find((plan) => plan.id === selectedId);
    if (!selected || !window.confirm(`‘${selected.name}’ 기본안을 현재 구성으로 바꿀까요? 이미 저장된 견적은 변경되지 않습니다.`)) return;
    const plans = equipmentKitPlans.map((plan) => plan.id === selectedId
      ? { ...plan, lines: equipmentKit.lines.map((line) => ({ ...line, custom: undefined })) }
      : plan);
    void persistEquipmentKitPlans(plans, `‘${selected.name}’ 기본안을 현재 구성으로 변경했습니다.`);
  }

  function deleteCurrentEquipmentKitPlan() {
    const selectedId = equipmentKitEditor?.item.equipmentKit?.templateId;
    const selected = equipmentKitPlans.find((plan) => plan.id === selectedId);
    if (!selected || equipmentKitPlans.length <= 1) return;
    if (!window.confirm(`‘${selected.name}’ 기본안을 삭제할까요? 기존 견적의 교구 구성은 그대로 유지됩니다.`)) return;
    const remaining = equipmentKitPlans.filter((plan) => plan.id !== selectedId);
    const replacement = remaining.find((plan) => plan.active) ?? remaining[0];
    if (replacement && equipmentKitEditor) {
      const equipmentKit = createAirpassEquipmentKitFromPlan(replacement);
      setEquipmentKitEditor({
        ...equipmentKitEditor,
        item: { ...equipmentKitEditor.item, unitPrice: airpassEquipmentKitTotal(equipmentKit), equipmentKit },
      });
    }
    void persistEquipmentKitPlans(remaining, `‘${selected.name}’ 기본안을 삭제했습니다.`);
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
    const invalid = equipmentKitEditor.item.equipmentKit.lines.some((line) => !line.name.trim());
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
        supplierVendorId: null, supplierVendorName: "",
        procurement: false, procurementChannel: "", procurementNumber: "", procurementFeeRate: 0, consortiumRate: 0,
        internalCostEnabled: false, internalCostAmount: 0, internalCostBearer: "consortium",
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
    const nextItems = [...draft.items.filter((item) => !isConstructionItem(item))];
    const importedItems: DraftItem[] = applyCatalogSuppliers(result.items.map((item) => ({
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
      supplierVendorId: null,
      supplierVendorName: item.supplierName ?? "",
      earningRate: item.earningRate,
      contractType: item.procurement ? (isS2BChannel(item.procurementChannel) ? "s2b" : "g2b") : "direct",
      procurement: item.procurement,
      procurementChannel: item.procurement ? item.procurementChannel : "",
      procurementNumber: item.procurement ? item.procurementNumber : "",
      procurementFeeRate: item.procurement && !isS2BChannel(item.procurementChannel) ? item.procurementFeeRate : 0,
      consortiumRate: 0,
      ...internalCostFields(item.productName.trim(), item.specification.trim(), Math.max(1, Math.round(item.quantity || 1))),
    })), products);
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
        const existing = nextItems[existingIndex];
        const quantity = existing.quantity + imported.quantity;
        const merged = { ...existing, quantity };
        if (quotationInternalCostKind(existing.name, existing.specification) === "aifit-yoga-mat" && existing.internalCostAutoQuantity !== false) {
          Object.assign(merged, internalCostFields(existing.name, existing.specification, quantity));
        }
        nextItems[existingIndex] = merged;
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
    const [logoResponse, sealResponse, airpassSealResponse] = await Promise.all([
      fetch("/whizzup-logo.png"),
      quote.includeStamp ? fetch("/whizzup-seal.png") : Promise.resolve(null),
      quote.items.some((item) => item.equipmentKit) ? fetch("/airpass-seal.png") : Promise.resolve(null),
    ]);
    const logoData = logoResponse.ok ? new Uint8Array(await logoResponse.arrayBuffer()) : undefined;
    const sealData = sealResponse?.ok ? new Uint8Array(await sealResponse.arrayBuffer()) : undefined;
    const airpassSealData = airpassSealResponse?.ok ? new Uint8Array(await airpassSealResponse.arrayBuffer()) : undefined;
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
      airpassSealData,
      equipmentKit: quote.items.find((item) => item.equipmentKit)?.equipmentKit,
      equipmentKitComplimentary: Boolean(quote.items.find((item) => item.equipmentKit)?.complimentary),
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
        equipmentKit: Boolean(item.equipmentKit),
        complimentary: Boolean(item.complimentary),
      })),
    });
    const workbookBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new File([workbookBuffer], quotationDownloadName({
      ...quote,
      region: quotationRegion(quote),
    }, "xlsx"), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  async function storeQuotationFiles(quote: AuthoredQuotation, options: { replaceExisting?: boolean; sourceFile?: File | null } = {}) {
    const sourceFile = options.sourceFile ?? null;
    if (!options.replaceExisting && quote.pdfUrl && quote.excelUrl && quote.driveSyncStatus === "ready" && !sourceFile) return quote;
    const [pdf, xlsx] = await Promise.all([
      createAuthoredQuotationPdf(quote),
      quotationWorkbookFile(quote),
    ]);
    const formData = new FormData();
    formData.set("quotationId", String(quote.id));
    if (quote.driveSyncToken) formData.set("syncToken", quote.driveSyncToken);
    formData.set("pdf", pdf);
    formData.set("xlsx", xlsx);
    if (options.replaceExisting) formData.set("replaceExisting", "true");
    if (!options.replaceExisting && sourceFile) formData.set("sourceFile", sourceFile);
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

  async function processQuotationFiles(quote: AuthoredQuotation, sourceFile: File | null = null) {
    if (quotationFileJobsRef.current.has(quote.id)) return;
    quotationFileJobsRef.current.add(quote.id);
    try {
      const saved = await storeQuotationFiles(quote, { sourceFile });
      setMessage(sourceFile
        ? "견적 내용과 PDF·Excel, 외부 참고 원본 저장을 완료했습니다."
        : "견적 내용과 PDF·Excel 저장을 완료했습니다.");
      window.dispatchEvent(new CustomEvent("whizzup:quotation-files-updated", {
        detail: { organization: saved.organization, businessRound: saved.businessRound },
      }));
    } catch (error) {
      const text = error instanceof Error ? error.message : "PDF·Excel 파일 처리를 완료하지 못했습니다.";
      if (!/더 최신 견적 저장 작업/u.test(text)) {
        setMessage(`견적 내용은 저장됐지만 PDF·Excel 처리가 필요합니다. ${text}`);
      }
    } finally {
      quotationFileJobsRef.current.delete(quote.id);
      await load();
    }
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
      anchor.download = quote.driveXlsxName || quotationDownloadName({
        ...quote,
        region: quotationRegion(quote),
      }, "xlsx");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장된 Excel을 내려받지 못했습니다.");
    }
  }

  async function downloadSavedPdf(quote: AuthoredQuotation) {
    if (!quote.pdfUrl) {
      setMessage("저장된 PDF 파일이 없습니다. 견적 수정에서 최종 저장하면 현재 PDF가 생성됩니다.");
      return;
    }
    try {
      const response = await fetch(quote.pdfUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("저장된 PDF를 내려받지 못했습니다.");
      downloadBlob(await response.blob(), quote.drivePdfName || quotationDownloadName({
        ...quote,
        region: quotationRegion(quote),
      }, "pdf"));
      setMessage("견적서 PDF를 다운로드했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장된 PDF를 내려받지 못했습니다.");
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
      const exactInstitution = institutionRounds.find((item) => item.businessRound === draft.businessRound);
      const institutionBudgets = budgetOptionsForInstitution(exactInstitution);
      if (status === "final" && institutionBudgets.length > 0 && effectiveBudgets.length === 0) {
        throw new Error("이 견적에 사용할 예산을 한 개 이상 선택해 주세요.");
      }
      if (status === "final" && effectiveBudgets.length > 0 && !budgetAllocationMatches) {
        throw new Error(`예산 배분 합계 ${won.format(budgetAllocationTotal)}원이 견적 최종 합계 ${won.format(numbers.total)}원과 일치해야 합니다.`);
      }
      if (status === "final" && procurementWarnings.length > 0) {
        const warningText = procurementWarnings.map((warning) => `${warning.vendorName} · ${warning.channelLabel} ${won.format(warning.totalAmount)}원 (${warning.itemCount}개 품목)`).join("\n");
        if (!window.confirm(`조달 계약 금액을 다시 확인해 주세요.\n${warningText}\n계속 최종 저장하시겠습니까?`)) return;
      }
      if (status === "final" && directPurchaseWarning) {
        if (!window.confirm(`물품 수의계약 한도를 다시 확인해 주세요.\n수의계약·학교장터 합계 ${won.format(directPurchaseWarning.totalAmount)}원 (${directPurchaseWarning.itemCount}개 품목)\n부가세 포함 2,200만원을 초과했습니다. 계속 최종 저장하시겠습니까?`)) return;
      }
      if (status === "final" && !exactInstitution && draft.status !== "final") {
        const createResponse = await fetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: draft.quoteDate, activityType: "기타", contactMethod: "기타", organization: draft.organization, confirmedOrganization: draft.organization, businessRound: draft.businessRound, region: newInstitution.region, contactName: newInstitution.contactName, contactPhone: newInstitution.contactPhone, contactEmail: newInstitution.contactEmail, topic: "견적 기관 등록", summary: `${draft.projectTitle || "견적서"} 작성과 함께 기관을 등록했습니다.`, sourceChat: "견적서", skipRelatedWrites: true }) });
        const createPayload = await createResponse.json() as { error?: string };
        if (!createResponse.ok) throw new Error(createPayload.error || "새 기관을 등록하지 못했습니다.");
      }
      const response = await fetch("/api/quotations", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, budgets: effectiveBudgets, status: "draft", validateFinal: status === "final" }),
      });
      const payload = await response.json() as { quotation?: AuthoredQuotation; error?: string };
      if (!response.ok || !payload.quotation) throw new Error(payload.error || "견적서를 저장하지 못했습니다.");
      if (status === "final") {
        const sourceFile = importSourceFile;
        setQuotes((current) => [payload.quotation!, ...current.filter((quote) => quote.id !== payload.quotation!.id)]);
        setMessage("견적 내용은 저장됐습니다. PDF·Excel을 안전하게 처리하고 있습니다.");
        closeEditor();
        void processQuotationFiles(payload.quotation, sourceFile);
      } else {
        setMessage("임시 저장했습니다.");
        const savedDraft = draftFromQuotation(payload.quotation);
        setDraft({ ...savedDraft, items: applyCatalogSuppliers(savedDraft.items, products) });
        await load();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "견적서를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function exportExcel() {
    if (!draft || !draft.items.length) return;
    const [logoResponse, sealResponse, airpassSealResponse] = await Promise.all([
      fetch("/whizzup-logo.png"),
      draft.includeStamp ? fetch("/whizzup-seal.png") : Promise.resolve(null),
      draft.items.some((item) => item.equipmentKit) ? fetch("/airpass-seal.png") : Promise.resolve(null),
    ]);
    const logoData = logoResponse.ok ? new Uint8Array(await logoResponse.arrayBuffer()) : undefined;
    const sealData = sealResponse?.ok ? new Uint8Array(await sealResponse.arrayBuffer()) : undefined;
    const airpassSealData = airpassSealResponse?.ok ? new Uint8Array(await airpassSealResponse.arrayBuffer()) : undefined;
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
      airpassSealData,
      extraBlankRows: outputBlankRows,
      equipmentKit: draft.items.find((item) => item.equipmentKit)?.equipmentKit,
      equipmentKitComplimentary: Boolean(draft.items.find((item) => item.equipmentKit)?.complimentary),
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
        equipmentKit: Boolean(item.equipmentKit),
        complimentary: Boolean(item.complimentary),
      })),
    });
    downloadBytes(bytes, quotationDownloadName({
      ...draft,
      region: quotationRegion(draft),
    }, "xlsx"));
  }

  function consortiumSettlementOutputInput(): ConsortiumSettlementWorkbookInput | null {
    if (!draft || draft.executionType !== "컨소" || !draft.items.length) return null;
    if (!draft.consortiumCompany.trim()) {
      setMessage("정산서를 만들려면 컨소 업체명을 입력해 주세요.");
      return null;
    }
    const settlement = calculateConsortiumSettlement(draft.items, draft.executionType, draft.settlementAdjustments);
    return {
      organization: draft.organization,
      businessRound: draft.businessRound,
      projectTitle: draft.projectTitle,
      quoteDate: draft.quoteDate,
      quoteNumber: draft.quoteNumber,
      consortiumCompany: draft.consortiumCompany,
      includeStamp: draft.includeStamp,
      items: draft.items.map((item, index) => ({
        name: item.name || `${index + 1}번 품목`,
        contractLabel: contractLabel(item),
        lineAmount: settlement.items[index]?.lineAmount ?? 0,
        consortiumRate: settlement.items[index]?.consortiumRate ?? 0,
        grossPayment: settlement.items[index]?.grossPayment ?? 0,
      })),
      costs: settlement.costs,
      adjustments: settlement.adjustments,
    };
  }

  async function exportConsortiumSettlementExcel() {
    const output = consortiumSettlementOutputInput();
    if (!output || !draft) return;
    const [logoResponse, sealResponse] = await Promise.all([
      fetch("/whizzup-logo.png"),
      draft.includeStamp ? fetch("/whizzup-seal.png") : Promise.resolve(null),
    ]);
    const logoData = logoResponse.ok ? new Uint8Array(await logoResponse.arrayBuffer()) : undefined;
    const sealData = sealResponse?.ok ? new Uint8Array(await sealResponse.arrayBuffer()) : undefined;
    const bytes = createConsortiumSettlementWorkbook({
      ...output,
      logoData,
      sealData,
    });
    downloadBytes(bytes, `${safeFileName(draft.organization)}_${draft.quoteNumber || "견적"}_정산서.xlsx`);
    setMessage("정산서 Excel을 만들었습니다.");
  }

  async function exportConsortiumSettlementPdf() {
    const output = consortiumSettlementOutputInput();
    if (!output) return;
    setSettlementPrintPreparing(true);
    try {
      const pdf = await createConsortiumSettlementPdf(output);
      const pageUrls = await renderGeneratedPdfPages(pdf);
      setSettlementPrintPages(pageUrls);
      setSettlementPrintPreparing(false);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      document.body.classList.add("settlement-printing");
      window.print();
      setMessage("업체 정산서 인쇄 창을 열었습니다. 프린터 출력 또는 PDF로 저장할 수 있습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "정산서 PDF를 만들지 못했습니다.");
    } finally {
      setSettlementPrintPreparing(false);
    }
  }

  async function downloadConsortiumSettlementPdf() {
    const output = consortiumSettlementOutputInput();
    if (!output) return;
    setSettlementPrintPreparing(true);
    try {
      const pdf = await createConsortiumSettlementPdf(output);
      downloadBlob(pdf, pdf.name);
      setMessage("정산서 PDF를 다운로드했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "정산서 PDF를 만들지 못했습니다.");
    } finally {
      setSettlementPrintPreparing(false);
    }
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
            <small><span>견적명</span>{quote.projectTitle || `${quote.businessRound}차 사업`}</small>
          </div>
          <div className="quotation-row-number">
            <strong>{quote.quoteNumber}</strong>
            <small>{quote.status === "final" ? "현재 최종본" : "작성 중"}</small>
          </div>
          <div className="quotation-row-budgets">
            <strong><span>연결 예산</span>{displayedBudgetsForQuote(quote).length ? displayedBudgetsForQuote(quote).map((budget) => budget.name).join(" + ") : "예산 연결 필요"}</strong>
            {displayedBudgetsForQuote(quote).length > 0 && <small><span>예산별 배분 금액</span>{displayedBudgetsForQuote(quote).map((budget) => `${budget.name} ${won.format(budget.allocatedAmount)}원`).join(" · ")}</small>}
          </div>
        </div>
        <dl className="quotation-row-facts">
          <div className="quotation-row-dates"><dt>최초 견적일</dt><dd>{quotationListDateLabels(quote, originalQuoteDates).initialDate}{quotationListDateLabels(quote, originalQuoteDates).modifiedDate && <small>수정 {quotationListDateLabels(quote, originalQuoteDates).modifiedDate}</small>}</dd></div>
          <div><dt>금액</dt><dd><strong>{won.format(quote.totalAmount)}원</strong></dd></div>
          <div className="quotation-row-authors">
            <div><dt>작성자</dt><dd>{quote.createdByName || "미등록"}</dd></div>
            <div><dt>수정자</dt><dd>{quote.updatedByName || quote.createdByName || "미등록"}</dd></div>
          </div>
          <div><dt>상태</dt><dd><b className={`quotation-status ${quote.status}`}>{quote.status === "final" ? "최종" : "임시"}</b>{quote.driveSyncStatus === "queued" || quote.driveSyncStatus === "uploading" ? <small className="quotation-file-status processing">PDF·Excel 처리 중</small> : quote.driveSyncStatus === "error" ? <small className="quotation-file-status error">파일 처리 확인 필요</small> : null}</dd></div>
        </dl>
        <div className="quotation-row-actions">
          {quote.status === "final" ? <>
            {!embedded && <details className="quotation-output-menu">
              <summary>PDF</summary>
              <div className="quotation-output-menu-panel">
                <button type="button" disabled={!quote.pdfUrl || quote.driveSyncStatus !== "ready"} onClick={() => void viewSavedPdf(quote)}>보기</button>
                <button type="button" disabled={!quote.pdfUrl || quote.driveSyncStatus !== "ready"} onClick={() => void downloadSavedPdf(quote)}>다운로드</button>
              </div>
            </details>}
            {!embedded && <button className="app-button app-button-secondary app-button-small" type="button" disabled={!quote.excelUrl || quote.driveSyncStatus !== "ready"} onClick={() => void downloadSavedExcel(quote)}>Excel 다운로드</button>}
            {quote.driveSyncStatus === "error" && <button className="app-button app-button-secondary app-button-small" type="button" disabled={quotationFileJobsRef.current.has(quote.id)} onClick={() => void processQuotationFiles(quote)}>파일 재시도</button>}
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
              <button type="button" onClick={exportExcel} disabled={!draft.items.length}>Excel 다운로드</button>
              <details className="quotation-output-menu quotation-output-menu-topbar">
                <summary>견적서 PDF</summary>
                <div className="quotation-output-menu-panel">
                  <button type="button" onClick={printQuotation} disabled={!draft.items.length}>보기·출력</button>
                  <button type="button" onClick={() => { const saved = draft.id ? quotes.find((quote) => quote.id === draft.id) : undefined; if (saved) void downloadSavedPdf(saved); }} disabled={!draft.id || !quotes.some((quote) => quote.id === draft.id && Boolean(quote.pdfUrl))}>다운로드</button>
                </div>
              </details>
            </div>
            <div className="quote-topbar-action-group quote-topbar-navigation-actions">
              {institutions.some((item) => item.organization === draft.organization && item.businessRound === draft.businessRound) && <button className="app-button app-button-secondary" type="button" onClick={() => { closeEditor(); onOpenOrganization?.(draft.organization, draft.businessRound); }}>기관 상세 보기</button>}
              <button className="app-button app-button-neutral quote-topbar-cancel" type="button" onClick={closeEditor}>취소</button>
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
                  {institutionRounds.map((item) => <option key={item.businessRound} value={item.businessRound}>{item.businessRound}차</option>)}
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
                  {draft.budgets.length > 0 && <footer className={!budgetAllocationMatches ? "warning" : ""}><span>예산 배분 합계 {won.format(budgetAllocationTotal)}원</span><span>견적 최종 합계 {won.format(numbers.total)}원</span>{!budgetAllocationMatches && <small>배분 합계가 견적 최종 합계와 정확히 일치해야 최종 저장할 수 있습니다.</small>}</footer>}
                </section>}
                <label><span>견적명</span><input value={draft.projectTitle} onChange={(event) => setDraft({ ...draft, projectTitle: event.target.value, projectTitleTouched: true })} placeholder="예: 가상현실 스포츠실 구축" /></label>
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
                  const productAmount = item.complimentary ? 0 : Math.max(0, item.quantity) * Math.max(0, item.unitPrice);
                  const procurementFee = appliesProcurementFee(item) ? Math.floor(productAmount * item.procurementFeeRate / 10) * 10 : 0;
                  const quotationAmount = productAmount + procurementFee;
                  const contentSubstitution = isContentSubstitutionItem(item);
                  const expectedEarning = draftItemExpectedEarning(item);
                  const consortiumPayment = draft.executionType === "컨소" && !contentSubstitution ? Math.min(expectedEarning, Math.floor(productAmount * item.consortiumRate / 10) * 10) : 0;
                  const internalCost = item.internalCostEnabled ? Math.max(0, item.internalCostAmount) : 0;
                  const teachingAidSupportCost = Math.max(0, item.teachingAidSupportAmount ?? 0);
                  const internalCostDefaults = quotationInternalCostDefaults(item.name, item.specification, item.quantity);
                  const consortiumBearsInternalCost = draft.executionType === "컨소"
                    && !contentSubstitution
                    && item.internalCostEnabled
                    && item.internalCostBearer === "consortium";
                  const settledConsortiumPayment = consortiumBearsInternalCost
                    ? consortiumPayment - internalCost
                    : consortiumPayment;
                  const companyMarginBeforeTeachingAidSupport = contentSubstitution
                    ? expectedEarning
                    : expectedEarning - settledConsortiumPayment - (consortiumBearsInternalCost ? 0 : internalCost);
                  const companyMargin = companyMarginBeforeTeachingAidSupport - teachingAidSupportCost;
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
                      <div><strong>교구 세부견적</strong><span>{item.equipmentKit ? `${item.equipmentKit.templateName || (item.equipmentKit.plan === "two" ? "표준 2세트" : "표준 1세트")} · 출력 ${airpassEquipmentKitOutputLines(item.equipmentKit).length}개 품목` : "아직 세부 품목이 입력되지 않았습니다."}</span></div>
                      <button type="button" disabled={equipmentKitRecoveryId === item.id} onClick={() => void openEquipmentKitEditor(item)}>{equipmentKitRecoveryId === item.id ? "저장본 복구 중…" : item.equipmentKit ? "세부견적 수정" : "교구 세부견적 열기"}</button>
                    </div>}
                    <div className="quotation-item-card-summary">
                      <label><span>수량</span><div><input type="number" min="1" value={item.quantity} disabled={Boolean(item.equipmentKit)} onChange={(event) => updateItem(item.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} /><input value={item.unit} disabled={Boolean(item.equipmentKit)} onChange={(event) => updateItem(item.id, { unit: event.target.value })} aria-label="단위" /></div></label>
                      <label><span>단가</span><div><span className="quotation-money-input"><FormattedMoneyInput value={item.unitPrice} disabled={Boolean(item.equipmentKit) || item.complimentary} onChange={(unitPrice) => updateItem(item.id, { unitPrice })} label="단가" /><b>원</b></span><strong>{item.complimentary ? "무상 제공" : `합계 ${won.format(productAmount)}원`}</strong></div></label>
                      <div><span>조달수수료</span><strong>{won.format(procurementFee)}원</strong></div>
                      <div><span>견적금액</span><strong>{won.format(quotationAmount)}원</strong></div>
                    </div>
                    <div className="quotation-item-card-controls">
                      <div className="quotation-contract-type"><span>계약 구분</span><div><button type="button" className={!item.procurement ? "active" : ""} onClick={() => setItemContractType(item.id, "direct")}>수의계약</button><button type="button" className={item.procurement && !isS2BChannel(item.procurementChannel) ? "active" : ""} onClick={() => setItemContractType(item.id, "g2b")}>조달 계약</button><button type="button" className={item.procurement && isS2BChannel(item.procurementChannel) ? "active" : ""} onClick={() => setItemContractType(item.id, "s2b")}>학교장터</button></div></div>
                      {item.procurement ? <label><span>식별번호</span><input value={item.procurementNumber} onChange={(event) => updateItem(item.id, { procurementNumber: event.target.value.replace(/[^0-9-]/g, "") })} placeholder={isS2BChannel(item.procurementChannel) ? "S2B 번호" : "G2B 물품식별번호"} /></label> : null}
                      {item.contractType === "g2b" ? <label><span>조달 채널</span><select value={item.procurementChannel || "G2B"} onChange={(event) => updateItem(item.id, { procurementChannel: event.target.value })}><option value="G2B">G2B</option><option value="디지털서비스몰">디지털서비스몰</option><option value="혁신장터">혁신장터</option><option value="기타">기타</option></select></label> : null}
                      {item.contractType === "g2b" ? <label><span>공급처</span><input value={item.supplierVendorName ?? ""} onChange={(event) => updateItem(item.id, { supplierVendorId: null, supplierVendorName: event.target.value })} placeholder="조달 공급처명" /></label> : null}
                      <label><span>조달 수수료율</span><div className="quotation-rate-input"><EditableRateInput label="조달 수수료율" value={item.procurementFeeRate} step={0.01} disabled={!appliesProcurementFee(item)} onChange={(procurementFeeRate) => updateItem(item.id, { procurementFeeRate })} /><b>%</b></div></label>
                      <label><span>당사 수수료율</span><div className="quotation-rate-input"><EditableRateInput label="당사 수수료율" value={item.earningRate} disabled={contentSubstitution} onChange={(earningRate) => updateItem(item.id, { earningRate, consortiumRate: Math.min(item.consortiumRate, earningRate) })} /><b>%</b></div>{contentSubstitution ? <small>바이패스 100% · 잔액에는 기존 {(contentSubstitutionBaseEarningRate(item) * 100).toFixed(2).replace(/\.00$/, "")}% 적용</small> : null}</label>
                      {draft.executionType === "컨소" ? <label><span>컨소 지급률</span><div className="quotation-rate-input"><EditableRateInput label="컨소 지급률" value={item.consortiumRate} max={item.earningRate * 100} onChange={(consortiumRate) => updateItem(item.id, { consortiumRate })} /><b>%</b></div>{(() => {
                        const recent = draftItemLookupKeys(item).map((key) => recentConsortiumRates[key]).find(Boolean);
                        return recent && Math.abs(recent.rate - item.consortiumRate) < 0.000001
                          ? <small className="quotation-recent-rate">최근 적용 {(recent.rate * 100).toFixed(2).replace(/\.00$/, "")}% · {recent.quoteDate}</small>
                          : null;
                      })()}</label> : null}
                      <div className="quotation-item-margin"><span>당사 마진</span><strong>{won.format(companyMargin)}원</strong>{teachingAidSupportCost > 0 ? <small>교구 할인·지원 {won.format(teachingAidSupportCost)}원 차감</small> : contentSubstitution ? <small>대체 후 잔액 × 기존 수수료율</small> : internalCost > 0 ? <small>내부 원가 {won.format(internalCost)}원 반영</small> : draft.executionType === "컨소" ? <small>컨소 지급 {won.format(consortiumPayment)}원 차감</small> : <small>예상 수익 기준</small>}</div>
                      {internalCostDefaults.kind && <div className="quotation-item-internal-cost">
                        <label><input type="checkbox" checked={item.internalCostEnabled} onChange={(event) => {
                          if (internalCostDefaults.kind === "content-substitution") {
                            const checked = event.target.checked;
                            const baseRate = contentSubstitutionBaseEarningRate(item);
                            updateItem(item.id, {
                              internalCostEnabled: checked,
                              internalCostBaseEarningRate: baseRate,
                              earningRate: checked ? 1 : baseRate,
                              consortiumRate: checked ? 0 : Math.min(item.consortiumRate, baseRate),
                            });
                          } else if (event.target.checked && internalCostDefaults.kind === "aifit-yoga-mat" && !item.internalCostAmount) {
                            updateItem(item.id, { internalCostEnabled: true, internalCostQuantity: internalCostDefaults.quantity, internalCostUnitAmount: internalCostDefaults.unitAmount, internalCostAmount: internalCostDefaults.amount, internalCostAutoQuantity: true });
                          } else {
                            updateItem(item.id, { internalCostEnabled: event.target.checked });
                          }
                        }} /><span>{internalCostDefaults.label} {internalCostDefaults.kind === "aifit-yoga-mat" ? "제공" : internalCostDefaults.kind === "content-substitution" ? "반영" : "발생"}</span></label>
                        {internalCostDefaults.kind === "aifit-yoga-mat" ? <div className="quotation-yoga-mat-cost">
                          <label><span>제공 수량</span><input type="number" min="0" step="1" value={item.internalCostQuantity ?? internalCostDefaults.quantity} onChange={(event) => {
                            const internalCostQuantity = Math.max(0, Math.round(Number(event.target.value) || 0));
                            const internalCostUnitAmount = item.internalCostUnitAmount ?? internalCostDefaults.unitAmount;
                            updateItem(item.id, { internalCostQuantity, internalCostUnitAmount, internalCostAmount: internalCostQuantity * internalCostUnitAmount, internalCostAutoQuantity: false });
                          }} /></label>
                          <label><span>개당 비용</span><span className="quotation-money-input"><FormattedMoneyInput value={item.internalCostUnitAmount ?? internalCostDefaults.unitAmount} onChange={(internalCostUnitAmount) => {
                            const internalCostQuantity = Math.max(0, Math.round(Number(item.internalCostQuantity ?? internalCostDefaults.quantity) || 0));
                            updateItem(item.id, { internalCostUnitAmount, internalCostAmount: internalCostQuantity * internalCostUnitAmount, internalCostAutoQuantity: false });
                          }} label="요가매트 개당 비용" /><b>원</b></span></label>
                          <b>합계 {won.format(item.internalCostAmount)}원</b>
                          <button type="button" onClick={() => updateItem(item.id, { internalCostEnabled: true, internalCostQuantity: internalCostDefaults.quantity, internalCostUnitAmount: internalCostDefaults.unitAmount, internalCostAmount: internalCostDefaults.amount, internalCostAutoQuantity: true })}>아이핏 수량 적용</button>
                        </div> : <span className="quotation-money-input"><FormattedMoneyInput value={item.internalCostAmount} onChange={(internalCostAmount) => updateItem(item.id, { internalCostAmount })} label={`${internalCostDefaults.label} 내부 원가`} /><b>원</b></span>}
                        {draft.executionType === "컨소" && internalCostDefaults.kind !== "content-substitution" ? <div className="quotation-cost-bearer"><span>비용 처리 방식</span><div><button type="button" className={item.internalCostBearer === "consortium" ? "active" : ""} onClick={() => updateItem(item.id, { internalCostBearer: "consortium" })}>정산서 반영</button><button type="button" className={item.internalCostBearer === "whizzup" ? "active" : ""} onClick={() => updateItem(item.id, { internalCostBearer: "whizzup" })}>위즈업 별도 처리</button></div></div> : null}
                        <small>{internalCostDefaults.kind === "content-substitution" ? "체크 시 바이패스 100%로 표시하고, 대체 후 남은 금액에 기존 수수료율을 적용합니다. 초과 비용은 음수 마진으로 반영됩니다." : draft.executionType === "컨소" && item.internalCostBearer === "consortium" ? "컨소 정산서의 비용 내역과 최종 지급 예정액에 반영됩니다." : "위즈업 내부 비용으로 처리되며 고객 견적 금액에는 반영되지 않습니다."}</small>
                      </div>}
                      {supportsTeachingAidDiscount(item) && <div className="quotation-teaching-aid-support">
                        <label><span>교구 할인·지원 차감</span><input value={item.teachingAidSupportLabel || "교구 할인 차감"} onChange={(event) => updateItem(item.id, { teachingAidSupportLabel: event.target.value })} placeholder="교구 할인 차감" /></label>
                        <label><span>내부 차감 금액</span><span className="quotation-money-input"><FormattedMoneyInput value={item.teachingAidSupportAmount ?? 0} onChange={(teachingAidSupportAmount) => updateItem(item.id, { teachingAidSupportAmount })} label="교구 할인·지원 차감 금액" /><b>원</b></span></label>
                        {item.equipmentKit ? <label className={`quotation-complimentary-toggle${item.complimentary ? " active" : ""}`}><input type="checkbox" checked={Boolean(item.complimentary)} onChange={(event) => {
                          const complimentary = event.target.checked;
                          const complimentaryAmount = Math.max(0, item.quantity) * Math.max(0, item.unitPrice);
                          const currentSupportAmount = Math.max(0, item.teachingAidSupportAmount ?? 0);
                          updateItem(item.id, {
                            complimentary,
                            teachingAidSupportLabel: item.teachingAidSupportLabel || "교구 할인 차감",
                            teachingAidSupportAmount: complimentary
                              ? (currentSupportAmount > 0 ? currentSupportAmount : complimentaryAmount)
                              : (currentSupportAmount === complimentaryAmount ? 0 : currentSupportAmount),
                          });
                        }} /><span><b>교구 세트 무상 제공</b><small>고객 견적에서는 0원으로 처리하고, 수량 × 단가는 내부 차감 금액에 자동 반영합니다.</small></span></label> : null}
                        <small>고객 견적금액과 PDF·Excel에는 반영하지 않고 내부 마진에서만 차감합니다.</small>
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
                  <label className="quotation-additional-internal-cost"><span>추가 공사비</span><span className="quotation-money-input"><FormattedMoneyInput value={draft.additionalInternalConstructionCost} onChange={(additionalInternalConstructionCost) => setDraft({ ...draft, additionalInternalConstructionCost })} label="추가 공사비" /><b>원</b></span><small>내부 총이익에서만 차감됩니다.</small></label>
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
            <label>협업 구분<select value={draft.executionType} onChange={(event) => setExecutionType(event.target.value === "컨소" ? "컨소" : "직영")}><option>직영</option><option>컨소</option></select></label>
            {draft.executionType === "컨소" && <><label>컨소 업체<input value={draft.consortiumCompany} onChange={(event) => { collaborationTouchedRef.current = true; setDraft({ ...draft, consortiumCompany: event.target.value }); }} placeholder="업체명" /></label><p>컨소 지급률은 품목마다 다르게 입력합니다. 각 품목의 지급률은 위즈업 수수료율을 넘을 수 없습니다.</p></>}
            <section className="quote-profit-box"><header><strong>수익 분석</strong><small>내부용</small></header><dl><dt>예상 수익</dt><dd>{won.format(numbers.earning)}원</dd><dt>컨소 지급</dt><dd>{numbers.consortium === 0 ? "0원" : numbers.consortium > 0 ? `-${won.format(numbers.consortium)}원` : `+${won.format(Math.abs(numbers.consortium))}원 (상계)`}</dd>{numbers.projectorInstallationCost > 0 && <><dt>빔프로젝터 설치</dt><dd className="deduction">-{won.format(numbers.projectorInstallationCost)}원</dd></>}{numbers.yogaMatServiceCost > 0 && <><dt>요가매트 제공</dt><dd className="deduction">-{won.format(numbers.yogaMatServiceCost)}원</dd></>}{numbers.additionalConstructionCost > 0 && <><dt>추가 공사비</dt><dd className="deduction">-{won.format(numbers.additionalConstructionCost)}원</dd></>}{numbers.internalCost > 0 && <><dt>내부 원가 합계</dt><dd className="deduction">-{won.format(numbers.internalCost)}원</dd></>}<dt>최종 총이익</dt><dd>{won.format(numbers.margin)}원</dd><dt>마진%</dt><dd>{(numbers.marginRate * 100).toFixed(1)}%</dd></dl></section>
            {draft.executionType === "컨소" && <section className="quote-consortium-settlement">
              <header><div><strong>정산서</strong><small>업체 공유용 · 내부 마진 제외</small></div><span>Excel · PDF</span></header>
              <dl><dt>기본 정산액</dt><dd>{won.format(numbers.consortiumGross)}원</dd><dt>정산 반영 비용</dt><dd>{numbers.consortiumCost ? `-${won.format(numbers.consortiumCost)}원` : "0원"}</dd>{numbers.consortiumAdjustmentDeductions > 0 && <><dt>추가 정산 차감</dt><dd>-{won.format(numbers.consortiumAdjustmentDeductions)}원</dd></>}{numbers.consortiumAdjustmentAdditions > 0 && <><dt>추가 지급</dt><dd>+{won.format(numbers.consortiumAdjustmentAdditions)}원</dd></>}<dt>최종 지급 예정액</dt><dd>{numbers.consortium < 0 ? `${won.format(numbers.consortium)}원 (다음 정산 상계)` : `${won.format(numbers.consortium)}원`}</dd></dl>
              <div className="quotation-settlement-adjustments">
                <div><strong>정산 조정 내역</strong><button type="button" onClick={addSettlementAdjustment}>+ 조정 항목 추가</button></div>
                {draft.settlementAdjustments.map((adjustment) => <article key={adjustment.id}>
                  <select value={adjustment.type} onChange={(event) => updateSettlementAdjustment(adjustment.id, { type: event.target.value === "addition" ? "addition" : "deduction" })}><option value="deduction">정산 차감</option><option value="addition">추가 지급</option></select>
                  <input value={adjustment.label} onChange={(event) => updateSettlementAdjustment(adjustment.id, { label: event.target.value })} placeholder="항목명" />
                  <FormattedMoneyInput value={adjustment.amount} onChange={(amount) => updateSettlementAdjustment(adjustment.id, { amount })} label="조정 금액" />
                  <input value={adjustment.note} onChange={(event) => updateSettlementAdjustment(adjustment.id, { note: event.target.value })} placeholder="사유·비고" />
                  <button type="button" aria-label="조정 항목 삭제" onClick={() => removeSettlementAdjustment(adjustment.id)}>×</button>
                </article>)}
                {!draft.settlementAdjustments.length && <small>추가 지급이나 정산 차감이 생기면 항목을 추가해 주세요.</small>}
              </div>
              <details className="quotation-output-menu quotation-output-menu-settlement">
                <summary>정산서 출력·다운로드</summary>
                <div className="quotation-output-menu-panel">
                  <button type="button" className="primary" onClick={() => void exportConsortiumSettlementPdf()} disabled={!draft.items.length || settlementPrintPreparing}>정산서 PDF 보기·인쇄</button>
                  <button type="button" onClick={() => void downloadConsortiumSettlementPdf()} disabled={!draft.items.length || settlementPrintPreparing}>정산서 PDF 다운로드</button>
                  <button type="button" onClick={() => void exportConsortiumSettlementExcel()} disabled={!draft.items.length}>정산서 Excel 다운로드</button>
                </div>
              </details>
              <p>품목별 지급률과 비용 처리 방식, 정산 조정 내역을 표시하며 위즈업 수익·마진은 포함하지 않습니다. 직인 포함 설정도 동일하게 적용됩니다.</p>
            </section>}
            {directPurchaseWarning && <section className="quotation-procurement-warning quotation-direct-purchase-warning" role="alert"><strong>물품 수의계약 한도 확인</strong><div><b>수의계약 · 학교장터 합산</b><span>{won.format(directPurchaseWarning.totalAmount)}원 · {directPurchaseWarning.itemCount}개 품목</span><small>부가세 포함 2,200만원을 초과했습니다. 공사비와 일반 조달·디지털서비스몰·혁신장터 품목은 제외한 참고 경고입니다.</small></div></section>}
            {procurementWarnings.length > 0 && <section className="quotation-procurement-warning" role="alert"><strong>조달 계약 금액 확인</strong>{procurementWarnings.map((warning) => <div key={warning.key}><b>{warning.vendorName} · {warning.channelLabel}</b><span>{won.format(warning.totalAmount)}원 · {warning.itemCount}개 품목</span><small>{warning.unspecified ? `공급처를 지정해야 ${warning.channelLabel} 업체별 1억 원 기준을 정확히 판단할 수 있습니다.` : `동일 공급처의 ${warning.channelLabel} 품목 합계가 1억 원 이상입니다.`}</small></div>)}</section>}
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
            <div className="quote-internal-report-summary">
              <span>견적금액<b>{won.format(numbers.total)}원</b></span><span>예상 수익<b>{won.format(numbers.earning)}원</b></span><span>컨소 지급<b>{numbers.consortium ? `-${won.format(numbers.consortium)}원` : "0원"}</b></span><span>내부 원가<b>{numbers.internalCost ? `-${won.format(numbers.internalCost)}원` : "0원"}</b></span><span className="result">최종 총이익<b>{won.format(numbers.margin)}원</b></span><span>마진율<b>{(numbers.marginRate * 100).toFixed(1)}%</b></span>
            </div>
            <div className="quote-internal-report-formula"><span>예상 수익 <b>{won.format(numbers.earning)}원</b></span><i>−</i><span>컨소·내부 원가 <b>{won.format(numbers.consortium + numbers.internalCost)}원</b></span><i>=</i><span className="result">최종 총이익 <b>{won.format(numbers.margin)}원</b></span></div>
            <div className="quote-internal-report-items">{internalReportRows.map((row) => <details key={`${row.number}-${row.name}`} className={row.complimentary ? "complimentary" : ""}>
              <summary><span className="number">{row.number}</span><span className="title"><b>{row.name}</b><small>{row.specification || `${row.quantity}${row.unit}`}</small></span>{row.complimentary && <em>무상 제공</em>}<span className="profit"><small>품목 순이익</small><b>{won.format(row.netProfit)}원</b></span></summary>
              <div><dl><dt>견적금액</dt><dd>{row.complimentary ? "무상" : `${won.format(row.amount)}원`}</dd><dt>예상 수익</dt><dd>{won.format(row.earning)}원</dd><dt>컨소 지급</dt><dd>{row.consortium ? `-${won.format(row.consortium)}원` : "0원"}</dd><dt>내부 원가</dt><dd>{row.internalCost ? `-${won.format(row.internalCost)}원` : "0원"}</dd></dl><p>{row.complimentary ? `기준 단가 ${won.format(row.unitPrice)}원은 보존되며 견적 합계와 수익 계산에서 제외됩니다.` : `${row.quantity}${row.unit} × ${won.format(row.unitPrice)}원 · 수익률 ${(row.earningRate * 100).toFixed(1)}%${draft.executionType === "컨소" ? ` · 컨소 지급률 ${(row.consortiumRate * 100).toFixed(1)}%` : ""}`}</p></div>
            </details>)}</div>
            {internalCostDetails.length > 0 && <section className="quote-internal-report-cost-details" aria-label="내부 비용 상세">
              <h4>내부 비용·지원·콘텐츠 대체 상세</h4>
              <ul>{internalCostDetails.map((detail, index) => <li key={`${detail.label}-${detail.itemName}-${index}`}><span><strong>{detail.label}</strong><small>{detail.itemName}{detail.note ? ` · ${detail.note}` : ""}</small></span><b>-{won.format(detail.amount)}원</b></li>)}</ul>
            </section>}
            <footer><button type="button" onClick={downloadInternalProfitExcel}>Excel 다운로드</button><button type="button" onClick={() => void openInternalProfitPdf()}>PDF 보기·인쇄</button><button className="primary" type="button" onClick={() => setInternalReportOpen(false)}>닫기</button></footer>
          </section>
        </div>}

        {settlementPrintPreparing && createPortal(<div className="settlement-print-preparing no-print" role="status"><span /><strong>업체 정산서 인쇄 화면을 준비하고 있습니다.</strong></div>, document.body)}
        {settlementPrintPages.length > 0 && createPortal(<section className="settlement-print-portal print-only" aria-label="업체 정산서 인쇄본">{settlementPrintPages.map((url, index) => <img key={url} src={url} alt={`업체 정산서 ${index + 1}페이지`} />)}</section>, document.body)}
        {printPortalReady && createPortal(<section className="internal-profit-print-portal print-only" aria-label="내부 수익표 인쇄본">
          <article className="internal-profit-print-sheet">
            <header className="internal-profit-print-header">
              <div className="internal-profit-print-title">
                <img src="/whizzup-logo.png" alt="위즈업" />
                <div><span>INTERNAL PROFIT REPORT</span><h1>내부 수익표</h1><p>{draft.organization} · {draft.projectTitle || `${draft.businessRound}차 사업`}</p></div>
              </div>
              <dl><dt>견적번호</dt><dd>{draft.quoteNumber || "저장 전"}</dd><dt>작성일</dt><dd>{draft.quoteDate}</dd><dt>협업 구분</dt><dd>{draft.executionType}</dd></dl>
            </header>
            <div className="internal-profit-print-summary">
              <span>견적금액<b>{won.format(numbers.total)}원</b></span>
              <span>기준·반영 수익<b>{won.format(numbers.earning)}원</b></span>
              <span>컨소 지급<b>{numbers.consortium ? `-${won.format(numbers.consortium)}원` : "0원"}</b></span>
              <span className="cost">내부 비용<b>{numbers.internalCost ? `-${won.format(numbers.internalCost)}원` : "0원"}</b></span>
              <span className="result">최종 총이익<b>{won.format(numbers.margin)}원</b></span>
              <span>마진율<b>{(numbers.marginRate * 100).toFixed(1)}%</b></span>
            </div>
            <div className="internal-profit-print-formula"><span>예상 수익<b>{won.format(numbers.earning)}원</b></span><i>−</i><span>컨소·내부 비용<b>{won.format(numbers.consortium + numbers.internalCost)}원</b></span><i>=</i><span className="result">최종 총이익<b>{won.format(numbers.margin)}원</b></span></div>
            <div className="internal-profit-print-section-heading"><h2>품목별 수익 내역</h2><span>{internalReportRows.length}개 품목 · VAT 포함 기준</span></div>
            <div className="internal-profit-print-items">{internalReportRows.map((row) => <article key={`internal-print-${row.number}-${row.name}`} className={row.complimentary ? "complimentary" : ""}>
              <header><span className="number">{row.number}</span><span className="title"><b>{row.name}</b><small>{row.specification || `${row.quantity}${row.unit} · ${won.format(row.unitPrice)}원`}</small></span>{row.complimentary && <em>무상 제공</em>}<strong>{won.format(row.netProfit)}원</strong></header>
              <dl><div><dt>견적금액</dt><dd>{row.complimentary ? "무상" : `${won.format(row.amount)}원`}</dd></div><div><dt>예상 수익</dt><dd>{won.format(row.earning)}원</dd></div><div className="deduction"><dt>컨소·내부 비용</dt><dd>{row.consortium + row.internalCost ? `-${won.format(row.consortium + row.internalCost)}원` : "0원"}</dd></div><div><dt>상태</dt><dd>{row.status}</dd></div></dl>
            </article>)}</div>
            {internalCostDetails.length > 0 && <section className="internal-profit-print-cost-details">
              <h2>내부 비용·지원·콘텐츠 대체 상세</h2>
              <ul>{internalCostDetails.map((detail, index) => <li key={`internal-profit-cost-${detail.label}-${index}`}><span><strong>{detail.label}</strong><small>{detail.itemName}{detail.note ? ` · ${detail.note}` : ""}</small></span><b>-{won.format(detail.amount)}원</b></li>)}</ul>
            </section>}
            <footer className="internal-profit-print-total"><span>컨소·내부 비용을 반영한 최종 예상 수익<small>마진율 {(numbers.marginRate * 100).toFixed(1)}%</small></span><strong>{won.format(numbers.margin)}원</strong></footer>
            <p className="internal-profit-print-note"><span>본 자료는 내부 수익 검토용이며 외부 견적서에는 포함되지 않습니다.</span><b>주식회사 위즈업</b></p>
          </article>
        </section>, document.body)}

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
                {equipmentKitPlans.filter((plan) => plan.active).map((plan) => {
                  const selected = equipmentKitEditor.item.equipmentKit?.templateId
                    ? equipmentKitEditor.item.equipmentKit.templateId === plan.id
                    : Boolean(plan.systemPlan && equipmentKitEditor.item.equipmentKit?.plan === plan.systemPlan);
                  return <button key={plan.id} type="button" className={selected ? "active" : ""} onClick={() => {
                    if (selected) return;
                    if (window.confirm("기본 품목의 수정값을 선택한 구성안으로 다시 불러올까요? 직접 추가한 품목은 유지됩니다.")) selectEquipmentKitPlan(plan);
                  }}>{plan.name}</button>;
                })}
              </div>
              <span>기본값 자동 입력 · 모든 수량·단위·단가 수정 가능</span>
            </div>
            {canManageEquipmentKitPlans && <div className="equipment-kit-plan-actions">
              <span>관리자가 현재 품목·수량·단가를 공용 기본안으로 저장할 수 있습니다. 기존 견적은 바뀌지 않습니다.</span>
              <div>
                <button type="button" disabled={equipmentKitPlansSaving} onClick={saveCurrentEquipmentKitAsPlan}>+ 현재 구성 새 기본안 저장</button>
                {equipmentKitEditor.item.equipmentKit.templateId && <button type="button" disabled={equipmentKitPlansSaving} onClick={overwriteCurrentEquipmentKitPlan}>현재 기본안 덮어쓰기</button>}
                {equipmentKitEditor.item.equipmentKit.templateId && equipmentKitPlans.length > 1 && <button type="button" className="danger" disabled={equipmentKitPlansSaving} onClick={deleteCurrentEquipmentKitPlan}>기본안 삭제</button>}
              </div>
            </div>}
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
                    <td><input value={line.name} onChange={(event) => updateEquipmentKitLine(line.id, { name: event.target.value })} placeholder="품목명 입력" aria-label={`${index + 1}번 품목명`} /></td>
                    <td><input type="number" min="0" step="1" value={line.quantity} onChange={(event) => updateEquipmentKitLine(line.id, { quantity: Math.max(0, Math.round(Number(event.target.value) || 0)) })} aria-label={`${line.name || `${index + 1}번 품목`} 수량`} /></td>
                    <td><select value={line.unit} onChange={(event) => updateEquipmentKitLine(line.id, { unit: event.target.value })} aria-label={`${line.name || `${index + 1}번 품목`} 단위`}><option>EA</option><option>SET</option><option>개</option><option>식</option><option>대</option></select></td>
                    <td><FormattedMoneyInput value={line.unitPrice} onChange={(unitPrice) => updateEquipmentKitLine(line.id, { unitPrice })} label={`${line.name || `${index + 1}번 품목`} 단가`} /></td>
                    <td>{won.format(line.quantity * line.unitPrice)}원</td>
                    <td>{line.quantity > 0 ? "포함" : "제외"}</td>
                    <td><button type="button" className="remove" onClick={() => {
                      const equipmentKit: AirpassEquipmentKit = { ...equipmentKitEditor.item.equipmentKit!, lines: equipmentKitEditor.item.equipmentKit!.lines.filter((item) => item.id !== line.id) };
                      setEquipmentKitEditor({ ...equipmentKitEditor, item: { ...equipmentKitEditor.item, unitPrice: airpassEquipmentKitTotal(equipmentKit), equipmentKit } });
                    }}>삭제</button></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <div className="equipment-kit-total"><span>견적·별첨에 포함되는 교구 합계</span><strong>{won.format(airpassEquipmentKitTotal(equipmentKitEditor.item.equipmentKit))}원</strong></div>
            <footer><button type="button" onClick={() => setEquipmentKitEditor(null)}>취소</button><button type="button" className="primary" onClick={applyEquipmentKit}>이 구성으로 견적에 적용</button></footer>
          </section>
        </div>}

        {printPortalReady && !internalReportOpen ? createPortal(<section className="quotation-print-stack quotation-print-portal print-only" aria-label="관공서 제출용 견적서 인쇄본">
          {printItemPages.map((page, pageIndex) => {
            const pageItems = page.rows;
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
                  const itemIndex = page.startIndex + rowIndex;
                  return <tr key={item?.id || `empty-${itemIndex}`}><td>{item ? itemIndex + 1 : ""}</td><td>{item?.name || ""}</td><td>{item?.specification || ""}</td><td>{item ? procurementDisplay(item) : ""}</td><td>{item?.quantity || ""}</td><td>{item?.unit || ""}</td><td>{item ? item.complimentary ? "무상" : `${won.format(item.unitPrice)}원` : ""}</td><td>{item ? item.complimentary ? "무상" : `${won.format(item.quantity * item.unitPrice)}원` : ""}</td><td>{item ? outputNote(item) : ""}</td></tr>;
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
              <div className="airpass-print-brand">(주)에어패스</div>
              <div><h1>교 구 세 부 견 적</h1><p>{draft.organization || "미지정"}</p></div>
              <dl><dt>견적번호</dt><dd>{draft.quoteNumber || "저장 시 발급"}</dd><dt>작성일</dt><dd>{draft.quoteDate}</dd></dl>
            </header>
            {kitPage.page === 1 && <div className="equipment-kit-print-parties">
              <section><h2>받는 분</h2><dl><dt>수신</dt><dd>{draft.organization}</dd><dt>견적명</dt><dd>{draft.projectTitle || "제품 공급"}</dd><dt>계약구분</dt><dd>수의계약</dd><dt>납품조건</dt><dd>발주 후 일정 협의</dd></dl></section>
              <section><h2>공급자</h2><dl><dt>상호</dt><dd>{AIRPASS_COMPANY.name}</dd><dt>사업자번호</dt><dd>{AIRPASS_COMPANY.businessNumber}</dd><dt>대표자</dt><dd>{AIRPASS_COMPANY.representative}</dd><dt>주소</dt><dd>{AIRPASS_COMPANY.address}</dd></dl></section>
            </div>}
            <div className="equipment-kit-print-band">에어패스 교구 세부내역</div>
            <table className="equipment-kit-print-table">
              <colgroup><col className="no" /><col className="name" /><col className="quantity" /><col className="unit" /><col className="price" /><col className="amount" /><col className="note" /></colgroup>
              <thead><tr><th>No</th><th>품명</th><th>수량</th><th>단위</th><th>단가</th><th>금액</th><th>비고</th></tr></thead>
              <tbody>{kitPage.lines.map((line, lineIndex) => <tr key={line.id}><td>{kitPage.startIndex + lineIndex + 1}</td><td>{line.name}</td><td>{line.quantity}</td><td>{line.unit}</td><td>{kitPage.item.complimentary ? "무상" : `${won.format(line.unitPrice)}원`}</td><td>{kitPage.item.complimentary ? "무상" : `${won.format(line.quantity * line.unitPrice)}원`}</td><td>{kitPage.item.complimentary ? "무상 제공" : ""}</td></tr>)}</tbody>
            </table>
            {kitPage.page === kitPage.pages && <div className="equipment-kit-print-total"><span>{kitPage.item.complimentary ? "제공 조건" : "합계금액 (VAT 포함)"}</span><strong>{kitPage.item.complimentary ? "무상 제공" : `${won.format(airpassEquipmentKitTotal(kitPage.item.equipmentKit))}원`}</strong></div>}
            <footer className="equipment-kit-print-footer"><span>{AIRPASS_COMPANY.name} · 본 세부견적은 본 견적서와 함께 제출됩니다.</span>{kitPage.page === kitPage.pages && <img src="/airpass-seal.png" alt="에어패스 직인" />}<b>별첨 {kitPageIndex + 1}</b></footer>
          </article>)}
        </section>, document.body) : null}
      </div>
    </div>}
  </section>;
}
