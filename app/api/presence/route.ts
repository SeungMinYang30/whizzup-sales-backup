import {
  accessErrorResponse,
  ensureCollaborationReady,
  requireApprovedMember,
  requirePrimaryOwner,
} from "../../../lib/collaboration";

export const dynamic = "force-dynamic";

const allowedPresenceViews = new Set([
  "dashboard",
  "budget-institutions",
  "records",
  "followup",
  "schedules",
  "organizations",
  "awards",
  "vendors",
  "products",
  "map",
  "lounge",
  "team",
  "trash",
  "backup",
  "accounting",
  "analytics",
  "inventory",
  "integration",
]);

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = await request.json().catch(() => ({})) as { view?: unknown };
    const requestedView = String(payload.view ?? "");
    const currentView = allowedPresenceViews.has(requestedView)
      ? requestedView
      : "";
    const d1 = await ensureCollaborationReady();
    await d1
      .prepare(
        `UPDATE members
         SET last_seen_at = CURRENT_TIMESTAMP, current_view = ?
         WHERE id = ?`,
      )
      .bind(currentView, member.id)
      .run();
    return Response.json({ ok: true, serverTime: new Date().toISOString() });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function GET() {
  try {
    await requirePrimaryOwner();
    const d1 = await ensureCollaborationReady();
    const result = await d1
      .prepare(
        `SELECT
           id,
           last_seen_at,
           current_view,
           CASE
             WHEN datetime(last_seen_at) >= datetime('now', '-35 seconds') THEN 1
             ELSE 0
           END AS is_online
         FROM members
         WHERE status = 'approved'
         ORDER BY display_name COLLATE NOCASE, id`,
      )
      .all();
    return Response.json({
      members: result.results,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
