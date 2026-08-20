import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  listActivityReviewAcknowledgements,
  removeActivityReviewAcknowledgements,
  saveActivityReviewAcknowledgements,
} from "../../../lib/activity-reviews";

export const dynamic = "force-dynamic";

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanActivityIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
}

export async function GET() {
  try {
    const member = await requireApprovedMember();
    const acknowledgements = await listActivityReviewAcknowledgements(member.id);
    return Response.json({ acknowledgements });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    if (!rawItems.length || rawItems.length > 100) {
      return Response.json(
        { error: "점검할 기록을 올바르게 선택해 주세요." },
        { status: 400 },
      );
    }

    const unique = new Map<
      number,
      {
        activityId: number;
        issueSignature: string;
        snoozedUntil: string | null;
      }
    >();
    for (const item of rawItems) {
      if (!item || typeof item !== "object") continue;
      const source = item as Record<string, unknown>;
      const activityId = Number(source.activityId);
      const issueSignature = clean(source.issueSignature, 2_000);
      const snoozedUntilText = clean(source.snoozedUntil, 10);
      const snoozedUntil = snoozedUntilText || null;
      if (
        !Number.isInteger(activityId) ||
        activityId < 1 ||
        !issueSignature ||
        (snoozedUntil && !/^\d{4}-\d{2}-\d{2}$/.test(snoozedUntil))
      ) {
        continue;
      }
      unique.set(activityId, {
        activityId,
        issueSignature,
        snoozedUntil,
      });
    }

    const items = [...unique.values()];
    if (!items.length) {
      return Response.json(
        { error: "처리할 점검 정보가 없습니다." },
        { status: 400 },
      );
    }
    const acknowledgements = await saveActivityReviewAcknowledgements(
      member.id,
      items,
    );
    return Response.json({ acknowledgements });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const activityIds = cleanActivityIds(payload.activityIds);
    if (!activityIds.length || activityIds.length > 100) {
      return Response.json(
        { error: "다시 표시할 기록을 올바르게 선택해 주세요." },
        { status: 400 },
      );
    }
    const acknowledgements = await removeActivityReviewAcknowledgements(
      member.id,
      activityIds,
    );
    return Response.json({ acknowledgements });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
