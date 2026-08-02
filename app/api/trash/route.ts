import {
  accessErrorResponse,
  requireMemberPermission,
  requirePrimaryOwner,
} from "../../../lib/collaboration";
import {
  ensureTrashReady,
  permanentlyDeleteTrashBatch,
  purgeExpiredTrash,
  restoreTrashBatch,
  trashBatchJson,
  type TrashBatchRow,
} from "../../../lib/trash-store";
import { chunkValues } from "../../../lib/d1-bulk";
import { logDataControlEvent } from "../../../lib/data-control-store";

export const dynamic = "force-dynamic";
const TRASH_ID_QUERY_CHUNK_SIZE = 50;

function requestedIds(payload: { id?: unknown; ids?: unknown }) {
  const rawIds = Array.isArray(payload.ids) ? payload.ids : [payload.id];
  return [...new Set(rawIds.map((id) => String(id || "").trim()).filter(Boolean))]
    .slice(0, 300);
}

async function findActiveBatches(ids: string[]) {
  const d1 = await ensureTrashReady();
  if (!ids.length) return { d1, rows: [] as TrashBatchRow[] };
  const rows: TrashBatchRow[] = [];
  for (const chunk of chunkValues(ids, TRASH_ID_QUERY_CHUNK_SIZE)) {
    const result = await d1
      .prepare(
        `SELECT * FROM deletion_batches
         WHERE id IN (${chunk.map(() => "?").join(", ")})
           AND restored_at IS NULL
         ORDER BY deleted_at DESC`,
      )
      .bind(...chunk)
      .all<TrashBatchRow>();
    rows.push(...result.results);
  }
  return {
    d1,
    rows: rows.sort((left, right) =>
      right.deleted_at.localeCompare(left.deleted_at),
    ),
  };
}

function failureJson(row: TrashBatchRow, error: unknown) {
  return {
    id: row.id,
    displayName: row.display_name,
    error:
      error instanceof Error && error.message
        ? error.message
        : "처리하지 못했습니다.",
  };
}

export async function GET() {
  try {
    await requireMemberPermission("trash:manage");
    const d1 = await ensureTrashReady();
    await purgeExpiredTrash(d1);
    const result = await d1
      .prepare(
        `SELECT * FROM deletion_batches
         WHERE restored_at IS NULL AND DATETIME(expires_at) > DATETIME('now')
         ORDER BY deleted_at DESC
         LIMIT 300`,
      )
      .all<TrashBatchRow>();
    return Response.json({ items: result.results.map(trashBatchJson) });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      id?: unknown;
      ids?: unknown;
      dataControl?: unknown;
    };
    const member =
      payload.dataControl === true
        ? await requirePrimaryOwner()
        : await requireMemberPermission("trash:manage");
    const ids = requestedIds(payload);
    if (!ids.length) {
      return Response.json({ error: "복원할 항목을 선택해 주세요." }, { status: 400 });
    }
    const { d1, rows } = await findActiveBatches(ids);
    const activeRows = rows.filter(
      (row) => new Date(row.expires_at).getTime() > Date.now(),
    );
    if (!activeRows.length) {
      return Response.json(
        { error: "복구 기간이 지났거나 이미 처리된 항목입니다." },
        { status: 404 },
      );
    }
    const processedIds: string[] = [];
    const failures: ReturnType<typeof failureJson>[] = [];
    for (const row of activeRows) {
      try {
        await restoreTrashBatch(d1, row, member.id);
        processedIds.push(row.id);
      } catch (error) {
        failures.push(failureJson(row, error));
      }
    }
    if (processedIds.length) {
      await logDataControlEvent({
        action: "restore",
        subject:
          activeRows.length === 1
            ? activeRows[0].display_name
            : `${processedIds.length}개 보관 항목`,
        itemCount: activeRows
          .filter((row) => processedIds.includes(row.id))
          .reduce((total, row) => total + (Number(row.item_count) || 0), 0),
        archiveIds: processedIds,
        actorMemberId: member.id,
        actorName: member.displayName,
      });
    }
    return Response.json({
      ok: failures.length === 0,
      processed: processedIds.length,
      processedIds,
      failedCount: failures.length,
      failures,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = (await request.json()) as {
      id?: unknown;
      ids?: unknown;
      all?: unknown;
      dataControl?: unknown;
    };
    const member =
      payload.dataControl === true
        ? await requirePrimaryOwner()
        : await requireMemberPermission("trash:manage");
    const ids = requestedIds(payload);
    if (!payload.all && !ids.length) {
      return Response.json({ error: "영구 삭제할 항목을 선택해 주세요." }, { status: 400 });
    }
    const d1 = await ensureTrashReady();
    const rows = payload.all === true
      ? (
          await d1
            .prepare(
              `SELECT * FROM deletion_batches
               WHERE restored_at IS NULL
               ORDER BY deleted_at DESC
               LIMIT 300`,
            )
            .all<TrashBatchRow>()
        ).results
      : (await findActiveBatches(ids)).rows;
    if (!rows.length) {
      return Response.json({ error: "휴지통 항목을 찾지 못했습니다." }, { status: 404 });
    }
    const processedIds: string[] = [];
    const failures: ReturnType<typeof failureJson>[] = [];
    for (const row of rows) {
      try {
        await permanentlyDeleteTrashBatch(d1, row);
        processedIds.push(row.id);
      } catch (error) {
        failures.push(failureJson(row, error));
      }
    }
    if (processedIds.length) {
      await logDataControlEvent({
        action: "purge",
        subject:
          rows.length === 1
            ? rows[0].display_name
            : `${processedIds.length}개 보관 항목`,
        itemCount: rows
          .filter((row) => processedIds.includes(row.id))
          .reduce((total, row) => total + (Number(row.item_count) || 0), 0),
        archiveIds: processedIds,
        actorMemberId: member.id,
        actorName: member.displayName,
      });
    }
    return Response.json({
      ok: failures.length === 0,
      processed: processedIds.length,
      processedIds,
      failedCount: failures.length,
      failures,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
