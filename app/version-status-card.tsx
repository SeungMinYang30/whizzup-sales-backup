"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PlatformStatus = {
  ok: true;
  platform: "vercel" | "sites";
  platformLabel: string;
  release: string;
  deploymentVersion: string | null;
  sourceCommitShort: string;
  sourceCommittedAt: string;
  upstreamVercelCommit: string;
  upstreamVercelCommitShort: string;
  upstreamSyncedAt: string | null;
  replication: {
    status: "idle" | "syncing" | "succeeded" | "failed";
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    sourceCreatedAt: string | null;
    durationMs: number | null;
    operatingMode: "replica" | "primary";
  } | null;
  checkedAt: string;
};

type StatusTone = "success" | "warning" | "danger" | "neutral";

const VERCEL_ORIGIN = "https://whizzup.kr";
const SITES_ORIGIN = "https://whizzup-sales-hub.jackallan.chatgpt.site";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function elapsedLabel(value: string | null | undefined) {
  if (!value) return "기록 없음";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "기록 없음";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

async function fetchStatus(origin: string) {
  const sameOrigin = window.location.origin === origin;
  const response = await fetch(
    `${sameOrigin ? "" : origin}/api/system-version`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`${origin} 상태 확인 실패`);
  const payload = (await response.json()) as PlatformStatus;
  if (!payload.ok) throw new Error(`${origin} 상태 확인 실패`);
  return payload;
}

export default function VersionStatusCard() {
  const [vercel, setVercel] = useState<PlatformStatus | null>(null);
  const [sites, setSites] = useState<PlatformStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [vercelResult, sitesResult] = await Promise.allSettled([
      fetchStatus(VERCEL_ORIGIN),
      fetchStatus(SITES_ORIGIN),
    ]);
    setVercel(vercelResult.status === "fulfilled" ? vercelResult.value : null);
    setSites(sitesResult.status === "fulfilled" ? sitesResult.value : null);
    setFailed(
      vercelResult.status === "rejected" || sitesResult.status === "rejected",
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("whizzup:version-status-refresh", refresh);
    return () =>
      window.removeEventListener("whizzup:version-status-refresh", refresh);
  }, [load]);

  const featureSynced = Boolean(
    vercel &&
      sites &&
      vercel.upstreamVercelCommit === sites.upstreamVercelCommit,
  );
  const replicationAgeMinutes = useMemo(() => {
    const value = sites?.replication?.lastSuccessAt;
    if (!value) return Number.POSITIVE_INFINITY;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
      ? Math.max(0, (Date.now() - timestamp) / 60_000)
      : Number.POSITIVE_INFINITY;
  }, [sites]);
  const databaseSynced =
    sites?.replication?.status === "succeeded" && replicationAgeMinutes <= 30;
  const ready = Boolean(vercel && sites && featureSynced && databaseSynced);

  let overallTone: StatusTone = "neutral";
  let overallLabel = "상태 확인 중";
  if (!loading) {
    if (ready) {
      overallTone = "success";
      overallLabel = "비상 전환 준비 완료";
    } else if (failed || !vercel || !sites) {
      overallTone = "danger";
      overallLabel = "연결 상태 확인 필요";
    } else {
      overallTone = "warning";
      overallLabel = "동기화 확인 필요";
    }
  }

  const featureTone: StatusTone = loading
    ? "neutral"
    : featureSynced
      ? "success"
      : "warning";
  const databaseTone: StatusTone = loading
    ? "neutral"
    : databaseSynced
      ? "success"
      : replicationAgeMinutes <= 60
        ? "warning"
        : "danger";

  return (
    <article className="panel version-status-card" aria-live="polite">
      <header className="version-status-heading">
        <div>
          <span className="section-kicker">SERVICE CONTINUITY</span>
          <div className="version-status-title-row">
            <h3>운영·대기판 버전</h3>
            <span className={`version-status-badge ${overallTone}`}>
              <i aria-hidden="true" />
              {overallLabel}
            </span>
          </div>
          <p>기능 버전과 DB 복제 상태를 분리해 전환 가능 여부를 확인합니다.</p>
        </div>
        <button
          type="button"
          className="ghost-button version-status-refresh"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "확인 중…" : "상태 새로고침"}
        </button>
      </header>

      <div className="version-status-grid">
        <section>
          <span>Vercel 운영판</span>
          <strong>{vercel?.release || (loading ? "확인 중…" : "확인 실패")}</strong>
          <small>
            {vercel
              ? `소스 ${vercel.sourceCommitShort} · ${formatDateTime(vercel.sourceCommittedAt)}`
              : "운영판 응답을 확인해 주세요."}
          </small>
        </section>
        <section>
          <span>Sites 대기판</span>
          <strong>
            {sites
              ? [sites.deploymentVersion, sites.sourceCommitShort]
                  .filter(Boolean)
                  .join(" · ")
              : loading
                ? "확인 중…"
                : "확인 실패"}
          </strong>
          <small>
            {sites
              ? `운영판 ${sites.upstreamVercelCommitShort}까지 반영`
              : "대기판 응답을 확인해 주세요."}
          </small>
        </section>
        <section className={`version-status-cell ${featureTone}`}>
          <span>기능 동기화</span>
          <strong>{loading ? "확인 중…" : featureSynced ? "최신" : "업데이트 필요"}</strong>
          <small>
            {featureSynced
              ? `양쪽 ${vercel?.upstreamVercelCommit.slice(0, 7)} 기준`
              : "대기판 반영 기준이 운영판과 다릅니다."}
          </small>
        </section>
        <section className={`version-status-cell ${databaseTone}`}>
          <span>DB 자동 동기화</span>
          <strong>
            {loading
              ? "확인 중…"
              : databaseSynced
                ? "정상"
                : sites?.replication?.status === "syncing"
                  ? "동기화 중"
                  : "확인 필요"}
          </strong>
          <small>
            {sites?.replication?.lastSuccessAt
              ? `마지막 성공 ${elapsedLabel(sites.replication.lastSuccessAt)} · ${formatDateTime(sites.replication.lastSuccessAt)}`
              : "최종 성공 기록이 없습니다."}
          </small>
        </section>
      </div>
    </article>
  );
}
