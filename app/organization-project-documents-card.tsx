"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

type ProjectDocument = {
  id: number;
  document_type: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_by_name: string;
  created_at: string;
};

type Props = {
  organization: string;
  businessRound: number;
};

const acceptedFiles = ".pdf,.jpg,.jpeg,.png,.webp,.dwg,.dxf,.zip,.ppt,.pptx";

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

async function responsePayload(response: Response) {
  return await response.json().catch(() => ({})) as { error?: string; documents?: ProjectDocument[] };
}

export default function OrganizationProjectDocumentsCard({ organization, businessRound }: Props) {
  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [documentType, setDocumentType] = useState("도면");
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
      const response = await fetch(`/api/organization-project-documents?${params}`, { cache: "no-store" });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(payload.error || "도면·조감도를 불러오지 못했습니다.");
      if (requestId !== loadSequenceRef.current) return;
      setDocuments(Array.isArray(payload.documents) ? payload.documents : []);
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

  async function uploadFiles(files: FileList | null) {
    const selected = files ? Array.from(files).slice(0, 10) : [];
    if (!selected.length || uploading) return;
    setUploading(true);
    setError("");
    try {
      for (const file of selected) {
        const form = new FormData();
        form.set("organization", organization);
        form.set("businessRound", String(businessRound));
        form.set("documentType", documentType);
        form.set("file", file);
        const response = await fetch("/api/organization-project-documents", { method: "POST", body: form });
        const payload = await responsePayload(response);
        if (!response.ok) throw new Error(payload.error || `${file.name} 파일을 저장하지 못했습니다.`);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadDocuments();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "파일을 저장하지 못했습니다.");
    } finally {
      setUploading(false);
    }
  }

  async function archiveDocument(document: ProjectDocument) {
    if (!window.confirm(`‘${document.original_name}’을 99_보관 폴더로 옮길까요?`)) return;
    setError("");
    try {
      const response = await fetch(`/api/organization-project-documents?id=${document.id}`, { method: "DELETE" });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(payload.error || "파일을 보관하지 못했습니다.");
      setDocuments((current) => current.filter((item) => item.id !== document.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "파일을 보관하지 못했습니다.");
    }
  }

  return (
    <Fragment>
      <div className="history-summary-project-documents">
        <span>도면·조감도</span>
        <strong>{documents.length ? `${documents.length}개 파일` : "보기·등록"}</strong>
        <small>{businessRound}차 사업별 Google Drive 보관</small>
        <button type="button" onClick={() => { setOpen(true); void loadDocuments(); }}>도면·조감도 보기</button>
      </div>
      {open ? (
        <div className="project-documents-modal-shell" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
          <section className="project-documents-modal" role="dialog" aria-modal="true" aria-labelledby="project-documents-title">
            <header>
              <div><span className="section-kicker">PROJECT FILES</span><h2 id="project-documents-title">도면·조감도</h2><p>{organization} · {businessRound}차 사업</p></div>
              <button type="button" aria-label="닫기" onClick={() => setOpen(false)}>×</button>
            </header>
            <div className="project-documents-upload">
              <label>자료 종류<select value={documentType} onChange={(event) => setDocumentType(event.target.value)}><option>도면</option><option>조감도</option><option>기타</option></select></label>
              <label className="project-documents-file">파일 선택<input ref={fileInputRef} type="file" multiple accept={acceptedFiles} disabled={uploading} onChange={(event) => void uploadFiles(event.target.files)} /><span>{uploading ? "Google Drive에 저장 중…" : "+ 파일 등록"}</span></label>
            </div>
            <small className="project-documents-storage-note">Google Drive의 기관명 / 사업 차수 / 도면·조감도 폴더에만 저장합니다. 삭제한 파일은 99_보관으로 이동합니다.</small>
            {error ? <div className="project-documents-error" role="alert">{error}</div> : null}
            <div className="project-documents-list">
              {loading ? <p>파일을 불러오는 중입니다.</p> : documents.length ? documents.map((document) => (
                <article key={document.id}>
                  <div><b>{document.document_type}</b><strong>{document.original_name}</strong><small>{formatBytes(Number(document.size_bytes) || 0)} · {document.created_by_name || "등록자 미상"}</small></div>
                  <div><button type="button" onClick={() => window.open(`/api/organization-project-documents?id=${document.id}&preview=1`, "_blank", "noopener,noreferrer")}>보기</button><a href={`/api/organization-project-documents?id=${document.id}&download=1`}>다운로드</a><button type="button" className="danger" onClick={() => void archiveDocument(document)}>보관</button></div>
                </article>
              )) : <p>등록된 도면·조감도가 없습니다.</p>}
            </div>
          </section>
        </div>
      ) : null}
    </Fragment>
  );
}
