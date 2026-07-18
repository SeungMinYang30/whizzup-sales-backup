import {
  accessErrorResponse,
  ensureCollaborationReady,
  hashSecret,
  isAllowedChatGPTRedirect,
  isAllowedOAuthScope,
  OAUTH_ACTIVITY_SCOPE,
  randomToken,
  requireApprovedMember,
} from "../../../../lib/collaboration";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const member = await requireApprovedMember();
    const payload = (await request.json()) as Record<string, unknown>;
    const clientId = String(payload.clientId ?? "");
    const redirectUri = String(payload.redirectUri ?? "");
    const responseType = String(payload.responseType ?? "");
    const state = String(payload.state ?? "");
    const scope = String(payload.scope ?? OAUTH_ACTIVITY_SCOPE).trim();
    const codeChallenge = String(payload.codeChallenge ?? "");

    if (
      responseType !== "code" ||
      !clientId ||
      !isAllowedChatGPTRedirect(redirectUri) ||
      !isAllowedOAuthScope(scope)
    ) {
      return Response.json(
        { error: "올바르지 않은 GPT 연결 요청입니다." },
        { status: 400 },
      );
    }

    const d1 = await ensureCollaborationReady();
    const client = await d1
      .prepare("SELECT client_id FROM oauth_clients WHERE client_id = ?")
      .bind(clientId)
      .first();
    if (!client) {
      return Response.json(
        { error: "등록되지 않은 GPT 연결입니다." },
        { status: 400 },
      );
    }

    const code = `whizzup_code_${randomToken(30)}`;
    const codeHash = await hashSecret(code);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await d1
      .prepare(`
        INSERT INTO oauth_codes (
          code_hash, client_id, member_id, redirect_uri, scope,
          code_challenge, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        codeHash,
        clientId,
        member.id,
        redirectUri,
        scope,
        codeChallenge || null,
        expiresAt,
      )
      .run();

    const redirect = new URL(redirectUri);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);
    return Response.json({ redirectTo: redirect.toString() });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
