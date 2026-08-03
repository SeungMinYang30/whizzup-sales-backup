import {
  accessErrorResponse,
  requireApprovedMember,
} from "../../../lib/collaboration";
import {
  listOrganizationSchedules,
  replaceOrganizationSchedules,
} from "../../../lib/organization-schedules";
import { listScheduleRemindersForMember } from "../../../lib/schedule-reminders";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const member = await requireApprovedMember();
    const url = new URL(request.url);
    if (url.searchParams.get("scope") === "reminders") {
      return Response.json({
        reminders: await listScheduleRemindersForMember(member),
      });
    }
    const organization = url.searchParams.get("organization") ?? "";
    const businessRound = url.searchParams.get("businessRound") ?? "1";
    return Response.json({
      schedules: await listOrganizationSchedules(organization, businessRound),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const schedules = await replaceOrganizationSchedules({
      organization: payload.organization,
      businessRound: payload.businessRound,
      schedules: payload.schedules,
      memberId: member.id,
      memberName: member.displayName,
    });
    return Response.json({ schedules });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
