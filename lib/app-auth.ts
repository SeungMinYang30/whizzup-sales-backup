import { cookies } from "next/headers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { getD1, isPostgresDatabase } from "../db";

const SESSION_COOKIE = "whizzup_session";
const SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;
// Cloudflare Workers Web Crypto currently rejects PBKDF2 values above 100,000.
// Keep the stored iteration count explicit so password verification uses the
// same value that was used when the credential was created.
const PASSWORD_ITERATIONS = 100_000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const DIRECT_AUTH_TABLES = [
  "member_credentials",
  "member_sessions",
  "member_password_reset_requests",
  "member_rejections",
] as const;

let directAuthReadyPromise: Promise<D1Database> | null = null;

export type ApplicationIdentity = {
  email: string;
  displayName: string;
  source: "direct" | "chatgpt";
  memberId?: number;
};

export async function ensureDirectAuthReady() {
  // Authentication schema is normally owned by the deployment migrations.
  // Keep one cold-start probe as a recovery path for deployments where the
  // SQL files were packaged but omitted from Drizzle's migration journal.
  directAuthReadyPromise ??= verifyDirectAuthSchema(getD1()).catch((error) => {
    directAuthReadyPromise = null;
    throw error;
  });
  return directAuthReadyPromise;
}

async function verifyDirectAuthSchema(d1: D1Database) {
  if (isPostgresDatabase()) {
    const rows = await d1
      .prepare(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN (${DIRECT_AUTH_TABLES.map(() => "?").join(", ")})`,
      )
      .bind(...DIRECT_AUTH_TABLES)
      .all<{ name: string }>();
    const existing = new Set(rows.results.map((row) => row.name));
    if (DIRECT_AUTH_TABLES.every((table) => existing.has(table))) return d1;
    throw new Error("직접 로그인 DB 마이그레이션이 적용되지 않았습니다.");
  }
  const placeholders = DIRECT_AUTH_TABLES.map(() => "?").join(", ");
  const rows = await d1
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
    )
    .bind(...DIRECT_AUTH_TABLES)
    .all<{ name: string }>();
  const existing = new Set(rows.results.map((row) => row.name));
  if (DIRECT_AUTH_TABLES.every((table) => existing.has(table))) return d1;

  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS member_credentials (
      member_id INTEGER PRIMARY KEY,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL DEFAULT 100000,
      password_set_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS member_sessions (
      token_hash TEXT PRIMARY KEY,
      member_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      remember_me INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS member_sessions_member_idx ON member_sessions (member_id, expires_at)",
    ),
    d1.prepare(`CREATE TABLE IF NOT EXISTS member_password_reset_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT,
      resolved_by INTEGER
    )`),
    d1.prepare(
      "CREATE INDEX IF NOT EXISTS member_password_reset_status_idx ON member_password_reset_requests (status, requested_at)",
    ),
    d1.prepare(`CREATE TABLE IF NOT EXISTS member_rejections (
      email TEXT PRIMARY KEY NOT NULL,
      rejected_by INTEGER,
      rejected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);
  return d1;
}

export async function getApplicationIdentity(): Promise<ApplicationIdentity | null> {
  let direct: ApplicationIdentity | null = null;
  try {
    direct = await getDirectSessionIdentity();
  } catch (error) {
    // A session cookie can outlive a deployment or a partially migrated auth
    // schema. Treat it as expired so the user can sign in again instead of
    // crashing the whole Worker request.
    console.warn("Ignoring unusable direct session", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  if (direct) return direct;
  const chatgpt = await getChatGPTUser();
  if (!chatgpt) return null;
  return {
    email: chatgpt.email.trim().toLowerCase(),
    displayName: chatgpt.displayName,
    source: "chatgpt",
  };
}

export async function getDirectSessionIdentity(): Promise<ApplicationIdentity | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? "";
  if (!token) return null;
  const d1 = await ensureDirectAuthReady();
  const tokenHash = await sha256(token);
  const row = await d1
    .prepare(`
      SELECT m.id, m.email, m.display_name, m.status
      FROM member_sessions s
      JOIN members m ON m.id = s.member_id
      WHERE s.token_hash = ?
        AND datetime(s.expires_at) > CURRENT_TIMESTAMP
        AND m.status = 'approved'
      LIMIT 1
    `)
    .bind(tokenHash)
    .first<Record<string, unknown>>();
  if (!row) return null;
  await d1
    .prepare("UPDATE member_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?")
    .bind(tokenHash)
    .run();
  return {
    memberId: Number(row.id),
    email: String(row.email).trim().toLowerCase(),
    displayName: String(row.display_name),
    source: "direct",
  };
}

export async function findMemberByEmail(email: string) {
  const d1 = await ensureDirectAuthReady();
  return d1
    .prepare("SELECT * FROM members WHERE lower(email) = ? LIMIT 1")
    .bind(email.trim().toLowerCase())
    .first<Record<string, unknown>>();
}

export async function memberHasPassword(memberId: number) {
  const d1 = await ensureDirectAuthReady();
  const row = await d1
    .prepare("SELECT member_id FROM member_credentials WHERE member_id = ?")
    .bind(memberId)
    .first<{ member_id: number }>();
  return Boolean(row);
}

export function validatePassword(password: string) {
  if (password.length < 8) return "비밀번호는 8자 이상 입력해 주세요.";
  if (password.length > 128) return "비밀번호는 128자 이내로 입력해 주세요.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "비밀번호에는 영문과 숫자를 함께 넣어 주세요.";
  }
  return "";
}

export async function setMemberPassword(memberId: number, password: string) {
  const validation = validatePassword(password);
  if (validation) throw new Error(validation);
  const d1 = await ensureDirectAuthReady();
  const salt = randomToken(16);
  const hash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);
  await d1
    .prepare(`
      INSERT INTO member_credentials (
        member_id, password_hash, password_salt, password_iterations,
        password_set_at, failed_attempts, locked_until, updated_at
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 0, NULL, CURRENT_TIMESTAMP)
      ON CONFLICT(member_id) DO UPDATE SET
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        password_iterations = excluded.password_iterations,
        password_set_at = CURRENT_TIMESTAMP,
        failed_attempts = 0,
        locked_until = NULL,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(memberId, hash, salt, PASSWORD_ITERATIONS)
    .run();
  await d1.prepare("DELETE FROM member_sessions WHERE member_id = ?").bind(memberId).run();
}

export async function verifyMemberPassword(memberId: number, password: string) {
  const d1 = await ensureDirectAuthReady();
  const row = await d1
    .prepare(`
      SELECT password_hash, password_salt, password_iterations,
             failed_attempts, locked_until
      FROM member_credentials WHERE member_id = ?
    `)
    .bind(memberId)
    .first<Record<string, unknown>>();
  if (!row) return { ok: false, reason: "not-set" as const };
  if (row.locked_until && new Date(String(row.locked_until)).getTime() > Date.now()) {
    return { ok: false, reason: "locked" as const };
  }
  const actual = await derivePasswordHash(
    password,
    String(row.password_salt),
    Number(row.password_iterations || PASSWORD_ITERATIONS),
  );
  const ok = constantTimeEqual(actual, String(row.password_hash));
  if (ok) {
    await d1
      .prepare("UPDATE member_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE member_id = ?")
      .bind(memberId)
      .run();
    return { ok: true, reason: "ok" as const };
  }
  const failed = Number(row.failed_attempts ?? 0) + 1;
  const lockedUntil =
    failed >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
      : null;
  await d1
    .prepare("UPDATE member_credentials SET failed_attempts = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP WHERE member_id = ?")
    .bind(failed, lockedUntil, memberId)
    .run();
  return { ok: false, reason: lockedUntil ? ("locked" as const) : ("invalid" as const) };
}

export async function createDirectSession(memberId: number, remember: boolean) {
  const d1 = await ensureDirectAuthReady();
  await d1
    .prepare("DELETE FROM member_sessions WHERE datetime(expires_at) <= CURRENT_TIMESTAMP")
    .run();
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const milliseconds = remember
    ? REMEMBER_DAYS * 24 * 60 * 60 * 1000
    : SESSION_HOURS * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + milliseconds);
  await d1
    .prepare(`
      INSERT INTO member_sessions (
        token_hash, member_id, expires_at, remember_me, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .bind(tokenHash, memberId, expiresAt.toISOString(), remember ? 1 : 0)
    .run();
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearDirectSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? "";
  if (token) {
    const d1 = await ensureDirectAuthReady();
    await d1.prepare("DELETE FROM member_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

function randomToken(bytes: number) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToBase64Url(data);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function derivePasswordHash(password: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations,
    },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

function bytesToBase64Url(data: Uint8Array) {
  let binary = "";
  data.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
