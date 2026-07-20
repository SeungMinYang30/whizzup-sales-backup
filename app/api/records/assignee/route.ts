import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import { transferActivityAssignment } from "../../../../lib/activity-assignment-history";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const activityId = Number(payload.activityId);
    const targetMemberId = Number(payload.targetMemberId);
    if (
      !Number.isInteger(activityId) ||
      activityId < 1 ||
      !Number.isInteger(targetMemberId) ||
      targetMemberId < 1
    ) {
      return Response.json(
        { error: "기록과 새 담당자를 올바르게 선택해 주세요." },
        { status: 400 },
      );
    }
    return Response.json(
      await transferActivityAssignment(activityId, targetMemberId, member),
    );
  } catch (error) {
    return accessErrorResponse(error);
  }
}
