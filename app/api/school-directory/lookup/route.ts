import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../../lib/collaboration";
import { resolveOfficialSchoolName } from "../../../../lib/school-directory";

export const dynamic = "force-dynamic";

function callablePhone(value: unknown) {
  const phone = String(value ?? "").trim();
  if (!phone || /^(?:미등록|미입력|해당\s*없음|-)$/.test(phone)) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || /^0+$/.test(digits) || digits === "01000000000") {
    return "";
  }
  return phone;
}

export async function GET(request: Request) {
  try {
    await requireApprovedMember();
    const url = new URL(request.url);
    const organization =
      url.searchParams.get("organization")?.trim().slice(0, 120) || "";
    const legacyContext =
      url.searchParams.get("context")?.trim().slice(0, 800) || "";
    const region =
      url.searchParams.get("region")?.trim().slice(0, 120) || legacyContext;
    const address =
      url.searchParams.get("address")?.trim().slice(0, 500) || "";

    if (!organization) {
      return Response.json(
        { error: "학교명이 필요합니다." },
        { status: 400 },
      );
    }

    const school = await resolveOfficialSchoolName(
      organization,
      region,
      address,
    );
    const phone = callablePhone(school?.phone);
    if (!school || !phone) {
      return Response.json({ school: null });
    }

    return Response.json({
      school: {
        name: school.name,
        region: school.region,
        address: school.address,
        phone,
        schoolCode: school.schoolCode,
        source: "교육청 학교기본정보",
      },
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
