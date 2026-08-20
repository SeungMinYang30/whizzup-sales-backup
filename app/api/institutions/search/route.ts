import { accessErrorResponse, requireApprovedMember } from "../../../../lib/collaboration";
import { ensureRecordsReady } from "../../../../lib/records-store";
import {
  backfillInstitutionRegistryFromRecordTrash,
  ensureTrashReady,
} from "../../../../lib/trash-store";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const d1 = await ensureRecordsReady();
    await ensureTrashReady();
    await backfillInstitutionRegistryFromRecordTrash(d1);
    const query = clean(new URL(request.url).searchParams.get("q")).slice(0, 80);
    if (query.length < 2) return Response.json({ institutions: [] });
    const like = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
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
       SELECT COALESCE(a.id, 0) AS id,
              registry.organization AS organization,
              COALESCE(a.business_round, 1) AS business_round,
              COALESCE(NULLIF(a.region, ''), registry.region, '') AS region,
              COALESCE(NULLIF(a.award_status, ''), '미정') AS award_status,
              COALESCE(NULLIF(a.award_stage, ''), '미정') AS award_stage,
              COALESCE(a.progress_manager, '') AS progress_manager,
              COALESCE(a.contact_name, '') AS contact_name,
              COALESCE(a.contact_phone, '') AS contact_phone,
              COALESCE(a.contact_email, '') AS contact_email
       FROM institution_registry registry
       LEFT JOIN ranked a
         ON a.organization = registry.organization
        AND a.row_number = 1
       WHERE (
           registry.organization LIKE ? ESCAPE '\\' COLLATE NOCASE OR
           COALESCE(NULLIF(a.region, ''), registry.region, '') LIKE ? ESCAPE '\\' COLLATE NOCASE OR
           COALESCE(a.progress_manager, '') LIKE ? ESCAPE '\\' COLLATE NOCASE OR
           COALESCE(a.contact_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE OR
           COALESCE(a.contact_phone, '') LIKE ? ESCAPE '\\' COLLATE NOCASE OR
           COALESCE(a.contact_email, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
         )
       ORDER BY CASE WHEN registry.organization LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 0 ELSE 1 END,
                registry.organization COLLATE NOCASE ASC,
                COALESCE(a.business_round, 1) DESC
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
