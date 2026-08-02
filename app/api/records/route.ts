import {
  accessErrorResponse,
  isPrimaryOwner,
  requireAdminMember,
  requireApprovedMember,
  requirePrimaryOwner,
} from "../../../lib/collaboration";
import {
  clean,
  ensureRecordsReady,
  insertActivity,
  normalizeActivityDetailLevel,
  resolveActivityBudgetAllocations,
  resolveInstitutionName,
  resolveProgressScheduleManagement,
  resolveAward,
  resolveAwardManagement,
  serializeActivityDetailFacts,
  serializeActivityDetailSections,
  serializeProgressSchedule,
  synchronizeBusinessRoundBudgets,
} from "../../../lib/records-store";
import { ensureCampaignsReady } from "../../../lib/campaign-store";
import { syncCampaignTargetsFromActivity } from "../../../lib/campaign-institution-basics";
import {
  ensureEquipmentReady,
  syncImportedAwardEquipment,
  promotePlannedEquipmentFromActivity,
  syncEquipmentItemsFromProgressSchedule,
} from "../../../lib/equipment-store";
import { ensureAiRecommendationsReady } from "../../../lib/ai-recommendations";
import {
  ensureActivityAssignmentHistoryReady,
  reassignOpenCorrectionRequests,
} from "../../../lib/activity-assignment-history";
import { ensureActivityReviewsReady } from "../../../lib/activity-reviews";
import {
  ensureMapReady,
  resolveMappedRegion,
} from "../../../lib/map-store";
import {
  canonicalInstitutionName,
  institutionConfirmationResponse,
  institutionAliasKey,
} from "../../../lib/institution-names";
import {
  COMPLETED_AWARD_STAGE,
  isCompletedAwardStage,
  normalizeActivityType,
  normalizeAwardStage,
  normalizeSalesProgress,
} from "../../../lib/sales-taxonomy";
import { serializeInstitutionContacts } from "../../../lib/institution-contacts";
import { mergeInstitutionRecords } from "../../../lib/institution-merge";
import {
  canonicalProgressManagerName,
  listRegisteredSalesNames,
  progressManagerForAward,
  syncBusinessProgressManagerFromLatestAuthor,
} from "../../../lib/sales-manager-normalization";
import {
  compactShareSummary,
  replaceOrganizationReferences,
} from "../../../lib/share-text";
import { ensureQuotationDocumentsReady } from "../../../lib/quotation-documents";
import {
  createTrashBatch,
  ensureTrashReady,
  type TrashSnapshot,
} from "../../../lib/trash-store";
import {
  ensureBudgetNamesReady,
  linkBudgetRequestRecord,
  linkBudgetNameEntity,
  normalizeBudgetNameKey,
  resolveCanonicalBudgetName,
  resolveBudgetRecordMetadata,
} from "../../../lib/budget-names";
import { resolveAwardCompletedDate } from "../../../lib/award-completion";
import { meaningfulBudgetAmount } from "../../../lib/budget-policy";
import { logDataControlEvent } from "../../../lib/data-control-store";
import { ensureAccountingReady } from "../../../lib/accounting-store";
import { ensureManagerAlertsReady } from "../../../lib/manager-alerts";
import { ensureJointProjectsReady } from "../../../lib/joint-projects";
import {
  ACTIVITY_CHANGE_MAX_OPERATION_ID_LENGTH,
  ACTIVITY_CHANGE_SCOPE_AWARDS,
  ACTIVITY_CHANGE_WRITE_CHUNK_SIZE,
  ensureActivityChangeLedgerReady,
  existingActivityChangeItemIds,
  getActivityChangeBatch,
  prepareActivityChangeBatchProgress,
  prepareActivityChangeBatchUpsert,
  prepareActivityChangeFinalization,
  prepareActivityChangeSnapshot,
  isActivityChangeScope,
} from "../../../lib/activity-change-ledger";
import { chunkValues } from "../../../lib/d1-bulk";
import { serializeActivityBudgets } from "../../../lib/activity-budgets";

export const dynamic = "force-dynamic";

const RECORD_BULK_UPDATE_CHUNK_SIZE = 40;

function syncedProjectStatus(payload: Record<string, unknown>) {
  const awardStage = clean(payload.awardStage);
  const awardStatus = clean(payload.awardStatus);
  const progressSchedule = serializeProgressSchedule(payload.progressSchedule);
  if (isCompletedAwardStage(awardStage)) return "설치 완료";
  if (progressSchedule || awardStage === "일정 조율") return "설치 중";
  if (
    ["위즈업 수주", "협력사 수주"].includes(awardStatus) ||
    ["협상", "계약"].includes(normalizeAwardStage(awardStage))
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
  const budgetName = clean(payload.budgetType).slice(0, 120);
  const installedProducts = clean(payload.installedProducts);
  const projectName =
    budgetName || (installedProducts ? "설치 완료 수주" : "");
  const requestedRound = Number(payload.businessRound);
  const businessRound =
    Number.isSafeInteger(requestedRound) && requestedRound > 0
      ? Math.min(99, requestedRound)
      : 1;
  const activityId = Number(payload.activityId);
  if (!organization || !projectName) return null;
  const d1 = await ensureEquipmentReady();
  const budgetOriginalName =
    clean(payload.budgetOriginalName) || budgetName;
  const budgetGroupId = Number(payload.budgetGroupId);
  const linkedGroupId =
    Number.isInteger(budgetGroupId) && budgetGroupId > 0 ? budgetGroupId : null;
  const budgetMatchStatus =
    clean(payload.budgetMatchStatus) || "unclassified";
  const budgetMatchMethod = clean(payload.budgetMatchMethod) || "legacy";
  const budgetRequestId = clean(payload.budgetRequestId) || null;
  const budgetKind = clean(payload.budgetKind) || "unclassified";
  if (!budgetName) {
    const latestProject = await d1
      .prepare(
        `SELECT id
         FROM equipment_projects
         WHERE organization = ? AND business_round = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
      )
      .bind(organization, businessRound)
      .first<{ id: number }>();
    if (latestProject) {
      await d1
        .prepare(
          `UPDATE equipment_projects
           SET status = ?, activity_id = COALESCE(?, activity_id),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          syncedProjectStatus(payload),
          Number.isSafeInteger(activityId) && activityId > 0 ? activityId : null,
          latestProject.id,
        )
        .run();
      return latestProject.id;
    }
    const inserted = await d1
      .prepare(
        `INSERT INTO equipment_projects (
          organization, business_round, name, status, budget_type, notes,
          activity_id, created_by
        ) VALUES (?, ?, ?, ?, '', ?, ?, ?)`,
      )
      .bind(
        organization,
        businessRound,
        projectName,
        syncedProjectStatus(payload),
        "예산명 미입력 · 설치 완료 수주 일괄등록",
        Number.isSafeInteger(activityId) && activityId > 0 ? activityId : null,
        memberId,
      )
      .run();
    const projectId = Number(inserted.meta.last_row_id);
    return projectId > 0 ? projectId : null;
  }
  const linkProject = async (projectId: number) => {
    await linkBudgetNameEntity(d1, {
      entityType: "equipment_project",
      entityId: projectId,
      groupId: linkedGroupId,
      originalName: budgetOriginalName,
      aliasKey: normalizeBudgetNameKey(budgetOriginalName),
    });
    if (budgetRequestId) {
      await linkBudgetRequestRecord(d1, {
        requestId: budgetRequestId,
        entityType: "equipment_project",
        entityId: projectId,
        originalName: budgetOriginalName,
        organization,
      });
    }
  };
  const exactProject = await d1
    .prepare(
      `SELECT id
       FROM equipment_projects
       WHERE organization = ? AND business_round = ? AND name = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(organization, businessRound, projectName)
    .first<{ id: number }>();
  if (exactProject) {
    await d1
      .prepare(
        `UPDATE equipment_projects
         SET budget_type = ?, status = ?, activity_id = COALESCE(?, activity_id),
             budget_original_name = ?, budget_group_id = ?,
             budget_match_status = ?, budget_match_method = ?,
             budget_request_id = ?, budget_kind = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        projectName,
        syncedProjectStatus(payload),
        Number.isSafeInteger(activityId) && activityId > 0 ? activityId : null,
        budgetOriginalName,
        linkedGroupId,
        budgetMatchStatus,
        budgetMatchMethod,
        budgetRequestId,
        budgetKind,
        exactProject.id,
      )
      .run();
    await linkProject(exactProject.id);
    return exactProject.id;
  }
  const latestProject = await d1
    .prepare(
      `SELECT id
       FROM equipment_projects
       WHERE organization = ? AND business_round = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(organization, businessRound)
    .first<{ id: number }>();
  if (latestProject) {
    await d1
      .prepare(
        `UPDATE equipment_projects
         SET name = ?, budget_type = ?, status = ?,
             activity_id = COALESCE(?, activity_id),
             budget_original_name = ?, budget_group_id = ?,
             budget_match_status = ?, budget_match_method = ?,
             budget_request_id = ?, budget_kind = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        projectName,
        projectName,
        syncedProjectStatus(payload),
        Number.isSafeInteger(activityId) && activityId > 0 ? activityId : null,
        budgetOriginalName,
        linkedGroupId,
        budgetMatchStatus,
        budgetMatchMethod,
        budgetRequestId,
        budgetKind,
        latestProject.id,
      )
      .run();
    await linkProject(latestProject.id);
    return latestProject.id;
  }
  const inserted = await d1
    .prepare(
      `INSERT INTO equipment_projects (
        organization, business_round, name, status, budget_type, notes,
        activity_id, created_by, budget_original_name, budget_group_id,
        budget_match_status, budget_match_method, budget_request_id, budget_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      organization,
      businessRound,
      projectName,
      syncedProjectStatus(payload),
      projectName,
      "",
      Number.isSafeInteger(activityId) && activityId > 0 ? activityId : null,
      memberId,
      budgetOriginalName,
      linkedGroupId,
      budgetMatchStatus,
      budgetMatchMethod,
      budgetRequestId,
      budgetKind,
    )
    .run();
  const projectId = Number(inserted.meta.last_row_id);
  if (projectId > 0) await linkProject(projectId);
  return projectId > 0 ? projectId : null;
}

function equipmentSyncPayload(record: Record<string, unknown>) {
  return {
    organization: record.organization,
    businessRound: record.business_round,
    activityId: record.id,
    budgetType: record.budget_type,
    budgetOriginalName: record.budget_original_name,
    budgetGroupId: record.budget_group_id,
    budgetMatchStatus: record.budget_match_status,
    budgetMatchMethod: record.budget_match_method,
    budgetRequestId: record.budget_request_id,
    budgetKind: record.budget_kind,
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
const MAX_DASHBOARD_RECORD_PAGE_SIZE = 2_500;

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
      dashboardScope
        ? MAX_DASHBOARD_RECORD_PAGE_SIZE
        : MAX_RECORD_PAGE_SIZE,
    );
    const offset = positiveInteger(searchParams.get("offset"), 0);
    const [d1] = await Promise.all([
      ensureRecordsReady(),
      ensureJointProjectsReady(),
    ]);
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
        my_recent_activities AS (
          SELECT id
          FROM activities
          WHERE progress_manager = ?
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
          UNION
          SELECT id FROM my_recent_activities
        ),
        joint_member_candidates AS (
          SELECT
            source_activity.id AS activity_id,
            linked.id AS member_id,
            ROW_NUMBER() OVER (
              PARTITION BY source_activity.id
              ORDER BY
                CASE WHEN linked.activity_id = source_activity.id THEN 0 ELSE 1 END,
                linked.updated_at DESC,
                linked.id DESC
            ) AS row_number
          FROM activities source_activity
          JOIN joint_project_members linked
            ON linked.activity_id = source_activity.id
            OR (
              linked.organization = source_activity.organization
              AND linked.business_round = source_activity.business_round
            )
          JOIN joint_projects linked_project
            ON linked_project.id = linked.project_id
           AND linked_project.status = 'active'
        )
        SELECT
          a.*,
          COALESCE(aa.created_by_name, '가져온 기록') AS created_by_name,
          jp.id AS joint_project_id,
          jp.name AS joint_project_name,
          jp.sponsor_organization AS joint_project_sponsor,
          jpm.role AS joint_project_role
        FROM activities a
        LEFT JOIN activity_authors aa ON aa.activity_id = a.id
        LEFT JOIN joint_member_candidates joint_link
          ON joint_link.activity_id = a.id
         AND joint_link.row_number = 1
        LEFT JOIN joint_project_members jpm
          ON jpm.id = joint_link.member_id
        LEFT JOIN joint_projects jp
          ON jp.id = jpm.project_id AND jp.status = 'active'
        WHERE a.id IN (SELECT id FROM dashboard_ids)
           OR (
             a.category <> '내부'
             AND a.progress_manager = ?
             AND DATE(SUBSTR(COALESCE(NULLIF(a.created_at, ''), a.activity_date), 1, 10))
                 >= DATE('now', '-7 day')
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
        WITH joint_member_candidates AS (
          SELECT
            source_activity.id AS activity_id,
            linked.id AS member_id,
            ROW_NUMBER() OVER (
              PARTITION BY source_activity.id
              ORDER BY
                CASE WHEN linked.activity_id = source_activity.id THEN 0 ELSE 1 END,
                linked.updated_at DESC,
                linked.id DESC
            ) AS row_number
          FROM activities source_activity
          JOIN joint_project_members linked
            ON linked.activity_id = source_activity.id
            OR (
              linked.organization = source_activity.organization
              AND linked.business_round = source_activity.business_round
            )
          JOIN joint_projects linked_project
            ON linked_project.id = linked.project_id
           AND linked_project.status = 'active'
        )
        SELECT
          a.*,
          COALESCE(aa.created_by_name, '가져온 기록') AS created_by_name,
          jp.id AS joint_project_id,
          jp.name AS joint_project_name,
          jp.sponsor_organization AS joint_project_sponsor,
          jpm.role AS joint_project_role
        FROM activities a
        LEFT JOIN activity_authors aa ON aa.activity_id = a.id
        LEFT JOIN joint_member_candidates joint_link
          ON joint_link.activity_id = a.id
         AND joint_link.row_number = 1
        LEFT JOIN joint_project_members jpm
          ON jpm.id = joint_link.member_id
        LEFT JOIN joint_projects jp
          ON jp.id = jpm.project_id AND jp.status = 'active'
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
      ? await statement
          .bind(member.displayName, member.displayName, limit + 1, offset)
          .all()
      : await statement.bind(limit + 1, offset).all();
    const records = (result.results as Record<string, unknown>[])
      .slice(0, limit)
      .map((record) =>
      record.award_status === "타업체 수주"
        ? {
            ...record,
            execution_type: "해당 없음",
            consortium_company: "",
            award_stage: "해당 없음",
          }
        : record,
      );
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

export async function createActivityRecord(
  payload: Record<string, unknown>,
  member: Awaited<ReturnType<typeof requireApprovedMember>>,
) {
    if (payload.standardBudgetOnly === true) {
      const d1 = await ensureRecordsReady();
      await ensureBudgetNamesReady();
      const requestedBudgets = Array.isArray(payload.budgets)
        ? payload.budgets.filter(
            (item): item is Record<string, unknown> =>
              Boolean(item && typeof item === "object"),
          )
        : [payload];
      for (const requested of requestedBudgets) {
        const name = clean(requested.budgetType);
        if (!name) continue;
        const standardBudget = await resolveCanonicalBudgetName(d1, name);
        if (!standardBudget.groupId) {
          throw new Error(
            "관리자가 등록한 활성 표준 예산명을 선택해 주세요.",
          );
        }
      }
    }
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
  if (payload.normalizeOfficialSchoolAliases === true) {
    const canonicalOrganization = clean(record.organization);
    const canonicalKey = institutionAliasKey(canonicalOrganization);
    const d1 = await ensureRecordsReady();
    const aliases = await d1
      .prepare(
        `SELECT DISTINCT organization
         FROM activities
         WHERE organization <> ? AND organization <> ''`,
      )
      .bind(canonicalOrganization)
      .all<{ organization: string }>();
    for (const row of aliases.results) {
      const alias = clean(row.organization);
      if (!alias || institutionAliasKey(alias) !== canonicalKey) continue;
      await mergeInstitutionRecords(alias, canonicalOrganization, member.id);
    }
  }
  const equipmentProjectId = await syncEquipmentProjectFromRecord(
    {
      ...equipmentSyncPayload(record),
      installedProducts: payload.installedProducts,
    },
    member.id,
  );
  await Promise.all([
    equipmentProjectId
      ? syncImportedAwardEquipment({
          projectId: equipmentProjectId,
          installedProducts: payload.installedProducts,
          memberId: member.id,
        })
      : Promise.resolve(0),
    syncEquipmentItemsFromProgressSchedule(
      clean(record.organization),
      clean(record.progress_schedule),
      Math.max(1, Number(record.business_round) || 1),
    ),
    promotePlannedEquipmentFromActivity({
      organization: clean(record.organization),
      businessRound: Math.max(1, Number(record.business_round) || 1),
      budgetType: clean(record.budget_type),
      activityText: equipmentProposalText(record),
    }),
  ]);
  return record;
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const record = await createActivityRecord(payload, member);
    return Response.json({ record }, { status: 201 });
  } catch (error) {
    const confirmation = institutionConfirmationResponse(error);
    if (confirmation) return confirmation;
    if (
      error instanceof Error &&
      (error.message.includes("필수") ||
        error.message.includes("활성 표준 예산명"))
    ) {
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

    const activityType = normalizeActivityType(payload.activityType);
    if (!clean(payload.organization) || !activityType) {
      return Response.json(
        { error: "기관명과 활동유형은 필수입니다." },
        { status: 400 },
      );
    }
    const d1 = await ensureRecordsReady();
    await ensureBudgetNamesReady();
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
    const followUpDate = clean(payload.followUpDate);
    const followUpRequired =
      !isCompletedAwardStage(awardManagement.awardStage) &&
      payload.followUpRequired === true &&
      Boolean(followUpDate);
    const requestedBusinessRound = Number(payload.businessRound);
    const businessRound =
      Number.isSafeInteger(requestedBusinessRound) && requestedBusinessRound > 0
        ? Math.min(99, requestedBusinessRound)
        : 1;
    const region = await resolveMappedRegion(
      organization,
      clean(payload.region),
    );

    const previous = await d1
      .prepare(
        `SELECT organization, business_round, award_completed_date,
                progress_manager, progress_manager_locked,
                budget_type, budget_amount, budget_original_name,
                budget_group_id, budget_match_status, budget_match_method,
                budget_request_id, budget_kind, budget_amount_mode,
                budget_amount_override, budgets_json,
                (
                  SELECT member.display_name
                  FROM activities latest
                  JOIN activity_authors author
                    ON author.activity_id = latest.id
                  JOIN members member
                    ON member.id = author.member_id
                   AND member.status = 'approved'
                   AND member.is_sales = 1
                  WHERE latest.organization = activities.organization
                    AND latest.business_round = activities.business_round
                  ORDER BY latest.activity_date DESC, latest.id DESC
                  LIMIT 1
                ) AS author_progress_manager
         FROM activities WHERE id = ?`,
      )
      .bind(id)
      .first<Record<string, unknown>>();
    const automaticProgressManager =
      award.awardStatus !== "협력사 수주" &&
      Number(previous?.progress_manager_locked ?? 0) !== 1
        ? clean(previous?.author_progress_manager) ||
          clean(payload.progressManager)
        : payload.progressManager;
    const requestedProgressManager = progressManagerForAward(
      award.awardStatus,
      automaticProgressManager,
      registeredSalesNames,
    );
    const progressManagerChanged =
      requestedProgressManager !== clean(previous?.progress_manager);
    if (
      progressManagerChanged &&
      !member.isSales &&
      !(await isPrimaryOwner(member))
    ) {
      return Response.json(
        { error: "영업 담당자만 진행 담당자를 직접 변경할 수 있습니다." },
        { status: 403 },
      );
    }
    if (
      clean(previous?.organization) &&
      clean(previous?.organization) !== organization
    ) {
      if (payload.confirmInstitutionRename !== true) {
        return Response.json(
          {
            error:
              "기관명을 변경하면 이 기관의 모든 과거 기록과 지도·사업 정보가 함께 변경됩니다. 계속하시겠습니까?",
            needsInstitutionRenameConfirmation: true,
            previousOrganization: clean(previous.organization),
            nextOrganization: organization,
          },
          { status: 409 },
        );
      }
      await mergeInstitutionRecords(
        clean(previous.organization),
        organization,
        member.id,
      );
    }
    const awardCompletedDate = resolveAwardCompletedDate({
      awardStage: awardManagement.awardStage,
      requestedDate: payload.awardCompletedDate,
      previousDate: previous?.award_completed_date,
      fallbackDate: payload.activityDate,
    });
    if (
      progressManagerChanged &&
      award.awardStatus !== "협력사 수주"
    ) {
      await d1
        .prepare(
          `UPDATE activities
           SET progress_manager_locked = 0
           WHERE organization = ? AND business_round = ?`,
        )
        .bind(organization, businessRound)
        .run();
    }
    const progressManagerLocked = award.awardStatus === "협력사 수주"
      ? 0
      : progressManagerChanged
        ? 0
        : Number(previous?.progress_manager_locked ?? 0) === 1
          ? 1
          : 0;
    const resolvedBudgets = await resolveActivityBudgetAllocations(
      d1,
      payload,
      award.awardStatus,
      previous ?? {},
    );
    const budgetMetadata = resolvedBudgets[0] ?? await resolveBudgetRecordMetadata(d1, {
      budgetType: payload.budgetType ?? previous?.budget_type,
      budgetOriginalName:
        payload.budgetOriginalName ??
        previous?.budget_original_name ??
        payload.budgetType ??
        previous?.budget_type,
      budgetGroupId: payload.budgetGroupId ?? previous?.budget_group_id,
      budgetMatchStatus:
        payload.budgetMatchStatus ?? previous?.budget_match_status,
      budgetMatchMethod:
        payload.budgetMatchMethod ?? previous?.budget_match_method,
      budgetRequestId:
        payload.budgetRequestId ??
        payload.budgetNameRequestId ??
        previous?.budget_request_id,
      budgetKind: payload.budgetKind ?? previous?.budget_kind,
      budgetAmountMode:
        payload.budgetAmountMode ?? previous?.budget_amount_mode,
      budgetAmount:
        payload.budgetAmount ?? previous?.budget_amount,
      budgetInstitutionAmount:
        payload.budgetInstitutionAmount ??
        payload.budgetAmount ??
        previous?.budget_amount,
      budgetAmountOverride:
        payload.budgetAmountOverride ??
        payload.budgetOverrideAmount ??
        previous?.budget_amount_override,
      budgetAmountSource: payload.budgetAmountSource,
      awardStatus: award.awardStatus,
    });
    if (
      payload.standardBudgetOnly === true
    ) {
      for (const budget of resolvedBudgets) {
        if (!clean(budget.budgetType)) continue;
        const standardBudget = await resolveCanonicalBudgetName(
          d1,
          budget.budgetType,
        );
        if (!standardBudget.groupId) {
          return Response.json(
            { error: "관리자가 등록한 활성 표준 예산명을 선택해 주세요." },
            { status: 400 },
          );
        }
      }
    }
    const result = await d1
      .prepare(`
        UPDATE activities SET
           activity_date = ?, date_confidence = ?, activity_type = ?, category = ?,
           contact_method = ?, region = ?, organization = ?, budget_type = ?,
           business_round = ?, budget_amount = ?,
           budget_original_name = ?, budget_group_id = ?,
           budget_match_status = ?, budget_match_method = ?,
           budget_request_id = ?, budget_kind = ?,
           budget_amount_mode = ?, budget_amount_override = ?, budgets_json = ?,
           topic = ?, summary = ?, detail_level = ?, detail_summary = ?,
           detail_key_facts_json = ?, detail_sections_json = ?, raw_input = ?,
           status = ?, status_manual = ?, temperature = ?,
          award_status = ?, award_company = ?, execution_type = ?,
          consortium_company = ?, award_stage = ?, award_completed_date = ?,
          progress_manager = ?, progress_manager_locked = ?,
          follow_up_required = ?,
          follow_up_date = ?, next_action = ?, progress_schedule = ?, contact_role = ?,
          contact_name = ?, contact_phone = ?, contact_email = ?, contacts_json = ?,
          source_chat = ?, notes = ?,
          updated_by_member_id = ?, updated_by_name = ?,
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
        budgetMetadata.budgetType,
        businessRound,
        budgetMetadata.budgetAmount,
        budgetMetadata.budgetOriginalName,
        budgetMetadata.budgetGroupId,
        budgetMetadata.budgetMatchStatus,
        budgetMetadata.budgetMatchMethod,
        budgetMetadata.budgetRequestId,
        budgetMetadata.budgetKind,
        budgetMetadata.budgetAmountMode,
        budgetMetadata.budgetAmountOverride,
        serializeActivityBudgets(resolvedBudgets),
        clean(finalizedText(payload.topic)),
        compactShareSummary(finalizedText(payload.summary)),
        normalizeActivityDetailLevel(payload.detailLevel),
        clean(finalizedText(payload.detailSummary)).slice(0, 4_000),
        serializeActivityDetailFacts(payload.detailKeyFacts),
        serializeActivityDetailSections(payload.detailSections),
        clean(payload.rawInput).slice(0, 20_000),
        scheduleManagement.status,
        payload.statusManual === true ? 1 : 0,
        clean(payload.temperature) || "중간",
        award.awardStatus,
        award.awardCompany,
        awardManagement.executionType,
        awardManagement.consortiumCompany,
        awardManagement.awardStage,
        awardCompletedDate,
        requestedProgressManager,
        progressManagerLocked,
        followUpRequired ? 1 : 0,
        followUpRequired ? followUpDate : null,
        clean(finalizedText(payload.nextAction)),
        finalizedText(scheduleManagement.progressSchedule),
        clean(payload.contactRole),
        clean(payload.contactName),
        clean(payload.contactPhone),
        clean(payload.contactEmail),
        serializeInstitutionContacts(payload.contacts, {
          role: clean(payload.contactRole),
          name: clean(payload.contactName),
          phone: clean(payload.contactPhone),
          email: clean(payload.contactEmail),
        }),
        clean(payload.sourceChat) || "직접 입력",
        clean(finalizedText(payload.notes)),
        member.id,
        member.displayName,
        id,
      )
      .first<Record<string, unknown>>();
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
    let responseRecord = result;
    if (result) {
      const previousManager = clean(previous?.progress_manager);
      const nextManager = clean(result.progress_manager);
      if (
        nextManager &&
        nextManager !== "해당 없음" &&
        nextManager !== previousManager
      ) {
        await ensureActivityAssignmentHistoryReady();
        const target = await d1
          .prepare(
            `SELECT id
             FROM members
             WHERE display_name = ? AND status = 'approved' AND is_sales = 1
             LIMIT 1`,
          )
          .bind(nextManager)
          .first<{ id: number }>();
        if (target) {
          await d1
            .prepare(
              `INSERT INTO activity_assignment_history (
                 activity_id, from_manager, to_member_id, to_manager,
                 changed_by_member_id, changed_by_name
               ) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              Number(result.id),
              previousManager,
              target.id,
              nextManager,
              member.id,
              member.displayName,
            )
            .run();
          await reassignOpenCorrectionRequests(
            [Number(result.id)],
            nextManager,
            member.id,
          );
        }
      }
      if (progressManagerChanged) {
        await ensureCampaignsReady();
        await syncCampaignTargetsFromActivity(d1, Number(result.id));
      }
      await linkBudgetNameEntity(d1, {
        entityType: "activity",
        entityId: Number(result.id),
        groupId: budgetMetadata.budgetGroupId,
        originalName: budgetMetadata.budgetOriginalName,
        aliasKey: normalizeBudgetNameKey(budgetMetadata.budgetOriginalName),
      });
      if (budgetMetadata.budgetRequestId) {
        await linkBudgetRequestRecord(d1, {
          requestId: budgetMetadata.budgetRequestId,
          entityType: "activity",
          entityId: Number(result.id),
          originalName: budgetMetadata.budgetOriginalName,
          organization,
        });
      }
      if (payload.syncBusinessRoundBudgets === true) {
        await synchronizeBusinessRoundBudgets(
          d1,
          clean(result.organization),
          Math.max(1, Number(result.business_round) || 1),
          resolvedBudgets,
        );
      }
      const equipmentProjectId = await syncEquipmentProjectFromRecord(
        {
          ...equipmentSyncPayload(result),
          installedProducts: payload.installedProducts,
        },
        member.id,
      );
      await Promise.all([
        equipmentProjectId
          ? syncImportedAwardEquipment({
              projectId: equipmentProjectId,
              installedProducts: payload.installedProducts,
              memberId: member.id,
            })
          : Promise.resolve(0),
        syncEquipmentItemsFromProgressSchedule(
          clean(result.organization),
          clean(result.progress_schedule),
          Math.max(1, Number(result.business_round) || 1),
        ),
        promotePlannedEquipmentFromActivity({
          organization: clean(result.organization),
          businessRound: Math.max(1, Number(result.business_round) || 1),
          budgetType: clean(result.budget_type),
          activityText: equipmentProposalText(result),
        }),
      ]);
      await syncBusinessProgressManagerFromLatestAuthor(
        d1,
        clean(result.organization),
        Math.max(1, Number(result.business_round) || 1),
      );
      responseRecord =
        (await d1
          .prepare(
            `SELECT activities.*,
                    COALESCE(activity_authors.created_by_name, '가져온 기록')
                      AS created_by_name
             FROM activities
             LEFT JOIN activity_authors
               ON activity_authors.activity_id = activities.id
             WHERE activities.id = ?`,
          )
          .bind(Number(result.id))
          .first<Record<string, unknown>>()) ?? result;
    }
    return Response.json({ record: responseRecord });
  } catch (error) {
    const confirmation = institutionConfirmationResponse(error);
    if (confirmation) return confirmation;
    return accessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const ids = Array.isArray(payload.ids)
      ? [...new Set(payload.ids.map(Number))].filter(
          (id) => Number.isInteger(id) && id > 0,
        )
      : [];
    const requestedBudgetType = clean(payload.budgetType).slice(0, 120);
    let budgetType = requestedBudgetType;
    const budgetAmount = meaningfulBudgetAmount(payload.budgetAmount).slice(
      0,
      120,
    );
    const activityDate = clean(payload.activityDate).slice(0, 10);
    const followUpDate = clean(payload.followUpDate).slice(0, 10);
    const nextAction = clean(payload.nextAction).slice(0, 500);
    const requestedStatus = normalizeSalesProgress(payload.status);
    const requestedAwardStatus = clean(payload.awardStatus).slice(0, 40);
    const requestedAwardCompany = clean(payload.awardCompany).slice(0, 120);
    const requestedExecutionType = clean(payload.executionType).slice(0, 40);
    const requestedConsortiumCompany = clean(payload.consortiumCompany).slice(0, 120);
    const requestedAwardStage = normalizeAwardStage(
      payload.awardStage,
      requestedAwardStatus,
    );
    const requestedAwardCompletedDate = resolveAwardCompletedDate({
      awardStage: requestedAwardStage,
      requestedDate: payload.awardCompletedDate,
      fallbackDate:
        activityDate ||
        new Date(Date.now() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10),
    });
    const contactName = clean(payload.contactName).slice(0, 120);
    const applyFields = new Set(
      Array.isArray(payload.applyFields)
        ? payload.applyFields.map(clean)
        : ["budget"],
    );
    const operationId = clean(payload.operationId);
    const requestedOperationScope =
      clean(payload.operationScope) || ACTIVITY_CHANGE_SCOPE_AWARDS;
    const operationLabel =
      clean(payload.operationLabel).slice(0, 200) || "기록 일괄 변경";
    const requestedOperationTotal = Number(payload.operationTotal);
    const operationTotal =
      Number.isSafeInteger(requestedOperationTotal) &&
      requestedOperationTotal > 0
        ? requestedOperationTotal
        : 0;
    const allowedFields = new Set([
      "activityDate",
      "budget",
      "progressManager",
      "contactName",
      "followUpDate",
      "nextAction",
      "status",
      "awardStatus",
      "executionType",
      "awardStage",
    ]);
    const onlyEmpty = payload.onlyEmpty !== false;
    if (!ids.length || ids.length > 500) {
      return Response.json(
        { error: "한 번에 변경할 기록을 1~500건 선택해 주세요." },
        { status: 400 },
      );
    }
    if (
      !applyFields.size ||
      [...applyFields].some((field) => !allowedFields.has(field))
    ) {
      return Response.json(
        { error: "일괄 변경할 항목을 올바르게 선택해 주세요." },
        { status: 400 },
      );
    }
    if (
      applyFields.has("progressManager") &&
      !(
        applyFields.has("awardStatus") &&
        requestedAwardStatus === "협력사 수주" &&
        clean(payload.progressManager) === "해당 없음"
      ) &&
      !member.isSales &&
      !(await isPrimaryOwner(member))
    ) {
      return Response.json(
        { error: "영업 담당자만 진행 담당자를 직접 변경할 수 있습니다." },
        { status: 403 },
      );
    }
    if (
      operationId &&
      (operationId.length > ACTIVITY_CHANGE_MAX_OPERATION_ID_LENGTH ||
        !isActivityChangeScope(requestedOperationScope) ||
        !operationTotal ||
        operationTotal < ids.length ||
        operationTotal > 20_000)
    ) {
      return Response.json(
        {
          error:
            "일괄 변경 작업 식별자와 전체 건수를 올바르게 입력해 주세요.",
        },
        { status: 400 },
      );
    }
    const d1 = await ensureRecordsReady();
    const registeredSalesNames = await listRegisteredSalesNames(d1);
    const progressManager = canonicalProgressManagerName(
      payload.progressManager,
      registeredSalesNames,
    );
    if (
      (applyFields.has("activityDate") &&
        !/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) ||
      (applyFields.has("budget") && !requestedBudgetType && !budgetAmount) ||
      (applyFields.has("progressManager") &&
        (!progressManager ||
          (progressManager !== "해당 없음" &&
            !registeredSalesNames.includes(progressManager)))) ||
      (applyFields.has("contactName") && !contactName) ||
      (applyFields.has("followUpDate") && !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) ||
      (applyFields.has("nextAction") && !nextAction) ||
      (applyFields.has("status") && !requestedStatus) ||
      (applyFields.has("awardStatus") &&
        !["미정", "위즈업 수주", "협력사 수주", "타업체 수주"].includes(requestedAwardStatus)) ||
      (applyFields.has("awardStatus") &&
        ["협력사 수주", "타업체 수주"].includes(requestedAwardStatus) &&
        !requestedAwardCompany) ||
      (applyFields.has("executionType") &&
        !["직영", "컨소", "해당 없음"].includes(requestedExecutionType)) ||
      (applyFields.has("executionType") &&
        requestedExecutionType === "컨소" &&
        !requestedConsortiumCompany) ||
      (applyFields.has("awardStage") &&
        ![
          "미정",
          "협상",
          "계약",
          "일정 조율",
          "설치·공사 진행",
          "검수·교육 진행",
          COMPLETED_AWARD_STAGE,
          "해당 없음",
        ].includes(requestedAwardStage))
    ) {
      return Response.json(
        { error: "선택한 일괄 변경 항목의 입력값을 확인해 주세요." },
        { status: 400 },
      );
    }
    const previousBudgetRows: Array<{
      id: number;
      budget_type: string;
      award_status: string;
    }> = [];
    const previousManagerById = new Map<number, string>();
    if (applyFields.has("progressManager")) {
      for (let start = 0; start < ids.length; start += 100) {
        const chunk = ids.slice(start, start + 100);
        const previous = await d1
          .prepare(
            `SELECT id, progress_manager
             FROM activities
             WHERE id IN (${chunk.map(() => "?").join(", ")})`,
          )
          .bind(...chunk)
          .all<{ id: number; progress_manager: string }>();
        previous.results.forEach((row) =>
          previousManagerById.set(Number(row.id), clean(row.progress_manager)),
        );
      }
    }
    let resolvedBudgetGroupId: number | null = null;
    let resolvedBudgetAliasKey = "";
    if (applyFields.has("budget") && requestedBudgetType) {
      await ensureBudgetNamesReady();
      const resolvedBudget = await resolveCanonicalBudgetName(
        d1,
        requestedBudgetType,
      );
      if (
        payload.standardBudgetOnly === true &&
        !resolvedBudget.groupId
      ) {
        return Response.json(
          { error: "관리자가 등록한 활성 표준 예산명을 선택해 주세요." },
          { status: 400 },
        );
      }
      budgetType = resolvedBudget.name;
      resolvedBudgetGroupId = resolvedBudget.groupId;
      resolvedBudgetAliasKey = resolvedBudget.aliasKey;
      for (let start = 0; start < ids.length; start += 100) {
        const chunk = ids.slice(start, start + 100);
        const previous = await d1
          .prepare(
            `SELECT id, budget_type, award_status
             FROM activities
             WHERE id IN (${chunk.map(() => "?").join(", ")})`,
          )
          .bind(...chunk)
          .all<{ id: number; budget_type: string; award_status: string }>();
        previousBudgetRows.push(...previous.results);
      }
    }
    const prepareBulkUpdate = (idChunk: number[]) => {
      const placeholders = idChunk.map(() => "?").join(", ");
      return d1
          .prepare(`UPDATE activities SET
            activity_date = CASE
              WHEN ? = 0 THEN activity_date
              ELSE ? END,
            date_confidence = CASE
              WHEN ? = 1 THEN '확정'
              ELSE date_confidence END,
            budget_type = CASE
              WHEN award_status IN ('협력사 수주', '타업체 수주') THEN budget_type
              WHEN ? = 1 AND ? IN ('협력사 수주', '타업체 수주') THEN budget_type
              WHEN ? = 0 OR ? = '' THEN budget_type
              WHEN ? = 1 AND TRIM(COALESCE(budget_type, '')) NOT IN ('', '미정', '예산') THEN budget_type
              ELSE ? END,
            budget_amount = CASE
              WHEN award_status IN ('협력사 수주', '타업체 수주') THEN budget_amount
              WHEN ? = 1 AND ? IN ('협력사 수주', '타업체 수주') THEN budget_amount
              WHEN ? = 0 OR ? = '' THEN budget_amount
              WHEN ? = 1 AND TRIM(COALESCE(budget_amount, '')) NOT IN ('', '미정') THEN budget_amount
              ELSE ? END,
            progress_manager = CASE
              WHEN ? = 1 AND ? = '협력사 수주' THEN '해당 없음'
              WHEN award_status = '협력사 수주' THEN '해당 없음'
              WHEN ? = 0 THEN progress_manager
              WHEN ? = 1 AND TRIM(COALESCE(progress_manager, '')) <> '' THEN progress_manager
              ELSE ? END,
            progress_manager_locked = CASE
              WHEN ? = 1 AND ? = '협력사 수주' THEN 0
              WHEN award_status = '협력사 수주' THEN 0
              WHEN ? = 0 THEN progress_manager_locked
              WHEN ? = 1 AND TRIM(COALESCE(progress_manager, '')) <> '' THEN progress_manager_locked
              ELSE 0 END,
            contact_name = CASE
              WHEN ? = 0 THEN contact_name
              WHEN ? = 1 AND TRIM(COALESCE(contact_name, '')) <> '' THEN contact_name
              ELSE ? END,
            follow_up_date = CASE
              WHEN ? = 1 AND ? = '납품 완료' THEN ''
              WHEN ? = 0 THEN follow_up_date
              WHEN ? = 1 AND TRIM(COALESCE(follow_up_date, '')) <> '' THEN follow_up_date
              ELSE ? END,
            follow_up_required = CASE
              WHEN ? = 1 AND ? = '납품 완료' THEN 0
              WHEN ? = 1 AND (? = 0 OR TRIM(COALESCE(follow_up_date, '')) = '') THEN 1
              ELSE follow_up_required END,
            next_action = CASE
              WHEN ? = 0 THEN next_action
              WHEN ? = 1 AND TRIM(COALESCE(next_action, '')) <> '' THEN next_action
              ELSE ? END,
            status = CASE
              WHEN ? = 1 AND ? IN ('위즈업 수주', '협력사 수주') THEN '수주 전환'
              WHEN ? = 1 AND ? = '타업체 수주' THEN '영업 종료'
              WHEN ? = 1 AND ? = '미정' AND status IN ('수주 후 진행', '수주 전환', '영업 종료') THEN '상담 진행'
              WHEN ? = 1 THEN ?
              ELSE status END,
            award_status = CASE WHEN ? = 1 THEN ? ELSE award_status END,
            award_company = CASE
              WHEN ? = 0 THEN award_company
              WHEN ? = '위즈업 수주' THEN '위즈업'
              WHEN ? IN ('협력사 수주', '타업체 수주') THEN ?
              ELSE '' END,
            execution_type = CASE
              WHEN ? = 0 THEN execution_type
              ELSE ? END,
            consortium_company = CASE
              WHEN ? = 0 THEN consortium_company
              WHEN ? = '컨소' THEN ?
              ELSE '' END,
            award_stage = CASE
              WHEN ? = 0 THEN award_stage
              ELSE ? END,
            award_completed_date = CASE
              WHEN ? = 0 THEN award_completed_date
              ELSE ? END,
            updated_by_member_id = ?,
            updated_by_name = ?,
            updated_at = CURRENT_TIMESTAMP
            WHERE id IN (${placeholders})`)
          .bind(
            applyFields.has("activityDate") ? 1 : 0,
            activityDate,
            applyFields.has("activityDate") ? 1 : 0,
            applyFields.has("awardStatus") ? 1 : 0,
            requestedAwardStatus,
            applyFields.has("budget") ? 1 : 0,
            budgetType,
            onlyEmpty ? 1 : 0,
            budgetType,
            applyFields.has("awardStatus") ? 1 : 0,
            requestedAwardStatus,
            applyFields.has("budget") ? 1 : 0,
            budgetAmount,
            onlyEmpty ? 1 : 0,
            budgetAmount,
            applyFields.has("awardStatus") ? 1 : 0,
            requestedAwardStatus,
            applyFields.has("progressManager") ? 1 : 0,
            onlyEmpty ? 1 : 0,
            progressManager,
            applyFields.has("awardStatus") ? 1 : 0,
            requestedAwardStatus,
            applyFields.has("progressManager") ? 1 : 0,
            onlyEmpty ? 1 : 0,
            applyFields.has("contactName") ? 1 : 0,
            onlyEmpty ? 1 : 0,
            contactName,
            applyFields.has("awardStage") ? 1 : 0,
            requestedAwardStage,
            applyFields.has("followUpDate") ? 1 : 0,
            onlyEmpty ? 1 : 0,
            followUpDate,
            applyFields.has("awardStage") ? 1 : 0,
            requestedAwardStage,
            applyFields.has("followUpDate") ? 1 : 0,
            onlyEmpty ? 1 : 0,
            applyFields.has("nextAction") ? 1 : 0,
            onlyEmpty ? 1 : 0,
            nextAction,
            applyFields.has("awardStatus") ? 1 : 0,
            requestedAwardStatus,
            applyFields.has("awardStatus") ? 1 : 0,
            requestedAwardStatus,
            applyFields.has("awardStatus") ? 1 : 0,
            requestedAwardStatus,
            applyFields.has("status") ? 1 : 0,
            requestedStatus,
            applyFields.has("awardStatus") ? 1 : 0,
            requestedAwardStatus,
            applyFields.has("awardStatus") ? 1 : 0,
            requestedAwardStatus,
            requestedAwardStatus,
            requestedAwardCompany,
            applyFields.has("executionType") ? 1 : 0,
            requestedExecutionType,
            applyFields.has("executionType") ? 1 : 0,
            requestedExecutionType,
            requestedConsortiumCompany,
            applyFields.has("awardStage") ? 1 : 0,
            requestedAwardStage,
            applyFields.has("awardStage") ? 1 : 0,
            requestedAwardCompletedDate,
            member.id,
            member.displayName,
            ...idChunk,
          );
    };

    let changeBatch:
      | {
          id: string;
          label: string;
          total: number;
          itemCount: number;
          newlyApplied: number;
          retrySkipped: number;
          status: string;
          undoable: boolean;
        }
      | undefined;
    if (operationId) {
      await ensureActivityChangeLedgerReady();
      const requestedFieldsJson = JSON.stringify([...applyFields].sort());
      const existingBatch = await getActivityChangeBatch(d1, operationId);
      if (
        existingBatch &&
        (Number(existingBatch.actor_member_id) !== member.id ||
          existingBatch.scope !== requestedOperationScope)
      ) {
        return Response.json(
          { error: "이미 다른 작업에서 사용 중인 일괄 변경 식별자입니다." },
          { status: 409 },
        );
      }
      if (
        existingBatch &&
        (Number(existingBatch.operation_total) !== operationTotal ||
          existingBatch.operation_label !== operationLabel ||
          existingBatch.requested_fields_json !== requestedFieldsJson)
      ) {
        return Response.json(
          {
            error:
              "같은 일괄 변경 식별자에 서로 다른 작업 정보가 전달되었습니다.",
          },
          { status: 409 },
        );
      }
      if (existingBatch?.undone_at) {
        return Response.json(
          { error: "이미 되돌린 일괄 변경 작업은 다시 적용할 수 없습니다." },
          { status: 409 },
        );
      }
      const existingItemIds = await existingActivityChangeItemIds(
        d1,
        operationId,
        ids,
      );
      const pendingIds = ids.filter((id) => !existingItemIds.has(id));
      for (const chunk of chunkValues(
        pendingIds,
        ACTIVITY_CHANGE_WRITE_CHUNK_SIZE,
      )) {
        const statements = [
          prepareActivityChangeBatchUpsert(d1, {
            operationId,
            operationLabel,
            operationTotal,
            requestedFieldsJson,
            scope: requestedOperationScope,
            member,
          }),
        ];
        for (const id of chunk) {
          statements.push(
            prepareActivityChangeSnapshot(d1, {
              operationId,
              activityId: id,
              requestedFieldsJson,
            }),
          );
        }
        statements.push(prepareBulkUpdate(chunk));
        for (const id of chunk) {
          statements.push(
            prepareActivityChangeFinalization(d1, operationId, id),
          );
        }
        statements.push(prepareActivityChangeBatchProgress(d1, operationId));
        await d1.batch(statements);
      }
      if (!pendingIds.length && !existingBatch) {
        await d1.batch([
          prepareActivityChangeBatchUpsert(d1, {
            operationId,
            operationLabel,
            operationTotal,
            requestedFieldsJson,
            scope: requestedOperationScope,
            member,
          }),
          prepareActivityChangeBatchProgress(d1, operationId),
        ]);
      }
      const finalBatch = await getActivityChangeBatch(d1, operationId);
      changeBatch = finalBatch
        ? {
            id: finalBatch.id,
            label: finalBatch.operation_label,
            total: Number(finalBatch.operation_total) || operationTotal,
            itemCount: Number(finalBatch.item_count) || 0,
            newlyApplied: pendingIds.length,
            retrySkipped: ids.length - pendingIds.length,
            status: finalBatch.status,
            undoable: !finalBatch.undone_at && Number(finalBatch.item_count) > 0,
          }
        : undefined;
    } else {
      for (
        let start = 0;
        start < ids.length;
        start += RECORD_BULK_UPDATE_CHUNK_SIZE
      ) {
        const chunk = ids.slice(
          start,
          start + RECORD_BULK_UPDATE_CHUNK_SIZE,
        );
        await prepareBulkUpdate(chunk).run();
      }
    }
    if (
      applyFields.has("progressManager") &&
      progressManager &&
      progressManager !== "해당 없음"
    ) {
      await ensureActivityAssignmentHistoryReady();
      const target = await d1
        .prepare(
          `SELECT id
           FROM members
           WHERE display_name = ? AND status = 'approved' AND is_sales = 1
           LIMIT 1`,
        )
        .bind(progressManager)
        .first<{ id: number }>();
      if (target) {
        const changedIds: number[] = [];
        for (let start = 0; start < ids.length; start += 100) {
          const chunk = ids.slice(start, start + 100);
          const current = await d1
            .prepare(
              `SELECT id, progress_manager
               FROM activities
               WHERE id IN (${chunk.map(() => "?").join(", ")})`,
            )
            .bind(...chunk)
            .all<{ id: number; progress_manager: string }>();
          current.results.forEach((row) => {
            const id = Number(row.id);
            if (
              clean(row.progress_manager) === progressManager &&
              previousManagerById.get(id) !== progressManager
            ) {
              changedIds.push(id);
            }
          });
        }
        for (let start = 0; start < changedIds.length; start += 40) {
          const chunk = changedIds.slice(start, start + 40);
          await d1.batch(
            chunk.map((activityId) =>
              d1
                .prepare(
                  `INSERT INTO activity_assignment_history (
                     activity_id, from_manager, to_member_id, to_manager,
                     changed_by_member_id, changed_by_name
                   ) VALUES (?, ?, ?, ?, ?, ?)`,
                )
                .bind(
                  activityId,
                  previousManagerById.get(activityId) ?? "",
                  target.id,
                  progressManager,
                  member.id,
                  member.displayName,
                ),
            ),
          );
        }
        await reassignOpenCorrectionRequests(
          changedIds,
          progressManager,
          member.id,
        );
      }
    }
    if (applyFields.has("budget") && requestedBudgetType) {
      const currentAwardById = new Map<number, string>();
      for (let start = 0; start < ids.length; start += 100) {
        const chunk = ids.slice(start, start + 100);
        const current = await d1
          .prepare(
            `SELECT id, award_status AS awardStatus
             FROM activities
             WHERE id IN (${chunk.map(() => "?").join(", ")})`,
          )
          .bind(...chunk)
          .all<{ id: number; awardStatus: string }>();
        for (const row of current.results) {
          currentAwardById.set(Number(row.id), clean(row.awardStatus));
        }
      }
      const resolvedBudget = await resolveCanonicalBudgetName(
        d1,
        requestedBudgetType,
      );
      for (const row of previousBudgetRows) {
        const originalName = clean(row.budget_type);
        const shouldApply =
          !onlyEmpty || ["", "미정", "예산"].includes(originalName);
        if (!shouldApply) continue;
        const currentAwardStatus =
          currentAwardById.get(row.id) || clean(row.award_status);
        const eligible = !["협력사 수주", "타업체 수주"].includes(
          currentAwardStatus,
        );
        if (eligible) {
          const amountMode =
            resolvedBudget.budgetKind === "self" && !budgetAmount
              ? resolvedBudget.amountMode
              : "manual";
          await d1
            .prepare(
              `UPDATE activities
               SET budget_original_name = CASE
                     WHEN TRIM(COALESCE(budget_original_name, '')) = ''
                       THEN ?
                     ELSE budget_original_name
                   END,
                   budget_group_id = ?, budget_match_status = ?,
                   budget_match_method = ?, budget_request_id = NULL,
                   budget_kind = ?, budget_amount_mode = ?,
                   budget_amount_override = CASE
                     WHEN ? = 'manual' AND ? <> '' THEN ?
                     ELSE budget_amount_override
                   END,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
            )
            .bind(
              requestedBudgetType,
              resolvedBudget.groupId,
              resolvedBudget.matchStatus,
              resolvedBudget.matchMethod,
              resolvedBudget.budgetKind,
              amountMode,
              amountMode,
              budgetAmount,
              budgetAmount,
              row.id,
            )
            .run();
        }
        await linkBudgetNameEntity(d1, {
          entityType: "activity",
          entityId: row.id,
          groupId: eligible ? resolvedBudgetGroupId : null,
          originalName: requestedBudgetType,
          aliasKey: resolvedBudgetAliasKey,
        });
      }
    }
    return Response.json({
      updatedIds: ids,
      ...(changeBatch ? { changeBatch } : {}),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = (await request.json()) as {
      id?: number;
      ids?: unknown[];
      organizations?: unknown[];
      adminAwardDelete?: boolean;
      dataControl?: boolean;
    };
    const member = payload.dataControl
      ? await requirePrimaryOwner()
      : payload.adminAwardDelete
        ? await requireAdminMember()
        : await requireApprovedMember();
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
      ids.length > 500 ||
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
    await ensureQuotationDocumentsReady();
    if (payload.dataControl) await ensureAccountingReady();
    await ensureActivityAssignmentHistoryReady();
    await ensureActivityReviewsReady();
    await ensureManagerAlertsReady();
    await ensureTrashReady();
    const selected = ids.length ? ids : organizations;
    const chunks = Array.from(
      { length: Math.ceil(selected.length / 50) },
      (_, index) => selected.slice(index * 50, index * 50 + 50),
    );

    const activityRows: Record<string, unknown>[] = [];
    for (const chunk of chunks) {
      const placeholders = chunk.map(() => "?").join(", ");
      const whereClause = ids.length
        ? `id IN (${placeholders})`
        : `organization IN (${placeholders})`;
      const result = await d1
        .prepare(`SELECT * FROM activities WHERE ${whereClause}`)
        .bind(...chunk)
        .all<Record<string, unknown>>();
      activityRows.push(...result.results);
    }
    const deletedCount = activityRows.length;
    const selectedActivityIds = activityRows
      .map((row) => Number(row.id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    const affectedOrganizations = [
      ...new Set(
        activityRows
          .map((row) => clean(row.organization))
          .filter(Boolean),
      ),
    ];
    const selectedCountByOrganization = new Map<string, number>();
    activityRows.forEach((row) => {
      const organization = clean(row.organization);
      if (!organization) return;
      selectedCountByOrganization.set(
        organization,
        (selectedCountByOrganization.get(organization) || 0) + 1,
      );
    });
    const totalCountByOrganization = new Map<string, number>();
    for (let index = 0; index < affectedOrganizations.length; index += 50) {
      const chunk = affectedOrganizations.slice(index, index + 50);
      const placeholders = chunk.map(() => "?").join(", ");
      const result = await d1
        .prepare(
          `SELECT organization, COUNT(*) AS count
           FROM activities
           WHERE organization IN (${placeholders})
           GROUP BY organization`,
        )
        .bind(...chunk)
        .all<{ organization: string; count: number }>();
      result.results.forEach((row) =>
        totalCountByOrganization.set(row.organization, Number(row.count) || 0),
      );
    }
    const cleanupOrganizations = organizations.length
      ? organizations
      : affectedOrganizations.filter(
          (organization) =>
            (selectedCountByOrganization.get(organization) || 0) >=
            (totalCountByOrganization.get(organization) || 0),
        );

    const businessKey = (organization: string, businessRound: number) =>
      `${organization}\u0000${businessRound}`;
    const selectedCountByBusiness = new Map<string, number>();
    activityRows.forEach((row) => {
      const organization = clean(row.organization);
      const businessRound = Math.max(1, Number(row.business_round) || 1);
      if (!organization) return;
      const key = businessKey(organization, businessRound);
      selectedCountByBusiness.set(key, (selectedCountByBusiness.get(key) || 0) + 1);
    });
    const selectedBusinessPairs = [
      ...new Map(
        activityRows
          .map((row) => {
            const organization = clean(row.organization);
            const businessRound = Math.max(1, Number(row.business_round) || 1);
            return [
              businessKey(organization, businessRound),
              { organization, businessRound },
            ] as const;
          })
          .filter(([, pair]) => Boolean(pair.organization)),
      ).values(),
    ];
    const totalCountByBusiness = new Map<string, number>();
    for (let index = 0; index < selectedBusinessPairs.length; index += 25) {
      const chunk = selectedBusinessPairs.slice(index, index + 25);
      const whereClause = chunk
        .map(() => "(organization = ? AND business_round = ?)")
        .join(" OR ");
      const result = await d1
        .prepare(
          `SELECT organization, business_round, COUNT(*) AS count
           FROM activities
           WHERE ${whereClause}
           GROUP BY organization, business_round`,
        )
        .bind(...chunk.flatMap((pair) => [pair.organization, pair.businessRound]))
        .all<{ organization: string; business_round: number; count: number }>();
      result.results.forEach((row) =>
        totalCountByBusiness.set(
          businessKey(row.organization, Math.max(1, Number(row.business_round) || 1)),
          Number(row.count) || 0,
        ),
      );
    }
    const cleanupBusinessPairs = selectedBusinessPairs.filter((pair) => {
      const key = businessKey(pair.organization, pair.businessRound);
      return (
        (selectedCountByBusiness.get(key) || 0) >=
        (totalCountByBusiness.get(key) || 0)
      );
    });

    const snapshot: TrashSnapshot = { tables: { activities: activityRows } };
    const loadRows = async (
      table: string,
      column: string,
      values: Array<string | number>,
    ) => {
      const rows: Record<string, unknown>[] = [];
      for (let index = 0; index < values.length; index += 50) {
        const chunk = values.slice(index, index + 50);
        const placeholders = chunk.map(() => "?").join(", ");
        const result = await d1
          .prepare(`SELECT * FROM ${table} WHERE ${column} IN (${placeholders})`)
          .bind(...chunk)
          .all<Record<string, unknown>>();
        rows.push(...result.results);
      }
      snapshot.tables[table] = rows;
      return rows;
    };
    const loadBusinessRows = async (table: string) => {
      const rows: Record<string, unknown>[] = [];
      for (let index = 0; index < cleanupBusinessPairs.length; index += 25) {
        const chunk = cleanupBusinessPairs.slice(index, index + 25);
        const whereClause = chunk
          .map(() => "(organization = ? AND business_round = ?)")
          .join(" OR ");
        const result = await d1
          .prepare(`SELECT * FROM ${table} WHERE ${whereClause}`)
          .bind(...chunk.flatMap((pair) => [pair.organization, pair.businessRound]))
          .all<Record<string, unknown>>();
        rows.push(...result.results);
      }
      snapshot.tables[table] = rows;
      return rows;
    };
    await Promise.all([
      loadRows("activity_authors", "activity_id", selectedActivityIds),
      loadRows(
        "activity_assignment_history",
        "activity_id",
        selectedActivityIds,
      ),
      loadRows(
        "activity_review_acknowledgements",
        "activity_id",
        selectedActivityIds,
      ),
      loadRows("ai_recommendations", "activity_id", selectedActivityIds),
      loadRows(
        "organization_locations",
        "organization",
        cleanupOrganizations,
      ),
      loadRows(
        "manager_alert_acknowledgements",
        "organization",
        cleanupOrganizations,
      ),
      loadBusinessRows("sales_campaign_targets"),
      loadBusinessRows("quotation_documents"),
    ]);
    const projectRows = await loadBusinessRows("equipment_projects");
    await loadRows(
      "equipment_items",
      "project_id",
      projectRows
        .map((row) => Number(row.id))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    );
    if (payload.dataControl) {
      const settlementRows = await loadRows(
        "accounting_settlements",
        "activity_id",
        selectedActivityIds,
      );
      await loadRows(
        "accounting_settlement_history",
        "settlement_id",
        settlementRows
          .map((row) => Number(row.id))
          .filter((id) => Number.isSafeInteger(id) && id > 0),
      );
      const commissionRows = await loadRows(
        "accounting_commission_entries",
        "activity_id",
        selectedActivityIds,
      );
      const commissionIds = commissionRows
        .map((row) => Number(row.id))
        .filter((id) => Number.isSafeInteger(id) && id > 0);
      await Promise.all([
        loadRows(
          "accounting_commission_entry_history",
          "entry_id",
          commissionIds,
        ),
        loadRows("accounting_collection_receipts", "entry_id", commissionIds),
      ]);
    }
    const snapshotRowCount = Object.values(snapshot.tables).reduce(
      (total, rows) => total + rows.length,
      0,
    );
    let trashBatchId = "";
    if (snapshotRowCount > 0) {
      const displayName = organizations.length
        ? organizations.length === 1
          ? organizations[0]
          : `${organizations.slice(0, 2).join(", ")} 외 ${Math.max(0, organizations.length - 2)}곳`
        : activityRows.length === 1
          ? `${clean(activityRows[0].organization) || "기관"} 기록`
          : `활동 기록 ${activityRows.length}건`;
      trashBatchId = await createTrashBatch(
        d1,
        member,
        organizations.length || payload.dataControl ? "institution" : "record",
        displayName,
        organizations.length || activityRows.length,
        snapshot,
      );
    }

    const rowIds = (table: string, column = "id") =>
      (snapshot.tables[table] || [])
        .map((row) => Number(row[column]))
        .filter((id) => Number.isSafeInteger(id) && id > 0);
    const deleteRowsByIds = (
      table: string,
      column: string,
      values: number[],
    ) =>
      chunkValues([...new Set(values)], 50).map((chunk) => {
        const placeholders = chunk.map(() => "?").join(", ");
        return d1
          .prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`)
          .bind(...chunk);
      });
    const commissionIds = rowIds("accounting_commission_entries");
    const settlementIds = rowIds("accounting_settlements");
    const projectIds = rowIds("equipment_projects");
    const deleteStatements: Array<ReturnType<typeof d1.prepare>> = [
      ...deleteRowsByIds(
        "accounting_collection_receipts",
        "entry_id",
        commissionIds,
      ),
      ...deleteRowsByIds(
        "accounting_commission_entry_history",
        "entry_id",
        commissionIds,
      ),
      ...deleteRowsByIds(
        "accounting_settlement_history",
        "settlement_id",
        settlementIds,
      ),
      ...deleteRowsByIds(
        "accounting_commission_entries",
        "id",
        commissionIds,
      ),
      ...deleteRowsByIds("accounting_settlements", "id", settlementIds),
      ...deleteRowsByIds(
        "activity_review_acknowledgements",
        "activity_id",
        selectedActivityIds,
      ),
      ...deleteRowsByIds(
        "activity_assignment_history",
        "activity_id",
        selectedActivityIds,
      ),
      ...deleteRowsByIds("activity_authors", "activity_id", selectedActivityIds),
      ...deleteRowsByIds(
        "ai_recommendations",
        "activity_id",
        selectedActivityIds,
      ),
      ...deleteRowsByIds("activities", "id", selectedActivityIds),
      ...deleteRowsByIds("equipment_items", "project_id", projectIds),
      ...deleteRowsByIds("equipment_projects", "id", projectIds),
      ...deleteRowsByIds(
        "sales_campaign_targets",
        "id",
        rowIds("sales_campaign_targets"),
      ),
      ...deleteRowsByIds(
        "quotation_documents",
        "id",
        rowIds("quotation_documents"),
      ),
    ];
    const cleanupChunks = Array.from(
      { length: Math.ceil(cleanupOrganizations.length / 50) },
      (_, index) => cleanupOrganizations.slice(index * 50, index * 50 + 50),
    );
    for (const chunk of cleanupChunks) {
      const placeholders = chunk.map(() => "?").join(", ");
      deleteStatements.push(
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
            `DELETE FROM manager_alert_acknowledgements
             WHERE organization IN (${placeholders})
               AND NOT EXISTS (
                 SELECT 1 FROM activities
                 WHERE activities.organization = manager_alert_acknowledgements.organization
               )`,
          )
          .bind(...chunk),
      );
    }
    try {
      if (deleteStatements.length) {
        await d1.batch(deleteStatements);
      }
    } catch (error) {
      if (trashBatchId) {
        await d1
          .prepare("DELETE FROM deletion_batches WHERE id = ?")
          .bind(trashBatchId)
          .run()
          .catch(() => undefined);
      }
      throw error;
    }
    if (payload.dataControl && trashBatchId) {
      await logDataControlEvent({
        action: "archive",
        subject:
          affectedOrganizations.length === 1
            ? affectedOrganizations[0]
            : `${affectedOrganizations.length}개 기관·사업`,
        itemCount: deletedCount,
        archiveIds: [trashBatchId],
        actorMemberId: member.id,
        actorName: member.displayName,
        details: {
          organizations: affectedOrganizations,
          businessRounds: cleanupBusinessPairs,
        },
      }).catch(() => undefined);
    }
    return Response.json({
      ok: true,
      deletedCount,
      deletedOrganizations: organizations.length,
      trashBatchId,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
