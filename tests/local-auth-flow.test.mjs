import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildMemberDisplayName,
  normalizeMemberJobTitle,
} from "../lib/member-display-name.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("직원은 Sites에서 쓰던 이메일과 비밀번호로 가입하고 로그인한다", async () => {
  const [signup, loginPage, loginForm, resetRequest] = await Promise.all([
    read("app/api/local-auth/signup/route.ts"),
    read("app/login/page.tsx"),
    read("app/login/local-login-form.tsx"),
    read("app/api/local-auth/reset-request/route.ts"),
  ]);
  assert.match(signup, /email, display_name, job_title/);
  assert.match(signup, /'pending'/);
  assert.match(signup, /lower\(email\) = lower\(\?\)/);
  assert.match(signup, /setMemberPassword/);
  assert.match(loginPage, /Google 이메일과 설정한/);
  assert.match(loginForm, /<span>직책<\/span>/);
  assert.match(loginForm, /<span>이메일<\/span>/);
  assert.match(loginForm, /member-job-title-suggestions/);
  assert.match(loginForm, /비밀번호 재설정/);
  assert.match(resetRequest, /member_password_reset_requests/);
});

test("직책 대표는 대표님으로 표시하고 다른 직책은 그대로 유지한다", () => {
  assert.equal(normalizeMemberJobTitle("대표"), "대표님");
  assert.equal(normalizeMemberJobTitle("대표님"), "대표님");
  assert.equal(buildMemberDisplayName("박원석", "대표"), "박원석 대표님");
  assert.equal(buildMemberDisplayName("양승민", "이사"), "양승민 이사");
});

test("비밀번호는 강한 해시와 로그인 잠금으로 보호한다", async () => {
  const [auth, login] = await Promise.all([
    read("lib/local-auth.ts"),
    read("app/api/local-auth/login/route.ts"),
  ]);
  assert.match(auth, /100_000/);
  assert.match(auth, /pbkdf2Sync/);
  assert.match(auth, /Buffer\.from\(salt, "utf8"\)/);
  assert.match(auth, /INSERT INTO member_credentials/);
  assert.match(auth, /httpOnly: true/);
  assert.match(login, /LEFT JOIN member_credentials/);
  assert.match(login, /INTERVAL '15 minutes'/);
  assert.match(login, /failures >= 5/);
});

test("운영자는 현재 승인된 계정에 별도 아이디 로그인을 안전하게 연결한다", async () => {
  const [ownerRoute, ownerSetup] = await Promise.all([
    read("app/api/local-auth/owner-credentials/route.ts"),
    read("app/owner-local-login-setup.tsx"),
  ]);
  assert.match(ownerRoute, /requirePrimaryOwner/);
  assert.match(ownerRoute, /normalizeUsername\(payload\.username \|\| owner\.email\.split\("@"\)\[0\]\)/);
  assert.match(ownerRoute, /SELECT id FROM members WHERE lower\(username\) = lower\(\?\) AND id <> \?/);
  assert.match(ownerRoute, /WHERE id = \? AND role = 'admin' AND status = 'approved'/);
  assert.match(ownerRoute, /setMemberPassword\(owner\.id, password\)/);
  assert.match(ownerSetup, /Google 로그인도 계속 사용할 수 있습니다/);
  assert.match(ownerSetup, /\/api\/local-auth\/owner-credentials/);
});

test("운영관리자 외 계정은 원본 보관 후 연결 이력을 보존하며 정리한다", async () => {
  const cleanup = await read("app/api/members/cleanup/route.ts");
  assert.match(cleanup, /freeyang30@gmail\.com/);
  assert.match(cleanup, /member_account_archives/);
  assert.match(cleanup, /activity_authors SET member_id = NULL/);
  assert.match(cleanup, /DELETE FROM members WHERE id = ANY/);
  assert.match(cleanup, /DO \$cleanup\$/);
  assert.match(cleanup, /ordered server-side block/);
  assert.match(cleanup, /to_jsonb\(m\) - 'password_hash'/);
  assert.doesNotMatch(cleanup, /for \(const id of targetIds\)/);
  assert.doesNotMatch(cleanup, /tx\.batch/);
  assert.ok(
    cleanup.indexOf("UPDATE activity_assignment_history SET to_member_id") <
      cleanup.indexOf("DELETE FROM members WHERE id = ANY"),
  );
  assert.match(cleanup, /requirePrimaryOwner/);
});

test("운영관리자는 사용 중 계정도 기록을 보존하며 바로 삭제할 수 있다", async () => {
  const [members, app] = await Promise.all([
    read("app/api/members/route.ts"),
    read("app/crm-app.tsx"),
  ]);
  assert.doesNotMatch(members, /사용 중인 계정은 먼저 사용 중지한 뒤 삭제/);
  assert.match(members, /member_account_archives/);
  assert.match(members, /DELETE FROM local_auth_sessions WHERE member_id = \?/);
  assert.match(members, /UPDATE activity_authors SET member_id = NULL/);
  assert.match(app, /member\.status === "approved"[\s\S]*deleteMember\(member\)/);
});
