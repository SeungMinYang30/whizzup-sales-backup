import { getD1 } from "../../../../db";
import {
  createLocalSession,
  ensureLocalAuthSchema,
  normalizeUsername,
  verifyPassword,
} from "../../../../lib/local-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      email?: string;
      username?: string;
      password?: string;
      remember?: boolean;
    };
    const email = normalizeUsername(payload.email ?? payload.username);
    const password = String(payload.password ?? "");
    await ensureLocalAuthSchema();
    const d1 = getD1();
    const member = await d1
      .prepare(
        `SELECT
           m.id, m.status,
           c.password_hash, c.password_salt, c.password_iterations,
           c.failed_attempts, c.locked_until
         FROM members m
         LEFT JOIN member_credentials c ON c.member_id = m.id
         WHERE lower(m.email) = lower(?)
            OR (m.username IS NOT NULL AND lower(m.username) = lower(?))
         LIMIT 1`,
      )
      .bind(email, email)
      .first<{
        id: number;
        status: string;
        password_hash: string | null;
        password_salt: string | null;
        password_iterations: number;
        failed_attempts: number;
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

    if (!member || member.status !== "approved") {
      return Response.json(
        { error: "이메일 또는 비밀번호를 확인해 주세요." },
        { status: 401 },
      );
    }
    if (!member.password_hash || !member.password_salt) {
      return Response.json(
        {
          error:
            "아직 비밀번호가 설정되지 않았습니다. 기존 Sites의 ChatGPT 로그인으로 접속해 먼저 비밀번호를 설정해 주세요.",
        },
        { status: 401 },
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
    if (!valid) {
      const failures = Number(member.failed_attempts ?? 0) + 1;
      await d1
        .prepare(
          `UPDATE member_credentials
           SET failed_attempts = ?,
               locked_until = CASE
                 WHEN ? >= 5 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
                 ELSE NULL
               END,
               updated_at = CURRENT_TIMESTAMP
           WHERE member_id = ?`,
        )
        .bind(failures, failures, Number(member.id))
        .run();
      return Response.json(
        {
          error:
            failures >= 5
              ? "로그인 시도가 많아 잠시 보호 중입니다. 15분 후 다시 시도해 주세요."
              : "이메일 또는 비밀번호를 확인해 주세요.",
        },
        { status: 401 },
      );
    }

    await d1.batch([
      d1
        .prepare(
          `UPDATE member_credentials
           SET failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE member_id = ?`,
        )
        .bind(Number(member.id)),
      d1
        .prepare("UPDATE members SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(Number(member.id)),
    ]);
    await createLocalSession(Number(member.id), payload.remember !== false);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
