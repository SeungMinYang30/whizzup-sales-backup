"use client";

import { useState } from "react";
import {
  buildMemberDisplayName,
  MEMBER_JOB_TITLE_SUGGESTIONS,
} from "../../lib/member-display-name";

type Mode = "login" | "signup" | "reset";
const REQUEST_TIMEOUT_MS = 15_000;

export default function LocalLoginForm({ returnTo }: { returnTo: string }) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [remember, setRemember] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function changeMode(next: Mode) {
    setMode(next);
    setPassword("");
    setPasswordConfirm("");
    setMessage("");
    setError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      if (mode === "signup" && password !== passwordConfirm) {
        throw new Error("비밀번호 확인이 일치하지 않습니다.");
      }
      const endpoint =
        mode === "login"
          ? "/api/local-auth/login"
          : mode === "signup"
            ? "/api/local-auth/signup"
            : "/api/local-auth/reset-request";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ name, jobTitle, email, password, remember }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했습니다.");
      if (mode === "login") {
        window.location.assign(returnTo);
        return;
      }
      setMessage(payload.message || "요청이 등록되었습니다.");
      if (mode === "signup") {
        setPassword("");
        setPasswordConfirm("");
      }
    } catch (caught) {
      const aborted = caught instanceof Error && caught.name === "AbortError";
      setError(
        aborted
          ? "로그인 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
          : caught instanceof Error
            ? caught.message
            : "요청을 처리하지 못했습니다.",
      );
    } finally {
      window.clearTimeout(timeoutId);
      setSaving(false);
    }
  }

  return (
    <>
      <div className="local-auth-tabs" role="tablist" aria-label="로그인 방식">
        <button type="button" className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>로그인</button>
        <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => changeMode("signup")}>신규 가입</button>
        <button type="button" className={mode === "reset" ? "active" : ""} onClick={() => changeMode("reset")}>비밀번호 재설정</button>
      </div>
      <form className="local-auth-form" onSubmit={submit}>
        {mode === "signup" ? (
          <>
            <label><span>이름</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} autoComplete="name" placeholder="예: 양승민" required /></label>
            <label>
              <span>직책</span>
              <input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} list="member-job-title-suggestions" maxLength={20} placeholder="예: 이사, 대표" required />
              <datalist id="member-job-title-suggestions">
                {MEMBER_JOB_TITLE_SUGGESTIONS.map((title) => <option key={title} value={title} />)}
              </datalist>
            </label>
            {name.trim() && jobTitle.trim() ? <small className="local-auth-display-preview">표시 이름: {buildMemberDisplayName(name, jobTitle)}</small> : null}
          </>
        ) : null}
        <label><span>이메일</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value.toLowerCase())} maxLength={320} autoCapitalize="none" autoComplete="email" required /></label>
        {mode !== "reset" ? <label><span>비밀번호</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label> : null}
        {mode === "signup" ? <label><span>비밀번호 확인</span><input type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" required /></label> : null}
        {mode === "login" ? <label className="direct-login-remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>자동 로그인</span></label> : null}
        {mode === "signup" ? <small>현재 Sites의 ChatGPT 로그인에 사용한 Google 이메일을 그대로 입력해 주세요. 비밀번호는 영문과 숫자를 포함해 8자 이상 입력합니다.</small> : null}
        {mode === "reset" ? <small>등록된 이메일로 운영자에게 비밀번호 재설정 요청을 보냅니다.</small> : null}
        {message ? <p className="local-auth-success" role="status">{message}</p> : null}
        {error ? <p className="oauth-error" role="alert">{error}</p> : null}
        <button className="local-auth-submit" type="submit" disabled={saving}>{saving ? "처리 중…" : mode === "login" ? "로그인" : mode === "signup" ? "가입 요청" : "재설정 요청"}</button>
      </form>
    </>
  );
}
