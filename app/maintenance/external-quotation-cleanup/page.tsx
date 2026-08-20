"use client";

import { useCallback, useEffect, useState } from "react";

type LegacyDocument = {
  id: number;
  organization: string;
  businessRound: number;
  originalName: string;
  quoteDate: string;
  driveBacked: boolean;
};

export default function ExternalQuotationCleanupPage() {
  const [documents, setDocuments] = useState<LegacyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/quotation-documents/legacy-cleanup", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        documents?: LegacyDocument[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "자료를 확인하지 못했습니다.");
      setDocuments(payload.documents || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자료를 확인하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function purge() {
    if (!documents.length || deleting) return;
    if (!window.confirm(`기타 외부 견적 자료 ${documents.length}건을 사이트와 Google Drive에서 영구 삭제할까요?`)) {
      return;
    }
    setDeleting(true);
    setMessage("");
    try {
      const response = await fetch("/api/quotation-documents/legacy-cleanup", {
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        deleted?: number;
        failures?: Array<{ organization: string; error: string }>;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "일괄 삭제하지 못했습니다.");
      const failures = payload.failures || [];
      setMessage(
        failures.length
          ? `${payload.deleted || 0}건 삭제, ${failures.length}건 실패: ${failures.map((item) => `${item.organization} (${item.error})`).join(", ")}`
          : `${payload.deleted || 0}건을 사이트와 Google Drive에서 영구 삭제했습니다.`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "일괄 삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "48px auto", padding: "0 20px", fontFamily: "sans-serif" }}>
      <section style={{ background: "#fff", border: "1px solid #dbe4f2", borderRadius: 18, padding: 28 }}>
        <p style={{ color: "#64748b", fontWeight: 700, letterSpacing: ".12em", margin: 0 }}>OWNER MAINTENANCE</p>
        <h1 style={{ margin: "10px 0" }}>기타 외부 견적 자료 일괄 정리</h1>
        <p style={{ color: "#475569" }}>
          시스템이 만든 최종 견적 PDF·Excel은 유지하고, 별도로 첨부된 과거 외부 견적 자료만 사이트와 Google Drive에서 영구 삭제합니다.
        </p>

        {loading ? <p>대상을 확인하고 있습니다…</p> : <p><strong>삭제 대상 {documents.length}건</strong></p>}
        {message ? <p style={{ padding: 12, background: "#f1f5f9", borderRadius: 10 }}>{message}</p> : null}

        <div style={{ maxHeight: 430, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 12 }}>
          {documents.map((document) => (
            <div key={document.id} style={{ padding: "12px 14px", borderBottom: "1px solid #e2e8f0" }}>
              <strong>{document.organization} · {document.businessRound}차</strong>
              <div style={{ color: "#64748b", marginTop: 4 }}>{document.originalName} · {document.quoteDate}</div>
            </div>
          ))}
          {!loading && !documents.length ? <p style={{ padding: 16 }}>남아 있는 기타 외부 견적 자료가 없습니다.</p> : null}
        </div>

        <button
          type="button"
          onClick={() => void purge()}
          disabled={loading || deleting || !documents.length}
          style={{ marginTop: 18, padding: "12px 18px", border: 0, borderRadius: 10, background: "#dc2626", color: "#fff", fontWeight: 800, cursor: "pointer" }}
        >
          {deleting ? "영구 삭제 중…" : "모든 기타 외부 견적 자료 영구 삭제"}
        </button>
      </section>
    </main>
  );
}
