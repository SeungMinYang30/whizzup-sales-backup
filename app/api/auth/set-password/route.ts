import { getChatGPTUser } from "../../../chatgpt-auth";
import {
  createDirectSession,
  findMemberByEmail,
  setMemberPassword,
  validatePassword,
} from "../../../../lib/app-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const chatgpt = await getChatGPTUser();
  if (!chatgpt) {
    return Response.json(
      { error: "최초 비밀번호 설정은 기존 ChatGPT 로그인 상태에서 진행해 주세요." },
      { status: 401 },
    );
  }
  const member = await findMemberByEmail(chatgpt.email);
  if (!member || String(member.status) !== "approved") {
    return Response.json({ error: "승인된 구성원 계정을 찾지 못했습니다." }, { status: 403 });
  }
  const payload = (await request.json()) as {
    password?: string;
    remember?: boolean;
  };
  const password = String(payload.password ?? "");
  const validation = validatePassword(password);
  if (validation) return Response.json({ error: validation }, { status: 400 });
  try {
    // The ChatGPT identity header is the re-authentication proof. The member
    // email always comes from that trusted header, never from the request body.
    await setMemberPassword(Number(member.id), password);
    await createDirectSession(Number(member.id), payload.remember !== false);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to set member password", error);
    return Response.json(
      { error: "비밀번호를 설정하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
