import {
  ensureDirectAuthReady,
  findMemberByEmail,
  setMemberPassword,
  validatePassword,
} from "../../../../lib/app-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    email?: string;
    displayName?: string;
    jobTitle?: string;
    password?: string;
  };
  const email = String(payload.email ?? "").trim().toLowerCase();
  const displayName = String(payload.displayName ?? "").trim();
  const jobTitle = String(payload.jobTitle ?? "").trim();
  const password = String(payload.password ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "이메일 주소를 확인해 주세요." }, { status: 400 });
  }
  if (!displayName || !jobTitle) {
    return Response.json({ error: "이름과 직책을 입력해 주세요." }, { status: 400 });
  }
  const passwordError = validatePassword(password);
  if (passwordError) return Response.json({ error: passwordError }, { status: 400 });
  if (await findMemberByEmail(email)) {
    return Response.json(
      { error: "이미 등록된 이메일입니다. 기존 로그인 또는 비밀번호 재설정을 이용해 주세요." },
      { status: 409 },
    );
  }
  const d1 = await ensureDirectAuthReady();
  const rejection = await d1
    .prepare("SELECT email FROM member_rejections WHERE lower(email) = ? LIMIT 1")
    .bind(email)
    .first<{ email: string }>();
  if (rejection) {
    await d1
      .prepare("DELETE FROM member_rejections WHERE lower(email) = ?")
      .bind(email)
      .run();
  }
  const member = await d1
    .prepare(`
      INSERT INTO members (
        email, display_name, job_title, role, permissions, status, is_sales,
        created_at, last_seen_at
      ) VALUES (?, ?, ?, 'member', '[]', 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id
    `)
    .bind(email, displayName, jobTitle)
    .first<{ id: number }>();
  if (!member) {
    return Response.json({ error: "가입 요청을 저장하지 못했습니다." }, { status: 500 });
  }
  await setMemberPassword(Number(member.id), password);
  return Response.json(
    { ok: true, message: "가입 요청을 보냈습니다. 관리자 승인 후 로그인할 수 있습니다." },
    { status: 201 },
  );
}
