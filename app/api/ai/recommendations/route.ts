import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import {
  applyAiRecommendation,
  listAiRecommendations,
  saveAiRecommendation,
} from "../../../../lib/ai-recommendations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const url = new URL(request.url);
    const organization = url.searchParams.get("organization")?.trim() || "";
    if (!organization) {
      return Response.json(
        { error: "기관명이 필요합니다." },
        { status: 400 },
      );
    }
    const recommendations = await listAiRecommendations(organization);
    return Response.json({ recommendations });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const activityId = Number(payload.activityId);
    if (!Number.isInteger(activityId) || activityId < 1) {
      return Response.json(
        { error: "올바른 기록 ID가 필요합니다." },
        { status: 400 },
      );
    }
    const recommendation = await saveAiRecommendation(
      activityId,
      payload.recommendation,
      member,
    );
    return Response.json({ recommendation }, { status: 201 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const activityId = Number(payload.activityId);
    if (!Number.isInteger(activityId) || activityId < 1) {
      return Response.json(
        { error: "올바른 기록 ID가 필요합니다." },
        { status: 400 },
      );
    }
    const recommendation = await applyAiRecommendation(activityId, payload);
    return Response.json({ recommendation });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
