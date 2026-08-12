import {
  createDirectSession,
  findMemberByEmail,
  verifyMemberPassword,
} from "../../../../lib/app-auth";
import { createPasswordSetupTicket } from "../../../../lib/password-setup-ticket";

export const dynamic = "force-dynamic";
const AUTH_STEP_TIMEOUT_MS = 12_000;

class AuthStepTimeoutError extends Error {
  constructor(readonly stage: string) {
    super("Authentication step timed out");
    this.name = "AuthStepTimeoutError";
  }
}

async function withAuthTimeout<T>(stage: string, work: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new AuthStepTimeoutError(stage)),
          AUTH_STEP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function POST(request: Request) {
  let stage = "request";
  try {
    const payload = (await request.json()) as {
      email?: string;
      password?: string;
      remember?: boolean;
    };
    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    stage = "member_lookup";
    const member = await withAuthTimeout(stage, findMemberByEmail(email));
    if (!member || String(member.status) !== "approved") {
      return Response.json(
        { error: "등록되었거나 승인된 직원 이메일인지 확인해 주세요." },
        { status: 401 },
      );
    }

    stage = "password_verification";
    const verified = await withAuthTimeout(
      stage,
      verifyMemberPassword(Number(member.id), password),
    );
    if (!verified.ok) {
      stage = "password_setup_ticket";
      await withAuthTimeout(
        stage,
        createPasswordSetupTicket(Number(member.id), email),
      );
      return Response.json(
        {
          ok: false,
          code: "PASSWORD_SETUP_REQUIRED",
          message: "새 로그인 비밀번호를 설정해 주세요.",
        },
        { status: 409 },
      );
    }

    stage = "session_creation";
    await withAuthTimeout(
      stage,
      createDirectSession(Number(member.id), payload.remember !== false),
    );
    return Response.json({ ok: true });
  } catch (error) {
    const timedOut = error instanceof AuthStepTimeoutError;
    console.error("Direct login failed", {
      stage: timedOut ? error.stage : stage,
      error: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      {
        error: timedOut
          ? "로그인 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
          : "로그인을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      },
      {
        status: timedOut ? 503 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

