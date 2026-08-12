import {
  createDirectSession,
  findMemberByEmail,
  setMemberPassword,
  validatePassword,
} from "../../../../lib/app-auth";
import {
  clearPasswordSetupTicket,
  readPasswordSetupTicket,
} from "../../../../lib/password-setup-ticket";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ticket = await readPasswordSetupTicket();
  if (!ticket) {
    return Response.json(
      { error: "비밀번호 설정 시간이 만료되었습니다. 로그인 화면에서 이메일을 다시 입력해 주세요." },
      { status: 401 },
    );
  }

  const member = await findMemberByEmail(ticket.email);
  if (
    !member ||
    String(member.status) !== "approved" ||
    Number(member.id) !== ticket.memberId
  ) {
    await clearPasswordSetupTicket();
    return Response.json(
      { error: "승인된 직원 계정을 확인하지 못했습니다." },
      { status: 403 },
    );
  }

  const payload = (await request.json()) as {
    password?: string;
    remember?: boolean;
  };
  const password = String(payload.password ?? "");
  const validation = validatePassword(password);
  if (validation) return Response.json({ error: validation }, { status: 400 });

  try {
    await setMemberPassword(Number(member.id), password);
    await createDirectSession(Number(member.id), payload.remember !== false);
    await clearPasswordSetupTicket();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to set member password", error);
    return Response.json(
      { error: "비밀번호를 설정하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}

