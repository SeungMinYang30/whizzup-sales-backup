import {
  accessErrorResponse,
  ensureCollaborationReady,
  requireAdminMember,
} from "../../../lib/collaboration";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminMember();
    const d1 = await ensureCollaborationReady();
    const result = await d1
      .prepare("SELECT key, value FROM app_settings")
      .all<{ key: string; value: string }>();
    return Response.json({
      settings: Object.fromEntries(
        result.results.map((item) => [item.key, item.value]),
      ),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireAdminMember();
    const payload = (await request.json()) as { sharedGptUrl?: string };
    const value = String(payload.sharedGptUrl ?? "").trim();
    if (
      value &&
      !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(value)
    ) {
      return Response.json(
        { error: "올바른 ChatGPT 공유 링크를 입력해 주세요." },
        { status: 400 },
      );
    }
    const d1 = await ensureCollaborationReady();
    await d1
      .prepare(`
        INSERT INTO app_settings (key, value, updated_by, updated_at)
        VALUES ('shared_gpt_url', ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(value, admin.id)
      .run();
    return Response.json({ ok: true, sharedGptUrl: value });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
