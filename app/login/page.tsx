import Link from "next/link";
import { getChatGPTUser, safeRelativeReturnPath } from "../chatgpt-auth";
import { redirect } from "next/navigation";

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
            <small>독립 운영 사이트</small>
          </div>
        </div>
        <p className="oauth-kicker">SECURE SIGN IN</p>
        <h1>Google 계정으로 로그인</h1>
        <p>
          회사 구성원 확인과 기록 작성자 표시를 위해 Google 계정으로
          로그인합니다. 처음 접속한 구성원은 관리자 승인 후 사용할 수 있습니다.
        </p>
        {errorMessage ? <p className="oauth-error">{errorMessage}</p> : null}
        <Link
          className="google-signin-button"
          href={`/auth/google?return_to=${encodeURIComponent(returnTo)}`}
        >
          Google로 계속하기
        </Link>
        <p className="oauth-footnote">
          사이트 로그인 정보와 영업 데이터는 별도로 관리됩니다.
        </p>
      </section>
    </main>
  );
}
