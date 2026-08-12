import {
  accessErrorResponse,
  requirePrimaryOwner,
} from "../../../lib/collaboration";
import { getD1 } from "../../../db";
import {
  createStandbyCredentialSnapshot,
  mergeMissingStandbyCredentials,
  validateStandbyCredentialSnapshot,
} from "../../../lib/standby-credentials";

export const dynamic = "force-dynamic";

const LEGACY_ORIGIN = "https://whizzup-sales-hub.jackallan.chatgpt.site";
const FETCH_TIMEOUT_MS = 60_000;
const MAX_EXPORT_BYTES = 20 * 1024 * 1024;

function serverValue(name: string) {
  return String(process.env[name] ?? "").trim();
}

function legacyOrigin() {
  return (serverValue("LEGACY_SITE_ORIGIN") || LEGACY_ORIGIN).replace(/\/+$/, "");
}

async function credentialStatus() {
  const result = await getD1()
    .prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN credential.member_id IS NULL THEN 1 ELSE 0 END) AS missing
      FROM members member
      LEFT JOIN member_credentials credential ON credential.member_id = member.id
      WHERE member.status = 'approved'
        AND LOWER(member.email) NOT LIKE '%-noreply@chatgpt.com'
        AND LOWER(member.email) NOT LIKE 'sites-%'
        AND LOWER(member.display_name) NOT LIKE '%screenshot service%'
        AND LOWER(member.display_name) NOT LIKE '%system service%'
    `)
    .first<{ total: number; missing: number }>();
  const total = Number(result?.total ?? 0);
  const missing = Number(result?.missing ?? 0);
  return { total, configured: total - missing, missing };
}

async function fetchLegacyCredentials() {
  const exportSecret = serverValue("PRIMARY_EXPORT_SECRET");
  if (!exportSecret) throw new Error("PRIMARY_EXPORT_SECRET is not configured");

  const response = await fetch(`${legacyOrigin()}/api/standby-export`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${exportSecret}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Legacy credential export returned ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_EXPORT_BYTES) {
    throw new Error("Legacy credential export is too large");
  }
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
    memberCredentials?: unknown;
  };
  if (payload.memberCredentials === undefined) {
    throw new Error("Legacy credential export is not available yet");
  }
  const snapshot = validateStandbyCredentialSnapshot(payload.memberCredentials);
  if (!snapshot) throw new Error("Legacy credential export is empty");
  return snapshot;
}

export async function GET() {
  try {
    await requirePrimaryOwner();
    return Response.json(
      { ok: true, status: await credentialStatus(), sourceOrigin: legacyOrigin() },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST() {
  try {
    await requirePrimaryOwner();
    const [before, localSnapshot, sourceSnapshot] = await Promise.all([
      credentialStatus(),
      createStandbyCredentialSnapshot(),
      fetchLegacyCredentials(),
    ]);
    const result = await mergeMissingStandbyCredentials(sourceSnapshot);
    const after = await credentialStatus();
    return Response.json(
      {
        ok: true,
        changed: result.imported > 0,
        before,
        after,
        source: {
          count: result.sourceCount,
          checksum: result.checksum,
          createdAt: result.createdAt,
        },
        backup: {
          count: localSnapshot.credentials.length,
          checksum: localSnapshot.checksum,
          createdAt: localSnapshot.createdAt,
        },
        result: {
          imported: result.imported,
          alreadyPresent: result.alreadyPresent,
          matched: result.matched,
          sourceOnly: result.sourceOnly,
        },
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Credential migration failed", error);
    return Response.json(
      { ok: false, error: "기존 직원 비밀번호를 이전하지 못했습니다." },
      { status: 502 },
    );
  }
}
