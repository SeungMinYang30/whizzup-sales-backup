import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApprovedMember();
    return Response.json({ recommendations: [] });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

async function removedRecommendationResponse() {
  try {
    await requireApprovedMember();
    return Response.json(
      { error: "이전 AI 제안 저장 기능은 종료되었습니다." },
      { status: 410 },
    );
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export const POST = removedRecommendationResponse;
export const PUT = removedRecommendationResponse;
export const DELETE = removedRecommendationResponse;
