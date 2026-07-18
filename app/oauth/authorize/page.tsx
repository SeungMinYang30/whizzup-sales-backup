import Link from "next/link";
import { requireChatGPTUser } from "../../chatgpt-auth";
import {
  ensureCollaborationReady,
  getOrCreateMember,
  isAllowedChatGPTRedirect,
  isAllowedOAuthScope,
  OAUTH_ACTIVITY_SCOPE,
} from "../../../lib/collaboration";
import { OAuthConsent } from "./OAuthConsent";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const encoded = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    const selected = first(value);
    if (selected) encoded.set(key, selected);
  });
  const returnTo = `/oauth/authorize?${encoded.toString()}`;
  const identity = await requireChatGPTUser(returnTo);
  const member = await getOrCreateMember(identity);

  if (member.status !== "approved") {
    return (
      <div className="oauth-page">
        <section className="oauth-card oauth-message">
          <div className="oauth-brand">
            <span className="oauth-brand-logo" role="img" aria-label="WHIZZUP" />
            <strong>WHIZZUP SALES HUB</strong>
          </div>
          <h1>관리자 승인 대기 중</h1>
          <p>
            사이트 관리자가 {member.email} 계정을 승인하면 GPT 연결을 계속할 수
            있습니다.
          </p>
          <Link href="/">관리사이트로 돌아가기</Link>
        </section>
      </div>
    );
  }

  const clientId = first(query.client_id);
  const redirectUri = first(query.redirect_uri);
  const responseType = first(query.response_type);
  const state = first(query.state);
  const scope = first(query.scope).trim() || OAUTH_ACTIVITY_SCOPE;
  const codeChallenge = first(query.code_challenge);
  const d1 = await ensureCollaborationReady();
  const client = await d1
    .prepare("SELECT name FROM oauth_clients WHERE client_id = ?")
    .bind(clientId)
    .first<{ name: string }>();

  if (
    !client ||
    responseType !== "code" ||
    !isAllowedChatGPTRedirect(redirectUri) ||
    !isAllowedOAuthScope(scope)
  ) {
    return (
      <div className="oauth-page">
        <section className="oauth-card oauth-message">
          <div className="oauth-brand">
            <span className="oauth-brand-logo" role="img" aria-label="WHIZZUP" />
            <strong>WHIZZUP SALES HUB</strong>
          </div>
          <h1>연결 요청을 확인할 수 없습니다</h1>
          <p>GPT 설정의 OAuth 주소와 Client ID를 다시 확인해 주세요.</p>
          <Link href="/">관리사이트로 돌아가기</Link>
        </section>
      </div>
    );
  }

  return (
    <OAuthConsent
      clientId={clientId}
      clientName={client.name}
      redirectUri={redirectUri}
      responseType={responseType}
      state={state}
      scope={scope}
      codeChallenge={codeChallenge}
      userName={member.displayName}
      userEmail={member.email}
    />
  );
}
