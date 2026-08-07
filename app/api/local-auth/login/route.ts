import { getD1 } from "../../../../db";
import {
  createLocalSession,
  normalizeUsername,
  verifyPassword,
} from "../../../../lib/local-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      username?: string;
      password?: string;
    };
    const username = normalizeUsername(payload.username);
    const password = String(payload.password ?? "");
    const d1 = getD1();
    const member = await d1
      .prepare(
        `SELECT id, password_hash, password_salt, password_iterations,
                failed_login_count, locked_until
         FROM members
         WHERE lower(username) = lower(?)
         LIMIT 1`,
      )
      .bind(username)
      .first<{
        id: number;
        password_hash: string | null;
        password_salt: string | null;
        password_iterations: number;
        failed_login_count: number;
        locked_until: string | null;
      }>();

    const lockedUntil = member?.locked_until
      ? new Date(member.locked_until).getTime()
      : 0;
    if (lockedUntil > Date.now()) {
      return Response.json(
        { error: "로그인 시도가 많아 잠시 잠겼습니다. 15분 후 다시 시도해 주세요." },
        { status: 429 },
      );
    }

    const valid = Boolean(
      member?.password_hash &&
        member.password_salt &&
        verifyPassword(
          password,
          member.password_salt,
          member.password_hash,
          Number(member.password_iterations || 210000),
        ),
    );
    if (!member || !valid) {
      if (member) {
        const failures = Number(member.failed_login_count ?? 0) + 1;
        await d1
          .prepare(
            `UPDATE members
             SET failed_login_count = ?,
                 locked_until = CASE
                   WHEN ? >= 5 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
                   ELSE NULL
                 END
             WHERE id = ?`,
          )
          .bind(failures >= 5 ? 0 : failures, failures, Number(member.id))
          .run();
      }
      return Response.json(
        { error: "아이디 또는 비밀번호를 확인해 주세요." },
        { status: 401 },
      );
    }

    await d1
      .prepare(
        `UPDATE members
         SET failed_login_count = 0, locked_until = NULL, last_seen_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(Number(member.id))
      .run();
    await createLocalSession(Number(member.id));
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
