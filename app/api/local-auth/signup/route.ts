import { getD1 } from "../../../../db";
import {
  hashPassword,
  ensureLocalAuthSchema,
  localMemberEmail,
  normalizeUsername,
  validatePassword,
  validateUsername,
} from "../../../../lib/local-auth";
import { buildMemberDisplayName } from "../../../../lib/member-display-name";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      name?: string;
      jobTitle?: string;
      displayName?: string;
      username?: string;
      password?: string;
    };
    const structuredSignup = payload.name !== undefined || payload.jobTitle !== undefined;
    const name = String(payload.name ?? payload.displayName ?? "").replace(/\s+/g, " ").trim();
    const jobTitle = String(payload.jobTitle ?? "").replace(/\s+/g, " ").trim();
    const displayName = structuredSignup ? buildMemberDisplayName(name, jobTitle) : name;
    const username = normalizeUsername(payload.username);
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
    if (!validateUsername(username)) {
      return Response.json(
        { error: "아이디는 영문 소문자·숫자로 시작하는 4~30자여야 합니다." },
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
    const signupEmail = localMemberEmail(username);
    const rejection = await d1
      .prepare("SELECT email FROM member_rejections WHERE lower(email) = lower(?) LIMIT 1")
      .bind(signupEmail)
      .first<{ email: string }>();
    if (rejection) {
      return Response.json(
        { error: "거절되어 삭제된 가입 요청입니다. 운영자에게 다시 등록을 요청해 주세요." },
        { status: 403 },
      );
    }
    const existing = await d1
      .prepare("SELECT id FROM members WHERE lower(username) = lower(?) LIMIT 1")
      .bind(username)
      .first<{ id: number }>();
    if (existing) {
      return Response.json(
        { error: "이미 사용 중인 아이디입니다." },
        { status: 409 },
      );
    }
    const credential = hashPassword(password);
    await d1
      .prepare(
        `INSERT INTO members (
          email, username, password_hash, password_salt, password_iterations,
          display_name, role, permissions, status, is_sales, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'member', '[]', 'pending', 0, CURRENT_TIMESTAMP)`,
      )
      .bind(
        signupEmail,
        username,
        credential.hash,
        credential.salt,
        credential.iterations,
        displayName,
      )
      .run();
    return Response.json(
      { ok: true, message: "가입 신청이 접수되었습니다. 관리자 승인 후 로그인해 주세요." },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|duplicate/i.test(message)) {
      return Response.json({ error: "이미 사용 중인 아이디입니다." }, { status: 409 });
    }
    return Response.json(
      { error: "가입 신청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
