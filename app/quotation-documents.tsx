"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
const pdfWorkerUrl = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type QuotationDocument = {
  id: number;
  organization: string;
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
  usedBytes: number;
  remainingBytes: number;
  limitBytes: number;
  usedPercent: number;
  remainingPercent: number;
  documentCount: number;
  pageCount: number;
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

function displayQuoteAmount(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "금액 미입력";
  if (!/^[\d,\s원]+$/.test(trimmed)) return trimmed;
  const formatted = formatQuoteAmountInput(trimmed);
  return formatted ? `${formatted}원` : trimmed;
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
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
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
  onToast,
}: {
  organization: string;
  onToast: (message: string) => void;
}) {
  const [documents, setDocuments] = useState<QuotationDocument[]>([]);
  const [storage, setStorage] = useState<QuotationStorage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [preview, setPreview] = useState<QuotationDocument | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/quotation-documents?organization=${encodeURIComponent(organization)}`,
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
  }, [organization]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDocuments(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments]);

  function selectPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (file && file.size > 20 * 1024 * 1024) {
      setPdfFile(null);
      event.target.value = "";
      setError("PDF는 20MB 이하 파일만 첨부할 수 있습니다.");
      return;
    }
    setError("");
    setPdfFile(file);
  }

  async function uploadQuotation(event: FormEvent) {
    event.preventDefault();
    if (!companyName.trim() || !pdfFile) {
      setError("견적 업체명과 PDF 파일을 입력해 주세요.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      setUploadProgress("PDF를 분석하고 있습니다.");
      const pages = await renderPdfPages(pdfFile, (current, total) =>
        setUploadProgress(`페이지 이미지 변환 중 · ${current}/${total}`),
      );
      setUploadProgress("원본과 페이지 이미지를 저장하고 있습니다.");
      const formData = new FormData();
      formData.set("organization", organization);
      formData.set("companyName", companyName.trim());
      formData.set("quoteAmount", quoteAmount.trim());
      formData.set("quoteDate", quoteDate);
      formData.set("pdf", pdfFile);
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
      setCompanyName("");
      setQuoteAmount("");
      setQuoteDate(new Date().toISOString().slice(0, 10));
      setPdfFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadOpen(false);
      onToast("견적서 PDF와 상세 이미지가 저장되었습니다.");
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
          {uploadOpen ? "첨부 닫기" : "+ PDF 첨부"}
        </button>
      </div>

      {storage && (
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
      )}

      {uploadOpen && (
        <form className="quotation-upload-form" onSubmit={uploadQuotation}>
          <div className="quotation-upload-grid">
            <label>
              <span>견적 업체명 *</span>
              <input
                required
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="예: 투빛디자인"
              />
            </label>
            <label>
              <span>견적금액</span>
              <div className="quotation-money-input">
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="done"
                  value={quoteAmount}
                  onChange={(event) =>
                    setQuoteAmount(formatQuoteAmountInput(event.target.value))
                  }
                  placeholder="24,800,000"
                  aria-label="견적금액"
                />
                <span>원</span>
              </div>
            </label>
            <label>
              <span>견적일</span>
              <input type="date" value={quoteDate} onChange={(event) => setQuoteDate(event.target.value)} />
            </label>
            <label className="quotation-file-field">
              <span>견적서 PDF *</span>
              <input
                ref={fileInputRef}
                required
                type="file"
                accept="application/pdf,.pdf"
                onChange={selectPdf}
              />
              <small>{pdfFile ? `${pdfFile.name} · ${formatBytes(pdfFile.size)}` : "20MB 이하 · 최대 40페이지"}</small>
            </label>
          </div>
          <div className="quotation-upload-actions">
            {uploadProgress && <span>{uploadProgress}</span>}
            <button type="submit" disabled={uploading}>
              {uploading ? "처리 중…" : "PDF 저장"}
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
          <p className="quotation-empty">등록된 견적서가 없습니다. 업체 견적서 PDF를 첨부해 주세요.</p>
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
                  <b>{displayQuoteAmount(document.quoteAmount)}</b>
                </div>
                <small>{document.originalName} · {formatBytes(document.totalSize)} · {document.createdByName}</small>
                <div className="quotation-document-actions">
                  <button type="button" onClick={() => setPreview(document)}>이미지 보기</button>
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

      {preview && (
        <div className="quotation-preview-layer" role="dialog" aria-modal="true" aria-label={`${preview.companyName} 견적서 미리보기`}>
          <button className="quotation-preview-backdrop" type="button" aria-label="견적서 미리보기 닫기" onClick={() => setPreview(null)} />
          <div className="quotation-preview-panel">
            <header>
              <div>
                <span>{displayDate(preview.quoteDate)} · {preview.pageCount}페이지</span>
                <strong>{preview.companyName}</strong>
                <small>{displayQuoteAmount(preview.quoteAmount)}</small>
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
