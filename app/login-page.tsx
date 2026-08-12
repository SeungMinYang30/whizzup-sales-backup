"use client";

import { FormEvent, useState } from "react";

type Mode = "login" | "signup" | "reset";
const REQUEST_TIMEOUT_MS = 15_000;
const CHATGPT_PASSWORD_SETUP_URL =
  "/auth/google?return_to=%2Fpassword-setup";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function changeMode(next: Mode) {
    setMode(next);
    setPassword("");
    setPasswordConfirm("");
    setMessage("");
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
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
          ? "/api/auth/login"
          : mode === "signup"
            ? "/api/auth/signup"
            : "/api/auth/reset-request";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          email,
          password,
          displayName,
          jobTitle,
          remember,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        code?: string;
      };
      if (!response.ok) {
        if (mode === "login" && payload.code === "PASSWORD_NOT_SET") {
          setMessage("ChatGPT 계정을 확인하고 있습니다.");
          window.location.assign(CHATGPT_PASSWORD_SETUP_URL);
          return;
        }
        throw new Error(payload.error || "요청을 처리하지 못했습니다.");
      }
      if (mode === "login") {
        window.location.assign("/");
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
      setBusy(false);
    }
  }

  return (
    <main className="direct-login-page">
      <section className="direct-login-card">
        <div className="direct-login-brand">
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
        <div className="direct-login-heading">
          <h1>
            {mode === "login"
              ? "로그인"
              : mode === "signup"
                ? "신규 가입"
                : "비밀번호 재설정"}
          </h1>
          {mode === "signup" && <p>가입 후 관리자 승인이 완료되면 사용할 수 있습니다.</p>}
          {mode === "reset" && <p>등록된 이메일로 관리자에게 재설정 요청을 보냅니다.</p>}
        </div>
        <form onSubmit={submit} className="direct-login-form">
          {mode === "signup" && (
            <div className="direct-login-pair">
              <label>
                <span>이름</span>
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required />
              </label>
              <label>
                <span>직책</span>
                <input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="예: 이사, 대표" required />
              </label>
            </div>
          )}
          <label>
            <span>이메일</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              autoFocus
            />
          </label>
          {mode !== "reset" && (
            <label>
              <span>비밀번호</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
            </label>
          )}
          {mode === "signup" && (
            <label>
              <span>비밀번호 확인</span>
              <input type="password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} autoComplete="new-password" required />
            </label>
          )}
          {mode === "login" && (
            <label className="direct-login-remember">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span>자동 로그인</span>
            </label>
          )}
          {error && <p className="direct-login-error" role="alert">{error}</p>}
          {mode === "login" && (
            <div className="direct-login-password-setup">
              <p>최초 비밀번호가 없거나 다시 설정하려면 기존 ChatGPT 계정을 확인해 주세요.</p>
              <a href={CHATGPT_PASSWORD_SETUP_URL}>
                ChatGPT로 비밀번호 설정·재설정
              </a>
            </div>
          )}
          {message && <p className="direct-login-message" role="status">{message}</p>}
          <button className="direct-login-submit" type="submit" disabled={busy}>
            {busy ? "처리 중" : mode === "login" ? "로그인" : mode === "signup" ? "가입 요청" : "재설정 요청"}
          </button>
        </form>
        <div className="direct-login-links">
          {mode !== "login" && <button type="button" onClick={() => changeMode("login")}>로그인</button>}
          {mode !== "signup" && <button type="button" onClick={() => changeMode("signup")}>신규 가입</button>}
          {mode !== "reset" && <button type="button" onClick={() => changeMode("reset")}>비밀번호 재설정</button>}
        </div>
      </section>
    </main>
  );
}
