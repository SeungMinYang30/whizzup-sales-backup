import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import { ensureRecordsReady } from "../../../lib/records-store";

export async function GET() {
  try {
    await requireApprovedMember();
    const d1 = await ensureRecordsReady();
    const result = await d1
      .prepare(`
        SELECT
          organization,
          region,
          created_by_name AS "createdByName",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM institution_registry
        WHERE TRIM(COALESCE(organization, '')) <> ''
        ORDER BY organization
      `)
      .all<Record<string, unknown>>();
    return Response.json({ institutions: result.results ?? [] });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
