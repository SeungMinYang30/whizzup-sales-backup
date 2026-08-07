import "server-only";

import {
  createHash,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { getD1 } from "../db";

export const LOCAL_AUTH_COOKIE = "whizzup_local_session";
export const LOCAL_AUTH_ITERATIONS = 210_000;
const SESSION_DAYS = 30;

export function normalizeUsername(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function validateUsername(username: string) {
  return /^[a-z0-9][a-z0-9._-]{3,29}$/.test(username);
}

export function validatePassword(password: string) {
  return (
    password.length >= 8 &&
    password.length <= 72 &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

export function hashPassword(password: string, salt = randomBytes(16).toString("base64")) {
  const hash = pbkdf2Sync(
    password,
    Buffer.from(salt, "base64"),
    LOCAL_AUTH_ITERATIONS,
    32,
    "sha256",
  ).toString("base64");
  return { hash, salt, iterations: LOCAL_AUTH_ITERATIONS };
}

export function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
  iterations = LOCAL_AUTH_ITERATIONS,
) {
  const actual = pbkdf2Sync(
    password,
    Buffer.from(salt, "base64"),
    iterations,
    32,
    "sha256",
  );
  const expected = Buffer.from(expectedHash, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function localMemberEmail(username: string) {
  return `${username}@local.whizzup`;
}

export async function createLocalSession(memberId: number) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const d1 = getD1();
  await d1
    .prepare(
      `INSERT INTO local_auth_sessions
       (token_hash, member_id, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(tokenHash, memberId, expiresAt.toISOString())
    .run();
  const store = await cookies();
  store.set(LOCAL_AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteLocalSession() {
  const store = await cookies();
  const token = store.get(LOCAL_AUTH_COOKIE)?.value ?? "";
  if (token) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await getD1()
      .prepare("DELETE FROM local_auth_sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
  }
  store.delete(LOCAL_AUTH_COOKIE);
}

export async function getLocalAuthIdentity() {
  const token = (await cookies()).get(LOCAL_AUTH_COOKIE)?.value ?? "";
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const d1 = getD1();
  const row = await d1
    .prepare(
      `SELECT m.id, m.username, m.email, m.display_name
       FROM local_auth_sessions s
       JOIN members m ON m.id = s.member_id
       WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{
      id: number;
      username: string | null;
      email: string;
      display_name: string;
    }>();
  if (!row) {
    (await cookies()).delete(LOCAL_AUTH_COOKIE);
    return null;
  }
  await d1
    .prepare(
      `UPDATE local_auth_sessions
       SET last_seen_at = CURRENT_TIMESTAMP
       WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .run();
  return {
    memberId: Number(row.id),
    username: String(row.username ?? ""),
    email: String(row.email),
    displayName: String(row.display_name),
  };
}
