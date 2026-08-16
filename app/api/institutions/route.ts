import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import { ensureRecordsReady } from "../../../lib/records-store";
import { ensureEquipmentReady } from "../../../lib/equipment-store";
import {
  serializeActivityBudgets,
  type ActivityBudgetAllocation,
} from "../../../lib/activity-budgets";
import {
  backfillInstitutionRegistryFromRecordTrash,
  ensureTrashReady,
} from "../../../lib/trash-store";

export async function GET() {
  try {
    await requireApprovedMember();
    const d1 = await ensureRecordsReady();
    await ensureTrashReady();
    await backfillInstitutionRegistryFromRecordTrash(d1);
    const [result, projectResult] = await Promise.all([
      d1
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
      .all<Record<string, unknown>>(),
      ensureEquipmentReady().then((equipmentDb) =>
        equipmentDb
          .prepare(
            `SELECT organization, business_round AS "businessRound",
                    budget_type AS "budgetType", budget_original_name AS "budgetOriginalName",
                    budget_group_id AS "budgetGroupId", budget_match_status AS "budgetMatchStatus",
                    budget_match_method AS "budgetMatchMethod", budget_request_id AS "budgetRequestId",
                    budget_kind AS "budgetKind", budget_amount AS "budgetAmount",
                    budget_amount_source AS "budgetAmountSource"
             FROM equipment_projects
             WHERE activity_id IS NULL
               AND TRIM(COALESCE(budget_type, '')) <> ''
             ORDER BY organization, business_round, updated_at DESC, id DESC`,
          )
          .all<Record<string, unknown>>(),
      ),
    ]);
    const budgetsByOrganization = new Map<string, Record<string, unknown>[]>();
    for (const project of projectResult.results ?? []) {
      if (Number(project.businessRound) !== 1) continue;
      const organization = String(project.organization ?? "");
      const budgets = budgetsByOrganization.get(organization) ?? [];
      budgets.push({
        budgetType: project.budgetType,
        budgetAmount: project.budgetAmount ?? "",
        budgetOriginalName: project.budgetOriginalName,
        budgetGroupId: project.budgetGroupId,
        budgetMatchStatus: project.budgetMatchStatus,
        budgetMatchMethod: project.budgetMatchMethod,
        budgetRequestId: project.budgetRequestId,
        budgetKind: project.budgetKind,
        budgetAmountMode: "manual",
        budgetInstitutionAmount: project.budgetAmount ?? "",
        budgetQuoteAmount: null,
        budgetAmountOverride: "",
        budgetAmountSource: project.budgetAmountSource ?? "missing",
      });
      budgetsByOrganization.set(organization, budgets);
    }
    return Response.json({
      institutions: (result.results ?? []).map((institution: Record<string, unknown>) => {
        const budgets = budgetsByOrganization.get(String(institution.organization ?? "")) ?? [];
        const primary = budgets[0] ?? {};
        return {
          ...institution,
          ...primary,
          budgetsJson: serializeActivityBudgets(budgets as ActivityBudgetAllocation[]),
        };
      }),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
