import {
  AccessError,
  accessErrorResponse,
  requireApprovedMember,
  requireMemberPermission,
} from "../../../lib/collaboration";
import {
  createJointProject,
  deactivateJointProject,
  listJointProjects,
  type JointProjectMemberInput,
} from "../../../lib/joint-projects";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApprovedMember();
    return Response.json(await listJointProjects());
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireMemberPermission("records:manage");
    const payload = (await request.json()) as Record<string, unknown>;
    const projectId = await createJointProject(
      {
        ...payload,
        members: Array.isArray(payload.members)
          ? (payload.members as JointProjectMemberInput[])
          : [],
      },
      member,
    );
    return Response.json({ ok: true, projectId }, { status: 201 });
  } catch (error) {
    if (error instanceof AccessError) {
      return accessErrorResponse(error);
    }
    if (error instanceof Error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const member = await requireMemberPermission("records:manage");
    const payload = (await request.json()) as { projectId?: unknown };
    const projectId = Number(payload.projectId);
    if (!Number.isSafeInteger(projectId) || projectId < 1) {
      return Response.json(
        { error: "해제할 공동사업을 선택해 주세요." },
        { status: 400 },
      );
    }
    await deactivateJointProject(projectId, member);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AccessError) {
      return accessErrorResponse(error);
    }
    if (error instanceof Error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return accessErrorResponse(error);
  }
}
