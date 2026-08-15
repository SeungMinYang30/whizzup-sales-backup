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
  return value === null ? "—" : `${priceFormatter.format(value)}원`;
}

function formatRate(value: number | null) {
  if (value === null) return "—";
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
  return value.replace(/[\\/:*?"<>|]/g, "_").trim() || "기관";
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
  const normalized = value.trim().replace(/[,\s원%]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      kind === "price"
        ? "단가는 0 이상의 숫자로 입력해 주세요."
        : "수수료율 또는 마진율은 0~100 사이 숫자로 입력해 주세요.",
    );
  }
  if (kind === "rate" && parsed > 100) {
    throw new Error("수수료율 또는 마진율은 100% 이하로 입력해 주세요.");
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
  anchor.download = `위즈업_제품기준정보_${new Date()
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
  const [quotationCount, setQuotationCount] = useState<number | null>(null);
  const [vendorCount, setVendorCount] = useState<number | null>(null);
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
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/product-catalog", { cache: "no-store" }),
      fetch("/api/quotations?summary=1", { cache: "no-store" }),
    ])
      .then(async ([productResponse, quotationResponse]) => {
        if (!productResponse.ok) throw new Error("제품 정보를 불러오지 못했습니다.");
        const productData = (await productResponse.json()) as {
          products?: ProductCatalogItem[];
          favoriteProductIds?: string[];
          vendors?: ProductVendorOption[];
        };
        const quotationData = quotationResponse.ok
          ? (await quotationResponse.json()) as { totalCount?: number }
          : {};
        return { productData, quotationData };
      })
      .then(({ productData, quotationData }) => {
        if (active && Array.isArray(productData.products) && productData.products.length) {
          setProducts(productData.products);
        }
        if (active && Array.isArray(productData.favoriteProductIds)) {
          setFavoriteProductIds(productData.favoriteProductIds);
        }
        if (active && Array.isArray(productData.vendors)) {
          setVendorOptions(productData.vendors);
          setVendorCount(productData.vendors.length);
        }
        if (active && Number.isSafeInteger(quotationData.totalCount)) {
          setQuotationCount(Math.max(0, Number(quotationData.totalCount)));
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setMessage(
            error instanceof Error
              ? error.message
              : "제품 정보를 불러오지 못했습니다.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const deferredSearch = useDeferredValue(searchDraft);
  const normalizedSearch = normalizeSearchValue(deferredSearch.trim());
  const quotationOpen = quotation !== null;
  const quotationLines = quotation?.lines ?? null;
  const deferredQuotationSearch = useDeferredValue(quotation?.search ?? "");
  const favoriteProductIdSet = useMemo(
    () => new Set(favoriteProductIds),
    [favoriteProductIds],
  );
  const groupedProducts = useMemo(() => {
    const favorites = products.filter((product) =>
      favoriteProductIdSet.has(product.id),
    );
    const regular = products.filter(
      (product) => !favoriteProductIdSet.has(product.id),
    );
    return [...favorites, ...regular];
  }, [favoriteProductIdSet, products]);
  const visibleProducts = useMemo(() => {
    return groupedProducts.filter((product) => {
      if (catalogView === "favorites" && !favoriteProductIdSet.has(product.id)) {
        return false;
      }
      if (!normalizedSearch) return true;
      return normalizeSearchValue(
        [
          product.name,
          product.specification,
          product.note,
          product.reference,
          product.supplierVendorName ?? "",
          product.supplyType === "direct"
            ? "위즈업 직접 공급 마진"
            : "협력사 공급 수수료",
          product.unitPrice === null ? "" : String(product.unitPrice),
          (product.supplyType === "direct"
            ? product.marginRate
            : product.commissionRate) === null
            ? ""
            : String(
                (product.supplyType === "direct"
                  ? product.marginRate
                  : product.commissionRate)! * 100,
              ),
        ].join(" "),
      ).includes(normalizedSearch);
    });
  }, [catalogView, favoriteProductIdSet, groupedProducts, normalizedSearch]);
  const productPageCount = Math.max(
    1,
    Math.ceil(visibleProducts.length / PRODUCT_PAGE_SIZE),
  );
  const productPageItems = useMemo(() => {
    const offset = (productPage - 1) * PRODUCT_PAGE_SIZE;
    return visibleProducts.slice(offset, offset + PRODUCT_PAGE_SIZE);
  }, [productPage, visibleProducts]);
  const selectedProductIdSet = useMemo(
    () => new Set(selectedProductIds),
    [selectedProductIds],
  );
  const currentPageSelected =
    productPageItems.length > 0 &&
    productPageItems.every((product) => selectedProductIdSet.has(product.id));
  useEffect(() => {
    setProductPage(1);
  }, [catalogView, normalizedSearch]);

  useEffect(() => {
    setProductPage((current) => Math.min(current, productPageCount));
  }, [productPageCount]);

  const { quotationProducts, quotationProductMatchCount } = useMemo(() => {
    if (!quotationOpen) {
      return { quotationProducts: [], quotationProductMatchCount: 0 };
    }
    const query = normalizeSearchValue(deferredQuotationSearch.trim());
    const matches = query
      ? groupedProducts.filter((product) =>
          normalizeSearchValue(
            [product.name, product.specification, product.note].join(" "),
          ).includes(query),
        )
      : groupedProducts;
    return {
      quotationProducts: matches.slice(0, QUOTATION_PRODUCT_RESULT_LIMIT),
      quotationProductMatchCount: matches.length,
    };
  }, [deferredQuotationSearch, groupedProducts, quotationOpen]);

  const quotationTotal = useMemo(() => {
    if (!quotationLines) return 0;
    return quotationLines.reduce((sum, line) => {
      const quantity = Number(line.quantity.replace(/,/g, ""));
      const unitPrice = Number(line.unitPrice.replace(/,/g, ""));
      return sum + (Number.isFinite(quantity) ? quantity : 0) *
        (Number.isFinite(unitPrice) ? unitPrice : 0);
    }, 0);
  }, [quotationLines]);

  async function persistProducts(nextProducts: ProductCatalogItem[]) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/product-catalog", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: nextProducts }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        products?: ProductCatalogItem[];
        vendors?: ProductVendorOption[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.products)) {
        throw new Error(data.error || "제품 정보를 저장하지 못했습니다.");
      }
      setProducts(data.products);
      if (Array.isArray(data.vendors)) setVendorOptions(data.vendors);
      return data.products;
    } finally {
      setSaving(false);
    }
  }

  async function persistBulkProductVendor() {
    if (!selectedProductIds.length || bulkVendorId === "__choose__" || saving) {
      return;
    }
    const selectedSupplyType =
      bulkVendorId === "__direct__" ? "direct" : "partner";
    const selectedVendorId =
      selectedSupplyType === "partner" && bulkVendorId
        ? Number(bulkVendorId)
        : null;
    const selectedSupplyName =
      selectedSupplyType === "direct"
        ? "위즈업 직접 공급"
        : selectedVendorId === null
          ? "협력사 미연결"
          : vendorOptions.find((vendor) => vendor.id === selectedVendorId)
              ?.companyName || "선택한 협력사";
    const selectedProducts = products.filter((product) =>
      selectedProductIdSet.has(product.id),
    );
    const overwriteCount = selectedProducts.filter((product) => {
      const currentId = product.supplierVendorId ?? null;
      return (
        product.supplyType !== selectedSupplyType ||
        (selectedSupplyType === "partner" &&
          currentId !== null &&
          currentId !== selectedVendorId)
      );
    }).length;
    if (
      overwriteCount > 0 &&
      !window.confirm(
        `선택한 제품 중 ${overwriteCount.toLocaleString()}개는 기존 공급 구분이 설정되어 있습니다. '${selectedSupplyName}'(으)로 일괄 변경할까요?`,
      )
    ) {
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const nextProducts = products.map((product) => {
        if (!selectedProductIdSet.has(product.id)) return product;
        const activeRate =
          product.supplyType === "direct"
            ? product.marginRate
            : product.commissionRate;
        return {
          ...product,
          supplyType: selectedSupplyType,
          commissionRate:
            selectedSupplyType === "partner" ? activeRate : null,
          marginRate:
            selectedSupplyType === "direct" ? activeRate : null,
          supplierVendorId:
            selectedSupplyType === "partner" ? selectedVendorId : null,
          supplierVendorName:
            selectedSupplyType === "partner"
              ? selectedSupplyName === "협력사 미연결"
                ? ""
                : selectedSupplyName
              : "",
        } satisfies ProductCatalogItem;
      });
      await persistProducts(nextProducts);
      setSelectedProductIds([]);
      setBulkVendorId("__choose__");
      setMessage(
        `${selectedProducts.length.toLocaleString()}개 제품의 공급 구분을 '${selectedSupplyName}'(으)로 변경했습니다.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "제품 공급 구분을 일괄 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleCurrentProductPage() {
    const pageIds = productPageItems.map((product) => product.id);
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (currentPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return [...next];
    });
  }

  async function persistProductOrder(nextProducts: ProductCatalogItem[]) {
    const previousProducts = products;
    setProducts(nextProducts);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/product-catalog", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productOrder: nextProducts.map((product) => product.id),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        products?: ProductCatalogItem[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.products)) {
        throw new Error(data.error || "제품 순서를 저장하지 못했습니다.");
      }
      setProducts(data.products);
      setMessage("내 제품 순서를 저장했습니다.");
    } catch (error) {
      setProducts(previousProducts);
      setMessage(
        error instanceof Error ? error.message : "제품 순서를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavoriteProduct(productId: string) {
    if (saving) return;
    const viewport = { x: window.scrollX, y: window.scrollY };
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const restoreViewport = () => {
      window.requestAnimationFrame(() => {
        window.scrollTo(viewport.x, viewport.y);
        window.requestAnimationFrame(() => {
          window.scrollTo(viewport.x, viewport.y);
        });
      });
    };
    const previousFavoriteProductIds = favoriteProductIds;
    const nextFavoriteProductIds = favoriteProductIdSet.has(productId)
      ? favoriteProductIds.filter((id) => id !== productId)
      : [...favoriteProductIds, productId];
    setFavoriteProductIds(nextFavoriteProductIds);
    restoreViewport();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/product-catalog", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favoriteProductIds: nextFavoriteProductIds }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        favoriteProductIds?: string[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.favoriteProductIds)) {
        throw new Error(data.error || "즐겨찾기를 저장하지 못했습니다.");
      }
      setFavoriteProductIds(data.favoriteProductIds);
      restoreViewport();
    } catch (error) {
      setFavoriteProductIds(previousFavoriteProductIds);
      restoreViewport();
      setMessage(
        error instanceof Error ? error.message : "즐겨찾기를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  function reorderProductGroup(productId: string, targetProductId: string) {
    const isFavorite = favoriteProductIdSet.has(productId);
    if (isFavorite !== favoriteProductIdSet.has(targetProductId)) return null;
    const group = products.filter(
      (product) => favoriteProductIdSet.has(product.id) === isFavorite,
    );
    const fromIndex = group.findIndex((product) => product.id === productId);
    const targetIndex = group.findIndex((product) => product.id === targetProductId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return null;
    const reorderedGroup = [...group];
    const [moved] = reorderedGroup.splice(fromIndex, 1);
    reorderedGroup.splice(targetIndex, 0, moved);
    let groupIndex = 0;
    return products.map((product) =>
      favoriteProductIdSet.has(product.id) === isFavorite
        ? reorderedGroup[groupIndex++]
        : product,
    );
  }

  function isProductGroupEdge(productId: string, direction: -1 | 1) {
    const isFavorite = favoriteProductIdSet.has(productId);
    const group = products.filter(
      (product) => favoriteProductIdSet.has(product.id) === isFavorite,
    );
    return direction === -1
      ? group[0]?.id === productId
      : group.at(-1)?.id === productId;
  }

  function moveProduct(productId: string, direction: -1 | 1) {
    if (!canReorder || normalizedSearch || catalogView !== "all" || saving) return;
    const isFavorite = favoriteProductIdSet.has(productId);
    const group = products.filter(
      (product) => favoriteProductIdSet.has(product.id) === isFavorite,
    );
    const index = group.findIndex((product) => product.id === productId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= group.length) return;
    const nextProducts = reorderProductGroup(productId, group[nextIndex].id);
    if (nextProducts) void persistProductOrder(nextProducts);
  }

  function dropProduct(targetProductId: string) {
    if (
      !canReorder ||
      !draggedProductId ||
      draggedProductId === targetProductId ||
      normalizedSearch ||
      catalogView !== "all" ||
      saving
    ) {
      setDraggedProductId(null);
      return;
    }
    const nextProducts = reorderProductGroup(draggedProductId, targetProductId);
    setDraggedProductId(null);
    if (nextProducts) void persistProductOrder(nextProducts);
  }

  async function resetProductOrder() {
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/product-catalog", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productOrder: [] }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        products?: ProductCatalogItem[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.products)) {
        throw new Error(data.error || "기본 순서로 되돌리지 못했습니다.");
      }
      setProducts(data.products);
      setMessage("제품 순서를 기본값으로 되돌렸습니다.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "기본 순서로 되돌리지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  function openEditor(product: ProductCatalogItem) {
    setCreating(false);
    setEditing(product);
    setForm(toForm(product));
    setMessage("");
  }

  function openCreateEditor() {
    setEditing(null);
    setCreating(true);
    setForm(createEmptyProductForm());
    setMessage("");
  }

  function closeEditor() {
    setEditing(null);
    setCreating(false);
    setForm(null);
  }

  async function handleSaveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || (!editing && !creating)) return;
    try {
      if (!form.name.trim()) {
        throw new Error("품명을 입력해 주세요.");
      }
      const previousActiveRate =
        editing?.supplyType === "direct"
          ? editing.marginRate
          : editing?.commissionRate ?? null;
      const activeRate =
        editing && !form.rateEdited
          ? previousActiveRate
          : parseOptionalNumber(form.commissionRate, "rate");
      const nextProduct: ProductCatalogItem = {
        ...(editing ?? {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `product-${Date.now()}`,
          sourceRow: products.length
            ? Math.max(...products.map((product) => product.sourceRow)) + 1
            : 1,
          needsReview: false,
        }),
        name: form.name.trim(),
        specification: form.specification.trim(),
        unitPrice: parseOptionalNumber(form.unitPrice, "price"),
        note: form.note.trim(),
        supplyType: form.supplyType,
        commissionRate:
          form.supplyType === "partner" ? activeRate : null,
        marginRate:
          form.supplyType === "direct" ? activeRate : null,
        reference: form.reference.trim(),
        supplierVendorId:
          form.supplyType === "partner" && form.supplierVendorId
            ? Number(form.supplierVendorId)
            : null,
        supplierVendorName:
          form.supplyType === "partner"
            ? vendorOptions.find(
                (vendor) => String(vendor.id) === form.supplierVendorId,
              )?.companyName ?? ""
            : "",
        procurement: form.procurement,
        procurementChannel: form.procurement ? form.procurementChannel : "",
        procurementNumber: form.procurement ? form.procurementNumber.trim() : "",
        procurementFeeRate: form.procurement ? (parseOptionalNumber(form.procurementFeeRate, "rate") ?? 0.0054) : null,
      };
      nextProduct.needsReview = calculateNeedsReview(nextProduct);
      const nextProducts = editing
        ? products.map((product) =>
            product.id === editing.id ? nextProduct : product,
          )
        : [...products, nextProduct];
      await persistProducts(nextProducts);
      closeEditor();
      setMessage(editing ? "제품 정보를 저장했습니다." : "제품을 추가했습니다.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "제품 정보를 저장하지 못했습니다.",
      );
    }
  }

  async function handleDeleteProduct(product: ProductCatalogItem) {
    if (!window.confirm(`'${product.name}' 제품을 삭제할까요?`)) return;
    try {
      const nextProducts = products.filter((item) => item.id !== product.id);
      await persistProducts(nextProducts);
      setQuotation((current) =>
        current
          ? {
              ...current,
              lines: current.lines.filter(
                (line) => line.productId !== product.id,
              ),
            }
          : current,
      );
      setMessage("제품을 삭제했습니다.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "제품을 삭제하지 못했습니다.",
      );
    }
  }

  async function handleWorkbook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage("");
    try {
      const rows = parseProductCatalogWorkbook(await file.arrayBuffer());
      setImportPreview(buildImportPreview(rows, products, file.name));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "엑셀 파일을 읽지 못했습니다.",
      );
    }
  }

  async function applyImport() {
    if (!importPreview) return;
    try {
      await persistProducts(importPreview.products);
      setImportPreview(null);
      setMessage(
        `엑셀 내용을 적용했습니다. 신규 ${importPreview.added}개, 수정 ${importPreview.updated}개`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "엑셀 내용을 적용하지 못했습니다.",
      );
    }
  }

  function openQuotation() {
    setQuotation({
      customerName: "",
      quoteDate: localDateString(),
      projectTitle: "",
      search: "",
      lines: [],
    });
    setMessage("");
  }

  async function openProductComparison(product: ProductCatalogItem) {
    setComparisonProduct(product);
    setComparisonBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/product-comparison-documents?catalogProductId=${encodeURIComponent(product.id)}`,
        { cache: "no-store" },
      );
      const body = await response.json() as { documents?: ProductComparisonDocument[]; error?: string };
      if (!response.ok) throw new Error(body.error || "물품 비교표를 불러오지 못했습니다.");
      const documents = body.documents ?? [];
      setComparisonDocuments(documents);
      return documents;
    } catch (error) {
      setComparisonDocuments([]);
      setMessage(error instanceof Error ? error.message : "물품 비교표를 불러오지 못했습니다.");
      return [] as ProductComparisonDocument[];
    } finally {
      setComparisonBusy(false);
    }
  }

  async function openComparisonPreview(document: ProductComparisonDocument) {
    setComparisonPreview(document);
    setComparisonPreviewWorkbook(null);
    setComparisonPreviewError("");
    setComparisonPreviewZoom(100);
    const lowerName = document.original_name.toLocaleLowerCase();
    if (lowerName.endsWith(".pdf") || document.mime_type === "application/pdf") return;
    if (!lowerName.endsWith(".xlsx")) {
      setComparisonPreviewError("이 파일 형식은 화면 미리보기를 지원하지 않습니다. 원본을 다운로드해 확인해 주세요.");
      return;
    }
    setComparisonPreviewBusy(true);
    try {
      const response = await fetch(`/api/product-comparison-documents?id=${document.id}&download=1`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "Excel 미리보기 파일을 불러오지 못했습니다.");
      }
      setComparisonPreviewWorkbook(parseXlsxPreview(await response.arrayBuffer()));
    } catch (error) {
      setComparisonPreviewError(error instanceof Error ? error.message : "Excel 미리보기를 만들지 못했습니다.");
    } finally {
      setComparisonPreviewBusy(false);
    }
  }

  async function uploadProductComparison(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comparisonProduct || comparisonBusy) return;
    const formElement = event.currentTarget;
    const body = new FormData(formElement);
    body.set("catalogProductId", comparisonProduct.id);
    body.set("productName", comparisonProduct.name);
    setComparisonBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/product-comparison-documents", { method: "POST", body });
      const result = await response.json() as { error?: string; replaced?: boolean };
      if (!response.ok) throw new Error(result.error || "물품 비교표를 저장하지 못했습니다.");
      formElement.reset();
      const documents = await openProductComparison(comparisonProduct);
      setMessage(result.replaced ? "물품 비교표를 교체했습니다." : "물품 비교표를 등록했습니다.");
      if (documents[0]) await openComparisonPreview(documents[0]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "물품 비교표를 저장하지 못했습니다.");
      setComparisonBusy(false);
    }
  }

  async function deleteProductComparison(id: number) {
    if (!comparisonProduct || comparisonBusy || !window.confirm("이 제품의 물품 비교표를 삭제할까요?")) return;
    setComparisonBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/product-comparison-documents?id=${id}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "물품 비교표를 삭제하지 못했습니다.");
      await openProductComparison(comparisonProduct);
      setMessage("물품 비교표를 삭제했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "물품 비교표를 삭제하지 못했습니다.");
      setComparisonBusy(false);
    }
  }

  function addQuotationProduct(product: ProductCatalogItem) {
    setQuotation((current) => {
      if (!current) return current;
      const existing = current.lines.find(
        (line) => line.productId === product.id,
      );
      if (existing) {
        return {
          ...current,
          lines: current.lines.map((line) =>
            line.id === existing.id
              ? {
                  ...line,
                  quantity: String(
                    Math.max(1, Number(line.quantity.replace(/,/g, "")) || 0) +
                      1,
                  ),
                }
              : line,
          ),
        };
      }
      return {
        ...current,
        lines: [
          ...current.lines,
          {
            id: `quote-${Date.now()}-${product.id}`,
            productId: product.id,
            name: product.name,
            specification: product.specification,
            quantity: "1",
            unit: "식",
            unitPrice:
              product.unitPrice === null ? "" : String(product.unitPrice),
            note: "",
          },
        ],
      };
    });
  }

  function updateQuotationLine(
    id: string,
    patch: Partial<QuotationDraftLine>,
  ) {
    setQuotation((current) =>
      current
        ? {
            ...current,
            lines: current.lines.map((line) =>
              line.id === id ? { ...line, ...patch } : line,
            ),
          }
        : current,
    );
  }

  function removeQuotationLine(id: string) {
    setQuotation((current) =>
      current
        ? { ...current, lines: current.lines.filter((line) => line.id !== id) }
        : current,
    );
  }

  function handleQuotationDownload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quotation) return;
    try {
      if (!quotation.customerName.trim()) {
        throw new Error("견적서를 받을 기관명을 입력해 주세요.");
      }
      if (!quotation.lines.length) {
        throw new Error("견적서에 넣을 제품을 하나 이상 선택해 주세요.");
      }
      const lines: QuotationLine[] = quotation.lines.map((line) => {
        const quantity = Number(line.quantity.replace(/,/g, ""));
        const unitPrice = Number(line.unitPrice.replace(/,/g, ""));
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error(`${line.name}의 수량을 확인해 주세요.`);
        }
        if (!line.unitPrice.trim() || !Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new Error(`${line.name}의 단가를 확인해 주세요.`);
        }
        return {
          name: line.name,
          specification: line.specification,
          quantity,
          unit: line.unit.trim() || "식",
          unitPrice,
          note: line.note.trim(),
        };
      });
      const bytes = createQuotationWorkbook({
        customerName: quotation.customerName.trim(),
        quoteDate: quotation.quoteDate || localDateString(),
        projectTitle: quotation.projectTitle.trim(),
        lines,
      });
      downloadBytes(
        bytes,
        `견적서_${safeFileName(quotation.customerName)}_${quotation.quoteDate || localDateString()}.xlsx`,
      );
      setQuotation(null);
      setMessage("고객용 견적서 엑셀을 내려받았습니다.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "견적서를 만들지 못했습니다.",
      );
    }
  }

  return (
    <>
      <nav className="product-workspace-tabs" aria-label="제품·견적·협력사 관리 화면">
        <button type="button" className={workspaceTab === "quotations" ? "active" : ""} onClick={() => setWorkspaceTab("quotations")}>
          <span>견적서 관리</span><b>{quotationCount === null ? "…" : quotationCount.toLocaleString()}</b>
        </button>
        <button type="button" className={workspaceTab === "products" ? "active" : ""} onClick={() => setWorkspaceTab("products")}>
          <span>제품 기준정보</span><b>{products.length.toLocaleString()}</b>
        </button>
        <button type="button" className={workspaceTab === "vendors" ? "active" : ""} onClick={() => setWorkspaceTab("vendors")}>
          <span>협력사 관리</span><b>{vendorCount === null ? "…" : vendorCount.toLocaleString()}</b>
        </button>
      </nav>

      {workspaceTab === "quotations" && <QuotationManagementPage
        institutions={institutions}
        onOpenOrganization={onOpenOrganization}
        onCountChange={updateQuotationCount}
      />}

      {workspaceTab === "products" && <section className="panel product-catalog-panel">
        <div className="product-catalog-sticky-controls">
        <div className="panel-header product-catalog-header">
          <div>
            <span className="section-kicker">PRODUCT CATALOG</span>
            <h2>제품 기준 정보</h2>
            <p>품명·규격·단가·공급 구분·수수료율·마진율을 정리했습니다.</p>
          </div>
          <div className="product-catalog-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void resetProductOrder()}
              disabled={saving}
            >
              기본 순서로
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={openCreateEditor}
            >
              제품 추가
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => downloadWorkbook([])}
            >
              엑셀 양식 내려받기
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => fileInputRef.current?.click()}
            >
              엑셀 불러오기
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleWorkbook}
              hidden
            />
          </div>
        </div>

        {message && (
          <div className="product-catalog-message" role="status">
            {message}
          </div>
        )}

        <div className="product-catalog-search-row">
          <label>
            <span className="sr-only">제품·견적 검색</span>
            <input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="제품명·업체명·모델명·규격·제품 코드 검색"
            />
          </label>
          {searchDraft && (
            <button
              type="button"
              onClick={() => {
                setSearchDraft("");
                onSearchChange("");
              }}
            >
              검색 지우기
            </button>
          )}
        </div>

        <div className="product-catalog-result">
          <div className="product-catalog-result-summary">
            <span>
              {loading
                ? "제품 정보를 불러오는 중입니다."
                : normalizedSearch
                  ? `검색 결과 ${visibleProducts.length}개`
                  : catalogView === "favorites"
                    ? `즐겨찾기 ${visibleProducts.length}개`
                    : `전체 ${visibleProducts.length}개 제품을 표시 중입니다.`}
            </span>
            <div className="product-catalog-view-toggle" role="group" aria-label="제품 표시 범위">
              <button
                type="button"
                className={catalogView === "all" ? "active" : ""}
                onClick={() => setCatalogView("all")}
              >
                전체
              </button>
              <button
                type="button"
                className={catalogView === "favorites" ? "active" : ""}
                onClick={() => setCatalogView("favorites")}
              >
                ★ 즐겨찾기 {products.filter((product) => favoriteProductIdSet.has(product.id)).length}
              </button>
            </div>
          </div>
          <div className="product-catalog-result-notes">
            <small>별표와 제품 순서는 개인별로 저장됩니다.</small>
            <small>
              {normalizedSearch || catalogView === "favorites"
                ? "검색 또는 즐겨찾기 보기 중에는 순서를 변경할 수 없습니다."
                : canReorder
                  ? "PC에서는 끌어서 놓거나 화살표로 내 순서를 저장할 수 있습니다."
                  : "PC에서 저장한 내 순서대로 표시됩니다."}
            </small>
          </div>
        </div>

        <div className="product-catalog-bulk-vendor">
          <label className="product-catalog-bulk-select-all">
            <input
              type="checkbox"
              checked={currentPageSelected}
              disabled={!productPageItems.length || saving}
              onChange={toggleCurrentProductPage}
            />
            <span>현재 페이지 전체 선택</span>
          </label>
          <strong>{selectedProductIds.length.toLocaleString()}개 선택</strong>
          <select
            value={bulkVendorId}
            disabled={!selectedProductIds.length || saving}
            onChange={(event) => setBulkVendorId(event.target.value)}
            aria-label="일괄 적용할 공급 구분"
          >
            <option value="__choose__">공급 구분 선택</option>
            <option value="__direct__">위즈업 직접 공급</option>
            <option value="">협력사 미연결</option>
            {vendorOptions.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.companyName}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={
              !selectedProductIds.length ||
              bulkVendorId === "__choose__" ||
              saving
            }
            onClick={() => void persistBulkProductVendor()}
          >
            {saving ? "저장 중…" : "선택 제품 일괄 적용"}
          </button>
          {selectedProductIds.length > 0 && (
            <button
              type="button"
              className="product-catalog-bulk-clear"
              disabled={saving}
              onClick={() => setSelectedProductIds([])}
            >
              선택 해제
            </button>
          )}
        </div>

        <div className="product-catalog-column-head-scroll" ref={stickyColumnHeaderRef} aria-hidden="true">
          <div className="product-catalog-column-head">
            <span>선택 · 품명</span>
            <span>규격</span>
            <span>단가</span>
            <span>비고</span>
            <span>수수료율 / 마진율</span>
            <span>공급 구분</span>
            <span>참고사항</span>
            <span>관리</span>
          </div>
        </div>
        </div>

        <div
          className="product-catalog-table-wrap"
          onScroll={(event) => {
            if (stickyColumnHeaderRef.current) {
              stickyColumnHeaderRef.current.scrollLeft = event.currentTarget.scrollLeft;
            }
          }}
        >
          <table className="product-catalog-table" aria-label="제품 기준정보 목록">
            <tbody>
              {productPageItems.map((product) => (
                <tr
                  key={product.id}
                  className={`${product.needsReview ? "needs-review" : ""} ${favoriteProductIdSet.has(product.id) ? "favorite" : ""} ${draggedProductId === product.id ? "dragging" : ""}`.trim()}
                  onDragOver={(event) => {
                    if (
                      canReorder &&
                      catalogView === "all" &&
                      !normalizedSearch &&
                      !saving &&
                      draggedProductId &&
                      favoriteProductIdSet.has(draggedProductId) ===
                        favoriteProductIdSet.has(product.id)
                    ) {
                      event.preventDefault();
                    }
                  }}
                  onDrop={() => dropProduct(product.id)}
                >
                  <td data-label="품명" className="product-name-cell">
                    <div className="product-order-cell">
                      <input
                        type="checkbox"
                        className="product-catalog-row-select"
                        checked={selectedProductIdSet.has(product.id)}
                        disabled={saving}
                        onChange={(event) =>
                          setSelectedProductIds((current) =>
                            event.target.checked
                              ? [...new Set([...current, product.id])]
                              : current.filter((id) => id !== product.id),
                          )
                        }
                        aria-label={`${product.name} 선택`}
                      />
                      <button
                        type="button"
                        className={`product-favorite-button ${favoriteProductIdSet.has(product.id) ? "active" : ""}`.trim()}
                        onClick={() => void toggleFavoriteProduct(product.id)}
                        disabled={saving}
                        aria-pressed={favoriteProductIdSet.has(product.id)}
                        aria-label={`${product.name} ${favoriteProductIdSet.has(product.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}`}
                        title={favoriteProductIdSet.has(product.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                      >
                        {favoriteProductIdSet.has(product.id) ? "★" : "☆"}
                      </button>
                      <span
                        className="product-drag-handle"
                        draggable={canReorder && catalogView === "all" && !normalizedSearch && !saving}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", product.id);
                          setDraggedProductId(product.id);
                        }}
                        onDragEnd={() => setDraggedProductId(null)}
                        aria-hidden="true"
                      >
                        ⋮⋮
                      </span>
                      <div className="product-order-buttons">
                        <button
                          type="button"
                          onClick={() => moveProduct(product.id, -1)}
                          disabled={!canReorder || Boolean(normalizedSearch) || catalogView !== "all" || saving || isProductGroupEdge(product.id, -1)}
                          aria-label={`${product.name} 위로 이동`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveProduct(product.id, 1)}
                          disabled={!canReorder || Boolean(normalizedSearch) || catalogView !== "all" || saving || isProductGroupEdge(product.id, 1)}
                          aria-label={`${product.name} 아래로 이동`}
                        >
                          ↓
                        </button>
                      </div>
                      <strong>{product.name}</strong>
                    </div>
                  </td>
                  <td data-label="규격" className="product-specification-cell">
                    {product.specification || "—"}
                  </td>
                  <td data-label="단가" className="numeric product-price-cell">
                    {formatPrice(product.unitPrice)}
                  </td>
                  <td data-label="비고" className="product-note-cell">
                    {product.note || "—"}
                  </td>
                  <td
                    data-label="수수료율 / 마진율"
                    className="numeric product-commission-cell"
                  >
                    {product.supplyType === "direct" ? "마진 " : "수수료 "}
                    {formatRate(
                      product.supplyType === "direct"
                        ? product.marginRate
                        : product.commissionRate,
                    )}
                  </td>
                  <td data-label="공급 구분" className="product-vendor-cell">
                    {product.supplyType === "direct"
                      ? "위즈업 직접 공급"
                      : product.supplierVendorName || "협력사 미연결"}
                  </td>
                  <td data-label="참고사항" className="product-reference-cell">
                    {product.reference || "—"}
                  </td>
                  <td data-label="관리" className="product-action-cell">
                    <div className="product-management-actions">
                      <button
                        type="button"
                        className="product-comparison-button"
                        onClick={() => void openProductComparison(product)}
                      >
                        비교표
                      </button>
                      <button
                        type="button"
                        className="product-edit-button"
                        onClick={() => openEditor(product)}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="product-delete-button"
                        onClick={() => handleDeleteProduct(product)}
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleProducts.length && !loading && (
            <div className="empty-state product-catalog-empty">
              검색 조건에 맞는 제품이 없습니다.
            </div>
          )}
        </div>
        {visibleProducts.length > 0 && (
          <nav className="award-list-pagination data-list-pagination" aria-label="제품 목록 페이지">
            <button
              type="button"
              disabled={productPage === 1}
              onClick={() => setProductPage((current) => Math.max(1, current - 1))}
            >
              이전
            </button>
            <span>
              {productPage.toLocaleString()} / {productPageCount.toLocaleString()} 페이지
              <small>총 {visibleProducts.length.toLocaleString()}개 · 페이지당 {PRODUCT_PAGE_SIZE}개</small>
            </span>
            <button
              type="button"
              disabled={productPage === productPageCount}
              onClick={() =>
                setProductPage((current) => Math.min(productPageCount, current + 1))
              }
            >
              다음
            </button>
          </nav>
        )}
      </section>}

      {workspaceTab === "vendors" && <AwardVendorPage onCountChange={setVendorCount} />}

      {(editing || creating) && form && (
        <div
          className="product-catalog-modal-shell"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !saving) {
              closeEditor();
            }
          }}
        >
          <form
            className="product-catalog-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-editor-title"
            onSubmit={handleSaveProduct}
          >
            <div className="product-catalog-dialog-header">
              <div>
                <span className="section-kicker">
                  {creating ? "PRODUCT ADD" : "PRODUCT EDIT"}
                </span>
                <h3 id="product-editor-title">
                  {creating ? "제품 추가" : "제품 정보 수정"}
                </h3>
              </div>
              <button
                type="button"
                aria-label="닫기"
                onClick={closeEditor}
                disabled={saving}
              >
                ×
              </button>
            </div>
            <div className="product-catalog-form-grid">
              <label>
                <span>품명</span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                <span>규격</span>
                <textarea
                  value={form.specification}
                  onChange={(event) =>
                    setForm({ ...form, specification: event.target.value })
                  }
                  rows={3}
                />
              </label>
              <label>
                <span>단가</span>
                <div className="product-field-with-unit">
                  <input
                    inputMode="numeric"
                    value={form.unitPrice}
                    onChange={(event) =>
                      setForm({ ...form, unitPrice: event.target.value })
                    }
                    placeholder="예: 27,000,000"
                  />
                  <span>원</span>
                </div>
              </label>
              <label>
                <span>비고</span>
                <textarea
                  value={form.note}
                  onChange={(event) =>
                    setForm({ ...form, note: event.target.value })
                  }
                  rows={3}
                  placeholder="업체명, 조달번호, 계약 방식"
                />
              </label>
              <label>
                <span>
                  {form.supplyType === "direct" ? "마진율" : "수수료율"}
                </span>
                <div className="product-field-with-unit">
                  <input
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.commissionRate}
                    onChange={(event) => {
                      const next = event.target.value.replace(",", ".");
                      if (!/^\d{0,3}(?:\.\d{0,2})?$/.test(next)) return;
                      setForm({
                        ...form,
                        commissionRate: next,
                        rateEdited: true,
                      });
                    }}
                    placeholder={
                      form.supplyType === "direct" ? "예: 55.45" : "예: 25"
                    }
                  />
                  <span>%</span>
                </div>
                {!form.rateEdited && editing && (
                  <small>
                    기존 정밀 비율은 값을 수정하지 않으면 그대로 보존됩니다.
                  </small>
                )}
              </label>
              <label>
                <span>공급 구분</span>
                <select
                  value={
                    form.supplyType === "direct"
                      ? "__direct__"
                      : form.supplierVendorId
                  }
                  onChange={(event) => {
                    const direct = event.target.value === "__direct__";
                    setForm({
                      ...form,
                      supplyType: direct ? "direct" : "partner",
                      supplierVendorId: direct ? "" : event.target.value,
                    });
                  }}
                >
                  <option value="__direct__">위즈업 직접 공급</option>
                  <option value="">협력사 미연결</option>
                  {vendorOptions.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.companyName}
                    </option>
                  ))}
                </select>
                <small>
                  기관 품목에 추가할 때 공급 구분과 수수료율 또는 마진율이
                  함께 저장됩니다.
                </small>
              </label>
              <label>
                <span>참고사항</span>
                <textarea
                  value={form.reference}
                  onChange={(event) =>
                    setForm({ ...form, reference: event.target.value })
                  }
                  rows={3}
                  placeholder="옵션, 예외, 영업보호, 내부 메모"
                />
              </label>
              <div className="product-procurement-toggle">
                <span>조달 제품</span>
                <label>
                  <input type="checkbox" checked={form.procurement} onChange={(event) => setForm({ ...form, procurement: event.target.checked })} />
                  <span>나라장터·학교장터 등 조달 제품으로 관리</span>
                </label>
              </div>
              {form.procurement && <>
                <label><span>조달 채널</span><select value={form.procurementChannel} onChange={(event) => setForm({ ...form, procurementChannel: event.target.value })}><option>G2B</option><option>S2B</option><option>디지털서비스몰</option><option>혁신장터</option><option>기타</option></select></label>
                <label><span>물품식별번호</span><input value={form.procurementNumber} onChange={(event) => setForm({ ...form, procurementNumber: event.target.value.replace(/[^0-9-]/g, "") })} placeholder="조달 식별번호" /></label>
                <label><span>조달 수수료율 (내부용)</span><div className="product-field-with-unit"><input inputMode="decimal" value={form.procurementFeeRate} onChange={(event) => setForm({ ...form, procurementFeeRate: event.target.value.replace(",", ".") })} /><span>%</span></div><small>고객용 견적서에는 비율은 숨기고 수수료 금액만 표시합니다.</small></label>
              </>}
            </div>
            <div className="product-catalog-dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={closeEditor}
                disabled={saving}
              >
                취소
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={saving}
              >
                {saving ? "저장 중…" : creating ? "제품 추가" : "저장"}
              </button>
            </div>
          </form>
        </div>
      )}

      {comparisonProduct && (
        <div
          className="product-catalog-modal-shell"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !comparisonBusy) setComparisonProduct(null);
          }}
        >
          <section className="product-catalog-dialog product-comparison-dialog" role="dialog" aria-modal="true" aria-labelledby="product-comparison-title">
            <div className="product-catalog-dialog-header">
              <div>
                <span className="section-kicker">PRODUCT COMPARISON</span>
                <h3 id="product-comparison-title">물품 비교표 관리</h3>
                <p><strong>{comparisonProduct.name}</strong>에 연결할 비교표를 등록하거나 교체합니다.</p>
              </div>
              <button type="button" aria-label="닫기" disabled={comparisonBusy} onClick={() => setComparisonProduct(null)}>×</button>
            </div>
            <form className="product-comparison-form" onSubmit={uploadProductComparison}>
              <div className="product-comparison-body">
                <div className="product-comparison-current">
                  {comparisonDocuments.map((document) => (
                    <article key={document.id}>
                      <div>
                        <strong>{document.original_name}</strong>
                        <small>{Math.max(1, Math.round(document.size_bytes / 1024)).toLocaleString("ko-KR")}KB · {document.created_at.slice(0, 10)}</small>
                      </div>
                      <div>
                        <button type="button" className="secondary-button" disabled={comparisonBusy} onClick={() => void openComparisonPreview(document)}>미리보기</button>
                        <a className="secondary-button" href={`/api/product-comparison-documents?id=${document.id}&download=1`}>다운로드</a>
                        <button type="button" className="product-delete-button" disabled={comparisonBusy} onClick={() => void deleteProductComparison(document.id)}>삭제</button>
                      </div>
                    </article>
                  ))}
                  {!comparisonBusy && comparisonDocuments.length === 0 && (
                    <div className="product-comparison-empty">
                      <strong>등록된 비교표가 없습니다.</strong>
                      <span>아래에서 파일을 선택하면 이 제품에 바로 연결됩니다.</span>
                    </div>
                  )}
                </div>
                <div className="product-comparison-upload">
                  <label><span>{comparisonDocuments.length ? "새 파일로 교체" : "비교표 파일 등록"}</span><input name="file" type="file" accept=".pdf,.xlsx,.hwp,.hwpx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required disabled={comparisonBusy} /></label>
                  <small>엑셀, PDF, 한글 등 비교표 원본 파일을 등록할 수 있습니다.</small>
                </div>
              </div>
              <div className="product-catalog-dialog-actions">
                <button type="button" className="secondary-button" disabled={comparisonBusy} onClick={() => setComparisonProduct(null)}>닫기</button>
                <button type="submit" className="primary-button" disabled={comparisonBusy}>{comparisonBusy ? "저장 중…" : comparisonDocuments.length ? "비교표 교체" : "비교표 등록"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {comparisonPreview && (
        <div className="comparison-preview-layer" role="dialog" aria-modal="true" aria-label={`${comparisonPreview.original_name} 미리보기`}>
          <button className="comparison-preview-backdrop" type="button" aria-label="미리보기 닫기" onClick={() => setComparisonPreview(null)} />
          <section className="comparison-preview-panel">
            <header>
              <div><span className="section-kicker">READ ONLY PREVIEW</span><h3>{comparisonPreview.original_name}</h3><p>원본 파일은 변경하지 않고 읽기 전용으로 표시합니다.</p></div>
              <div className="comparison-preview-actions">
                <button type="button" aria-label="축소" onClick={() => setComparisonPreviewZoom((value) => Math.max(50, value - 25))}>−</button>
                <b>{comparisonPreviewZoom}%</b>
                <button type="button" aria-label="확대" onClick={() => setComparisonPreviewZoom((value) => Math.min(200, value + 25))}>＋</button>
                <a href={`/api/product-comparison-documents?id=${comparisonPreview.id}&download=1`}>다운로드</a>
                <button type="button" aria-label="닫기" onClick={() => setComparisonPreview(null)}>×</button>
              </div>
            </header>
            <div className="comparison-preview-content">
              {comparisonPreviewBusy ? <div className="empty-state">미리보기를 준비하고 있습니다.</div> : null}
              {comparisonPreviewError ? <div className="comparison-preview-notice"><strong>미리보기 안내</strong><p>{comparisonPreviewError}</p><a href={`/api/product-comparison-documents?id=${comparisonPreview.id}&download=1`}>원본 다운로드</a></div> : null}
              {!comparisonPreviewBusy && !comparisonPreviewError && (comparisonPreview.original_name.toLocaleLowerCase().endsWith(".pdf") || comparisonPreview.mime_type === "application/pdf") ? (
                <iframe key={comparisonPreviewZoom} src={`/api/product-comparison-documents?id=${comparisonPreview.id}&preview=1#zoom=${comparisonPreviewZoom}`} title={`${comparisonPreview.original_name} PDF 페이지`} />
              ) : null}
              {!comparisonPreviewBusy && comparisonPreviewWorkbook ? (
                <div className="comparison-xlsx-preview" style={{ fontSize: `${comparisonPreviewZoom}%` }}>
                  {comparisonPreviewWorkbook.truncated ? <p className="comparison-preview-truncated">큰 파일은 화면 성능을 위해 일부 시트·행·열만 표시합니다. 전체 내용은 다운로드해서 확인해 주세요.</p> : null}
                  {comparisonPreviewWorkbook.sheets.map((sheet) => (
                    <section key={sheet.name}><h4>{sheet.name}</h4><div><table><tbody>{sheet.rows.map((row, rowIndex) => <tr key={`${sheet.name}-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div></section>
                  ))}
                  {comparisonPreviewWorkbook.images.length ? <section className="comparison-xlsx-images"><h4>포함된 이미지</h4><div>{comparisonPreviewWorkbook.images.map((image) => <figure key={image.name}><img src={image.url} alt={image.name} /><figcaption>{image.name}</figcaption></figure>)}</div></section> : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}

      {quotation && (
        <div
          className="product-catalog-modal-shell"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setQuotation(null);
          }}
        >
          <form
            className="product-catalog-dialog quotation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quotation-title"
            onSubmit={handleQuotationDownload}
          >
            <div className="product-catalog-dialog-header">
              <div>
                <span className="section-kicker">QUOTATION</span>
                <h3 id="quotation-title">견적서 만들기</h3>
                <p>제품을 선택하고 수량을 조정하면 고객용 엑셀로 내려받습니다.</p>
              </div>
              <button
                type="button"
                aria-label="닫기"
                onClick={() => setQuotation(null)}
              >
                ×
              </button>
            </div>

            <div className="quotation-meta-grid">
              <label>
                <span>기관명</span>
                <input
                  value={quotation.customerName}
                  onChange={(event) =>
                    setQuotation({
                      ...quotation,
                      customerName: event.target.value,
                    })
                  }
                  placeholder="예: 시흥 매화초등학교"
                  required
                />
              </label>
              <label>
                <span>견적일</span>
                <input
                  type="date"
                  value={quotation.quoteDate}
                  onChange={(event) =>
                    setQuotation({ ...quotation, quoteDate: event.target.value })
                  }
                  required
                />
              </label>
              <label className="quotation-project-field">
                <span>사업명</span>
                <input
                  value={quotation.projectTitle}
                  onChange={(event) =>
                    setQuotation({
                      ...quotation,
                      projectTitle: event.target.value,
                    })
                  }
                  placeholder="예: 스마트 체험교실 구축"
                />
              </label>
            </div>

            <section className="quotation-picker">
              <div className="quotation-section-title">
                <div>
                  <strong>제품 선택</strong>
                  <span>제품명이나 규격을 검색해 추가하세요.</span>
                </div>
                <input
                  value={quotation.search}
                  onChange={(event) =>
                    setQuotation({ ...quotation, search: event.target.value })
                  }
                  placeholder="제품명·규격 검색"
                />
              </div>
              <div className="quotation-product-results">
                {quotationProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addQuotationProduct(product)}
                  >
                    <span>
                      <strong>{product.name}</strong>
                      <small>{product.specification || "규격 미등록"}</small>
                    </span>
                    <b>{formatPrice(product.unitPrice)}</b>
                    <em>추가</em>
                  </button>
                ))}
                {!quotationProducts.length && (
                  <div className="quotation-no-result">검색 결과가 없습니다.</div>
                )}
                {quotationProductMatchCount > quotationProducts.length && (
                  <div className="quotation-no-result">
                    전체 {quotationProductMatchCount.toLocaleString()}개 중{" "}
                    {quotationProducts.length}개를 표시합니다. 제품명을 검색하면 더
                    빠르게 찾을 수 있습니다.
                  </div>
                )}
              </div>
            </section>

            <section className="quotation-lines-section">
              <div className="quotation-section-title">
                <div>
                  <strong>선택한 제품</strong>
                  <span>{quotation.lines.length}개 품목</span>
                </div>
                <b>합계 {priceFormatter.format(quotationTotal)}원</b>
              </div>
              {quotation.lines.length ? (
                <div className="quotation-lines">
                  {quotation.lines.map((line) => {
                    const quantity = Number(line.quantity.replace(/,/g, ""));
                    const unitPrice = Number(line.unitPrice.replace(/,/g, ""));
                    const amount =
                      (Number.isFinite(quantity) ? quantity : 0) *
                      (Number.isFinite(unitPrice) ? unitPrice : 0);
                    return (
                      <div className="quotation-line" key={line.id}>
                        <div className="quotation-line-product">
                          <strong>{line.name}</strong>
                          <small>{line.specification || "규격 미등록"}</small>
                        </div>
                        <label>
                          <span>수량</span>
                          <input
                            inputMode="decimal"
                            value={line.quantity}
                            onChange={(event) =>
                              updateQuotationLine(line.id, {
                                quantity: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>단위</span>
                          <input
                            value={line.unit}
                            onChange={(event) =>
                              updateQuotationLine(line.id, {
                                unit: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="quotation-price-input">
                          <span>단가</span>
                          <input
                            inputMode="numeric"
                            value={line.unitPrice}
                            onChange={(event) =>
                              updateQuotationLine(line.id, {
                                unitPrice: event.target.value,
                              })
                            }
                          />
                        </label>
                        <div className="quotation-line-amount">
                          <span>금액</span>
                          <strong>{priceFormatter.format(amount)}원</strong>
                        </div>
                        <label className="quotation-note-input">
                          <span>비고</span>
                          <input
                            value={line.note}
                            onChange={(event) =>
                              updateQuotationLine(line.id, {
                                note: event.target.value,
                              })
                            }
                            placeholder="선택 입력"
                          />
                        </label>
                        <button
                          type="button"
                          className="quotation-remove"
                          onClick={() => removeQuotationLine(line.id)}
                          aria-label={`${line.name} 삭제`}
                        >
                          삭제
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="quotation-empty">
                  위 검색 결과에서 견적할 제품을 선택해 주세요.
                </div>
              )}
            </section>

            <div className="quotation-notice">
              수수료율·마진율·내부 참고사항은 견적서에 포함되지 않으며, 표시 금액은
              부가세 포함 기준입니다.
            </div>
            <div className="product-catalog-dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setQuotation(null)}
              >
                취소
              </button>
              <button type="submit" className="primary-button">
                엑셀 견적서 내려받기
              </button>
            </div>
          </form>
        </div>
      )}

      {importPreview && (
        <div className="product-catalog-modal-shell" role="presentation">
          <section
            className="product-catalog-dialog product-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-import-title"
          >
            <div className="product-catalog-dialog-header">
              <div>
                <span className="section-kicker">EXCEL PREVIEW</span>
                <h3 id="product-import-title">엑셀 내용 검토</h3>
                <p>{importPreview.fileName}</p>
              </div>
              <button
                type="button"
                aria-label="닫기"
                onClick={() => setImportPreview(null)}
                disabled={saving}
              >
                ×
              </button>
            </div>
            <div className="product-import-summary">
              <span>
                신규 <strong>{importPreview.added}개</strong>
              </span>
              <span>
                수정 <strong>{importPreview.updated}개</strong>
              </span>
              <span>
                변경 없음 <strong>{importPreview.skipped}개</strong>
              </span>
              <span className={importPreview.errors ? "has-error" : ""}>
                오류 <strong>{importPreview.errors}개</strong>
              </span>
            </div>
            <p className="product-import-guide">
              빈 셀은 기존 정보를 지우지 않습니다. 오류가 있는 행은 제외하고
              적용됩니다.
            </p>
            {importPreview.errors > 0 && (
              <div className="product-import-errors">
                {importPreview.rows
                  .filter((row) => row.errors.length)
                  .slice(0, 8)
                  .map((row) => (
                    <p key={row.rowNumber}>
                      {row.rowNumber}행 · {row.errors.join(" ")}
                    </p>
                  ))}
              </div>
            )}
            <div className="product-catalog-dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setImportPreview(null)}
                disabled={saving}
              >
                취소
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={applyImport}
                disabled={
                  saving ||
                  (!importPreview.added && !importPreview.updated)
                }
              >
                {saving ? "적용 중…" : "검토 내용 적용"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
