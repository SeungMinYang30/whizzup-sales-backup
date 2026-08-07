"use client";

import { useState } from "react";

export default function LocalLoginForm({ returnTo }: { returnTo: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const endpoint = mode === "login" ? "/api/local-auth/login" : "/api/local-auth/signup";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, username, password }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했습니다.");
      if (mode === "signup") {
        setMessage(payload.message || "가입 신청이 접수되었습니다.");
        setMode("login");
        setPassword("");
      } else {
        window.location.assign(returnTo);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "요청을 처리하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="local-auth-tabs" role="tablist" aria-label="로그인 방식">
        <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>로그인</button>
        <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>가입 신청</button>
      </div>
      <form className="local-auth-form" onSubmit={submit}>
        {mode === "signup" ? (
          <label><span>이름</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} autoComplete="name" required /></label>
        ) : null}
        <label><span>{mode === "login" ? "아이디 또는 운영자 이메일" : "아이디"}</span><input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} minLength={4} maxLength={30} autoCapitalize="none" autoComplete="username" required /></label>
        <label><span>비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
        {mode === "signup" ? <small>아이디는 영문 소문자·숫자 4자 이상, 비밀번호는 영문과 숫자를 포함해 8자 이상 입력해 주세요.</small> : null}
        {message ? <p className="local-auth-success">{message}</p> : null}
        {error ? <p className="oauth-error">{error}</p> : null}
        <button className="local-auth-submit" type="submit" disabled={saving}>{saving ? "처리 중…" : mode === "login" ? "로그인" : "가입 신청하기"}</button>
      </form>
    </>
  );
}
