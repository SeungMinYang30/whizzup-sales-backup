import {
  accessErrorResponse,
  getOAuthMember,
} from "../../../../lib/collaboration";
import { insertActivity } from "../../../../lib/records-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const member = await getOAuthMember(request);
    return Response.json({
      connected: true,
      user: {
        name: member.displayName,
        email: member.email,
      },
      message: "위즈업 통화관리 시스템에 연결되었습니다.",
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const member = await getOAuthMember(request);
    const payload = (await request.json()) as Record<string, unknown>;
    const record = await insertActivity(
      { ...payload, sourceChat: "공유 GPT 음성·대화 입력" },
      member,
      "공유 GPT 음성·대화 입력",
    );
    return Response.json(
      {
        ok: true,
        message: `${String(record.organization)} 기록을 공동 관리표에 저장했습니다.`,
        record: {
          id: record.id,
          organization: record.organization,
          activityDate: record.activity_date,
          activityType: record.activity_type,
          contactMethod: record.contact_method,
          region: record.region,
          budgetType: record.budget_type,
          budgetAmount: record.budget_amount,
          topic: record.topic,
          summary: record.summary,
          nextAction: record.next_action,
          followUpDate: record.follow_up_date,
          progressSchedule: record.progress_schedule,
          awardStatus: record.award_status,
          awardCompany: record.award_company,
          executionType: record.execution_type,
          consortiumCompany: record.consortium_company,
          awardStage: record.award_stage,
          progressManager: record.progress_manager,
          createdBy: member.displayName,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("필수")) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return accessErrorResponse(error);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://chatgpt.com",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}
