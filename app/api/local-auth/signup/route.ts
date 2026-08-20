import { getD1 } from "../../../../db";
import {
  ensureLocalAuthSchema,
  setMemberPassword,
  validatePassword,
} from "../../../../lib/local-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      name?: string;
      jobTitle?: string;
      displayName?: string;
      email?: string;
      password?: string;
    };
    const structuredSignup = payload.name !== undefined || payload.jobTitle !== undefined;
    const name = String(payload.name ?? payload.displayName ?? "").replace(/\s+/g, " ").trim();
    const jobTitle = String(payload.jobTitle ?? "").replace(/\s+/g, " ").trim();
    const displayName = name;
    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    if (name.length < 2 || name.length > 40) {
      return Response.json(
        { error: "이름은 2~40자로 입력해 주세요." },
        { status: 400 },
      );
    }
    if (structuredSignup && (jobTitle.length < 1 || jobTitle.length > 20)) {
      return Response.json(
        { error: "직책은 1~20자로 입력해 주세요." },
        { status: 400 },
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json(
        { error: "이메일 주소를 확인해 주세요." },
        { status: 400 },
      );
    }
    if (!validatePassword(password)) {
      return Response.json(
        { error: "비밀번호는 영문과 숫자를 포함해 8자 이상 입력해 주세요." },
        { status: 400 },
      );
    }

    await ensureLocalAuthSchema();
    const d1 = getD1();
    const rejection = await d1
      .prepare("SELECT email FROM member_rejections WHERE lower(email) = lower(?) LIMIT 1")
      .bind(email)
      .first<{ email: string }>();
    if (rejection) {
      return Response.json(
        { error: "거절되어 삭제된 가입 요청입니다. 운영자에게 다시 등록을 요청해 주세요." },
        { status: 403 },
      );
    }
    const existing = await d1
      .prepare("SELECT id FROM members WHERE lower(email) = lower(?) LIMIT 1")
      .bind(email)
      .first<{ id: number }>();
    if (existing) {
      return Response.json(
        { error: "이미 등록된 이메일입니다. 기존 로그인 또는 비밀번호 재설정을 이용해 주세요." },
        { status: 409 },
      );
    }
    const member = await d1
      .prepare(
        `INSERT INTO members (
          email, display_name, job_title, role, permissions, status, is_sales,
          last_seen_at
        ) VALUES (?, ?, ?, 'member', '[]', 'pending', 0, CURRENT_TIMESTAMP)
        RETURNING id`,
      )
      .bind(email, displayName, jobTitle)
      .first<{ id: number }>();
    if (!member) {
      return Response.json({ error: "가입 요청을 저장하지 못했습니다." }, { status: 500 });
    }
    await setMemberPassword(Number(member.id), password);
    return Response.json(
      { ok: true, message: "가입 신청이 접수되었습니다. 관리자 승인 후 로그인해 주세요." },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|duplicate/i.test(message)) {
      return Response.json({ error: "이미 등록된 이메일입니다." }, { status: 409 });
    }
    return Response.json(
      { error: "가입 신청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
