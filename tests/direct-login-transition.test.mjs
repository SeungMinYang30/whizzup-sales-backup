import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("direct login transition keeps protected screens behind authentication", async () => {
  const [
    page,
    login,
    setup,
    passwordSetupPage,
    loginRoute,
    setPasswordRoute,
    appAuth,
    authMigration,
    repairMigration,
    migrationJournal,
    crm,
    styles,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/initial-password-setup.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/password-setup/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/set-password/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/app-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0079_direct_member_auth.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0082_repair_direct_auth_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
    readFile(new URL("../app/crm-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(login, /src="\/whizzup-logo\.png"/);
  assert.doesNotMatch(login, /next\/image/);
  assert.match(login, /AbortController/);
  assert.match(login, /REQUEST_TIMEOUT_MS = 15_000/);
  assert.match(login, /payload\.code === "PASSWORD_NOT_SET"/);
  assert.match(login, /window\.location\.assign\(CHATGPT_PASSWORD_SETUP_URL\)/);
  assert.match(login, /\/auth\/google\?return_to=%2Fpassword-setup/);
  assert.match(login, /기존에 사용하던 Google 이메일 계정으로 본인 확인/);
  assert.match(login, /Google 계정으로 비밀번호 설정·재설정/);

  assert.match(setup, /src="\/whizzup-logo\.png"/);
  assert.doesNotMatch(setup, /next\/image/);
  assert.match(setup, /AbortController/);
  assert.doesNotMatch(setup, />나중에</);
  assert.match(setup, /window\.location\.assign\("\/"\)/);

  assert.match(passwordSetupPage, /requireChatGPTUser\("\/password-setup"\)/);
  assert.match(passwordSetupPage, /memberHasPassword/);
  assert.match(passwordSetupPage, /mode=\{hasPassword \? "reset" : "initial"\}/);
  assert.doesNotMatch(setPasswordRoute, /currentPassword/);
  assert.match(setPasswordRoute, /trusted header/);

  assert.match(loginRoute, /withAuthTimeout/);
  assert.match(loginRoute, /stage = "member_lookup"/);
  assert.match(loginRoute, /code: verified\.reason === "not-set" \? "PASSWORD_NOT_SET"/);
  assert.match(appAuth, /directAuthReadyPromise/);
  assert.match(appAuth, /SELECT name FROM sqlite_master/);
  assert.match(appAuth, /CREATE TABLE IF NOT EXISTS member_credentials/);
  assert.match(appAuth, /CREATE TABLE IF NOT EXISTS member_sessions/);
  assert.match(appAuth, /Ignoring unusable direct session/);
  assert.doesNotMatch(appAuth, /PRAGMA table_info\(members\)/);
  assert.match(authMigration, /CREATE TABLE IF NOT EXISTS member_credentials/);
  assert.match(repairMigration, /CREATE TABLE IF NOT EXISTS `member_credentials`/);
  assert.match(repairMigration, /CREATE TABLE IF NOT EXISTS `member_sessions`/);
  assert.match(repairMigration, /CREATE TABLE IF NOT EXISTS `member_password_reset_requests`/);
  assert.match(repairMigration, /CREATE TABLE IF NOT EXISTS `member_rejections`/);
  assert.match(migrationJournal, /0082_repair_direct_auth_schema/);

  assert.match(
    page,
    /if \(identity\.source === "chatgpt"\)[\s\S]*return <InitialPasswordSetup email=\{member\.email\} \/>[\s\S]*return <LoginPage \/>/,
  );
  assert.match(page, /Authentication bootstrap failed/);
  assert.match(page, /catch \(error\)[\s\S]*return <LoginPage \/>/);
  assert.doesNotMatch(crm, /이메일로 구성원 바로 등록/);
  assert.match(crm, /이메일 가입/);

  assert.match(styles, /\.initial-password-overlay\s*\{[\s\S]*background:[\s\S]*#f3f6fb/);
  assert.match(styles, /\.direct-login-password-setup\s*\{/);
});
