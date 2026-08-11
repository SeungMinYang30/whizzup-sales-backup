import {
  createDirectSession,
  findMemberByEmail,
  setMemberPassword,
  verifyMemberPassword,
} from "../../../../lib/app-auth";

export const dynamic = "force-dynamic";
const AUTH_STEP_TIMEOUT_MS = 12_000;

async function verifyAgainstPrimarySite(
  email: string,
  password: string,
  remember: boolean,
) {
  const primaryOrigin = String(process.env.PRIMARY_SITE_ORIGIN ?? "").trim();
  const appOrigin = String(process.env.APP_ORIGIN ?? "").trim();
  if (!primaryOrigin || primaryOrigin === appOrigin) return false;

  const endpoint = new URL("/api/auth/login", primaryOrigin);
  if (endpoint.protocol !== "https:") return false;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ email, password, remember }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(AUTH_STEP_TIMEOUT_MS),
  });
  if (!response.ok) return false;
  const result = (await response.json().catch(() => null)) as { ok?: boolean } | null;
  return result?.ok === true;
}

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
        { error: "이메일 또는 비밀번호를 확인해 주세요." },
        { status: 401 },
      );
    }
    stage = "password_verification";
    const verified = await withAuthTimeout(
      stage,
      verifyMemberPassword(Number(member.id), password),
    );
    if (!verified.ok) {
      if (verified.reason !== "locked") {
        stage = "primary_site_verification";
        const primaryVerified = await withAuthTimeout(
          stage,
          verifyAgainstPrimarySite(
            email,
            password,
            Boolean(payload.remember),
          ),
        );
        if (primaryVerified) {
          stage = "standby_credential_creation";
          await withAuthTimeout(
            stage,
            setMemberPassword(Number(member.id), password),
          );
          stage = "session_creation";
          await withAuthTimeout(
            stage,
            createDirectSession(Number(member.id), Boolean(payload.remember)),
          );
          return Response.json({ ok: true, migrated: true });
        }
      }
      const error =
        verified.reason === "not-set"
          ? "아직 비밀번호가 설정되지 않았습니다. 기존 ChatGPT 로그인으로 접속해 최초 비밀번호를 설정해 주세요."
          : verified.reason === "locked"
            ? "로그인 시도가 많아 잠시 보호 중입니다. 15분 후 다시 시도해 주세요."
            : "이메일 또는 비밀번호를 확인해 주세요.";
      return Response.json(
        {
          error,
          code: verified.reason === "not-set" ? "PASSWORD_NOT_SET" : undefined,
        },
        { status: 401 },
      );
    }
    stage = "session_creation";
    await withAuthTimeout(
      stage,
      createDirectSession(Number(member.id), Boolean(payload.remember)),
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
