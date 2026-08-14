import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import {
  inspectInstitutionMerge,
  mergeInstitutionRecords,
  type InstitutionMergeResolutions,
} from "../../../../lib/institution-merge";

export const dynamic = "force-dynamic";

function cleanOrganization(value: unknown) {
  return String(value ?? "").trim().slice(0, 120);
}

export async function POST(request: Request) {
  try {
    // Institution merging is a shared correction workflow. Any approved
    // employee may merge duplicate institutions; administrative recovery and
    // permanent cleanup remain protected by their separate APIs.
    const member = await requireApprovedMember();
    const payload = (await request.json()) as {
      organizations?: unknown[];
      targetOrganization?: unknown;
      confirm?: boolean;
      resolutions?: unknown;
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
    const sourceOrganizations = organizations.filter(
      (organization) => organization !== targetOrganization,
    );
    if (!sourceOrganizations.length) {
      return Response.json(
        { error: "합쳐질 기관을 확인하지 못했습니다." },
        { status: 400 },
      );
    }
    const requestedResolutions =
      payload.resolutions &&
      typeof payload.resolutions === "object" &&
      !Array.isArray(payload.resolutions)
        ? (payload.resolutions as Record<string, unknown>)
        : {};
    const resolutions: InstitutionMergeResolutions = {};
    for (const conflict of preview.conflicts) {
      const requestedValue = String(
        requestedResolutions[conflict.key] ?? "",
      ).trim();
      resolutions[conflict.key] = conflict.options.some(
        (option) => option.value === requestedValue,
      )
        ? requestedValue
        : conflict.recommendedValue;
    }
    const results = [];
    for (const sourceOrganization of sourceOrganizations) {
      results.push(
        await mergeInstitutionRecords(
          sourceOrganization,
          targetOrganization,
          member.id,
          resolutions,
        ),
      );
    }
    const result = await inspectInstitutionMerge([targetOrganization]);
    return Response.json({
      ok: true,
      sourceOrganizations,
      targetOrganization,
      result,
      results,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
