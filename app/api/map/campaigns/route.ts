import {
  accessErrorResponse,
  canCollaborativelyManageSalesRecords,
  requireApprovedMember,
  requirePrimaryOwner,
} from "../../../../lib/collaboration";
import { ensureCampaignsReady } from "../../../../lib/campaign-store";
import {
  clean,
  ensureRecordsReady,
  insertActivity,
} from "../../../../lib/records-store";
import { regionFromAddress } from "../../../../lib/region-from-address";
import {
  institutionAliasKey,
  institutionConfirmationResponse,
} from "../../../../lib/institution-names";
import {
  ensureBudgetNamesReady,
  normalizeBudgetNameKey,
  resolveBudgetRecordMetadata,
} from "../../../../lib/budget-names";
import { transferActivityAssignment } from "../../../../lib/activity-assignment-history";
import {
  buildCampaignAssignmentBackfillStatements,
  buildCampaignInstitutionBasicsBackfillStatements,
  buildCampaignTargetLegacyAssigneeRepairStatement,
  buildCampaignTargetLegacyLinkRepairStatements,
  buildCampaignTargetLinkedActivitySyncStatement,
  syncCampaignTargetsFromActivity,
} from "../../../../lib/campaign-institution-basics";
import {
  createTrashBatch,
  ensureTrashReady,
} from "../../../../lib/trash-store";
import { ensureJointProjectsReady } from "../../../../lib/joint-projects";
import { parseStoredActivityBudgetMoney } from "../../../../lib/activity-budgets";

export const dynamic = "force-dynamic";

type BusinessMatchMode = "auto" | "link-current" | "new" | "list-only";

type CampaignTargetInput = {
  organization?: unknown;
  region?: unknown;
  address?: unknown;
  phone?: unknown;
  contactName?: unknown;
  notes?: unknown;
  assignedMemberId?: unknown;
  budgetAmount?: unknown;
  schoolLevel?: unknown;
  supplyItems?: unknown;
  reviewNote?: unknown;
  businessMatchMode?: unknown;
  linkedActivityId?: unknown;
  updateLinkedBudget?: unknown;
};

type ExistingActivity = {
  id: number;
  organization: string;
  business_round: number;
  activity_date: string;
  region: string;
  budget_type: string;
  budget_original_name: string;
  budget_group_id: number | null;
  award_status: string;
  progress_manager: string;
  contact_role: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
};

type TargetPlan = {
  target: ReturnType<typeof cleanTarget>;
  organization: string;
  activityId: number | null;
  businessRound: number;
  createdActivity: boolean;
  correctBudget: boolean;
  inheritedContactRole: string;
  inheritedContactEmail: string;
  progressManager: string;
};

function localDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function cleanBudgetKey(value: unknown) {
  return clean(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function parseMoney(value: unknown) {
  const text = clean(value).replaceAll(",", "");
  if (!text) return null;
  const number = Number(text.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(number)) return null;
  if (/억/.test(text)) return Math.round(number * 100_000_000);
  if (/천만/.test(text)) return Math.round(number * 10_000_000);
  if (/백만/.test(text)) return Math.round(number * 1_000_000);
  if (/만원|만\b/.test(text)) return Math.round(number * 10_000);
  return Math.max(0, Math.round(number));
}

function normalizeBusinessMatchMode(value: unknown): BusinessMatchMode {
  return value === "link-current" ||
    value === "new" ||
    value === "list-only"
    ? value
    : "auto";
}

function usableProgressManager(value: unknown) {
  const name = clean(value);
  return name === "해당 없음" ? "" : name;
}

function cleanTarget(value: CampaignTargetInput) {
  const address = clean(value.address).slice(0, 500);
  return {
    organization: clean(value.organization).slice(0, 120),
    region: clean(value.region).slice(0, 120) || regionFromAddress(address),
    address,
    phone: clean(value.phone).slice(0, 100),
    contactName: clean(value.contactName).slice(0, 120),
    notes: clean(value.notes).slice(0, 1000),
    assignedMemberId: Number(value.assignedMemberId) || null,
    budgetAmount: parseMoney(value.budgetAmount),
    schoolLevel: clean(value.schoolLevel).slice(0, 100),
    supplyItems: clean(value.supplyItems).slice(0, 500),
    reviewNote: clean(value.reviewNote).slice(0, 500),
    businessMatchMode: normalizeBusinessMatchMode(value.businessMatchMode),
    linkedActivityId: Math.max(0, Math.trunc(Number(value.linkedActivityId) || 0)) || null,
    updateLinkedBudget: value.updateLinkedBudget === true,
  };
}

function chunks<T>(values: T[], size = 50) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function runStatementsInChunks(
  d1: D1Database,
  statements: Array<ReturnType<D1Database["prepare"]>>,
  size = 40,
) {
  for (const statementChunk of chunks(statements, size)) {
    if (statementChunk.length) await d1.batch(statementChunk);
  }
}

async function backfillCampaignInstitutionBasics(d1: D1Database) {
  await d1.batch(
    buildCampaignTargetLegacyLinkRepairStatements().map((statement) =>
      d1.prepare(statement),
    ),
  );
  await d1
    .prepare(buildCampaignTargetLinkedActivitySyncStatement())
    .run();
  await d1
    .prepare(buildCampaignTargetLegacyAssigneeRepairStatement())
    .run();
  await d1.batch(
    buildCampaignInstitutionBasicsBackfillStatements().map((statement) =>
      d1.prepare(statement),
    ),
  );
  await d1
    .prepare(
      `UPDATE sales_campaign_targets
       SET assigned_member_id = (
             SELECT member.id
             FROM activities previous
             JOIN members member
               ON member.display_name = TRIM(previous.progress_manager)
              AND member.status = 'approved'
              AND member.is_sales = 1
             WHERE previous.organization = sales_campaign_targets.organization
               AND previous.business_round =
                   sales_campaign_targets.business_round
               AND TRIM(COALESCE(previous.progress_manager, '')) <> ''
               AND previous.progress_manager <> '해당 없음'
             ORDER BY
               previous.activity_date DESC,
               previous.id DESC
             LIMIT 1
           ),
           updated_at = CURRENT_TIMESTAMP
       WHERE assigned_member_id IS NULL
         AND EXISTS (
           SELECT 1
           FROM activities previous
           JOIN members member
             ON member.display_name = TRIM(previous.progress_manager)
            AND member.status = 'approved'
            AND member.is_sales = 1
           WHERE previous.organization = sales_campaign_targets.organization
             AND previous.business_round =
                 sales_campaign_targets.business_round
             AND TRIM(COALESCE(previous.progress_manager, '')) <> ''
             AND previous.progress_manager <> '해당 없음'
         )`,
    )
    .run();
  for (const statement of buildCampaignAssignmentBackfillStatements()) {
    await d1.prepare(statement).run();
  }
  const linkedBudgets = await d1
    .prepare(
      `SELECT
         target.id,
         target.budget_amount,
         activity.budget_amount AS activity_budget_amount
       FROM sales_campaign_targets target
       JOIN activities activity ON activity.id = target.activity_id
       WHERE target.budget_amount IS NOT NULL
         AND TRIM(COALESCE(activity.budget_amount, '')) <> ''`,
    )
    .all<{
      id: number;
      budget_amount: number;
      activity_budget_amount: string;
    }>();
  const budgetRepairs = linkedBudgets.results.flatMap((row) => {
    const oldParsedAmount = parseMoney(row.activity_budget_amount);
    const correctedAmount = parseStoredActivityBudgetMoney(
      row.activity_budget_amount,
    );
    if (
      oldParsedAmount === null ||
      correctedAmount <= 0 ||
      correctedAmount === oldParsedAmount ||
      Number(row.budget_amount) !== oldParsedAmount
    ) {
      return [];
    }
    return [
      d1
        .prepare(
          `UPDATE sales_campaign_targets
           SET budget_amount = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND budget_amount = ?`,
        )
        .bind(correctedAmount, Number(row.id), oldParsedAmount),
    ];
  });
  await runStatementsInChunks(d1, budgetRepairs);
}

async function removeCreatedActivities(
  d1: D1Database,
  activityIds: number[],
) {
  for (const ids of chunks([...new Set(activityIds)])) {
    if (!ids.length) continue;
    const placeholders = ids.map(() => "?").join(", ");
    await d1.batch([
      d1
        .prepare(
          `DELETE FROM budget_name_request_records
           WHERE entity_type = 'activity' AND entity_id IN (${placeholders})`,
        )
        .bind(...ids),
      d1
        .prepare(
          `DELETE FROM budget_name_members
           WHERE entity_type = 'activity' AND entity_id IN (${placeholders})`,
        )
        .bind(...ids),
      d1
        .prepare(
          `DELETE FROM ai_recommendations WHERE activity_id IN (${placeholders})`,
        )
        .bind(...ids),
      d1
        .prepare(
          `DELETE FROM activity_authors WHERE activity_id IN (${placeholders})`,
        )
        .bind(...ids),
      d1
        .prepare(
          `DELETE FROM activity_assignment_history
           WHERE activity_id IN (${placeholders})`,
        )
        .bind(...ids),
      d1
        .prepare(
          `DELETE FROM activity_review_acknowledgements
           WHERE activity_id IN (${placeholders})`,
        )
        .bind(...ids),
      d1
        .prepare(
          `DELETE FROM activity_change_items
           WHERE activity_id IN (${placeholders})`,
        )
        .bind(...ids),
      d1
        .prepare(`DELETE FROM activities WHERE id IN (${placeholders})`)
        .bind(...ids),
    ]);
  }
}

async function removeIncompleteCampaign(d1: D1Database, campaignId: number) {
  const linkedActivities = await d1
    .prepare(
      `SELECT activity_id
       FROM sales_campaign_targets
       WHERE campaign_id = ? AND created_activity = 1 AND activity_id IS NOT NULL`,
    )
    .bind(campaignId)
    .all<{ activity_id: number }>();
  const seededActivities = await d1
    .prepare("SELECT id FROM activities WHERE seed_key LIKE ?")
    .bind(`campaign:${campaignId}:%`)
    .all<{ id: number }>();
  const activityIds = [
    ...linkedActivities.results.map((row) => Number(row.activity_id)),
    ...seededActivities.results.map((row) => Number(row.id)),
  ].filter((id) => Number.isInteger(id) && id > 0);
  await d1
    .prepare("DELETE FROM sales_campaign_targets WHERE campaign_id = ?")
    .bind(campaignId)
    .run();
  await removeCreatedActivities(d1, activityIds);
  await d1
    .prepare("DELETE FROM sales_campaigns WHERE id = ?")
    .bind(campaignId)
    .run();
}

export async function GET() {
  try {
    await requireApprovedMember();
    await Promise.all([
      ensureRecordsReady(),
      ensureBudgetNamesReady(),
      ensureJointProjectsReady(),
    ]);
    const d1 = await ensureCampaignsReady();
    await backfillCampaignInstitutionBasics(d1);
    const [campaigns, targets, members, budgetCatalog] = await Promise.all([
      d1
        .prepare(`
          SELECT
            c.id,
            c.name,
            c.notes,
            c.budget_group_id,
            c.budget_match_status,
            c.budget_match_method,
            c.budget_request_id,
            c.budget_kind,
            c.budget_amount_mode,
            c.selection_date,
            c.default_budget_amount,
            c.source_file_name,
            c.import_source,
            c.created_by,
            c.created_at,
            c.updated_at,
            COALESCE(g.canonical_name, c.budget_type) AS budget_type,
            m.display_name AS created_by_name,
            COUNT(t.id) AS target_count,
            SUM(
              CASE
                WHEN COALESCE(current_member.id, t.assigned_member_id) IS NOT NULL
                  THEN 1
                ELSE 0
              END
            ) AS assigned_count
          FROM sales_campaigns c
          LEFT JOIN budget_name_groups g
            ON g.id = c.budget_group_id
           AND g.active = 1
          LEFT JOIN members m ON m.id = c.created_by
          LEFT JOIN sales_campaign_targets t ON t.campaign_id = c.id
          LEFT JOIN activities current_activity
            ON current_activity.id = (
              SELECT a.id
              FROM activities a
              WHERE a.organization = t.organization
                AND a.business_round = t.business_round
              ORDER BY a.activity_date DESC, a.id DESC
              LIMIT 1
            )
          LEFT JOIN activities institution_activity
            ON institution_activity.id = (
              SELECT a.id
              FROM activities a
              WHERE a.organization = t.organization
              ORDER BY a.activity_date DESC, a.id DESC
              LIMIT 1
            )
           LEFT JOIN activities manager_activity
             ON manager_activity.id = (
               SELECT a.id
               FROM activities a
               WHERE a.organization = t.organization
                 AND a.business_round = t.business_round
                 AND TRIM(COALESCE(a.progress_manager, '')) <> ''
                 AND a.progress_manager <> '해당 없음'
               ORDER BY
                 a.activity_date DESC,
                 a.id DESC
               LIMIT 1
             )
           LEFT JOIN members current_member
             ON current_member.display_name =
                  NULLIF(manager_activity.progress_manager, '')
            AND current_member.status = 'approved'
            AND current_member.is_sales = 1
           WHERE c.import_status = 'complete'
           GROUP BY c.id, g.canonical_name, m.display_name
          ORDER BY c.selection_date DESC, c.created_at DESC, c.id DESC
        `)
        .all(),
      d1
        .prepare(`
          WITH joint_target_candidates AS (
            SELECT
              source_target.id AS target_id,
              linked.id AS member_id,
              ROW_NUMBER() OVER (
                PARTITION BY source_target.id
                ORDER BY
                  CASE WHEN linked.campaign_target_id = source_target.id THEN 0 ELSE 1 END,
                  linked.updated_at DESC,
                  linked.id DESC
              ) AS row_number
            FROM sales_campaign_targets source_target
            JOIN sales_campaigns source_campaign
              ON source_campaign.id = source_target.campaign_id
            JOIN joint_project_members linked
              ON linked.campaign_target_id = source_target.id
            JOIN joint_projects linked_project
              ON linked_project.id = linked.project_id
             AND linked_project.status = 'active'
          )
          SELECT
            t.*,
            current_activity.activity_date AS current_activity_date,
            current_activity.status AS current_status,
            current_activity.award_status AS current_award_status,
            current_activity.award_stage AS current_award_stage,
            current_activity.budget_type AS current_budget_type,
            current_activity.next_action AS current_next_action,
            COALESCE(
              NULLIF(manager_activity.progress_manager, ''),
              ''
            ) AS current_progress_manager,
            COALESCE(
              NULLIF(current_activity.contact_name, ''),
              NULLIF(institution_activity.contact_name, ''),
              t.contact_name
            )
              AS current_contact_name,
            COALESCE(
              NULLIF(current_activity.contact_phone, ''),
              NULLIF(institution_activity.contact_phone, ''),
              t.phone
            )
              AS current_phone,
            COALESCE(current_member.id, t.assigned_member_id)
              AS current_assigned_member_id,
            COALESCE(current_member.display_name, assigned_member.display_name, '')
              AS assigned_member_name,
            jp.id AS joint_project_id,
            jp.name AS joint_project_name,
            jp.sponsor_organization AS joint_project_sponsor,
            jp.budget_group_id AS joint_project_budget_group_id,
            jp.budget_type AS joint_project_budget_type,
            jp.project_year AS joint_project_year,
            jp.joint_round AS joint_project_round,
            jpm.role AS joint_project_role,
            jpm.budget_amount AS joint_project_member_budget_amount
          FROM sales_campaign_targets t
          JOIN sales_campaigns c
            ON c.id = t.campaign_id AND c.import_status = 'complete'
          LEFT JOIN activities current_activity
            ON current_activity.id = (
              SELECT a.id
              FROM activities a
              WHERE a.organization = t.organization
                AND a.business_round = t.business_round
              ORDER BY a.activity_date DESC, a.id DESC
              LIMIT 1
            )
          LEFT JOIN activities institution_activity
            ON institution_activity.id = (
              SELECT a.id
              FROM activities a
              WHERE a.organization = t.organization
              ORDER BY a.activity_date DESC, a.id DESC
              LIMIT 1
            )
          LEFT JOIN activities manager_activity
            ON manager_activity.id = (
              SELECT a.id
              FROM activities a
              WHERE a.organization = t.organization
                AND a.business_round = t.business_round
                AND TRIM(COALESCE(a.progress_manager, '')) <> ''
                AND a.progress_manager <> '해당 없음'
              ORDER BY
                a.activity_date DESC,
                a.id DESC
              LIMIT 1
            )
          LEFT JOIN members current_member
            ON current_member.display_name =
                 NULLIF(manager_activity.progress_manager, '')
           AND current_member.status = 'approved'
           AND current_member.is_sales = 1
          LEFT JOIN members assigned_member
            ON assigned_member.id = t.assigned_member_id
           AND assigned_member.status = 'approved'
           AND assigned_member.is_sales = 1
          LEFT JOIN joint_target_candidates joint_link
            ON joint_link.target_id = t.id
           AND joint_link.row_number = 1
          LEFT JOIN joint_project_members jpm
            ON jpm.id = joint_link.member_id
          LEFT JOIN joint_projects jp
            ON jp.id = jpm.project_id AND jp.status = 'active'
          ORDER BY t.campaign_id DESC, t.organization COLLATE NOCASE
        `)
        .all(),
      d1
        .prepare(`
          SELECT id, display_name, email
          FROM members
          WHERE status = 'approved' AND is_sales = 1
          ORDER BY display_name COLLATE NOCASE
        `)
        .all(),
      d1
        .prepare(`
          SELECT id, canonical_name AS canonical_name,
                 budget_kind AS budget_kind, amount_mode AS amount_mode,
                 default_amount AS default_amount
          FROM budget_name_groups
          WHERE active = 1 AND budget_kind IN ('purpose', 'self')
          ORDER BY sort_order, canonical_name, id
        `)
        .all(),
    ]);
    return Response.json({
      campaigns: campaigns.results,
      targets: targets.results,
      members: members.results,
      budgetCatalog: budgetCatalog.results,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let campaignId = 0;
  let createdCampaign = false;
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as {
      name?: unknown;
      notes?: unknown;
      importSource?: unknown;
      sourceFileName?: unknown;
      selectionDate?: unknown;
      defaultBudgetAmount?: unknown;
      budgetType?: unknown;
      budgetOriginalName?: unknown;
      budgetGroupId?: unknown;
      budgetMatchStatus?: unknown;
      budgetMatchMethod?: unknown;
      budgetRequestId?: unknown;
      budgetKind?: unknown;
      budgetAmountMode?: unknown;
      destinationCampaignId?: unknown;
      targets?: CampaignTargetInput[];
      institutionDecisions?: Record<
        string,
        {
          confirmedOrganization?: string;
          institutionSeparate?: boolean;
        }
      >;
    };
    const name = clean(payload.name).slice(0, 120);
    const notes = clean(payload.notes).slice(0, 1000);
    const requestedImportSource = clean(payload.importSource);
    const importSource =
      requestedImportSource === "pdf" || requestedImportSource === "manual"
        ? requestedImportSource
        : "excel";
    const sourceName =
      importSource === "pdf"
        ? "예산별 기관 PDF 가져오기"
        : importSource === "manual"
          ? "예산별 기관 직접 등록"
          : "예산별 기관 엑셀 가져오기";
    const sourceFileName = clean(payload.sourceFileName).slice(0, 220);
    const selectionDate = clean(payload.selectionDate).slice(0, 10);
    const selectedYear = selectionDate.slice(0, 4);
    const defaultBudgetAmount = parseMoney(payload.defaultBudgetAmount);
    let targets = [
      ...new Map(
        (Array.isArray(payload.targets) ? payload.targets : [])
          .slice(0, 500)
          .map(cleanTarget)
          .filter((target) => target.organization)
          .map((target) => [
            target.organization.replace(/\s+/g, "").toLocaleLowerCase("ko-KR"),
            target,
          ]),
      ).values(),
    ];
    if (!name || !selectionDate || !/^\d{4}-\d{2}-\d{2}$/.test(selectionDate)) {
      return Response.json(
        { error: "명단 이름과 선정·공고일을 확인해 주세요." },
        { status: 400 },
      );
    }
    if (!targets.length) {
      return Response.json(
        { error: "등록할 기관이 한 곳 이상 필요합니다." },
        { status: 400 },
      );
    }

    await Promise.all([
      ensureRecordsReady(),
      ensureBudgetNamesReady(),
    ]);
    const d1 = await ensureCampaignsReady();
    const budgetMetadata = await resolveBudgetRecordMetadata(d1, {
      budgetType: payload.budgetType,
      budgetOriginalName: payload.budgetOriginalName,
      budgetGroupId: payload.budgetGroupId,
      budgetMatchStatus: payload.budgetMatchStatus,
      budgetMatchMethod: payload.budgetMatchMethod,
      budgetRequestId: payload.budgetRequestId,
      budgetKind: payload.budgetKind,
      budgetAmountMode: payload.budgetAmountMode,
      awardStatus: "미정",
    });
    const effectiveDefaultBudgetAmount =
      defaultBudgetAmount ?? parseMoney(budgetMetadata.budgetAmount);
    const requestedBudgetGroupId = Number(payload.budgetGroupId);
    if (
      !Number.isInteger(requestedBudgetGroupId) ||
      requestedBudgetGroupId < 1 ||
      budgetMetadata.budgetGroupId !== requestedBudgetGroupId ||
      !clean(budgetMetadata.storedName)
    ) {
      return Response.json(
        { error: "관리자가 등록한 활성 표준 예산명을 선택해 주세요." },
        { status: 400 },
      );
    }
    const destinationCampaignId = Number(payload.destinationCampaignId);
    let destinationCampaign: Record<string, unknown> | null = null;
    let skippedExistingCount = 0;
    if (
      Number.isInteger(destinationCampaignId) &&
      destinationCampaignId > 0
    ) {
      destinationCampaign = await d1
        .prepare(
          `SELECT *
           FROM sales_campaigns
           WHERE id = ? AND import_status = 'complete'`,
        )
        .bind(destinationCampaignId)
        .first<Record<string, unknown>>();
      if (!destinationCampaign) {
        return Response.json(
          { error: "누락 기관을 추가할 기존 예산 명단을 찾지 못했습니다." },
          { status: 404 },
        );
      }
      if (
        Number(destinationCampaign.budget_group_id) !==
        budgetMetadata.budgetGroupId
      ) {
        return Response.json(
          { error: "현재 명단과 같은 표준 예산명을 선택해 주세요." },
          { status: 409 },
        );
      }
      const currentTargets = await d1
        .prepare(
          `SELECT organization, address
           FROM sales_campaign_targets
           WHERE campaign_id = ?`,
        )
        .bind(destinationCampaignId)
        .all<{ organization: string; address: string }>();
      const currentOrganizationKeys = new Set(
        currentTargets.results
          .map((row) => institutionAliasKey(clean(row.organization)))
          .filter(Boolean),
      );
      const currentAddressKeys = new Set(
        currentTargets.results
          .map((row) => clean(row.address).replace(/\s+/g, "").toLocaleLowerCase("ko-KR"))
          .filter(Boolean),
      );
      const missingTargets = targets.filter(
        (target) => {
          const organizationAlreadyExists = currentOrganizationKeys.has(
            institutionAliasKey(clean(target.organization)),
          );
          const addressKey = clean(target.address)
            .replace(/\s+/g, "")
            .toLocaleLowerCase("ko-KR");
          return !organizationAlreadyExists &&
            !(addressKey && currentAddressKeys.has(addressKey));
        },
      );
      skippedExistingCount = targets.length - missingTargets.length;
      targets = missingTargets;
      campaignId = destinationCampaignId;
      if (!targets.length) {
        return Response.json({
          campaign: destinationCampaign,
          targetCount: 0,
          targets: [],
          skippedExistingCount,
          linkedExistingCount: 0,
          correctedBudgetCount: 0,
          newBusinessCount: 0,
          newInstitutionCount: 0,
          alreadyImported: true,
        });
      }
    }
    const existingCampaign = await d1
      .prepare(`
        SELECT c.*, COUNT(t.id) AS target_count
        FROM sales_campaigns c
        LEFT JOIN sales_campaign_targets t ON t.campaign_id = c.id
        WHERE c.name = ?
        GROUP BY c.id
      `)
      .bind(name)
      .first<Record<string, unknown>>();
    if (existingCampaign && !destinationCampaign) {
      const existingCampaignId = Number(existingCampaign.id);
      if (clean(existingCampaign.import_status) === "processing") {
        await removeIncompleteCampaign(d1, existingCampaignId);
      } else if (
        Number(existingCampaign.target_count) === targets.length &&
        clean(existingCampaign.selection_date) === selectionDate &&
        clean(existingCampaign.source_file_name) === sourceFileName
      ) {
        return Response.json({
          campaign: existingCampaign,
          targetCount: targets.length,
          linkedExistingCount: 0,
          correctedBudgetCount: 0,
          newBusinessCount: 0,
          newInstitutionCount: 0,
          alreadyImported: true,
        });
      } else {
        return Response.json(
          { error: "같은 이름의 예산별 기관 명단이 이미 있습니다." },
          { status: 409 },
        );
      }
    }

    const approvedMembers = await d1
      .prepare(
        `SELECT id, display_name
         FROM members
         WHERE status = 'approved' AND is_sales = 1`,
      )
      .all<{ id: number; display_name: string }>();
    const approvedMemberIds = new Set(
      approvedMembers.results.map((row) => Number(row.id)),
    );
    const approvedMemberIdByName = new Map(
      approvedMembers.results
        .map(
          (row) =>
            [
              clean(row.display_name).toLocaleLowerCase("ko-KR"),
              Number(row.id),
            ] as const,
        )
        .filter(([name, id]) => name && Number.isInteger(id) && id > 0),
    );
    const approvedMemberNameById = new Map(
      approvedMembers.results.map(
        (row) => [Number(row.id), clean(row.display_name)] as const,
      ),
    );

    const requestedLinkedActivityIds = [
      ...new Set(
        targets
          .filter(
            (target) =>
              target.businessMatchMode === "link-current" &&
              target.linkedActivityId,
          )
          .map((target) => Number(target.linkedActivityId))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    const requestedLinkedActivities = new Map<number, ExistingActivity>();
    for (const activityIdChunk of chunks(requestedLinkedActivityIds, 50)) {
      const placeholders = activityIdChunk.map(() => "?").join(", ");
      const linkedRows = await d1
        .prepare(`
          SELECT
            id, organization, business_round, activity_date, region,
            budget_type, budget_original_name, budget_group_id, award_status,
            progress_manager, contact_role, contact_name, contact_phone,
            contact_email
          FROM activities
          WHERE id IN (${placeholders})
        `)
        .bind(...activityIdChunk)
        .all<ExistingActivity>();
      linkedRows.results.forEach((row) => {
        requestedLinkedActivities.set(Number(row.id), row);
      });
    }

    const plannedOrganizations = targets.map((target) => {
      const decision = payload.institutionDecisions?.[target.organization] ?? {};
      const selectedLinkedActivity =
        target.businessMatchMode === "link-current" && target.linkedActivityId
          ? requestedLinkedActivities.get(target.linkedActivityId)
          : undefined;
      return (
        clean(selectedLinkedActivity?.organization).slice(0, 120) ||
        clean(decision.confirmedOrganization).slice(0, 120) ||
        target.organization
      );
    });
    const existingActivitiesByOrganization = new Map<
      string,
      ExistingActivity[]
    >();
    for (const organizationChunk of chunks(
      [...new Set(plannedOrganizations)],
      50,
    )) {
      const placeholders = organizationChunk.map(() => "?").join(", ");
      const existingRows = await d1
        .prepare(`
          SELECT
            id, organization, business_round, activity_date, region,
            budget_type, budget_original_name, budget_group_id, award_status,
            progress_manager, contact_role, contact_name, contact_phone,
            contact_email
          FROM activities
          WHERE organization IN (${placeholders})
          ORDER BY organization, activity_date DESC, id DESC
        `)
        .bind(...organizationChunk)
        .all<ExistingActivity>();
      existingRows.results.forEach((row) => {
        const organizationRows =
          existingActivitiesByOrganization.get(row.organization) ?? [];
        organizationRows.push(row);
        existingActivitiesByOrganization.set(row.organization, organizationRows);
      });
    }

    const plans: TargetPlan[] = [];
    for (const target of targets) {
      const decision = payload.institutionDecisions?.[target.organization] ?? {};
      const requestedLinkedActivity =
        target.businessMatchMode === "link-current" && target.linkedActivityId
          ? requestedLinkedActivities.get(target.linkedActivityId)
          : undefined;
      const organization =
        clean(requestedLinkedActivity?.organization).slice(0, 120) ||
        clean(decision.confirmedOrganization).slice(0, 120) ||
        target.organization;
      const existingRows =
        existingActivitiesByOrganization.get(organization) ?? [];
      const maxBusinessRound = existingRows.reduce(
        (maximum, row) => Math.max(maximum, Number(row.business_round) || 1),
        0,
      );
      const sameYearRows = existingRows.filter(
        (row) => clean(row.activity_date).slice(0, 4) === selectedYear,
      );
      const sameYearOwnCompanyRows = sameYearRows.filter(
        (row) =>
          !["협력사 수주", "타업체 수주"].includes(clean(row.award_status)),
      );
      const linkableBusinessRows = sameYearOwnCompanyRows.filter(
        (row, index) =>
          sameYearOwnCompanyRows.findIndex(
            (candidate) =>
              (Number(candidate.business_round) || 1) ===
              (Number(row.business_round) || 1),
          ) === index,
      );
      const sameBudgetMatches = linkableBusinessRows.filter(
        (row) =>
          (budgetMetadata.budgetGroupId &&
            Number(row.budget_group_id) === budgetMetadata.budgetGroupId) ||
          cleanBudgetKey(row.budget_type) ===
            cleanBudgetKey(budgetMetadata.storedName),
      );
      const currentPreAward = linkableBusinessRows.find(
        (row) => clean(row.award_status) === "미정",
      );
      const latestInstitutionActivity = existingRows[0];

      let linked: ExistingActivity | undefined;
      let correctBudget = false;
      if (target.businessMatchMode === "list-only") {
        linked = undefined;
      } else if (target.businessMatchMode === "link-current") {
        linked = target.linkedActivityId
          ? linkableBusinessRows.find(
              (row) =>
                Number(row.id) === target.linkedActivityId &&
                Number(requestedLinkedActivity?.id) === target.linkedActivityId,
            )
          : currentPreAward;
        correctBudget = Boolean(linked && target.updateLinkedBudget);
        if (!linked) {
          return Response.json(
            {
              error: `${organization}에서 선택한 기존 사업을 같은 연도 위즈업 기록으로 확인할 수 없습니다.`,
            },
            { status: 409 },
          );
        }
      } else if (target.businessMatchMode !== "new") {
        if (sameBudgetMatches.length > 1) {
          return Response.json(
            {
              error: `${organization}은 같은 예산의 기존 사업이 여러 건입니다. 연결할 사업 차수를 직접 선택해 주세요.`,
            },
            { status: 409 },
          );
        }
        linked = sameBudgetMatches[0];
      }

      const createdActivity =
        target.businessMatchMode !== "list-only" && !linked;
      const latestProgressManager = usableProgressManager(
        latestInstitutionActivity?.progress_manager,
      );
      const linkedProgressManager = linked
        ? usableProgressManager(
            existingRows.find(
              (row) =>
                Number(row.business_round) === Number(linked.business_round) &&
                usableProgressManager(row.progress_manager),
            )?.progress_manager,
          )
        : "";
      const inheritedProgressManager =
        linkedProgressManager || (createdActivity ? latestProgressManager : "");
      const explicitAssignedMemberId =
        target.assignedMemberId &&
        approvedMemberIds.has(target.assignedMemberId)
          ? target.assignedMemberId
          : null;
      const inheritedAssignedMemberId =
        inheritedProgressManager
          ? approvedMemberIdByName.get(
              inheritedProgressManager.toLocaleLowerCase("ko-KR"),
            ) ?? null
          : null;
      const assignedMemberId =
        Number(explicitAssignedMemberId ?? inheritedAssignedMemberId) || null;
      const progressManager = String(
        (assignedMemberId &&
          approvedMemberNameById.get(assignedMemberId)) ||
          (createdActivity ? inheritedProgressManager : ""),
      );
      plans.push({
        target: {
          ...target,
          region:
            target.region ||
            (createdActivity
              ? clean(latestInstitutionActivity?.region)
              : ""),
          contactName:
            target.contactName ||
            (createdActivity
              ? clean(latestInstitutionActivity?.contact_name)
              : ""),
          phone:
            target.phone ||
            (createdActivity
              ? clean(latestInstitutionActivity?.contact_phone)
              : ""),
          assignedMemberId,
        },
        organization,
        activityId: linked ? Number(linked.id) : null,
        businessRound: linked
          ? Math.max(1, Number(linked.business_round) || 1)
          : Math.max(1, maxBusinessRound + 1),
        createdActivity,
        correctBudget,
        inheritedContactRole: createdActivity
          ? clean(latestInstitutionActivity?.contact_role)
          : "",
        inheritedContactEmail: createdActivity
          ? clean(latestInstitutionActivity?.contact_email)
          : "",
        progressManager,
      });
    }

    let campaign = destinationCampaign;
    if (!campaign) {
      campaign = await d1
        .prepare(`
          INSERT INTO sales_campaigns (
            name, notes, budget_type, budget_group_id, budget_match_status,
            budget_match_method, budget_request_id, budget_kind,
            budget_amount_mode, selection_date, default_budget_amount,
            source_file_name, import_source, import_status,
            expected_target_count, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)
          RETURNING *
        `)
        .bind(
          name,
          notes,
          budgetMetadata.storedName,
          budgetMetadata.budgetGroupId,
          budgetMetadata.budgetMatchStatus,
          budgetMetadata.budgetMatchMethod,
          budgetMetadata.budgetRequestId,
          budgetMetadata.budgetKind,
          budgetMetadata.budgetAmountMode,
          selectionDate,
          effectiveDefaultBudgetAmount,
          sourceFileName,
          importSource,
          plans.length,
          member.id,
        )
        .first<Record<string, unknown>>();
      campaignId = Number(campaign?.id);
      createdCampaign = Boolean(campaignId);
    }
    if (!campaignId) throw new Error("예산별 기관 명단을 만들지 못했습니다.");

    const normalizedTargets: Array<Record<string, unknown>> = [];
    const createdPlans = plans.filter(
      (plan) => !plan.activityId && plan.createdActivity,
    );
    for (const planChunk of chunks(createdPlans, 15)) {
      const recordResults = await Promise.allSettled(
        planChunk.map((plan) => {
          const decision =
            payload.institutionDecisions?.[plan.target.organization] ?? {};
          const targetBudgetAmount =
            plan.target.budgetAmount ?? effectiveDefaultBudgetAmount;
          const storedBudgetAmount =
            targetBudgetAmount === null || targetBudgetAmount === undefined
              ? ""
              : String(targetBudgetAmount);
          return insertActivity(
            {
              activityDate: selectionDate || localDate(),
              dateConfidence: "확정",
              activityType: "사업 대상 등록",
              category: "예산별 기관",
              contactMethod: "기타",
              region: plan.target.region,
              organization: plan.organization,
              businessRound: plan.businessRound,
              budgetType: budgetMetadata.storedName,
              budgetOriginalName: budgetMetadata.budgetOriginalName,
              budgetGroupId: budgetMetadata.budgetGroupId,
              budgetMatchStatus: budgetMetadata.budgetMatchStatus,
              budgetMatchMethod: budgetMetadata.budgetMatchMethod,
              budgetRequestId: budgetMetadata.budgetRequestId,
              budgetKind: budgetMetadata.budgetKind,
              budgetAmountMode: budgetMetadata.budgetAmountMode,
              budgetAmount: storedBudgetAmount,
              topic: name,
              summary: `${name} 선정기관 등록`,
              status: "재접촉 필요",
              temperature: "중간",
              awardStatus: "미정",
              awardCompany: "",
              followUpRequired: false,
              nextAction: "담당자 배정 및 첫 컨택",
              contactRole: plan.inheritedContactRole,
              contactName: plan.target.contactName,
              contactPhone: plan.target.phone,
              contactEmail: plan.inheritedContactEmail,
              sourceChat: sourceName,
              notes: [
                plan.target.address && `주소: ${plan.target.address}`,
                plan.target.schoolLevel &&
                  `학교급·기관 구분: ${plan.target.schoolLevel}`,
                plan.target.supplyItems &&
                  `지원·공급 내용: ${plan.target.supplyItems}`,
                plan.target.reviewNote &&
                  `검토 메모: ${plan.target.reviewNote}`,
                plan.target.notes,
              ]
                .filter(Boolean)
                .join("\n"),
              progressManager: plan.progressManager,
              ...decision,
              institutionSeparate: true,
              skipOfficialSchoolLookup: true,
              skipInstitutionStateLookup: true,
              skipRelatedWrites: true,
              seedKey: destinationCampaign
                ? `campaign:${campaignId}:append:${institutionAliasKey(plan.organization)}`
                : `campaign:${campaignId}:${plans.indexOf(plan)}`,
              resolvedBudgetMetadata: {
                ...budgetMetadata,
                budgetAmount: storedBudgetAmount,
                budgetAmountOverride:
                  budgetMetadata.budgetAmountMode === "manual"
                    ? storedBudgetAmount
                    : budgetMetadata.budgetAmountOverride,
              },
            },
            member,
            sourceName,
          );
        }),
      );
      const failedRecord = recordResults.find(
        (result) => result.status === "rejected",
      );
      if (failedRecord?.status === "rejected") throw failedRecord.reason;
      const records = recordResults.map((result) => {
        if (result.status !== "fulfilled") {
          throw new Error("기관 기록을 일괄 저장하지 못했습니다.");
        }
        return result.value;
      });
      records.forEach((record, index) => {
        const plan = planChunk[index];
        const activityId = Number(record.id);
        plan.organization = clean(record.organization);
        plan.activityId = activityId;
      });
    }

    const targetAndRelationStatements: Array<
      ReturnType<typeof d1.prepare>
    > = [];
    for (const plan of plans) {
      const activityId = plan.activityId;
      if (plan.createdActivity && activityId) {
        targetAndRelationStatements.push(
          d1
            .prepare(`
              INSERT INTO activity_authors (
                activity_id, member_id, created_by_name, created_at
              ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT (activity_id) DO UPDATE SET
                member_id = excluded.member_id,
                created_by_name = excluded.created_by_name,
                created_at = excluded.created_at
            `)
            .bind(activityId, member.id, member.displayName),
        );
        if (budgetMetadata.budgetGroupId) {
          targetAndRelationStatements.push(
            d1
              .prepare(`
                INSERT INTO budget_name_members (
                  group_id, entity_type, entity_id, original_name, alias_key,
                  active, linked_at, unlinked_at
                ) VALUES (?, 'activity', ?, ?, ?, 1, CURRENT_TIMESTAMP, NULL)
                ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                  group_id = excluded.group_id,
                  original_name = excluded.original_name,
                  alias_key = excluded.alias_key,
                  active = 1, linked_at = CURRENT_TIMESTAMP, unlinked_at = NULL
              `)
              .bind(
                budgetMetadata.budgetGroupId,
                activityId,
                budgetMetadata.budgetOriginalName,
                budgetMetadata.resolution?.aliasKey ??
                  normalizeBudgetNameKey(budgetMetadata.budgetOriginalName),
              ),
          );
        }
        if (budgetMetadata.budgetRequestId) {
          targetAndRelationStatements.push(
            d1
              .prepare(`
                INSERT OR IGNORE INTO budget_name_request_records (
                  request_id, entity_type, entity_id, original_name, organization
                ) VALUES (?, 'activity', ?, ?, ?)
              `)
              .bind(
                budgetMetadata.budgetRequestId,
                activityId,
                budgetMetadata.budgetOriginalName,
                plan.organization,
              ),
          );
        }
      }
      targetAndRelationStatements.push(
        d1
          .prepare(`
          INSERT INTO sales_campaign_targets (
            campaign_id, organization, region, address, phone,
            contact_name, notes, assigned_member_id, activity_id,
            budget_amount, school_level, supply_items, review_note,
            business_round, created_activity
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
          campaignId,
          plan.organization,
          plan.target.region,
          plan.target.address,
          plan.target.phone,
          plan.target.contactName,
          plan.target.notes,
          plan.target.assignedMemberId,
          activityId,
          plan.target.budgetAmount ?? effectiveDefaultBudgetAmount,
          plan.target.schoolLevel,
          plan.target.supplyItems,
          plan.target.reviewNote,
          plan.businessRound,
          plan.createdActivity ? 1 : 0,
          ),
      );
      normalizedTargets.push({
        ...plan.target,
        organization: plan.organization,
        activityId,
        businessRound: plan.businessRound,
        createdActivity: plan.createdActivity,
      });
    }
    await runStatementsInChunks(d1, targetAndRelationStatements);

    const correctionStatements: Array<ReturnType<typeof d1.prepare>> = [];
    for (const plan of plans.filter((item) => item.correctBudget)) {
      const affectedActivities = await d1
        .prepare(`
          SELECT id, budget_type, budget_original_name
          FROM activities
          WHERE organization = ? AND business_round = ?
            AND award_status NOT IN ('협력사 수주', '타업체 수주')
        `)
        .bind(plan.organization, plan.businessRound)
        .all<{
          id: number;
          budget_type: string;
          budget_original_name: string;
        }>();
      const affectedProjects = await d1
        .prepare(`
          SELECT p.id, p.budget_type, p.budget_original_name
          FROM equipment_projects p
          WHERE p.organization = ? AND p.business_round = ?
            AND (
              p.activity_id IS NULL OR EXISTS (
                SELECT 1 FROM activities a
                WHERE a.id = p.activity_id
                  AND a.award_status NOT IN ('협력사 수주', '타업체 수주')
              )
            )
        `)
        .bind(plan.organization, plan.businessRound)
        .all<{
          id: number;
          budget_type: string;
          budget_original_name: string;
        }>();

      correctionStatements.push(
        d1
          .prepare(`
            UPDATE activities
            SET budget_type = ?,
                budget_original_name = CASE
                  WHEN TRIM(COALESCE(budget_original_name, '')) = ''
                    THEN budget_type
                  ELSE budget_original_name
                END,
                budget_group_id = ?, budget_match_status = ?,
                budget_match_method = ?, budget_request_id = ?,
                budget_kind = ?, budget_amount_mode = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE organization = ? AND business_round = ?
              AND award_status NOT IN ('협력사 수주', '타업체 수주')
          `)
          .bind(
            budgetMetadata.storedName,
            budgetMetadata.budgetGroupId,
            budgetMetadata.budgetMatchStatus,
            "campaign_review",
            budgetMetadata.budgetRequestId,
            budgetMetadata.budgetKind,
            budgetMetadata.budgetAmountMode,
            plan.organization,
            plan.businessRound,
          ),
        d1
          .prepare(`
            UPDATE equipment_projects
            SET budget_type = ?,
                budget_original_name = CASE
                  WHEN TRIM(COALESCE(budget_original_name, '')) = ''
                    THEN budget_type
                  ELSE budget_original_name
                END,
                budget_group_id = ?, budget_match_status = ?,
                budget_match_method = ?, budget_request_id = ?,
                budget_kind = ?, updated_at = CURRENT_TIMESTAMP
            WHERE organization = ? AND business_round = ?
              AND (
                activity_id IS NULL OR EXISTS (
                  SELECT 1 FROM activities a
                  WHERE a.id = equipment_projects.activity_id
                    AND a.award_status NOT IN ('협력사 수주', '타업체 수주')
                )
              )
          `)
          .bind(
            budgetMetadata.storedName,
            budgetMetadata.budgetGroupId,
            budgetMetadata.budgetMatchStatus,
            "campaign_review",
            budgetMetadata.budgetRequestId,
            budgetMetadata.budgetKind,
            plan.organization,
            plan.businessRound,
          ),
      );

      for (const row of affectedActivities.results) {
        const originalName =
          clean(row.budget_original_name) ||
          clean(row.budget_type) ||
          budgetMetadata.budgetOriginalName;
        correctionStatements.push(
          d1
            .prepare(
              `DELETE FROM budget_name_request_records
               WHERE entity_type = 'activity' AND entity_id = ?`,
            )
            .bind(row.id),
        );
        if (budgetMetadata.budgetGroupId) {
          correctionStatements.push(
            d1
              .prepare(`
                INSERT INTO budget_name_members (
                  group_id, entity_type, entity_id, original_name, alias_key,
                  active, linked_at, unlinked_at
                ) VALUES (?, 'activity', ?, ?, ?, 1, CURRENT_TIMESTAMP, NULL)
                ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                  group_id = excluded.group_id,
                  original_name = excluded.original_name,
                  alias_key = excluded.alias_key,
                  active = 1, linked_at = CURRENT_TIMESTAMP, unlinked_at = NULL
              `)
              .bind(
                budgetMetadata.budgetGroupId,
                row.id,
                originalName,
                normalizeBudgetNameKey(originalName),
              ),
          );
        }
        if (budgetMetadata.budgetRequestId) {
          correctionStatements.push(
            d1
              .prepare(`
                INSERT OR IGNORE INTO budget_name_request_records (
                  request_id, entity_type, entity_id, original_name, organization
                ) VALUES (?, 'activity', ?, ?, ?)
              `)
              .bind(
                budgetMetadata.budgetRequestId,
                row.id,
                originalName,
                plan.organization,
              ),
          );
        }
      }
      for (const row of affectedProjects.results) {
        const originalName =
          clean(row.budget_original_name) ||
          clean(row.budget_type) ||
          budgetMetadata.budgetOriginalName;
        correctionStatements.push(
          d1
            .prepare(
              `DELETE FROM budget_name_request_records
               WHERE entity_type = 'equipment_project' AND entity_id = ?`,
            )
            .bind(row.id),
        );
        if (budgetMetadata.budgetGroupId) {
          correctionStatements.push(
            d1
              .prepare(`
                INSERT INTO budget_name_members (
                  group_id, entity_type, entity_id, original_name, alias_key,
                  active, linked_at, unlinked_at
                ) VALUES (?, 'equipment_project', ?, ?, ?, 1, CURRENT_TIMESTAMP, NULL)
                ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                  group_id = excluded.group_id,
                  original_name = excluded.original_name,
                  alias_key = excluded.alias_key,
                  active = 1, linked_at = CURRENT_TIMESTAMP, unlinked_at = NULL
              `)
              .bind(
                budgetMetadata.budgetGroupId,
                row.id,
                originalName,
                normalizeBudgetNameKey(originalName),
              ),
          );
        }
        if (budgetMetadata.budgetRequestId) {
          correctionStatements.push(
            d1
              .prepare(`
                INSERT OR IGNORE INTO budget_name_request_records (
                  request_id, entity_type, entity_id, original_name, organization
                ) VALUES (?, 'equipment_project', ?, ?, ?)
              `)
              .bind(
                budgetMetadata.budgetRequestId,
                row.id,
                originalName,
                plan.organization,
              ),
          );
        }
      }
    }
    if (correctionStatements.length) {
      await runStatementsInChunks(d1, correctionStatements);
    }
    await d1
      .prepare(
        `UPDATE sales_campaigns
         SET import_status = 'complete',
             expected_target_count = (
               SELECT COUNT(*)
               FROM sales_campaign_targets
               WHERE campaign_id = ?
             ),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(campaignId, campaignId)
      .run();

    return Response.json(
      {
        campaign,
        targetCount: plans.length,
        targets: normalizedTargets,
        skippedExistingCount,
        linkedExistingCount: plans.filter((plan) => !plan.createdActivity).length,
        correctedBudgetCount: plans.filter((plan) => plan.correctBudget).length,
        newBusinessCount: plans.filter((plan) => plan.createdActivity).length,
        newInstitutionCount: plans.filter(
          (plan) => plan.createdActivity && plan.businessRound === 1,
        ).length,
      },
      { status: destinationCampaign ? 200 : 201 },
    );
  } catch (error) {
    if (campaignId && createdCampaign) {
      try {
        const d1 = await ensureCampaignsReady();
        await removeIncompleteCampaign(d1, campaignId);
      } catch {
        // Preserve the original error response.
      }
    }
    const confirmation = institutionConfirmationResponse(error);
    if (confirmation) return confirmation;
    return accessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireApprovedMember();
    if (!canCollaborativelyManageSalesRecords(actor)) {
      return Response.json(
        { error: "승인된 구성원만 예산 명단에 기관을 추가할 수 있습니다." },
        { status: 403 },
      );
    }
    const payload = (await request.json()) as {
      campaignId?: unknown;
      activityIds?: unknown;
    };
    const campaignId = Number(payload.campaignId);
    const activityIds = [
      ...new Set(
        (Array.isArray(payload.activityIds) ? payload.activityIds : [])
          .slice(0, 2_000)
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    if (!Number.isInteger(campaignId) || campaignId < 1) {
      return Response.json(
        { error: "기관을 추가할 예산 명단을 다시 선택해 주세요." },
        { status: 400 },
      );
    }
    if (!activityIds.length) {
      return Response.json(
        { error: "추가할 기존 기관을 한 곳 이상 선택해 주세요." },
        { status: 400 },
      );
    }

    await ensureRecordsReady();
    const d1 = await ensureCampaignsReady();
    const campaign = await d1
      .prepare(
        `SELECT id, name, default_budget_amount
         FROM sales_campaigns
         WHERE id = ? AND import_status = 'complete'`,
      )
      .bind(campaignId)
      .first<{
        id: number;
        name: string;
        default_budget_amount: number | null;
      }>();
    if (!campaign) {
      return Response.json(
        { error: "기관을 추가할 예산 명단을 찾지 못했습니다." },
        { status: 404 },
      );
    }

    type ExistingCampaignActivity = {
      id: number;
      organization: string;
      region: string;
      contact_name: string;
      contact_phone: string;
      progress_manager: string;
      assigned_member_id: number | null;
      budget_amount: string;
      business_round: number;
    };
    const activityById = new Map<number, ExistingCampaignActivity>();
    for (const activityIdChunk of chunks(activityIds, 50)) {
      const placeholders = activityIdChunk.map(() => "?").join(", ");
      const rows = await d1
        .prepare(
          `SELECT
             a.id, a.organization, a.region, a.contact_name, a.contact_phone,
             a.progress_manager, a.budget_amount, a.business_round,
             m.id AS assigned_member_id
           FROM activities a
           LEFT JOIN members m
             ON m.display_name = a.progress_manager
            AND m.status = 'approved'
            AND m.is_sales = 1
           WHERE a.id IN (${placeholders})`,
        )
        .bind(...activityIdChunk)
        .all<ExistingCampaignActivity>();
      rows.results.forEach((row) => activityById.set(Number(row.id), row));
    }

    const existingTargets = await d1
      .prepare(
        `SELECT organization
         FROM sales_campaign_targets
         WHERE campaign_id = ?`,
      )
      .bind(campaignId)
      .all<{ organization: string }>();
    const usedOrganizationKeys = new Set(
      existingTargets.results
        .map((row) => institutionAliasKey(clean(row.organization)))
        .filter(Boolean),
    );
    const selectedRows: ExistingCampaignActivity[] = [];
    let skippedCount = activityIds.length - activityById.size;
    for (const activityId of activityIds) {
      const row = activityById.get(activityId);
      if (!row) continue;
      const organization = clean(row.organization).slice(0, 120);
      const organizationKey = institutionAliasKey(organization);
      if (
        !organization ||
        !organizationKey ||
        usedOrganizationKeys.has(organizationKey)
      ) {
        skippedCount += 1;
        continue;
      }
      usedOrganizationKeys.add(organizationKey);
      selectedRows.push({ ...row, organization });
    }

    if (!selectedRows.length) {
      return Response.json({
        ok: true,
        campaignId,
        addedCount: 0,
        skippedCount,
        message: "선택한 기관은 이미 이 예산 명단에 들어 있습니다.",
      });
    }

    const statements = selectedRows.map((row) =>
      d1
        .prepare(
          `INSERT OR IGNORE INTO sales_campaign_targets (
             campaign_id, organization, region, address, phone,
             contact_name, notes, assigned_member_id, activity_id,
             budget_amount, school_level, supply_items, review_note,
             business_round, created_activity
           ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, '', '', '', ?, 0)`,
        )
        .bind(
          campaignId,
          row.organization,
          clean(row.region).slice(0, 120),
          clean(row.contact_phone).slice(0, 100),
          clean(row.contact_name).slice(0, 120),
          `${campaign.name} 기존 기관 연결`,
          Number(row.assigned_member_id) || null,
          Number(row.id),
          parseStoredActivityBudgetMoney(row.budget_amount) ||
            campaign.default_budget_amount,
          Math.max(1, Number(row.business_round) || 1),
        ),
    );
    await runStatementsInChunks(d1, statements);
    await d1
      .prepare(
        `UPDATE sales_campaigns
         SET expected_target_count = (
               SELECT COUNT(*)
               FROM sales_campaign_targets
               WHERE campaign_id = ?
             ),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(campaignId, campaignId)
      .run();

    return Response.json({
      ok: true,
      campaignId,
      addedCount: selectedRows.length,
      skippedCount,
      message: `${selectedRows.length}개 기관을 ${campaign.name} 명단에 추가했습니다.${skippedCount ? ` 중복·확인 불가 ${skippedCount}곳은 제외했습니다.` : ""}`,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as {
      action?: unknown;
      campaignId?: unknown;
      targetIds?: unknown;
      destinationCampaignId?: unknown;
      destinationBudgetGroupId?: unknown;
      targetId?: unknown;
      assignedMemberId?: unknown;
    };
    const actor = await requirePrimaryOwner();
    const action = clean(payload.action);
    if (action) {
      const campaignId = Number(payload.campaignId);
      const targetIds = [
        ...new Set(
          (Array.isArray(payload.targetIds) ? payload.targetIds : [])
            .slice(0, 2_000)
            .map(Number)
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      ];
      if (
        !["bulk-assign", "remove-targets"].includes(action) ||
        !Number.isInteger(campaignId) ||
        campaignId < 1 ||
        !targetIds.length
      ) {
        return Response.json(
          { error: "처리할 예산 명단과 기관을 다시 선택해 주세요." },
          { status: 400 },
        );
      }

      await Promise.all([ensureRecordsReady(), ensureBudgetNamesReady()]);
      const d1 = await ensureCampaignsReady();
      type BulkTarget = {
        id: number;
        organization: string;
        business_round: number;
        activity_id: number | null;
        [key: string]: unknown;
      };
      const selectedTargets: BulkTarget[] = [];
      for (const targetIdChunk of chunks(targetIds, 50)) {
        const placeholders = targetIdChunk.map(() => "?").join(", ");
        const rows = await d1
          .prepare(
            `SELECT *
             FROM sales_campaign_targets
             WHERE campaign_id = ? AND id IN (${placeholders})`,
          )
          .bind(campaignId, ...targetIdChunk)
          .all<BulkTarget>();
        selectedTargets.push(...rows.results);
      }
      if (!selectedTargets.length) {
        return Response.json(
          { error: "선택한 기관을 현재 예산 명단에서 찾지 못했습니다." },
          { status: 404 },
        );
      }

      if (action === "bulk-assign") {
        const assignedMemberId =
          payload.assignedMemberId === null ||
          payload.assignedMemberId === undefined ||
          payload.assignedMemberId === ""
            ? null
            : Number(payload.assignedMemberId);
        let nextManager = "";
        if (assignedMemberId !== null) {
          const assigned = await d1
            .prepare(
              `SELECT id, display_name
               FROM members
               WHERE id = ? AND status = 'approved' AND is_sales = 1`,
            )
            .bind(assignedMemberId)
            .first<{ id: number; display_name: string }>();
          if (!assigned) {
            return Response.json(
              { error: "영업 담당자로 등록된 구성원만 지정할 수 있습니다." },
              { status: 400 },
            );
          }
          nextManager = assigned.display_name;
        }
        for (const target of selectedTargets) {
          const latest = await d1
            .prepare(
              `SELECT id, progress_manager
               FROM activities
               WHERE organization = ? AND business_round = ?
               ORDER BY activity_date DESC, id DESC
               LIMIT 1`,
            )
            .bind(target.organization, target.business_round)
            .first<{ id: number; progress_manager: string }>();
          if (
            latest &&
            assignedMemberId &&
            clean(latest.progress_manager) !== clean(nextManager)
          ) {
            await transferActivityAssignment(latest.id, assignedMemberId, actor);
          } else if (latest && !assignedMemberId) {
            await d1
              .prepare(
                `UPDATE activities
                 SET progress_manager = '',
                     progress_manager_locked = 0,
                     updated_by_member_id = ?, updated_by_name = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
              )
              .bind(actor.id, actor.displayName, latest.id)
              .run();
            await syncCampaignTargetsFromActivity(d1, latest.id);
          }
        }
        await runStatementsInChunks(
          d1,
          chunks(
            selectedTargets.map((target) => target.id),
            50,
          ).map((targetIdChunk) =>
            d1
              .prepare(
                `UPDATE sales_campaign_targets
                 SET assigned_member_id = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id IN (${targetIdChunk.map(() => "?").join(", ")})`,
              )
              .bind(assignedMemberId, ...targetIdChunk),
          ),
        );
        return Response.json({
          ok: true,
          updatedCount: selectedTargets.length,
          message: `${selectedTargets.length}개 기관의 진행 담당자를 변경했습니다.`,
        });
      }

      if (action === "remove-targets") {
        await ensureTrashReady();
        const trashBatchId = await createTrashBatch(
          d1,
          actor,
          "institution",
          "예산 기관 선정 명단에서 제외",
          selectedTargets.length,
          {
            tables: {
              sales_campaign_targets: selectedTargets.map((target) => ({
                ...target,
              })),
            },
          },
        );
        await runStatementsInChunks(
          d1,
          chunks(
            selectedTargets.map((target) => target.id),
            50,
          ).map((targetIdChunk) =>
            d1
              .prepare(
                `DELETE FROM sales_campaign_targets
                 WHERE campaign_id = ?
                   AND id IN (${targetIdChunk.map(() => "?").join(", ")})`,
              )
              .bind(campaignId, ...targetIdChunk),
          ),
        );
        await d1
          .prepare(
            `UPDATE sales_campaigns
             SET expected_target_count = (
                   SELECT COUNT(*) FROM sales_campaign_targets
                   WHERE campaign_id = ?
                 ),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          )
          .bind(campaignId, campaignId)
          .run();
        return Response.json({
          ok: true,
          trashBatchId,
          removedCount: selectedTargets.length,
          message: `${selectedTargets.length}개 기관을 현재 선정 명단에서 제외했습니다. 기관·지도·영업·수주 기록은 유지되며, 명단 연결은 30일 동안 복원할 수 있습니다.`,
        });
      }

      let destinationCampaignId = Number(payload.destinationCampaignId);
      const destinationBudgetGroupId = Number(
        payload.destinationBudgetGroupId,
      );
      const hasDestinationCampaign =
        Number.isInteger(destinationCampaignId) &&
        destinationCampaignId > 0;
      const hasDestinationBudget =
        Number.isInteger(destinationBudgetGroupId) &&
        destinationBudgetGroupId > 0;
      if (hasDestinationCampaign === hasDestinationBudget) {
        return Response.json(
          { error: "이동할 다른 표준 예산 명단을 선택해 주세요." },
          { status: 400 },
        );
      }

      const sourceCampaign = await d1
        .prepare(
          `SELECT id, name, selection_date, budget_group_id
           FROM sales_campaigns
           WHERE id = ? AND import_status = 'complete'`,
        )
        .bind(campaignId)
        .first<{
          id: number;
          name: string;
          selection_date: string;
          budget_group_id: number | null;
        }>();
      if (!sourceCampaign) {
        return Response.json(
          { error: "현재 예산 기관 명단을 찾지 못했습니다." },
          { status: 404 },
        );
      }

      type DestinationBudget = {
        id: number;
        budget_group_id: number;
        canonical_name: string;
        canonical_key: string;
        budget_kind: string;
        amount_mode: string;
        default_amount?: number | null;
      };
      let destination: DestinationBudget | null = null;
      if (hasDestinationCampaign) {
        if (destinationCampaignId === campaignId) {
          return Response.json(
            { error: "현재와 다른 표준 예산 명단을 선택해 주세요." },
            { status: 400 },
          );
        }
        destination = await d1
          .prepare(
            `SELECT c.id, g.id AS budget_group_id,
                    g.canonical_name, g.canonical_key,
                    g.budget_kind, g.amount_mode, g.default_amount
             FROM sales_campaigns c
             JOIN budget_name_groups g
               ON g.id = c.budget_group_id AND g.active = 1
             WHERE c.id = ? AND c.import_status = 'complete'`,
          )
          .bind(destinationCampaignId)
          .first<DestinationBudget>();
      } else {
        const budget = await d1
          .prepare(
            `SELECT id AS budget_group_id, canonical_name, canonical_key,
                    budget_kind, amount_mode, default_amount
             FROM budget_name_groups
             WHERE id = ? AND active = 1
               AND budget_kind IN ('purpose', 'self')`,
          )
          .bind(destinationBudgetGroupId)
          .first<Omit<DestinationBudget, "id">>();
        if (!budget) {
          return Response.json(
            { error: "선택한 활성 표준 예산명을 찾지 못했습니다." },
            { status: 404 },
          );
        }
        if (Number(sourceCampaign.budget_group_id) === destinationBudgetGroupId) {
          return Response.json(
            { error: "현재와 다른 표준 예산명을 선택해 주세요." },
            { status: 400 },
          );
        }
        const matchingCampaigns = await d1
          .prepare(
            `SELECT id
             FROM sales_campaigns
             WHERE budget_group_id = ? AND import_status = 'complete'
             ORDER BY selection_date DESC, created_at DESC, id DESC
             LIMIT 2`,
          )
          .bind(destinationBudgetGroupId)
          .all<{ id: number }>();
        if (matchingCampaigns.results.length > 1) {
          return Response.json(
            {
              error:
                "선택한 표준 예산명에 기관 명단이 여러 개 있습니다. 이동할 정확한 명단을 다시 선택해 주세요.",
            },
            { status: 409 },
          );
        }
        if (matchingCampaigns.results.length === 1) {
          destinationCampaignId = Number(matchingCampaigns.results[0].id);
        } else {
          const selectionDate = clean(sourceCampaign.selection_date) || localDate();
          const campaignName = `${budget.canonical_name} 기관 명단 · ${selectionDate} · ${sourceCampaign.id}`;
          const createdCampaign = await d1
            .prepare(
              `INSERT INTO sales_campaigns (
                 name, notes, budget_type, budget_group_id,
                 budget_match_status, budget_match_method,
                 budget_request_id, budget_kind, budget_amount_mode,
                 selection_date, default_budget_amount, source_file_name,
                 import_source, import_status, expected_target_count, created_by
               ) VALUES (?, ?, ?, ?, 'approved', 'manager-bulk-move',
                         NULL, ?, ?, ?, ?, '', 'budget-bulk-move',
                         'complete', 0, ?)
               RETURNING id`,
            )
            .bind(
              campaignName,
              `${sourceCampaign.name}에서 예산 변경으로 자동 생성`,
              budget.canonical_name,
              budget.budget_group_id,
              budget.budget_kind,
              budget.amount_mode,
              selectionDate,
              budget.default_amount ?? null,
              actor.id,
            )
            .first<{ id: number }>();
          destinationCampaignId = Number(createdCampaign?.id);
        }
        destination = {
          id: destinationCampaignId,
          ...budget,
        };
      }

      if (!destination && destinationCampaignId > 0) {
        destination = await d1
        .prepare(
          `SELECT c.id, g.id AS budget_group_id,
                  g.canonical_name, g.canonical_key,
                  g.budget_kind, g.amount_mode, g.default_amount
           FROM sales_campaigns c
           JOIN budget_name_groups g
             ON g.id = c.budget_group_id AND g.active = 1
           WHERE c.id = ? AND c.import_status = 'complete'`,
        )
        .bind(destinationCampaignId)
        .first<DestinationBudget>();
      }
      if (!destination) {
        return Response.json(
          { error: "활성 표준 예산명에 연결된 이동 대상 명단을 찾지 못했습니다." },
          { status: 404 },
        );
      }
      for (const target of selectedTargets) {
        await d1.batch([
          d1
            .prepare(
              `INSERT OR IGNORE INTO sales_campaign_targets (
                 campaign_id, organization, region, address, phone,
                 contact_name, notes, assigned_member_id, activity_id,
                 budget_amount, school_level, supply_items, review_note,
                 business_round, created_activity, created_at, updated_at
               )
               SELECT ?, organization, region, address, phone,
                      contact_name, notes, assigned_member_id, activity_id,
                      budget_amount, school_level, supply_items, review_note,
                      business_round, created_activity, created_at, CURRENT_TIMESTAMP
               FROM sales_campaign_targets WHERE id = ? AND campaign_id = ?`,
            )
            .bind(destinationCampaignId, target.id, campaignId),
          d1
            .prepare(
              `UPDATE activities
               SET budget_type = ?, budget_original_name = ?,
                   budget_group_id = ?, budget_match_status = 'approved',
                   budget_match_method = 'manager-bulk-move',
                   budget_request_id = NULL, budget_kind = ?,
                   budget_amount_mode = ?,
                   updated_by_member_id = ?, updated_by_name = ?,
                   updated_at = CURRENT_TIMESTAMP
               WHERE organization = ? AND business_round = ?
                 AND award_status NOT IN ('협력사 수주', '타업체 수주')`,
            )
            .bind(
              destination.canonical_name,
              destination.canonical_name,
              destination.budget_group_id,
              destination.budget_kind,
              destination.amount_mode,
              actor.id,
              actor.displayName,
              target.organization,
              target.business_round,
            ),
          d1
            .prepare(
              `INSERT INTO budget_name_members (
                 group_id, entity_type, entity_id, original_name, alias_key,
                 active, linked_at, unlinked_at
               )
               SELECT ?, 'activity', id, ?, ?, 1, CURRENT_TIMESTAMP, NULL
               FROM activities
               WHERE organization = ? AND business_round = ?
                 AND award_status NOT IN ('협력사 수주', '타업체 수주')
               ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                 group_id = excluded.group_id,
                 original_name = excluded.original_name,
                 alias_key = excluded.alias_key,
                 active = 1, linked_at = CURRENT_TIMESTAMP, unlinked_at = NULL`,
            )
            .bind(
              destination.budget_group_id,
              destination.canonical_name,
              destination.canonical_key,
              target.organization,
              target.business_round,
            ),
          d1
            .prepare(
              `UPDATE equipment_projects
               SET budget_type = ?, budget_original_name = ?,
                   budget_group_id = ?, budget_match_status = 'approved',
                   budget_match_method = 'manager-bulk-move',
                   budget_request_id = NULL, budget_kind = ?,
                   updated_at = CURRENT_TIMESTAMP
               WHERE organization = ? AND business_round = ?`,
            )
            .bind(
              destination.canonical_name,
              destination.canonical_name,
              destination.budget_group_id,
              destination.budget_kind,
              target.organization,
              target.business_round,
            ),
          d1
            .prepare(
              `INSERT INTO budget_name_members (
                 group_id, entity_type, entity_id, original_name, alias_key,
                 active, linked_at, unlinked_at
               )
               SELECT ?, 'equipment_project', id, ?, ?, 1, CURRENT_TIMESTAMP, NULL
               FROM equipment_projects
               WHERE organization = ? AND business_round = ?
               ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                 group_id = excluded.group_id,
                 original_name = excluded.original_name,
                 alias_key = excluded.alias_key,
                 active = 1, linked_at = CURRENT_TIMESTAMP, unlinked_at = NULL`,
            )
            .bind(
              destination.budget_group_id,
              destination.canonical_name,
              destination.canonical_key,
              target.organization,
              target.business_round,
            ),
          d1
            .prepare(
              "DELETE FROM sales_campaign_targets WHERE id = ? AND campaign_id = ?",
            )
            .bind(target.id, campaignId),
        ]);
      }
      await d1.batch(
        [campaignId, destinationCampaignId].map((id) =>
          d1
            .prepare(
              `UPDATE sales_campaigns
               SET expected_target_count = (
                     SELECT COUNT(*) FROM sales_campaign_targets
                     WHERE campaign_id = ?
                   ),
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
            )
            .bind(id, id),
        ),
      );
      return Response.json({
        ok: true,
        movedCount: selectedTargets.length,
        message: `${selectedTargets.length}개 기관을 선택한 표준 예산 명단으로 이동했습니다.`,
      });
    }

    const targetId = Number(payload.targetId);
    const assignedMemberId =
      payload.assignedMemberId === null ||
      payload.assignedMemberId === undefined ||
      payload.assignedMemberId === ""
        ? null
        : Number(payload.assignedMemberId);
    if (
      !Number.isInteger(targetId) ||
      targetId < 1 ||
      (assignedMemberId !== null &&
        (!Number.isInteger(assignedMemberId) || assignedMemberId < 1))
    ) {
      return Response.json(
        { error: "기관과 담당자를 다시 선택해 주세요." },
        { status: 400 },
      );
    }

    await ensureRecordsReady();
    const d1 = await ensureCampaignsReady();
    const target = await d1
      .prepare(
        `SELECT id, organization, business_round, assigned_member_id
         FROM sales_campaign_targets WHERE id = ?`,
      )
      .bind(targetId)
      .first<{
        id: number;
        organization: string;
        business_round: number;
        assigned_member_id: number | null;
      }>();
    if (!target) {
      return Response.json(
        { error: "예산별 기관 대상을 찾지 못했습니다." },
        { status: 404 },
      );
    }

    let nextManager = "";
    if (assignedMemberId !== null) {
      const assigned = await d1
        .prepare(
          `SELECT id, display_name
           FROM members
           WHERE id = ? AND status = 'approved' AND is_sales = 1`,
        )
        .bind(assignedMemberId)
        .first<{ id: number; display_name: string }>();
      if (!assigned) {
        return Response.json(
          { error: "영업 담당자로 등록된 구성원만 지정할 수 있습니다." },
          { status: 400 },
        );
      }
      nextManager = assigned.display_name;
    }

    const latest = await d1
      .prepare(`
        SELECT id, progress_manager
        FROM activities
        WHERE organization = ? AND business_round = ?
        ORDER BY activity_date DESC, id DESC
        LIMIT 1
      `)
      .bind(target.organization, target.business_round)
      .first<{ id: number; progress_manager: string }>();
    const statements: Array<ReturnType<typeof d1.prepare>> = [
      d1
        .prepare(`
          UPDATE sales_campaign_targets
          SET assigned_member_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(assignedMemberId, targetId),
    ];
    if (
      latest &&
      assignedMemberId &&
      clean(latest.progress_manager) !== clean(nextManager)
    ) {
      await transferActivityAssignment(latest.id, assignedMemberId, actor);
    } else if (latest && !assignedMemberId) {
      statements.push(
        d1
          .prepare(`
            UPDATE activities
            SET progress_manager = '',
                progress_manager_locked = 0,
                updated_by_member_id = ?, updated_by_name = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE organization = ? AND business_round = ?
          `)
          .bind(
            actor.id,
            actor.displayName,
            target.organization,
            target.business_round,
          ),
      );
    }
    await d1.batch(statements);
    if (latest && !assignedMemberId) {
      await syncCampaignTargetsFromActivity(d1, latest.id);
    }
    const updated = await d1
      .prepare("SELECT * FROM sales_campaign_targets WHERE id = ?")
      .bind(targetId)
      .first();
    return Response.json({ target: updated });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireApprovedMember();
    const payload = (await request.json()) as {
      campaignId?: unknown;
      deleteRegisteredInstitutions?: unknown;
    };
    const campaignId = Number(payload.campaignId);
    const deleteRegisteredInstitutions =
      payload.deleteRegisteredInstitutions === true;
    if (!Number.isInteger(campaignId) || campaignId < 1) {
      return Response.json(
        { error: "삭제할 예산별 기관 명단을 선택해 주세요." },
        { status: 400 },
      );
    }
    const d1 = await ensureCampaignsReady();
    const campaign = await d1
      .prepare("SELECT name FROM sales_campaigns WHERE id = ?")
      .bind(campaignId)
      .first<{ name: string }>();
    if (!campaign) {
      return Response.json(
        { error: "예산별 기관 명단을 찾지 못했습니다." },
        { status: 404 },
      );
    }

    let removedActivityCount = 0;
    let retainedActivityCount = 0;
    if (deleteRegisteredInstitutions) {
      const targetRows = await d1
        .prepare(`
          SELECT organization, activity_id
          FROM sales_campaign_targets
          WHERE campaign_id = ? AND created_activity = 1
        `)
        .bind(campaignId)
        .all<{ organization: string; activity_id: number | null }>();
      const removableActivityIds: number[] = [];
      for (const row of targetRows.results) {
        const activityId = Number(row.activity_id);
        if (!Number.isInteger(activityId) || activityId < 1) continue;
        const downstream = await d1
          .prepare(`
            SELECT
              EXISTS(
                SELECT 1 FROM equipment_projects WHERE activity_id = ?
              ) AS has_equipment,
              EXISTS(
                SELECT 1 FROM accounting_settlements WHERE activity_id = ?
              ) AS has_settlement,
              EXISTS(
                SELECT 1 FROM accounting_commission_entries WHERE activity_id = ?
              ) AS has_commission,
              EXISTS(
                SELECT 1 FROM accounting_collection_receipts WHERE activity_id = ?
              ) AS has_receipt
          `)
          .bind(activityId, activityId, activityId, activityId)
          .first<{
            has_equipment: number;
            has_settlement: number;
            has_commission: number;
            has_receipt: number;
          }>();
        if (
          downstream &&
          (downstream.has_equipment ||
            downstream.has_settlement ||
            downstream.has_commission ||
            downstream.has_receipt)
        ) {
          retainedActivityCount += 1;
        } else {
          removableActivityIds.push(activityId);
        }
      }
      await d1
        .prepare("DELETE FROM sales_campaign_targets WHERE campaign_id = ?")
        .bind(campaignId)
        .run();
      await removeCreatedActivities(d1, removableActivityIds);
      removedActivityCount = removableActivityIds.length;
    } else {
      await d1
        .prepare("DELETE FROM sales_campaign_targets WHERE campaign_id = ?")
        .bind(campaignId)
        .run();
    }
    await d1
      .prepare("DELETE FROM sales_campaigns WHERE id = ?")
      .bind(campaignId)
      .run();

    return Response.json({
      ok: true,
      removedActivityCount,
      retainedActivityCount,
      message: deleteRegisteredInstitutions
        ? retainedActivityCount
          ? `${campaign.name} 명단을 삭제했습니다. 후속 품목·회계 기록이 연결된 ${retainedActivityCount}건은 안전을 위해 기관 기록으로 유지했습니다.`
          : `${campaign.name} 명단과 이 명단이 새로 만든 ${removedActivityCount}건의 기관 기록을 삭제했습니다. 기존 사업에 연결한 기록은 유지됩니다.`
        : `${campaign.name} 명단만 삭제했습니다. 기관별 기록은 유지됩니다.`,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
