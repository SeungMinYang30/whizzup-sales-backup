import {
  ensureDirectAuthReady,
  findMemberByEmail,
} from "../../../../lib/app-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = (await request.json()) as { email?: string };
  const email = String(payload.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "이메일 주소를 확인해 주세요." }, { status: 400 });
  }
  const member = await findMemberByEmail(email);
  const d1 = await ensureDirectAuthReady();
  if (member) {
    await d1
      .prepare(`
        INSERT INTO member_password_reset_requests (member_id, email, status, requested_at)
        SELECT ?, ?, 'pending', CURRENT_TIMESTAMP
        WHERE NOT EXISTS (
          SELECT 1 FROM member_password_reset_requests
          WHERE member_id = ? AND status = 'pending'
        )
      `)
      .bind(Number(member.id), email, Number(member.id))
      .run();
  }
  return Response.json({
    ok: true,
    message:
      "등록된 계정이면 관리자에게 재설정 요청이 전달됩니다. 기존 ChatGPT 로그인이 가능하면 먼저 접속해 비밀번호를 설정할 수 있습니다.",
  });
}
