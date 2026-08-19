import {
  accessErrorResponse,
  requireMemberPermission,
} from "../../../lib/collaboration";
import { getGoogleDriveConnectionStatus } from "../../../lib/google-drive-storage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireMemberPermission("integration:manage");
    const verify = new URL(request.url).searchParams.get("verify") === "1";
    return Response.json(await getGoogleDriveConnectionStatus(verify));
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireMemberPermission("integration:manage");
    const payload = (await request.json().catch(() => ({}))) as {
      action?: unknown;
    };
    if (String(payload.action || "") !== "test") {
      return Response.json(
        { error: "지원하지 않는 Google Drive 연결 작업입니다." },
        { status: 400 },
      );
    }
    return Response.json(await getGoogleDriveConnectionStatus(true));
  } catch (error) {
    return accessErrorResponse(error);
  }
}
