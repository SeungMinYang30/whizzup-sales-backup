"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Readiness = {
  mode: "vercel" | "sites";
  transition: boolean;
  ready: boolean;
  blockers: string[];
  gateway: { ready: boolean; mode: string | null };
  confirmations: { activate: string; failback: string };
  sync: {
    status: "idle" | "syncing" | "succeeded" | "failed";
    last_success_at: string | null;
  } | null;
};

type CutoverAction = "activate-sites" | "return-vercel";

export default function ContinuityControlCard({
  enabled,
}: {
  enabled: boolean;
}) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<CutoverAction | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const response = await fetch("/api/standby-cutover", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.readiness) {
        throw new Error(payload.error || "전환 상태를 확인하지 못했습니다.");
      }
      setReadiness(payload.readiness as Readiness);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "전환 상태를 확인하지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const expected = useMemo(() => {
    if (!readiness || !action) return "";
    return action === "activate-sites"
      ? readiness.confirmations.activate
      : readiness.confirmations.failback;
  }, [action, readiness]);

  if (!enabled) return null;

  const activeLabel = readiness?.mode === "sites" ? "Sites 대기판" : "Vercel 운영판";
  const nextAction: CutoverAction =
    readiness?.mode === "sites" ? "return-vercel" : "activate-sites";
  const activationBlockers = (readiness?.blockers ?? []).filter(
    (blocker) => !blocker.includes("최종 동기화 성공 기록"),
  );
  const actionReady = Boolean(
    readiness?.gateway.ready &&
      !readiness.transition &&
      (nextAction === "return-vercel" || activationBlockers.length === 0),
  );

  async function submit() {
    if (!action || confirmation.trim() !== expected) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/standby-cutover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmation: confirmation.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const blockers = Array.isArray(payload.blockers)
          ? ` ${payload.blockers.join(" ")}`
          : "";
        throw new Error(
          `${payload.error || "서비스 전환에 실패했습니다."}${blockers}`,
        );
      }
      setReadiness(payload.readiness as Readiness);
      setMessage(
        action === "activate-sites"
          ? "Sites 비상 운영 전환이 완료되었습니다."
          : "Vercel 정상 운영 복귀가 완료되었습니다.",
      );
      setAction(null);
      setConfirmation("");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "서비스 전환에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="panel continuity-control-card" aria-live="polite">
      <header className="continuity-control-heading">
        <div>
          <span className="section-kicker">CONTROLLED FAILOVER</span>
          <h3>비상 운영 전환</h3>
          <p>
            최종 DB 검증과 쓰기 잠금을 거친 뒤 운영 위치를 바꿉니다. 실패하면
            현재 운영 위치를 유지합니다.
          </p>
        </div>
        <span className="backup-owner-badge">운영자 본인 전용</span>
      </header>

      <div className="continuity-control-summary">
        <div>
          <span>현재 운영</span>
          <strong>{loading ? "확인 중…" : activeLabel}</strong>
        </div>
        <div>
          <span>도메인 관문</span>
          <strong className={readiness?.gateway.ready ? "success" : "warning"}>
            {loading
              ? "확인 중…"
              : readiness?.gateway.ready
                ? "연결 완료"
                : "DNS 연결 필요"}
          </strong>
        </div>
        <div>
          <span>전환 상태</span>
          <strong>{readiness?.transition ? "검증 중" : "대기"}</strong>
        </div>
      </div>

      {readiness?.blockers.length ? (
        <ul className="continuity-blockers">
          {readiness.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="continuity-message error">{error}</p> : null}
      {message ? <p className="continuity-message success">{message}</p> : null}

      {!action ? (
        <div className="continuity-control-actions">
          <button
            type="button"
            className={
              nextAction === "activate-sites" ? "danger-button" : "primary-button"
            }
            disabled={loading || busy || !actionReady}
            onClick={() => {
              setAction(nextAction);
              setConfirmation("");
              setError("");
            }}
          >
            {nextAction === "activate-sites"
              ? "최종 동기화 후 Sites 전환"
              : "Vercel로 정상 복귀"}
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={loading || busy}
            onClick={() => void load()}
          >
            상태 새로고침
          </button>
        </div>
      ) : (
        <div className="continuity-confirmation">
          <strong>
            {action === "activate-sites"
              ? "비상 전환 전 최종 확인"
              : "정상 복귀 전 최종 확인"}
          </strong>
          <p>
            확인 문구 <code>{expected}</code>를 입력해 주세요.
          </p>
          <input
            aria-label="서비스 전환 확인 문구"
            value={confirmation}
            disabled={busy}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={expected}
          />
          <div>
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={() => {
                setAction(null);
                setConfirmation("");
              }}
            >
              취소
            </button>
            <button
              type="button"
              className={
                action === "activate-sites" ? "danger-button" : "primary-button"
              }
              disabled={busy || confirmation.trim() !== expected}
              onClick={() => void submit()}
            >
              {busy ? "검증·전환 중…" : "확인 후 실행"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
