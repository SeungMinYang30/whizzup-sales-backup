import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("approved employee email can establish a new direct-login password", async () => {
  const [page, login, setup, passwordSetupPage, loginRoute, setPasswordRoute, ticket, appAuth] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/login-page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/initial-password-setup.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/password-setup/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/auth/set-password/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/password-setup-ticket.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/app-auth.ts", import.meta.url), "utf8"),
    ]);

  assert.match(login, /src="\/whizzup-logo\.png"/);
  assert.match(login, /payload\.code === "PASSWORD_SETUP_REQUIRED"/);
  assert.match(login, /window\.location\.assign\("\/password-setup"\)/);
  assert.doesNotMatch(login, /signin-with-chatgpt/);
  assert.doesNotMatch(login, /ChatGPT로 비밀번호 설정/);
  assert.match(login, /신규 가입/);
  assert.match(login, /비밀번호 재설정/);

  assert.match(loginRoute, /createPasswordSetupTicket/);
  assert.match(loginRoute, /code: "PASSWORD_SETUP_REQUIRED"/);
  assert.match(loginRoute, /String\(member\.status\) !== "approved"/);
  assert.doesNotMatch(loginRoute, /verifyAgainstPrimarySite/);

  assert.match(ticket, /whizzup_password_setup/);
  assert.match(ticket, /HMAC/);
  assert.match(ticket, /PASSWORD_SETUP_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(ticket, /httpOnly: true/);

  assert.match(passwordSetupPage, /readPasswordSetupTicket/);
  assert.doesNotMatch(passwordSetupPage, /requireChatGPTUser/);
  assert.match(passwordSetupPage, /mode=\{hasPassword \? "reset" : "initial"\}/);
  assert.match(setPasswordRoute, /readPasswordSetupTicket/);
  assert.match(setPasswordRoute, /Number\(member\.id\) !== ticket\.memberId/);
  assert.match(setPasswordRoute, /createDirectSession/);
  assert.match(setPasswordRoute, /clearPasswordSetupTicket/);

  assert.match(setup, /새 로그인 비밀번호 등록/);
  assert.match(setup, /window\.location\.assign\("\/"\)/);
  assert.doesNotMatch(setup, /ChatGPT 계정 확인/);
  assert.match(page, /if \(identity\.source === "chatgpt"\)[\s\S]*return <LoginPage \/>/);
  assert.doesNotMatch(page, /memberHasPassword/);

  assert.match(appAuth, /directAuthReadyPromise/);
  assert.match(appAuth, /CREATE TABLE IF NOT EXISTS member_credentials/);
  assert.match(appAuth, /CREATE TABLE IF NOT EXISTS member_sessions/);
});

