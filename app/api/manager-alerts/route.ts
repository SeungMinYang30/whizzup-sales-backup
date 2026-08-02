import {
  AccessError,
  accessErrorResponse,
  ensureCollaborationReady,
  normalizeMemberPermissions,
  requireMemberPermission,
} from "../../../lib/collaboration";
import {
  hideManagerAlertAcknowledgements,
  hideOldManagerAlertAcknowledgements,
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

type ManagerAlertMemberOption = {
  id: number;
  displayName: string;
};

async function resolveManagerAlertTarget(
  requesterId: number,
  requestedMemberId: unknown,
) {
  const d1 = await ensureCollaborationReady();
  const rows = await d1
    .prepare(
      `SELECT id, display_name, role, permissions
       FROM members
       WHERE status = 'approved'
       ORDER BY display_name COLLATE NOCASE, id`,
    )
    .all<{
      id: number;
      display_name: string;
      role: string;
      permissions: string;
    }>();
  const members = rows.results
    .filter(
      (row) =>
        row.role === "admin" ||
        normalizeMemberPermissions(row.permissions).includes("records:manage"),
    )
    .map<ManagerAlertMemberOption>((row) => ({
      id: Number(row.id),
      displayName: String(row.display_name).trim() || `사용자 ${row.id}`,
    }));
  const parsedMemberId = Number(requestedMemberId);
  const selectedMemberId =
    Number.isInteger(parsedMemberId) && parsedMemberId > 0
      ? parsedMemberId
      : requesterId;
  if (!members.some((member) => member.id === selectedMemberId)) {
    throw new AccessError(
      "선택한 사용자는 관리자 영업 점검 권한이 없습니다.",
      403,
    );
  }
  return { members, selectedMemberId };
}

export async function GET(request: Request) {
  try {
    const member = await requireMemberPermission("records:manage");
    const requestedMemberId = new URL(request.url).searchParams.get("memberId");
    const { members, selectedMemberId } = await resolveManagerAlertTarget(
      member.id,
      requestedMemberId,
    );
    const acknowledgements =
      await listManagerAlertAcknowledgements(selectedMemberId);
    return Response.json({ acknowledgements, members, selectedMemberId });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await requireMemberPermission("records:manage");
    const payload = (await request.json()) as Record<string, unknown>;
    const { selectedMemberId } = await resolveManagerAlertTarget(
      member.id,
      payload.memberId,
    );
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
      selectedMemberId,
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
    const { selectedMemberId } = await resolveManagerAlertTarget(
      member.id,
      payload.memberId,
    );
    const organizations = cleanOrganizations(payload.organizations);
    if (!organizations.length || organizations.length > 500) {
      return Response.json(
        { error: "복구할 알림을 올바르게 선택해 주세요." },
        { status: 400 },
      );
    }
    const acknowledgements = await removeManagerAlertAcknowledgements(
      selectedMemberId,
      organizations,
    );
    return Response.json({ acknowledgements });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const member = await requireMemberPermission("records:manage");
    const payload = (await request.json()) as Record<string, unknown>;
    const { selectedMemberId } = await resolveManagerAlertTarget(
      member.id,
      payload.memberId,
    );
    const organizations = cleanOrganizations(payload.organizations);
    const olderThanDays = Number(payload.olderThanDays);

    if (Number.isFinite(olderThanDays)) {
      if (olderThanDays !== 30 || organizations.length) {
        return Response.json(
          { error: "오래된 처리 알림 정리 기준이 올바르지 않습니다." },
          { status: 400 },
        );
      }
      const result = await hideOldManagerAlertAcknowledgements(
        selectedMemberId,
        olderThanDays,
      );
      return Response.json(result);
    }

    if (!organizations.length || organizations.length > 500) {
      return Response.json(
        { error: "숨길 처리 알림을 올바르게 선택해 주세요." },
        { status: 400 },
      );
    }
    const result = await hideManagerAlertAcknowledgements(
      selectedMemberId,
      organizations,
    );
    return Response.json(result);
  } catch (error) {
    return accessErrorResponse(error);
  }
}
