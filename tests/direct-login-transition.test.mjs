import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("approved employee email can establish a new direct-login password", async () => {
  const [page, loginPageRoute, login, setup, passwordSetupPage, loginRoute, setPasswordRoute, ticket, appAuth] =
    await Promise.all([
      readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/login-page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/initial-password-setup.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/password-setup/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/auth/set-password/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/password-setup-ticket.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/app-auth.ts", import.meta.url), "utf8"),
    ]);

  assert.match(login, /src="\/whizzup-logo\.png"/);
  assert.match(login, /useEffect\(\(\) => \{[\s\S]*setClientReady\(true\)/);
  assert.match(login, /disabled=\{busy \|\| !clientReady\}/);
  assert.match(login, /로그인 준비 중/);
  assert.match(login, /payload\.code === "PASSWORD_SETUP_REQUIRED"/);
  assert.match(login, /window\.location\.assign\("\/password-setup"\)/);
  assert.doesNotMatch(login, /signin-with-chatgpt/);
  assert.doesNotMatch(login, /ChatGPT로 비밀번호 설정/);
  assert.match(login, /신규 가입/);
  assert.match(login, /비밀번호 재설정/);
  assert.match(loginPageRoute, /<DirectLoginPage \/>/);
  assert.doesNotMatch(loginPageRoute, /Google 계정으로 로그인/);
  assert.doesNotMatch(loginPageRoute, /LocalLoginForm/);

  assert.match(loginRoute, /createPasswordSetupTicket/);
  assert.match(loginRoute, /code: "PASSWORD_SETUP_REQUIRED"/);
  assert.match(loginRoute, /verified\.reason === "not-set"/);
  assert.match(loginRoute, /비밀번호가 일치하지 않습니다/);
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

test("standby owner permission refresh uses the active database JSON syntax", async () => {
  const collaboration = await readFile(
    new URL("../lib/collaboration.ts", import.meta.url),
    "utf8",
  );

  assert.match(collaboration, /isPostgresDatabase\(\)/);
  assert.match(collaboration, /jsonb_build_array/);
  assert.match(collaboration, /json_array\(\$\{permissions\.map/);
});

test("Sites session check skips PostgreSQL-only auth schema setup", async () => {
  const sessionRoute = await readFile(
    new URL("../app/api/session/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(sessionRoute, /if \(isPostgresDatabase\(\)\)/);
  assert.match(sessionRoute, /await ensureLocalAuthSchema\(\)/);
});

