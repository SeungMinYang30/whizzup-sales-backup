"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
const PDF_WORKER_URL = "/pdf.worker.min.mjs";
import {
  parseQuotationXlsx,
  type ParsedQuotationXlsx,
} from "./quotation-xlsx";
import {
  DEFAULT_PROCUREMENT_FEE_RATE,
  hasProcurementSignal,
  procurementNumbersFromText,
} from "../lib/procurement-product";

type QuotationDocument = {
  id: number;
  organization: string;
  businessRound: number;
  companyName: string;
  quoteAmount: string;
  quoteDate: string;
  originalName: string;
  originalSize: number;
  pageCount: number;
  totalSize: number;
  createdByName: string;
  createdAt: string;
  originalUrl: string;
  downloadUrl: string;
  pageUrls: string[];
};

type QuotationStorage = {
  provider?: "google-drive" | "site-storage";
  usedBytes: number;
  remainingBytes: number;
  limitBytes: number;
  usedPercent: number;
  remainingPercent: number;
  documentCount: number;
  pageCount: number;
};

type ProductCatalogChoice = {
  id: string;
  name: string;
  specification: string;
  unitPrice: number | null;
  commissionRate: number | null;
  marginRate?: number | null;
  supplyType?: "partner" | "direct";
  note: string;
  reference: string;
};

type EquipmentProjectChoice = {
  id: number;
  name: string;
  budgetType?: string;
  constructionAmount?: number | null;
  actualConstructionCost?: number | null;
};

type QuotationAnalysisItem = {
  id: string;
  selected: boolean;
  productName: string;
  specification: string;
  quantity: number;
  unit: string;
  unitPrice: string;
  procurementNumber: string;
  isProcurement: boolean;
  confidence: string;
  reviewNote: string;
  catalogItemId: string;
  catalogNote: string;
  supplyType: "" | "partner" | "direct";
  commissionRateInput: string;
  sourceRate: number | null;
  rateEdited: boolean;
};

type QuotationAnalysisDraft = {
  documentId: number;
  documentName: string;
  sourceType?: "pdf" | "xlsx";
  projectId: number | null;
  projects: EquipmentProjectChoice[];
  quoteAmount: number;
  constructionAmount: string;
  actualConstructionCost: string;
  items: QuotationAnalysisItem[];
};

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

function displayDate(value: string) {
  if (!value) return "날짜 미입력";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${year}.${month}.${day}` : value;
}

function formatQuoteAmountInput(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits ? Number(digits).toLocaleString("ko-KR") : "";
}

function formatSignedMoneyInput(value: string | number) {
  const source = String(value).trim();
  const negative = source.startsWith("-");
  const digits = source.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return negative ? "-" : "";
  return `${negative ? "-" : ""}${Number(digits).toLocaleString("ko-KR")}`;
}

function parseSignedMoneyInput(value: string) {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function normalizedProductName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function normalizedComparableProductName(value: string) {
  return normalizedProductName(value)
    .replaceAll("비디오프로젝터", "빔프로젝터")
    .replaceAll("프로젝션", "프로젝터");
}

function normalizedProcurementNumber(value: string) {
  return value.replace(/\D/g, "");
}

function catalogProcurementNumbers(product: ProductCatalogChoice) {
  return procurementNumbersFromText(
    product.name,
    product.specification,
    product.note,
    product.reference,
  );
}

function formatCommissionRateInput(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return String(Number((value * 100).toFixed(2)));
}

function sanitizePercentInput(value: string) {
  const normalized = value
    .replace(/[^0-9.]/g, "")
    .replace(/(\..*)\./g, "$1");
  const [integer = "", decimals] = normalized.split(".");
  return decimals === undefined
    ? integer
    : `${integer}.${decimals.slice(0, 2)}`;
}

function productSupplyType(product: ProductCatalogChoice | null | undefined) {
  return product?.supplyType === "direct" ? "direct" : "partner";
}

function productSettlementRate(product: ProductCatalogChoice | null | undefined) {
  if (!product) return null;
  return productSupplyType(product) === "direct"
    ? product.marginRate ?? product.commissionRate
    : product.commissionRate;
}

function settlementRateLabel(supplyType: QuotationAnalysisItem["supplyType"]) {
  return supplyType === "direct" ? "위즈업 마진율" : "위즈업 수수료율";
}

function matchingCatalogProduct(
  item: {
    productName: string;
    specification: string;
    procurementNumber?: string;
  },
  products: ProductCatalogChoice[],
) {
  const procurementNumbers = [
    normalizedProcurementNumber(item.procurementNumber ?? ""),
    ...procurementNumbersFromText(
      item.productName,
      item.specification,
      item.procurementNumber,
    ),
  ].filter((value) => value.length >= 6);
  for (const procurementNumber of new Set(procurementNumbers)) {
    const procurementMatch = products.find((product) =>
      catalogProcurementNumbers(product).includes(procurementNumber),
    );
    if (procurementMatch) return procurementMatch;
  }

  const itemName = normalizedComparableProductName(item.productName);
  if (!itemName) return null;
  const exact = products.find(
    (product) => normalizedComparableProductName(product.name) === itemName,
  );
  if (exact) return exact;
  const candidates = products.filter((product) => {
    const productName = normalizedComparableProductName(product.name);
    return (
      itemName.length >= 4 &&
      productName.length >= 4 &&
      (itemName.includes(productName) || productName.includes(itemName))
    );
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    const specification = normalizedProductName(item.specification);
    return (
      candidates.find((product) => {
        const productSpecification = normalizedProductName(
          product.specification,
        );
        return (
          specification.length >= 4 &&
          productSpecification.length >= 4 &&
          (specification.includes(productSpecification) ||
            productSpecification.includes(specification))
        );
      }) ?? null
    );
  }
  return null;
}

function tryCanvasBlob(
  canvas: HTMLCanvasElement,
  type: "image/webp" | "image/jpeg",
  quality: number,
) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      type,
      quality,
    );
  });
}

async function canvasBlob(canvas: HTMLCanvasElement) {
  const webp = await tryCanvasBlob(canvas, "image/webp", 0.82);
  if (webp) return webp;
  const jpeg = await tryCanvasBlob(canvas, "image/jpeg", 0.86);
  if (jpeg) return jpeg;
  throw new Error("페이지 이미지를 만들지 못했습니다.");
}

async function renderPdfPages(
  file: File,
  onProgress: (current: number, total: number) => void,
) {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  const source = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: source }).promise;
  if (pdf.numPages > 40) {
    await pdf.destroy();
    throw new Error("견적서는 40페이지 이하 PDF만 첨부할 수 있습니다.");
  }
  const images: File[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress(pageNumber, pdf.numPages);
      const page = await pdf.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(2.4, 1600 / Math.max(natural.width, natural.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("PDF 변환 화면을 준비하지 못했습니다.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await canvasBlob(canvas);
      images.push(
        new File([blob], `page-${String(pageNumber).padStart(3, "0")}.${blob.type === "image/jpeg" ? "jpg" : "webp"}`, {
          type: blob.type || "image/webp",
        }),
      );
      page.cleanup();
      canvas.width = 1;
      canvas.height = 1;
    }
  } finally {
    await pdf.destroy();
  }
  return images;
}

export default function QuotationDocuments({
  organization,
  businessRound = 1,
  onToast,
  onEquipmentImported,
}: {
  organization: string;
  businessRound?: number;
  onToast: (message: string) => void;
  onEquipmentImported?: () => void;
}) {
  const [documents, setDocuments] = useState<QuotationDocument[]>([]);
  const [storage, setStorage] = useState<QuotationStorage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [preview, setPreview] = useState<QuotationDocument | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);
  const [analysisDraft, setAnalysisDraft] =
    useState<QuotationAnalysisDraft | null>(null);
  const [analysisSaving, setAnalysisSaving] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/quotation-documents?organization=${encodeURIComponent(organization)}&businessRound=${businessRound}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        documents?: QuotationDocument[];
        storage?: QuotationStorage;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "견적서를 불러오지 못했습니다.");
      setDocuments(payload.documents ?? []);
      setStorage(payload.storage ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "견적서를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [businessRound, organization]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDocuments(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments]);

  function selectPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    const supported =
      !file ||
      file.name.toLocaleLowerCase().endsWith(".pdf") ||
      file.name.toLocaleLowerCase().endsWith(".xlsx");
    if (!supported) {
      setPdfFile(null);
      event.target.value = "";
      setError("견적서는 PDF 또는 .xlsx 파일만 첨부할 수 있습니다.");
      return;
    }
    if (file && file.size > 20 * 1024 * 1024) {
      setPdfFile(null);
      event.target.value = "";
      setError("견적서는 20MB 이하 파일만 첨부할 수 있습니다.");
      return;
    }
    setError("");
    setPdfFile(file);
  }

  async function uploadQuotation(event: FormEvent) {
    event.preventDefault();
    if (!pdfFile) {
      setError("견적서 PDF 또는 엑셀 파일을 선택해 주세요.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const isXlsx = pdfFile.name.toLocaleLowerCase().endsWith(".xlsx");
      let parsedXlsx: ParsedQuotationXlsx | null = null;
      let storedPdf = pdfFile;
      let pages: File[] = [];
      if (isXlsx) {
        setUploadProgress("엑셀 품목을 읽고 내부 정보를 제외하고 있습니다.");
        parsedXlsx = await parseQuotationXlsx(pdfFile, organization);
        storedPdf = parsedXlsx.pdf;
        pages = parsedXlsx.pages;
      } else {
        setUploadProgress("PDF를 분석하고 있습니다.");
        pages = await renderPdfPages(pdfFile, (current, total) =>
          setUploadProgress(`페이지 이미지 변환 중 · ${current}/${total}`),
        );
      }
      setUploadProgress(
        isXlsx
          ? "기관 공유용 견적서와 품목을 저장하고 있습니다."
          : "원본과 페이지 이미지를 저장하고 있습니다.",
      );
      const formData = new FormData();
      formData.set("organization", organization);
      formData.set("businessRound", String(businessRound));
      formData.set("pdf", storedPdf);
      if (parsedXlsx) {
        formData.set("sourceFile", pdfFile);
        formData.set("companyName", parsedXlsx.sourceName.replace(/\.xlsx$/i, ""));
        formData.set("quoteAmount", String(parsedXlsx.quoteAmount || ""));
        if (parsedXlsx.quoteDate) formData.set("quoteDate", parsedXlsx.quoteDate);
      }
      pages.forEach((page) => formData.append("pages", page));
      const response = await fetch("/api/quotation-documents", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        document?: QuotationDocument;
        storage?: QuotationStorage;
        error?: string;
      };
      if (!response.ok || !payload.document) {
        throw new Error(payload.error || "견적서를 저장하지 못했습니다.");
      }
      setDocuments((current) => [payload.document!, ...current]);
      setStorage(payload.storage ?? storage);
      setPdfFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadOpen(false);
      if (parsedXlsx) {
        await importParsedXlsx(payload.document, parsedXlsx);
      } else {
        onToast("견적서 PDF와 상세 이미지가 저장되었습니다.");
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "견적서를 저장하지 못했습니다.",
      );
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  }

  async function deleteQuotation(document: QuotationDocument) {
    if (!window.confirm(`${document.companyName} 견적서를 삭제하시겠습니까?\n관리자 휴지통에 30일 동안 보관됩니다.`)) {
      return;
    }
    setDeletingId(document.id);
    setError("");
    try {
      const response = await fetch("/api/quotation-documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: document.id }),
      });
      const payload = (await response.json()) as {
        storage?: QuotationStorage;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "견적서를 삭제하지 못했습니다.");
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setStorage(payload.storage ?? storage);
      if (preview?.id === document.id) setPreview(null);
      onToast("견적서를 휴지통으로 이동했습니다. 관리자가 30일 안에 복원할 수 있습니다.");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "견적서를 삭제하지 못했습니다.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function importParsedXlsx(
    document: QuotationDocument,
    parsed: ParsedQuotationXlsx,
  ) {
    setAnalysisError("");
    const [catalogResponse, equipmentResponse] = await Promise.all([
      fetch("/api/product-catalog", { cache: "no-store" }),
      fetch(
        `/api/equipment?organization=${encodeURIComponent(organization)}&businessRound=${businessRound}`,
        { cache: "no-store" },
      ),
    ]);
    const catalogPayload = (await catalogResponse.json()) as {
      products?: ProductCatalogChoice[];
      error?: string;
    };
    const equipmentPayload = (await equipmentResponse.json()) as {
      projects?: EquipmentProjectChoice[];
      error?: string;
    };
    if (!catalogResponse.ok) {
      throw new Error(
        catalogPayload.error || "제품 목록을 불러오지 못했습니다.",
      );
    }
    if (!equipmentResponse.ok) {
      throw new Error(
        equipmentPayload.error || "사업 정보를 불러오지 못했습니다.",
      );
    }
    const products = catalogPayload.products ?? [];
    const projects = equipmentPayload.projects ?? [];
    const items = parsed.items.map((item) => {
      const matched = matchingCatalogProduct(item, products);
      const supplyType = matched ? productSupplyType(matched) : "";
      const sourceRate = productSettlementRate(matched);
      const commissionRateInput = formatCommissionRateInput(
        sourceRate,
      );
      const reviewNotes = [
        item.reviewNote,
        !matched ? "제품 목록에서 일치 품목을 찾지 못했습니다." : "",
        matched && !commissionRateInput
          ? `제품 목록에 ${settlementRateLabel(supplyType)}이 등록되지 않았습니다.`
          : "",
      ].filter(Boolean);
      return {
        id: item.id,
        selected: true,
        productName: item.productName,
        specification: item.specification || matched?.specification || "",
        quantity: Math.max(1, Math.round(item.quantity || 1)),
        unit: item.unit || "개",
        unitPrice: formatSignedMoneyInput(
          item.unitPrice || matched?.unitPrice || 0,
        ),
        procurementNumber: item.procurementNumber,
        isProcurement:
          Boolean(item.isProcurement) ||
          hasProcurementSignal(
            item.productName,
            item.specification,
            item.procurementNumber,
            matched?.name,
            matched?.specification,
            matched?.note,
            matched?.reference,
          ),
        confidence:
          matched && commissionRateInput && !reviewNotes.length
            ? "높음"
            : "검토 필요",
        reviewNote: reviewNotes.join(" · "),
        catalogItemId: matched?.id || "",
        catalogNote: [
          matched?.note,
          matched?.reference,
          item.procurementNumber
            ? `견적서 조달번호 ${item.procurementNumber}`
            : "",
          `엑셀 견적 자동입력 · ${parsed.sourceName}`,
        ]
          .filter(Boolean)
          .join(" · "),
        supplyType,
        commissionRateInput,
        sourceRate,
        rateEdited: false,
      } satisfies QuotationAnalysisItem;
    });
    const draft: QuotationAnalysisDraft = {
      documentId: document.id,
      documentName: parsed.sourceName,
      sourceType: "xlsx",
      projectId: projects[0]?.id ?? null,
      projects,
      quoteAmount: parsed.quoteAmount,
      constructionAmount: "",
      actualConstructionCost: "",
      items,
    };
    const automaticReady =
      Boolean(draft.projectId) &&
      items.length > 0 &&
      items.every(
        (item) =>
          item.catalogItemId &&
          item.supplyType &&
          item.commissionRateInput.trim() &&
          item.confidence === "높음",
      );
    setAnalysisDraft(draft);
    if (automaticReady) {
      setUploadProgress("제품 목록과 수수료율·마진율을 연결하고 있습니다.");
      await saveAnalysisDraft(draft, true);
      return;
    }
    const reviewCount = items.filter(
      (item) => item.confidence !== "높음",
    ).length;
    onToast(
      !draft.projectId
        ? "기관용 PDF를 저장했습니다. 연결할 사업을 선택해 주세요."
        : `기관용 PDF를 저장했습니다. 확인이 필요한 ${reviewCount}개 품목만 검토해 주세요.`,
    );
  }

  async function analyzeQuotation(document: QuotationDocument) {
    if (analyzingId !== null) return;
    setAnalyzingId(document.id);
    setAnalysisError("");
    setError("");
    try {
      const [analysisResponse, catalogResponse, equipmentResponse] =
        await Promise.all([
          fetch("/api/quotation-documents/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: document.id }),
          }),
          fetch("/api/product-catalog", { cache: "no-store" }),
          fetch(
            `/api/equipment?organization=${encodeURIComponent(organization)}&businessRound=${businessRound}`,
            { cache: "no-store" },
          ),
        ]);
      const analysisPayload = (await analysisResponse.json()) as {
        analysis?: {
          documentId: number;
          documentName: string;
          quoteAmount: number;
          constructionAmount: number;
          actualConstructionCost: number;
          items: Array<{
            id: string;
            productName: string;
            specification: string;
            quantity: number;
            unit: string;
            unitPrice: number;
            amount: number;
            procurementNumber: string;
            isProcurement: boolean;
            confidence: string;
            reviewNote: string;
          }>;
        };
        error?: string;
      };
      const catalogPayload = (await catalogResponse.json()) as {
        products?: ProductCatalogChoice[];
        error?: string;
      };
      const equipmentPayload = (await equipmentResponse.json()) as {
        projects?: EquipmentProjectChoice[];
        error?: string;
      };
      if (!analysisResponse.ok || !analysisPayload.analysis) {
        throw new Error(
          analysisPayload.error || "견적서 품목을 분석하지 못했습니다.",
        );
      }
      if (!catalogResponse.ok) {
        throw new Error(
          catalogPayload.error || "제품 목록을 불러오지 못했습니다.",
        );
      }
      if (!equipmentResponse.ok) {
        throw new Error(
          equipmentPayload.error || "사업 정보를 불러오지 못했습니다.",
        );
      }

      const products = catalogPayload.products ?? [];
      const projects = equipmentPayload.projects ?? [];
      const analysis = analysisPayload.analysis;
      const items = analysis.items.map((item) => {
        const matched = matchingCatalogProduct(item, products);
        const supplyType = matched ? productSupplyType(matched) : "";
        const sourceRate = productSettlementRate(matched);
        const quantity = Math.max(1, Math.round(Number(item.quantity) || 1));
        const extractedUnitPrice = Number(item.unitPrice) ||
          (Number(item.amount) ? Math.round(Number(item.amount) / quantity) : 0);
        const unitPrice = extractedUnitPrice || matched?.unitPrice || 0;
        return {
          id: item.id,
          selected: true,
          productName: item.productName,
          specification: item.specification || matched?.specification || "",
          quantity,
          unit: item.unit || "개",
          unitPrice: formatSignedMoneyInput(unitPrice),
          procurementNumber: item.procurementNumber,
          isProcurement:
            Boolean(item.isProcurement) ||
            hasProcurementSignal(
              item.productName,
              item.specification,
              item.procurementNumber,
              matched?.name,
              matched?.specification,
              matched?.note,
              matched?.reference,
            ),
          confidence: item.confidence,
          reviewNote: item.reviewNote,
          catalogItemId: matched?.id || "",
          catalogNote: [
            matched?.note,
            matched?.reference,
            item.procurementNumber
              ? `견적서 조달번호 ${item.procurementNumber}`
              : "",
            `견적서 자동입력 · ${document.originalName}`,
          ]
            .filter(Boolean)
            .join(" · "),
          supplyType,
          commissionRateInput: formatCommissionRateInput(
            sourceRate,
          ),
          sourceRate,
          rateEdited: false,
        } satisfies QuotationAnalysisItem;
      });
      setAnalysisDraft({
        documentId: analysis.documentId,
        documentName: analysis.documentName,
        sourceType: "pdf",
        projectId: projects[0]?.id ?? null,
        projects,
        quoteAmount: analysis.quoteAmount,
        constructionAmount: analysis.constructionAmount
          ? formatSignedMoneyInput(analysis.constructionAmount)
          : "",
        actualConstructionCost: analysis.actualConstructionCost
          ? formatSignedMoneyInput(analysis.actualConstructionCost)
          : "",
        items,
      });
      onToast(
        `${items.length}개 품목을 찾았습니다. 저장 전에 내용을 확인해 주세요.`,
      );
    } catch (analysisFailure) {
      setError(
        analysisFailure instanceof Error
          ? analysisFailure.message
          : "견적서 품목을 분석하지 못했습니다.",
      );
    } finally {
      setAnalyzingId(null);
    }
  }

  function updateAnalysisItem(
    id: string,
    patch: Partial<QuotationAnalysisItem>,
  ) {
    setAnalysisDraft((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === id ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  }

  async function saveAnalysisDraft(
    draft: QuotationAnalysisDraft,
    automatic = false,
  ) {
    if (analysisSaving) return;
    const selectedItems = draft.items.filter(
      (item) => item.selected && item.productName.trim(),
    );
    const hasConstruction = Boolean(
      draft.constructionAmount.trim() ||
        draft.actualConstructionCost.trim(),
    );
    if (!draft.projectId) {
      setAnalysisError(
        "품목을 등록할 공간을 준비하지 못했습니다. 기관 상세를 새로고침한 뒤 다시 시도해 주세요.",
      );
      return;
    }
    if (!selectedItems.length && !hasConstruction) {
      setAnalysisError("추가할 품목이나 공사비를 하나 이상 선택해 주세요.");
      return;
    }
    const itemWithoutSupplyType = selectedItems.find(
      (item) => !item.supplyType,
    );
    if (itemWithoutSupplyType) {
      setAnalysisError(
        `${itemWithoutSupplyType.productName} 품목의 공급 구분을 선택해 주세요.`,
      );
      return;
    }
    const itemWithInvalidCommission = selectedItems.find((item) => {
      const requested = item.commissionRateInput.trim();
      if (!requested) return true;
      const value = Number(requested);
      return !Number.isFinite(value) || value < 0 || value > 100;
    });
    if (itemWithInvalidCommission) {
      setAnalysisError(
        `${itemWithInvalidCommission.productName} 품목의 ${settlementRateLabel(itemWithInvalidCommission.supplyType)}을 0~100% 사이로 입력해 주세요.`,
      );
      return;
    }
    setAnalysisSaving(true);
    setAnalysisError("");
    try {
      let added = 0;
      let skipped = 0;
      if (selectedItems.length) {
        const response = await fetch("/api/equipment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "catalog-items",
            projectId: draft.projectId,
            items: selectedItems.map((item) => {
              const displayedRate =
                Number(item.commissionRateInput.trim()) / 100;
              const settlementRate =
                !item.rateEdited &&
                item.sourceRate !== null &&
                Number.isFinite(item.sourceRate)
                  ? item.sourceRate
                  : displayedRate;
              return {
                catalogItemId: item.catalogItemId,
                productName: item.productName.trim(),
                specification: item.specification.trim(),
                proposedQty: Math.max(1, Math.round(item.quantity || 1)),
                unit: item.unit.trim() || "개",
                status: "견적",
                catalogUnitPrice: item.unitPrice.trim()
                  ? parseSignedMoneyInput(item.unitPrice)
                  : null,
                catalogNote: item.catalogNote,
                supplyType: item.supplyType,
                executionType: "직영",
                commissionInputType: "rate",
                commissionRate:
                  item.supplyType === "partner" ? settlementRate : null,
                marginRate:
                  item.supplyType === "direct" ? settlementRate : null,
                procurementFeeRate: item.isProcurement
                  ? DEFAULT_PROCUREMENT_FEE_RATE
                  : null,
                consortiumCommissionRate: null,
                consortiumPaymentAmount: null,
              };
            }),
          }),
        });
        const payload = (await response.json()) as {
          added?: number;
          skipped?: number;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "품목을 추가하지 못했습니다.");
        }
        added = Number(payload.added ?? 0);
        skipped = Number(payload.skipped ?? 0);
      }
      if (hasConstruction) {
        const response = await fetch("/api/equipment", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "project-costs",
            id: draft.projectId,
            constructionAmount: draft.constructionAmount.trim()
              ? parseSignedMoneyInput(draft.constructionAmount)
              : null,
            actualConstructionCost:
              draft.actualConstructionCost.trim()
                ? parseSignedMoneyInput(
                    draft.actualConstructionCost,
                  )
                : null,
          }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "공사비를 저장하지 못했습니다.");
        }
      }
      setAnalysisDraft(null);
      onEquipmentImported?.();
      onToast(
        automatic
          ? skipped
            ? `엑셀 견적에서 ${added}개 품목을 자동 등록했고 기존 ${skipped}개는 제외했습니다.`
            : `엑셀 견적에서 ${added}개 품목을 자동 등록했습니다.`
          : skipped
          ? `${added}개 품목을 추가했고, 기존 ${skipped}개는 제외했습니다.`
          : `${added}개 품목${hasConstruction ? "과 공사비" : ""}를 추가했습니다.`,
      );
    } catch (saveFailure) {
      setAnalysisError(
        saveFailure instanceof Error
          ? saveFailure.message
          : "분석한 품목을 저장하지 못했습니다.",
      );
    } finally {
      setAnalysisSaving(false);
    }
  }

  async function saveAnalyzedItems() {
    if (!analysisDraft) return;
    await saveAnalysisDraft(analysisDraft);
  }

  const remainingPercent = Math.max(0, Math.min(100, storage?.remainingPercent ?? 100));
  const storageTone = remainingPercent <= 10 ? "danger" : remainingPercent <= 20 ? "warning" : "safe";

  return (
    <section className="quotation-documents">
      <div className="history-section-heading quotation-documents-heading">
        <div>
          <span className="section-kicker">QUOTATION FILES</span>
          <h3>견적서</h3>
        </div>
        <button type="button" onClick={() => setUploadOpen((current) => !current)}>
          {uploadOpen ? "첨부 닫기" : "+ PDF·엑셀 첨부"}
        </button>
      </div>

      {storage?.provider === "google-drive" ? (
        <div className="quotation-storage safe">
          <div>
            <strong>원본 파일 Google Drive 보관</strong>
            <span>견적서 {storage.documentCount}건 · {storage.pageCount}페이지</span>
          </div>
          <small>페이지 미리보기만 사이트 임시 저장공간을 사용합니다.</small>
        </div>
      ) : storage ? (
        <div className={`quotation-storage ${storageTone}`}>
          <div>
            <strong>저장공간 {formatBytes(storage.usedBytes)} / {formatBytes(storage.limitBytes)}</strong>
            <span>남은 용량 {formatBytes(storage.remainingBytes)} · {remainingPercent.toFixed(1)}%</span>
          </div>
          <div className="quotation-storage-track" aria-label={`저장공간 ${remainingPercent.toFixed(1)}% 남음`}>
            <span style={{ width: `${storage.usedPercent}%` }} />
          </div>
          <small>관리 기준 10GB · 견적서 {storage.documentCount}건 · {storage.pageCount}페이지</small>
        </div>
      ) : null}

      {uploadOpen && (
        <form className="quotation-upload-form" onSubmit={uploadQuotation}>
          <div className="quotation-upload-grid">
            <label className="quotation-file-field">
              <span>견적서 PDF 또는 엑셀</span>
              <input
                ref={fileInputRef}
                required
                type="file"
                accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx"
                onChange={selectPdf}
              />
              <small>
                {pdfFile
                  ? `${pdfFile.name} · ${formatBytes(pdfFile.size)}`
                  : "PDF 또는 위즈업 .xlsx · 20MB 이하"}
              </small>
              <small>
                엑셀은 내부 마진·수수료 메모를 제외한 기관 공유용 PDF로
                보관하고, 제품 목록의 수수료율·마진율만 적용합니다.
              </small>
            </label>
          </div>
          <div className="quotation-upload-actions">
            {uploadProgress && <span>{uploadProgress}</span>}
            <button type="submit" disabled={uploading}>
              {uploading ? "처리 중…" : "견적서 저장"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="quotation-error" role="alert">
          <span>{error}</span>
          {!loading && <button type="button" onClick={() => void loadDocuments()}>다시 불러오기</button>}
        </div>
      )}

      <div className="quotation-document-list">
        {loading ? (
          <p className="quotation-empty">견적서를 불러오고 있습니다.</p>
        ) : documents.length === 0 ? (
          <p className="quotation-empty">
            등록된 견적서가 없습니다. 업체 견적서 PDF 또는 위즈업 엑셀을
            첨부해 주세요.
          </p>
        ) : (
          documents.map((document) => (
            <article className="quotation-document-card" key={document.id}>
              <button
                type="button"
                className="quotation-thumbnail"
                onClick={() => setPreview(document)}
                aria-label={`${document.companyName} 견적서 이미지로 보기`}
              >
                <img src={document.pageUrls[0]} alt={`${document.companyName} 견적서 첫 페이지`} loading="lazy" />
                <span>{document.pageCount}페이지 · 확대 보기</span>
              </button>
              <div className="quotation-document-meta">
                <div>
                  <span>{displayDate(document.quoteDate)}</span>
                  <strong>{document.companyName}</strong>
                </div>
                <small>{document.originalName} · {formatBytes(document.totalSize)} · {document.createdByName}</small>
                <div className="quotation-document-actions">
                  <button type="button" onClick={() => setPreview(document)}>이미지 보기</button>
                  <button
                    type="button"
                    className="analyze"
                    disabled={analyzingId !== null}
                    onClick={() => void analyzeQuotation(document)}
                  >
                    {analyzingId === document.id ? "AI 분석 중…" : "AI 품목 추출"}
                  </button>
                  <a href={document.originalUrl} target="_blank" rel="noreferrer">원본 PDF</a>
                  <a href={document.downloadUrl}>다운로드</a>
                  <button
                    type="button"
                    className="delete"
                    disabled={deletingId === document.id}
                    onClick={() => void deleteQuotation(document)}
                  >
                    {deletingId === document.id ? "삭제 중…" : "삭제"}
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {analysisDraft && (
        <div
          className="quotation-analysis-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quotation-analysis-title"
        >
          <button
            type="button"
            className="quotation-preview-backdrop"
            aria-label="품목 자동입력 검토 닫기"
            onClick={() => !analysisSaving && setAnalysisDraft(null)}
          />
          <section className="quotation-analysis-panel">
            <header>
              <div>
                <span className="section-kicker">AI QUOTATION REVIEW</span>
                <h3 id="quotation-analysis-title">견적 품목 자동입력 검토</h3>
                <p>{analysisDraft.documentName}</p>
              </div>
              <button
                type="button"
                aria-label="닫기"
                disabled={analysisSaving}
                onClick={() => setAnalysisDraft(null)}
              >
                ×
              </button>
            </header>

            <div className="quotation-analysis-body">
              <div className="quotation-analysis-guide">
                <strong>
                  {analysisDraft.sourceType === "xlsx"
                    ? "자동 연결되지 않은 품목만 확인해 주세요."
                    : "저장 전에 품목명·수량·단가를 확인해 주세요."}
                </strong>
                <span>
                  제품 목록과 일치한 품목은 등록된 수수료율·마진율까지
                  연결되며, 엑셀 내부 수수료율은 사용하지 않습니다.
                </span>
              </div>

              <div className="quotation-analysis-project">
                <label>
                  <span>추가할 사업</span>
                  <select
                    value={analysisDraft.projectId ?? ""}
                    onChange={(event) =>
                      setAnalysisDraft({
                        ...analysisDraft,
                        projectId: Number(event.target.value) || null,
                      })
                    }
                  >
                    {!analysisDraft.projects.length && (
                      <option value="">연결된 사업 없음</option>
                    )}
                    {analysisDraft.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.budgetType || project.name || `사업 ${project.id}`}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <span>견적 최종금액</span>
                  <strong>
                    {analysisDraft.quoteAmount
                      ? `${analysisDraft.quoteAmount.toLocaleString("ko-KR")}원`
                      : "미확인"}
                  </strong>
                </div>
                <div>
                  <span>선택 품목</span>
                  <strong>
                    {analysisDraft.items.filter((item) => item.selected).length}개
                  </strong>
                </div>
              </div>

              <section className="quotation-analysis-costs">
                <div>
                  <strong>공사비 후보</strong>
                  <span>견적서에서 확인된 경우에만 입력됩니다.</span>
                </div>
                <label>
                  <span>견적 공사비</span>
                  <div className="quotation-money-input">
                    <input
                      inputMode="text"
                      value={analysisDraft.constructionAmount}
                      onChange={(event) =>
                        setAnalysisDraft({
                          ...analysisDraft,
                          constructionAmount: formatSignedMoneyInput(
                            event.target.value,
                          ),
                        })
                      }
                      placeholder="견적서에 없으면 비워두기"
                      aria-label="견적 공사비"
                    />
                    <span>원</span>
                  </div>
                </label>
                <label>
                  <span>실공사비</span>
                  <div className="quotation-money-input">
                    <input
                      inputMode="text"
                      value={analysisDraft.actualConstructionCost}
                      onChange={(event) =>
                        setAnalysisDraft({
                          ...analysisDraft,
                          actualConstructionCost: formatSignedMoneyInput(
                            event.target.value,
                          ),
                        })
                      }
                      placeholder="직접 확인 후 입력"
                    />
                    <span>원</span>
                  </div>
                </label>
              </section>

              <div className="quotation-analysis-list-heading">
                <label>
                  <input
                    type="checkbox"
                    checked={
                      analysisDraft.items.length > 0 &&
                      analysisDraft.items.every((item) => item.selected)
                    }
                    onChange={(event) =>
                      setAnalysisDraft({
                        ...analysisDraft,
                        items: analysisDraft.items.map((item) => ({
                          ...item,
                          selected: event.target.checked,
                        })),
                      })
                    }
                  />
                  <span>전체 선택</span>
                </label>
                <span>{analysisDraft.items.length}개 추출</span>
              </div>

              <div className="quotation-analysis-list">
                {analysisDraft.items.map((item, index) => (
                  <article
                    className={`quotation-analysis-item ${
                      item.selected ? "selected" : ""
                    }`}
                    key={item.id}
                  >
                    <label className="quotation-analysis-check">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={(event) =>
                          updateAnalysisItem(item.id, {
                            selected: event.target.checked,
                          })
                        }
                        aria-label={`${item.productName} 추가 선택`}
                      />
                      <b>{index + 1}</b>
                    </label>
                    <label className="quotation-analysis-name">
                      <span>품목명</span>
                      <input
                        value={item.productName}
                        onChange={(event) =>
                          updateAnalysisItem(item.id, {
                            productName: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="quotation-analysis-spec">
                      <span>규격·모델</span>
                      <input
                        value={item.specification}
                        onChange={(event) =>
                          updateAnalysisItem(item.id, {
                            specification: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="quotation-analysis-qty">
                      <span>수량</span>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(event) =>
                          updateAnalysisItem(item.id, {
                            quantity: Math.max(
                              1,
                              Math.round(Number(event.target.value) || 1),
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="quotation-analysis-unit">
                      <span>단위</span>
                      <input
                        value={item.unit}
                        onChange={(event) =>
                          updateAnalysisItem(item.id, {
                            unit: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="quotation-analysis-price">
                      <span>단가</span>
                      <div className="quotation-money-input">
                        <input
                          inputMode="text"
                          value={item.unitPrice}
                          onChange={(event) =>
                            updateAnalysisItem(item.id, {
                              unitPrice: formatSignedMoneyInput(
                                event.target.value,
                              ),
                            })
                          }
                        />
                        <span>원</span>
                      </div>
                    </label>
                    <label className="quotation-analysis-supply">
                      <span>공급 구분</span>
                      <select
                        value={item.supplyType}
                        onChange={(event) =>
                          updateAnalysisItem(item.id, {
                            supplyType: event.target.value as
                              | ""
                              | "partner"
                              | "direct",
                            sourceRate: null,
                            rateEdited: true,
                          })
                        }
                        aria-label={`${item.productName} 공급 구분`}
                      >
                        <option value="">공급 구분 선택</option>
                        <option value="partner">협력사 공급</option>
                        <option value="direct">위즈업 직접 공급</option>
                      </select>
                    </label>
                    <label className="quotation-analysis-commission">
                      <span>{settlementRateLabel(item.supplyType)}</span>
                      <div className="quotation-percent-input">
                        <input
                          inputMode="decimal"
                          value={item.commissionRateInput}
                          onChange={(event) =>
                            updateAnalysisItem(item.id, {
                              commissionRateInput: sanitizePercentInput(
                                event.target.value,
                              ),
                              rateEdited: true,
                            })
                          }
                          placeholder="필수"
                          aria-label={`${item.productName} ${settlementRateLabel(item.supplyType)}`}
                        />
                        <span>%</span>
                      </div>
                    </label>
                    <div className="quotation-analysis-status">
                      <span className={item.catalogItemId ? "matched" : "manual"}>
                        {item.catalogItemId ? "제품 목록 연결" : "직접 품목"}
                      </span>
                      {item.isProcurement && <span className="procurement">조달</span>}
                      {!item.supplyType && (
                        <span className="commission-missing">공급 구분 확인 필요</span>
                      )}
                      {!item.commissionRateInput.trim() && (
                        <span className="commission-missing">
                          {item.supplyType === "direct"
                            ? "마진율 입력 필요"
                            : "수수료율 입력 필요"}
                        </span>
                      )}
                      <span className={`confidence confidence-${item.confidence.replaceAll(" ", "-")}`}>
                        {item.confidence}
                      </span>
                      {(item.reviewNote || item.procurementNumber) && (
                        <small>
                          {[item.reviewNote, item.procurementNumber && `조달번호 ${item.procurementNumber}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      )}
                    </div>
                  </article>
                ))}
                {!analysisDraft.items.length && (
                  <p className="quotation-analysis-empty">
                    견적서에서 품목 행을 찾지 못했습니다. 공사비만
                    확인하거나 다시 분석해 주세요.
                  </p>
                )}
              </div>

              {analysisError && (
                <div className="quotation-analysis-error" role="alert">
                  {analysisError}
                </div>
              )}
            </div>

            <footer>
              <button
                type="button"
                disabled={analysisSaving}
                onClick={() => setAnalysisDraft(null)}
              >
                취소
              </button>
              <button
                type="button"
                className="primary"
                disabled={analysisSaving}
                onClick={() => void saveAnalyzedItems()}
              >
                {analysisSaving ? "추가 중…" : "확인한 품목·공사비 추가"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {preview && (
        <div className="quotation-preview-layer" role="dialog" aria-modal="true" aria-label={`${preview.companyName} 견적서 미리보기`}>
          <button className="quotation-preview-backdrop" type="button" aria-label="견적서 미리보기 닫기" onClick={() => setPreview(null)} />
          <div className="quotation-preview-panel">
            <header>
              <div>
                <span>{displayDate(preview.quoteDate)} · {preview.pageCount}페이지</span>
                <strong>{preview.companyName}</strong>
              </div>
              <div>
                <a href={preview.originalUrl} target="_blank" rel="noreferrer">원본 PDF</a>
                <button type="button" onClick={() => setPreview(null)} aria-label="닫기">×</button>
              </div>
            </header>
            <div className="quotation-preview-pages">
              {preview.pageUrls.map((url, index) => (
                <figure key={url}>
                  <figcaption>{index + 1} / {preview.pageCount}</figcaption>
                  <img src={url} alt={`${preview.companyName} 견적서 ${index + 1}페이지`} />
                </figure>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
