import Link from "next/link";
import { getChatGPTUser, safeRelativeReturnPath } from "../chatgpt-auth";
import { redirect } from "next/navigation";
import LocalLoginForm from "./local-login-form";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const rawReturnTo = Array.isArray(query.return_to)
    ? query.return_to[0] ?? "/"
    : query.return_to ?? "/";
  const returnTo = safeRelativeReturnPath(rawReturnTo);
  const errorMessage = Array.isArray(query.error)
    ? query.error[0] ?? ""
    : query.error ?? "";
  const user = await getChatGPTUser();
  if (user) redirect(returnTo);

  return (
    <main className="oauth-page">
      <section className="oauth-card oauth-message">
        <div className="oauth-brand">
          <span className="oauth-brand-logo" role="img" aria-label="WHIZZUP" />
          <div>
            <strong>WHIZZUP SALES HUB</strong>
            <small>영업 통합 관리</small>
          </div>
        </div>
        <p className="oauth-kicker">SECURE SIGN IN</p>
        <h1>WHIZZUP 로그인</h1>
        <p>
          직원은 사용할 아이디와 비밀번호로 가입을 신청하고, 관리자 승인 후
          같은 정보로 로그인합니다.
        </p>
        {errorMessage ? <p className="oauth-error">{errorMessage}</p> : null}
        <LocalLoginForm returnTo={returnTo} />
        <div className="owner-google-login">
          <span>대표 관리자 비상 로그인</span>
        <Link
          className="google-signin-button"
          href={`/auth/google?return_to=${encodeURIComponent(returnTo)}`}
        >
          Google 계정으로 로그인
        </Link>
        </div>
      </section>
    </main>
  );
}
