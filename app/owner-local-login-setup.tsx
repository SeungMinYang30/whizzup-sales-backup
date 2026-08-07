"use client";

import { useState } from "react";

export default function OwnerLocalLoginSetup({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(() => email.split("@")[0]?.toLowerCase() || "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setMessage("");
    setError("");
    if (password !== confirmation) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/local-auth/owner-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json()) as { error?: string; username?: string };
      if (!response.ok) throw new Error(payload.error || "운영자 로그인을 설정하지 못했습니다.");
      setPassword("");
      setConfirmation("");
      setMessage(`${payload.username || username} 아이디 로그인을 설정했습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "운영자 로그인을 설정하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="owner-local-login-setup">
      <div>
        <strong>운영자 아이디 로그인</strong>
        <span>현재 운영자 계정에 비밀번호 로그인을 연결합니다. Google 로그인도 계속 사용할 수 있습니다.</span>
      </div>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}>로그인 설정</button>
      ) : (
        <form onSubmit={submit}>
          <label><span>로그인 아이디</span><input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} minLength={4} maxLength={30} autoComplete="username" required /></label>
          <label><span>새 비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required /></label>
          <label><span>비밀번호 확인</span><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required /></label>
          {message ? <p className="local-auth-success">{message}</p> : null}
          {error ? <p className="oauth-error">{error}</p> : null}
          <div><button type="button" onClick={() => setOpen(false)}>취소</button><button type="submit" disabled={saving}>{saving ? "설정 중…" : "비밀번호 로그인 설정"}</button></div>
        </form>
      )}
    </div>
  );
}
