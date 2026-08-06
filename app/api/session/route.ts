import {
  accessErrorResponse,
  canManageActivityHistory as memberCanManageActivityHistory,
  ensureCollaborationReady,
  isPrimaryOwner,
  requireMember,
} from "../../../lib/collaboration";
import { getOpenAIConfig } from "../../../lib/openai-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const member = await requireMember(true);
    if (member.status !== "approved") {
      return Response.json({
        member,
        pendingCount: 0,
        approvedCount: 0,
        sharedGptUrl: "",
        aiConfigured: false,
        aiModel: "",
        canViewPresence: false,
        canManageActivityHistory: false,
      });
    }

    const d1 = await ensureCollaborationReady();
    const counts = await d1
      .prepare(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_count
        FROM members
      `)
      .first<{ pending_count: number; approved_count: number }>();

    const gptUrl = await d1
      .prepare("SELECT value FROM app_settings WHERE key = 'shared_gpt_url'")
      .first<{ value: string }>();
    const aiConfig = await getOpenAIConfig();
    const canViewPresence = await isPrimaryOwner(member);
    const canManageActivityHistory =
      member.status === "approved" &&
      (await memberCanManageActivityHistory(member));

    return Response.json({
      member,
      pendingCount: Number(counts?.pending_count ?? 0),
      approvedCount: Number(counts?.approved_count ?? 0),
      sharedGptUrl: gptUrl?.value ?? "",
      aiConfigured: aiConfig.configured,
      aiModel: aiConfig.model,
      canViewPresence,
      canManageActivityHistory,
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
