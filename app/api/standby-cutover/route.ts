import {
  accessErrorResponse,
  requirePrimaryOwner,
} from "../../../lib/collaboration";
import { createFullBackup, replicaContentChecksum } from "../../../lib/backup-store";
import { getD1 } from "../../../db";
import {
  getStandbyScheduleStatus,
  configureStandbySchedule,
  removeStandbySchedule,
} from "../../../lib/replication-scheduler";
import {
  getReplicationSyncState,
  markVercelPrimaryMode,
} from "../../../lib/replication-store";

export const dynamic = "force-dynamic";

const CONFIRMATION = "VERCEL 운영 전환";

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

function authorizedBySyncSecret(request: Request) {
  const secret = serverValue("STANDBY_SYNC_SECRET");
  const authorization = request.headers.get("authorization") ?? "";
  return Boolean(secret) && secureEqual(authorization, `Bearer ${secret}`);
}

async function cutoverActorId(request: Request) {
  if (!authorizedBySyncSecret(request)) {
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
  if (!owner?.id) throw new Error("Vercel 운영 전환을 기록할 운영자 계정이 없습니다.");
  return Number(owner.id);
}

function standbyOrigin() {
  return (
    serverValue("APP_ORIGIN") || "https://whizzup-sales-hub.vercel.app"
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

async function credentialStatus() {
  const d1 = getD1();
  const approved = await d1
    .prepare("SELECT COUNT(*)::integer AS count FROM members WHERE status = 'approved'")
    .first<{ count: number }>();
  const credentials = await d1
    .prepare(
      `SELECT COUNT(*)::integer AS count
       FROM member_credentials credential
       JOIN members member ON member.id = credential.member_id
       WHERE member.status = 'approved'`,
    )
    .first<{ count: number }>();
  const total = Number(approved?.count ?? 0);
  const local = Number(credentials?.count ?? 0);
  return { total, local, missing: Math.max(0, total - local), ready: total > 0 && local >= total };
}

async function readiness() {
  const [state, schedule, credentials] = await Promise.all([
    getReplicationSyncState(),
    getStandbyScheduleStatus(),
    credentialStatus(),
  ]);
  const drive = driveStatus();
  const primary = state?.operating_mode === "primary";
  const syncReady =
    state?.status === "succeeded" && Boolean(state.source_checksum) && Boolean(state.last_success_at);
  const blockers: string[] = [];
  if (!drive.ready) blockers.push("Google Drive 동일 폴더 연결 정보가 완성되지 않았습니다.");
  if (!credentials.ready) blockers.push(`승인 구성원 ${credentials.missing}명의 Vercel 로그인 비밀번호가 아직 없습니다.`);
  if (!syncReady && !primary) blockers.push("Sites 원본 DB의 최종 동기화 성공 기록이 없습니다.");

  return {
    mode: primary ? "primary" : "replica",
    ready: primary || blockers.length === 0,
    blockers,
    sync: state,
    schedule,
    credentials,
    drive,
    automaticSyncEnabled:
      serverValue("AUTOMATIC_STANDBY_SYNC_ENABLED").toLowerCase() === "true",
    currentOrigin: standbyOrigin(),
    primaryOrigin: serverValue("PRIMARY_SITE_ORIGIN") || "https://whizzup.kr",
    confirmation: CONFIRMATION,
  };
}

export async function GET() {
  try {
    await requirePrimaryOwner();
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
      confirmation?: unknown;
    };
    if (String(body.confirmation ?? "").trim() !== CONFIRMATION) {
      return Response.json(
        { error: `확인 문구 '${CONFIRMATION}'을 정확히 입력해 주세요.` },
        { status: 400 },
      );
    }

    const before = await readiness();
    if (before.mode === "primary") {
      return Response.json({ ok: true, changed: false, readiness: before });
    }
    const hardBlockers = before.blockers.filter(
      (message) => !message.includes("최종 동기화 성공 기록"),
    );
    if (hardBlockers.length > 0) {
      return Response.json(
        { error: "이전 준비가 완료되지 않았습니다.", blockers: hardBlockers },
        { status: 409 },
      );
    }

    const syncSecret = serverValue("STANDBY_SYNC_SECRET");
    if (!syncSecret) {
      return Response.json({ error: "STANDBY_SYNC_SECRET이 없습니다." }, { status: 500 });
    }

    await removeStandbySchedule();
    try {
      const response = await fetch(`${standbyOrigin()}/api/standby-sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${syncSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ force: true }),
        cache: "no-store",
        signal: AbortSignal.timeout(90_000),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || `최종 동기화가 ${response.status} 상태로 실패했습니다.`);
      }

      const state = await getReplicationSyncState();
      const localChecksum = await replicaContentChecksum(await createFullBackup());
      if (
        state?.status !== "succeeded" ||
        !state.source_checksum ||
        localChecksum !== state.source_checksum
      ) {
        throw new Error("최종 동기화 뒤 DB 체크섬이 일치하지 않습니다.");
      }

      await markVercelPrimaryMode(actorId);
    } catch (error) {
      await configureStandbySchedule({
        syncUrl: `${standbyOrigin()}/api/standby-sync`,
        syncSecret,
      }).catch(() => undefined);
      throw error;
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
