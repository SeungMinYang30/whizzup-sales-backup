import {
  accessErrorResponse,
  requirePrimaryOwner,
} from "../../../lib/collaboration";
import {
  configureStandbySchedule,
  getStandbyScheduleStatus,
  removeStandbySchedule,
} from "../../../lib/replication-scheduler";

export const dynamic = "force-dynamic";

const DEFAULT_STANDBY_ORIGIN =
  "https://whizzup-sales-hub.jackallan.chatgpt.site";

function serverValue(name: string) {
  return String(process.env[name] ?? "").trim();
}

function syncSecret() {
  const secret =
    serverValue("STANDBY_SYNC_SECRET") || serverValue("STANDBY_EXPORT_SECRET");
  if (!secret) {
    throw new Error("Standby replication secret is not configured");
  }
  return secret;
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

export async function POST() {
  try {
    await requirePrimaryOwner();
    const origin = standbyOrigin();
    const schedule = await configureStandbySchedule({
      syncUrl: `${origin}/api/standby-sync`,
      syncSecret: syncSecret(),
    });
    return Response.json({ ok: true, origin, schedule });
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
