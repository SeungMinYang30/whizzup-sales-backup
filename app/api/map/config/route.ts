import {
  accessErrorResponse,
  ensureCollaborationReady,
  requireAdminMember,
  requireApprovedMember,
} from "../../../../lib/collaboration";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApprovedMember();
    const d1 = await ensureCollaborationReady();
    const row = await d1
      .prepare(
        "SELECT value FROM app_settings WHERE key = 'kakao_javascript_key' LIMIT 1",
      )
      .first<{ value: string }>();
    const javascriptKey = row?.value?.trim() ?? "";
    return Response.json({
      configured: Boolean(javascriptKey),
      javascriptKey,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireAdminMember();
    const payload = (await request.json()) as { javascriptKey?: string };
    const javascriptKey = String(payload.javascriptKey ?? "").trim();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(javascriptKey)) {
      return Response.json(
        { error: "카카오 JavaScript 키를 다시 확인해 주세요." },
        { status: 400 },
      );
    }

    const d1 = await ensureCollaborationReady();
    await d1
      .prepare(`
        INSERT INTO app_settings (key, value, updated_by, updated_at)
        VALUES ('kakao_javascript_key', ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(javascriptKey, admin.id)
      .run();
    return Response.json({ ok: true, configured: true });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
