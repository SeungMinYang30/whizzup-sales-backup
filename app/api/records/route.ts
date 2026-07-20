import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  clean,
  ensureRecordsReady,
  insertActivity,
  resolveInstitutionName,
  resolveProgressScheduleManagement,
  resolveAward,
  resolveAwardManagement,
  serializeProgressSchedule,
} from "../../../lib/records-store";
import { ensureCampaignsReady } from "../../../lib/campaign-store";
import {
  ensureEquipmentReady,
  promotePlannedEquipmentFromActivity,
  syncEquipmentItemsFromProgressSchedule,
} from "../../../lib/equipment-store";
import { ensureAiRecommendationsReady } from "../../../lib/ai-recommendations";
import { ensureActivityAssignmentHistoryReady } from "../../../lib/activity-assignment-history";
import { ensureActivityReviewsReady } from "../../../lib/activity-reviews";
import {
  ensureMapReady,
  resolveMappedRegion,
} from "../../../lib/map-store";
import {
  canonicalInstitutionName,
  institutionConfirmationResponse,
} from "../../../lib/institution-names";
import { mergeInstitutionRecords } from "../../../lib/institution-merge";
import {
  canonicalProgressManagerName,
  listRegisteredSalesNames,
} from "../../../lib/sales-manager-normalization";
import {
  compactShareSummary,
  replaceOrganizationReferences,
} from "../../../lib/share-text";

export const dynamic = "force-dynamic";

function syncedProjectStatus(payload: Record<string, unknown>) {
  const awardStage = clean(payload.awardStage);
  const awardStatus = clean(payload.awardStatus);
  const progressSchedule = serializeProgressSchedule(payload.progressSchedule);
  if (["완공", "검수", "교육"].includes(awardStage)) return "설치 완료";
  if (progressSchedule || awardStage === "일정 조율") return "설치 중";
  if (
    awardStatus === "위즈업 수주" ||
    ["품의", "협상", "계약"].includes(awardStage)
  ) {
    return "수주";
  }
  return "제안";
}

async function syncEquipmentProjectFromRecord(
  payload: Record<string, unknown>,
  memberId: number,
) {
  const organization = clean(payload.organization).slice(0, 120);
  const projectName = clean(payload.budgetType).slice(0, 120);
  if (!organization || !projectName) return;
  const d1 = await ensureEquipmentReady();
  const exactProject = await d1
    .prepare(
      `SELECT id
       FROM equipment_projects
       WHERE organization = ? AND name = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(organization, projectName)
    .first<{ id: number }>();
  if (exactProject) {
    await d1
      .prepare(
        `UPDATE equipment_projects
         SET budget_type = ?, status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(projectName, syncedProjectStatus(payload), exactProject.id)
      .run();
    return;
  }
  const latestProject = await d1
    .prepare(
      `SELECT id
       FROM equipment_projects
       WHERE organization = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(organization)
    .first<{ id: number }>();
  if (latestProject) {
    await d1
      .prepare(
        `UPDATE equipment_projects
         SET name = ?, budget_type = ?, status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        projectName,
        projectName,
        syncedProjectStatus(payload),
        latestProject.id,
      )
      .run();
    return;
  }
  await d1
    .prepare(
      `INSERT INTO equipment_projects (
        organization, name, status, budget_type, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      organization,
      projectName,
      syncedProjectStatus(payload),
      projectName,
      "",
      memberId,
    )
    .run();
}

function equipmentSyncPayload(record: Record<string, unknown>) {
  return {
    organization: record.organization,
    budgetType: record.budget_type,
    awardStage: record.award_stage,
    awardStatus: record.award_status,
    progressSchedule: record.progress_schedule,
  };
}

function equipmentProposalText(record: Record<string, unknown>) {
  return [
    record.activity_type,
    record.contact_method,
    record.topic,
    record.summary,
    record.next_action,
    record.notes,
    record.source_chat,
  ]
    .map(clean)
    .filter(Boolean)
    .join("\n");
}

const DEFAULT_RECORD_PAGE_SIZE = 500;
const MAX_RECORD_PAGE_SIZE = 500;

function positiveInteger(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  try {
    const member = await requireApprovedMember();
    const searchParams = new URL(request.url).searchParams;
    const dashboardScope = searchParams.get("scope") === "dashboard";
    const limit = Math.min(
      positiveInteger(
        searchParams.get("limit"),
        DEFAULT_RECORD_PAGE_SIZE,
      ) || DEFAULT_RECORD_PAGE_SIZE,
      MAX_RECORD_PAGE_SIZE,
    );
    const offset = positiveInteger(searchParams.get("offset"), 0);
    const d1 = await ensureRecordsReady();
    const selectRecordsSql = dashboardScope
      ? `
        WITH
        ranked_organizations AS (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY organization
              ORDER BY activity_date DESC, id DESC
            ) AS row_number
          FROM activities
          WHERE TRIM(COALESCE(organization, '')) <> ''
        ),
        ranked_awards AS (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY organization
              ORDER BY activity_date DESC, id DESC
            ) AS row_number
          FROM activities
          WHERE TRIM(COALESCE(organization, '')) <> ''
            AND COALESCE(award_status, '미정') <> '미정'
        ),
        ranked_schedules AS (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY organization
              ORDER BY activity_date DESC, id DESC
            ) AS row_number
          FROM activities
          WHERE TRIM(COALESCE(progress_schedule, '')) <> ''
        ),
        recent_activities AS (
          SELECT id
          FROM activities
          ORDER BY activity_date DESC, id DESC
          LIMIT 20
        ),
        dashboard_ids AS (
          SELECT id FROM ranked_organizations WHERE row_number = 1
          UNION
          SELECT id FROM ranked_awards WHERE row_number = 1
          UNION
          SELECT id FROM ranked_schedules WHERE row_number <= 3
          UNION
          SELECT id FROM recent_activities
        )
        SELECT
          a.*,
          COALESCE(aa.created_by_name, '가져온 기록') AS created_by_name
        FROM activities a
        LEFT JOIN activity_authors aa ON aa.activity_id = a.id
        WHERE a.id IN (SELECT id FROM dashboard_ids)
           OR (
             a.category <> '내부'
             AND a.progress_manager = ?
             AND COALESCE(NULLIF(a.created_at::text, ''), a.activity_date)::date
                 >= CURRENT_DATE - INTERVAL '7 days'
           )
        ORDER BY
          CASE WHEN a.follow_up_required = 1 THEN 0 ELSE 1 END,
          CASE WHEN a.follow_up_date IS NULL OR a.follow_up_date = '' THEN 1 ELSE 0 END,
          a.follow_up_date ASC,
          a.activity_date DESC,
          a.id DESC
        LIMIT ? OFFSET ?
      `
      : `
        SELECT
          a.*,
          COALESCE(aa.created_by_name, '가져온 기록') AS created_by_name
        FROM activities a
        LEFT JOIN activity_authors aa ON aa.activity_id = a.id
        ORDER BY
          CASE WHEN a.follow_up_required = 1 THEN 0 ELSE 1 END,
          CASE WHEN a.follow_up_date IS NULL OR a.follow_up_date = '' THEN 1 ELSE 0 END,
          a.follow_up_date ASC,
          a.activity_date DESC,
          a.id DESC
        LIMIT ? OFFSET ?
      `;
    const statement = d1.prepare(selectRecordsSql);
    const result = dashboardScope
      ? await statement.bind(member.displayName, limit + 1, offset).all()
      : await statement.bind(limit + 1, offset).all();
    const records = result.results.slice(0, limit);
    const hasMore = result.results.length > limit;
    return Response.json({
      records,
      scope: dashboardScope ? "dashboard" : "full",
      pagination: {
        limit,
        offset,
        returned: records.length,
        hasMore,
        nextOffset: hasMore ? offset + records.length : null,
      },
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const record = await insertActivity(payload, member, "직접 입력");
    const requestedOrganization = canonicalInstitutionName(payload.organization);
    if (
      clean(payload.confirmedOrganization) &&
      requestedOrganization &&
      requestedOrganization !== clean(record.organization)
    ) {
      await requireApprovedMember();
      await mergeInstitutionRecords(
        requestedOrganization,
        clean(record.organization),
        member.id,
      );
    }
    await syncEquipmentProjectFromRecord(equipmentSyncPayload(record), member.id);
    await Promise.all([
      syncEquipmentItemsFromProgressSchedule(
        clean(record.organization),
        clean(record.progress_schedule),
      ),
      promotePlannedEquipmentFromActivity({
        organization: clean(record.organization),
        budgetType: clean(record.budget_type),
        activityText: equipmentProposalText(record),
      }),
    ]);
    return Response.json({ record }, { status: 201 });
  } catch (error) {
    const confirmation = institutionConfirmationResponse(error);
    if (confirmation) return confirmation;
    if (error instanceof Error && error.message.includes("필수")) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id < 1) {
      return Response.json(
        { error: "올바른 기록 ID가 필요합니다." },
        { status: 400 },
      );
    }

    const activityType = clean(payload.activityType);
    if (!clean(payload.organization) || !activityType) {
      return Response.json(
        { error: "기관명과 활동유형은 필수입니다." },
        { status: 400 },
      );
    }
    const d1 = await ensureRecordsReady();
    const organization = await resolveInstitutionName(d1, payload);
    const sourceOrganization =
      clean(payload.sourceOrganization) || clean(payload.organization);
    const finalizedText = (value: unknown) =>
      replaceOrganizationReferences(value, sourceOrganization, organization);
    const scheduleManagement = resolveProgressScheduleManagement(payload);
    const managedPayload = { ...payload, ...scheduleManagement };
    const award = resolveAward(managedPayload);
    const awardManagement = resolveAwardManagement(managedPayload);
    const registeredSalesNames = await listRegisteredSalesNames(d1);
    const region = await resolveMappedRegion(
      organization,
      clean(payload.region),
    );

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
          follow_up_date = ?, next_action = ?, progress_schedule = ?, contact_role = ?,
          contact_name = ?, contact_phone = ?, contact_email = ?, source_chat = ?, notes = ?,
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
        clean(finalizedText(payload.topic)),
        compactShareSummary(finalizedText(payload.summary)),
        scheduleManagement.status,
        clean(payload.temperature) || "중간",
        award.awardStatus,
        award.awardCompany,
        awardManagement.executionType,
        awardManagement.consortiumCompany,
        awardManagement.awardStage,
        canonicalProgressManagerName(
          payload.progressManager,
          registeredSalesNames,
        ),
        payload.followUpRequired === false ? 0 : 1,
        clean(payload.followUpDate) || null,
        clean(finalizedText(payload.nextAction)),
        finalizedText(scheduleManagement.progressSchedule),
        clean(payload.contactRole),
        clean(payload.contactName),
        clean(payload.contactPhone),
        clean(payload.contactEmail),
        clean(payload.sourceChat) || "직접 입력",
        clean(finalizedText(payload.notes)),
        id,
      )
      .first<Record<string, unknown>>();
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
        await ensureAiRecommendationsReady();
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
          d1
            .prepare(
              `UPDATE ai_recommendations
               SET organization = ?, updated_at = CURRENT_TIMESTAMP
               WHERE organization = ?`,
            )
            .bind(organization, previous.organization),
        ]);
      }
    }
    if (
      result &&
      clean(payload.confirmedOrganization) &&
      canonicalInstitutionName(payload.organization) !== clean(result.organization)
    ) {
      await requireApprovedMember();
      await mergeInstitutionRecords(
        canonicalInstitutionName(payload.organization),
        clean(result.organization),
        member.id,
      );
    }
    if (result) {
      await syncEquipmentProjectFromRecord(
        equipmentSyncPayload(result),
        member.id,
      );
      await Promise.all([
        syncEquipmentItemsFromProgressSchedule(
          clean(result.organization),
          clean(result.progress_schedule),
        ),
        promotePlannedEquipmentFromActivity({
          organization: clean(result.organization),
          budgetType: clean(result.budget_type),
          activityText: equipmentProposalText(result),
        }),
      ]);
    }
    return Response.json({ record: result });
  } catch (error) {
    const confirmation = institutionConfirmationResponse(error);
    if (confirmation) return confirmation;
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireApprovedMember();
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
    await ensureAiRecommendationsReady();
    await ensureActivityAssignmentHistoryReady();
    await ensureActivityReviewsReady();
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
            `DELETE FROM ai_recommendations
             WHERE activity_id IN (SELECT id FROM activities WHERE ${whereClause})`,
          )
          .bind(...chunk),
        d1
          .prepare(
            `DELETE FROM activity_authors
             WHERE activity_id IN (SELECT id FROM activities WHERE ${whereClause})`,
          )
          .bind(...chunk),
        d1
          .prepare(
            `DELETE FROM activity_assignment_history
             WHERE activity_id IN (SELECT id FROM activities WHERE ${whereClause})`,
          )
          .bind(...chunk),
        d1
          .prepare(
            `DELETE FROM activity_review_acknowledgements
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
