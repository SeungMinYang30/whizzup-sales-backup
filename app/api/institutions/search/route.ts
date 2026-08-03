import { accessErrorResponse, requireApprovedMember } from "../../../../lib/collaboration";
import { getD1 } from "../../../../db";
import { ensureRecordsReady } from "../../../../lib/records-store";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    await ensureRecordsReady();
    const query = clean(new URL(request.url).searchParams.get("q")).slice(0, 80);
    if (query.length < 2) return Response.json({ institutions: [] });
    const like = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const d1 = getD1();
    const result = await d1.prepare(
      `WITH ranked AS (
         SELECT a.*,
           ROW_NUMBER() OVER (
             PARTITION BY a.organization, a.business_round
             ORDER BY a.activity_date DESC, a.id DESC
           ) AS row_number
         FROM activities a
         WHERE TRIM(COALESCE(a.organization, '')) <> ''
       )
       SELECT id, organization, business_round, region, award_status, award_stage,
              progress_manager, contact_name, contact_phone, contact_email
       FROM ranked
       WHERE row_number = 1
         AND (
           organization LIKE ? ESCAPE '\\' COLLATE NOCASE OR
           region LIKE ? ESCAPE '\\' COLLATE NOCASE OR
           progress_manager LIKE ? ESCAPE '\\' COLLATE NOCASE OR
           contact_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR
           contact_phone LIKE ? ESCAPE '\\' COLLATE NOCASE OR
           contact_email LIKE ? ESCAPE '\\' COLLATE NOCASE
         )
       ORDER BY CASE WHEN organization LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 0 ELSE 1 END,
                organization COLLATE NOCASE ASC, business_round DESC
       LIMIT 30`,
    ).bind(like, like, like, like, like, like, `${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`)
      .all<Record<string, unknown>>();
    return Response.json({
      institutions: result.results.map((row) => ({
        id: Number(row.id),
        organization: String(row.organization ?? ""),
        businessRound: Math.max(1, Number(row.business_round) || 1),
        region: String(row.region ?? ""),
        awardStatus: String(row.award_status ?? "미정"),
        awardStage: String(row.award_stage ?? "미정"),
        progressManager: String(row.progress_manager ?? ""),
        contactName: String(row.contact_name ?? ""),
        contactPhone: String(row.contact_phone ?? ""),
        contactEmail: String(row.contact_email ?? ""),
      })),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
