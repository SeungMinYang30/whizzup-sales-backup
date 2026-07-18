import {
  accessErrorResponse,
  requireApprovedMember,
  requireMemberPermission,
} from "../../../lib/collaboration";
import {
  clean,
  ensureRecordsReady,
  insertActivity,
  resolveAward,
  resolveAwardManagement,
  serializeProgressSchedule,
} from "../../../lib/records-store";
import { ensureCampaignsReady } from "../../../lib/campaign-store";
import { ensureEquipmentReady } from "../../../lib/equipment-store";
import {
  ensureMapReady,
  resolveMappedRegion,
} from "../../../lib/map-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApprovedMember();
    const d1 = await ensureRecordsReady();
    const result = await d1
      .prepare(`
        SELECT
          a.*,
          COALESCE(aa.created_by_name, '가져온 기록') AS created_by_name
        FROM activities a
        LEFT JOIN activity_authors aa ON aa.activity_id = a.id
        ORDER BY
          CASE WHEN a.follow_up_required = true THEN 0 ELSE 1 END,
          CASE WHEN a.follow_up_date IS NULL OR a.follow_up_date = '' THEN 1 ELSE 0 END,
          a.follow_up_date ASC,
          a.activity_date DESC,
          a.id DESC
        LIMIT 500
      `)
      .all();
    return Response.json({ records: result.results });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const record = await insertActivity(payload, member, "직접 입력");
    return Response.json({ record }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("필수")) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id < 1) {
      return Response.json(
        { error: "올바른 기록 ID가 필요합니다." },
        { status: 400 },
      );
    }

    const organization = clean(payload.organization);
    const activityType = clean(payload.activityType);
    if (!organization || !activityType) {
      return Response.json(
        { error: "기관명과 활동유형은 필수입니다." },
        { status: 400 },
      );
    }
    const award = resolveAward(payload);
    const awardManagement = resolveAwardManagement(payload);
    const region = await resolveMappedRegion(
      organization,
      clean(payload.region),
    );

    const d1 = await ensureRecordsReady();
    const previous = await d1
      .prepare("SELECT organization FROM activities WHERE id = ?")
      .bind(id)
      .first<{ organization: string }>();
    const result = await d1
      .prepare(`
        UPDATE activities SET
          activity_date = ?, date_confidence = ?, activity_type = ?, category = ?,
          contact_method = ?, region = ?, organization = ?, budget_type = ?,
          budget_amount = ?, topic = ?, summary = ?, status = ?, temperature = ?,
          award_status = ?, award_company = ?, execution_type = ?,
          consortium_company = ?, award_stage = ?, progress_manager = ?, follow_up_required = ?,
          follow_up_date = ?, next_action = ?, progress_schedule = ?, contact_name = ?, contact_phone = ?,
          contact_email = ?, source_chat = ?, notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        RETURNING *
      `)
      .bind(
        clean(payload.activityDate) || null,
        clean(payload.dateConfidence) || "확정",
        activityType,
        clean(payload.category) || "기타",
        clean(payload.contactMethod),
        region,
        organization,
        clean(payload.budgetType),
        clean(payload.budgetAmount),
        clean(payload.topic),
        clean(payload.summary),
        clean(payload.status) || "진행 중",
        clean(payload.temperature) || "중간",
        award.awardStatus,
        award.awardCompany,
        awardManagement.executionType,
        awardManagement.consortiumCompany,
        awardManagement.awardStage,
        clean(payload.progressManager),
        payload.followUpRequired !== false,
        clean(payload.followUpDate) || null,
        clean(payload.nextAction),
        serializeProgressSchedule(payload.progressSchedule),
        clean(payload.contactName),
        clean(payload.contactPhone),
        clean(payload.contactEmail),
        clean(payload.sourceChat) || "직접 입력",
        clean(payload.notes),
        id,
      )
      .first();
    if (previous?.organization && previous.organization !== organization) {
      await ensureMapReady();
      await ensureCampaignsReady();
      await ensureEquipmentReady();
      const oldOrganizationStillExists = await d1
        .prepare(
          "SELECT 1 AS found FROM activities WHERE organization = ? LIMIT 1",
        )
        .bind(previous.organization)
        .first();
      if (!oldOrganizationStillExists) {
        await d1.batch([
          d1
            .prepare(
              `DELETE FROM organization_locations
               WHERE organization = ?
                 AND EXISTS (
                   SELECT 1 FROM organization_locations WHERE organization = ?
                 )`,
            )
            .bind(previous.organization, organization),
          d1
            .prepare(
              `UPDATE organization_locations
               SET organization = ?, region = ?, updated_at = CURRENT_TIMESTAMP
               WHERE organization = ?
                 AND NOT EXISTS (
                   SELECT 1 FROM organization_locations WHERE organization = ?
                 )`,
            )
            .bind(
              organization,
              region.slice(0, 120),
              previous.organization,
              organization,
            ),
          d1
            .prepare(
              `DELETE FROM sales_campaign_targets
               WHERE organization = ?
                 AND campaign_id IN (
                   SELECT campaign_id
                   FROM sales_campaign_targets
                   WHERE organization = ?
                 )`,
            )
            .bind(previous.organization, organization),
          d1
            .prepare(
              `UPDATE sales_campaign_targets
               SET organization = ?, region = ?, updated_at = CURRENT_TIMESTAMP
               WHERE organization = ?`,
            )
            .bind(
              organization,
              region.slice(0, 120),
              previous.organization,
            ),
          d1
            .prepare(
              `UPDATE equipment_projects
               SET organization = ?, updated_at = CURRENT_TIMESTAMP
               WHERE organization = ?`,
            )
            .bind(organization, previous.organization),
        ]);
      }
    }
    return Response.json({ record: result });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireMemberPermission("records:manage");
    const payload = (await request.json()) as {
      id?: number;
      ids?: unknown[];
      organizations?: unknown[];
    };
    const rawIds = Array.isArray(payload.ids)
      ? payload.ids
      : payload.id === undefined
        ? []
        : [payload.id];
    const ids = [
      ...new Set(
        rawIds
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    const organizations = [
      ...new Set(
        (Array.isArray(payload.organizations) ? payload.organizations : [])
          .map(clean)
          .filter((organization) => organization.length > 0 && organization.length <= 120),
      ),
    ];
    if (
      (!ids.length && !organizations.length) ||
      (ids.length > 0 && organizations.length > 0) ||
      ids.length > 100 ||
      organizations.length > 500
    ) {
      return Response.json(
        { error: "삭제할 기록 또는 기관을 올바르게 선택해 주세요." },
        { status: 400 },
      );
    }
    const d1 = await ensureRecordsReady();
    await ensureMapReady();
    await ensureCampaignsReady();
    await ensureEquipmentReady();
    const selected = ids.length ? ids : organizations;
    const chunks = Array.from(
      { length: Math.ceil(selected.length / 50) },
      (_, index) => selected.slice(index * 50, index * 50 + 50),
    );
    let deletedCount = 0;
    const locationCleanupCandidates = new Set(organizations);
    for (const chunk of chunks) {
      const placeholders = chunk.map(() => "?").join(", ");
      const whereClause = ids.length
        ? `id IN (${placeholders})`
        : `organization IN (${placeholders})`;
      if (ids.length) {
        const affectedOrganizations = await d1
          .prepare(
            `SELECT DISTINCT organization FROM activities WHERE ${whereClause}`,
          )
          .bind(...chunk)
          .all<{ organization: string }>();
        affectedOrganizations.results.forEach((row) => {
          if (row.organization) locationCleanupCandidates.add(row.organization);
        });
      }
      const count = await d1
        .prepare(`SELECT COUNT(*) AS count FROM activities WHERE ${whereClause}`)
        .bind(...chunk)
        .first<{ count: number }>();
      await d1.batch([
        d1
          .prepare(
            `DELETE FROM activity_authors
             WHERE activity_id IN (SELECT id FROM activities WHERE ${whereClause})`,
          )
          .bind(...chunk),
        d1
          .prepare(`DELETE FROM activities WHERE ${whereClause}`)
          .bind(...chunk),
      ]);
      deletedCount += Number(count?.count ?? 0);
    }
    const cleanupOrganizations = [...locationCleanupCandidates];
    const cleanupChunks = Array.from(
      { length: Math.ceil(cleanupOrganizations.length / 50) },
      (_, index) => cleanupOrganizations.slice(index * 50, index * 50 + 50),
    );
    for (const chunk of cleanupChunks) {
      const placeholders = chunk.map(() => "?").join(", ");
      await d1.batch([
        d1
          .prepare(
          `DELETE FROM organization_locations
           WHERE organization IN (${placeholders})
             AND NOT EXISTS (
               SELECT 1 FROM activities
               WHERE activities.organization = organization_locations.organization
             )`,
          )
          .bind(...chunk),
        d1
          .prepare(
            `DELETE FROM sales_campaign_targets
             WHERE organization IN (${placeholders})
               AND NOT EXISTS (
                 SELECT 1 FROM activities
                 WHERE activities.organization = sales_campaign_targets.organization
               )`,
          )
          .bind(...chunk),
        d1
          .prepare(
            `DELETE FROM equipment_items
             WHERE project_id IN (
               SELECT id FROM equipment_projects
               WHERE organization IN (${placeholders})
                 AND NOT EXISTS (
                   SELECT 1 FROM activities
                   WHERE activities.organization = equipment_projects.organization
                 )
             )`,
          )
          .bind(...chunk),
        d1
          .prepare(
            `DELETE FROM equipment_projects
             WHERE organization IN (${placeholders})
               AND NOT EXISTS (
                 SELECT 1 FROM activities
                 WHERE activities.organization = equipment_projects.organization
               )`,
          )
          .bind(...chunk),
      ]);
    }
    return Response.json({
      ok: true,
      deletedCount,
      deletedOrganizations: organizations.length,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
