import { getD1, isPostgresDatabase } from "../db";
import { getPostgresObjectStorage } from "./postgres-object-storage";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const ROOT_FOLDER_NAME = "WHIZZUP 자료실";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const LOCAL_FILE_PREFIX = "postgres-object:";
const LOCAL_FOLDER_ID = "postgres-object-storage";

export type GoogleDriveStorageErrorCode =
  | "DRIVE_NOT_CONFIGURED"
  | "DRIVE_AUTH"
  | "DRIVE_ACCESS"
  | "DRIVE_FILE_NOT_FOUND"
  | "DRIVE_SESSION_EXPIRED"
  | "DRIVE_UPLOAD_FAILED";

export class GoogleDriveStorageError extends Error {
  constructor(
    public readonly code: GoogleDriveStorageErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GoogleDriveStorageError";
  }
}

type DriveConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  rootFolderId: string;
  serviceAccountEmail: string;
  serviceAccountPrivateKey: string;
  impersonatedUser: string;
};

export type GoogleDriveConnectionStatus = {
  platform: "vercel" | "sites";
  configured: boolean;
  connected: boolean;
  mode: "service-account" | "oauth" | "none";
  oauthConfigured: boolean;
  serviceAccountConfigured: boolean;
  serviceAccountEmail: string;
  rootFolderConfigured: boolean;
  issue: "" | "reauthorization_required" | "configuration" | "permission" | "temporary";
  message: string;
  checkedAt: string;
};

export type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  createdTime?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
};

export async function listDriveChildren(parentId: string) {
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set("q", `'${escapeQueryValue(parentId)}' in parents and trashed = false`);
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,parents,appProperties)");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("orderBy", "folder,name");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await driveFetch(url.toString());
    const payload = (await response.json().catch(() => ({}))) as {
      files?: DriveFile[];
      nextPageToken?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw driveReadError(response.status, "Google Drive에서 백업 폴더를 찾지 못했습니다.");
    }
    files.push(...(payload.files ?? []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return files;
}

export function isDriveFolder(file: DriveFile) {
  return file.mimeType === FOLDER_MIME_TYPE;
}

type DriveAuthMode = "service-account" | "oauth";
type DriveAccessToken = { token: string; expiresAt: number; mode: DriveAuthMode };

let oauthAccessTokenCache: DriveAccessToken | null = null;
let serviceAccountAccessTokenCache: DriveAccessToken | null = null;
let serviceAccountRootAccessCache: { allowed: boolean; expiresAt: number } | null = null;
const folderCache = new Map<string, string>();

function text(value: unknown) {
  return String(value ?? "").trim();
}

function config(): DriveConfig {
  const values = process.env as Record<string, unknown>;
  let serviceAccountEmail = "";
  let serviceAccountPrivateKey = "";
  const rawServiceAccount =
    text(values.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) ||
    text(values.WHIZZUP_GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON);
  if (rawServiceAccount) {
    try {
      const parsed = JSON.parse(rawServiceAccount) as {
        client_email?: unknown;
        private_key?: unknown;
      };
      serviceAccountEmail = text(parsed.client_email);
      serviceAccountPrivateKey = text(parsed.private_key);
    } catch {
      // The status endpoint reports an incomplete server-account configuration.
    }
  }
  return {
    clientId: text(values.GOOGLE_DRIVE_CLIENT_ID),
    clientSecret: text(values.GOOGLE_DRIVE_CLIENT_SECRET),
    refreshToken: text(values.GOOGLE_DRIVE_REFRESH_TOKEN),
    rootFolderId: text(values.GOOGLE_DRIVE_ROOT_FOLDER_ID),
    serviceAccountEmail,
    serviceAccountPrivateKey,
    impersonatedUser: text(values.GOOGLE_DRIVE_IMPERSONATED_USER),
  };
}

function oauthConfigured(value = config()) {
  return Boolean(value.clientId && value.clientSecret && value.refreshToken);
}

function serviceAccountConfigured(value = config()) {
  return Boolean(
    value.rootFolderId &&
      value.serviceAccountEmail &&
      value.serviceAccountPrivateKey,
  );
}

export function isGoogleDriveConfigured() {
  const value = config();
  return oauthConfigured(value) || serviceAccountConfigured(value);
}

export function isResourceStorageConfigured() {
  return isGoogleDriveConfigured();
}

function localFileKey(fileId: string) {
  return fileId.startsWith(LOCAL_FILE_PREFIX)
    ? fileId.slice(LOCAL_FILE_PREFIX.length)
    : "";
}

function requireConfig() {
  const value = config();
  if (!oauthConfigured(value) && !serviceAccountConfigured(value)) {
    throw new GoogleDriveStorageError(
      "DRIVE_NOT_CONFIGURED",
      "Google Drive 연결 정보가 없습니다. 관리자 센터의 API·연동에서 설정 상태를 확인해 주세요.",
      503,
    );
  }
  return value;
}

function base64Url(bytes: Uint8Array | string) {
  const source = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  source.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemBytes(value: string) {
  const normalized = value.replace(/\\n/g, "\n");
  const encoded = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function tokenRetryDelay(attempt: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, 180 + attempt * 280 + Math.floor(Math.random() * 140)),
  );
}

type GoogleTokenPayload = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  error_subtype?: string;
};

async function requestGoogleToken(
  body: URLSearchParams,
  authMode: DriveAuthMode,
) {
  let lastStatus = 503;
  let lastPayload: GoogleTokenPayload = {};
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const payload = (await response.json().catch(() => ({}))) as GoogleTokenPayload;
      lastStatus = response.status;
      lastPayload = payload;
      if (response.ok && payload.access_token) return payload;
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch {
      lastStatus = 503;
      lastPayload = { error: "network_error" };
    }
    if (attempt < 2) await tokenRetryDelay(attempt);
  }
  const providerCode = text(lastPayload.error);
  const subtype = text(lastPayload.error_subtype);
  console.error("Google Drive token request failed", {
    status: lastStatus,
    providerCode: providerCode || "unknown",
    subtype: subtype || "none",
  });
  if (providerCode === "invalid_grant") {
    throw new GoogleDriveStorageError(
      "DRIVE_AUTH",
      authMode === "service-account"
        ? "Google Drive 서버 계정 위임 또는 서명 설정을 확인해 주세요. 기존 사용자 승인 연결이 있으면 자동으로 대체합니다."
        : subtype === "invalid_rapt"
        ? "Google Workspace 보안 정책에 따라 Drive 재인증이 필요합니다. 관리자 센터의 API·연동에서 연결 상태를 확인해 주세요."
        : "Google Drive 장기 인증이 만료되었거나 해제되었습니다. OAuth 앱의 게시 상태를 확인하고 한 번 다시 승인해 주세요.",
      503,
    );
  }
  if (["invalid_client", "deleted_client"].includes(providerCode)) {
    throw new GoogleDriveStorageError(
      "DRIVE_NOT_CONFIGURED",
      "Google Drive OAuth 클라이언트 설정이 일치하지 않습니다. 배포 설정을 확인해 주세요.",
      503,
    );
  }
  throw new GoogleDriveStorageError(
    "DRIVE_ACCESS",
    "Google 인증 서버에 일시적으로 연결하지 못했습니다. 자동 재시도 후에도 실패하여 잠시 뒤 다시 확인해 주세요.",
    503,
  );
}

async function oauthAccessToken(force = false): Promise<DriveAccessToken> {
  if (
    !force &&
    oauthAccessTokenCache &&
    oauthAccessTokenCache.expiresAt > Date.now() + 60_000
  ) {
    return oauthAccessTokenCache;
  }
  const value = requireConfig();
  if (!oauthConfigured(value)) {
    throw new GoogleDriveStorageError(
      "DRIVE_NOT_CONFIGURED",
      "Google Drive 사용자 승인 연결이 등록되지 않았습니다.",
      503,
    );
  }
  const payload = await requestGoogleToken(
    new URLSearchParams({
      client_id: value.clientId,
      client_secret: value.clientSecret,
      refresh_token: value.refreshToken,
      grant_type: "refresh_token",
    }),
    "oauth",
  );
  if (!payload.access_token) {
    throw new GoogleDriveStorageError(
      "DRIVE_AUTH",
      "Google Drive 사용자 승인 연결을 갱신하지 못했습니다.",
      503,
    );
  }
  oauthAccessTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in) || 3600) * 1000,
    mode: "oauth",
  };
  return oauthAccessTokenCache;
}

async function serviceAccountAccessToken(force = false): Promise<DriveAccessToken> {
  if (
    !force &&
    serviceAccountAccessTokenCache &&
    serviceAccountAccessTokenCache.expiresAt > Date.now() + 60_000
  ) {
    return serviceAccountAccessTokenCache;
  }
  const value = requireConfig();
  if (!serviceAccountConfigured(value)) {
    throw new GoogleDriveStorageError(
      "DRIVE_NOT_CONFIGURED",
      "Google Drive 서버 계정 연결이 준비되지 않았습니다.",
      503,
    );
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(
    JSON.stringify({
      iss: value.serviceAccountEmail,
      scope: "https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      iat: issuedAt,
      exp: issuedAt + 3600,
      ...(value.impersonatedUser ? { sub: value.impersonatedUser } : {}),
    }),
  )}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(value.serviceAccountPrivateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const payload = await requestGoogleToken(
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}`,
    }),
    "service-account",
  );
  if (!payload.access_token) {
    throw new GoogleDriveStorageError(
      "DRIVE_AUTH",
      "Google Drive 서버 계정 인증을 갱신하지 못했습니다.",
      503,
    );
  }
  serviceAccountAccessTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in) || 3600) * 1000,
    mode: "service-account",
  };
  return serviceAccountAccessTokenCache;
}

async function serviceAccountCanUseRoot(token: DriveAccessToken, force = false) {
  if (
    !force &&
    serviceAccountRootAccessCache &&
    serviceAccountRootAccessCache.expiresAt > Date.now()
  ) {
    return serviceAccountRootAccessCache.allowed;
  }
  const rootFolderId = config().rootFolderId;
  if (!rootFolderId) return false;
  const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(rootFolderId)}`);
  url.searchParams.set("fields", "id,mimeType,capabilities(canAddChildren)");
  url.searchParams.set("supportsAllDrives", "true");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token.token}` },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    mimeType?: string;
    capabilities?: { canAddChildren?: boolean };
  };
  const allowed =
    response.ok &&
    payload.mimeType === FOLDER_MIME_TYPE &&
    payload.capabilities?.canAddChildren !== false;
  serviceAccountRootAccessCache = {
    allowed,
    expiresAt: Date.now() + (allowed ? 10 * 60_000 : 2 * 60_000),
  };
  return allowed;
}

async function accessToken(force = false, oauthOnly = false): Promise<DriveAccessToken> {
  const value = requireConfig();
  if (!oauthOnly && serviceAccountConfigured(value)) {
    try {
      const token = await serviceAccountAccessToken(force);
      if (await serviceAccountCanUseRoot(token, force)) return token;
    } catch (error) {
      if (!oauthConfigured(value)) throw error;
      console.warn("Google Drive server-account fallback is unavailable", {
        code: error instanceof GoogleDriveStorageError ? error.code : "unknown",
      });
    }
  }
  if (oauthConfigured(value)) return oauthAccessToken(force);
  throw new GoogleDriveStorageError(
    "DRIVE_ACCESS",
    `Google Drive 서버 계정(${value.serviceAccountEmail})에 백업 폴더 쓰기 권한이 없습니다. 공유 드라이브 권한을 확인해 주세요.`,
    503,
  );
}

async function driveFetch(input: string, init: RequestInit = {}, retry = true) {
  const auth = await accessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${auth.token}`);
  const response = await fetch(input, { ...init, headers });
  if ((response.status === 401 || response.status === 403) && retry) {
    if (auth.mode === "service-account" && oauthConfigured()) {
      const oauth = await accessToken(false, true);
      const oauthHeaders = new Headers(init.headers);
      oauthHeaders.set("Authorization", `Bearer ${oauth.token}`);
      return fetch(input, { ...init, headers: oauthHeaders });
    }
    if (auth.mode === "oauth" && response.status === 401) {
      oauthAccessTokenCache = null;
      const refreshed = await oauthAccessToken(true);
      const refreshedHeaders = new Headers(init.headers);
      refreshedHeaders.set("Authorization", `Bearer ${refreshed.token}`);
      return fetch(input, { ...init, headers: refreshedHeaders });
    }
  }
  return response;
}

function connectionIssue(error: unknown): GoogleDriveConnectionStatus["issue"] {
  if (!(error instanceof GoogleDriveStorageError)) return "temporary";
  if (error.code === "DRIVE_AUTH") return "reauthorization_required";
  if (error.code === "DRIVE_NOT_CONFIGURED") return "configuration";
  if (error.code === "DRIVE_ACCESS") return "permission";
  return "temporary";
}

export async function getGoogleDriveConnectionStatus(
  verify = false,
): Promise<GoogleDriveConnectionStatus> {
  const value = config();
  const base = {
    platform: isPostgresDatabase() ? ("vercel" as const) : ("sites" as const),
    configured: oauthConfigured(value) || serviceAccountConfigured(value),
    oauthConfigured: oauthConfigured(value),
    serviceAccountConfigured: Boolean(
      value.serviceAccountEmail && value.serviceAccountPrivateKey,
    ),
    serviceAccountEmail: value.serviceAccountEmail,
    rootFolderConfigured: Boolean(value.rootFolderId),
    checkedAt: verify ? new Date().toISOString() : "",
  };
  if (!isPostgresDatabase()) {
    return {
      ...base,
      configured: false,
      connected: false,
      mode: "none",
      issue: "",
      message: "Sites 대기판은 Google Drive 대신 D1/R2 독립 저장소를 사용합니다.",
    };
  }
  if (!verify) {
    return {
      ...base,
      connected: false,
      mode: "none",
      issue: base.configured ? "" : "configuration",
      message: base.configured
        ? "연결 정보를 확인할 준비가 되었습니다."
        : "Google Drive 연결 정보가 없습니다.",
    };
  }
  try {
    const auth = await accessToken(true);
    const url = new URL(`${DRIVE_API}/about`);
    url.searchParams.set("fields", "user(permissionId)");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!response.ok) {
      throw driveReadError(response.status, "Google Drive 연결 계정을 확인하지 못했습니다.");
    }
    return {
      ...base,
      configured: true,
      connected: true,
      mode: auth.mode,
      issue: "",
      message:
        auth.mode === "service-account"
          ? "서버 계정으로 안정적으로 연결되어 주기적인 사용자 재승인이 필요하지 않습니다."
          : "사용자 승인 방식으로 연결되어 있습니다. OAuth 앱이 테스트 상태이면 장기 인증이 만료될 수 있습니다.",
    };
  } catch (error) {
    return {
      ...base,
      connected: false,
      mode: "none",
      issue: connectionIssue(error),
      message:
        error instanceof Error
          ? error.message
          : "Google Drive 연결을 확인하지 못했습니다.",
    };
  }
}

function escapeQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function safeDriveFolderName(value: unknown, fallback = "미분류") {
  const cleaned = text(value)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

async function findFolder(parentId: string, name: string) {
  const query = [
    `name = '${escapeQueryValue(name)}'`,
    `mimeType = '${FOLDER_MIME_TYPE}'`,
    "trashed = false",
    parentId ? `'${escapeQueryValue(parentId)}' in parents` : "'root' in parents",
  ].join(" and ");
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id,name,createdTime)");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("orderBy", "createdTime");
  const response = await driveFetch(url.toString());
  const payload = (await response.json().catch(() => ({}))) as {
    files?: DriveFile[];
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || "Google Drive 폴더를 찾지 못했습니다.");
  }
  return (payload.files ?? [])
    .sort(
      (left, right) =>
        String(left.createdTime || "").localeCompare(
          String(right.createdTime || ""),
        ) || left.id.localeCompare(right.id),
    )[0]?.id || "";
}

async function createFolder(parentId: string, name: string) {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: FOLDER_MIME_TYPE,
    appProperties: { whizzup: "1" },
  };
  metadata.parents = [parentId || "root"];
  const response = await driveFetch(`${DRIVE_API}/files?fields=id,name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  const payload = (await response.json().catch(() => ({}))) as DriveFile & {
    error?: { message?: string };
  };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || "Google Drive 폴더를 만들지 못했습니다.");
  }
  return payload.id;
}

async function ensureFolder(parentId: string, rawName: string) {
  const name = safeDriveFolderName(rawName);
  const key = `${parentId || "root"}/${name}`;
  const cached = folderCache.get(key);
  if (cached) return cached;
  const found = await findFolder(parentId, name);
  const id = found || (await createFolder(parentId, name));
  folderCache.set(key, id);
  return id;
}

export async function ensureDrivePath(segments: string[]) {
  const value = requireConfig();
  return getD1().transaction(async (transaction) => {
    async function lockedFolder(parentId: string, rawName: string) {
      const name = safeDriveFolderName(rawName);
      await transaction
        .prepare(
          "SELECT pg_advisory_xact_lock(hashtextextended(?::text, 0)) AS locked",
        )
        .bind(`whizzup-drive-folder:${parentId || "root"}/${name}`)
        .run();
      return ensureFolder(parentId, name);
    }

    let parentId = value.rootFolderId;
    if (!parentId) parentId = await lockedFolder("", ROOT_FOLDER_NAME);
    for (const segment of segments) {
      parentId = await lockedFolder(parentId, segment);
    }
    return parentId;
  });
}

export function googleDriveStorageErrorResponse(error: unknown) {
  if (!(error instanceof GoogleDriveStorageError)) return null;
  return Response.json(
    { error: error.message, code: error.code },
    { status: error.status },
  );
}

function driveReadError(status: number, notFoundMessage: string) {
  if (status === 401 || status === 403) {
    return new GoogleDriveStorageError(
      "DRIVE_ACCESS",
      "Google Drive 연결 권한이 만료되었거나 부족합니다. 관리자 센터에서 Drive 연결을 확인해 주세요.",
      503,
    );
  }
  if (status === 404) {
    return new GoogleDriveStorageError("DRIVE_FILE_NOT_FOUND", notFoundMessage, 404);
  }
  return new GoogleDriveStorageError(
    "DRIVE_ACCESS",
    "Google Drive 파일 저장소에 일시적으로 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    502,
  );
}

export async function uploadDriveFile(input: {
  file: File;
  folderSegments: string[];
  contextType: string;
  contextId?: string;
}) {
  const folderId = await ensureDrivePath(input.folderSegments);
  const boundary = `whizzup_${crypto.randomUUID().replace(/-/g, "")}`;
  const metadata = {
    name: input.file.name.slice(0, 240),
    parents: [folderId],
    appProperties: {
      whizzup: "1",
      contextType: input.contextType.slice(0, 60),
      contextId: text(input.contextId).slice(0, 180),
    },
  };
  const body = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${input.file.type || "application/octet-stream"}\r\n\r\n`,
      input.file,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );
  const response = await driveFetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,parents`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  const payload = (await response.json().catch(() => ({}))) as DriveFile & {
    error?: { message?: string };
  };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || "Google Drive에 파일을 저장하지 못했습니다.");
  }
  return {
    fileId: payload.id,
    folderId,
    mimeType: payload.mimeType || input.file.type || "application/octet-stream",
    sizeBytes: Number(payload.size) || input.file.size,
  };
}

export async function replaceDriveFile(input: {
  fileId: string;
  file: File;
  folderSegments: string[];
  contextType: string;
  contextId?: string;
}) {
  const current = await getDriveFileMetadata(input.fileId);
  const folderId = await ensureDrivePath(input.folderSegments);
  const boundary = `whizzup_${crypto.randomUUID().replace(/-/g, "")}`;
  const metadata = {
    name: input.file.name.slice(0, 240),
    appProperties: {
      ...(current.appProperties ?? {}),
      whizzup: "1",
      contextType: input.contextType.slice(0, 60),
      contextId: text(input.contextId).slice(0, 180),
    },
  };
  const body = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${input.file.type || "application/octet-stream"}\r\n\r\n`,
      input.file,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );
  const url = new URL(`${DRIVE_UPLOAD_API}/files/${encodeURIComponent(input.fileId)}`);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,name,mimeType,size,parents");
  url.searchParams.set("supportsAllDrives", "true");
  if (!current.parents?.includes(folderId)) {
    url.searchParams.set("addParents", folderId);
    if (current.parents?.length) url.searchParams.set("removeParents", current.parents.join(","));
  }
  const response = await driveFetch(url.toString(), {
    method: "PATCH",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as DriveFile & { error?: { message?: string } };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || "Google Drive 견적 파일을 갱신하지 못했습니다.");
  }
  return {
    fileId: payload.id,
    folderId,
    mimeType: payload.mimeType || input.file.type || "application/octet-stream",
    sizeBytes: Number(payload.size) || input.file.size,
  };
}

export async function upsertDriveFileByContext(input: {
  file: File;
  folderSegments: string[];
  contextType: string;
  contextId: string;
}) {
  const folderId = await ensureDrivePath(input.folderSegments);
  const matches = (await listDriveChildren(folderId)).filter((item) =>
    !isDriveFolder(item)
    && item.appProperties?.contextType === input.contextType
    && item.appProperties?.contextId === input.contextId
  );
  const stored = matches[0]
    ? await replaceDriveFile({ ...input, fileId: matches[0].id })
    : await uploadDriveFile(input);
  for (const duplicate of matches.slice(1)) {
    await removeDriveFile(duplicate.id).catch(() => undefined);
  }
  return stored;
}

export async function syncDriveFileCopyFromSource(input: {
  sourceFileId: string;
  name: string;
  folderSegments: string[];
  contextType: string;
  contextId: string;
}) {
  const metadata = await getDriveFileMetadata(input.sourceFileId);
  const downloaded = await downloadDriveFile(input.sourceFileId);
  const contentType = metadata.mimeType || downloaded.headers.get("content-type") || "application/octet-stream";
  const file = new File([await downloaded.arrayBuffer()], input.name, { type: contentType });
  return upsertDriveFileByContext({
    file,
    folderSegments: input.folderSegments,
    contextType: input.contextType,
    contextId: input.contextId,
  });
}

export async function removeDriveFilesByContext(input: {
  folderSegments: string[];
  contextTypes: string[];
  contextId: string;
}) {
  const folderId = await ensureDrivePath(input.folderSegments);
  const types = new Set(input.contextTypes);
  const matches = (await listDriveChildren(folderId)).filter((item) =>
    !isDriveFolder(item)
    && types.has(String(item.appProperties?.contextType || ""))
    && item.appProperties?.contextId === input.contextId
  );
  for (const file of matches) await removeDriveFile(file.id);
  return matches.length;
}

export async function createDriveResumableUpload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  folderSegments: string[];
  contextType: string;
  contextId?: string;
  contextCategory?: string;
  createdBy: number;
}) {
  if (!isGoogleDriveConfigured()) {
    throw new GoogleDriveStorageError(
      "DRIVE_NOT_CONFIGURED",
      "Google Drive 연결 정보가 없어 파일을 저장하지 않았습니다. 관리자 센터에서 Drive 연결을 확인해 주세요.",
      503,
    );
  }
  const folderId = await ensureDrivePath(input.folderSegments);
  const metadata = {
    name: input.fileName.slice(0, 240),
    parents: [folderId],
    appProperties: {
      whizzup: "1",
      contextType: input.contextType.slice(0, 60),
      contextId: text(input.contextId).slice(0, 180),
      contextCategory: text(input.contextCategory).slice(0, 80),
      createdBy: String(input.createdBy),
    },
  };
  const response = await driveFetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,mimeType,size,parents,appProperties`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mimeType || "application/octet-stream",
        "X-Upload-Content-Length": String(input.sizeBytes),
      },
      body: JSON.stringify(metadata),
    },
  );
  const uploadUrl = response.headers.get("Location") || "";
  if (!response.ok || !uploadUrl) {
    const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    const message = payload.error?.message || "Google Drive 대용량 업로드를 시작하지 못했습니다.";
    if (response.status === 401 || response.status === 403) {
      throw new GoogleDriveStorageError("DRIVE_AUTH", message, response.status);
    }
    throw new GoogleDriveStorageError("DRIVE_UPLOAD_FAILED", message, response.status || 502);
  }
  return { uploadUrl, folderId };
}

export async function uploadDriveResumableChunk(input: {
  uploadUrl: string;
  body: ArrayBuffer;
  contentRange: string;
  mimeType: string;
}) {
  if (input.uploadUrl.startsWith("postgres-object://")) {
    throw new GoogleDriveStorageError(
      "DRIVE_SESSION_EXPIRED",
      "이전 업로드 세션은 더 이상 사용할 수 없습니다. Google Drive 연결을 확인한 뒤 업로드를 다시 시작해 주세요.",
      410,
    );
  }
  if (!input.uploadUrl.startsWith(`${DRIVE_UPLOAD_API}/files?`)) {
    throw new Error("올바르지 않은 Google Drive 업로드 주소입니다.");
  }
  const response = await driveFetch(input.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": input.mimeType || "application/octet-stream",
      "Content-Length": String(input.body.byteLength),
      "Content-Range": input.contentRange,
    },
    body: input.body,
  });
  const payload = (await response.json().catch(() => ({}))) as DriveFile & {
    error?: { message?: string };
  };
  if (response.status === 308) {
    return { complete: false as const, range: response.headers.get("Range") || "" };
  }
  if (!response.ok || !payload.id) {
    const message = payload.error?.message || "Google Drive 파일 조각을 저장하지 못했습니다.";
    if (response.status === 401 || response.status === 403) {
      throw new GoogleDriveStorageError("DRIVE_AUTH", message, response.status);
    }
    if (response.status === 404 || response.status === 410) {
      throw new GoogleDriveStorageError("DRIVE_SESSION_EXPIRED", message, response.status);
    }
    throw new GoogleDriveStorageError("DRIVE_UPLOAD_FAILED", message, response.status || 502);
  }
  return { complete: true as const, file: payload };
}

export async function getDriveFileMetadata(fileId: string) {
  const objectKey = localFileKey(fileId);
  if (objectKey) {
    const stored = await getPostgresObjectStorage().get(objectKey);
    if (!stored) throw new Error("독립 저장소 파일을 확인하지 못했습니다.");
    return {
      id: fileId,
      name: stored.customMetadata?.fileName || "file",
      mimeType: stored.httpMetadata?.contentType || "application/octet-stream",
      size: String(stored.size),
      parents: [stored.customMetadata?.folderId || LOCAL_FOLDER_ID],
      appProperties: {
        whizzup: stored.customMetadata?.whizzup || "1",
        contextType: stored.customMetadata?.contextType || "",
        contextId: stored.customMetadata?.contextId || "",
        createdBy: stored.customMetadata?.createdBy || "",
      },
    } satisfies DriveFile;
  }
  const response = await driveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,parents,appProperties,trashed&supportsAllDrives=true`,
  );
  const payload = (await response.json().catch(() => ({}))) as DriveFile & {
    trashed?: boolean;
    error?: { message?: string };
  };
  if (!response.ok || !payload.id || payload.trashed) {
    throw new Error(payload.error?.message || "Google Drive 파일을 확인하지 못했습니다.");
  }
  return payload;
}

export async function downloadDriveFile(fileId: string) {
  const objectKey = localFileKey(fileId);
  if (objectKey) {
    const stored = await getPostgresObjectStorage().get(objectKey);
    if (!stored) throw new Error("독립 저장소 파일을 찾지 못했습니다.");
    return new Response(await stored.arrayBuffer(), {
      headers: {
        "Content-Type": stored.httpMetadata?.contentType || "application/octet-stream",
        "Content-Length": String(stored.size),
      },
    });
  }
  const response = await driveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  if (!response.ok || !response.body) {
    throw driveReadError(
      response.status,
      "Google Drive에서 저장된 파일을 찾지 못했습니다. 현재 저장 내용으로 다시 생성해 주세요.",
    );
  }
  return response;
}

export async function removeDriveFile(fileId: string) {
  const objectKey = localFileKey(fileId);
  if (objectKey) {
    await getPostgresObjectStorage().delete(objectKey);
    return;
  }
  const response = await driveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error("Google Drive 임시 파일을 정리하지 못했습니다.");
  }
}

export async function archiveDriveFile(fileId: string, category = "자료실") {
  const objectKey = localFileKey(fileId);
  if (objectKey) {
    const storage = getPostgresObjectStorage();
    const stored = await storage.get(objectKey);
    if (!stored) return;
    const archiveKey = `resource-archive/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}`;
    await storage.put(archiveKey, await stored.arrayBuffer(), {
      httpMetadata: stored.httpMetadata,
      customMetadata: {
        ...(stored.customMetadata ?? {}),
        archivedCategory: safeDriveFolderName(category),
        archivedFrom: objectKey,
      },
    });
    await storage.delete(objectKey);
    return;
  }
  const archiveFolder = await ensureDrivePath([
    "99_보관",
    safeDriveFolderName(category),
    new Date().toISOString().slice(0, 7),
  ]);
  const metadataResponse = await driveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=parents`,
  );
  const metadata = (await metadataResponse.json().catch(() => ({}))) as DriveFile;
  if (!metadataResponse.ok) throw new Error("보관할 Google Drive 파일을 찾지 못했습니다.");
  if (metadata.parents?.includes(archiveFolder)) return;
  const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("addParents", archiveFolder);
  if (metadata.parents?.length) url.searchParams.set("removeParents", metadata.parents.join(","));
  url.searchParams.set("fields", "id,parents");
  const response = await driveFetch(url.toString(), { method: "PATCH" });
  if (!response.ok) throw new Error("Google Drive 보관 폴더로 이동하지 못했습니다.");
}

export type DriveMoveSnapshot = {
  fileId: string;
  previousParents: string[];
  destinationFolderId: string;
};

async function setDriveFileParents(fileId: string, addParents: string[], removeParents: string[]) {
  const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`);
  if (addParents.length) url.searchParams.set("addParents", addParents.join(","));
  if (removeParents.length) url.searchParams.set("removeParents", removeParents.join(","));
  url.searchParams.set("fields", "id,parents");
  url.searchParams.set("supportsAllDrives", "true");
  const response = await driveFetch(url.toString(), { method: "PATCH" });
  const payload = (await response.json().catch(() => ({}))) as DriveFile & { error?: { message?: string } };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || "Google Drive 파일 위치를 변경하지 못했습니다.");
  }
  return payload.parents ?? [];
}

export async function moveDriveFile(fileId: string, folderSegments: string[]): Promise<DriveMoveSnapshot> {
  const metadata = await getDriveFileMetadata(fileId);
  const previousParents = metadata.parents ?? [];
  const destinationFolderId = await ensureDrivePath(folderSegments);
  if (!previousParents.includes(destinationFolderId)) {
    await setDriveFileParents(fileId, [destinationFolderId], previousParents);
  }
  return { fileId, previousParents, destinationFolderId };
}

function splitFileName(value: string) {
  const match = value.match(/^(.*?)(\.[^.]+)?$/u);
  return { stem: match?.[1] || value, extension: match?.[2] || "" };
}

async function uniqueDriveFileName(folderId: string, requestedName: string, excludeFileId = "") {
  const safeName = requestedName.slice(0, 240) || "file";
  const children = await listDriveChildren(folderId);
  const names = new Set(
    children
      .filter((item) => item.id !== excludeFileId && !isDriveFolder(item))
      .map((item) => String(item.name || "")),
  );
  if (!names.has(safeName)) return safeName;
  const { stem, extension } = splitFileName(safeName);
  for (let index = 1; index < 1_000; index += 1) {
    const suffix = `_${String(index).padStart(2, "0")}`;
    const candidate = `${stem.slice(0, Math.max(1, 240 - extension.length - suffix.length))}${suffix}${extension}`;
    if (!names.has(candidate)) return candidate;
  }
  throw new Error("Google Drive에서 중복되지 않는 파일명을 만들지 못했습니다.");
}

async function renameDriveFile(fileId: string, name: string) {
  const response = await driveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,parents&supportsAllDrives=true`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ name: name.slice(0, 240) }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as DriveFile & { error?: { message?: string } };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || "Google Drive 파일명을 변경하지 못했습니다.");
  }
  return payload;
}

export async function organizeDriveFile(fileId: string, folderSegments: string[], requestedName: string) {
  const metadata = await getDriveFileMetadata(fileId);
  const previousParents = metadata.parents ?? [];
  const previousName = String(metadata.name || "");
  const destinationFolderId = await ensureDrivePath(folderSegments);
  const name = await uniqueDriveFileName(destinationFolderId, requestedName, fileId);
  try {
    if (!previousParents.includes(destinationFolderId)) {
      await setDriveFileParents(fileId, [destinationFolderId], previousParents);
    }
    if (previousName !== name) await renameDriveFile(fileId, name);
    return { fileId, previousParents, previousName, destinationFolderId, name };
  } catch (error) {
    if (!previousParents.includes(destinationFolderId)) {
      await setDriveFileParents(fileId, previousParents, [destinationFolderId]).catch(() => undefined);
    }
    if (previousName && previousName !== name) {
      await renameDriveFile(fileId, previousName).catch(() => undefined);
    }
    throw error;
  }
}

const REMOVABLE_QUOTATION_FOLDER = /^(?:기관자료 보기_견적서|견적서|참고 원본|\d{4})$/u;

export async function removeEmptyQuotationFolderChain(startFolderId: string) {
  let folderId = startFolderId;
  let removed = 0;
  for (let depth = 0; depth < 3 && folderId; depth += 1) {
    const metadata = await getDriveFileMetadata(folderId).catch(() => null);
    if (!metadata || !isDriveFolder(metadata) || !REMOVABLE_QUOTATION_FOLDER.test(String(metadata.name || ""))) break;
    if ((await listDriveChildren(folderId)).length) break;
    const parentId = metadata.parents?.[0] || "";
    const response = await driveFetch(
      `${DRIVE_API}/files/${encodeURIComponent(folderId)}?supportsAllDrives=true`,
      { method: "DELETE" },
    );
    if (!response.ok && response.status !== 404) break;
    removed += 1;
    folderId = parentId;
  }
  return removed;
}

async function findAppFoldersByName(rawName: string) {
  const name = safeDriveFolderName(rawName);
  const url = new URL(`${DRIVE_API}/files`);
  url.searchParams.set("q", [
    `name = '${escapeQueryValue(name)}'`,
    `mimeType = '${FOLDER_MIME_TYPE}'`,
    "trashed = false",
    "appProperties has { key='whizzup' and value='1' }",
  ].join(" and "));
  url.searchParams.set("fields", "files(id,name,mimeType,parents,appProperties)");
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  const response = await driveFetch(url.toString());
  const payload = (await response.json().catch(() => ({}))) as {
    files?: DriveFile[];
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || "기존 견적서 폴더를 찾지 못했습니다.");
  }
  return payload.files ?? [];
}

async function removeEmptyQuotationTree(folderId: string, depth = 0): Promise<number> {
  if (depth > 4) return 0;
  let removed = 0;
  const children = await listDriveChildren(folderId);
  for (const child of children) {
    if (isDriveFolder(child) && REMOVABLE_QUOTATION_FOLDER.test(String(child.name || ""))) {
      removed += await removeEmptyQuotationTree(child.id, depth + 1);
    }
  }
  if ((await listDriveChildren(folderId)).length) return removed;
  const metadata = await getDriveFileMetadata(folderId).catch(() => null);
  if (!metadata || !REMOVABLE_QUOTATION_FOLDER.test(String(metadata.name || ""))) return removed;
  const response = await driveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(folderId)}?supportsAllDrives=true`,
    { method: "DELETE" },
  );
  return response.ok || response.status === 404 ? removed + 1 : removed;
}

export async function removeEmptyLegacyQuotationFolders() {
  let removed = 0;
  for (const folder of await findAppFoldersByName("견적서")) {
    removed += await removeEmptyQuotationTree(folder.id);
  }
  return removed;
}

export async function rollbackDriveMoves(snapshots: DriveMoveSnapshot[]) {
  const failures: string[] = [];
  for (const snapshot of [...snapshots].reverse()) {
    try {
      await setDriveFileParents(
        snapshot.fileId,
        snapshot.previousParents,
        snapshot.previousParents.includes(snapshot.destinationFolderId) ? [] : [snapshot.destinationFolderId],
      );
    } catch {
      failures.push(snapshot.fileId);
    }
  }
  if (failures.length) {
    throw new Error(`Google Drive 원상복구에 실패한 파일이 ${failures.length}개 있습니다.`);
  }
}

export async function moveDriveFilesTransaction(
  files: Array<{ fileId: string; folderSegments: string[] }>,
) {
  const snapshots: DriveMoveSnapshot[] = [];
  try {
    for (const file of files) snapshots.push(await moveDriveFile(file.fileId, file.folderSegments));
    return snapshots;
  } catch (error) {
    await rollbackDriveMoves(snapshots).catch(() => undefined);
    throw error;
  }
}

export function driveObjectKey(fileId: string) {
  return `gdrive:${fileId}`;
}

export function driveFileIdFromKey(value: unknown) {
  const key = text(value);
  return key.startsWith("gdrive:") ? key.slice(7) : "";
}
