"use client";

import { useState } from "react";

type Props = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  responseType: string;
  state: string;
  scope: string;
  codeChallenge: string;
  userName: string;
  userEmail: string;
};

export function OAuthConsent(props: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function deny() {
    const target = new URL(props.redirectUri);
    target.searchParams.set("error", "access_denied");
    if (props.state) target.searchParams.set("state", props.state);
    window.location.assign(target.toString());
  }

  async function approve() {
    try {
      setLoading(true);
      setError("");
      const response = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: props.clientId,
          redirectUri: props.redirectUri,
          responseType: props.responseType,
          state: props.state,
          scope: props.scope,
          codeChallenge: props.codeChallenge,
        }),
      });
      const payload = (await response.json()) as {
        redirectTo?: string;
        error?: string;
      };
      if (!response.ok || !payload.redirectTo) {
        throw new Error(payload.error || "연결을 승인하지 못했습니다.");
      }
      window.location.assign(payload.redirectTo);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "연결을 승인하지 못했습니다.",
      );
      setLoading(false);
    }
  }

  return (
    <div className="oauth-page">
      <section className="oauth-card">
        <div className="oauth-brand">
          <span className="oauth-brand-logo" role="img" aria-label="WHIZZUP" />
          <div>
            <strong>WHIZZUP SALES HUB</strong>
            <small>안전한 계정 연결</small>
          </div>
        </div>
        <p className="oauth-kicker">GPT CONNECTION</p>
        <h1>{props.clientName} 연결</h1>
        <p className="oauth-copy">
          공유 GPT가 본인 이름으로 통화·미팅 기록을 공동 관리표에 저장하도록
          허용합니다.
        </p>
        <div className="oauth-user">
          <span>{props.userName.slice(0, 1)}</span>
          <div>
            <strong>{props.userName}</strong>
            <small>{props.userEmail}</small>
          </div>
        </div>
        <div className="oauth-permission">
          <b>허용되는 작업</b>
          <p>✓ 사용자가 확인한 통화·미팅 기록 저장</p>
          <p>✓ 기록 작성자 이름 표시</p>
          <p>× 기존 기록 삭제 또는 사용자 관리</p>
        </div>
        {error && <p className="oauth-error">{error}</p>}
        <div className="oauth-actions">
          <button type="button" onClick={deny} disabled={loading}>
            취소
          </button>
          <button
            type="button"
            className="oauth-approve"
            onClick={() => void approve()}
            disabled={loading}
          >
            {loading ? "연결 중…" : "연결 허용"}
          </button>
        </div>
        <p className="oauth-footnote">
          연결은 언제든 관리자가 초기화할 수 있습니다.
        </p>
      </section>
    </div>
  );
}
