import {
  createFullBackup,
  replicaContentChecksum,
  restoreReplicaBackup,
  validateFullBackup,
  type FullBackup,
} from "../../../lib/backup-store";
import {
  getReplicationSyncState,
  isVercelPrimaryMode,
  markReplicationAttempt,
  markReplicationFailure,
  markReplicationSuccess,
} from "../../../lib/replication-store";
import {
  configureStandbySchedule,
  removeStandbySchedule,
} from "../../../lib/replication-scheduler";
import {
  restoreStandbyCredentials,
  validateStandbyCredentialSnapshot,
} from "../../../lib/standby-credentials";

export const dynamic = "force-dynamic";

const DEFAULT_PRIMARY_ORIGIN = "https://whizzup.kr";
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;

type StandbyBackupEnvelope = FullBackup & {
  memberCredentials?: unknown;
};

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

function authorized(request: Request) {
  const secret = serverValue("STANDBY_SYNC_SECRET");
  const authorization = request.headers.get("authorization") ?? "";
  return Boolean(secret) && secureEqual(authorization, `Bearer ${secret}`);
}

function primaryOrigin() {
  const configured = serverValue("PRIMARY_SITE_ORIGIN") || DEFAULT_PRIMARY_ORIGIN;
  return configured.replace(/\/+$/, "");
}

function standbyOrigin() {
  return (
    serverValue("APP_ORIGIN") ||
    "https://whizzup-sales-hub.vercel.app"
  ).replace(/\/+$/, "");
}

function automaticSyncEnabled() {
  return serverValue("AUTOMATIC_STANDBY_SYNC_ENABLED").toLowerCase() === "true";
}

async function fetchPrimaryBackup(origin: string) {
  const exportSecret = serverValue("PRIMARY_EXPORT_SECRET");
  if (!exportSecret) {
    throw new Error("PRIMARY_EXPORT_SECRET is not configured");
  }

  const response = await fetch(`${origin}/api/standby-export`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${exportSecret}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Primary export returned ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BACKUP_BYTES) {
    throw new Error("Primary backup is larger than the allowed sync size");
  }

  return JSON.parse(new TextDecoder().decode(bytes)) as StandbyBackupEnvelope;
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Unknown replication error";
}

async function forceRequested(request: Request) {
  try {
    const body = (await request.json()) as { force?: unknown };
    return body?.force === true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(
    { ok: true, state: await getReplicationSyncState() },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!automaticSyncEnabled()) {
    return Response.json(
      {
        ok: false,
        disabled: true,
        error: "Automatic full-database synchronization is disabled",
      },
      { status: 409 },
    );
  }
  if (await isVercelPrimaryMode()) {
    return Response.json(
      {
        ok: false,
        cutoverComplete: true,
        error: "Vercel is already the primary system; replica overwrite is blocked",
      },
      { status: 409 },
    );
  }

  const force = await forceRequested(request);
  const startedAt = Date.now();
  const sourceOrigin = primaryOrigin();
  try {
    await markReplicationAttempt(sourceOrigin);
    const backup = await fetchPrimaryBackup(sourceOrigin);
    const { inspection: sourceInspection } = await validateFullBackup(backup);
    // Keep ordinary business-data replication running while an older Sites
    // deployment is still being upgraded. Credential replication starts as
    // soon as the primary includes the separately checksummed envelope.
    const credentialSnapshot =
      backup.memberCredentials === undefined
        ? null
        : validateStandbyCredentialSnapshot(backup.memberCredentials);
    const contentChecksum = await replicaContentChecksum(backup);
    const current = await getReplicationSyncState();

    if (
      current?.status !== "failed" &&
      current?.source_checksum === contentChecksum
    ) {
      const credentials = credentialSnapshot
        ? await restoreStandbyCredentials(credentialSnapshot)
        : null;
      await markReplicationSuccess({
        sourceOrigin,
        sourceCreatedAt: sourceInspection.createdAt,
        sourceChecksum: contentChecksum,
        sourceCountsJson: JSON.stringify(sourceInspection.counts),
        durationMs: Date.now() - startedAt,
      });
      return Response.json({
        ok: true,
        changed: false,
        checksum: contentChecksum,
        createdAt: sourceInspection.createdAt,
        credentials,
      });
    }

    if (current?.source_checksum && !force) {
      const localBackup = await createFullBackup();
      const localChecksum = await replicaContentChecksum(localBackup);
      if (localChecksum !== current.source_checksum) {
        const durationMs = Date.now() - startedAt;
        const errorMessage =
          "Replica has independent local changes; automatic overwrite was blocked";
        await markReplicationFailure({
          sourceOrigin,
          durationMs,
          errorMessage,
        });
        return Response.json(
          {
            ok: false,
            conflict: true,
            error: errorMessage,
            sourceChecksum: contentChecksum,
            localChecksum,
          },
          { status: 409 },
        );
      }
    }

    const inspection = await restoreReplicaBackup(backup);
    const credentials = credentialSnapshot
      ? await restoreStandbyCredentials(credentialSnapshot)
      : null;
    const durationMs = Date.now() - startedAt;
    await markReplicationSuccess({
      sourceOrigin,
      sourceCreatedAt: inspection.createdAt,
      sourceChecksum: contentChecksum,
      sourceCountsJson: JSON.stringify(inspection.counts),
      durationMs,
    });
    return Response.json({
      ok: true,
      changed: true,
      checksum: contentChecksum,
      createdAt: inspection.createdAt,
      totalRows: inspection.totalRows,
      counts: inspection.counts,
      credentials,
      durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = safeErrorMessage(error);
    try {
      await markReplicationFailure({
        sourceOrigin,
        durationMs,
        errorMessage: message,
      });
    } catch (stateError) {
      console.error("Could not record standby sync failure", stateError);
    }
    console.error("Standby sync failed", error);
    return Response.json(
      { ok: false, error: "Standby synchronization failed" },
      { status: 502 },
    );
  }
}

export async function PUT(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!automaticSyncEnabled()) {
    return Response.json(
      {
        ok: false,
        disabled: true,
        error: "Set AUTOMATIC_STANDBY_SYNC_ENABLED=true before scheduling",
      },
      { status: 409 },
    );
  }
  if (await isVercelPrimaryMode()) {
    return Response.json(
      {
        ok: false,
        cutoverComplete: true,
        error: "Vercel is already the primary system; scheduling is blocked",
      },
      { status: 409 },
    );
  }

  const syncSecret = serverValue("STANDBY_SYNC_SECRET");
  const schedule = await configureStandbySchedule({
    syncUrl: `${standbyOrigin()}/api/standby-sync`,
    syncSecret,
  });
  return Response.json({ ok: true, schedule });
}

export async function DELETE(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({
    ok: true,
    schedule: await removeStandbySchedule(),
  });
}
