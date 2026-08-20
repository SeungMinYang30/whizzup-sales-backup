import {
  accessErrorResponse,
  requireMemberPermission,
} from "../../../lib/collaboration";
import {
  getOpenAISettingsStatus,
  revertOpenAICredential,
  saveOpenAICredential,
  testOpenAICredential,
} from "../../../lib/openai-credentials";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireMemberPermission("integration:manage");
    return Response.json(await getOpenAISettingsStatus());
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireMemberPermission("integration:manage");
    const payload = (await request.json()) as {
      action?: string;
      apiKey?: string;
      model?: string;
    };
    const action = String(payload.action ?? "");
    if (action === "revert") {
      await revertOpenAICredential();
      return Response.json({
        ok: true,
        status: await getOpenAISettingsStatus(),
      });
    }
    if (action === "test") {
      const result = await testOpenAICredential(
        String(payload.apiKey ?? ""),
        String(payload.model ?? ""),
      );
      return Response.json({ ok: true, ...result });
    }
    if (action === "save") {
      await saveOpenAICredential(
        String(payload.apiKey ?? ""),
        String(payload.model ?? ""),
        member.id,
      );
      return Response.json({
        ok: true,
        status: await getOpenAISettingsStatus(),
      });
    }
    return Response.json(
      { error: "지원하지 않는 API 설정 작업입니다." },
      { status: 400 },
    );
  } catch (error) {
    return accessErrorResponse(error);
  }
}
