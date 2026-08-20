import { getReplicationSyncState } from "../../../lib/replication-store";
import { PLATFORM_RELEASE } from "../../../lib/platform-release";

export const dynamic = "force-dynamic";

const allowedOrigins = new Set([
  "https://whizzup.kr",
  "https://www.whizzup.kr",
  "https://whizzup-sales-hub.jackallan.chatgpt.site",
]);

function responseHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const headers = new Headers({
    "Cache-Control": "public, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  });
  if (allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function normalizeCommit(value: string | undefined, fallback: string) {
  const commit = String(value || fallback).trim();
  return /^[a-f0-9]{7,64}$/i.test(commit) ? commit.toLowerCase() : fallback;
}

function normalizeUtcTimestamp(value: string | null) {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized)) return normalized;
  return `${normalized.replace(" ", "T")}Z`;
}

function releaseLabel(commit: string, timestamp: string) {
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "00";
  return `WZ-${value("year")}${value("month")}${value("day")}-${commit.slice(0, 7).toUpperCase()}`;
}

export async function OPTIONS(request: Request) {
  const headers = responseHeaders(request);
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const sourceCommit = normalizeCommit(
    process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA,
    PLATFORM_RELEASE.fallbackSourceCommit,
  );
  const sourceCommittedAt =
    process.env.VERCEL_GIT_COMMIT_DATE || PLATFORM_RELEASE.sourceCommittedAt;
  const upstreamVercelCommit = normalizeCommit(
    PLATFORM_RELEASE.upstreamVercelCommit || sourceCommit,
    sourceCommit,
  );

  let replication = null;
  if (PLATFORM_RELEASE.platform === "sites") {
    try {
      const state = await getReplicationSyncState();
      replication = state
        ? {
            status: state.status,
            lastAttemptAt: normalizeUtcTimestamp(state.last_attempt_at),
            lastSuccessAt: normalizeUtcTimestamp(state.last_success_at),
            sourceCreatedAt: normalizeUtcTimestamp(state.source_created_at),
            durationMs: state.duration_ms,
            operatingMode: state.operating_mode,
          }
        : null;
    } catch {
      replication = null;
    }
  }

  return Response.json(
    {
      ok: true,
      platform: PLATFORM_RELEASE.platform,
      platformLabel: PLATFORM_RELEASE.platformLabel,
      release: releaseLabel(
        upstreamVercelCommit,
        PLATFORM_RELEASE.upstreamSyncedAt || sourceCommittedAt,
      ),
      deploymentVersion:
        process.env.WHIZZUP_DEPLOYMENT_VERSION ||
        PLATFORM_RELEASE.deploymentVersion ||
        null,
      sourceCommit,
      sourceCommitShort: sourceCommit.slice(0, 7),
      sourceCommittedAt,
      upstreamVercelCommit,
      upstreamVercelCommitShort: upstreamVercelCommit.slice(0, 7),
      upstreamSyncedAt: PLATFORM_RELEASE.upstreamSyncedAt || null,
      replication,
      checkedAt: new Date().toISOString(),
    },
    { headers: responseHeaders(request) },
  );
}
