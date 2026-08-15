import {
  accessErrorResponse,
  requirePrimaryOwner,
} from "../../../lib/collaboration";

export const dynamic = "force-dynamic";

function serverValue(name: string) {
  return String(process.env[name] ?? "").trim();
}

function sitesOrigin() {
  return (
    serverValue("STANDBY_SITE_ORIGIN") ||
    "https://whizzup-sales-hub.jackallan.chatgpt.site"
  ).replace(/\/+$/, "");
}

function cutoverSecret() {
  return (
    serverValue("STANDBY_SYNC_SECRET") ||
    serverValue("STANDBY_EXPORT_SECRET") ||
    serverValue("CUTOVER_API_SECRET")
  );
}

async function forwardToSites(method: "GET" | "POST", body?: unknown) {
  const secret = cutoverSecret();
  if (!secret) throw new Error("전환용 서버 비밀키가 없습니다.");
  const response = await fetch(`${sitesOrigin()}/api/standby-cutover`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(method === "POST" ? 150_000 : 15_000),
  });
  const payload = await response.json().catch(() => ({
    error: `Sites 전환 API가 ${response.status} 상태로 응답했습니다.`,
  }));
  return Response.json(payload, {
    status: response.status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function GET() {
  try {
    await requirePrimaryOwner();
    return await forwardToSites("GET");
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePrimaryOwner();
    const body = await request.json().catch(() => ({}));
    return await forwardToSites("POST", body);
  } catch (error) {
    return accessErrorResponse(error);
  }
}
