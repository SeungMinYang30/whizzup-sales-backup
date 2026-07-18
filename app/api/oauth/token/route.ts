import {
  base64Url,
  ensureCollaborationReady,
  hashSecret,
  randomToken,
} from "../../../../lib/collaboration";

export const dynamic = "force-dynamic";

function tokenResponse(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

function getClientCredentials(request: Request, form: URLSearchParams) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      if (separator >= 0) {
        return {
          clientId: decoded.slice(0, separator),
          clientSecret: decoded.slice(separator + 1),
        };
      }
    } catch {
      return { clientId: "", clientSecret: "" };
    }
  }
  return {
    clientId: form.get("client_id") ?? "",
    clientSecret: form.get("client_secret") ?? "",
  };
}

async function validateClient(clientId: string, clientSecret: string) {
  if (!clientId || !clientSecret) return null;
  const d1 = await ensureCollaborationReady();
  const secretHash = await hashSecret(clientSecret);
  return d1
    .prepare(`
      SELECT client_id FROM oauth_clients
      WHERE client_id = ? AND client_secret_hash = ?
    `)
    .bind(clientId, secretHash)
    .first<{ client_id: string }>();
}

async function issueTokens(
  clientId: string,
  memberId: number,
  scope: string,
) {
  const d1 = await ensureCollaborationReady();
  const accessToken = `whizzup_access_${randomToken(32)}`;
  const refreshToken = `whizzup_refresh_${randomToken(36)}`;
  const accessHash = await hashSecret(accessToken);
  const refreshHash = await hashSecret(refreshToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const refreshExpiresAt = new Date(
    Date.now() + 90 * 24 * 60 * 60 * 1000,
  ).toISOString();
  await d1
    .prepare(`
      INSERT INTO oauth_tokens (
        access_token_hash, refresh_token_hash, client_id, member_id,
        scope, expires_at, refresh_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      accessHash,
      refreshHash,
      clientId,
      memberId,
      scope,
      expiresAt,
      refreshExpiresAt,
    )
    .run();
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refreshToken,
    scope,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const form = new URLSearchParams(body);
    const grantType = form.get("grant_type") ?? "";
    const { clientId, clientSecret } = getClientCredentials(request, form);
    if (!(await validateClient(clientId, clientSecret))) {
      return tokenResponse(
        { error: "invalid_client", error_description: "GPT 연결 정보가 올바르지 않습니다." },
        401,
      );
    }
    const d1 = await ensureCollaborationReady();

    if (grantType === "authorization_code") {
      const code = form.get("code") ?? "";
      const redirectUri = form.get("redirect_uri") ?? "";
      const codeVerifier = form.get("code_verifier") ?? "";
      const codeHash = await hashSecret(code);
      const row = await d1
        .prepare(`
          SELECT * FROM oauth_codes
          WHERE code_hash = ?
            AND client_id = ?
            AND redirect_uri = ?
            AND used_at IS NULL
            AND datetime(expires_at) > CURRENT_TIMESTAMP
        `)
        .bind(codeHash, clientId, redirectUri)
        .first<Record<string, unknown>>();
      if (!row) {
        return tokenResponse(
          { error: "invalid_grant", error_description: "연결 코드가 만료되었거나 올바르지 않습니다." },
          400,
        );
      }
      if (row.code_challenge) {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(codeVerifier),
        );
        if (base64Url(new Uint8Array(digest)) !== String(row.code_challenge)) {
          return tokenResponse(
            { error: "invalid_grant", error_description: "PKCE 확인에 실패했습니다." },
            400,
          );
        }
      }
      const consumed = await d1
        .prepare(
          "UPDATE oauth_codes SET used_at = CURRENT_TIMESTAMP WHERE code_hash = ? AND used_at IS NULL",
        )
        .bind(codeHash)
        .run();
      if (!consumed.meta.changes) {
        return tokenResponse({ error: "invalid_grant" }, 400);
      }
      return tokenResponse(
        await issueTokens(clientId, Number(row.member_id), String(row.scope)),
      );
    }

    if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token") ?? "";
      const refreshHash = await hashSecret(refreshToken);
      const row = await d1
        .prepare(`
          SELECT * FROM oauth_tokens
          WHERE refresh_token_hash = ?
            AND client_id = ?
            AND revoked_at IS NULL
            AND datetime(refresh_expires_at) > CURRENT_TIMESTAMP
        `)
        .bind(refreshHash, clientId)
        .first<Record<string, unknown>>();
      if (!row) {
        return tokenResponse({ error: "invalid_grant" }, 400);
      }
      const revoked = await d1
        .prepare(
          "UPDATE oauth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE refresh_token_hash = ? AND revoked_at IS NULL",
        )
        .bind(refreshHash)
        .run();
      if (!revoked.meta.changes) {
        return tokenResponse({ error: "invalid_grant" }, 400);
      }
      return tokenResponse(
        await issueTokens(clientId, Number(row.member_id), String(row.scope)),
      );
    }

    return tokenResponse({ error: "unsupported_grant_type" }, 400);
  } catch (error) {
    return tokenResponse(
      {
        error: "server_error",
        error_description:
          error instanceof Error ? error.message : "토큰을 발급하지 못했습니다.",
      },
      500,
    );
  }
}
