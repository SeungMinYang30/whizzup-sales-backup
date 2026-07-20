import {
  accessErrorResponse,
  requireMemberPermission,
} from "../../../lib/collaboration";
import {
  listManagerAlertAcknowledgements,
  removeManagerAlertAcknowledgements,
  saveManagerAlertAcknowledgements,
} from "../../../lib/manager-alerts";

export const dynamic = "force-dynamic";

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanOrganizations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => clean(item, 120))
        .filter(Boolean),
    ),
  ];
}

export async function GET() {
  try {
    const member = await requireMemberPermission("records:manage");
    const acknowledgements = await listManagerAlertAcknowledgements(member.id);
    return Response.json({ acknowledgements });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireMemberPermission("records:manage");
    const payload = (await request.json()) as Record<string, unknown>;
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    if (!rawItems.length || rawItems.length > 500) {
      return Response.json(
        { error: "처리할 알림을 올바르게 선택해 주세요." },
        { status: 400 },
      );
    }
    const unique = new Map<
      string,
      {
        organization: string;
        issueSignature: string;
        snoozedUntil: string | null;
      }
    >();
    for (const item of rawItems) {
      if (!item || typeof item !== "object") continue;
      const source = item as Record<string, unknown>;
      const organization = clean(source.organization, 120);
      const issueSignature = clean(source.issueSignature, 1_500);
      const snoozedUntilText = clean(source.snoozedUntil, 10);
      const snoozedUntil = snoozedUntilText || null;
      if (
        !organization ||
        !issueSignature ||
        (snoozedUntil && !/^\d{4}-\d{2}-\d{2}$/.test(snoozedUntil))
      ) {
        continue;
      }
      unique.set(organization, {
        organization,
        issueSignature,
        snoozedUntil,
      });
    }
    const items = [...unique.values()];
    if (!items.length) {
      return Response.json(
        { error: "처리할 수 있는 알림 정보가 없습니다." },
        { status: 400 },
      );
    }
    const acknowledgements = await saveManagerAlertAcknowledgements(
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
    const member = await requireMemberPermission("records:manage");
    const payload = (await request.json()) as Record<string, unknown>;
    const organizations = cleanOrganizations(payload.organizations);
    if (!organizations.length || organizations.length > 500) {
      return Response.json(
        { error: "복구할 알림을 올바르게 선택해 주세요." },
        { status: 400 },
      );
    }
    const acknowledgements = await removeManagerAlertAcknowledgements(
      member.id,
      organizations,
    );
    return Response.json({ acknowledgements });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
