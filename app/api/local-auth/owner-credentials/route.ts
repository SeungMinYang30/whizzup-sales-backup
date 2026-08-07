import { getD1 } from "../../../../db";
import {
  accessErrorResponse,
  requirePrimaryOwner,
} from "../../../../lib/collaboration";
import {
  ensureLocalAuthSchema,
  hashPassword,
  validatePassword,
} from "../../../../lib/local-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const owner = await requirePrimaryOwner();
    const payload = (await request.json()) as { password?: string };
    const password = String(payload.password ?? "");
    if (!validatePassword(password)) {
      return Response.json(
        { error: "비밀번호는 영문과 숫자를 포함해 8자 이상 입력해 주세요." },
        { status: 400 },
      );
    }

    await ensureLocalAuthSchema();
    const credential = hashPassword(password);
    const username = owner.email.trim().toLowerCase();
    const d1 = getD1();
    await d1.batch([
      d1.prepare("DELETE FROM local_auth_sessions WHERE member_id = ?").bind(owner.id),
      d1
        .prepare(
          `UPDATE members
           SET username = ?, password_hash = ?, password_salt = ?,
               password_iterations = ?, failed_login_count = 0, locked_until = NULL
           WHERE id = ? AND role = 'admin' AND status = 'approved'`,
        )
        .bind(
          username,
          credential.hash,
          credential.salt,
          credential.iterations,
          owner.id,
        ),
    ]);
    return Response.json({ ok: true, username });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
