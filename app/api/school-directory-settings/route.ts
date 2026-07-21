import {
  accessErrorResponse,
  requireMemberPermission,
} from "../../../lib/collaboration";
import {
  getSchoolDirectorySettingsStatus,
  revertSchoolDirectoryCredential,
  saveSchoolDirectoryCredential,
  testSchoolDirectoryCredential,
} from "../../../lib/school-directory";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireMemberPermission("integration:manage");
    return Response.json(await getSchoolDirectorySettingsStatus());
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireMemberPermission("integration:manage");
    const payload = (await request.json()) as {
      action?: "test" | "save" | "revert";
      apiKey?: string;
    };
    const action = payload.action;
    const apiKey = String(payload.apiKey ?? "").trim();
    if (action === "revert") {
      await revertSchoolDirectoryCredential();
      return Response.json({
        ok: true,
        status: await getSchoolDirectorySettingsStatus(),
      });
    }
    if (action === "test") {
      return Response.json({
        ok: true,
        ...(await testSchoolDirectoryCredential(apiKey)),
      });
    }
    if (action === "save") {
      await saveSchoolDirectoryCredential(apiKey, member.id);
      return Response.json({
        ok: true,
        status: await getSchoolDirectorySettingsStatus(),
      });
    }
    return Response.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "학교정보 연결을 확인하지 못했습니다.";
    if (message.includes("나이스") || message.includes("암호화")) {
      return Response.json({ error: message }, { status: 400 });
    }
    return accessErrorResponse(error);
  }
}
