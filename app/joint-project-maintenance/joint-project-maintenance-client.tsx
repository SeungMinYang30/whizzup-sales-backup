"use client";

import { useCallback, useEffect, useState } from "react";

type ActivityCandidate = {
  id: number;
  organization: string;
  activityDate: string;
  budgetType: string;
  businessRound: number;
};

type LinkAudit = {
  scannedMembers: number;
  activityBackfilled: Array<{
    projectId: number;
    memberId: number;
    organization: string;
    activityId: number;
    activityDate: string;
  }>;
  campaignTargetBackfilled: Array<{
    projectId: number;
    memberId: number;
    organization: string;
    campaignTargetId: number;
  }>;
  unresolved: Array<{
    projectId: number;
    memberId: number;
    organization: string;
    reason: "not_found" | "ambiguous";
    candidates: ActivityCandidate[];
  }>;
};

type ApplyResult = {
  ok: boolean;
  hamyang: Record<string, unknown>;
  audit: LinkAudit;
};

const cardStyle = {
  border: "1px solid #dbe3f0",
  borderRadius: 14,
  background: "#fff",
  padding: 20,
} as const;

export default function JointProjectMaintenanceClient() {
  const [audit, setAudit] = useState<LinkAudit | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/joint-projects?audit=1", {
        cache: "no-store",
      });
      const data = (await response.json()) as LinkAudit & { error?: string };
      if (!response.ok) throw new Error(data.error || "점검 결과를 불러오지 못했습니다.");
      setAudit(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "점검 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  async function applySafeLinks() {
    if (!window.confirm("후보가 정확히 1건인 공동사업 연결만 소급 적용합니다. 계속하시겠습니까?")) {
      return;
    }
    setApplying(true);
    setError("");
    try {
      const response = await fetch("/api/joint-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "backfill_links" }),
      });
      const data = (await response.json()) as ApplyResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "안전 연결 적용에 실패했습니다.");
      setApplied(data);
      await loadAudit();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "적용 중 오류가 발생했습니다.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f3f6fb", padding: 24, color: "#172033" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={cardStyle}>
          <p style={{ color: "#607bd7", fontWeight: 800, letterSpacing: 2, margin: 0 }}>
            JOINT PROJECT MAINTENANCE
          </p>
          <h1 style={{ margin: "8px 0" }}>공동사업 연결 점검</h1>
          <p style={{ margin: 0, color: "#60708a" }}>
            메뉴에 노출되지 않는 관리자 점검 화면입니다. 먼저 읽기 전용으로 검사하고,
            후보가 정확히 한 건인 연결만 안전하게 적용합니다.
          </p>
        </header>

        {error ? <section style={{ ...cardStyle, borderColor: "#ef9a9a", color: "#b42318" }}>{error}</section> : null}

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>읽기 전용 감사 결과</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => void loadAudit()} disabled={loading || applying}>
                다시 점검
              </button>
              <button type="button" onClick={() => void applySafeLinks()} disabled={loading || applying || !audit}>
                {applying ? "적용 중…" : "확실한 연결만 적용"}
              </button>
            </div>
          </div>
          {loading ? (
            <p>점검 중입니다…</p>
          ) : audit ? (
            <div data-testid="joint-project-audit" style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <strong>검사 참여기관 {audit.scannedMembers}곳</strong>
                <strong>활동 연결 가능 {audit.activityBackfilled.length}곳</strong>
                <strong>선정명단 연결 가능 {audit.campaignTargetBackfilled.length}곳</strong>
                <strong>관리자 확인 {audit.unresolved.length}곳</strong>
              </div>
              {audit.activityBackfilled.length ? (
                <div>
                  <h3>자동 연결 가능</h3>
                  <ul>
                    {audit.activityBackfilled.map((item) => (
                      <li key={`${item.projectId}-${item.memberId}`}>
                        {item.organization} · 활동 #{item.activityId} · {item.activityDate}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {audit.unresolved.length ? (
                <div>
                  <h3>관리자 확인 대상</h3>
                  <ul>
                    {audit.unresolved.map((item) => (
                      <li key={`${item.projectId}-${item.memberId}`}>
                        {item.organization} · {item.reason === "ambiguous" ? `후보 ${item.candidates.length}건` : "후보 없음"}
                        {item.candidates.map((candidate) => (
                          <div key={candidate.id} style={{ color: "#60708a", marginLeft: 16 }}>
                            활동 #{candidate.id} · {candidate.activityDate} · {candidate.budgetType} · {candidate.businessRound}차
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <pre data-testid="joint-project-audit-json" style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#748198" }}>
                {JSON.stringify(audit)}
              </pre>
            </div>
          ) : null}
        </section>

        {applied ? (
          <section style={cardStyle} data-testid="joint-project-apply-result">
            <h2 style={{ marginTop: 0 }}>적용 결과</h2>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(applied)}</pre>
          </section>
        ) : null}
      </div>
    </main>
  );
}
