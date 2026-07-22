import {
  accessErrorResponse,
  requireAdminMember,
} from "../../../lib/collaboration";
import {
  ensureTrashReady,
  permanentlyDeleteTrashBatch,
  purgeExpiredTrash,
  restoreTrashBatch,
  trashBatchJson,
  type TrashBatchRow,
} from "../../../lib/trash-store";

export const dynamic = "force-dynamic";

async function findActiveBatch(id: string) {
  const d1 = await ensureTrashReady();
  const row = await d1
    .prepare(
      `SELECT * FROM deletion_batches
       WHERE id = ? AND restored_at IS NULL
       LIMIT 1`,
    )
    .bind(id)
    .first<TrashBatchRow>();
  return { d1, row };
}

export async function GET() {
  try {
    await requireAdminMember();
    const d1 = await ensureTrashReady();
    await purgeExpiredTrash(d1);
    const result = await d1
      .prepare(
        `SELECT * FROM deletion_batches
         WHERE restored_at IS NULL AND expires_at > CURRENT_TIMESTAMP
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
    const member = await requireAdminMember();
    const payload = (await request.json()) as { id?: unknown };
    const id = String(payload.id || "").trim();
    if (!id) {
      return Response.json({ error: "복원할 항목을 선택해 주세요." }, { status: 400 });
    }
    const { d1, row } = await findActiveBatch(id);
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      return Response.json(
        { error: "복구 기간이 지났거나 이미 처리된 항목입니다." },
        { status: 404 },
      );
    }
    await restoreTrashBatch(d1, row, member.id);
    return Response.json({ ok: true });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdminMember();
    const payload = (await request.json()) as { id?: unknown };
    const id = String(payload.id || "").trim();
    if (!id) {
      return Response.json({ error: "영구 삭제할 항목을 선택해 주세요." }, { status: 400 });
    }
    const { d1, row } = await findActiveBatch(id);
    if (!row) {
      return Response.json({ error: "휴지통 항목을 찾지 못했습니다." }, { status: 404 });
    }
    await permanentlyDeleteTrashBatch(d1, row);
    return Response.json({ ok: true });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
