import {
  accessErrorResponse,
  requireActivityHistoryManager,
} from "../../../lib/collaboration";
import {
  ACTIVITY_CHANGE_SCOPES,
  ACTIVITY_CHANGE_TRACKED_COLUMNS,
  ACTIVITY_CHANGE_UNDO_CHUNK_SIZE,
  ensureActivityChangeLedgerReady,
  getActivityChangeBatch,
  parseChangedFields,
  parseJsonObject,
  isActivityChangeScope,
  type ActivityChangeBatchRow,
  type ActivityChangeItemRow,
  type ActivityChangeTrackedColumn,
  valuesEqual,
} from "../../../lib/activity-change-ledger";
import {
  ensureBudgetNamesReady,
  linkBudgetNameEntity,
  normalizeBudgetNameKey,
  resolveBudgetRecordMetadata,
} from "../../../lib/budget-names";

export const dynamic = "force-dynamic";

type ActivityRow = { id: number } & Record<
  ActivityChangeTrackedColumn,
  string | number | null
>;

function positiveLimit(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(100, parsed)
    : 25;
}

function nonNegativeOffset(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function bindableValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return String(value);
}

async function loadActivities(
  d1: Awaited<ReturnType<typeof ensureActivityChangeLedgerReady>>,
  ids: number[],
) {
  const rows = new Map<number, ActivityRow>();
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await d1
      .prepare(
        `SELECT id, ${ACTIVITY_CHANGE_TRACKED_COLUMNS.join(", ")}
         FROM activities
         WHERE id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<ActivityRow>();
    result.results.forEach((row) => rows.set(Number(row.id), row));
  }
  return rows;
}

function storedUndoResult(batch: ActivityChangeBatchRow) {
  const result = parseJsonObject(batch.undo_result_json);
  return {
    batchId: batch.id,
    status: batch.status,
    restoredCount: Number(result.restoredCount) || 0,
    conflictCount: Number(result.conflictCount) || 0,
    missingCount: Number(result.missingCount) || 0,
    partialRestoredCount: Number(result.partialRestoredCount) || 0,
    noChangeCount: Number(result.noChangeCount) || 0,
    alreadyUndone: true,
  };
}

export async function GET(request: Request) {
  try {
    await requireActivityHistoryManager();
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope")?.trim() || "";
    const allScopes = scope === "all";
    if (!allScopes && !isActivityChangeScope(scope)) {
      return Response.json(
        { error: "조회할 변경 이력 범위를 올바르게 선택해 주세요." },
        { status: 400 },
      );
    }
    const limit = positiveLimit(url.searchParams.get("limit"));
    const offset = nonNegativeOffset(url.searchParams.get("offset"));
    const d1 = await ensureActivityChangeLedgerReady();
    const scopeWhere = allScopes
      ? `scope IN (${ACTIVITY_CHANGE_SCOPES.map(() => "?").join(", ")})`
      : "scope = ?";
    const scopeBindings = allScopes ? [...ACTIVITY_CHANGE_SCOPES] : [scope];
    const result = await d1
      .prepare(
        `SELECT *
         FROM activity_change_batches
         WHERE ${scopeWhere}
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(...scopeBindings, limit + 1, offset)
      .all<ActivityChangeBatchRow>();
    const hasMore = result.results.length > limit;
    const pageBatches = result.results.slice(0, limit);
    const batchIds = pageBatches.map((batch) => batch.id);
    const samplesByBatch = new Map<string, string[]>();
    const changedCounts = new Map<string, number>();
    if (batchIds.length) {
      const placeholders = batchIds.map(() => "?").join(", ");
      const items = await d1
        .prepare(
          `SELECT batch_id, organization, changed_fields_json
           FROM activity_change_items
           WHERE batch_id IN (${placeholders})
           ORDER BY id ASC`,
        )
        .bind(...batchIds)
        .all<{
          batch_id: string;
          organization: string;
          changed_fields_json: string;
        }>();
      for (const item of items.results) {
        const samples = samplesByBatch.get(item.batch_id) ?? [];
        if (
          item.organization &&
          !samples.includes(item.organization) &&
          samples.length < 5
        ) {
          samples.push(item.organization);
        }
        samplesByBatch.set(item.batch_id, samples);
        if (parseChangedFields(item.changed_fields_json).length) {
          changedCounts.set(
            item.batch_id,
            (changedCounts.get(item.batch_id) ?? 0) + 1,
          );
        }
      }
    }

    return Response.json({
      scope,
      offset,
      nextOffset: offset + pageBatches.length,
      hasMore,
      batches: pageBatches.map((batch) => {
        const undoResult = parseJsonObject(batch.undo_result_json);
        const itemCount = Number(batch.item_count) || 0;
        const appliedCount = changedCounts.get(batch.id) ?? 0;
        return {
          id: batch.id,
          scope: batch.scope,
          scopeLabel: batch.scope === "pre_awards" ? "수주 전" : "수주 후",
          operationId: batch.id,
          label: batch.operation_label,
          operationLabel: batch.operation_label,
          actionType:
            batch.scope === "pre_awards"
              ? "bulk_pre_award_update"
              : "bulk_award_update",
          operationTotal: Number(batch.operation_total) || 0,
          itemCount,
          count: itemCount,
          appliedCount,
          changedCount: appliedCount,
          conflictCount: Number(undoResult.conflictCount) || 0,
          status: batch.status,
          undoable: !batch.undone_at && appliedCount > 0,
          changedByName: batch.actor_name,
          actorName: batch.actor_name,
          createdAt: batch.created_at,
          completedAt: batch.completed_at,
          undoneAt: batch.undone_at,
          undoneByName: batch.undone_by_name,
          sampleOrganizations: samplesByBatch.get(batch.id) ?? [],
        };
      }),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActivityHistoryManager();
    const payload = (await request.json()) as Record<string, unknown>;
    const action =
      typeof payload.action === "string" ? payload.action.trim() : "";
    const batchId =
      typeof payload.batchId === "string" ? payload.batchId.trim() : "";
    if (action !== "undo" || !batchId || batchId.length > 100) {
      return Response.json(
        { error: "되돌릴 일괄 변경 작업을 올바르게 선택해 주세요." },
        { status: 400 },
      );
    }

    const d1 = await ensureActivityChangeLedgerReady();
    const batch = await getActivityChangeBatch(d1, batchId);
    if (!batch || !isActivityChangeScope(batch.scope)) {
      return Response.json(
        { error: "되돌릴 일괄 변경 이력을 찾을 수 없습니다." },
        { status: 404 },
      );
    }
    if (batch.undone_at) {
      return Response.json(storedUndoResult(batch));
    }

    const itemResult = await d1
      .prepare(
        `SELECT *
         FROM activity_change_items
         WHERE batch_id = ?
         ORDER BY id ASC`,
      )
      .bind(batchId)
      .all<ActivityChangeItemRow>();
    if (!itemResult.results.length) {
      return Response.json(
        { error: "이 작업에는 되돌릴 변경 기록이 없습니다." },
        { status: 409 },
      );
    }

    const pendingItems = itemResult.results.filter(
      (item) => item.undo_status === "pending",
    );
    const pendingIds = pendingItems.map((item) => Number(item.activity_id));
    const beforeUpdateRows = await loadActivities(d1, pendingIds);

    const updateStatements = [];
    for (const item of pendingItems) {
      const current = beforeUpdateRows.get(Number(item.activity_id));
      if (!current) continue;
      const before = parseJsonObject(item.before_json);
      const after = parseJsonObject(item.after_json);
      const changedFields = parseChangedFields(item.changed_fields_json);
      const restorableFields = changedFields.filter((field) =>
        valuesEqual(current[field], after[field]),
      );
      if (!restorableFields.length) continue;
      const assignments = restorableFields
        .map(
          (field) =>
            `${field} = CASE WHEN ${field} IS ? THEN ? ELSE ${field} END`,
        )
        .join(", ");
      const bindings = restorableFields.flatMap((field) => [
        bindableValue(after[field]),
        bindableValue(before[field]),
      ]);
      updateStatements.push(
        d1
          .prepare(
            `UPDATE activities
             SET ${assignments}, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          )
          .bind(...bindings, Number(item.activity_id)),
      );
    }
    for (
      let start = 0;
      start < updateStatements.length;
      start += ACTIVITY_CHANGE_UNDO_CHUNK_SIZE
    ) {
      await d1.batch(
        updateStatements.slice(
          start,
          start + ACTIVITY_CHANGE_UNDO_CHUNK_SIZE,
        ),
      );
    }

    const afterUpdateRows = await loadActivities(d1, pendingIds);
    const restoredBudgetItems = pendingItems.filter((item) => {
      const current = afterUpdateRows.get(Number(item.activity_id));
      const before = parseJsonObject(item.before_json);
      return (
        current &&
        parseChangedFields(item.changed_fields_json).includes("budget_type") &&
        valuesEqual(current.budget_type, before.budget_type)
      );
    });
    if (restoredBudgetItems.length) {
      await ensureBudgetNamesReady();
      for (const item of restoredBudgetItems) {
        const current = afterUpdateRows.get(Number(item.activity_id));
        if (!current) continue;
        const metadata = await resolveBudgetRecordMetadata(d1, {
          budgetType: current.budget_type,
          budgetOriginalName: current.budget_type,
          budgetAmount: current.budget_amount,
          budgetInstitutionAmount: current.budget_amount,
          budgetAmountSource: current.budget_amount ? "manual" : "missing",
          awardStatus: current.award_status,
        });
        await d1
          .prepare(
            `UPDATE activities
             SET budget_original_name = ?,
                 budget_group_id = ?, budget_match_status = ?,
                 budget_match_method = ?, budget_request_id = ?,
                 budget_kind = ?, budget_amount_mode = ?,
                 budget_amount_override = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          )
          .bind(
            metadata.budgetOriginalName,
            metadata.budgetGroupId,
            metadata.budgetMatchStatus,
            metadata.budgetMatchMethod,
            metadata.budgetRequestId,
            metadata.budgetKind,
            metadata.budgetAmountMode,
            metadata.budgetAmountOverride,
            Number(item.activity_id),
          )
          .run();
        await linkBudgetNameEntity(d1, {
          entityType: "activity",
          entityId: Number(item.activity_id),
          groupId: metadata.budgetGroupId,
          originalName: metadata.budgetOriginalName,
          aliasKey:
            metadata.resolution?.aliasKey ??
            normalizeBudgetNameKey(metadata.budgetOriginalName),
        });
      }
    }
    const auditStatements = pendingItems.map((item) => {
      const current = afterUpdateRows.get(Number(item.activity_id));
      const before = parseJsonObject(item.before_json);
      const changedFields = parseChangedFields(item.changed_fields_json);
      let undoStatus = "restored";
      let result: Record<string, unknown>;
      if (!current) {
        undoStatus = "missing";
        result = { restoredFields: [], conflictFields: [], missing: true };
      } else if (!changedFields.length) {
        undoStatus = "no_change";
        result = { restoredFields: [], conflictFields: [], missing: false };
      } else {
        const restoredFields = changedFields.filter((field) =>
          valuesEqual(current[field], before[field]),
        );
        const conflictFields = changedFields.filter(
          (field) => !valuesEqual(current[field], before[field]),
        );
        if (conflictFields.length) undoStatus = "conflict";
        result = { restoredFields, conflictFields, missing: false };
      }
      return d1
        .prepare(
          `UPDATE activity_change_items
           SET undone_at = CURRENT_TIMESTAMP,
               undone_by_member_id = ?,
               undone_by_name = ?,
               undo_status = ?,
               undo_result_json = ?
           WHERE id = ? AND undo_status = 'pending'`,
        )
        .bind(
          actor.id,
          actor.displayName,
          undoStatus,
          JSON.stringify(result),
          Number(item.id),
        );
    });
    for (let start = 0; start < auditStatements.length; start += 50) {
      await d1.batch(auditStatements.slice(start, start + 50));
    }

    const finalItems = await d1
      .prepare(
        `SELECT undo_status, undo_result_json
         FROM activity_change_items
         WHERE batch_id = ?`,
      )
      .bind(batchId)
      .all<{ undo_status: string; undo_result_json: string }>();
    const restoredCount = finalItems.results.filter(
      (item) => item.undo_status === "restored",
    ).length;
    const conflictCount = finalItems.results.filter(
      (item) => item.undo_status === "conflict",
    ).length;
    const missingCount = finalItems.results.filter(
      (item) => item.undo_status === "missing",
    ).length;
    const partialRestoredCount = finalItems.results.filter((item) => {
      if (item.undo_status !== "conflict") return false;
      const itemResult = parseJsonObject(item.undo_result_json);
      return (
        Array.isArray(itemResult.restoredFields) &&
        itemResult.restoredFields.length > 0
      );
    }).length;
    const noChangeCount = finalItems.results.filter(
      (item) => item.undo_status === "no_change",
    ).length;
    const result = {
      restoredCount,
      partialRestoredCount,
      conflictCount,
      missingCount,
      noChangeCount,
    };
    const status =
      conflictCount || missingCount ? "partially_undone" : "undone";
    await d1
      .prepare(
        `UPDATE activity_change_batches
         SET status = ?,
             undone_at = COALESCE(undone_at, CURRENT_TIMESTAMP),
             undone_by_member_id = COALESCE(undone_by_member_id, ?),
             undone_by_name = CASE
               WHEN undone_by_name = '' THEN ?
               ELSE undone_by_name
             END,
             undo_result_json = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(status, actor.id, actor.displayName, JSON.stringify(result), batchId)
      .run();

    return Response.json({
      batchId,
      status,
      ...result,
      alreadyUndone: false,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
