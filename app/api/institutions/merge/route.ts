import {
  accessErrorResponse,
  requireMemberPermission,
} from "../../../../lib/collaboration";
import {
  inspectInstitutionMerge,
  mergeInstitutionRecords,
} from "../../../../lib/institution-merge";

export const dynamic = "force-dynamic";

function cleanOrganization(value: unknown) {
  return String(value ?? "").trim().slice(0, 120);
}

export async function POST(request: Request) {
  try {
    const member = await requireMemberPermission("records:manage");
    const payload = (await request.json()) as {
      organizations?: unknown[];
      targetOrganization?: unknown;
      confirm?: boolean;
    };
    const organizations = [
      ...new Set(
        (Array.isArray(payload.organizations) ? payload.organizations : [])
          .map(cleanOrganization)
          .filter(Boolean),
      ),
    ];
    if (organizations.length !== 2) {
      return Response.json(
        { error: "합칠 기관을 정확히 두 곳 선택해 주세요." },
        { status: 400 },
      );
    }

    const preview = await inspectInstitutionMerge(organizations);
    if (preview.organizations.some((item) => item.activityCount < 1)) {
      return Response.json(
        { error: "선택한 기관의 기록을 찾지 못했습니다. 목록을 새로고침해 주세요." },
        { status: 404 },
      );
    }
    if (payload.confirm !== true) {
      return Response.json({ preview });
    }

    const targetOrganization = cleanOrganization(payload.targetOrganization);
    if (!organizations.includes(targetOrganization)) {
      return Response.json(
        { error: "최종으로 사용할 기관명을 선택해 주세요." },
        { status: 400 },
      );
    }
    const sourceOrganization = organizations.find(
      (organization) => organization !== targetOrganization,
    );
    if (!sourceOrganization) {
      return Response.json(
        { error: "합쳐질 기관을 확인하지 못했습니다." },
        { status: 400 },
      );
    }
    const result = await mergeInstitutionRecords(
      sourceOrganization,
      targetOrganization,
      member.id,
    );
    return Response.json({
      ok: true,
      sourceOrganization,
      targetOrganization,
      result,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
