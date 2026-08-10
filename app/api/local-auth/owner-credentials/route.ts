import { getD1 } from "../../../../db";
import {
  accessErrorResponse,
  requirePrimaryOwner,
} from "../../../../lib/collaboration";
import {
  ensureLocalAuthSchema,
  normalizeUsername,
  setMemberPassword,
  validatePassword,
  validateUsername,
} from "../../../../lib/local-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const owner = await requirePrimaryOwner();
    const payload = (await request.json()) as { username?: string; password?: string };
    const username = normalizeUsername(payload.username || owner.email.split("@")[0]);
    const password = String(payload.password ?? "");
    if (!validateUsername(username)) {
      return Response.json(
        { error: "아이디는 영문 소문자·숫자와 . _ - 기호를 사용해 4~30자로 입력해 주세요." },
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
    const duplicate = await d1.prepare(
      "SELECT id FROM members WHERE lower(username) = lower(?) AND id <> ? LIMIT 1",
    ).bind(username, owner.id).first<{ id: number }>();
    if (duplicate) {
      return Response.json({ error: "이미 사용 중인 아이디입니다." }, { status: 409 });
    }
    await d1
      .prepare(
        `UPDATE members SET username = ?
         WHERE id = ? AND role = 'admin' AND status = 'approved'`,
      )
      .bind(username, owner.id)
      .run();
    await setMemberPassword(owner.id, password);
    return Response.json({ ok: true, username });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
