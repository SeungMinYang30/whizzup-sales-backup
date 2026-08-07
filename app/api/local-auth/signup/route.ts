import { getD1 } from "../../../../db";
import {
  hashPassword,
  localMemberEmail,
  normalizeUsername,
  validatePassword,
  validateUsername,
} from "../../../../lib/local-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      displayName?: string;
      username?: string;
      password?: string;
    };
    const displayName = String(payload.displayName ?? "").trim();
    const username = normalizeUsername(payload.username);
    const password = String(payload.password ?? "");
    if (displayName.length < 2 || displayName.length > 40) {
      return Response.json(
        { error: "이름은 2~40자로 입력해 주세요." },
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

    const d1 = getD1();
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
        localMemberEmail(username),
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
