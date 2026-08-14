"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PRODUCT_CATALOG,
  type ProductCatalogItem,
} from "../lib/product-catalog";
import {
  createProductCatalogWorkbook,
  parseProductCatalogWorkbook,
  type ProductCatalogImportRow,
} from "../lib/product-catalog-xlsx";
import {
  createQuotationWorkbook,
  type QuotationLine,
} from "../lib/quotation-xlsx";
import QuotationManagementPage, {
  type QuotationInstitutionOption,
} from "./quotation-management-page";
import AwardVendorPage from "./award-vendor-page";
import { parseXlsxPreview, type XlsxPreview } from "./xlsx-preview";

type ProductWorkspaceTab = "quotations" | "products" | "vendors";

type ProductCatalogPageProps = {
  search: string;
  onSearchChange: (value: string) => void;
  institutions: QuotationInstitutionOption[];
  isPrimaryOwner?: boolean;
  onOpenOrganization?: (organization: string, businessRound: number) => void;
  initialTab?: ProductWorkspaceTab;
};

type ProductForm = {
  name: string;
  specification: string;
  unitPrice: string;
  note: string;
  commissionRate: string;
  rateEdited: boolean;
  supplyType: "partner" | "direct";
  reference: string;
  supplierVendorId: string;
  procurement: boolean;
  procurementChannel: string;
  procurementNumber: string;
  procurementFeeRate: string;
};

type ProductVendorOption = {
  id: number;
  companyName: string;
};

type ProductComparisonDocument = {
  id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_by_name: string;
  created_at: string;
};

type ImportPreview = {
  rows: ProductCatalogImportRow[];
  products: ProductCatalogItem[];
  added: number;
  updated: number;
  skipped: number;
  errors: number;
  fileName: string;
};

type QuotationDraftLine = {
  id: string;
  productId: string;
  name: string;
  specification: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  note: string;
};

type QuotationForm = {
  customerName: string;
  quoteDate: string;
  projectTitle: string;
  search: string;
  lines: QuotationDraftLine[];
};

const priceFormatter = new Intl.NumberFormat("ko-KR");
const PRODUCT_PAGE_SIZE = 50;
const QUOTATION_PRODUCT_RESULT_LIMIT = 80;
const xlsxMime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatPrice(value: number | null) {
  return value === null ? "â€”" : `${priceFormatter.format(value)}ì›`;
}

function formatRate(value: number | null) {
  if (value === null) return "â€”";
  const percentage = value * 100;
  return `${Number(percentage.toFixed(2))}%`;
}

function formatRateInput(value: number | null) {
  if (value === null) return "";
  return String(Number((value * 100).toFixed(2)));
}

function normalizeSearchValue(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function localDateString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "ê¸°ê´€";
}

function downloadBytes(bytes: Uint8Array, fileName: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: xlsxMime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function productKey(name: string, specification: string) {
  return normalizeSearchValue(`${name}::${specification}`);
}

function calculateNeedsReview(product: ProductCatalogItem) {
  return (
    !product.specification &&
    product.unitPrice === null &&
    !product.note &&
    product.commissionRate === null &&
    product.marginRate === null &&
    !product.reference
  );
}

function toForm(product: ProductCatalogItem): ProductForm {
  const activeRate =
    product.supplyType === "direct"
      ? product.marginRate
      : product.commissionRate;
  return {
    name: product.name,
    specification: product.specification,
    unitPrice:
      product.unitPrice === null
        ? ""
        : priceFormatter.format(product.unitPrice),
    note: product.note,
    commissionRate: formatRateInput(activeRate),
    rateEdited: false,
    supplyType: product.supplyType,
    reference: product.reference,
    supplierVendorId:
      product.supplyType === "partner" && product.supplierVendorId
      ? String(product.supplierVendorId)
      : "",
    procurement: product.procurement === true,
    procurementChannel: product.procurementChannel || "G2B",
    procurementNumber: product.procurementNumber || "",
    procurementFeeRate: product.procurementFeeRate == null ? "0.54" : String(Number((product.procurementFeeRate * 100).toFixed(2))),
  };
}

function createEmptyProductForm(): ProductForm {
  return {
    name: "",
    specification: "",
    unitPrice: "",
    note: "",
    commissionRate: "",
    rateEdited: false,
    supplyType: "partner",
    reference: "",
    supplierVendorId: "",
    procurement: false,
    procurementChannel: "G2B",
    procurementNumber: "",
    procurementFeeRate: "0.54",
  };
}

function parseOptionalNumber(
  value: string,
  kind: "price" | "rate",
) {
  const normalized = value.trim().replace(/[,\sì›%]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      kind === "price"
        ? "ë‹¨ê°€ëŠ” 0 ì´ìƒì˜ ìˆ«ìë¡œ ì…ë ¥í•´ ì£¼ì„¸ìš”."
        : "ìˆ˜ìˆ˜ë£Œìœ¨ ë˜ëŠ” ë§ˆì§„ìœ¨ì€ 0~100 ì‚¬ì´ ìˆ«ìë¡œ ì…ë ¥í•´ ì£¼ì„¸ìš”.",
    );
  }
  if (kind === "rate" && parsed > 100) {
    throw new Error("ìˆ˜ìˆ˜ë£Œìœ¨ ë˜ëŠ” ë§ˆì§„ìœ¨ì€ 100% ì´í•˜ë¡œ ì…ë ¥í•´ ì£¼ì„¸ìš”.");
  }
  return kind === "rate" ? parsed / 100 : parsed;
}

function downloadWorkbook(products: ProductCatalogItem[]) {
  const workbook = createProductCatalogWorkbook(products);
  const copy = new Uint8Array(workbook.byteLength);
  copy.set(workbook);
  const blob = new Blob([copy.buffer], { type: xlsxMime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ìœ„ì¦ˆì—…_ì œí’ˆê¸°ì¤€ì •ë³´_${new Date()
    .toISOString()
    .slice(0, 10)}.xlsx`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildImportPreview(
  rows: ProductCatalogImportRow[],
  currentProducts: ProductCatalogItem[],
  fileName: string,
): ImportPreview {
  const products = currentProducts.map((product) => ({ ...product }));
  const indexByKey = new Map(
    products.map((product, index) => [
      productKey(product.name, product.specification),
      index,
    ]),
  );
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    if (row.errors.length) {
      errors += 1;
      continue;
    }

    const key = productKey(row.name, row.specification);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      const supplyType = row.supplyType ?? "partner";
      const product: ProductCatalogItem = {
        id: `import-${Date.now()}-${row.rowNumber}`,
        sourceRow: products.length
          ? Math.max(...products.map((item) => item.sourceRow)) + added + 1
          : row.rowNumber,
        name: row.name,
        specification: row.specification,
        unitPrice: row.unitPrice,
        note: row.note,
        supplyType,
        commissionRate:
          supplyType === "partner" ? row.commissionRate : null,
        marginRate:
          supplyType === "direct" ? row.marginRate : null,
        reference: row.reference,
        needsReview: false,
      };
      product.needsReview = calculateNeedsReview(product);
      indexByKey.set(key, products.length);
      products.push(product);
      added += 1;
      continue;
    }

    const existing = products[existingIndex];
    const supplyType = row.supplyType ?? existing.supplyType;
    const importedRate =
      row.supplyType === null
        ? row.commissionRate
        : supplyType === "direct"
          ? row.marginRate
          : row.commissionRate;
    const next: ProductCatalogItem = {
      ...existing,
      name: row.name || existing.name,
      specification: row.specification || existing.specification,
      unitPrice: row.unitPrice ?? existing.unitPrice,
      note: row.note || existing.note,
      supplyType,
      commissionRate:
        supplyType === "partner"
          ? importedRate ?? existing.commissionRate ?? existing.marginRate
          : null,
      marginRate:
        supplyType === "direct"
          ? importedRate ?? existing.marginRate ?? existing.commissionRate
          : null,
      supplierVendorId:
        supplyType === "partner" ? existing.supplierVendorId ?? null : null,
      supplierVendorName:
        supplyType === "partner" ? existing.supplierVendorName ?? "" : "",
      reference: row.reference || existing.reference,
    };
    next.needsReview = calculateNeedsReview(next);
    if (
      next.name === existing.name &&
      next.specification === existing.specification &&
      next.unitPrice === existing.unitPrice &&
      next.note === existing.note &&
      next.supplyType === existing.supplyType &&
      next.commissionRate === existing.commissionRate &&
      next.marginRate === existing.marginRate &&
      next.reference === existing.reference
    ) {
      skipped += 1;
    } else {
      products[existingIndex] = next;
      updated += 1;
    }
  }

  return {
    rows,
    products,
    added,
    updated,
    skipped,
    errors,
    fileName,
  };
}

export default function ProductCatalogPage({
  search,
  onSearchChange,
  institutions,
  isPrimaryOwner = false,
  onOpenOrganization,
  initialTab,
}: ProductCatalogPageProps) {
  const [workspaceTab, setWorkspaceTabState] = useState<ProductWorkspaceTab>(() => {
    if (initialTab) return initialTab;
    if (typeof window === "undefined") return "quotations";
    const requested = new URLSearchParams(window.location.search).get("productTab");
    return requested === "products" || requested === "vendors" ? requested : "quotations";
  });
  const [quotationCount, setQuotationCount] = useState(0);
  const [vendorCount, setVendorCount] = useState(0);
  const updateQuotationCount = useCallback(
    ({ active }: { active: number; trash: number }) => setQuotationCount(active),
    [],
  );
  const [products, setProducts] =
    useState<ProductCatalogItem[]>(PRODUCT_CATALOG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<ProductCatalogItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProductForm | null>(null);
  const [quotation, setQuotation] = useState<QuotationForm | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
  const [vendorOptions, setVendorOptions] = useState<ProductVendorOption[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [comparisonProduct, setComparisonProduct] = useState<ProductCatalogItem | null>(null);
  const [comparisonDocuments, setComparisonDocuments] = useState<ProductComparisonDocument[]>([]);
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const [comparisonPreview, setComparisonPreview] = useState<ProductComparisonDocument | null>(null);
  const [comparisonPreviewWorkbook, setComparisonPreviewWorkbook] = useState<XlsxPreview | null>(null);
  const [comparisonPreviewBusy, setComparisonPreviewBusy] = useState(false);
  const [comparisonPreviewError, setComparisonPreviewError] = useState("");
  const [comparisonPreviewZoom, setComparisonPreviewZoom] = useState(100);
  const [bulkVendorId, setBulkVendorId] = useState("__choose__");
  const [catalogView, setCatalogView] = useState<"all" | "favorites">("all");
  const [productPage, setProductPage] = useState(1);
  const [canReorder, setCanReorder] = useState(false);
  const [draggedProductId, setDraggedProductId] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(search);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickyColumnHeaderRef = useRef<HTMLDivElement>(null);

  function setWorkspaceTab(tab: ProductWorkspaceTab, replace = false) {
    setWorkspaceTabState(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("productTab", tab);
    window.history[replace ? "replaceState" : "pushState"](
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  useEffect(() => {
    if (initialTab) setWorkspaceTab(initialTab, true);
  // initialTab is only used when entering through a legacy route.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  useEffect(() => {
    const openQuotationTarget = () => setWorkspaceTab("quotations", true);
    window.addEventListener("whizzup:quotation-target", openQuotationTarget);
    return () => window.removeEventListener("whizzup:quotation-target", openQuotationTarget);
  // The event is the cross-screen handoff from an already-open institution detail.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const restoreTab = () => {
      const requested = new URLSearchParams(window.location.search).get("productTab");
      setWorkspaceTabState(requested === "products" || requested === "vendors" ? requested : "quotations");
    };
    window.addEventListener("popstate", restoreTab);
    return () => window.removeEventListener("popstate", restoreTab);
  }, []);

  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  useEffect(() => {
    if (searchDraft === search) return;
    const timer = window.setTimeout(() => {
      onSearchChange(searchDraft);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [onSearchChange, search, searchDraft]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 761px) and (pointer: fine)");
    const update = () => setCanReorder(media.matches);
    update();
    media.addEventListener("change", update);
    return×İyêÚ$z{-®éÜj×Æ'WGFöâG—SÒ&'WGFöâ"&–ÖÆ&VÃÒ.Ëi^ÈhÂ"öä6Æ–6³×²‚’Óâ6WD6ö×&—6öå&Wf–Wu¦ööÒ‚‡fÇVR’ÓâÖF‚æÖ‚ƒSÂfÇVRÒ#R’—Óî(‰#Âö'WGFöãàĞ¢Æ#ç¶6ö×&—6öå&Wf–Wu¦öö×ÒSÂö#àĞ¢Æ'WGFöâG—SÒ&'WGFöâ"&–ÖÆ&VÃÒ.Ù™^¸È"öä6Æ–6³×²‚’Óâ6WD6ö×&—6öå&Wf–Wu¦ööÒ‚‡fÇVR’ÓâÖF‚æÖ–âƒ#ÂfÇVR²#R’—ÓîûÈ³Âö'WGFöãàĞ¢Æ‡&Vc×¶ö’÷&öGV7BÖ6ö×&—6öâÖFö7VÖVçG3ö–CÒG¶6ö×&—6öå&Wf–Wræ–GÒfF÷væÆöCÓÓî¸ºNÉ«NºÎ¹9ÃÂöàĞ¢Æ'WGFöâG—SÒ&'WGFöâ"&–ÖÆ&VÃÒ.¸º¾«‹"öä6Æ–6³×²‚’Óâ6WD6ö×&—6öå&Wf–Wr†çVÆÂ—Óì9sÂö'WGFöãàĞ¢ÂöF—càĞ¢Âö†VFW#àĞ¢ÆF—b6Æ74æÖSÒ&6ö×&—6öâ×&Wf–WrÖ6öçFVçB#àĞ¢¶6ö×&—6öå&Wf–Wt'W7’òÆF—b6Æ74æÖSÒ&V×G’×7FFR#îºûºjÎ»;N«‹º[ÂÊH»˜NÙY«:ÉèÈ«^¸¸¸ºBãÂöF—câ¢çVÆÇĞĞ¢¶6ö×&—6öå&Wf–WtW'&÷"òÆF—b6Æ74æÖSÒ&6ö×&—6öâ×&Wf–WrÖæ÷F–6R#ãÇ7G&öæsîºûºjÎ»;N«‹ÉX¸+CÂ÷7G&öæsãÇç¶6ö×&—6öå&Wf–WtW'&÷'ÓÂ÷ãÆ‡&Vc×¶ö’÷&öGV7BÖ6ö×&—6öâÖFö7VÖVçG3ö–CÒG¶6ö×&—6öå&Wf–Wræ–GÒfF÷væÆöCÓÓîÉ¹»;‚¸ºNÉ«NºÎ¹9ÃÂöãÂöF—câ¢çVÆÇĞĞ¢²6ö×&—6öå&Wf–Wt'W7’bb6ö×&—6öå&Wf–WtW'&÷"bb†6ö×&—6öå&Wf–Wræ÷&–v–æÅöæÖRçFôÆö6ÆTÆ÷vW$66R‚’æVæG5v—F‚‚"çFb"’ÇÂ6ö×&—6öå&Wf–WræÖ–ÖU÷G—RÓÓÒ&Æ–6F–öâ÷Fb"’ò€Ğ¢Æ–g&ÖR¶W“×¶6ö×&—6öå&Wf–Wu¦öö×Ò7&3×¶ö’÷&öGV7BÖ6ö×&—6öâÖFö7VÖVçG3ö–CÒG¶6ö×&—6öå&Wf–Wræ–GÒg&Wf–WsÓ7¦ööÓÒG¶6ö×&—6öå&Wf–Wu¦öö×ÖÒF—FÆS×¶G¶6ö×&—6öå&Wf–Wræ÷&–v–æÅöæÖWÒDbØéÉÛNÊxÒóàĞ¢’¢çVÆÇĞĞ¢²6ö×&—6öå&Wf–Wt'W7’bb6ö×&—6öå&Wf–Wuv÷&¶&öö²ò€Ğ¢ÆF—b6Æ74æÖSÒ&6ö×&—6öâ×†Ç7‚×&Wf–Wr"7G–ÆS×·²föçE6—¦S¢G¶6ö×&—6öå&Wf–Wu¦öö×ÒV×ÓàĞ¢¶6ö×&—6öå&Wf–Wuv÷&¶&öö²çG'Væ6FVBòÇ6Æ74æÖSÒ&6ö×&—6öâ×&Wf–Wr×G'Væ6FVB#îØØÈÎÉÛÎÉØÙ™Nº›BÈK¸ª^ÉØBÉÈNÙ[BÉÛÎ»hÈ¹ÎØ«Œ+~Ùhœ+~É{NºxÂÙÎÈ¹ÎÙZ¸¸¸ºBâÊNË+B¸+NÉªÉØ¸ºNÉ«NºÎ¹9ÎÙ[NÈIÂÙ™^ÉÛÙ[BÊ;ÎÈKÉ©BãÂ÷â¢çVÆÇĞĞ¢¶6ö×&—6öå&Wf–Wuv÷&¶&öö²ç6†VWG2æÖ‚‡6†VWB’Óâ€Ğ¢Ç6V7F–öâ¶W“×·6†VWBææÖWÓãÆƒCç·6†VWBææÖWÓÂöƒCãÆF—cãÇF&ÆSãÇF&öG“ç·6†VWBç&÷w2æÖ‚‡&÷rÂ&÷t–æFW‚’ÓâÇG"¶W“×¶G·6†VWBææÖWÒÒG·&÷t–æFW‡ÖÓç·&÷ræÖ‚†6VÆÂÂ6VÆÄ–æFW‚’ÓâÇFB¶W“×¶G·&÷t–æFW‡ÒÒG¶6VÆÄ–æFW‡ÖÓç¶6VÆÇÓÂ÷FCâ—ÓÂ÷G#â—ÓÂ÷F&öG“ãÂ÷F&ÆSãÂöF—cãÂ÷6V7F–öãàĞ¢’—ĞĞ¢¶6ö×&—6öå&Wf–Wuv÷&¶&öö²æ–ÖvW2æÆVæwF‚òÇ6V7F–öâ6Æ74æÖSÒ&6ö×&—6öâ×†Ç7‚Ö–ÖvW2#ãÆƒCîØúÎÙZ¹	ÂÉÛNºûÊxÂöƒCãÆF—cç¶6ö×&—6öå&Wf–Wuv÷&¶&öö²æ–ÖvW2æÖ‚†–ÖvR’ÓâÆf–wW&R¶W“×¶–ÖvRææÖWÓãÆ–Ör7&3×¶–ÖvRçW&ÇÒÇC×¶–ÖvRææÖWÒóãÆf–v6F–öãç¶–ÖvRææÖWÓÂöf–v6F–öããÂöf–wW&Sâ—ÓÂöF—cãÂ÷6V7F–öãâ¢çVÆÇĞĞ¢ÂöF—càĞ¢’¢çVÆÇĞĞ¢ÂöF—càĞ¢Â÷6V7F–öãàĞ¢ÂöF—càĞ¢—ĞĞ Ğ¢·V÷FF–öâbb€Ğ¢ÆF—`Ğ¢6Æ74æÖSÒ'&öGV7BÖ6FÆörÖÖöFÂ×6†VÆÂ Ğ¢&öÆSÒ'&W6VçFF–öâ Ğ¢öäÖ÷W6TF÷vã×²†WfVçB’Óâ°Ğ¢–b†WfVçBæ7W'&VçEF&vWBÓÓÒWfVçBçF&vWB’6WEV÷FF–öâ†çVÆÂ“°Ğ¢×ĞĞ¢àĞ¢Æf÷&ĞĞ¢6Æ74æÖSÒ'&öGV7BÖ6FÆörÖF–ÆörV÷FF–öâÖF–Æör Ğ¢&öÆSÒ&F–Æör Ğ¢&–ÖÖöFÃÒ'G'VR Ğ¢&–ÖÆ&VÆÆVF'“Ò'V÷FF–öâ×F—FÆR Ğ¢öå7V&Ö—C×¶†æFÆUV÷FF–öäF÷væÆöGĞĞ¢àĞ¢ÆF—b6Æ74æÖSÒ'&öGV7BÖ6FÆörÖF–ÆörÖ†VFW"#àĞ¢ÆF—càĞ¢Ç7â6Æ74æÖSÒ'6V7F–öâÖ¶–6¶W"#åTõDD”ôãÂ÷7ãàĞ¢Æƒ2–CÒ'V÷FF–öâ×F—FÆR#î«*ÎÊÈIÂºxÎ¹:N«‹Âöƒ3àĞ¢ÇîÊ	ÎÙ(ÉØBÈJØ9ŞÙY«:È‰¹øÉØBÊÊ	^ÙYº›B«:«	ŞÉª’ÉyÈXºÂ¸+Nº
N»	¾È«^¸¸¸ºBãÂ÷àĞ¢ÂöF—càĞ¢Æ'WGFöàĞ¢G—SÒ&'WGFöâ Ğ¢&–ÖÆ&VÃÒ.¸º¾«‹ Ğ¢öä6Æ–6³×²‚’Óâ6WEV÷FF–öâ†çVÆÂ—ĞĞ¢àĞ¢9pĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ Ğ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâÖÖWFÖw&–B#àĞ¢ÆÆ&VÃàĞ¢Ç7ãî«‹«Hº¨SÂ÷7ãàĞ¢Æ–çW@Ğ¢fÇVS×·V÷FF–öâæ7W7FöÖW$æÖWĞĞ¢öä6†ævS×²†WfVçB’ÓàĞ¢6WEV÷FF–öâ‡°Ğ¢ââçV÷FF–öâÀĞ¢7W7FöÖW$æÖS¢WfVçBçF&vWBçfÇVRÀĞ¢ÒĞ¢ĞĞ¢Æ6V†öÆFW#Ò.Éˆƒ¢È¹ÎÙÚRºzNÙ™NËH¹;ÙY«Y Ğ¢&WV—&V@Ğ¢óàĞ¢ÂöÆ&VÃàĞ¢ÆÆ&VÃàĞ¢Ç7ãî«*ÎÊÉÛÃÂ÷7ãàĞ¢Æ–çW@Ğ¢G—SÒ&FFR Ğ¢fÇVS×·V÷FF–öâçV÷FTFFWĞĞ¢öä6†ævS×²†WfVçB’ÓàĞ¢6WEV÷FF–öâ‡²ââçV÷FF–öâÂV÷FTFFS¢WfVçBçF&vWBçfÇVRÒĞ¢ĞĞ¢&WV—&V@Ğ¢óàĞ¢ÂöÆ&VÃàĞ¢ÆÆ&VÂ6Æ74æÖSÒ'V÷FF–öâ×&ö¦V7BÖf–VÆB#àĞ¢Ç7ãîÈ*ÎÉx^º¨SÂ÷7ãàĞ¢Æ–çW@Ğ¢fÇVS×·V÷FF–öâç&ö¦V7EF—FÆWĞĞ¢öä6†ævS×²†WfVçB’ÓàĞ¢6WEV÷FF–öâ‡°Ğ¢ââçV÷FF–öâÀĞ¢&ö¦V7EF—FÆS¢WfVçBçF&vWBçfÇVRÀĞ¢ÒĞ¢ĞĞ¢Æ6V†öÆFW#Ò.Éˆƒ¢ÈªNºxØ«‚Ë+NÙy«YÈºB«ZÎËiR Ğ¢óàĞ¢ÂöÆ&VÃàĞ¢ÂöF—càĞ Ğ¢Ç6V7F–öâ6Æ74æÖSÒ'V÷FF–öâ×–6¶W"#àĞ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâ×6V7F–öâ×F—FÆR#àĞ¢ÆF—càĞ¢Ç7G&öæsîÊ	ÎÙ(‚ÈJØ9ÓÂ÷7G&öæsàĞ¢Ç7ãîÊ	ÎÙ(º¨^ÉÛN¸)‚«yÎ«*ÉØB«(È8Ù[BËiN«ÙYÈKÉ©BãÂ÷7ãàĞ¢ÂöF—càĞ¢Æ–çW@Ğ¢fÇVS×·V÷FF–öâç6V&6‡ĞĞ¢öä6†ævS×²†WfVçB’ÓàĞ¢6WEV÷FF–öâ‡²ââçV÷FF–öâÂ6V&6ƒ¢WfVçBçF&vWBçfÇVRÒĞ¢ĞĞ¢Æ6V†öÆFW#Ò.Ê	ÎÙ(º¨\+~«yÎ«*’«(È8’ Ğ¢óàĞ¢ÂöF—càĞ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâ×&öGV7B×&W7VÇG2#àĞ¢·V÷FF–öå&öGV7G2æÖ‚‡&öGV7B’Óâ€Ğ¢Æ'WGFöàĞ¢¶W“×·&öGV7Bæ–GĞĞ¢G—SÒ&'WGFöâ Ğ¢öä6Æ–6³×²‚’ÓâFEV÷FF–öå&öGV7B‡&öGV7B—ĞĞ¢àĞ¢Ç7ãàĞ¢Ç7G&öæsç·&öGV7BææÖWÓÂ÷7G&öæsàĞ¢Ç6ÖÆÃç·&öGV7Bç7V6–f–6F–öâÇÂ.«yÎ«*’ºû¹;ºÒ'ÓÂ÷6ÖÆÃàĞ¢Â÷7ãàĞ¢Æ#ç¶f÷&ÖE&–6R‡&öGV7BçVæ—E&–6R—ÓÂö#àĞ¢ÆVÓîËiN«ÂöVÓàĞ¢Âö'WGFöãàĞ¢’—ĞĞ¢²V÷FF–öå&öGV7G2æÆVæwF‚bb€Ğ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâÖæò×&W7VÇB#î«(È8’«+«;Î«ÉxnÈ«^¸¸¸ºBãÂöF—càĞ¢—ĞĞ¢·V÷FF–öå&öGV7DÖF6„6÷VçBâV÷FF–öå&öGV7G2æÆVæwF‚bb€Ğ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâÖæò×&W7VÇB#àĞ¢ÊNË+B·V÷FF–öå&öGV7DÖF6„6÷VçBçFôÆö6ÆU7G&–ær‚—Ş«	ÂÊI²"'ĞĞ¢·V÷FF–öå&öGV7G2æÆVæwF‡Ş«	Îº[ÂÙÎÈ¹ÎÙZ¸¸¸ºBâÊ	ÎÙ(º¨^ÉØB«(È8ÙYº›B¸Ù@Ğ¢»šº[N«(ÂËîÉØBÈ‰‚ÉèÈ«^¸¸¸ºBàĞ¢ÂöF—càĞ¢—ĞĞ¢ÂöF—càĞ¢Â÷6V7F–öãàĞ Ğ¢Ç6V7F–öâ6Æ74æÖSÒ'V÷FF–öâÖÆ–æW2×6V7F–öâ#àĞ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâ×6V7F–öâ×F—FÆR#àĞ¢ÆF—càĞ¢Ç7G&öæsîÈJØ9ŞÙYÂÊ	ÎÙ(ƒÂ÷7G&öæsàĞ¢Ç7ãç·V÷FF–öâæÆ–æW2æÆVæwF‡Ş«	ÂÙ(ºª“Â÷7ãàĞ¢ÂöF—càĞ¢Æ#îÙZ«8B·&–6Tf÷&ÖGFW"æf÷&ÖB‡V÷FF–öåF÷FÂ—ŞÉ¹Âö#àĞ¢ÂöF—càĞ¢·V÷FF–öâæÆ–æW2æÆVæwF‚ò€Ğ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâÖÆ–æW2#àĞ¢·V÷FF–öâæÆ–æW2æÖ‚†Æ–æR’Óâ°Ğ¢6öç7BVçF—G’ÒçVÖ&W"†Æ–æRçVçF—G’ç&WÆ6R‚òÂörÂ""’“°Ğ¢6öç7BVæ—E&–6RÒçVÖ&W"†Æ–æRçVæ—E&–6Rç&WÆ6R‚òÂörÂ""’“°Ğ¢6öç7BÖ÷VçBĞĞ¢„çVÖ&W"æ—4f–æ—FR‡VçF—G’’òVçF—G’¢’ Ğ¢„çVÖ&W"æ—4f–æ—FR‡Væ—E&–6R’òVæ—E&–6R¢“°Ğ¢&WGW&â€Ğ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâÖÆ–æR"¶W“×¶Æ–æRæ–GÓàĞ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâÖÆ–æR×&öGV7B#àĞ¢Ç7G&öæsç¶Æ–æRææÖWÓÂ÷7G&öæsàĞ¢Ç6ÖÆÃç¶Æ–æRç7V6–f–6F–öâÇÂ.«yÎ«*’ºû¹;ºÒ'ÓÂ÷6ÖÆÃàĞ¢ÂöF—càĞ¢ÆÆ&VÃàĞ¢Ç7ãîÈ‰¹ø“Â÷7ãàĞ¢Æ–çW@Ğ¢–çWDÖöFSÒ&FV6–ÖÂ Ğ¢fÇVS×¶Æ–æRçVçF—G—ĞĞ¢öä6†ævS×²†WfVçB’ÓàĞ¢WFFUV÷FF–öäÆ–æR†Æ–æRæ–BÂ°Ğ¢VçF—G“¢WfVçBçF&vWBçfÇVRÀĞ¢ÒĞ¢ĞĞ¢óàĞ¢ÂöÆ&VÃàĞ¢ÆÆ&VÃàĞ¢Ç7ãî¸ºÉÈCÂ÷7ãàĞ¢Æ–çW@Ğ¢fÇVS×¶Æ–æRçVæ—GĞĞ¢öä6†ævS×²†WfVçB’ÓàĞ¢WFFUV÷FF–öäÆ–æR†Æ–æRæ–BÂ°Ğ¢Væ—C¢WfVçBçF&vWBçfÇVRÀĞ¢ÒĞ¢ĞĞ¢óàĞ¢ÂöÆ&VÃàĞ¢ÆÆ&VÂ6Æ74æÖSÒ'V÷FF–öâ×&–6RÖ–çWB#àĞ¢Ç7ãî¸º«Â÷7ãàĞ¢Æ–çW@Ğ¢–çWDÖöFSÒ&çVÖW&–2 Ğ¢fÇVS×¶Æ–æRçVæ—E&–6WĞĞ¢öä6†ævS×²†WfVçB’ÓàĞ¢WFFUV÷FF–öäÆ–æR†Æ–æRæ–BÂ°Ğ¢Væ—E&–6S¢WfVçBçF&vWBçfÇVRÀĞ¢ÒĞ¢ĞĞ¢óàĞ¢ÂöÆ&VÃàĞ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâÖÆ–æRÖÖ÷VçB#àĞ¢Ç7ãî«ˆÉZÂ÷7ãàĞ¢Ç7G&öæsç·&–6Tf÷&ÖGFW"æf÷&ÖB†Ö÷VçB—ŞÉ¹Â÷7G&öæsàĞ¢ÂöF—càĞ¢ÆÆ&VÂ6Æ74æÖSÒ'V÷FF–öâÖæ÷FRÖ–çWB#àĞ¢Ç7ãî»˜N«:Â÷7ãàĞ¢Æ–çW@Ğ¢fÇVS×¶Æ–æRææ÷FWĞĞ¢öä6†ævS×²†WfVçB’ÓàĞ¢WFFUV÷FF–öäÆ–æR†Æ–æRæ–BÂ°Ğ¢æ÷FS¢WfVçBçF&vWBçfÇVRÀĞ¢ÒĞ¢ĞĞ¢Æ6V†öÆFW#Ò.ÈJØ9ÒÉè^º
R Ğ¢óàĞ¢ÂöÆ&VÃàĞ¢Æ'WGFöàĞ¢G—SÒ&'WGFöâ Ğ¢6Æ74æÖSÒ'V÷FF–öâ×&VÖ÷fR Ğ¢öä6Æ–6³×²‚’Óâ&VÖ÷fUV÷FF–öäÆ–æR†Æ–æRæ–B—ĞĞ¢&–ÖÆ&VÃ×¶G¶Æ–æRææÖWÒÈ*ŞÊ	ÆĞĞ¢àĞ¢È*ŞÊ	ÀĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢“°Ğ¢Ò—ĞĞ¢ÂöF—càĞ¢’¢€Ğ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâÖV×G’#àĞ¢ÉÈB«(È8’«+«;ÎÉyÈIÂ«*ÎÊÙZÊ	ÎÙ(ÉØBÈJØ9ŞÙ[BÊ;ÎÈKÉ©BàĞ¢ÂöF—càĞ¢—ĞĞ¢Â÷6V7F–öãàĞ Ğ¢ÆF—b6Æ74æÖSÒ'V÷FF–öâÖæ÷F–6R#àĞ¢È‰È‰º8ÎÉÊŒ+~ºxÊxNÉÊŒ+~¸+N»hË«:È*ÎÙZŞÉØ«*ÎÊÈIÎÉyØúÎÙZ¹	ÊxÉX®ÉËÎº›ÂÙÎÈ¹Â«ˆÉZÉØ Ğ¢»h«ÈK‚ØúÎÙZ‚«‹ÊHÉè^¸¸¸ºBàĞ¢ÂöF—càĞ¢ÆF—b6Æ74æÖSÒ'&öGV7BÖ6FÆörÖF–ÆörÖ7F–öç2#àĞ¢Æ'WGFöàĞ¢G—SÒ&'WGFöâ Ğ¢6Æ74æÖSÒ'6V6öæF'’Ö'WGFöâ Ğ¢öä6Æ–6³×²‚’Óâ6WEV÷FF–öâ†çVÆÂ—ĞĞ¢àĞ¢ËzÈhÀĞ¢Âö'WGFöãàĞ¢Æ'WGFöâG—SÒ'7V&Ö—B"6Æ74æÖSÒ'&–Ö'’Ö'WGFöâ#àĞ¢ÉyÈX«*ÎÊÈIÂ¸+Nº
N»	¾«‹ Ğ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢Âöf÷&ÓàĞ¢ÂöF—càĞ¢—ĞĞ Ğ¢¶–×÷'E&Wf–Wrbb€Ğ¢ÆF—b6Æ74æÖSÒ'&öGV7BÖ6FÆörÖÖöFÂ×6†VÆÂ"&öÆSÒ'&W6VçFF–öâ#àĞ¢Ç6V7F–öàĞ¢6Æ74æÖSÒ'&öGV7BÖ6FÆörÖF–Æör&öGV7BÖ–×÷'BÖF–Æör Ğ¢&öÆSÒ&F–Æör Ğ¢&–ÖÖöFÃÒ'G'VR Ğ¢&–ÖÆ&VÆÆVF'“Ò'&öGV7BÖ–×÷'B×F—FÆR Ğ¢àĞ¢ÆF—b6Æ74æÖSÒ'&öGV7BÖ6FÆörÖF–ÆörÖ†VFW"#àĞ¢ÆF—càĞ¢Ç7â6Æ74æÖSÒ'6V7F–öâÖ¶–6¶W"#äU„4TÂ$Ud”UsÂ÷7ãàĞ¢Æƒ2–CÒ'&öGV7BÖ–×÷'B×F—FÆR#îÉyÈX¸+NÉª’«(ØjÂöƒ3àĞ¢Çç¶–×÷'E&Wf–Wræf–ÆTæÖWÓÂ÷àĞ¢ÂöF—càĞ¢Æ'WGFöàĞ¢G—SÒ&'WGFöâ Ğ¢&–ÖÆ&VÃÒ.¸º¾«‹ Ğ¢öä6Æ–6³×²‚’Óâ6WD–×÷'E&Wf–Wr†çVÆÂ—ĞĞ¢F—6&ÆVC×·6f–æwĞĞ¢àĞ¢9pĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢ÆF—b6Æ74æÖSÒ'&öGV7BÖ–×÷'B×7VÖÖ'’#àĞ¢Ç7ãàĞ¢Èº«yÂÇ7G&öæsç¶–×÷'E&Wf–WræFFVGŞ«	ÃÂ÷7G&öæsàĞ¢Â÷7ãàĞ¢Ç7ãàĞ¢È‰Ê	RÇ7G&öæsç¶–×÷'E&Wf–WrçWFFVGŞ«	ÃÂ÷7G&öæsàĞ¢Â÷7ãàĞ¢Ç7ãàĞ¢»8«+ÒÉxnÉØÂÇ7G&öæsç¶–×÷'E&Wf–Wrç6¶—VGŞ«	ÃÂ÷7G&öæsàĞ¢Â÷7ãàĞ¢Ç7â6Æ74æÖS×¶–×÷'E&Wf–WræW'&÷'2ò&†2ÖW'&÷""¢"'ÓàĞ¢ÉŠNºY‚Ç7G&öæsç¶–×÷'E&Wf–WræW'&÷'7Ş«	ÃÂ÷7G&öæsàĞ¢Â÷7ãàĞ¢ÂöF—càĞ¢Ç6Æ74æÖSÒ'&öGV7BÖ–×÷'BÖwV–FR#àĞ¢»˜‚ÈXÉØ«‹ÊBÊ	^»;Nº[ÂÊxÉ«ÊxÉX®È«^¸¸¸ºBâÉŠNºY«Éè¸©BÙhÉØÊ	ÎÉ›ÙY«: Ğ¢ÊÉª¹
¸¸¸ºBàĞ¢Â÷àĞ¢¶–×÷'E&Wf–WræW'&÷'2âbb€Ğ¢ÆF—b6Æ74æÖSÒ'&öGV7BÖ–×÷'BÖW'&÷'2#àĞ¢¶–×÷'E&Wf–Wrç&÷w0Ğ¢æf–ÇFW"‚‡&÷r’Óâ&÷ræW'&÷'2æÆVæwF‚Ğ¢ç6Æ–6RƒÂ‚Ğ¢æÖ‚‡&÷r’Óâ€Ğ¢Ç¶W“×·&÷rç&÷tçVÖ&W'ÓàĞ¢·&÷rç&÷tçVÖ&W'ŞÙh’+r·&÷ræW'&÷'2æ¦ö–â‚""—ĞĞ¢Â÷àĞ¢’—ĞĞ¢ÂöF—càĞ¢—ĞĞ¢ÆF—b6Æ74æÖSÒ'&öGV7BÖ6FÆörÖF–ÆörÖ7F–öç2#àĞ¢Æ'WGFöàĞ¢G—SÒ&'WGFöâ Ğ¢6Æ74æÖSÒ'6V6öæF'’Ö'WGFöâ Ğ¢öä6Æ–6³×²‚’Óâ6WD–×÷'E&Wf–Wr†çVÆÂ—ĞĞ¢F—6&ÆVC×·6f–æwĞĞ¢àĞ¢ËzÈhÀĞ¢Âö'WGFöãàĞ¢Æ'WGFöàĞ¢G—SÒ&'WGFöâ Ğ¢6Æ74æÖSÒ'&–Ö'’Ö'WGFöâ Ğ¢öä6Æ–6³×¶Ç”–×÷'GĞĞ¢F—6&ÆVC×°Ğ¢6f–ærÇÀĞ¢‚–×÷'E&Wf–WræFFVBbb–×÷'E&Wf–WrçWFFVBĞ¢ĞĞ¢àĞ¢·6f–ærò.ÊÉª’ÊI(
b"¢.«(Øj¸+NÉª’ÊÉª’'ĞĞ¢Âö'WGFöãàĞ¢ÂöF—càĞ¢Â÷6V7F–öãàĞ¢ÂöF—càĞ¢—ĞĞ¢ÂóàĞ¢“°Ğ§ĞĞ 