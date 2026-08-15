import {
  accessErrorResponse,
  requirePrimaryOwner,
} from "../../../lib/collaboration";
import {
  configureStandbySchedule,
  getStoredStandbySyncSecret,
  getStandbyScheduleStatus,
  removeStandbySchedule,
} from "../../../lib/replication-scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_STANDBY_ORIGIN =
  "https://whizzup-sales-hub.jackallan.chatgpt.site";

function serverValue(name: string) {
  return String(process.env[name] ?? "").trim();
}

async function syncSecret(request?: Request) {
  const body = request
    ? ((await request.json().catch(() => null)) as {
        syncSecret?: unknown;
        force?: unknown;
      } | null)
    : null;
  const requested =
    typeof body?.syncSecret === "string" ? body.syncSecret.trim() : "";
  if (requested && requested.length < 32) {
    throw new Error("대기판 연결키는 32자 이상이어야 합니다.");
  }
  const secret =
    requested ||
    (await getStoredStandbySyncSecret()) ||
    serverValue("STANDBY_SYNC_SECRET") || serverValue("STANDBY_EXPORT_SECRET");
  if (!secret) {
    throw new Error("Standby replication secret is not configured");
  }
  return { secret, force: body?.force === true };
}

function standbyOrigin() {
  return (serverValue("STANDBY_SITE_ORIGIN") || DEFAULT_STANDBY_ORIGIN).replace(
    /\/+$/,
    "",
  );
}

export async function GET() {
  try {
    await requirePrimaryOwner();
    return Response.json({
      ok: true,
      origin: standbyOrigin(),
      schedule: await getStandbyScheduleStatus(),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePrimaryOwner();
    const origin = standbyOrigin();
    const { secret, force } = await syncSecret(request);
    const schedule = await configureStandbySchedule({
      syncUrl: `${origin}/api/standby-sync`,
      syncSecret: secret,
    });
    const syncResponse = await fetch(`${origin}/api/standby-sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ force }),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const sync = (await syncResponse.json().catch(() => null)) as
      | { error?: string; [key: string]: unknown }
      | null;
    if (!syncResponse.ok) {
      return Response.json(
        {
          ok: false,
          origin,
          schedule,
          sync,
          error:
            sync?.error ||
            `대기판 즉시 동기화가 HTTP ${syncResponse.status}로 실패했습니다.`,
        },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, origin, schedule, sync });
  } catch (error) {
    if (error instanceof Error && /not configured/i.test(error.message)) {
      return Response.json({ ok: false, error: error.message }, { status: 503 });
    }
    return accessErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    await requirePrimaryOwner();
    return Response.json({ ok: true, schedule: await removeStandbySchedule() });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
