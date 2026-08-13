import {
  accessErrorResponse,
  requirePrimaryOwner,
} from "../../../../lib/collaboration";
import {
  applyBusinessRoundRolloverRepair,
  previewBusinessRoundRolloverRepair,
} from "../../../../lib/business-round-rollover-repair";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    await requirePrimaryOwner();
    const result = await previewBusinessRoundRolloverRepair();
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePrimaryOwner();
    const payload = (await request.json().catch(() => null)) as {
      confirm?: string;
    } | null;
    if (payload?.confirm !== "APPLY_BUSINESS_ROUND_ROLLOVER") {
      return Response.json({ error: "적용 확인 문구가 올바르지 않습니다." }, { status: 400 });
    }
    return Response.json(await applyBusinessRoundRolloverRepair(), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Business round rollover repair failed", error);
    return accessErrorResponse(error);
  }
}
