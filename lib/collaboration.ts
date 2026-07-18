import { getD1 } from "../db";
import { getChatGPTUser, type ChatGPTUser } from "../app/chatgpt-auth";

export const MEMBER_PERMISSIONS = [
  "members:manage",
  "records:manage",
  "map:manage",
  "data:export",
] as const;

export type MemberPermission = (typeof MEMBER_PERMISSIONS)[number];

export type Member = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "assistant" | "member";
  permissions: MemberPermission[];
  status: "pending" | "approved" | "suspended";
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

export async function ensureCollaborationReady() {
  return getD1();
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
    await d1
      .prepare(`
        UPDATE members
        SET auth_user_id = COALESCE(auth_user_id, ?),
            last_seen_at = CURRENT_TIMESTAMP
        WHERE id = ?
        RETURNING *
      `)
      .bind(identity.authUserId, Number(row.id))
      .first<Record<string, unknown>>()
      .then((updated) => {
        if (updated) row = updated;
      });
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

function clientAccessErrorResponse(error: AccessError) {
  return Response.json({ error: error.message }, { status: error.status });
}

export function accessErrorResponse(error: unknown) {
  if (
    error instanceof AccessError &&
    error.status >= 400 &&
    error.status < 500
  ) {
    return clientAccessErrorResponse(error);
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
        m.id, m.email, m.display_name, m.role, m.status,
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
