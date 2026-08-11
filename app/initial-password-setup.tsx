"use client";

import { FormEvent, useState } from "react";

const REQUEST_TIMEOUT_MS = 15_000;

export default function InitialPasswordSetup({
  email,
  mode = "initial",
}: {
  email: string;
  mode?: "initial" | "reset";
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setBusy(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ password, remember: true }),
      });
      const responseText = await response.text();
      let payload: { error?: string } = {};
      if (responseText) {
        try {
          payload = JSON.parse(responseText) as { error?: string };
        } catch {
          payload = {};
        }
      }
      if (!response.ok) throw new Error(payload.error || "비밀번호를 설정하지 못했습니다.");
      window.location.assign("/");
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === "AbortError";
      setError(
        aborted
          ? "로그인 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
          : caught instanceof Error
            ? caught.message
            : "비밀번호를 설정하지 못했습니다.",
      );
    } finally {
      window.clearTimeout(timeoutId);
      setBusy(false);
    }
  }

  return (
    <div className="initial-password-overlay" role="dialog" aria-modal="true" aria-labelledby="initial-password-title">
      <section className="initial-password-card">
        <div className="direct-login-brand initial-password-brand">
          <img
            className="direct-login-logo"
            src="/whizzup-logo.png"
            alt="WHIZZUP SALES HUB"
            width={126}
            height={83}
            loading="eager"
            decoding="async"
          />
        </div>
        <h2 id="initial-password-title">
          {mode === "reset" ? "로그인 비밀번호 다시 설정" : "최초 로그인 비밀번호 설정"}
        </h2>
        <p>
          ChatGPT 계정 확인이 완료되었습니다. 새 비밀번호를 저장하면 다음부터 이메일과 비밀번호로 로그인할 수 있습니다.
        </p>
        <form onSubmit={submit}>
          <label>
            <span>이메일</span>
            <input value={email} readOnly />
          </label>
          <label>
            <span>새 비밀번호</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required autoFocus />
          </label>
          <label>
            <span>비밀번호 확인</span>
            <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required />
          </label>
          {error && <p className="direct-login-error" role="alert">{error}</p>}
          <div className="initial-password-actions">
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "저장 중" : mode === "reset" ? "새 비밀번호 저장" : "비밀번호 설정"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
