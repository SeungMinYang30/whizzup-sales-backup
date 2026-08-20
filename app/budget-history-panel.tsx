"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type BudgetHistoryEvent = {
  id: string;
  eventId: number | null;
  kind: "event" | "deleted";
  groupId: number | null;
  action: string;
  summary: string;
  changedByName: string;
  createdAt: string;
  before: unknown;
  after: unknown;
  impact: {
    total: number;
    organization: string;
    businessRound: number | null;
    counts: Record<string, unknown>;
  };
  snapshot: Record<string, unknown>;
  undoable: boolean;
  restoreStatus: string;
};

const actionLabels: Record<string, string> = {
  "create-standard": "표준 예산명 등록",
  "update-standard": "표준 예산명 설정 변경",
  "add-alias": "별칭 연결",
  "add-alias-retrofit": "별칭 원본 연결",
  "connect-existing": "기존 이름 연결",
  "keep-unclassified": "미분류 유지",
  "exclude-review": "검토 목록 제외",
  "restore-review": "검토 목록 복원",
  "process-request": "신청 처리",
  "apply-retrofit": "확정 예산 자동 적용",
  "permanent-delete": "영구 삭제",
  deactivate: "비활성화",
  "set-active": "활성화 변경",
  group: "예산명 묶음 생성",
  "register-new": "표준 예산명 등록",
};

function formatDate(value: string) {
  const parsed = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function valueText(value: unknown) {
  if (value === null || value === undefined) return "없음";
  if (typeof value === "string") return value || "없음";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function BudgetHistoryPanel({
  notify,
  onDataChanged,
}: {
  notify: (message: string) => void;
  onDataChanged: () => void | Promise<void>;
}) {
  const [events, setEvents] = useState<BudgetHistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/budget-names?view=history", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        events?: BudgetHistoryEvent[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "표준 예산명 이력을 불러오지 못했습니다.");
      }
      setEvents(payload.events || []);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "표준 예산명 이력을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadHistory(), 0);
    return () => window.clearTimeout(timer);
  }, [loadHistory]);

  const filteredEvents = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko-KR");
    return events.filter((event) => {
      if (actionFilter === "restorable" && !event.undoable) return false;
      if (actionFilter === "deleted" && event.kind !== "deleted") return false;
      if (!keyword) return true;
      return [
        event.summary,
        event.changedByName,
        event.action,
        event.impact.organization,
      ].some((value) => String(value ?? "").toLocaleLowerCase("ko-KR").includes(keyword));
    });
  }, [actionFilter, events, query]);

  async function undo(event: BudgetHistoryEvent) {
    if (!event.undoable || !event.eventId || busyId) return;
    if (!window.confirm(`‘${event.summary}’ 변경을 안전하게 되돌릴까요?`)) return;
    setBusyId(event.id);
    try {
      const response = await fetch("/api/budget-names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo-event", eventId: event.eventId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "표준 예산명 변경을 복원하지 못했습니다.");
      }
      await Promise.all([loadHistory(), onDataChanged()]);
      notify("표준 예산명 변경을 안전하게 복원했습니다.");
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "표준 예산명 변경을 복원하지 못했습니다.";
      setError(message);
      notify(message);
      await loadHistory();
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="panel budget-history-recovery-panel">
      <div className="panel-header trash-panel-header">
        <div>
          <span className="section-kicker">BUDGET NAME HISTORY</span>
          <h2>표준 예산명 변경 이력</h2>
          <p>
            등록·연결·제외·신청 승인·영구 삭제 기록을 확인합니다. 이후 변경과
            충돌하지 않는 작업에만 복원 버튼이 표시됩니다.
          </p>
        </div>
        <button type="button" onClick={() => void loadHistory()} disabled={loading || Boolean(busyId)}>
          새로고침
        </button>
      </div>

      <div className="budget-history-filter-bar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="예산명·작업자·기관 검색"
          aria-label="표준 예산명 변경 이력 검색"
        />
        <select
          value={actionFilter}
          onChange={(event) => setActionFilter(event.target.value)}
          aria-label="표준 예산명 변경 종류"
        >
          <option value="all">전체 작업</option>
          <option value="restorable">복원 가능한 작업</option>
          <option value="deleted">영구 삭제 기록</option>
        </select>
      </div>

      {error && <div className="trash-error" role="alert"><span>{error}</span></div>}
      {loading ? (
        <div className="loading-state"><i /><span>표준 예산명 이력을 확인하는 중입니다</span></div>
      ) : filteredEvents.length === 0 ? (
        <div className="trash-empty compact"><strong>조건에 맞는 변경 이력이 없습니다.</strong></div>
      ) : (
        <div className="budget-history-recovery-list">
          {filteredEvents.map((event) => (
            <article key={event.id}>
              <header>
                <div>
                  <span>{actionLabels[event.action] || event.action || "예산명 변경"}</span>
                  <strong>{event.summary}</strong>
                  <small>{event.changedByName || "시스템"} · {formatDate(event.createdAt)}</small>
                </div>
                <em className={event.kind === "deleted" ? "blocked" : event.undoable ? "ready" : "history"}>
                  {event.restoreStatus}
                </em>
              </header>
              <div className="budget-history-impact">
                <span>영향 {event.impact.total.toLocaleString("ko-KR")}건</span>
                {event.impact.organization && (
                  <span>
                    {event.impact.organization}
                    {event.impact.businessRound ? ` · ${event.impact.businessRound}차` : ""}
                  </span>
                )}
              </div>
              <details>
                <summary>변경 전·후 및 영향 상세보기</summary>
                <div className="budget-history-detail-grid">
                  <section><b>변경 전</b><pre>{valueText(event.before)}</pre></section>
                  <section><b>변경 후</b><pre>{valueText(event.after)}</pre></section>
                  <section><b>영향 내역</b><pre>{valueText(event.impact.counts)}</pre></section>
                </div>
              </details>
              <footer>
                {event.undoable ? (
                  <button type="button" disabled={Boolean(busyId)} onClick={() => void undo(event)}>
                    {busyId === event.id ? "확인 중…" : "안전하게 복원"}
                  </button>
                ) : (
                  <small>
                    {event.kind === "deleted"
                      ? "영구 삭제 감사기록은 복원할 수 없습니다."
                      : "이후 변경 또는 작업 성격 때문에 자동 복원하지 않습니다."}
                  </small>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

