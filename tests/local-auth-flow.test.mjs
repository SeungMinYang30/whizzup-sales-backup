import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("직원은 이메일 없이 아이디와 비밀번호로 가입 신청한다", async () => {
  const [signup, loginPage] = await Promise.all([
    read("app/api/local-auth/signup/route.ts"),
    read("app/login/page.tsx"),
  ]);
  assert.match(signup, /status, is_sales, last_seen_at/);
  assert.match(signup, /'pending'/);
  assert.match(signup, /localMemberEmail\(username\)/);
  assert.match(loginPage, /가입을 신청하고, 관리자 승인 후/);
});

test("비밀번호는 강한 해시와 로그인 잠금으로 보호한다", async () => {
  const [auth, login] = await Promise.all([
    read("lib/local-auth.ts"),
    read("app/api/local-auth/login/route.ts"),
  ]);
  assert.match(auth, /210_000/);
  assert.match(auth, /pbkdf2Sync/);
  assert.match(auth, /httpOnly: true/);
  assert.match(login, /INTERVAL '15 minutes'/);
  assert.match(login, /failures >= 5/);
});

test("대표 관리자 외 계정은 원본 보관 후 연결 이력을 보존하며 정리한다", async () => {
  const cleanup = await read("app/api/members/cleanup/route.ts");
  assert.match(cleanup, /freeyang30@gmail\.com/);
  assert.match(cleanup, /member_account_archives/);
  assert.match(cleanup, /activity_authors SET member_id = NULL/);
  assert.match(cleanup, /DELETE FROM members WHERE id = \?/);
  assert.match(cleanup, /requirePrimaryOwner/);
});
