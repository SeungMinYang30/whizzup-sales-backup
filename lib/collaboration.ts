import { getD1 } from "../db";
import { getChatGPTUser, type ChatGPTUser } from "../app/chatgpt-auth";

export const MEMBER_PERMISSIONS = [
  "records:manage",
  "members:manage",
  "integration:manage",
  "backup:manage",
] as const;

export type MemberPermission = (typeof MEMBER_PERMISSIONS)[number];

export type Member = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "assistant" | "member";
  permissions: MemberPermission[];
  status: "pending" | "approved" | "suspended";
  isSales: boolean;
  createdAt: string;
  approvedAt: string | null;
  lastSeenAt: string;
};

export class AccessError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "AccessError";
    this.status = status;
  }
}

export const OAUTH_ACTIVITY_SCOPE = "activities:write";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    permissions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    is_sales INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TEXT,
    approved_by INTEGER,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS members_status_idx ON members (status, created_at)",
  `CREATE TABLE IF NOT EXISTS activity_authors (
    activity_id INTEGER PRIMARY KEY,
    member_id INTEGER,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL UNIQUE,
    client_secret_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rotated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    member_id INTEGER NOT NULL,
    redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'activities:write',
    code_challenge TEXT,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS oauth_codes_expiry_idx ON oauth_codes (expires_at, used_at)",
  `CREATE TABLE IF NOT EXISTS oauth_tokens (
    access_token_hash TEXT PRIMARY KEY,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    member_id INTEGER NOT NULL,
    scope TEXT NOT NULL DEFAULT 'activities:write',
    expires_at TEXT NOT NULL,
    refresh_expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS oauth_tokens_member_idx ON oauth_tokens (member_id, revoked_at)",
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS api_credentials (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    encrypted_key TEXT NOT NULL,
    iv TEXT NOT NULL,
    key_last4 TEXT NOT NULL,
    model TEXT NOT NULL,
    updated_by INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

let collaborationReadyPromise: Promise<ReturnType<typeof getD1>> | null = null;

async function initializeCollaboration() {
  const d1 = getD1();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
  const memberColumns = await d1
    .prepare("PRAGMA table_info(members)")
    .all<{ name: string }>();
  if (!memberColumns.results.some((column) => column.name === "permissions")) {
    await d1
      .prepare(
        "ALTER TABLE members ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]'",
      )
      .run();
  }
  if (!memberColumns.results.some((column) => column.name === "is_sales")) {
    await d1
      .prepare(
        "ALTER TABLE members ADD COLUMN is_sales INTEGER NOT NULL DEFAULT 0",
      )
      .run();
  }
  return d1;
}

export function ensureCollaborationReady() {
  return Promise.resolve(getD1());
}

function mapMember(row: Record<string, unknown>): Member {
  const role =
    String(row.role) === "admin"
      ? "admin"
      : String(row.role) === "assistant"
        ? "assistant"
        : "member";
  return {
    id: Number(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    role,
    permissions: role === "assistant" ? normalizeMemberPermissions(row.permissions) : [],
    status:
      String(row.status) === "approved"
        ? "approved"
        : String(row.status) === "suspended"
          ? "suspended"
          : "pending",
    isSales: Number(row.is_sales ?? 0) === 1,
    createdAt: String(row.created_at),
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    lastSeenAt: String(row.last_seen_at),
  };
}

export async function getOrCreateMember(identity: ChatGPTUser) {
  const d1 = await ensureCollaborationReady();
  const email = identity.email.trim().toLowerCase();
  const bootstrapAdminEmail =
    process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const isBootstrapAdmin = Boolean(
    bootstrapAdminEmail && bootstrapAdminEmail === email,
  );

  if (isBootstrapAdmin) {
    const primaryAdmin = await d1
      .prepare(
        `SELECT *
         FROM members
         WHERE role = 'admin' AND status = 'approved'
         ORDER BY id ASC
         LIMIT 1`,
      )
      .first<Record<string, unknown>>();

    if (primaryAdmin) {
      await d1
        .prepare(
          `UPDATE members
           SET auth_user_id = NULL
           WHERE auth_user_id = ? AND id <> ?`,
        )
        .bind(identity.authUserId, Number(primaryAdmin.id))
        .run();
      const linkedAdmin = await d1
        .prepare(
          `UPDATE members
           SET auth_user_id = ?,
               last_seen_at = CURRENT_TIMESTAMP
           WHERE id = ?
           RETURNING *`,
        )
        .bind(identity.authUserId, Number(primaryAdmin.id))
        .first<Record<string, unknown>>();
      return mapMember(linkedAdmin ?? primaryAdmin);
    }
  }

  let row = await d1
    .prepare(
      "SELECT * FROM members WHERE auth_user_id = ? OR lower(email) = lower(?) LIMIT 1",
    )
    .bind(identity.authUserId, email)
    .first<Record<string, unknown>>();

  if (!row) {
    await d1
      .prepare(`
        INSERT INTO members (
          auth_user_id, email, display_name, role, status, approved_at,
          last_seen_at
        ) VALUES (?, ?, ?, 'member', 'pending', NULL, CURRENT_TIMESTAMP)
        ON CONFLICT (email) DO NOTHING
      `)
      .bind(identity.authUserId, email, identity.displayName)
      .run();
    row = await d1
      .prepare("SELECT * FROM members WHERE lower(email) = lower(?) LIMIT 1")
      .bind(email)
      .first<Record<string, unknown>>();
  } else {
    if (
      row.auth_user_id &&
      String(row.auth_user_id) !== identity.authUserId
    ) {
      throw new AccessError(
        "같은 이메일에 다른 로그인 계정이 연결되어 있습니다. 관리자에게 문의해 주세요.",
        409,
      );
    }
    const updated = await d1
      .prepare(`
        UPDATE members
        SET auth_user_id = COALESCE(auth_user_id, ?),
            last_seen_at = CURRENT_TIMESTAMP
        WHERE id = ?
        RETURNING *
      `)
      .bind(identity.authUserId, Number(row.id))
      .first<Record<string, unknown>>();
    if (updated) row = updated;
  }

  if (row && isBootstrapAdmin) {
    const promoted = await d1
      .prepare(`
        UPDATE members AS candidate
        SET role = 'admin',
            status = 'approved',
            approved_at = COALESCE(candidate.approved_at, CURRENT_TIMESTAMP),
            last_seen_at = CURRENT_TIMESTAMP
        WHERE candidate.id = ?
          AND lower(candidate.email) = lower(?)
          AND NOT EXISTS (
            SELECT 1
            FROM members AS approved_admin
            WHERE approved_admin.role = 'admin'
              AND approved_admin.status = 'approved'
              AND approved_admin.id <> candidate.id
          )
        RETURNING *
      `)
      .bind(Number(row.id), bootstrapAdminEmail)
      .first<Record<string, unknown>>();
    if (promoted) row = promoted;
  }

  if (!row) throw new Error("사용자 정보를 만들지 못했습니다.");
  return mapMember(row);
}

export async function requireMember() {
  const identity = await getChatGPTUser();
  if (!identity) throw new AccessError("Google 로그인이 필요합니다.", 401);
  return getOrCreateMember(identity);
}

export async function requireApprovedMember() {
  const member = await requireMember();
  if (member.status === "pending") {
    throw new AccessError("관리자 승인 대기 중입니다.", 403);
  }
  if (member.status === "suspended") {
    throw new AccessError("사용이 중지된 계정입니다.", 403);
  }
  return member;
}

export async function requireAdminMember() {
  const member = await requireApprovedMember();
  if (member.role !== "admin") {
    throw new AccessError("관리자 권한이 필요합니다.", 403);
  }
  return member;
}

export async function isPrimaryOwner(
  member: Pick<Member, "id" | "role">,
) {
  if (member.role !== "admin") return false;
  const d1 = await ensureCollaborationReady();
  const owner = await d1
    .prepare(
      `SELECT id
       FROM members
       WHERE role = 'admin' AND status = 'approved'
       ORDER BY id ASC
       LIMIT 1`,
    )
    .first<{ id: number }>();
  return Number(owner?.id) === member.id;
}

export async function requirePrimaryOwner() {
  const member = await requireApprovedMember();
  if (!(await isPrimaryOwner(member))) {
    throw new AccessError("대표관리자 본인만 접속 현황을 확인할 수 있습니다.", 403);
  }
  return member;
}

export function normalizeMemberPermissions(value: unknown): MemberPermission[] {
  let source: unknown = value;
  if (typeof value === "string") {
    try {
      source = JSON.parse(value);
    } catch {
      source = [];
    }
  }
  if (!Array.isArray(source)) return [];
  return MEMBER_PERMISSIONS.filter((permission) => source.includes(permission));
}

export function hasMemberPermission(
  member: Pick<Member, "role" | "permissions">,
  permission: MemberPermission,
) {
  return (
    member.role === "admin" ||
    (member.role === "assistant" && member.permissions.includes(permission))
  );
}

export async function requireMemberPermission(permission: MemberPermission) {
  const member = await requireApprovedMember();
  if (!hasMemberPermission(member, permission)) {
    throw new AccessError("이 작업을 사용할 권한이 없습니다.", 403);
  }
  return member;
}

export function accessErrorResponse(error: unknown) {
  if (
    error instanceof AccessError &&
    error.status >= 400 &&
    error.status < 500
  ) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("Unhandled collaboration request error", error);
  return Response.json(
    { error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
    { status: 500 },
  );
}

export function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return base64Url(data);
}

export async function hashSecret(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

export function base64Url(data: Uint8Array) {
  let binary = "";
  data.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function isAllowedChatGPTRedirect(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (!["chatgpt.com", "chat.openai.com"].includes(url.hostname)) return false;
    return url.pathname.includes("/oauth/callback");
  } catch {
    return false;
  }
}

export function isAllowedOAuthScope(value: string) {
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))];
  return scopes.length === 1 && scopes[0] === OAUTH_ACTIVITY_SCOPE;
}

export async function getOAuthMember(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token) throw new AccessError("연결 토큰이 필요합니다.", 401);

  const d1 = await ensureCollaborationReady();
  const tokenHash = await hashSecret(token);
  const row = await d1
    .prepare(`
      SELECT
        m.id, m.email, m.display_name, m.role, m.permissions, m.status,
        m.is_sales,
        m.created_at, m.approved_at, m.last_seen_at
      FROM oauth_tokens t
      JOIN members m ON m.id = t.member_id
      WHERE t.access_token_hash = ?
        AND t.revoked_at IS NULL
        AND t.scope = 'activities:write'
        AND datetime(t.expires_at) > CURRENT_TIMESTAMP
      LIMIT 1
    `)
    .bind(tokenHash)
    .first<Record<string, unknown>>();
  if (!row) throw new AccessError("연결이 만료되었거나 올바르지 않습니다.", 401);

  const member = mapMember(row);
  if (member.status !== "approved") {
    throw new AccessError("승인된 사용자만 기록할 수 있습니다.", 403);
  }
  return member;
}
