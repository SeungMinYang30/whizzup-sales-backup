import {
  BackupValidationError,
  createFullBackup,
  replicaContentChecksum,
  restoreReplicaBackup,
  type FullBackup,
} from "../../../lib/backup-store";
import { archivePreFailbackBackup } from "../../../lib/continuity-backup";
import {
  restoreStandbyCredentials,
  validateStandbyCredentialSnapshot,
} from "../../../lib/standby-credentials";
import { getStoredStandbySyncSecret } from "../../../lib/replication-scheduler";
import { gunzipSync } from "node:zlib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;

type FailbackEnvelope = FullBackup & { memberCredentials?: unknown };

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

async function authorized(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return [
    await getStoredStandbySyncSecret(),
    serverValue("STANDBY_SYNC_SECRET"),
    serverValue("STANDBY_EXPORT_SECRET"),
    serverValue("CUTOVER_API_SECRET"),
  ].some(
    (secret) =>
      Boolean(secret) && secureEqual(authorization, `Bearer ${secret}`),
  );
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_REQUEST_BYTES) {
      return Response.json({ error: "Failback backup is too large" }, { status: 413 });
    }
    const decoded =
      request.headers.get("x-whizzup-content-encoding") === "gzip"
        ? gunzipSync(bytes)
        : bytes;
    if (decoded.byteLength > MAX_UNCOMPRESSED_BYTES) {
      return Response.json({ error: "Failback backup expands beyond the limit" }, { status: 413 });
    }
    const payload = JSON.parse(new TextDecoder().decode(decoded)) as FailbackEnvelope;
    const credentials = validateStandbyCredentialSnapshot(
      payload.memberCredentials,
    );

    const safetyBackup = await archivePreFailbackBackup();
    const inspection = await restoreReplicaBackup(payload);
    const restoredCredentials = credentials
      ? await restoreStandbyCredentials(credentials)
      : null;
    const checksum = await replicaContentChecksum(await createFullBackup());
    const sourceChecksum = await replicaContentChecksum(payload);
    if (checksum !== sourceChecksum) {
      throw new Error("복귀 복원 뒤 운영 DB 체크섬이 대기판과 일치하지 않습니다.");
    }

    return Response.json({
      ok: true,
      checksum,
      createdAt: inspection.createdAt,
      totalRows: inspection.totalRows,
      counts: inspection.counts,
      credentials: restoredCredentials,
      safetyBackup,
    });
  } catch (error) {
    console.error("Standby failback restore failed", error);
    return Response.json(
      {
        error:
          error instanceof BackupValidationError
            ? error.message
            : "대기판 DB를 Vercel 운영 DB로 복원하지 못했습니다.",
      },
      { status: error instanceof BackupValidationError ? 400 : 500 },
    );
  }
}
