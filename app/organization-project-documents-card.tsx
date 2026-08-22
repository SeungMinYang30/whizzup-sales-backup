"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { RESOURCE_UPLOAD_CHUNK_BYTES, RESOURCE_UPLOAD_MAX_RETRIES, RESOURCE_UPLOAD_RETRY_BASE_DELAY_MS } from "../lib/resource-upload-config";

type ProjectDocument = {
  id: number;
  document_type: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_by_name: string;
  created_at: string;
};

type SiteLayoutDocument = {
  id: number;
  title: string;
  organizationName: string;
  businessRound: number;
  roomName: string;
  pdfUrl: string;
  jsonUrl: string;
  updatedByName: string;
  updatedAt: string;
};

type Props = {
  organization: string;
  businessRound: number;
};

type PendingProjectDocument = {
  key: string;
  file: File;
  documentType: string;
  status: "pending" | "uploading" | "uploaded" | "error";
  progress?: number;
  error?: string;
};

const acceptedFiles = ".pdf,.jpg,.jpeg,.png,.webp,.dwg,.dxf,.zip,.ppt,.pptx";
const documentTypes = [
  { value: "도면", label: "도면" },
  { value: "조감도", label: "조감도" },
  { value: "통합본", label: "도면·조감도 통합본" },
  { value: "기타", label: "기타" },
];
const documentFilters = ["전체", "기초도면", "도면", "조감도", "통합본", "기타"] as const;

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

function pendingDocumentKey(file: File) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function suggestedDocumentType(file: File) {
  const name = file.name.toLocaleLowerCase("ko-KR");
  if (name.includes("통합") || (name.includes("도면") && name.includes("조감"))) return "통합본";
  if (name.includes("조감") || name.includes("투시") || name.includes("렌더")) return "조감도";
  if (name.includes("도면") || name.includes("평면") || name.includes("입면") || name.includes("배치")) return "도면";
  return "통합본";
}

async function responsePayload(response: Response) {
  return await response.json().catch(() => ({})) as {
    error?: string;
    code?: string;
    documents?: ProjectDocument[];
    document?: ProjectDocument;
    uploadUrl?: string;
    folderId?: string;
    complete?: boolean;
    file?: { id?: string };
  };
}

function uploadHeaders(headers: Record<string, string>) {
  return { ...headers, "X-WHIZZUP-Request-Mode": "read" };
}

function uploadFailure(payload: { error?: string; code?: string }, status: number) {
  if (status === 413 || payload.code === "VERCEL_PAYLOAD_LIMIT") return new Error("파일이 커서 한 번에 전송하지 못했습니다. 조각 업로드로 다시 시도해 주세요.");
  return new Error(payload.error || "파일을 Google Drive에 저장하지 못했습니다.");
}

export default function OrganizationProjectDocumentsCard({ organization, businessRound }: Props) {
  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [siteLayouts, setSiteLayouts] = useState<SiteLayoutDocument[]>([]);
  const [pendingDocuments, setPendingDocuments] = useState<PendingProjectDocument[]>([]);
  const [documentFilter, setDocumentFilter] = useState<(typeof documentFilters)[number]>("전체");
  const [uploadSummary, setUploadSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadSequenceRef = useRef(0);

  const loadDocuments = useCallback(async () => {
    if (!organization || !businessRound) return;
    const requestId = ++loadSequenceRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ organization, businessRound: String(businessRound) });
      const [response, layoutResponse] = await Promise.all([
        fetch(`/api/organization-project-documents?${params}`, { cache: "no-store" }),
        fetch(`/api/site-layouts?q=${encodeURIComponent(organization)}`, { cache: "no-store" }),
      ]);
      const [payload, layoutPayload] = await Promise.all([
        responsePayload(response),
        layoutResponse.json().catch(() => ({})) as Promise<{ layouts?: SiteLayoutDocument[] }>,
      ]);
      if (!response.ok) throw new Error(payload.error || "도면·조감도를 불러오지 못했습니다.");
      if (!layoutResponse.ok) throw new Error("연결된 기초도면을 불러오지 못했습니다.");
      if (requestId !== loadSequenceRef.current) return;
      setDocuments(Array.isArray(payload.documents) ? payload.documents : []);
      setSiteLayouts((Array.isArray(layoutPayload.layouts) ? layoutPayload.layouts : []).filter((layout) => layout.organizationName === organization && Number(layout.businessRound) === businessRound));
    } catch (caught) {
      if (requestId !== loadSequenceRef.current) return;
      setError(caught instanceof Error ? caught.message : "도면·조감도를 불러오지 못했습니다.");
    } finally {
      if (requestId === loadSequenceRef.current) setLoading(false);
    }
  }, [businessRound, organization]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDocuments(), 0);
    return () => {
      window.clearTimeout(timer);
      loadSequenceRef.current += 1;
    };
  }, [loadDocuments]);

  function queueFiles(files: FileList | null) {
    const selected = files ? Array.from(files) : [];
    if (!selected.length || uploading) return;
    const existing = new Set(pendingDocuments.map((entry) => entry.key));
    const additions = selected
      .filter((file) => !existing.has(pendingDocumentKey(file)))
      .map((file) => ({
        key: pendingDocumentKey(file),
        file,
        documentType: suggestedDocumentType(file),
        status: "pending" as const,
      }));
    const next = [...pendingDocuments, ...additions];
    setPendingDocuments(next.slice(0, 10));
    setUploadSummary("");
    setError(next.length > 10 ? "한 번에 최대 10개 파일까지 등록할 수 있습니다." : "");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadFiles() {
    const selected = pendingDocuments.filter((entry) => entry.status !== "uploaded");
    if (!selected.length || uploading) return;
    setUploading(true);
    setError("");
    setUploadSummary("");
    let uploadedCount = 0;
    let failedCount = 0;
    for (const entry of selected) {
      setPendingDocuments((current) => current.map((item) => item.key === entry.key ? { ...item, status: "uploading", progress: 0, error: undefined } : item));
      try {
        const metadata = {
          organization,
          businessRound,
          documentType: entry.documentType,
          fileName: entry.file.name,
          mimeType: entry.file.type || "application/octet-stream",
          sizeBytes: entry.file.size,
        };
        const sessionResponse = await fetch("/api/organization-project-documents", {
          method: "POST",
          headers: uploadHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(metadata),
        });
        const session = await responsePayload(sessionResponse);
        if (!sessionResponse.ok || !session.uploadUrl || !session.folderId) throw uploadFailure(session, sessionResponse.status);

        let fileId = "";
        for (let start = 0; start < entry.file.size; start += RESOURCE_UPLOAD_CHUNK_BYTES) {
          const end = Math.min(entry.file.size, start + RESOURCE_UPLOAD_CHUNK_BYTES);
          let completed = false;
          let lastError: Error | null = null;
          for (let attempt = 0; attempt <= RESOURCE_UPLOAD_MAX_RETRIES; attempt += 1) {
            try {
              const chunkResponse = await fetch("/api/organization-project-documents", {
                method: "PUT",
                headers: uploadHeaders({
                  "Content-Type": metadata.mimeType,
                  "Content-Range": `bytes ${start}-${end - 1}/${entry.file.size}`,
                  "X-Drive-Upload-Url": session.uploadUrl,
                }),
                body: entry.file.slice(start, end),
              });
              const chunk = await responsePayload(chunkResponse);
              if (!chunkResponse.ok) throw uploadFailure(chunk, chunkResponse.status);
              if (chunk.complete) fileId = chunk.file?.id || "";
              const progress = Math.min(99, Math.round((end / entry.file.size) * 100));
              setPendingDocuments((current) => current.map((item) => item.key === entry.key ? { ...item, progress } : item));
              completed = true;
              break;
            } catch (caught) {
              lastError = caught instanceof Error ? caught : new Error("파일 조각을 전송하지 못했습니다.");
              if (attempt < RESOURCE_UPLOAD_MAX_RETRIES) {
                await new Promise((resolve) => window.setTimeout(resolve, RESOURCE_UPLOAD_RETRY_BASE_DELAY_MS * 2 ** attempt));
              }
            }
          }
          if (!completed) throw lastError || new Error("파일 조각을 전송하지 못했습니다.");
        }
        if (!fileId) throw new Error("Google Drive 업로드 완료 정보를 확인하지 못했습니다.");
        const finalizeResponse = await fetch("/api/organization-project-documents", {
          method: "PATCH",
          headers: uploadHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ ...metadata, fileId, folderId: session.folderId }),
        });
        const finalized = await responsePayload(finalizeResponse);
        if (!finalizeResponse.ok || !finalized.document) throw uploadFailure(finalized, finalizeResponse.status);
        uploadedCount += 1;
        setPendingDocuments((current) => current.map((item) => item.key === entry.key ? { ...item, status: "uploaded", progress: 100, error: undefined } : item));
      } catch (caught) {
        failedCount += 1;
        const message = caught instanceof Error ? caught.message : "파일을 저장하지 못했습니다.";
        setPendingDocuments((current) => current.map((item) => item.key === entry.key ? { ...item, status: "error", error: message } : item));
      }
    }
    if (uploadedCount) await loadDocuments();
    setPendingDocuments((current) => current.filter((item) => item.status !== "uploaded"));
    setUploadSummary(`${uploadedCount}개 파일을 등록했습니다.${failedCount ? ` 실패 ${failedCount}개는 목록에서 확인 후 다시 등록해 주세요.` : ""}`);
    setUploading(false);
  }

  async function deleteDocument(document: ProjectDocument) {
    if (!window.confirm(`‘${document.original_name}’ 파일을 삭제할까요?\n삭제된 파일은 복구를 위해 99_보관 폴더로 이동됩니다.`)) return;
    setError("");
    try {
      const response = await fetch(`/api/organization-project-documents?id=${document.id}`, { method: "DELETE" });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(payload.error || "파일을 삭제하지 못했습니다.");
      setDocuments((current) => current.filter((item) => item.id !== document.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "파일을 삭제하지 못했습니다.");
    }
  }

  function closeModal() {
    setOpen(false);
  }

  const visibleDocuments = documentFilter === "전체"
    ? documents
    : documentFilter === "기초도면" ? [] : documents.filter((document) => document.document_type === documentFilter);
  const visibleSiteLayouts = documentFilter === "전체" || documentFilter === "기초도면" ? siteLayouts : [];
  const totalDocumentCount = documents.length + siteLayouts.length;

  return (
    <Fragment>
      <div className="history-summary-project-documents">
        <span>도면·조감도</span>
        <strong>{totalDocumentCount ? `${totalDocumentCount}개 파일` : "보기·등록"}</strong>
        <small>{businessRound}차 사업별 Google Drive 보관</small>
        <button type="button" onClick={() => { setOpen(true); void loadDocuments(); }}>도면·조감도 보기</button>
      </div>
      {open ? (
        <div className="project-documents-modal-shell" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeModal(); }}>
          <section className="project-documents-modal" role="dialog" aria-modal="true" aria-labelledby="project-documents-title">
            <header>
              <div><span className="section-kicker">PROJECT FILES</span><h2 id="project-documents-title">도면·조감도</h2><p>{organization} · {businessRound}차 사업</p></div>
              <button type="button" aria-label="닫기" onClick={closeModal}>×</button>
            </header>
            <div className="project-documents-upload">
              <div><b>도면·조감도 한 번에 등록</b><span>통합 파일 한 개 또는 서로 다른 파일을 최대 10개까지 함께 선택하세요.</span></div>
              <label className="project-documents-file">파일 선택<input ref={fileInputRef} type="file" multiple accept={acceptedFiles} disabled={uploading} onChange={(event) => queueFiles(event.target.files)} /><span>{pendingDocuments.length ? "+ 파일 더 선택" : "+ 파일 여러 개 선택"}</span></label>
            </div>
            {pendingDocuments.length ? <div className="project-documents-queue">
              <header><div><b>등록 대기 {pendingDocuments.length}개</b><span>파일마다 자료 종류를 확인해 주세요.</span></div><button type="button" disabled={uploading} onClick={() => void uploadFiles()}>{uploading ? "Google Drive에 등록 중…" : `선택 파일 ${pendingDocuments.length}개 등록`}</button></header>
              <div>{pendingDocuments.map((entry) => <article key={entry.key} className={entry.status}>
                <div><strong>{entry.file.name}</strong><small>{formatBytes(entry.file.size)}{entry.error ? ` · ${entry.error}` : entry.status === "uploading" ? ` · ${entry.progress || 0}% 등록 중…` : ""}</small></div>
                <select aria-label={`${entry.file.name} 자료 종류`} value={entry.documentType} disabled={uploading} onChange={(event) => setPendingDocuments((current) => current.map((item) => item.key === entry.key ? { ...item, documentType: event.target.value, status: "pending", error: undefined } : item))}>{documentTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
                <button type="button" disabled={uploading} aria-label={`${entry.file.name} 선택 해제`} onClick={() => setPendingDocuments((current) => current.filter((item) => item.key !== entry.key))}>제외</button>
              </article>)}</div>
            </div> : null}
            <small className="project-documents-storage-note">Google Drive의 지역 / 기관명 / 도면·조감도 / 사업 차수 폴더에 저장합니다. 삭제한 파일은 99_보관으로 이동합니다.</small>
            {uploadSummary ? <div className="project-documents-success" role="status">{uploadSummary}</div> : null}
            {error ? <div className="project-documents-error" role="alert">{error}</div> : null}
            {totalDocumentCount ? <nav className="project-documents-filters" aria-label="도면·조감도 자료 필터">{documentFilters.map((filter) => {
              const count = filter === "전체" ? totalDocumentCount : filter === "기초도면" ? siteLayouts.length : documents.filter((document) => document.document_type === filter).length;
              return <button key={filter} type="button" className={documentFilter === filter ? "active" : ""} onClick={() => setDocumentFilter(filter)}>{filter} <b>{count}</b></button>;
            })}</nav> : null}
            <div className="project-documents-list">
              {loading ? <p>파일을 불러오는 중입니다.</p> : <>
              {visibleSiteLayouts.map((layout) => (
                <article key={`layout-${layout.id}`} className="is-site-layout">
                  <div><b>기초도면</b><strong>{layout.roomName || layout.title}</strong><small>{layout.updatedByName || "작성자 미상"} · {new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(layout.updatedAt))}</small></div>
                  <div>{layout.pdfUrl ? <><a href={layout.pdfUrl} target="_blank" rel="noopener noreferrer">PDF 보기</a><a href={layout.pdfUrl} download>PDF 다운로드</a></> : <span>PDF 저장 전</span>}{layout.jsonUrl && <a href={layout.jsonUrl}>원본</a>}</div>
                </article>
              ))}
              {visibleDocuments.map((document) => (
                <article key={`document-${document.id}`}>
                  <div><b>{document.document_type}</b><strong>{document.original_name}</strong><small>{formatBytes(Number(document.size_bytes) || 0)} · {document.created_by_name || "등록자 미상"}</small></div>
                  <div><a href={`/api/organization-project-documents?id=${document.id}&preview=1`} target="_blank" rel="noopener noreferrer">보기</a><a href={`/api/organization-project-documents?id=${document.id}&download=1`}>다운로드</a><button type="button" className="danger" onClick={() => void deleteDocument(document)}>삭제</button></div>
                </article>
              ))}
              {!visibleSiteLayouts.length && !visibleDocuments.length && <p>{totalDocumentCount ? `${documentFilter} 자료가 없습니다.` : "등록된 도면·조감도 또는 기초도면이 없습니다."}</p>}
              </>}
            </div>
          </section>
        </div>
      ) : null}
    </Fragment>
  );
}
