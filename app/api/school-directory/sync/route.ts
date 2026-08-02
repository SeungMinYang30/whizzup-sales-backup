import {
  accessErrorResponse,
  requireMemberPermission,
} from "../../../../lib/collaboration";
import {
  backfillOrganizationSchoolLinks,
  getSchoolDirectorySettingsStatus,
  syncOfficialSchoolDirectoryPage,
} from "../../../../lib/school-directory";

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
    await requireMemberPermission("integration:manage");
    const payload = (await request.json().catch(() => ({}))) as {
      action?: "directory" | "links";
      page?: number;
      pageSize?: number;
      after?: string;
      limit?: number;
    };
    if (payload.action === "links") {
      return Response.json(
        await backfillOrganizationSchoolLinks(payload.after, payload.limit),
      );
    }
    return Response.json(
      await syncOfficialSchoolDirectoryPage(payload.page, payload.pageSize),
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("나이스")) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return accessErrorResponse(error);
  }
}
