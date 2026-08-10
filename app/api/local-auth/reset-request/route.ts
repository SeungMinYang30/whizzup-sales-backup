import { getD1 } from "../../../../db";
import { ensureLocalAuthSchema } from "../../../../lib/local-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { email?: string };
    const email = String(payload.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "이메일 주소를 확인해 주세요." }, { status: 400 });
    }
    await ensureLocalAuthSchema();
    const d1 = getD1();
    const member = await d1
      .prepare("SELECT id FROM members WHERE lower(email) = lower(?) LIMIT 1")
      .bind(email)
      .first<{ id: number }>();
    if (member) {
      await d1
        .prepare(`
          INSERT INTO member_password_reset_requests (
            member_id, email, status, requested_at
          )
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
        "등록된 계정이면 운영자에게 재설정 요청이 전달됩니다. 현재 Sites의 ChatGPT 로그인이 가능하면 먼저 접속해 비밀번호를 설정할 수 있습니다.",
    });
  } catch {
    return Response.json(
      { error: "재설정 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
