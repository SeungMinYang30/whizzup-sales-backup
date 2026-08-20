import {
  accessErrorResponse,
  requirePrimaryOwner,
} from "../../../lib/collaboration";
import {
  createFullBackup,
  replicaContentChecksum,
} from "../../../lib/backup-store";
import { getD1 } from "../../../db";
import {
  getStandbyScheduleStatus,
  configureStandbySchedule,
  removeStandbySchedule,
} from "../../../lib/replication-scheduler";
import {
  getReplicationSyncState,
  markReplicationAttempt,
  markReplicationFailure,
  markReplicationSuccess,
  markStandbyPrimaryMode,
  markStandbyReplicaMode,
} from "../../../lib/replication-store";
import { createStandbyCredentialSnapshot } from "../../../lib/standby-credentials";
import { gzipSync } from "node:zlib";

export const dynamic = "force-dynamic";

const ACTIVATE_CONFIRMATION = "SITES 비상 전환";
const FAILBACK_CONFIRMATION = "VERCEL 정상 복귀";
const MAX_REVERSE_SYNC_BYTES = 25 * 1024 * 1024;
const MAX_REVERSE_SYNC_COMPRESSED_BYTES = 4 * 1024 * 1024;

type CutoverAction = "activate-sites" | "return-vercel";

function serverValue(name: string) {
  return String(process.env[name] ?? "").trim();
}

function secureEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function authorizedByServerSecret(request: Request) {
  const cutoverSecret = serverValue("CUTOVER_API_SECRET");
  const syncSecret = serverValue("STANDBY_SYNC_SECRET");
  const exportSecret = serverValue("STANDBY_EXPORT_SECRET");
  const authorization = request.headers.get("authorization") ?? "";
  return (
    (Boolean(cutoverSecret) &&
      secureEqual(authorization, `Bearer ${cutoverSecret}`)) ||
    (Boolean(syncSecret) && secureEqual(authorization, `Bearer ${syncSecret}`)) ||
    (Boolean(exportSecret) &&
      secureEqual(authorization, `Bearer ${exportSecret}`))
  );
}

async function requireCutoverAccess(request: Request) {
  if (!authorizedByServerSecret(request)) await requirePrimaryOwner();
}

async function cutoverActorId(request: Request) {
  if (!authorizedByServerSecret(request)) {
    return (await requirePrimaryOwner()).id;
  }
  const owner = await getD1()
    .prepare(
      `SELECT id
       FROM members
       WHERE role = 'admin' AND status = 'approved'
       ORDER BY id ASC
       LIMIT 1`,
    )
    .first<{ id: number }>();
  if (!owner?.id) throw new Error("전환을 기록할 운영자 계정이 없습니다.");
  return Number(owner.id);
}

function sitesOrigin() {
  return (
    serverValue("APP_ORIGIN") ||
    "https://whizzup-sales-hub.jackallan.chatgpt.site"
  ).replace(/\/+$/, "");
}

function publicOrigin() {
  return (
    serverValue("PRIMARY_SITE_ORIGIN") || "https://whizzup.kr"
  ).replace(/\/+$/, "");
}

function vercelOrigin() {
  return (
    serverValue("VERCEL_PRIMARY_ORIGIN") ||
    "https://whizzup-sales-hub.vercel.app"
  ).replace(/\/+$/, "");
}

function driveStatus() {
  const fields = {
    clientId: Boolean(serverValue("GOOGLE_DRIVE_CLIENT_ID")),
    clientSecret: Boolean(serverValue("GOOGLE_DRIVE_CLIENT_SECRET")),
    refreshToken: Boolean(serverValue("GOOGLE_DRIVE_REFRESH_TOKEN")),
    rootFolderId: Boolean(serverValue("GOOGLE_DRIVE_ROOT_FOLDER_ID")),
  };
  return {
    ...fields,
    ready:
      fields.clientId &&
      fields.clientSecret &&
      fields.refreshToken &&
      fields.rootFolderId,
  };
}

async function gatewayStatus() {
  try {
    const hostname = new URL(publicOrigin()).hostname;
    const expectedAddresses = serverValue("SITES_GATEWAY_IPV4_TARGETS")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (expectedAddresses.length === 0) {
      return { ready: false, mode: null };
    }
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      {
        headers: { Accept: "application/dns-json" },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      Answer?: Array<{ type?: number; data?: string }>;
    };
    const addresses = (payload.Answer ?? [])
      .filter((answer) => answer.type === 1)
      .map((answer) => String(answer.data ?? "").trim())
      .filter(Boolean);
    return {
      ready:
        response.ok &&
        expectedAddresses.every((address) => addresses.includes(address)),
      mode: null,
    };
  } catch {
    return { ready: false, mode: null };
  }
}

async function credentialStatus() {
  const approvedMembers = await getD1()
    .prepare(
      `SELECT member.id,
              member.email,
              member.display_name,
              COALESCE(member.job_title, '') AS job_title,
              CASE WHEN credential.member_id IS NULL THEN 0 ELSE 1 END AS has_credential
       FROM members member
       LEFT JOIN member_credentials credential ON credential.member_id = member.id
       WHERE member.status = 'approved'
         AND LOWER(member.email) NOT LIKE '%-noreply@chatgpt.com'
         AND LOWER(member.email) NOT LIKE 'sites-%'
         AND LOWER(member.display_name) NOT LIKE '%screenshot service%'
         AND LOWER(member.display_name) NOT LIKE '%system service%'
       ORDER BY member.id ASC`,
    )
    .all<{
      id: number;
      email: string;
      display_name: string;
      job_title: string;
      has_credential: number;
    }>();
  const rows = approvedMembers.results ?? [];
  const missingMembers = rows
    .filter((member) => !Number(member.has_credential))
    .map((member) => ({
      id: Number(member.id),
      email: String(member.email ?? ""),
      displayName: String(member.display_name ?? ""),
      jobTitle: String(member.job_title ?? ""),
    }));
  return {
    total: rows.length,
    local: rows.length - missingMembers.length,
    missing: missingMembers.length,
    missingMembers,
    ready: rows.length > 0 && missingMembers.length === 0,
  };
}

async function readiness() {
  const [state, schedule, credentials, gateway] = await Promise.all([
    getReplicationSyncState(),
    getStandbyScheduleStatus(),
    credentialStatus(),
    gatewayStatus(),
  ]);
  const drive = driveStatus();
  const standbyPrimary = state?.operating_mode === "primary";
  const syncReady =
    state?.status === "succeeded" &&
    Boolean(state.source_checksum) &&
    Boolean(state.last_success_at);
  const blockers: string[] = [];
  if (!gateway.ready) {
    blockers.push("whizzup.kr이 아직 Sites 전환 관문을 통과하지 않습니다.");
  }
  if (!drive.ready) {
    blockers.push("Google Drive 동일 폴더 연결 정보가 완성되지 않았습니다.");
  }
  if (!syncReady && !standbyPrimary) {
    blockers.push("Sites 원본 DB의 최종 동기화 성공 기록이 없습니다.");
  }

  return {
    mode: standbyPrimary ? "sites" : "vercel",
    transition: state?.status === "syncing",
    ready: blockers.length === 0,
    blockers,
    sync: state,
    schedule,
    credentials,
    drive,
    gateway,
    automaticSyncEnabled:
      serverValue("AUTOMATIC_STANDBY_SYNC_ENABLED").toLowerCase() === "true",
    sitesOrigin: sitesOrigin(),
    publicOrigin: publicOrigin(),
    vercelOrigin: vercelOrigin(),
    confirmations: {
      activate: ACTIVATE_CONFIRMATION,
      failback: FAILBACK_CONFIRMATION,
    },
  };
}

async function finalForwardSync(syncSecret: string) {
  const response = await fetch(`${sitesOrigin()}/api/standby-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${syncSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ force: true, cutover: true }),
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.error || `최종 동기화가 ${response.status} 상태로 실패했습니다.`,
    );
  }

  const state = await getReplicationSyncState();
  const localChecksum = await replicaContentChecksum(await createFullBackup());
  if (
    state?.status !== "syncing" ||
    !state.source_checksum ||
    localChecksum !== state.source_checksum
  ) {
    throw new Error("최종 동기화 뒤 DB 체크섬이 일치하지 않습니다.");
  }
}

async function reverseSyncToVercel(actorId: number, syncSecret: string) {
  const startedAt = Date.now();
  const sourceOrigin = sitesOrigin();
  await markReplicationAttempt(sourceOrigin);
  try {
    const [backup, memberCredentials] = await Promise.all([
      createFullBackup(),
      createStandbyCredentialSnapshot(),
    ]);
    const contentChecksum = await replicaContentChecksum(backup);
    const body = JSON.stringify({ ...backup, memberCredentials });
    const uncompressed = new TextEncoder().encode(body);
    if (uncompressed.byteLength > MAX_REVERSE_SYNC_BYTES) {
      throw new Error("대기판 DB가 Vercel 복귀 전송 허용 크기를 초과했습니다.");
    }
    const compressed = gzipSync(uncompressed, { level: 9 });
    if (compressed.byteLength > MAX_REVERSE_SYNC_COMPRESSED_BYTES) {
      throw new Error("압축한 대기판 DB가 Vercel 요청 허용 크기를 초과했습니다.");
    }
    const compressedBody = compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength,
    );

    const response = await fetch(`${vercelOrigin()}/api/standby-failback`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${syncSecret}`,
        "Content-Type": "application/octet-stream",
        "X-WHIZZUP-Content-Encoding": "gzip",
      },
      body: compressedBody,
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      checksum?: string;
    };
    if (!response.ok || payload.checksum !== contentChecksum) {
      throw new Error(
        payload.error || "Vercel 복귀 뒤 DB 체크섬이 일치하지 않습니다.",
      );
    }

    await markReplicationSuccess({
      sourceOrigin: vercelOrigin(),
      sourceCreatedAt: backup.createdAt,
      sourceChecksum: contentChecksum,
      sourceCountsJson: JSON.stringify(backup.counts),
      durationMs: Date.now() - startedAt,
      keepLocked: true,
    });
    await markStandbyReplicaMode(actorId);
    try {
      await configureStandbySchedule({
        syncUrl: `${sitesOrigin()}/api/standby-sync`,
        syncSecret,
      });
    } catch (error) {
      await markStandbyPrimaryMode(actorId);
      throw error;
    }
  } catch (error) {
    await markReplicationFailure({
      sourceOrigin,
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : "Unknown failback error",
    }).catch(() => undefined);
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    await requireCutoverAccess(request);
    return Response.json(
      { ok: true, readiness: await readiness() },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actorId = await cutoverActorId(request);
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      confirmation?: unknown;
    };
    const action = String(body.action ?? "activate-sites") as CutoverAction;
    const expectedConfirmation =
      action === "return-vercel"
        ? FAILBACK_CONFIRMATION
        : ACTIVATE_CONFIRMATION;
    if (String(body.confirmation ?? "").trim() !== expectedConfirmation) {
      return Response.json(
        { error: `확인 문구 '${expectedConfirmation}'을 정확히 입력해 주세요.` },
        { status: 400 },
      );
    }

    const before = await readiness();
    if (!before.gateway.ready) {
      return Response.json(
        { error: "전환 관문 연결이 확인되지 않았습니다.", blockers: before.blockers },
        { status: 409 },
      );
    }

    const syncSecret =
      serverValue("CUTOVER_API_SECRET") ||
      serverValue("STANDBY_SYNC_SECRET") ||
      serverValue("STANDBY_EXPORT_SECRET");
    if (!syncSecret) {
      return Response.json({ error: "전환용 서버 비밀키가 없습니다." }, { status: 500 });
    }

    if (action === "return-vercel") {
      if (before.mode === "vercel") {
        return Response.json({ ok: true, changed: false, readiness: before });
      }
      await reverseSyncToVercel(actorId, syncSecret);
    } else {
      if (before.mode === "sites") {
        return Response.json({ ok: true, changed: false, readiness: before });
      }
      const hardBlockers = before.blockers.filter(
        (message) => !message.includes("최종 동기화 성공 기록"),
      );
      if (hardBlockers.length > 0) {
        return Response.json(
          { error: "비상 전환 준비가 완료되지 않았습니다.", blockers: hardBlockers },
          { status: 409 },
        );
      }
      await removeStandbySchedule();
      try {
        await finalForwardSync(syncSecret);
        await markStandbyPrimaryMode(actorId);
      } catch (error) {
        await markReplicationFailure({
          sourceOrigin: publicOrigin(),
          durationMs: 0,
          errorMessage:
            error instanceof Error ? error.message : "Unknown cutover error",
        }).catch(() => undefined);
        await configureStandbySchedule({
          syncUrl: `${sitesOrigin()}/api/standby-sync`,
          syncSecret,
        }).catch(() => undefined);
        throw error;
      }
    }

    return Response.json({
      ok: true,
      changed: true,
      readiness: await readiness(),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
